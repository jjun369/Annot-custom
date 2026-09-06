import { HighlightRect, VisualRegion, VisualRegionKind } from '@/types';

export const VISUAL_REGION_KINDS: VisualRegionKind[] = [
  'figure',
  'table',
  'equation',
  'process_condition',
  'custom',
];

export const MAX_VISUAL_REGION_MEMO_CHARS = 6_000;

export interface VisualRegionDraft {
  page: number;
  rect: HighlightRect;
  kind: VisualRegionKind;
  memo?: string;
}

export interface VisualRegionPatch {
  kind?: VisualRegionKind;
  memo?: string;
}

export function isVisualRegionKind(value: unknown): value is VisualRegionKind {
  return typeof value === 'string' && VISUAL_REGION_KINDS.includes(value as VisualRegionKind);
}

export function getVisualRegionKindLabel(kind: VisualRegionKind): string {
  switch (kind) {
    case 'figure': return '그림';
    case 'table': return '표';
    case 'equation': return '수식';
    case 'process_condition': return '공정 조건';
    case 'custom': return '직접 지정';
  }
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function normalizeMemo(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const memo = value.trim();
  return memo.length <= MAX_VISUAL_REGION_MEMO_CHARS ? memo : null;
}

/**
 * Validates the canonical page-relative rectangle. Unlike text-selection
 * geometry, malformed persisted visual anchors are rejected rather than
 * broadly clamped: a corrupt region must not silently point at a different
 * part of a paper.
 */
export function normalizeVisualRegionRect(value: unknown): HighlightRect | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<HighlightRect>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 1 || y > 1) return null;

  // DOM layout arithmetic can exceed the page edge by a negligible fraction.
  // We correct only that floating-point noise, never a materially bad record.
  const epsilon = 1e-6;
  if (x + width > 1 + epsilon || y + height > 1 + epsilon) return null;
  const normalized = {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0, Math.min(1 - x, width)),
    height: Math.max(0, Math.min(1 - y, height)),
  };
  return normalized.width > 0 && normalized.height > 0 ? normalized : null;
}

export function normalizeVisualRegion(value: unknown, documentId?: string): VisualRegion | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<VisualRegion>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const page = Number(candidate.page);
  const rect = normalizeVisualRegionRect(candidate.rect);
  const memo = normalizeMemo(candidate.memo);
  if (!id || !Number.isInteger(page) || page < 1 || !rect || !isVisualRegionKind(candidate.kind) || memo === null) {
    return null;
  }
  const fallbackTimestamp = new Date(0).toISOString();
  return {
    id,
    documentId: documentId || (typeof candidate.documentId === 'string' && candidate.documentId.trim()
      ? candidate.documentId.trim()
      : undefined),
    page,
    rect,
    kind: candidate.kind,
    memo,
    createdAt: normalizeTimestamp(candidate.createdAt, fallbackTimestamp),
    updatedAt: normalizeTimestamp(candidate.updatedAt, fallbackTimestamp),
  };
}

export function createVisualRegion(
  id: string,
  draft: VisualRegionDraft,
  documentId?: string,
  now = new Date().toISOString(),
): VisualRegion | null {
  return normalizeVisualRegion({
    id,
    documentId,
    page: draft.page,
    rect: draft.rect,
    kind: draft.kind,
    memo: draft.memo,
    createdAt: now,
    updatedAt: now,
  }, documentId);
}

export function updateVisualRegion(
  region: VisualRegion,
  patch: VisualRegionPatch,
  now = new Date().toISOString(),
): VisualRegion {
  const kind = patch.kind === undefined ? region.kind : patch.kind;
  const memo = patch.memo === undefined ? region.memo : normalizeMemo(patch.memo);
  if (!isVisualRegionKind(kind) || memo === null) {
    throw new Error('그림·표 기록의 종류 또는 메모가 올바르지 않습니다.');
  }
  return {
    ...region,
    kind,
    memo,
    updatedAt: now,
  };
}

export function compareVisualRegionsBySource(left: VisualRegion, right: VisualRegion): number {
  if (left.page !== right.page) return left.page - right.page;
  if (left.rect.y !== right.rect.y) return left.rect.y - right.rect.y;
  if (left.rect.x !== right.rect.x) return left.rect.x - right.rect.x;
  return left.id.localeCompare(right.id);
}
