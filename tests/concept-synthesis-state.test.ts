import { describe, expect, test } from 'vitest';

import { addSynthesisRecord, isConceptProposalCurrent, isConceptRequestCurrent, removeSynthesisRecord, type ConceptProposalBasis } from '@/lib/concept-synthesis-state';

const basis: ConceptProposalBasis = {
  epoch: 1, question: 'How do these notes relate?', provider: 'codex',
  recordIds: ['reader:paper-a:h1', 'memo:idea-b'], snapshotHash: 'snapshot-a',
};

describe('concept synthesis proposal binding', () => {
  test('keeps the deliberate basket across unrelated search results and allows explicit removal', () => {
    const first = { id: 'first', excerpt: '첫 발췌' };
    const second = { id: 'second', excerpt: '둘 발췌' };
    const selected = addSynthesisRecord([first], second);
    expect(selected).toEqual([first, second]);
    expect(removeSynthesisRecord(selected, 'first')).toEqual([second]);
    expect(selected.map(({ id }) => id)).toEqual(['first', 'second']);
  });

  test('bounds explicit basket additions by both record count and excerpt characters', () => {
    const records = Array.from({ length: 8 }, (_, index) => ({ id: String(index), excerpt: 'x' }));
    expect(addSynthesisRecord(records, { id: 'ninth', excerpt: 'x' })).toHaveLength(8);
    const long = { id: 'long', excerpt: 'x'.repeat(8_000) };
    expect(addSynthesisRecord([long], { id: 'overflow', excerpt: 'x' })).toEqual([long]);
    expect(addSynthesisRecord([], long)).toEqual([long]);
  });

  test('rejects stale async bindings even if question and selection return to their old values', () => {
    const old = { epoch: 1, question: 'same', provider: 'codex' as const, recordIds: ['first'] };
    const later = { ...old, epoch: 3 };
    expect(isConceptRequestCurrent(old, later)).toBe(false);
    expect(isConceptRequestCurrent(old, { ...old, epoch: 1 })).toBe(true);
  });

  test('accepts the same question, provider, selected records, and exact prepared snapshot', () => {
    const proposalBasis = { ...basis, epoch: 1 };
    expect(isConceptProposalCurrent({ basis: proposalBasis, question: '  How do these notes relate?  ', provider: 'codex',
      recordIds: ['memo:idea-b', 'reader:paper-a:h1'], snapshotHash: 'snapshot-a', epoch: 1 })).toBe(true);
  });

  test('rejects a changed record selection or an unprepared selection', () => {
    const proposalBasis = { ...basis, epoch: 1 };
    expect(isConceptProposalCurrent({ basis: proposalBasis, question: basis.question, provider: 'codex',
      recordIds: ['memo:idea-b'], snapshotHash: 'snapshot-a', epoch: 1 })).toBe(false);
    expect(isConceptProposalCurrent({ basis: proposalBasis, question: basis.question, provider: 'codex',
      recordIds: basis.recordIds, epoch: 1 })).toBe(false);
  });

  test('rejects changed question, provider, or preview hash', () => {
    const proposalBasis = { ...basis, epoch: 1 };
    expect(isConceptProposalCurrent({ basis: proposalBasis, question: 'A different question', provider: 'codex',
      recordIds: basis.recordIds, snapshotHash: 'snapshot-a', epoch: 1 })).toBe(false);
    expect(isConceptProposalCurrent({ basis: proposalBasis, question: basis.question, provider: 'claude',
      recordIds: basis.recordIds, snapshotHash: 'snapshot-a', epoch: 1 })).toBe(false);
    expect(isConceptProposalCurrent({ basis: proposalBasis, question: basis.question, provider: 'codex',
      recordIds: basis.recordIds, snapshotHash: 'snapshot-b', epoch: 1 })).toBe(false);
    expect(isConceptProposalCurrent({ basis: proposalBasis, question: basis.question, provider: 'codex',
      recordIds: basis.recordIds, snapshotHash: 'snapshot-a', epoch: 2 })).toBe(false);
  });
});
