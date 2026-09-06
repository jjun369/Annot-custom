import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildDeepSeekWebPrompt } from '@/lib/deepseek-web-bridge';

const providerGate = vi.hoisted(() => {
  let release!: () => void;
  let started!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const runStarted = new Promise<void>((resolve) => { started = resolve; });
  return {
    release,
    runStarted,
    started,
    runtime: {
      runTurn: vi.fn(async () => {
        started();
        await released;
        return { content: 'Synthetic delayed primary answer.', providerSessionId: 'synthetic-provider-session' };
      }),
    },
  };
});

vi.mock('@/lib/ai-providers', () => ({
  getProviderRuntime: () => providerGate.runtime,
}));

vi.mock('@/lib/mobile-bridge', () => ({
  markMobileBridgeExportDirtyForDocument: vi.fn(async () => undefined),
}));

let fixtureRoot: string;
let sessions: typeof import('@/lib/annot-sessions');

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pagedock-chat-route-fixture-'));
  process.env.PAGEDOCK_ROOT = fixtureRoot;
  sessions = await import('@/lib/annot-sessions');
});

afterAll(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe('chat completion and manual import concurrency', () => {
  it('preserves an import made while a primary turn is waiting', async () => {
    await fs.mkdir(path.join(fixtureRoot, 'concurrent'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'concurrent', 'paper.pdf'), '%PDF-concurrent-fixture');
    const session = await sessions.createSession('concurrent', 'Concurrent', {
      sessionKind: 'pdf',
      pdfPath: 'concurrent/paper.pdf',
      documentId: 'doc-concurrent',
    });
    const sourceText = 'Concurrent synthetic source.';
    const questionMessageId = 'existing-question';
    const assistantMessageId = 'existing-assistant';
    await sessions.mutateSession('concurrent', session.id, (current) => ({
      ...current,
      messages: [
        ...current.messages,
        { id: questionMessageId, role: 'user', content: 'Explain the existing source.', timestamp: new Date().toISOString() },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: 'Existing primary.',
          timestamp: new Date().toISOString(),
          replyToMessageId: questionMessageId,
          sourceContext: {
            id: 'existing-source',
            scope: 'selection',
            documentId: 'doc-concurrent',
            page: 2,
            text: sourceText,
            rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.03 }],
          },
        },
      ],
    }));

    const { POST: postChat } = await import('@/app/api/chat/route');
    const chatResponse = await postChat(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'concurrent',
        sessionId: session.id,
        prompt: 'A delayed new question.',
        model: 'auto',
        sourceContext: {
          id: 'new-source',
          scope: 'selection',
          documentId: 'doc-concurrent',
          page: 3,
          text: 'New concurrent source.',
          rects: [{ x: 0.2, y: 0.2, width: 0.3, height: 0.03 }],
        },
      }),
    }));
    expect(chatResponse.status).toBe(200);
    const reader = chatResponse.body!.getReader();
    const firstRead = reader.read();
    await providerGate.runStarted;

    const { POST: importPerspective } = await import('@/app/api/sessions/deepseek-perspectives/route');
    const imported = await importPerspective(new NextRequest('http://localhost/api/sessions/deepseek-perspectives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'concurrent',
        sessionId: session.id,
        assistantMessageId,
        promptSnapshot: buildDeepSeekWebPrompt({ sourceText, question: 'Explain the existing source.' }),
        responseText: 'Concurrent imported explanation.',
      }),
    }));
    expect(imported.status).toBe(200);

    providerGate.release();
    await firstRead;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
    }

    const saved = await sessions.getSession('concurrent', session.id);
    const existingAssistant = saved?.messages.find((message) => message.id === assistantMessageId);
    expect(existingAssistant?.secondaryPerspectives?.map((item) => item.responseText)).toEqual(['Concurrent imported explanation.']);
    expect(saved?.messages.some((message) => message.role === 'assistant' && message.content === 'Synthetic delayed primary answer.')).toBe(true);
    expect(saved?.messages.filter((message) => message.content === 'A delayed new question.')).toHaveLength(1);
  });

  it('keeps a locally saved selection question after a primary quota failure', async () => {
    await fs.mkdir(path.join(fixtureRoot, 'quota'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'quota', 'paper.pdf'), '%PDF-quota-fixture');
    const session = await sessions.createSession('quota', 'Quota', {
      sessionKind: 'pdf',
      pdfPath: 'quota/paper.pdf',
      documentId: 'doc-quota',
    });
    providerGate.runtime.runTurn.mockRejectedValueOnce(new Error('429 quota'));
    const { POST: postChat } = await import('@/app/api/chat/route');
    const response = await postChat(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'quota',
        sessionId: session.id,
        prompt: 'Primary quota question.',
        sourceContext: {
          id: 'quota-source',
          scope: 'selection',
          documentId: 'doc-quota',
          page: 1,
          text: 'Quota synthetic selection.',
          rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.03 }],
        },
      }),
    }));
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) {
      // Drain the error stream so the route closes its controller.
    }
    const savedAfterFailure = await sessions.getSession('quota', session.id);
    const question = savedAfterFailure?.messages.find((message) => message.role === 'user');
    expect(question?.content).toBe('Primary quota question.');
    expect(question?.sourceContext?.text).toBe('Quota synthetic selection.');
    expect(savedAfterFailure?.messages.some((message) => message.role === 'assistant' && message.content.includes('429'))).toBe(false);

    const { POST: importPerspective } = await import('@/app/api/sessions/deepseek-perspectives/route');
    const imported = await importPerspective(new NextRequest('http://localhost/api/sessions/deepseek-perspectives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'quota',
        sessionId: session.id,
        questionMessageId: question!.id,
        promptSnapshot: buildDeepSeekWebPrompt({ sourceText: 'Quota synthetic selection.', question: 'Primary quota question.' }),
        responseText: 'Manual recovery explanation.',
      }),
    }));
    expect(imported.status).toBe(200);
    const recovered = await sessions.getSession('quota', session.id);
    expect(recovered?.messages.find((message) => message.id === question!.id)?.secondaryPerspectives?.[0]?.responseText).toBe('Manual recovery explanation.');
  });

  it('attaches a successful primary answer to an existing saved question without duplicating it', async () => {
    await fs.mkdir(path.join(fixtureRoot, 'retry'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'retry', 'paper.pdf'), '%PDF-retry-fixture');
    const session = await sessions.createSession('retry', 'Retry', {
      sessionKind: 'pdf',
      pdfPath: 'retry/paper.pdf',
      documentId: 'doc-retry',
    });
    const sourceContext = {
      id: 'retry-source',
      scope: 'selection' as const,
      documentId: 'doc-retry',
      page: 2,
      text: 'Retry synthetic selection.',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.03 }],
    };
    const questionId = 'saved-question-for-retry';
    await sessions.mutateSession('retry', session.id, (current) => ({
      ...current,
      messages: [{
        id: questionId,
        role: 'user',
        content: 'Retry this saved question.',
        timestamp: new Date().toISOString(),
        sourceContext,
        deepSeekRequestId: 'retry-request',
      }],
    }));

    const { POST: postChat } = await import('@/app/api/chat/route');
    const response = await postChat(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'retry',
        sessionId: session.id,
        userMessageId: questionId,
        prompt: 'Retry this saved question.',
        model: 'auto',
        sourceContext,
      }),
    }));
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) {
      // Drain the synthetic stream.
    }

    const saved = await sessions.getSession('retry', session.id);
    expect(saved?.messages.filter((message) => message.id === questionId)).toHaveLength(1);
    const assistant = saved?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.replyToMessageId).toBe(questionId);
  });
});
