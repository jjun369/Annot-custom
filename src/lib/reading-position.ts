import { ReadingPosition } from '@/types';

export function normalizeReadingPosition(value: unknown): ReadingPosition | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<ReadingPosition>;
  const rawPage = Number(candidate.page);
  const rawOffset = Number(candidate.pageOffsetRatio);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const pageOffsetRatio = Number.isFinite(rawOffset) ? Math.min(1, Math.max(0, rawOffset)) : 0;
  const viewMode = candidate.viewMode === 'paged' ? 'paged' : 'scroll';
  const updatedAt = typeof candidate.updatedAt === 'string' && !Number.isNaN(Date.parse(candidate.updatedAt))
    ? candidate.updatedAt
    : new Date(0).toISOString();

  return { page, pageOffsetRatio, viewMode, updatedAt };
}
