import { Highlight, HighlightWorkKind } from '@/types';

const WORK_KINDS: readonly HighlightWorkKind[] = ['finding', 'verify', 'discuss', 'try'];

export function isHighlightWorkKind(value: unknown): value is HighlightWorkKind {
  return typeof value === 'string' && WORK_KINDS.includes(value as HighlightWorkKind);
}

export function isWorkActionKind(kind: HighlightWorkKind | undefined): boolean {
  return kind === 'verify' || kind === 'discuss' || kind === 'try';
}

export function normalizeWorkDoneAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

export function getWorkKindLabel(kind: HighlightWorkKind): string {
  switch (kind) {
    case 'finding':
      return 'Finding';
    case 'verify':
      return 'Verify';
    case 'discuss':
      return 'Discuss';
    case 'try':
      return 'Try';
  }
}

export function getWorkNotePlaceholder(kind: HighlightWorkKind | undefined): string {
  switch (kind) {
    case 'finding':
      return '이 근거가 우리 제품·공정·설계에 의미하는 점...';
    case 'verify':
      return '추가로 확인할 데이터, 문헌 또는 조건...';
    case 'discuss':
      return '동료 또는 회의에서 확인할 점...';
    case 'try':
      return '실제로 검토하거나 시도해 볼 일...';
    default:
      return '이 하이라이트에 메모를 추가하세요...';
  }
}

export function isWorkHighlight(highlight: Pick<Highlight, 'workKind'>): boolean {
  return isHighlightWorkKind(highlight.workKind);
}

export function isWorkDone(highlight: Pick<Highlight, 'workKind' | 'workDoneAt'>): boolean {
  return isWorkActionKind(highlight.workKind) && Boolean(normalizeWorkDoneAt(highlight.workDoneAt));
}

export function getWorkStatusLabel(highlight: Pick<Highlight, 'workKind' | 'workDoneAt'>): string | undefined {
  if (!isHighlightWorkKind(highlight.workKind)) return undefined;
  if (!isWorkActionKind(highlight.workKind)) return undefined;
  return isWorkDone(highlight) ? 'DONE' : 'OPEN';
}

/**
 * Keeps work classification independent from study resolved state. A changed
 * kind (including removing Work) always starts without a carried-over done
 * timestamp; Finding never has a done state.
 */
export function applyWorkKind<T extends Pick<Highlight, 'workKind' | 'workDoneAt'>>(
  highlight: T,
  workKind: HighlightWorkKind | undefined,
): T {
  const changed = highlight.workKind !== workKind;
  const keepDoneAt = !changed && isWorkActionKind(workKind)
    ? normalizeWorkDoneAt(highlight.workDoneAt)
    : undefined;

  return {
    ...highlight,
    workKind,
    workDoneAt: keepDoneAt,
  } as T;
}

export function applyWorkDoneAt<T extends Pick<Highlight, 'workKind' | 'workDoneAt'>>(
  highlight: T,
  workDoneAt: string | undefined,
): T {
  return {
    ...highlight,
    workDoneAt: isWorkActionKind(highlight.workKind)
      ? normalizeWorkDoneAt(workDoneAt)
      : undefined,
  } as T;
}

export function compareWorkHighlights(a: Highlight, b: Highlight): number {
  const group = (highlight: Highlight): number => {
    if (isWorkActionKind(highlight.workKind)) return isWorkDone(highlight) ? 2 : 0;
    return 1;
  };
  const groupDifference = group(a) - group(b);
  if (groupDifference !== 0) return groupDifference;
  if (a.page !== b.page) return a.page - b.page;
  const aRect = a.rects?.[0] ?? a.position;
  const bRect = b.rects?.[0] ?? b.position;
  if (Math.abs(aRect.y - bRect.y) > 0.0005) return aRect.y - bRect.y;
  return aRect.x - bRect.x;
}
