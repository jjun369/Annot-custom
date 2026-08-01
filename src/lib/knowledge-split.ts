export const KNOWLEDGE_SPLIT_PREVIEW_THRESHOLD = 20_000;
export const KNOWLEDGE_SPLIT_TARGET = 20_000;
export const KNOWLEDGE_SPLIT_MAX = 60_000;
export const KNOWLEDGE_NOTE_MAX = 100_000;

export interface KnowledgeTextSegment {
  text: string;
  title: string;
  hardSplit: boolean;
}

export interface KnowledgeSplitResult {
  normalizedText: string;
  segments: KnowledgeTextSegment[];
  warnings: string[];
}

export function normalizeKnowledgeText(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

function titleFor(text: string, index: number): string {
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  return firstLine.replace(/^#{1,6}\s+/, '').trim().slice(0, 80) || `메모 조각 ${index + 1}`;
}

function splitLargeBlock(block: string): Array<{ text: string; hardSplit: boolean }> {
  const parts: Array<{ text: string; hardSplit: boolean }> = [];
  let remaining = block.trim();
  while (remaining.length > KNOWLEDGE_SPLIT_MAX) {
    let splitAt = remaining.lastIndexOf('\n', KNOWLEDGE_SPLIT_MAX);
    if (splitAt < Math.floor(KNOWLEDGE_SPLIT_TARGET / 2)) splitAt = KNOWLEDGE_SPLIT_MAX;
    const part = remaining.slice(0, splitAt).trim();
    if (part) parts.push({ text: part, hardSplit: true });
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) parts.push({ text: remaining, hardSplit: parts.length > 0 });
  return parts;
}

function semanticBlocks(text: string): string[] {
  const headingParts = text.split(/(?=^#{1,6}\s+.+$)/m);
  return headingParts.flatMap((part) => part.split(/\n{2,}/)).map((part) => part.trim()).filter(Boolean);
}

export function splitKnowledgeText(value: string): KnowledgeSplitResult {
  const normalizedText = normalizeKnowledgeText(value);
  if (!normalizedText) return { normalizedText: '', segments: [], warnings: [] };
  if (normalizedText.length <= KNOWLEDGE_SPLIT_PREVIEW_THRESHOLD) {
    return { normalizedText, segments: [{ text: normalizedText, title: titleFor(normalizedText, 0), hardSplit: false }], warnings: [] };
  }

  const blocks = semanticBlocks(normalizedText);
  const pieces: Array<{ text: string; hardSplit: boolean }> = [];
  let current = '';
  for (const block of blocks) {
    if (block.length > KNOWLEDGE_SPLIT_MAX) {
      if (current) {
        pieces.push({ text: current, hardSplit: false });
        current = '';
      }
      pieces.push(...splitLargeBlock(block));
      continue;
    }
    const candidate = current ? `${current}\n\n${block}` : block;
    if (current && candidate.length > KNOWLEDGE_SPLIT_TARGET) {
      pieces.push({ text: current, hardSplit: false });
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push({ text: current, hardSplit: false });

  const segments = pieces.map((piece, index) => ({ ...piece, title: titleFor(piece.text, index) }));
  const warnings = segments.some((segment) => segment.hardSplit)
    ? ['문단이나 제목 경계만으로 나눌 수 없는 긴 문단은 글자 위치에서 나눴습니다.']
    : [];
  return { normalizedText, segments, warnings };
}
