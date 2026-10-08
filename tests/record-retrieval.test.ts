import { describe, expect, test, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  highlightReads: vi.fn(async () => [{ id: 'h-1', annotationId: 'annotation-1', documentId: 'doc-a', pdfPath: 'a.pdf', page: 1,
    type: 'important', studyKind: 'concept', text: 'oxide migration mechanism', note: 'my hypothesis about interface traps',
    rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }], position: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, updatedAt: '2026-10-01' }]),
  regionReads: vi.fn(async () => [{ id: 'region-1', documentId: 'doc-a', page: 2, kind: 'figure', memo: 'oxide migration diagram notes', rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, updatedAt: '2026-10-02' }]),
  knowledge: {
    version: 2,
    notes: [{ id: 'note-1', rawText: 'OLD oxide migration memo', title: 'old', sourceName: 'old', updatedAt: '2026-09-01',
      provenance: { kind: 'personal_hypothesis' }, sourceAnchors: [{ id: 'anchor-1', scope: 'selection', documentId: 'doc-a', page: 2, text: 'oxide migration', rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }] }] }],
    topics: [], reviews: [], conflicts: [],
  },
  studio: { drafts: [
    { id: 'prior-synthesis', title: 'Oxide migration synthesis', text: 'oxide migration synthesis from an earlier study; recheck the source before relying on it', revision: 2,
      createdAt: '2026-10-01', updatedAt: '2026-10-04', references: [
        { sourceId: 'reader:doc-b:annotation-1', title: 'Other paper', kind: 'memo', originLabel: 'Reader', sourceUpdatedAt: '2026-10-01', excerpt: 'other paper', includeInRequest: false,
          evidenceSnapshot: { provenanceLabel: 'literature claim', anchor: { id: 'b', scope: 'selection', documentId: 'doc-b', page: 3, text: 'oxide migration', rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }] } } },
        { sourceId: 'reader:doc-a:annotation-2', title: 'Paper A', kind: 'memo', originLabel: 'Reader', sourceUpdatedAt: '2026-10-02', excerpt: 'oxide migration', includeInRequest: false,
          evidenceSnapshot: { provenanceLabel: 'literature claim', anchor: { id: 'a', scope: 'selection', documentId: 'doc-a', page: 2, text: 'oxide migration', rects: [{ x: 0.2, y: 0.2, width: 0.2, height: 0.1 }] } } },
      ] },
    { id: 'unanchored-draft', title: 'Free-standing oxide notes', text: 'oxide migration idea without a PDF reference', revision: 1,
      createdAt: '2026-10-02', updatedAt: '2026-10-02', references: [] },
  ], warnings: [], sources: [
    { id: 'knowledge:note-1', origin: 'knowledge', recordId: 'note-1', kind: 'memo', title: 'edited memo',
      originalText: 'OLD oxide migration memo', text: 'CURRENT edited oxide migration memo', tags: [], originLabel: '개인 가설',
      sourceUpdatedAt: '2026-10-02', updatedAt: '2026-10-02', ownsText: true,
      readerTargets: [{ documentId: 'doc-a', page: 2, rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }] }] },
    { id: 'memo:free', origin: 'knowledge', recordId: 'free', kind: 'memo', title: 'Free memo', originalText: '',
      text: 'oxide migration personal note', tags: [], originLabel: 'personal', sourceUpdatedAt: '2026-10-02', updatedAt: '2026-10-02', ownsText: true },
  ] },
}));

vi.mock('@/lib/highlight-sidecar', () => ({
  listSidecarHighlights: (filePath: string) => { void filePath; return fixtures.highlightReads(); },
  listSidecarVisualRegions: (filePath: string) => { void filePath; return fixtures.regionReads(); },
}));
vi.mock('@/lib/research-db', () => ({
  getDocumentById: vi.fn(async (id: string) => id === 'doc-a' ? { id, currentPath: 'a.pdf', missing: false, displayTitle: 'Paper A' } : null),
  listDocuments: vi.fn(async () => [{ id: 'doc-a', currentPath: 'a.pdf', missing: false, displayTitle: 'Paper A' }]),
}));
vi.mock('@/lib/knowledge-store', () => ({ getKnowledgeSnapshot: vi.fn(async () => fixtures.knowledge) }));
vi.mock('@/lib/sources-studio', () => ({ getStudioSnapshot: vi.fn(async () => fixtures.studio) }));

