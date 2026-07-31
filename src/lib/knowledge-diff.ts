export interface KnowledgeDiffLine {
  kind: 'same' | 'added' | 'removed' | 'omitted';
  text: string;
}

function collapseUnchanged(lines: KnowledgeDiffLine[], contextLines = 3): KnowledgeDiffLine[] {
  const result: KnowledgeDiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind !== 'same') {
      result.push(lines[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && lines[end].kind === 'same') end += 1;
    const run = lines.slice(index, end);
    const atStart = index === 0;
    const atEnd = end === lines.length;
    const keepBefore = atStart ? 0 : contextLines;
    const keepAfter = atEnd ? 0 : contextLines;
    if (run.length > keepBefore + keepAfter + 2) {
      result.push(...run.slice(0, keepBefore));
      result.push({ kind: 'omitted', text: `… 변경 없는 ${run.length - keepBefore - keepAfter}줄 접음 …` });
      if (keepAfter) result.push(...run.slice(-keepAfter));
    } else {
      result.push(...run);
    }
    index = end;
  }
  return result;
}

function largeDiffFallback(left: string[], right: string[]): KnowledgeDiffLine[] {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix += 1;
  const lines: KnowledgeDiffLine[] = [
    ...left.slice(0, prefix).map((text): KnowledgeDiffLine => ({ kind: 'same', text })),
    ...left.slice(prefix, left.length - suffix).map((text): KnowledgeDiffLine => ({ kind: 'removed', text })),
    ...right.slice(prefix, right.length - suffix).map((text): KnowledgeDiffLine => ({ kind: 'added', text })),
    ...left.slice(left.length - suffix).map((text): KnowledgeDiffLine => ({ kind: 'same', text })),
  ];
  return collapseUnchanged(lines);
}

/**
 * A small line diff for review UX. It intentionally avoids a runtime package.
 * Very large documents fall back to whole-document replacement so the UI never
 * spends quadratic time rendering an AI proposal.
 */
export function diffKnowledgeLines(before: string, after: string, maxLines = 1_200): KnowledgeDiffLine[] {
  const left = before.split('\n');
  const right = after.split('\n');
  if (left.length + right.length > maxLines) {
    return largeDiffFallback(left, right);
  }

  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result: KnowledgeDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ kind: 'same', text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: 'removed', text: left[i] });
      i += 1;
    } else {
      result.push({ kind: 'added', text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) result.push({ kind: 'removed', text: left[i++] });
  while (j < right.length) result.push({ kind: 'added', text: right[j++] });
  return collapseUnchanged(result);
}
