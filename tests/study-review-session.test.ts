import { describe, expect, test } from 'vitest';

import {
  createStudyReviewSession,
  getStudyReviewSessionCardId,
  isStudyReviewSessionComplete,
  moveStudyReviewSession,
  removeStudyReviewSessionCard,
  restartStudyReviewSession,
} from '@/lib/study-review-session';
import { normalizeStudyCard } from '@/lib/study-cards';
import { StudyCard } from '@/types';

const sourceContext = {
  id: 'source-1',
  scope: 'selection' as const,
  documentId: 'document-1',
  page: 1,
  text: 'A selected source sentence.',
  rects: [{ x: 0.1, y: 0.2, width: 0.6, height: 0.04 }],
};

function makeCard(id: string, nextReviewDate?: string): StudyCard {
  return normalizeStudyCard({
    id,
    sourceContext,
    front: `${id} question`,
    back: `${id} answer`,
    origin: 'selection',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    review: { reviewCount: 0, nextReviewDate },
  })!;
}

describe('finite current-PDF study review sessions', () => {
  test('snapshots due and all modes without adding future cards to today', () => {
    const cards = [
      makeCard('future', '2026-09-14'),
      makeCard('legacy'),
      makeCard('today', '2026-09-12'),
    ];

    const due = createStudyReviewSession(cards, 'due', '2026-09-12');
    const all = createStudyReviewSession(cards, 'all', '2026-09-12');

    expect(due.cardIds).toEqual(['legacy', 'today']);
    expect(all.cardIds).toEqual(['future', 'legacy', 'today']);
    expect(due.mode).toBe('due');
    expect(due.today).toBe('2026-09-12');
  });

  test('moves through a bounded session and never wraps or mutates the original', () => {
    const session = createStudyReviewSession([makeCard('one'), makeCard('two')], 'all', '2026-09-12');
    const next = moveStudyReviewSession(session, 'next');
    const complete = moveStudyReviewSession(next, 'next');

    expect(session.position).toBe(0);
    expect(getStudyReviewSessionCardId(session)).toBe('one');
    expect(getStudyReviewSessionCardId(next)).toBe('two');
    expect(isStudyReviewSessionComplete(complete)).toBe(true);
    expect(getStudyReviewSessionCardId(complete)).toBeNull();
    expect(moveStudyReviewSession(complete, 'next')).toBe(complete);
    expect(getStudyReviewSessionCardId(moveStudyReviewSession(complete, 'previous'))).toBe('two');
  });

  test('removing the current or a previous card keeps the remaining session finite', () => {
    const session = moveStudyReviewSession(
      createStudyReviewSession([makeCard('one'), makeCard('two'), makeCard('three')], 'all', '2026-09-12'),
      'next',
    );
    const afterCurrentDelete = removeStudyReviewSessionCard(session, 'two');
    const afterPreviousDelete = removeStudyReviewSessionCard(afterCurrentDelete, 'one');

    expect(afterCurrentDelete.cardIds).toEqual(['one', 'three']);
    expect(afterCurrentDelete.position).toBe(1);
    expect(getStudyReviewSessionCardId(afterCurrentDelete)).toBe('three');
    expect(afterPreviousDelete.cardIds).toEqual(['three']);
    expect(afterPreviousDelete.position).toBe(0);
    expect(restartStudyReviewSession(afterPreviousDelete).position).toBe(0);
  });
});
