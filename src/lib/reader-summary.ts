import { Highlight, ReaderSummary, ReadingPosition } from '@/types';
import { isUnresolvedHighlight } from '@/lib/highlight-study';
import { selectWorkEvidenceGroups } from '@/lib/work-evidence';

export function deriveReaderSummary(
  readingPosition: ReadingPosition | undefined,
  highlights: readonly Highlight[],
  lastOpenedAt?: string,
): ReaderSummary {
  return {
    page: readingPosition?.page,
    unresolvedCount: highlights.filter((highlight) => isUnresolvedHighlight(highlight)).length,
    openWorkCount: selectWorkEvidenceGroups(highlights).openFollowUps.length,
    ...(lastOpenedAt ? { lastOpenedAt } : {}),
  };
}

/**
 * This deliberately formats an existing activity timestamp only for the
 * Library surface. It does not infer reading completion or create any new
 * persistent state.
 */
export function formatReaderSummaryActivity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} 읽음`;
}
