import { normalizeChatSourceContext } from '@/lib/ai-providers/source-context';
import {
  ChatSourceContext,
  StudyCard,
  StudyCardCloze,
  StudyCardKind,
  StudyCardOrigin,
  StudyCardReviewResult,
  StudyCardReviewState,
} from '@/types';

export const STUDY_CARD_SIDECAR_VERSION = 1;
export const MAX_STUDY_CARD_TEXT_CHARS = 12_000;
export const MAX_STUDY_CARD_CLOZE_CHARS = 240;
export const STUDY_CARD_CLOZE_BLANK = '[…]';

export interface StudyCardDraft {
  sourceContext: ChatSourceContext;
  front: string;
  back: string;
  origin: StudyCardOrigin;
  kind?: StudyCardKind;
  cloze?: StudyCardCloze;
}

export interface StudyCardPatch {
  front?: string;
  back?: string;
  cloze?: StudyCardCloze;
  reviewResult?: StudyCardReviewResult;
}

const STUDY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_STUDY_CARD_TEXT_CHARS) return undefined;
  return normalized;
}

function normalizeClozeText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_STUDY_CARD_CLOZE_CHARS) return undefined;
  return value;
}

function normalizeCloze(
  sourceText: string | undefined,
  value: unknown,
): StudyCardCloze | null {
  if (!sourceText || !value || typeof value !== 'object') return null;
  const candidate = value as Partial<StudyCardCloze>;
  const start = Number(candidate.start);
  const end = Number(candidate.end);
  const text = normalizeClozeText(candidate.text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceText.length || !text) {
    return null;
  }
  return sourceText.slice(start, end) === text ? { text, start, end } : null;
}

function getRawCardCloze(value: Partial<StudyCard>): StudyCardCloze {
  return {
    text: value.clozeText as string,
    start: value.clozeStart as number,
    end: value.clozeEnd as number,
  };
}

/** Old cards have no kind and deliberately remain basic without a migration. */
export function getStudyCardKind(card: Pick<StudyCard, 'kind' | 'clozeText' | 'clozeStart' | 'clozeEnd'>): StudyCardKind {
  return card.kind === 'cloze' ? 'cloze' : 'basic';
}

export function getStudyCardCloze(card: StudyCard): StudyCardCloze | null {
  if (getStudyCardKind(card) !== 'cloze' || card.sourceContext.scope !== 'selection') return null;
  return normalizeCloze(card.sourceContext.text, getRawCardCloze(card));
}