import { excerptFor, previewLibraryRecords, retrieveDocumentRecords, searchLibraryRecords, selectBoundedRecords, selectLibraryRecordSnapshot } from '@/lib/record-retrieval';

describe('bounded local record retrieval', () => {
  test('search previews center the query term and disclose how many ranked results are hidden', () => {
    const candidate = { id: 'memo:late-hit', title: 'Synthetic memo', originLabel: 'personal', provenanceLabel: 'hypothesis',
      text: `${'unrelated opening text '.repeat(35)}thermal budget near the end`, sourceUpdatedAt: '', kind: 'personal' as const };
    const preview = previewLibraryRecords('thermal budget', [candidate, { ...candidate, id: 'memo:second' }], 1);
    expect(preview.records).toHaveLength(1);
    expect(preview.records[0].excerpt).toContain('thermal budget');
    expect(preview.records[0].excerpt.startsWith('…')).toBe(true);
    expect(preview).toMatchObject({ totalCount: 2, omittedCount: 1 });
    expect(excerptFor('', candidate.text, 20)).toMatch(/^unrelated/);
  });

  test('uses stable document scope, honors page, and prefers the edited personal memo over captured raw text', async () => {
    const pageOne = await retrieveDocumentRecords({ documentId: 'doc-a', query: 'oxide migration', page: 1 });
    expect(pageOne.records.map((record) => record.id)).toContain('reader:doc-a:annotation-1');
    expect(pageOne.records.some((record) => record.anchor?.page === 2)).toBe(false);
    const pageTwo = await retrieveDocumentRecords({ documentId: 'doc-a', query: 'oxide migration', page: 2 });
    expect(pageTwo.records).toContainEqual(expect.objectContaining({ id: 'knowledge:note-1', excerpt: expect.stringContaining('CURRENT edited') }));
    expect(pageTwo.records.some((record) => record.excerpt.includes('OLD oxide migration memo'))).toBe(false);
    expect(pageTwo.records.some((record) => record.provenanceLabel === '개인 가설')).toBe(true);
  });

  test('retrieves cross-library notes and visual-region text, never image bytes', async () => {
    const results = await searchLibraryRecords('oxide migration');
    expect(results.some((record) => record.id === 'region:doc-a:region-1' && record.text === 'oxide migration diagram notes')).toBe(true);
    expect(results.some((record) => record.id === 'memo:free')).toBe(true);
    expect(results.some((record) => record.text.includes('OLD oxide migration memo'))).toBe(false);
  });

  test('keeps saved Studio drafts opt-in for synthesis search and labels them as unverified working material', async () => {
    const existingResults = await searchLibraryRecords('oxide migration');
    expect(existingResults.some((record) => record.id.startsWith('studio-draft:'))).toBe(false);

    const withDrafts = await searchLibraryRecords('oxide migration', { includeStudioDrafts: true });
    expect(withDrafts).toContainEqual(expect.objectContaining({
      id: 'studio-draft:prior-synthesis',
      originLabel: 'Studio 저장 초안 · 로컬 작업물',
      provenanceLabel: 'Studio 초안 · Knowledge 미게시 · 미검증 · 문헌 근거 아님',
      text: expect.stringContaining('recheck the source'),
      kind: 'studio-draft',
    }));
    expect(withDrafts.some((record) => record.id === 'studio-draft:unanchored-draft')).toBe(true);

    const hiddenFromCanonicalResolution = await selectLibraryRecordSnapshot('oxide migration', ['studio-draft:prior-synthesis']);
    const selected = await selectLibraryRecordSnapshot('oxide migration', ['studio-draft:prior-synthesis'], { includeStudioDrafts: true });
    expect(hiddenFromCanonicalResolution.records).toHaveLength(0);
    expect(selected.records).toHaveLength(1);
    expect(selected.records[0]).toMatchObject({ id: 'studio-draft:prior-synthesis' });
    expect(selected.records[0]).not.toHaveProperty('anchor');
    expect(selected.snapshotHash).toBeTruthy();
  });

  test('current-PDF retrieval finds a saved draft through any matching saved reference anchor without presenting it as the PDF source', async () => {
    const pageOne = await retrieveDocumentRecords({ documentId: 'doc-a', query: 'oxide migration', page: 1 });
    const pageTwo = await retrieveDocumentRecords({ documentId: 'doc-a', query: 'oxide migration', page: 2 });
    const otherDocument = await retrieveDocumentRecords({ documentId: 'doc-a', query: 'oxide migration', page: 3 });

    expect(pageOne.records.some((record) => record.id === 'studio-draft:prior-synthesis')).toBe(false);
    expect(pageTwo.records).toContainEqual(expect.objectContaining({
      id: 'studio-draft:prior-synthesis',
      provenanceLabel: 'Studio 초안 · Knowledge 미게시 · 미검증 · 문헌 근거 아님',
    }));
    expect(pageTwo.records.find((record) => record.id === 'studio-draft:prior-synthesis')).not.toHaveProperty('anchor');
    expect(otherDocument.records.some((record) => record.id === 'studio-draft:prior-synthesis')).toBe(false);
    expect(pageTwo.records.some((record) => record.id === 'studio-draft:unanchored-draft')).toBe(false);
  });

  test('resolves explicitly selected canonical IDs independently of the new question keywords', async () => {
    const firstSearch = await searchLibraryRecords('oxide migration');
    expect(firstSearch.some((record) => record.id === 'memo:free')).toBe(true);
    const preparedForDifferentQuestion = await selectLibraryRecordSnapshot('thermal cycling reliability', ['memo:free']);
    expect(preparedForDifferentQuestion.records.map((record) => record.id)).toEqual(['memo:free']);
    expect(preparedForDifferentQuestion.records[0].excerpt).toContain('oxide migration personal note');
    expect(preparedForDifferentQuestion.records.reduce((sum, record) => sum + record.excerpt.length, 0)).toBeLessThanOrEqual(8_000);
  });

  test('keeps explicit ID order and does not trust client-supplied excerpt text for preview resolution', async () => {
    const snapshot = await selectLibraryRecordSnapshot('unrelated new question', ['memo:free', 'knowledge:note-1']);
    expect(snapshot.records.map((record) => record.id)).toEqual(['memo:free', 'knowledge:note-1']);
    expect(snapshot.records[0].excerpt).toContain('oxide migration personal note');
    expect(snapshot.records[1].excerpt).toContain('CURRENT edited');
  });

  test('exclusions resolve against canonical ids and text stays within item/total bounds', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      id: `memo:${index}`, title: `oxide note ${index}`, originLabel: 'synthetic', provenanceLabel: 'personal hypothesis',
      text: `oxide migration ${String(index).padStart(2, '0')} ` + 'x'.repeat(2_500), sourceUpdatedAt: '', kind: 'personal' as const,
    }));
    const selected = selectBoundedRecords('oxide migration', candidates, { scope: 'library', includeIds: ['memo:0', 'memo:1', 'memo:2', 'memo:3', 'not-canonical'], limit: 3, totalChars: 700 });
    expect(selected.scope).toBe('library');
    expect(selected.records.map((record) => record.id)).toEqual(['memo:0', 'memo:1', 'memo:2']);
    expect(selected.records.every((record) => record.excerpt.length <= 1_600)).toBe(true);
    expect(selected.records.reduce((total, record) => total + record.excerpt.length, 0)).toBeLessThanOrEqual(700);
    expect(selected.omittedCount).toBe(1);
  });
});
