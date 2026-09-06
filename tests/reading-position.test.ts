import { describe, expect, test } from 'vitest';

import { metadataUpdatesAffectSearchIndex } from '@/lib/paper-metadata';
import { normalizeReadingPosition } from '@/lib/reading-position';

describe('reading position normalization', () => {
  test('clamps invalid values into a portable safe fallback', () => {
    expect(normalizeReadingPosition({
      page: -1,
      pageOffsetRatio: 2,
      viewMode: 'invalid',
      updatedAt: 'bad date',
    })).toEqual({
      page: 1,
      pageOffsetRatio: 1,
      viewMode: 'scroll',
      updatedAt: new Date(0).toISOString(),
    });
  });

  test('round-trips a valid scroll location', () => {
    expect(normalizeReadingPosition({
      page: 137,
      pageOffsetRatio: 0.43,
      viewMode: 'scroll',
      updatedAt: '2026-08-31T12:00:00.000Z',
    })).toEqual({
      page: 137,
      pageOffsetRatio: 0.43,
      viewMode: 'scroll',
      updatedAt: '2026-08-31T12:00:00.000Z',
    });
  });
});

describe('metadata index boundary', () => {
  test('does not rebuild FTS for reading position and open-time updates', () => {
    expect(metadataUpdatesAffectSearchIndex({ readingPosition: { page: 1 }, lastOpenedAt: '2026-08-31T12:00:00.000Z' })).toBe(false);
    expect(metadataUpdatesAffectSearchIndex({ noteMarkdown: 'Searchable note' })).toBe(true);
  });
});
