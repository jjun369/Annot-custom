import { describe, expect, test } from 'vitest';

import {
  createStudyCard,
  getDueStudyCards,
  getNextStudyReviewDate,
  getStudyCardCloze,
  getStudyCardKind,
  normalizeStudyCard,
  renderStudyCardCloze,
  sortStudyCardsForReview,
  updateStudyCard,
} from '@/lib/study-cards';

const sourceContext = {
  id: 'source-1',
  scope: 'selection' as const,
  documentId: 'document-1',
  page: 12,
  text: 'A selected source sentence.',
  rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
};

describe('source-anchored recall cards', () => {
  test('creates a manual card with the existing source-context contract', () => {
    const card = createStudyCard('card-1', {
      sourceContext,
      front: 'What does this sentence mean?',
      back: 'A learner-written explanation.',
      origin: 'selection',
    }, 'document-1', '2026-08-31T12:00:00.000Z');

    expect(card).toMatchObject({
      id: 'card-1',
      documentId: 'document-1',
      sourceContext,
      review: { reviewCount: 0, nextReviewDate: '2026-08-31' },
    });
  });

  test('rejects cards without a source page, question, answer, or valid origin', () => {
    expect(normalizeStudyCard({
      id: 'card-1', sourceContext: { id: 'pdf', scope: 'pdf' }, front: 'Q', back: 'A', origin: 'selection',
    })).toBeNull();
    expect(normalizeStudyCard({
      id: 'card-1', sourceContext, front: '', back: 'A', origin: 'selection',
    })).toBeNull();
    expect(normalizeStudyCard({
      id: 'card-1', sourceContext, front: 'Q', back: 'A', origin: 'other',
    })).toBeNull();
  });

  test('records minimal review state without changing the source anchor', () => {
    const card = createStudyCard('card-1', {
      sourceContext,
      front: 'Question',
      back: 'Answer',
      origin: 'chat',
    }, 'document-1', '2026-08-31T12:00:00.000Z')!;
    const reviewed = updateStudyCard(card, { reviewResult: 'again' }, '2026-09-01T12:00:00.000Z');
    const edited = updateStudyCard(reviewed, { front: 'Edited question', back: 'Edited answer' }, '2026-09-01T12:01:00.000Z');

    expect(edited.sourceContext).toEqual(sourceContext);
    expect(edited.review).toEqual({
      reviewCount: 1,
      lastReviewedAt: '2026-09-01T12:00:00.000Z',
      lastResult: 'again',
      nextReviewDate: '2026-09-02',
    });
  });

  test('uses local calendar days for the two fixed review outcomes', () => {
    const card = createStudyCard('card-1', {
      sourceContext,
      front: 'Question',
      back: 'Answer',
      origin: 'selection',
    }, 'document-1', '2026-08-31T12:00:00.000Z')!;

    expect(card.review.nextReviewDate).toBe('2026-08-31');
    expect(updateStudyCard(card, { reviewResult: 'again' }, '2026-08-31T12:00:00.000Z').review).toMatchObject({
      reviewCount: 1,
      lastResult: 'again',
      nextReviewDate: '2026-09-01',
    });
    expect(updateStudyCard(card, { reviewResult: 'remembered' }, '2026-08-31T12:00:00.000Z').review).toMatchObject({
      reviewCount: 1,
      lastResult: 'remembered',
      nextReviewDate: '2026-09-03',
    });
  });

  test('keeps 0.6 cards unscheduled on load but includes them in today\'s queue', () => {
    const make = (id: string, nextReviewDate?: string) => normalizeStudyCard({
      id,
      sourceContext,
      front: `${id} question`,
      back: `${id} answer`,
      origin: 'selection',
      createdAt: '2026-08-31T12:00:00.000Z',
      updatedAt: '2026-08-31T12:00:00.000Z',
      review: { reviewCount: 0, nextReviewDate },
    })!;
    const legacy = make('legacy');
    const due = make('due', '2026-08-31');
    const overdue = make('overdue', '2026-08-30');
    const future = make('future', '2026-09-02');

    expect(legacy.review.nextReviewDate).toBeUndefined();
    expect(getDueStudyCards([future, due, legacy, overdue], '2026-08-31').map((card) => card.id))
      .toEqual(['overdue', 'due', 'legacy']);
    expect(getNextStudyReviewDate([future, due, legacy, overdue], '2026-08-31')).toBe('2026-09-02');
  });

  test('orders unreviewed cards, then again cards, then oldest remembered cards', () => {
    const make = (id: string, review: object) => normalizeStudyCard({
      id,
      sourceContext,
      front: `${id} question`,
      back: `${id} answer`,
      origin: 'selection',
      createdAt: '2026-08-31T12:00:00.000Z',
      updatedAt: '2026-08-31T12:00:00.000Z',
      review,
    })!;
    const cards = sortStudyCardsForReview([
      make('remembered-new', { reviewCount: 1, lastResult: 'remembered', lastReviewedAt: '2026-09-03T12:00:00.000Z' }),
      make('again', { reviewCount: 1, lastResult: 'again', lastReviewedAt: '2026-09-02T12:00:00.000Z' }),
      make('unreviewed', { reviewCount: 0 }),
      make('remembered-old', { reviewCount: 1, lastResult: 'remembered', lastReviewedAt: '2026-09-01T12:00:00.000Z' }),
    ]);
    expect(cards.map((card) => card.id)).toEqual(['unreviewed', 'again', 'remembered-old', 'remembered-new']);
  });

  test('creates a manual cloze whose answer is an exact immutable source substring', () => {
    const clozeSource = {
      ...sourceContext,
      text: 'The mitochondrion is the powerhouse of the cell.',
    };
    const answer = 'mitochondrion';
    const start = clozeSource.text.indexOf(answer);
    const card = createStudyCard('cloze-1', {
      sourceContext: clozeSource,
      front: 'Ignored by the canonical cloze renderer',
      back: 'Ignored by the canonical cloze renderer',
      origin: 'selection',
      kind: 'cloze',
      cloze: { text: answer, start, end: start + answer.length },
    }, 'document-1', '2026-08-31T12:00:00.000Z');

    expect(card).toMatchObject({
      kind: 'cloze',
      clozeText: answer,
      clozeStart: start,
      clozeEnd: start + answer.length,
      front: 'The […] is the powerhouse of the cell.',
      back: answer,
    });
    expect(getStudyCardCloze(card!)).toEqual({ text: answer, start, end: start + answer.length });
    expect(renderStudyCardCloze(clozeSource.text, getStudyCardCloze(card!)!)).toBe('The […] is the powerhouse of the cell.');
  });

  test('rejects invalid cloze creation and safely falls back for malformed stored cloze data', () => {
    const clozeSource = { ...sourceContext, text: 'The mitochondrion is the powerhouse of the cell.' };
    expect(createStudyCard('invalid-cloze', {
      sourceContext: clozeSource,
      front: 'Question',
      back: 'Answer',
      origin: 'selection',
      kind: 'cloze',
      cloze: { text: 'wrong text', start: 4, end: 17 },
    })).toBeNull();

    const malformed = normalizeStudyCard({
      id: 'malformed-cloze',
      sourceContext: clozeSource,
      kind: 'cloze',
      clozeText: 'wrong text',
      clozeStart: 4,
      clozeEnd: 17,
      front: 'Safe visible question',
      back: 'Safe visible answer',
      origin: 'selection',
    });
    expect(malformed).not.toBeNull();
    expect(getStudyCardKind(malformed!)).toBe('basic');
    expect(getStudyCardCloze(malformed!)).toBeNull();
    expect(() => updateStudyCard(malformed!, { cloze: { text: 'Safe', start: 0, end: 4 } })).toThrow('기본 복습 카드는 빈칸 범위를 가질 수 없습니다');
  });

  test('edits only the cloze range while preserving its source anchor and review schedule', () => {
    const clozeSource = { ...sourceContext, text: 'The mitochondrion is the powerhouse of the cell.' };
    const originalAnswer = 'mitochondrion';
    const originalStart = clozeSource.text.indexOf(originalAnswer);
    const card = createStudyCard('cloze-edit', {
      sourceContext: clozeSource,
      front: 'unused',
      back: 'unused',
      origin: 'selection',
      kind: 'cloze',
      cloze: { text: originalAnswer, start: originalStart, end: originalStart + originalAnswer.length },
    }, 'document-1', '2026-08-31T12:00:00.000Z')!;
    const reviewed = updateStudyCard(card, { reviewResult: 'remembered' }, '2026-08-31T12:00:00.000Z');
    const nextAnswer = 'powerhouse';
    const nextStart = clozeSource.text.indexOf(nextAnswer);
    const edited = updateStudyCard(reviewed, {
      cloze: { text: nextAnswer, start: nextStart, end: nextStart + nextAnswer.length },
    }, '2026-09-01T12:00:00.000Z');

    expect(edited.sourceContext).toEqual(clozeSource);
    expect(edited.review).toEqual(reviewed.review);
    expect(edited.front).toBe('The mitochondrion is the […] of the cell.');
    expect(edited.back).toBe(nextAnswer);
    expect(() => updateStudyCard(edited, { back: 'not source text' })).toThrow('직접 수정할 수 없습니다');
  });

  test('keeps old cards without kind on the original basic renderer', () => {
    const legacy = normalizeStudyCard({
      id: 'legacy-basic', sourceContext, front: 'Old question', back: 'Old answer', origin: 'selection',
    });
    expect(legacy?.kind).toBeUndefined();
    expect(getStudyCardKind(legacy!)).toBe('basic');
  });
});
