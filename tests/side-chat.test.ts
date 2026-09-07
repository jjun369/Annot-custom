import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { NextRequest } from 'next/server';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const providerGate = vi.hoisted(() => {
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const releasedPromise = new Promise<void>((resolve) => { release = resolve; });
  return {
    release: () => release(),
    waitUntilStarted: () => startedPromise,
    runtime: {
      runTurn: vi.fn(async () => {
        started();
        await releasedPromise;
        return { content: 'Synthetic PageDock side explanation.', providerSessionId: 'sidechat-provider-session' };
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

const sourceContext = {
  id: 'side-source-1',
  scope: 'selection' as const,
  documentId: 'doc-side-1',
  page: 7,
  text: 'Synthetic bounded source for side chat.',
  rects: [{ x: 0.12, y: 0.2, width: 0.42, height: 0.04 }],
  highlightId: 'highlight-side-1',
};

async function makeSideSession(title: string) {
  return sessions.createSession('.', title, { sessionKind: 'sidechat', provider: 'codex' });
}

function request(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pagedock-sidechat-fixture-'));
  process.env.PAGEDOCK_ROOT = fixtureRoot;
  sessions = await import('@/lib/annot-sessions');
});

afterAll(async () => {
  const researchDb = await import('@/lib/research-db');
  researchDb.closeResearchDatabaseConnections();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe('independent side chat storage and outbound contract', () => {
  it('resolves new B consistently without borrowing saved A or its selected answer', async () => {
    const { resolveSideChatTarget, buildSideChatOutboundPrompt } = await import('@/lib/side-chat');
    const messages = [{ id: 'a', role: 'user' as const, content: 'Question A', timestamp: '' }, { id: 'ra', role: 'assistant' as const, content: 'Answer A', replyToMessageId: 'a', timestamp: '' }];
    const target = resolveSideChatTarget('Question B', undefined, undefined, messages, 'a', 'ra');
    expect(target.kind).toBe('composer'); expect(target.question).toBeUndefined(); expect(target.answer).toBeUndefined();
    expect(buildSideChatOutboundPrompt({ mode: 'question', question: target.text })).toContain('Question B');
    expect(messages[0].content).toBe('Question A');
  });

  it('pins copied requests across modes, providers, changed answers and reverse-order imports', async () => {
    const session = await makeSideSession('Immutable requests');
    await sessions.mutateSession('.', session.id, (s) => ({ ...s, messages: [
      { id: 'immutable-q', role: 'user', content: 'Synthetic question', timestamp: '', sourceContext, sourcePdfPath: 'papers/synthetic.pdf' },
      { id: 'immutable-a', role: 'assistant', content: 'Original R1', timestamp: '', replyToMessageId: 'immutable-q' },
    ] }));
    const { POST: prepare, PATCH: copied } = await import('@/app/api/side-chat/requests/route');
    const { POST: paste } = await import('@/app/api/side-chat/perspectives/route');
    const { buildSideChatOutboundPrompt } = await import('@/lib/side-chat');
    const original = await sessions.getSession('.', session.id);
    const body = { sessionId: session.id, questionMessageId: 'immutable-q', requestId: 'request-deepseek', provider: 'deepseek', promptMode: 'question-answer', answerMessageId: 'immutable-a',
      promptSnapshot: buildSideChatOutboundPrompt({ mode: 'question-answer', question: 'Synthetic question', answerText: 'Original R1' }) };
    const prepared = await prepare(request('http://localhost/api/side-chat/requests', body)); expect(prepared.status).toBe(200);
    const pinned = (await prepared.json()).request;
    expect(pinned.copiedAt).toBeUndefined(); expect(pinned.sourceContext).toEqual(sourceContext);
    expect(pinned.promptSnapshot).not.toContain(sourceContext.text); expect(pinned.promptSnapshot).toContain('claims, evidence, assumptions');
    expect((await prepare(request('http://localhost/api/side-chat/requests', { ...body, provider: 'claude' }))).status).toBe(409);
    expect((await copied(request('http://localhost/api/side-chat/requests', { sessionId: session.id, requestId: pinned.id }))).status).toBe(200);
    const claudeBody = { ...body, requestId: 'request-claude', provider: 'claude', promptMode: 'source-question', answerMessageId: undefined,
      promptSnapshot: buildSideChatOutboundPrompt({ mode: 'source-question', question: 'Synthetic question', sourceText: sourceContext.text }) };
    expect((await prepare(request('http://localhost/api/side-chat/requests', claudeBody))).status).toBe(200);
    await sessions.mutateSession('.', session.id, (s) => ({ ...s, messages: s.messages.map((m) => m.id === 'immutable-a' ? { ...m, content: 'Changed R2' } : m) }));
    const pasteBody = { folderPath: '.', sessionId: session.id, requestId: pinned.id, responseText: 'Synthetic review R1' };
    const reverse = await paste(request('http://localhost/api/side-chat/perspectives', { ...pasteBody, requestId: 'request-claude', responseText: 'Claude independent' })); expect(reverse.status).toBe(200);
    const results = await Promise.all([paste(request('http://localhost/api/side-chat/perspectives', pasteBody)), paste(request('http://localhost/api/side-chat/perspectives', pasteBody))]);
    const one = await results[0].json(); const two = await results[1].json(); expect(one.perspective.id).toBe(two.perspective.id);
    expect(one.perspective.promptSnapshot).toContain('Original R1'); expect(one.perspective.promptSnapshot).not.toContain('Changed R2');
    expect((await paste(request('http://localhost/api/side-chat/perspectives', { ...pasteBody, promptMode: 'question' }))).status).toBe(409);
    expect((await paste(request('http://localhost/api/side-chat/perspectives', { ...pasteBody, responseText: 'Distinct review' }))).status).toBe(200);
    const final = await sessions.getSession('.', session.id); expect(final?.messages[0].sideChatPerspectives).toHaveLength(3);
    expect(original?.messages[0].content).toBe(final?.messages[0].content);
    const { createPortableBackup, importPortableBackup } = await import('@/lib/library-backup');
    const archive = await createPortableBackup(false);
    await sessions.mutateSession('.', session.id, (s) => ({ ...s, messages: [] }));
    await importPortableBackup(archive);
    const restored = (await sessions.listSessions('.', { sessionKind: 'sidechat' })).find((s) => s.id !== session.id && s.messages[0]?.id === 'immutable-q');
    expect(restored?.messages[0].sideChatWebRequests).toEqual(final?.messages[0].sideChatWebRequests?.map((r) => ({ ...r, sessionId: restored!.id })));
    expect(restored?.messages[0].sideChatPerspectives).toEqual(final?.messages[0].sideChatPerspectives);
    const zip = await JSZip.loadAsync(archive);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')); manifest.version = 1;
    zip.file('manifest.json', JSON.stringify(manifest));
    await sessions.mutateSession('.', session.id, (s) => ({ ...s, messages: [] }));
    await importPortableBackup(await zip.generateAsync({ type: 'nodebuffer' }));
    const legacyRestored = (await sessions.listSessions('.', { sessionKind: 'sidechat' })).find((s) => s.id !== session.id && s.id !== restored?.id && s.messages[0]?.id === 'immutable-q');
    expect(legacyRestored?.messages[0].sideChatWebRequests).toEqual(final?.messages[0].sideChatWebRequests?.map((r) => ({ ...r, sessionId: legacyRestored!.id })));
    expect((await paste(request('http://localhost/api/side-chat/perspectives', { ...pasteBody, sessionId: legacyRestored!.id, responseText: 'After restore' }))).status).toBe(200);
  });
  it('keeps side chat sessions separate and saves a bounded question before web use', async () => {
    const sideSession = await makeSideSession('Synthetic side chat');
    const mainSession = await sessions.createSession('paper-folder', 'Synthetic PDF chat', {
      sessionKind: 'folder',
    });
    const { POST: saveQuestion } = await import('@/app/api/side-chat/questions/route');
    const body = {
      folderPath: '.',
      sessionId: sideSession.id,
      requestId: 'side-question-request-1',
      prompt: 'What does this bounded excerpt mean?',
      sourceContext,
      sourcePdfPath: 'papers/synthetic.pdf',
    };

    const first = await saveQuestion(request('http://localhost/api/side-chat/questions', body));
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    expect(firstPayload.questionMessage.sourceContext).toEqual(sourceContext);
    expect(firstPayload.questionMessage.sourcePdfPath).toBe('papers/synthetic.pdf');
    expect(firstPayload.session.messages).toHaveLength(1);
    expect(firstPayload.session.messages[0].role).toBe('user');

    const retry = await saveQuestion(request('http://localhost/api/side-chat/questions', body));
    expect(retry.status).toBe(200);
    expect((await retry.json()).questionMessage.id).toBe(firstPayload.questionMessage.id);

    const collision = await saveQuestion(request('http://localhost/api/side-chat/questions', {
      ...body,
      prompt: 'A different question with the same request id.',
    }));
    expect(collision.status).toBe(409);
    expect((await sessions.listSessions('.', { sessionKind: 'sidechat' })).map((item) => item.id)).toContain(sideSession.id);
    expect((await sessions.listSessions('.', { sessionKind: 'sidechat' })).every((item) => item.sessionKind === 'sidechat')).toBe(true);
    expect(await sessions.getSession('paper-folder', mainSession.id)).not.toBeNull();
  });

  it('rejects unsafe source paths and preserves the explicit outbound modes', async () => {
    const sideSession = await makeSideSession('Synthetic validation side chat');
    const { POST: saveQuestion } = await import('@/app/api/side-chat/questions/route');
    const invalid = await saveQuestion(request('http://localhost/api/side-chat/questions', {
      folderPath: '.',
      sessionId: sideSession.id,
      requestId: 'unsafe-path',
      prompt: 'Keep this local.',
      sourcePdfPath: '../private.pdf',
    }));
    expect(invalid.status).toBe(400);

    const { buildSideChatOutboundPrompt } = await import('@/lib/side-chat');
    const questionOnly = buildSideChatOutboundPrompt({ mode: 'question', question: 'Synthetic question.', sourceText: 'Must not be included.' });
    expect(questionOnly).toContain('Synthetic question.');
    expect(questionOnly).not.toContain('Must not be included.');
    const sourceAndQuestion = buildSideChatOutboundPrompt({ mode: 'source-question', question: 'Synthetic question.', sourceText: sourceContext.text });
    expect(sourceAndQuestion).toContain(sourceContext.text);
    expect(sourceAndQuestion).not.toContain('First PageDock explanation');
    const sourceQuestionAnswer = buildSideChatOutboundPrompt({ mode: 'source-question-answer', question: 'Synthetic question.', sourceText: sourceContext.text, answerText: 'Synthetic first answer.' });
    expect(sourceQuestionAnswer).toContain('Synthetic first answer.');
  });

  it('keeps web answer drafts scoped to their question, session, and provider', async () => {
    const { buildSideChatWebDraftKey } = await import('@/lib/side-chat');
    const persisted = buildSideChatWebDraftKey({
      sessionId: 'session-a',
      questionMessageId: 'question-a',
      question: 'Same synthetic question.',
      provider: 'deepseek',
    });
    expect(buildSideChatWebDraftKey({
      sessionId: 'session-a',
      questionMessageId: 'question-a',
      question: 'Same synthetic question.',
      provider: 'deepseek',
    })).toBe(persisted);
    expect(buildSideChatWebDraftKey({
      sessionId: 'session-b',
      questionMessageId: 'question-a',
      question: 'Same synthetic question.',
      provider: 'deepseek',
    })).not.toBe(persisted);
    expect(buildSideChatWebDraftKey({
      sessionId: 'session-a',
      questionMessageId: 'question-a',
      question: 'Same synthetic question.',
      provider: 'chatgpt',
    })).not.toBe(persisted);

    const unsaved = buildSideChatWebDraftKey({
      sessionId: 'session-a',
      question: 'A new synthetic question.',
      sourceContext,
      provider: 'deepseek',
    });
    const otherUnsaved = buildSideChatWebDraftKey({
      sessionId: 'session-a',
      question: 'Another synthetic question.',
      sourceContext,
      provider: 'deepseek',
    });
    expect(unsaved).not.toBe(otherUnsaved);
    expect(unsaved.length).toBeLessThan(200);
  });

  it('is idempotent per pasted response while preserving distinct explanations and rejecting mutated previews', async () => {
    const sideSession = await makeSideSession('Synthetic perspective side chat');
    const { POST: saveQuestion } = await import('@/app/api/side-chat/questions/route');
    const questionResponse = await saveQuestion(request('http://localhost/api/side-chat/questions', {
      folderPath: '.',
      sessionId: sideSession.id,
      requestId: 'perspective-question-1',
      prompt: 'Explain the selected source.',
      sourceContext,
      sourcePdfPath: 'papers/synthetic.pdf',
    }));
    const question = (await questionResponse.json()).questionMessage;
    const { buildSideChatOutboundPrompt, SIDE_CHAT_MAX_RESPONSE_CHARS } = await import('@/lib/side-chat');
    const { POST: savePerspective } = await import('@/app/api/side-chat/perspectives/route');
    const promptSnapshot = buildSideChatOutboundPrompt({ mode: 'source-question', question: question.content, sourceText: sourceContext.text });
    const perspectiveBody = {
      folderPath: '.',
      sessionId: sideSession.id,
      questionMessageId: question.id,
      provider: 'deepseek',
      promptMode: 'source-question',
      promptSnapshot,
      responseText: 'Synthetic DeepSeek explanation A.',
    };
    const first = await savePerspective(request('http://localhost/api/side-chat/perspectives', perspectiveBody));
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    const repeated = await savePerspective(request('http://localhost/api/side-chat/perspectives', perspectiveBody));
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).perspective.id).toBe(firstPayload.perspective.id);

    const distinct = await savePerspective(request('http://localhost/api/side-chat/perspectives', {
      ...perspectiveBody,
      responseText: 'Synthetic DeepSeek explanation B.',
    }));
    expect(distinct.status).toBe(200);
    const mutatedPreview = await savePerspective(request('http://localhost/api/side-chat/perspectives', {
      ...perspectiveBody,
      responseText: 'Synthetic explanation C.',
      promptSnapshot: `${promptSnapshot}\nmutated`,
    }));
    expect(mutatedPreview.status).toBe(400);

    const overLimit = await savePerspective(request('http://localhost/api/side-chat/perspectives', {
      ...perspectiveBody,
      responseText: 'x'.repeat(SIDE_CHAT_MAX_RESPONSE_CHARS + 1),
    }));
    expect(overLimit.status).toBe(400);
    const saved = await sessions.getSession('.', sideSession.id);
    expect(saved?.messages[0]?.sideChatPerspectives?.map((item) => item.responseText)).toEqual([
      'Synthetic DeepSeek explanation A.',
      'Synthetic DeepSeek explanation B.',
    ]);

    const { createPortableBackup } = await import('@/lib/library-backup');
    const backupZip = await JSZip.loadAsync(await createPortableBackup(false));
    const backedUpSessions = JSON.parse(await backupZip.file('library/.annot/sessions.json')!.async('string')) as Array<{ id: string; sessionKind: string; messages: Array<{ sideChatPerspectives?: unknown[] }> }>;
    const backedUpSideSession = backedUpSessions.find((item) => item.id === sideSession.id);
    expect(backedUpSideSession?.sessionKind).toBe('sidechat');
    expect(backedUpSideSession?.messages[0]?.sideChatPerspectives).toHaveLength(2);
  });

  it('keeps a side question and pasted answer while a PageDock turn is waiting', async () => {
    const sideSession = await makeSideSession('Synthetic concurrent side chat');
    const { POST: postChat } = await import('@/app/api/chat/route');
    const response = await postChat(request('http://localhost/api/chat', {
      folderPath: '.',
      sessionId: sideSession.id,
      userMessageId: 'side-primary-question-1',
      prompt: 'Explain this side question.',
      model: 'auto',
      sourceContext,
      sourcePdfPath: 'papers/synthetic.pdf',
    }));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const firstRead = reader.read();
    await providerGate.waitUntilStarted();

    const savedWhileWaiting = await sessions.getSession('.', sideSession.id);
    const question = savedWhileWaiting?.messages.find((message) => message.id === 'side-primary-question-1');
    expect(question?.role).toBe('user');
    expect(savedWhileWaiting?.messages.some((message) => message.role === 'assistant')).toBe(false);

    const { buildSideChatOutboundPrompt } = await import('@/lib/side-chat');
    const { POST: savePerspective } = await import('@/app/api/side-chat/perspectives/route');
    const imported = await savePerspective(request('http://localhost/api/side-chat/perspectives', {
      folderPath: '.',
      sessionId: sideSession.id,
      questionMessageId: question!.id,
      provider: 'deepseek',
      promptMode: 'source-question',
      promptSnapshot: buildSideChatOutboundPrompt({ mode: 'source-question', question: question!.content, sourceText: sourceContext.text }),
      responseText: 'Synthetic manual answer while primary waits.',
    }));
    expect(imported.status).toBe(200);

    providerGate.release();
    await firstRead;
    while (!(await reader.read()).done) {
      // Drain the synthetic NDJSON stream.
    }

    const final = await sessions.getSession('.', sideSession.id);
    expect(final?.messages.filter((message) => message.id === 'side-primary-question-1')).toHaveLength(1);
    expect(final?.messages.some((message) => message.role === 'assistant' && message.content === 'Synthetic PageDock side explanation.')).toBe(true);
    expect(final?.messages.find((message) => message.id === question!.id)?.sideChatPerspectives?.[0]?.responseText).toBe('Synthetic manual answer while primary waits.');
  });
});
