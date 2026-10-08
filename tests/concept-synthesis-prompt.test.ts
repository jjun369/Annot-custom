import { describe, expect, test } from 'vitest';

import { buildConceptSynthesisPrompt } from '@/lib/concept-synthesis-prompt';

describe('concept synthesis learning scaffold', () => {
  test('keeps evidence distinctions and adds a source-grounded retrieval check and next action', () => {
    const prompt = buildConceptSynthesisPrompt('Compare these two explanations.');
    expect(prompt).toContain('what the cited literature says');
    expect(prompt).toContain('user observations/hypotheses');
    expect(prompt).toContain('AI inferences');
    expect(prompt).toContain('contradictions/version differences');
    expect(prompt).toContain('open questions or checks');
    expect(prompt).toContain('unverified personal or AI-assisted working material, not literature evidence');
    expect(prompt).toContain('do not infer that it was AI-generated');
    expect(prompt).toContain('one retrieval-practice question answerable from the selected records');
    expect(prompt).toContain('one concrete next-reading or verification action');
    expect(prompt).toContain('record IDs actually used');
  });

  test('bounds the supplied user question', () => {
    const prompt = buildConceptSynthesisPrompt(`${'x'.repeat(2_000)}OUTSIDE`);
    expect(prompt).toContain(`User topic/question: ${'x'.repeat(2_000)}`);
    expect(prompt).not.toContain('OUTSIDE');
  });
});
