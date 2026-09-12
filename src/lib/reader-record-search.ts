import { Highlight, HighlightStudyKind, VisualRegion } from '@/types';
import { inferStudyKind } from '@/lib/highlight-study';

export type ReaderStudyKindFilter = 'all' | HighlightStudyKind;

/** Keep the record search local, forgiving of Korean spacing, and deterministic. */
export function normalizeReaderSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s\u200B-\u200D\uFEFF]+/gu, '');
}

export function matchesReaderRecordSearch(
  query: string,
  values: readonly (string | null | undefined)[],
): boolean {
  const normalizedQuery = normalizeReaderSearchText(query);
  if (!normalizedQuery) return true;
  return values.some((value) => normalizeReaderSearchText(value).includes(normalizedQuery));
}

export function filterReaderHighlights(
  highlights: readonly Highlight[],
  query: string,
  studyKind: ReaderStudyKindFilter = 'all',
): Highlight[] {
  return highlights.filter((highlight) => (
    (studyKind === 'all' || inferStudyKind(highlight) === studyKind)
    && matchesReaderRecordSearch(query, [highlight.text, highlight.note])
  ));
}

export function filterReaderVisualRegions(
  regions: readonly VisualRegion[],
  query: string,
): VisualRegion[] {
  return regions.filter((region) => matchesReaderRecordSearch(query, [region.memo]));
}

export function countReaderStudyKinds(
  highlights: readonly Highlight[],
): Record<HighlightStudyKind, number> {
  const counts: Record<HighlightStudyKind, number> = {
    important: 0,
    concept: 0,
    memorize: 0,
    question: 0,
    unclear: 0,
  };
  highlights.forEach((highlight) => {
    counts[inferStudyKind(highlight)] += 1;
  });
  return counts;
}

export const MAX_READER_RECORD_RESULTS = 50;

export interface BoundedReaderRecordResults<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export function boundReaderRecordResults<T>(
  records: readonly T[],
  limit = MAX_READER_RECORD_RESULTS,
): BoundedReaderRecordResults<T> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MAX_READER_RECORD_RESULTS;
  return {
    items: records.slice(0, safeLimit),
    total: records.length,
    hasMore: records.length > safeLimit,
  };
}
