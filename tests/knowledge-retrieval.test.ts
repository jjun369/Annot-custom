import { describe, expect, test } from 'vitest';

import { buildKnowledgeReaderUrl, buildKnowledgeSourceReaderUrl, findKnowledgeReaderTarget, parseKnowledgeReaderNavigation, searchKnowledgeRecords } from '@/lib/knowledge-retrieval';
import type { KnowledgeSnapshot } from '@/lib/knowledge-store';
import type { TreeNode } from '@/types';

const fixture: KnowledgeSnapshot = {
  version: 2,
  notes: [{
    id: 'source-1', rawText: 'A field note about display yield under warm operating conditions.',
    sourceName: 'lab-notes.md', contentHash: 'hash', title: 'Warm display yield',
    summary: 'Observed at elevated temperature.', status: 'inbox',
    provenance: { kind: 'work_observation' },
    sourceAnchors: [{
      id: 'anchor-1', scope: 'selection', documentId: 'doc-1', page: 12,
      text: 'The display yield decreased after the panel exceeded 80 C.',
      rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.03 }],
    }],
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  }],
  topics: [{
    id: 'topic-1', slug: 'display-yield', title: 'Display yield', summary: 'Thermal relationship',
    bodyMarkdown: 'Yield is reduced above the warm threshold.', sourceNoteIds: ['source-1'],
    revision: 2, revisions: [], createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  }],
  reviews: [], conflicts: [],
};

const tree: TreeNode = {
  id: 'root', name: 'Library', type: 'folder', path: '', children: [{
    id: 'document:doc-1', documentId: 'doc-1', name: 'renamed paper.pdf', type: 'pdf', path: '논문 폴더/a #1.pdf',
  }],
};

describe('Knowledge retrieval', () => {
  test('finds unprocessed source note text and its provenance while preserving topic search', () => {
    const sourceResults = searchKnowledgeRecords(fixture, 'decreased panel', 'all');
    expect(sourceResults).toHaveLength(1);
    expect(sourceResults[0]).toMatchObject({ kind: 'source', id: 'source-1', detail: expect.stringContaining('업무 관찰'), preview: expect.stringContaining('decreased') });

    const topicResults = searchKnowledgeRecords(fixture, 'warm threshold', 'topics');
    expect(topicResults).toHaveLength(1);
    expect(topicResults[0]).toMatchObject({ kind: 'topic', id: 'topic-1' });
    expect(searchKnowledgeRecords(fixture, 'work observation', 'work_observation')).toHaveLength(1);
  });

  test('resolves current renamed PDF by stable document id and encodes Korean paths and query characters', () => {
    const target = findKnowledgeReaderTarget(tree, 'doc-1', 12);
    expect(target).toEqual({ path: '논문 폴더/a #1.pdf', page: 12, documentId: 'doc-1' });
    const url = buildKnowledgeReaderUrl(target)!;
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.searchParams.get('pdf')).toBe('논문 폴더/a #1.pdf');
    expect(parsed.searchParams.get('page')).toBe('12');
    expect(parsed.searchParams.get('doc')).toBe('doc-1');
    const legacyUrl = new URL(buildKnowledgeReaderUrl({ path: 'legacy.pdf', page: 3 })!, 'http://localhost');
    expect(legacyUrl.searchParams.get('page')).toBe('3');
    expect(legacyUrl.searchParams.has('doc')).toBe(false);
    expect(legacyUrl.searchParams.has('focus')).toBe(false);
  });

  test('carries bounded saved rectangles and parses the exact-focus handoff', () => {
    const rects = [
      { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
      { x: 0.61, y: 0.2, width: 0.2, height: 0.03 },
    ];
    const url = buildKnowledgeSourceReaderUrl(tree, { documentId: 'doc-1', page: 12, rects });
    expect(url).not.toBeNull();
    const parsedUrl = new URL(url!, 'http://localhost');
    expect(parsedUrl.searchParams.has('text')).toBe(false);
    expect(parseKnowledgeReaderNavigation(parsedUrl.search)).toEqual({ documentId: 'doc-1', page: 12, rects });
  });

  test('drops invalid/stale rect focus but preserves a safe page-only return', () => {
    const invalidRectTarget = findKnowledgeReaderTarget(tree, 'doc-1', 12, [{ x: 0.9, y: 0.2, width: 0.5, height: 0.1 }]);
    expect(invalidRectTarget).toEqual({ path: '논문 폴더/a #1.pdf', page: 12, documentId: 'doc-1' });
    expect(parseKnowledgeReaderNavigation('?doc=doc-1&page=12&focus=%5Bbroken')?.rects).toBeUndefined();
    expect(parseKnowledgeReaderNavigation('?doc=doc-1&page=12&focus=%5B%7B%22x%22%3A-1%7D%5D')?.rects).toBeUndefined();
    expect(findKnowledgeReaderTarget(tree, 'doc-1', 12, Array.from({ length: 9 }, () => ({ x: 0.1, y: 0.2, width: 0.1, height: 0.03 }))))
      .toEqual({ path: '논문 폴더/a #1.pdf', page: 12, documentId: 'doc-1' });
    expect(parseKnowledgeReaderNavigation('?doc=doc-1&page=12&focus=%5B%7B%22x%22%3A0%2C%22y%22%3A0%2C%22width%22%3A0.1%2C%22height%22%3A0.1%7D%5D')?.rects).toEqual([
      { x: 0, y: 0, width: 0.1, height: 0.1 },
    ]);
    expect(parseKnowledgeReaderNavigation('?doc=doc-1&page=0')).toBeNull();
    expect(parseKnowledgeReaderNavigation('?doc=doc-1&page=100001')).toBeNull();
    expect(buildKnowledgeSourceReaderUrl(tree, { documentId: 'missing-doc', page: 12 })).toBeNull();
  });

  test('returns a clear missing target for moved-out or invalid anchors', () => {
    expect(findKnowledgeReaderTarget(tree, 'missing-doc', 12)).toBeNull();
    expect(findKnowledgeReaderTarget(tree, 'doc-1', undefined)).toBeNull();
    expect(buildKnowledgeReaderUrl(null)).toBeNull();
  });
});
