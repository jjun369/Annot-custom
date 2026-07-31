import { describe, expect, test } from 'vitest';

import { buildKnowledgeCandidateContext } from '@/lib/knowledge-ai';
import type { KnowledgeTopic } from '@/lib/knowledge-store';

function topic(id: string, bodyMarkdown: string): KnowledgeTopic {
  return {
    id,
    slug: id,
    title: `Topic ${id}`,
    summary: 'summary',
    bodyMarkdown,
    sourceNoteIds: [],
    revision: 1,
    revisions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('knowledge candidate context', () => {
  test('marks truncation and preserves both ends of a long topic', () => {
    const body = `BEGIN-${'x'.repeat(7_000)}-END`;
    const context = buildKnowledgeCandidateContext([topic('long', body)]);
    expect(context.truncatedTopicIds).toEqual(['long']);
    expect(context.text).toContain('CONTEXT_TRUNCATED: yes');
    expect(context.text).toContain('BEGIN-');
    expect(context.text).toContain('-END');
    expect(context.text).toContain('가운데 내용 일부 생략');
    expect(context.text.length).toBeLessThanOrEqual(36_000);
  });

  test('never exceeds the total context ceiling with many long topics', () => {
    const topics = Array.from({ length: 8 }, (_, index) => topic(`long-${index}`, 'x'.repeat(10_000)));
    const context = buildKnowledgeCandidateContext(topics);
    expect(context.text.length).toBeLessThanOrEqual(36_000);
    expect(context.truncatedTopicIds.length + context.omittedTopicIds.length).toBeGreaterThan(0);
  });
});
