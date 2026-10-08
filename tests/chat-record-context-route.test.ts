import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  runTurn: vi.fn(async (input: unknown) => { calls.lastInput = input; return { content: 'Synthetic answer.', providerSessionId: 'provider-next' }; }),
  lastInput: null as unknown,
  retrieve: vi.fn(async (input: { documentId: string; query: string; page?: number; includeIds?: string[] }) => ({
    scope: 'document' as const, records: input.includeIds?.includes('reader:doc-canonical:h1') ? [{
      id: 'reader:doc-canonical:h1', title: 'p.2 · concept', originLabel: '현재 PDF · Reader 기록', provenanceLabel: '문헌 발췌 · 개인 메모',
      excerpt: 'Canonical current source excerpt.', sourceUpdatedAt: '2026-10-03',
      anchor: { id: 'h1', scope: 'selection' as const, documentId: 'doc-canonical', page: 2, text: 'Canonical current source excerpt.', rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.1 }] },
    }] : [], omittedCount: 0, omittedChars: 0, snapshotHash: 'snapshot-current',
  })),
  librarySearch: vi.fn(async () => []),
  selectLibrary: vi.fn(async () => ({ scope: 'library' as const, records: [], omittedCount: 0, omittedChars: 0, snapshotHash: 'snapshot-current' })),
  bounded: vi.fn(),
}));

vi.mock('@/lib/ai-providers', () => ({ getProviderRuntime: () => ({ runTurn: calls.runTurn }) }));
vi.mock('@/lib/record-retrieval', () => ({
  retrieveDocumentRecords: calls.retrieve,
  searchLibraryRecords: calls.librarySearch,
  selectLibraryRecordSnapshot: calls.selectLibrary,
  selectBoundedRecords: calls.bounded,
  buildRecordContextPrompt: vi.fn(() => ''),
}));
vi.mock('@/lib/mobile-bridge', () => ({ markMobileBridgeExportDirtyForDocument: vi.fn(async () => undefined) }));

let fixtureRoot = '';
let sessions: typeof import('@/lib/annot-sessions');

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'pagedock-chat-record-context-'));
  process.env.PAGEDOCK_ROOT = fixtureRoot;
  sessions = await import('@/lib/annot-sessions');
});
afterAll(async () => { await rm(fixtureRoot, { recursive: true, force: true }); });

async function send(folderPath: string, sessionId: string, recordLookup?: unknown) {
  const { POST } = await import('@/app/api/chat/route');
  const response = await POST(new NextRequest('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folderPath, sessionId, prompt: 'Explain oxide migration.', model: 'auto', sourceContext: { id: 'scope', scope: 'pdf', documentId: 'client-forged-document' }, ...(recordLookup !== undefined ? { recordLookup } : {}) }) }));
  if (response.status === 200) {
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) { /* synthetic provider stream */ }
  }
  return response;
}

describe('PDF record-aware chat API boundary', () => {
  test('default-off adds no record lookup or provider context', async () => {
    const session = await sessions.createSession('off', 'PDF session', { sessionKind: 'pdf', pdfPath: 'paper.pdf', documentId: 'doc-canonical' });
    await mkdir(path.join(fixtureRoot, 'off'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'off', 'paper.pdf'), '%PDF-synthetic');
    calls.retrieve.mockClear(); calls.runTurn.mockClear();
    const response = await send('off', session.id);
    expect(response.status).toBe(200);
    expect(calls.retrieve).not.toHaveBeenCalled();
    expect(calls.runTurn.mock.calls[0]?.[0]).toMatchObject({ recordContext: undefined });
  });

  test('only selected canonical IDs from the stored session document enter provider and persisted message', async () => {
    const session = await sessions.createSession('selected', 'PDF session', { sessionKind: 'pdf', pdfPath: 'renamed.pdf', documentId: 'doc-canonical' });
    await mkdir(path.join(fixtureRoot, 'selected'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'selected', 'renamed.pdf'), '%PDF-synthetic');
    await sessions.mutateSession('selected', session.id, (current) => ({ ...current, messages: [...current.messages, {
      id: 'old-turn', role: 'user', content: 'prior question', timestamp: '2026-10-02',
      recordContext: { scope: 'document', records: [{ id: 'old-excluded', title: 'old', originLabel: 'old', provenanceLabel: 'private', excerpt: 'must not be re-injected', sourceUpdatedAt: '' }], omittedCount: 0, omittedChars: 0 },
    }] }));
    calls.retrieve.mockClear(); calls.runTurn.mockClear();
    const response = await send('selected', session.id, { enabled: true, scope: 'document', page: 2,
      includeIds: ['reader:doc-canonical:h1'], snapshotHash: 'snapshot-current', records: [{ id: 'forged', excerpt: 'client-controlled data' }] });
    expect(response.status).toBe(200);
    expect(calls.retrieve).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-canonical', page: 2, includeIds: ['reader:doc-canonical:h1'] }));
    const providerInput = calls.runTurn.mock.calls[0]?.[0] as { recordContext?: { records: Array<{ id: string; excerpt: string }> }; conversation?: Array<{ content: string }> };
    expect(providerInput.recordContext?.records).toEqual([expect.objectContaining({ id: 'reader:doc-canonical:h1', excerpt: 'Canonical current source excerpt.' })]);
    expect(providerInput.conversation?.some((message) => message.content.includes('must not be re-injected'))).toBe(false);
    const saved = await sessions.getSession('selected', session.id);
    expect(saved?.messages.at(-2)).toMatchObject({ recordContext: { records: [expect.objectContaining({ id: 'reader:doc-canonical:h1' })] } });
    expect(JSON.stringify(saved?.messages.at(-2))).not.toContain('client-controlled data');
  });

  test('rejects a stale preview hash before calling the provider', async () => {
    const session = await sessions.createSession('stale-preview', 'PDF session', { sessionKind: 'pdf', pdfPath: 'paper.pdf', documentId: 'doc-canonical' });
    await mkdir(path.join(fixtureRoot, 'stale-preview'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'stale-preview', 'paper.pdf'), '%PDF-synthetic');
    calls.retrieve.mockClear(); calls.runTurn.mockClear();
    const response = await send('stale-preview', session.id, { enabled: true, scope: 'document',
      includeIds: ['reader:doc-canonical:h1'], snapshotHash: 'hash-from-old-preview' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('발췌가 달라졌습니다') });
    expect(calls.runTurn).not.toHaveBeenCalled();
  });

  test('rejects more than eight distinct selected IDs instead of silently truncating', async () => {
    const session = await sessions.createSession('too-many-records', 'PDF session', { sessionKind: 'pdf', pdfPath: 'paper.pdf', documentId: 'doc-canonical' });
    await mkdir(path.join(fixtureRoot, 'too-many-records'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'too-many-records', 'paper.pdf'), '%PDF-synthetic');
    calls.retrieve.mockClear(); calls.runTurn.mockClear();
    const response = await send('too-many-records', session.id, { enabled: true, scope: 'document',
      includeIds: Array.from({ length: 9 }, (_, index) => `reader:doc-canonical:h${index}`), snapshotHash: 'irrelevant' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('최대 8개') });
    expect(calls.retrieve).not.toHaveBeenCalled();
    expect(calls.runTurn).not.toHaveBeenCalled();
  });
});
