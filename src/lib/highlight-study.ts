import { Highlight, HighlightStudyKind } from '@/types';

const STUDY_KINDS: readonly HighlightStudyKind[] = [
  'important',
  'concept',
  'memorize',
  'question',
  'unclear',
];

const STUDY_KIND_LABELS: Record<HighlightStudyKind, string> = {
  important: '중요',
  concept: '개념/정의',
  memorize: '외울 것',
  question: '질문',
  // This is a follow-up state, not a judgment about the reader.
  unclear: '이해 필요',
};

export function isHighlightStudyKind(value: unknown): value is HighlightStudyKind {
  return typeof value === 'string' && STUDY_KINDS.includes(value as HighlightStudyKind);
}

export function inferStudyKind(
  highlight: Pick<Highlight, 'type' | 'studyKind'>,
): HighlightStudyKind {
  if (isHighlightStudyKind(highlight.studyKind)) {
    return highlight.studyKind;
  }

  return highlight.type === 'unknown' ? 'unclear' : 'important';
}

export function legacyTypeForStudyKind(kind: HighlightStudyKind): Highlight['type'] {
  return kind === 'question' || kind === 'unclear' ? 'unknown' : 'important';
}

export function getStudyKindLabel(kind: HighlightStudyKind): string {
  return STUDY_KIND_LABELS[kind];
}

export function normalizeResolvedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

export function isUnresolvedHighlight(highlight: Pick<Highlight, 'type' | 'studyKind' | 'resolvedAt'>): boolean {
  const kind = inferStudyKind(highlight);
  return (kind === 'unclear' || kind === 'question') && !normalizeResolvedAt(highlight.resolvedAt);
}

export function applyStudyKind(
  highlight: Pick<Highlight, 'type' | 'studyKind' | 'resolvedAt'>,
  studyKind: HighlightStudyKind,
): Pick<Highlight, 'type' | 'studyKind' | 'resolvedAt'> {
  const remainsUnresolvedKind = studyKind === 'unclear' || studyKind === 'question';
  return {
    type: legacyTypeForStudyKind(studyKind),
    studyKind,
    resolvedAt: remainsUnresolvedKind ? normalizeResolvedAt(highlight.resolvedAt) : undefined,
  };
}
