import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildDeepSeekWebPrompt } from '@/lib/deepseek-web-bridge';

let fixtureRoot: string;
let sessions: typeof import('@/lib/annot-sessions');

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function makePdfSession(folderPath: string, name: string) {
  await fs.mkdir(path.join(fixtureRoot, folderPath), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, folderPath, 'paper.pdf'), '%PDF-synthetic-fixture');
  return sessions.createSession(folderPath, name, {
    sessionKind: 'pdf',
    pdfPath: `${folderPath}/paper.pdf`,
    documentId: `doc-${name}`,
  });
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pagedock-session-fixture-'));
  process.env.PAGEDOCK_ROOT = fixtureRoot;
  sessions = await import('@/lib/annot-sessions');
});

afterAll(async () => {
  const researchDb = await import('@/lib/research-db');
  researchDb.closeResearchDatabaseConnections();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe('session file mutations', () => {
  it('does not rewrite a stable read or an idempotent import', async () => {
    const session = await makePdfSession('read-stable', 'read-stable');
    const sessionsFile = path.join(fixtureRoot, 'read-stable', '.annot', 'sessions.json');
    const beforeBytes = await fs.readFile(sessionsFile);
    const beforeStat = await fs.stat(sessionsFile);
    await wait(30);
    await sessions.listSessions('read-stable');
    const afterReadBytes = await fs.readFile(sessionsFile);
    const afterReadStat = await fs.stat(sessionsFile);
    expect(afterReadBytes.equals(beforeBytes)).toBe(true);
    expect(afterReadStat.mtimeMs).toBe(beforeStat.mtimeMs);

    const sourceText = 'Stable synthetic selection.';
    const questionMessageId = 'stable-question';
    const assistantMessageId = 'stable-assistant';
    await sessions.mutateSession('read-stable', session.id, (current) => ({
      ...current,
      messages: [
        ...current.messages,
        { id: questionMessageId, role: 'user', content: 'Explain the stable selection.', timestamp: new Date().toISOString() },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: 'Stable primary explanation.',
          timestamp: new Date().toISOString(),
          replyToMessageId: questionMessageId,
          sourceContext: {
            id: 'stable-source',
            scope: 'selection',
            documentId: 'doc-read-stable',
            page: 3,
            text: sourceText,
            rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
            highlightId: 'stable-highlight',
          },
        },
      ],
    }));
    const { POST } = await import('@/app/api/sessions/deepseek-perspectives/route');
    const promptSnapshot = buildDeepSeekWebPrompt({ sourceText, question: 'Explain the stable selection.' });
    const makeRequest = () => new NextRequest('http://localhost/api/sessions/deepseek-perspectives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'read-stable',
        sessionId: session.id,
        assistantMessageId,
        promptSnapshot,
        responseText: 'Stable imported explanation.',
      }),
    });
    const first = await POST(makeRequest());
    expect(first.status).toBe(200);
    const beforeRetryBytes = await fs.readFile(sessionsFile);
    const beforeRetryStat = await fs.stat(sessionsFile);
    await wait(30);
    const repeated = await POST(makeRequest());
    expect(repeated.status).toBe(200);
    const afterRetryBytes = await fs.readFile(sessionsFile);
    const afterRetryStat = await fs.stat(sessionsFile);
    expect(afterRetryBytes.equals(beforeRetryBytes)).toBe(true);
    expect(afterRetryStat.mtimeMs).toBe(beforeRetryStat.mtimeMs);
  });

  it('persists an actual reconciliation change while keeping the source locator', async () => {
    await fs.mkdir(path.join(fixtureRoot, 'reconcile'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'reconcile', 'paper.pdf'), '%PDF-reconcile-fixture');
    const session = await sessions.createSession('reconcile', 'paper', { sessionKind: 'folder' });
    const sessionsFile = path.join(fixtureRoot, 'reconcile', '.annot', 'sessions.json');
    const before = await fs.readFile(sessionsFile, 'utf8');
    await wait(30);
    const listed = await sessions.listSessions('reconcile');
    expect(listed[0]?.id).toBe(session.id);
    expect(listed[0]?.sessionKind).toBe('pdf');
    expect(listed[0]?.pdfPath).toBe('reconcile/paper.pdf');
    expect(await fs.readFile(sessionsFile, 'utf8')).not.toBe(before);
  });

  it('preserves concurrent domain patches in one sessions.json', async () => {
    const session = await makePdfSession('same-folder', 'same-folder');

    await Promise.all([0, 1].map((index) => sessions.mutateSession('same-folder', session.id, async (current) => {
      await wait(index === 0 ? 20 : 0);
      return {
        ...current,
        messages: [...current.messages, {
          id: `synthetic-${index}`,
          role: 'user' as const,
          content: `synthetic patch ${index}`,
          timestamp: new Date().toISOString(),
        }],
      };
    })));

    const saved = await sessions.getSession('same-folder', session.id);
    expect(saved?.messages.map((message) => message.id).sort()).toEqual(['synthetic-0', 'synthetic-1']);
  });

  it('serializes different sessions sharing one folder file', async () => {
    const first = await makePdfSession('two-sessions', 'first');
    const second = await makePdfSession('two-sessions', 'second');

    await Promise.all([
      sessions.mutateSession('two-sessions', first.id, async (current) => {
        await wait(15);
        return { ...current, title: 'first changed' };
      }),
      sessions.mutateSession('two-sessions', second.id, async (current) => ({ ...current, title: 'second changed' })),
    ]);

    const saved = await sessions.listSessions('two-sessions');
    expect(saved.map((item) => item.title).sort()).toEqual(['first changed', 'second changed']);
  });

  it('does not resurrect a PDF session when removal races a patch', async () => {
    const session = await makePdfSession('remove-race', 'remove-race');

    const results = await Promise.allSettled([
      sessions.mutateSession('remove-race', session.id, async (current) => {
        await wait(15);
        return { ...current, title: 'late patch' };
      }),
      sessions.removePdfSessions('remove-race', 'remove-race/paper.pdf'),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(String(result.reason)).toContain(`Session not found: ${session.id}`);
      }
    }
    expect(await sessions.getSession('remove-race', session.id)).toBeNull();
  });

  it('makes repeated manual imports idempotent while preserving distinct answers', async () => {
    const session = await makePdfSession('deepseek-retry', 'deepseek-retry');
    const sourceText = 'Synthetic source excerpt for the import contract.';
    const question = 'What does this synthetic excerpt mean?';
    const assistantMessageId = 'assistant-synthetic';
    const questionMessageId = 'question-synthetic';
    await sessions.mutateSession('deepseek-retry', session.id, (current) => ({
      ...current,
      messages: [
        ...current.messages,
        { id: questionMessageId, role: 'user', content: question, timestamp: new Date().toISOString() },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: 'Synthetic primary explanation.',
          timestamp: new Date().toISOString(),
          replyToMessageId: questionMessageId,
          sourceContext: { id: 'source-synthetic', scope: 'selection', page: 2, text: sourceText },
        },
      ],
    }));

    const { POST } = await import('@/app/api/sessions/deepseek-perspectives/route');
    const promptSnapshot = buildDeepSeekWebPrompt({ sourceText, question });
    const makeRequest = (responseText: string) => new NextRequest('http://localhost/api/sessions/deepseek-perspectives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'deepseek-retry',
        sessionId: session.id,
        assistantMessageId,
        promptSnapshot,
        responseText,
      }),
    });

    const repeated = await Promise.all([
      POST(await makeRequest('Synthetic DeepSeek answer A')),
      POST(await makeRequest('Synthetic DeepSeek answer A')),
    ]);
    expect(repeated.map((response) => response.status)).toEqual([200, 200]);
    const repeatedPayloads = await Promise.all(repeated.map((response) => response.json()));
    expect(repeatedPayloads[0].perspective.id).toBe(repeatedPayloads[1].perspective.id);

    const distinct = await POST(await makeRequest('Synthetic DeepSeek answer B'));
    expect(distinct.status).toBe(200);
    const saved = await sessions.getSession('deepseek-retry', session.id);
    const assistant = saved?.messages.find((message) => message.id === assistantMessageId);
    expect(assistant?.secondaryPerspectives?.map((item) => item.responseText)).toEqual([
      'Synthetic DeepSeek answer A',
      'Synthetic DeepSeek answer B',
    ]);
  });

  it('saves a direct DeepSeek question before import without creating a fake answer', async () => {
    const session = await makePdfSession('deepseek-direct', 'deepseek-direct');
    const sourceContext = {
      id: 'direct-source',
      scope: 'selection' as const,
      documentId: 'doc-deepseek-direct',
      page: 4,
      text: 'Synthetic direct-flow excerpt.',
      rects: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.05 }],
      highlightId: 'direct-highlight',
    };
    const { POST: saveQuestion } = await import('@/app/api/sessions/deepseek-questions/route');
    const questionRequest = () => new NextRequest('http://localhost/api/sessions/deepseek-questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'deepseek-direct',
        sessionId: session.id,
        requestId: 'direct-request-1',
        prompt: 'What does this direct excerpt mean?',
        sourceContext,
      }),
    });
    const firstQuestion = await saveQuestion(questionRequest());
    const firstPayload = await firstQuestion.json();
    expect(firstQuestion.status).toBe(200);
    const repeatedQuestion = await saveQuestion(questionRequest());
    const repeatedPayload = await repeatedQuestion.json();
    expect(repeatedQuestion.status).toBe(200);
    expect(repeatedPayload.questionMessage.id).toBe(firstPayload.questionMessage.id);

    const promptSnapshot = buildDeepSeekWebPrompt({ sourceText: sourceContext.text, question: 'What does this direct excerpt mean?' });
    const { POST: importPerspective } = await import('@/app/api/sessions/deepseek-perspectives/route');
    const imported = await importPerspective(new NextRequest('http://localhost/api/sessions/deepseek-perspectives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderPath: 'deepseek-direct',
        sessionId: session.id,
        questionMessageId: firstPayload.questionMessage.id,
        promptSnapshot,
        responseText: 'A direct synthetic explanation with $x^2$.',
      }),
    }));
    expect(imported.status).toBe(200);
    const saved = await sessions.getSession('deepseek-direct', session.id);
    const question = saved?.messages.find((message) => message.id === firstPayload.questionMessage.id);
    expect(saved?.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
    expect(question?.sourceContext).toEqual(sourceContext);
    expect(question?.secondaryPerspectives?.[0]?.questionMessageId).toBe(question?.id);
  });

  it('reports the response limit exactly at the over-limit boundary', async () => {
    const session = await makePdfSession('deepseek-limit', 'deepseek-limit');
    const sourceText = 'Limit fixture source.';
    const questionMessageId = 'limit-question';
    const assistantMessageId = 'limit-assistant';
    await sessions.mutateSession('deepseek-limit', session.id, (current) => ({
      ...current,
      messages: [
        ...current.messages,
        { id: questionMessageId, role: 'user', content: 'Explain.', timestamp: new Date().toISOString() },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: 'Primary.',
          timestamp: new Date().toISOString(),
          replyToMessageId: questionMessageId,
          sourceContext: { id: 'limit-source', scope: 'selection', page: 1, text: sourceText, rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }] },
        },
      ],
    }));
    const { POST } = await import('@/app/api/sessions/deepseek-perspectives/route');
    const promptSnapshot = buildDeepSeekWebPrompt({ sourceText, question: 'Explain.' });
    const response = await POST(new NextRequest('http://localhost/api/sessions/deepseek-perspectives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folderPath: 'deepseek-limit', sessionId: session.id, assistantMessageId, promptSnapshot, responseText: 'x'.repeat(80_001) }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('80,000자 이하');
  });

  it('round-trips session anchors and summaries through backup v1 import and v2 export', async () => {
    const session = await makePdfSession('backup-roundtrip', 'backup-roundtrip');
    const sourceContext = {
      id: 'backup-session-source',
      scope: 'selection' as const,
      documentId: 'doc-backup-roundtrip',
      page: 5,
      text: 'Synthetic backup source.',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      highlightId: 'backup-highlight',
    };
    await sessions.mutateSession('backup-roundtrip', session.id, (current) => ({
      ...current,
      messages: [{ id: 'backup-question', role: 'user', content: 'Backup question.', timestamp: new Date().toISOString(), sourceContext }],
      turnSummaries: [{
        id: 'backup-summary', questionMessageId: 'backup-question', assistantMessageId: 'backup-assistant',
        question: 'Backup question.', answerSummary: 'Synthetic summary.', createdAt: new Date().toISOString(),
      }],
    }));

    const { createPortableBackup, importPortableBackup } = await import('@/lib/library-backup');
    const v2Zip = await JSZip.loadAsync(await createPortableBackup(false));
    const v2Session = JSON.parse(await v2Zip.file('library/backup-roundtrip/.annot/sessions.json')!.async('string')) as Array<{ messages: Array<{ sourceContext?: typeof sourceContext }>; turnSummaries: unknown[] }>;
    expect(v2Session[0]?.messages[0]?.sourceContext).toEqual(sourceContext);
    expect(v2Session[0]?.turnSummaries).toHaveLength(1);

    const legacySession = {
      ...session,
      id: 'legacy-v1-session',
      folderPath: 'backup-v1',
      pdfPath: undefined,
      sessionKind: 'folder',
      messages: [{ id: 'legacy-question', role: 'user', content: 'Legacy backup question.', timestamp: new Date().toISOString(), sourceContext }],
      turnSummaries: [{
        id: 'legacy-summary', questionMessageId: 'legacy-question', assistantMessageId: 'legacy-assistant',
        question: 'Legacy backup question.', answerSummary: 'Legacy summary.', createdAt: new Date().toISOString(),
      }],
    };
    const legacyData = Buffer.from(JSON.stringify([legacySession]), 'utf8');
    const legacyZip = new JSZip();
    legacyZip.file('library/backup-v1/.annot/sessions.json', legacyData);
    legacyZip.file('manifest.json', JSON.stringify({
      format: 'annot-portable-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      appVersion: '0.9.0',
      includesPdfs: false,
      files: [{
        path: 'backup-v1/.annot/sessions.json',
        size: legacyData.byteLength,
        sha256: createHash('sha256').update(legacyData).digest('hex'),
      }],
    }));
    await importPortableBackup(await legacyZip.generateAsync({ type: 'nodebuffer' }));
    const importedLegacy = (await sessions.listSessions('backup-v1')).find((item) => item.id === 'legacy-v1-session');
    expect(importedLegacy?.messages[0]?.sourceContext).toEqual(sourceContext);
    expect(importedLegacy?.turnSummaries?.[0]?.answerSummary).toBe('Legacy summary.');
  });
});
