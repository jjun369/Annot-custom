import { getDueStudyCards, sortStudyCardsForReview } from '@/lib/study-cards';
import { StudyCard } from '@/types';

export type StudyReviewMode = 'due' | 'all';
export type StudyReviewSessionDirection = 'previous' | 'next';

export interface StudyReviewSession {
  mode: StudyReviewMode;
  today: string;
  cardIds: string[];
  position: number;
}
export function createStudyReviewSession(
  cards: StudyCard[],
  mode: StudyReviewMode,
  today: string,
): StudyReviewSession {
  const candidates = mode === 'due' ? getDueStudyCards(cards, today) : sortStudyCardsForReview(cards);
  return {
    mode,
    today,
    cardIds: [...new Set(candidates.map((card) => card.id))],
    position: 0,
  };
}

export function getStudyReviewSessionCardId(session: StudyReviewSession | null): string | null {
  if (!session || session.position >= session.cardIds.length) return null;
  return session.cardIds[session.position] || null;
}

export function moveStudyReviewSession(
  session: StudyReviewSession,
  direction: StudyReviewSessionDirection,
): StudyReviewSession {
  const nextPosition = direction === 'previous'
    ? Math.max(0, session.position - 1)
    : Math.min(session.cardIds.length, session.position + 1);
  return nextPosition === session.position ? session : { ...session, position: nextPosition };
}

export function restartStudyReviewSession(session: StudyReviewSession): StudyReviewSession {
  return session.position === 0 ? session : { ...session, position: 0 };
}

export function removeStudyReviewSessionCard(
  session: StudyReviewSession,
  cardId: string,
): StudyReviewSession {
  const removedAt = session.cardIds.indexOf(cardId);
  if (removedAt < 0) return session;

  const cardIds = session.cardIds.filter((id) => id !== cardId);
  const position = Math.min(
    cardIds.length,
    Math.max(0, session.position - (removedAt < session.position ? 1 : 0)),
  );
  return { ...session, cardIds, position };
}

export function isStudyReviewSessionComplete(session: StudyReviewSession | null): boolean {
  return Boolean(session && session.cardIds.length > 0 && session.position >= session.cardIds.length);
}
