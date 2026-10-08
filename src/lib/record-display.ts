type DisplayRecord = { id: string; originLabel: string; provenanceLabel: string };

function translateInternalLabels(label: string): string {
  return label
    .replace(/Sources 개인 메모/g, '자료함 메모')
    .replace(/Sources/g, '자료함')
    .replace(/Knowledge/g, '지식 보관함')
    .replace(/Studio/g, '개인 초안')
    .replace(/Research/g, '리서치')
    .replace(/\brevision\b/gi, '개정');
}

export function recordOriginForDisplay(record: DisplayRecord): string {
  if (record.id.startsWith('studio-draft:')) return '개인 초안 · 이 기기';
  return translateInternalLabels(record.originLabel);
}

export function recordProvenanceForDisplay(record: DisplayRecord): string {
  if (record.id.startsWith('studio-draft:')) return '검토 전 · 문헌 근거 아님';
  return translateInternalLabels(record.provenanceLabel);
}

export function sourceOriginForDisplay(originLabel: string): string {
  return translateInternalLabels(originLabel);
}
