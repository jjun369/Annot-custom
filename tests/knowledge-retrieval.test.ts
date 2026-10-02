import { describe, expect, test } from 'vitest';

import { buildKnowledgeReaderUrl, findKnowledgeReaderTarget, searchKnowledgeRecords } from '@/lib/knowledge-retrieval';
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
    expect(target).toEqual({ path: '논문 폴더/a #1.pdf', page: 12 });
    const url = buildKnowledgeReaderUrl(target)!;
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.searchParams.get('pdf')).toBe('논문 폴더/a #1.pdf');
    expect(parsed.searchParams.get('page')).toBe('12');
  });

  test('returns a clear missing target for moved-out or invalid anchors', () => {
    expect(findKnowledgeReaderTarget(tree, 'missing-doc', 12)).toBeNull();
    expect(findKnowledgeReaderTarget(tree, 'doc-1', undefined)).toBeNull();
    expect(buildKnowledgeReaderUrl(null)).toBeNull();
  });
});
