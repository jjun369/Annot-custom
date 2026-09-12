import { describe, expect, test } from 'vitest';

import {
  boundReaderRecordResults,
  countReaderStudyKinds,
  filterReaderHighlights,
  filterReaderVisualRegions,
  normalizeReaderSearchText,
} from '@/lib/reader-record-search';
import { Highlight, VisualRegion } from '@/types';

const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.04 };

function highlight(id: string, overrides: Partial<Highlight> = {}): Highlight {
  return {
    id,
    pdfPath: 'synthetic-study.pdf',
    page: 1,
    type: 'important',
    text: '기본 원문',
    position: rect,
    ...overrides,
  };
}

function visualRegion(id: string, memo: string): VisualRegion {
  return {
    id,
    documentId: 'synthetic-document',
    page: 1,
    rect,
    kind: 'figure',
    memo,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('Reader record search', () => {
  test('normalizes Korean spacing and Unicode compatibility forms locally', () => {
    expect(normalizeReaderSearchText('  공정　조건 ①A  ')).toBe('공정조건1a');
  });

  test('searches highlight text and memo while preserving source order', () => {
    const records = [
      highlight('text', { text: '공정 조건과 전류 밀도' }),
      highlight('memo', { text: '다른 원문', note: '공정 조건을 다시 확인' }),
      highlight('miss', { text: '무관한 기록', note: '메모 없음' }),
    ];

    expect(filterReaderHighlights(records, '공정조건').map((record) => record.id))
      .toEqual(['text', 'memo']);
    expect(filterReaderHighlights(records, '전류', 'important').map((record) => record.id))
      .toEqual(['text']);
  });

  test('filters semantic kinds through legacy inference and counts them', () => {
    const records = [
      highlight('important'),
      highlight('concept', { studyKind: 'concept' }),
      highlight('question', { type: 'unknown', studyKind: 'question' }),
      highlight('legacy-unclear', { type: 'unknown' }),
    ];

    expect(filterReaderHighlights(records, '', 'unclear').map((record) => record.id))
      .toEqual(['legacy-unclear']);
    expect(countReaderStudyKinds(records)).toEqual({
      important: 1,
      concept: 1,
      memorize: 0,
      question: 1,
      unclear: 1,
    });
  });

  test('searches only visual memos and returns a bounded result window', () => {
    const regions = [
      visualRegion('first', '공정 조건 메모'),
      visualRegion('second', '표의 수치'),
    ];

    expect(filterReaderVisualRegions(regions, '공정조건').map((region) => region.id))
      .toEqual(['first']);
    expect(filterReaderVisualRegions([visualRegion('text-only', '')], '그림')).toEqual([]);
    expect(boundReaderRecordResults(['a', 'b', 'c'], 2)).toEqual({
      items: ['a', 'b'],
      total: 3,
      hasMore: true,
    });
  });
});
