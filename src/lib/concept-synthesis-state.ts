export interface ConceptRequestBinding {
  epoch: number;
  question: string;
  provider: 'codex' | 'claude';
  recordIds: string[];
}

export interface ConceptProposalBasis extends ConceptRequestBinding {
  snapshotHash: string;
}

export function addSynthesisRecord<T extends { id: string; excerpt: string }>(selected: T[], record: T, limit = 8, maxChars = 8_000): T[] {
  if (selected.some((item) => item.id === record.id)) return selected;
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(0, limit) : 8;
  const safeMaxChars = Number.isSafeInteger(maxChars) ? Math.max(0, maxChars) : 8_000;
  const currentChars = selected.reduce((sum, item) => sum + item.excerpt.length, 0);
  return selected.length >= safeLimit || currentChars + record.excerpt.length > safeMaxChars ? selected : [...selected, record];
}

export function removeSynthesisRecord<T extends { id: string }>(selected: T[], recordId: string): T[] {
  return selected.filter((record) => record.id !== recordId);
}

export function isConceptRequestCurrent(binding: ConceptRequestBinding, current: ConceptRequestBinding): boolean {
  if (binding.epoch !== current.epoch || binding.question !== current.question.trim() || binding.provider !== current.provider) return false;
  const basisIds = [...new Set(binding.recordIds)].sort();
  const currentIds = [...new Set(current.recordIds)].sort();
  return basisIds.length === currentIds.length && basisIds.every((id, index) => id === currentIds[index]);
}

export function isConceptProposalCurrent(input: {
  basis: ConceptProposalBasis | null;
  question: string;
  provider: 'codex' | 'claude';
  recordIds: string[];
  snapshotHash?: string;
  epoch: number;
}): boolean {
  const { basis } = input;
  if (!basis || !input.snapshotHash || basis.snapshotHash !== input.snapshotHash
    || !isConceptRequestCurrent(basis, { epoch: input.epoch, question: input.question, provider: input.provider, recordIds: input.recordIds })) return false;
  return true;
}
