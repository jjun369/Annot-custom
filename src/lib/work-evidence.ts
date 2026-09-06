import { Highlight } from '@/types';
import { isWorkActionKind, isWorkDone, isWorkHighlight } from '@/lib/highlight-work';

export interface WorkEvidenceGroups<T extends Highlight = Highlight> {
  findings: T[];
  openFollowUps: T[];
  completedFollowUps: T[];
}

/**
 * Splits already ordered highlights into the three work-evidence meanings.
 * It deliberately does not sort: callers keep their source-order contract.
 */
export function selectWorkEvidenceGroups<T extends Highlight>(
  highlights: readonly T[],
): WorkEvidenceGroups<T> {
  const findings: T[] = [];
  const openFollowUps: T[] = [];
  const completedFollowUps: T[] = [];

  highlights.forEach((highlight) => {
    if (!isWorkHighlight(highlight)) return;
    if (highlight.workKind === 'finding') {
      findings.push(highlight);
      return;
    }
    if (!isWorkActionKind(highlight.workKind)) return;
    if (isWorkDone(highlight)) {
      completedFollowUps.push(highlight);
    } else {
      openFollowUps.push(highlight);
    }
  });

  return { findings, openFollowUps, completedFollowUps };
}
