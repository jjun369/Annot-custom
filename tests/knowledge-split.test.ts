import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_SPLIT_MAX,
  KNOWLEDGE_SPLIT_PREVIEW_THRESHOLD,
  splitKnowledgeText,
} from '@/lib/knowledge-split';

describe('knowledge text splitting', () => {
  test('keeps short notes as one segment', () => {
    const result = splitKnowledgeText('  제목\n\n짧은 메모  ');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('제목\n\n짧은 메모');
    expect(result.warnings).toEqual([]);
  });

  test('uses headings and paragraphs for a long note', () => {
    const result = splitKnowledgeText(Array.from({ length: 4 }, (_, index) => `## 주제 ${index + 1}\n\n${'내용 '.repeat(4_500)}`).join('\n\n'));
    expect(result.normalizedText.length).toBeGreaterThan(KNOWLEDGE_SPLIT_PREVIEW_THRESHOLD);
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments.every((segment) => segment.text.length <= KNOWLEDGE_SPLIT_MAX)).toBe(true);
    expect(result.segments.map((segment) => segment.title)).toContain('주제 1');
  });

  test('hard-splits a single oversized paragraph and warns', () => {
    const result = splitKnowledgeText('x'.repeat(KNOWLEDGE_SPLIT_MAX * 2 + 1));
    expect(result.segments.length).toBeGreaterThan(2);
    expect(result.segments.every((segment) => segment.text.length <= KNOWLEDGE_SPLIT_MAX)).toBe(true);
    expect(result.segments.some((segment) => segment.hardSplit)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('preserves non-whitespace content order', () => {
    const source = `## A\n\n${'alpha '.repeat(5_000)}\n\n## B\n\n${'beta '.repeat(5_000)}`;
    const result = splitKnowledgeText(source);
    const compact = (value: string) => value.replace(/\s+/g, '');
    expect(compact(result.segments.map((segment) => segment.text).join('\n')).startsWith(compact(result.normalizedText).slice(0, 100))).toBe(true);
    expect(compact(result.segments.map((segment) => segment.text).join('\n'))).toBe(compact(result.normalizedText));
  });
});
