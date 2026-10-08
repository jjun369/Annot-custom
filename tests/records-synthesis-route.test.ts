import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixtures = vi.hoisted(() => ({
  selectSnapshot: vi.fn(),
  createDraft: vi.fn(),
  searchRecords: vi.fn(async () => []),
}));

vi.mock('@/lib/annot-sessions', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/ai-providers', () => ({ getProviderRuntime: vi.fn() }));
vi.mock('@/lib/ai-providers/model-policy', () => ({ normalizeModelPreference: vi.fn(() => 'auto') }));
vi.mock('@/lib/ai-providers/reasoning-policy', () => ({ normalizeReasoningEffort: vi.fn(() => 'auto') }));
vi.mock('@/lib/concept-synthesis-prompt', () => ({ buildConceptSynthesisPrompt: vi.fn(() => 'prompt') }));
vi.mock('@/lib/record-retrieval', () => ({
  previewLibraryRecords: vi.fn(() => ({ records: [], totalCount: 0, omittedCount: 0 })), retrieveDocumentRecords: vi.fn(), searchLibraryRecords: fixtures.searchRecords, selectBoundedRecords: vi.fn(),
  selectLibraryRecordSnapshot: fixtures.selectSnapshot,
}));
vi.mock('@/lib/sources-studio', () => ({ createStudioDraft: fixtures.createDraft }));

import { POST } from '@/app/api/records/route';

const question = 'Why do these two records disagree?';
const recordIds = ['memo:alpha', 'reader:doc-a:annotation-1'];
const snapshot = {
  scope: 'library' as const,
  snapshotHash: 'approved-hash',
  omittedCount: 0,
  omittedChars: 0,
  records: [
    { id: 'memo:alpha', title: 'Memo', originLabel: 'Personal memo', provenanceLabel: 'Hypothesis', excerpt: 'Server-owned memo excerpt', sourceUpdatedAt: '2026-10-07' },
    { id: 'reader:doc-a:annotation-1', title: 'Paper · p.1', originLabel: 'Reader', provenanceLabel: 'Literature claim', excerpt: 'Server-owned Reader excerpt', sourceUpdatedAt: '2026-10-06', anchor: { id: 'anchor', scope: 'page' as const, documentId: 'doc-a', page: 1 } },
  ],
};

function request(snapshotHash = 'approved-hash', includeStudioDrafts = false, selectedIds = recordIds) {
  return new NextRequest('http://localhost/api/records', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'save-synthesis-draft', question, recordIds: selectedIds, snapshotHash, content: 'An editable synthesis proposal.', includeStudioDrafts }),
  });
}

function librarySearchRequest(includeStudioDrafts?: boolean) {
  return new NextRequest('http://localhost/api/records', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'library-search', query: 'prior synthesis', ...(includeStudioDrafts === undefined ? {} : { includeStudioDrafts }) }),
  });
}

describe('synthesis draft freshness boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.selectSnapshot.mockResolvedValue(snapshot);
    fixtures.createDraft.mockResolvedValue({ id: 'draft-new' });
    fixtures.searchRecords.mockResolvedValue([]);
  });

  test('keeps Studio drafts out of synthesis search unless the explicit opt-in is true', async () => {
    expect((await POST(librarySearchRequest())).status).toBe(200);
    expect(fixtures.searchRecords).toHaveBeenLastCalledWith('prior synthesis', { includeStudioDrafts: false });

    expect((await POST(librarySearchRequest(true))).status).toBe(200);
    expect(fixtures.searchRecords).toHaveBeenLastCalledWith('prior synthesis', { includeStudioDrafts: true });
  });

  test('creates a new Studio draft using only the fresh server-resolved source snapshots', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(fixtures.selectSnapshot).toHaveBeenCalledWith(question, recordIds, { includeStudioDrafts: false });
    expect(fixtures.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      title: `개념 정리 · ${question}`,
      text: 'An editable synthesis proposal.',
      references: [
        expect.objectContaining({ sourceId: 'memo:alpha', excerpt: 'Server-owned memo excerpt', includeInRequest: false }),
        expect.objectContaining({ sourceId: 'reader:doc-a:annotation-1', excerpt: 'Server-owned Reader excerpt', includeInRequest: false,
          evidenceSnapshot: expect.objectContaining({ anchor: snapshot.records[1].anchor }) }),
      ],
    }));
    expect((await response.json()).draft.id).toBe('draft-new');
  });

  test('resolves an explicitly selected saved draft only when synthesis draft search is enabled', async () => {
    const draftId = 'studio-draft:prior';
    const draftSnapshot = { ...snapshot, records: [{ id: draftId, title: 'Prior synthesis', originLabel: 'Studio 저장 초안 · 로컬 작업물',
      provenanceLabel: 'Studio 초안 · Knowledge 미게시 · 미검증 · 문헌 근거 아님', excerpt: 'Prior working interpretation.', sourceUpdatedAt: '2026-10-07' }] };
    fixtures.selectSnapshot.mockResolvedValue(draftSnapshot);
    const response = await POST(request('approved-hash', true, [draftId]));

    expect(response.status).toBe(201);
    expect(fixtures.selectSnapshot).toHaveBeenCalledWith(question, [draftId], { includeStudioDrafts: true });
    expect(fixtures.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      references: [expect.objectContaining({ sourceId: draftId, originLabel: 'Studio 저장 초안 · 로컬 작업물',
        evidenceSnapshot: expect.objectContaining({ provenanceLabel: expect.stringContaining('미검증') }) })],
    }));
  });

  test('rejects a source edit after generation and creates no draft', async () => {
    fixtures.selectSnapshot.mockResolvedValue({ ...snapshot, snapshotHash: 'edited-source-hash' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('미리보기 이후 기록이 달라졌습니다') });
    expect(fixtures.createDraft).not.toHaveBeenCalled();
  });

  test('rejects selected IDs that no longer resolve, before considering a client payload', async () => {
    fixtures.selectSnapshot.mockResolvedValue({ ...snapshot, records: [snapshot.records[0]] });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(fixtures.createDraft).not.toHaveBeenCalled();
  });
});
