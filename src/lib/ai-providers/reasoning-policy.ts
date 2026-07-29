import type { ReasoningEffort } from '@/types';

export const AUTO_REASONING_EFFORT: ReasoningEffort = 'auto';
export const REASONING_EFFORT_STORAGE_KEY = 'annot-last-reasoning-effort';

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'auto',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]);

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (typeof value !== 'string') return AUTO_REASONING_EFFORT;
  const normalized = value.trim().toLowerCase() as ReasoningEffort;
  return REASONING_EFFORTS.has(normalized) ? normalized : AUTO_REASONING_EFFORT;
}

export function isAutoReasoningEffort(value: unknown): boolean {
  return normalizeReasoningEffort(value) === AUTO_REASONING_EFFORT;
}

export function getReasoningEffortLabel(effort: ReasoningEffort): string {
  const labels: Record<ReasoningEffort, string> = {
    auto: '자동',
    none: '없음',
    low: '낮음',
    medium: '보통',
    high: '높음',
    xhigh: '매우 높음',
    max: '최대',
    ultra: '울트라',
  };
  return labels[effort];
}

export function readStoredReasoningEffort(): ReasoningEffort {
  if (typeof window === 'undefined') return AUTO_REASONING_EFFORT;
  return normalizeReasoningEffort(window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY));
}

export function writeStoredReasoningEffort(effort: ReasoningEffort): ReasoningEffort {
  const normalized = normalizeReasoningEffort(effort);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, normalized);
  }
  return normalized;
}
