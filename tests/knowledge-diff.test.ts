import { describe, expect, test } from 'vitest';

import { diffKnowledgeLines } from '@/lib/knowledge-diff';

describe('knowledge proposal diff', () => {
  test('marks preserved, removed, and added lines', () => {
    const result = diffKnowledgeLines('같은 줄\n이전 줄', '같은 줄\n새 줄');
    expect(result).toEqual([
      { kind: 'same', text: '같은 줄' },
      { kind: 'removed', text: '이전 줄' },
      { kind: 'added', text: '새 줄' },
    ]);
  });

  test('collapses long unchanged sections around a focused change', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[10] = 'changed line';
    const result = diffKnowledgeLines(before.join('\n'), after.join('\n'));
    expect(result.some((line) => line.kind === 'omitted')).toBe(true);
    expect(result).toContainEqual({ kind: 'removed', text: 'line 10' });
    expect(result).toContainEqual({ kind: 'added', text: 'changed line' });
  });

  test('preserves common beginning and end in the large-document fallback', () => {
    const before = ['header', ...Array.from({ length: 8 }, (_, index) => `old ${index}`), 'footer'];
    const after = ['header', ...Array.from({ length: 8 }, (_, index) => `new ${index}`), 'footer'];
    const result = diffKnowledgeLines(before.join('\n'), after.join('\n'), 5);
    expect(result).toContainEqual({ kind: 'same', text: 'header' });
    expect(result).toContainEqual({ kind: 'same', text: 'footer' });
    expect(result).toContainEqual({ kind: 'removed', text: 'old 0' });
    expect(result).toContainEqual({ kind: 'added', text: 'new 0' });
  });
});