export function renderStudyCardCloze(sourceText: string, cloze: StudyCardCloze): string {
  return `${sourceText.slice(0, cloze.start)}${STUDY_CARD_CLOZE_BLANK}${sourceText.slice(cloze.end)}`;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function parseStudyDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = STUDY_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function formatLocalStudyDate(value: Date): string {
  const year = value.getFullYear().toString().padStart(4, '0');
  const month = (value.getMonth() + 1).toString().padStart(2, '0');
  const day = value.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalStudyDate(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? formatLocalStudyDate(new Date()) : formatLocalStudyDate(date);
}

export function normalizeStudyReviewDate(value: unknown): string | undefined {
  return parseStudyDate(value) ? value as string : undefined;
}

export function addStudyCalendarDays(date: string, days: number): string {
  const parsed = parseStudyDate(date);
  if (!parsed || !Number.isFinite(days)) {
    throw new Error('복습 날짜가 올바르지 않습니다.');
  }
  parsed.setDate(parsed.getDate() + Math.trunc(days));
  return formatLocalStudyDate(parsed);
}

export function getNextReviewDateForResult(
  result: StudyCardReviewResult,
  now: Date | string = new Date(),
): string {
  return addStudyCalendarDays(getLocalStudyDate(now), result === 'again' ? 1 : 3);
}

export function formatStudyReviewDate(date: string | undefined): string | undefined {
  const parsed = parseStudyDate(date);
  return parsed ? `${parsed.getMonth() + 1}월 ${parsed.getDate()}일` : undefined;
}

function normalizeReview(value: unknown): StudyCardReviewState {
  const candidate = value && typeof value === 'object'
    ? value as Partial<StudyCardReviewState>
    : {};
  const count = Number(candidate.reviewCount);
  return {
    reviewCount: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
    lastReviewedAt: typeof candidate.lastReviewedAt === 'string'
      && !Number.isNaN(Date.parse(candidate.lastReviewedAt))
      ? candidate.lastReviewedAt
      : undefined,
    lastResult: candidate.lastResult === 'again' || candidate.lastResult === 'remembered'
      ? candidate.lastResult
      : undefined,
    nextReviewDate: normalizeStudyReviewDate(candidate.nextReviewDate),
  };
}

export function normalizeStudyCard(value: unknown, documentId?: string): StudyCard | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StudyCard>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  const sourceContext = normalizeChatSourceContext(candidate.sourceContext, { documentId });
  if (!sourceContext?.page || (sourceContext.scope !== 'selection' && sourceContext.scope !== 'page')) {
    return null;
  }
  const front = normalizeText(candidate.front);
  const back = normalizeText(candidate.back);
  if (!front || !back) return null;
  if (candidate.origin !== 'selection' && candidate.origin !== 'chat') return null;

  const requestedCloze = candidate.kind === 'cloze';
  const cloze = requestedCloze && sourceContext.scope === 'selection'
    ? normalizeCloze(sourceContext.text, getRawCardCloze(candidate))
    : null;
  // A malformed future/hand-edited cloze must never keep a hidden answer or
  // prevent the rest of the PDF's cards from loading. It falls back to the
  // ordinary renderer; a deliberate create/edit is validated before this
  // normalizer is reached.
  const kind = cloze ? 'cloze' : candidate.kind === 'basic' ? 'basic' : undefined;
  const clozeFront = cloze && sourceContext.text
    ? renderStudyCardCloze(sourceContext.text, cloze)
    : undefined;

  const fallbackTimestamp = new Date(0).toISOString();
  return {
    id: candidate.id.trim(),
    documentId: documentId || sourceContext.documentId,
    sourceContext,
    kind,
    clozeText: cloze?.text,
    clozeStart: cloze?.start,
    clozeEnd: cloze?.end,
    front: clozeFront || front,
    back: cloze?.text || back,
    origin: candidate.origin,
    createdAt: normalizeTimestamp(candidate.createdAt, fallbackTimestamp),
    updatedAt: normalizeTimestamp(candidate.updatedAt, fallbackTimestamp),
    review: normalizeReview(candidate.review),
  };
}

export function createStudyCard(id: string, draft: StudyCardDraft, documentId?: string, now = new Date().toISOString()): StudyCard | null {
  const kind = draft.kind || 'basic';
  const cloze = kind === 'cloze' && draft.sourceContext.scope === 'selection'
    ? normalizeCloze(draft.sourceContext.text, draft.cloze)
    : null;
  if (kind !== 'basic' && kind !== 'cloze') return null;
  if (kind === 'cloze' && !cloze) return null;
  const clozeFront = cloze && draft.sourceContext.text
    ? renderStudyCardCloze(draft.sourceContext.text, cloze)
    : undefined;
  return normalizeStudyCard({
    id,
    documentId,
    sourceContext: draft.sourceContext,
    kind,
    clozeText: cloze?.text,
    clozeStart: cloze?.start,
    clozeEnd: cloze?.end,
    front: clozeFront || draft.front,
    back: cloze?.text || draft.back,
    origin: draft.origin,
    createdAt: now,
    updatedAt: now,
    // New cards should appear in today's current-PDF queue, but opening an
    // older sidecar without this optional field must never write a migration.
    review: { reviewCount: 0, nextReviewDate: getLocalStudyDate(now) },
  }, documentId);
}

export function updateStudyCard(card: StudyCard, patch: StudyCardPatch, now = new Date().toISOString()): StudyCard {
  const kind = getStudyCardKind(card);
  if (kind === 'basic' && patch.cloze !== undefined) {
    throw new Error('기본 복습 카드는 빈칸 범위를 가질 수 없습니다.');
  }
  if (kind === 'cloze' && (patch.front !== undefined || patch.back !== undefined)) {
    throw new Error('빈칸 카드의 원문과 정답은 직접 수정할 수 없습니다. 원문에서 숨길 부분을 다시 지정해 주세요.');
  }
  const front = patch.front === undefined ? card.front : normalizeText(patch.front);
  const back = patch.back === undefined ? card.back : normalizeText(patch.back);
  if (!front || !back) {
    throw new Error('카드의 질문과 답은 비워 둘 수 없습니다.');
  }
  const cloze = kind === 'cloze'
    ? normalizeCloze(card.sourceContext.text, patch.cloze === undefined ? getRawCardCloze(card) : patch.cloze)
    : null;
  if (kind === 'cloze' && !cloze) {
    throw new Error('빈칸으로 지정한 원문 범위가 올바르지 않습니다. 원문 안에서 짧은 구를 다시 선택해 주세요.');
  }
  const clozeFront = cloze && card.sourceContext.text
    ? renderStudyCardCloze(card.sourceContext.text, cloze)
    : undefined;
  const nextReview = patch.reviewResult
    ? {
      reviewCount: card.review.reviewCount + 1,
      lastReviewedAt: now,
      lastResult: patch.reviewResult,
      nextReviewDate: getNextReviewDateForResult(patch.reviewResult, now),
    }
    : card.review;
  return {
    ...card,
    kind: card.kind === undefined ? undefined : kind,
    clozeText: cloze?.text,
    clozeStart: cloze?.start,
    clozeEnd: cloze?.end,
    front: clozeFront || front,
    back: cloze?.text || back,
    review: nextReview,
    updatedAt: now,
  };
}

export function isStudyCardDue(card: StudyCard, today = getLocalStudyDate()): boolean {
  const nextReviewDate = normalizeStudyReviewDate(card.review.nextReviewDate);
  // A 0.6 card has no schedule. Treat it as due without persisting a
  // migration so the learner still sees it and the sidecar stays untouched.
  return !nextReviewDate || nextReviewDate <= today;
}

function compareStudyCardsForReview(left: StudyCard, right: StudyCard): number {
  const rank = (card: StudyCard) => {
    if (card.review.reviewCount === 0) return 0;
    if (card.review.lastResult === 'again') return 1;
    return 2;
  };
  const rankDifference = rank(left) - rank(right);
  if (rankDifference !== 0) return rankDifference;
  const leftTime = Date.parse(left.review.lastReviewedAt || left.createdAt);
  const rightTime = Date.parse(right.review.lastReviewedAt || right.createdAt);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.createdAt.localeCompare(right.createdAt);
}

export function sortStudyCardsForReview(cards: StudyCard[]): StudyCard[] {
  return [...cards].sort(compareStudyCardsForReview);
}

export function getDueStudyCards(cards: StudyCard[], today = getLocalStudyDate()): StudyCard[] {
  return cards
    .filter((card) => isStudyCardDue(card, today))
    .sort((left, right) => {
      const leftDate = normalizeStudyReviewDate(left.review.nextReviewDate) || today;
      const rightDate = normalizeStudyReviewDate(right.review.nextReviewDate) || today;
      const dateDifference = leftDate.localeCompare(rightDate);
      return dateDifference !== 0 ? dateDifference : compareStudyCardsForReview(left, right);
    });
}

export function getNextStudyReviewDate(cards: StudyCard[], today = getLocalStudyDate()): string | undefined {
  return cards
    .map((card) => normalizeStudyReviewDate(card.review.nextReviewDate))
    .filter((date): date is string => Boolean(date && date > today))
    .sort((left, right) => left.localeCompare(right))[0];
}
