import type { KnowledgeNote, KnowledgeProvenanceKind, KnowledgeSnapshot, KnowledgeTopic } from '@/lib/knowledge-store';
import type { TreeNode } from '@/types';

export type KnowledgeRetrievalFilter = 'all' | 'topics' | 'sources' | KnowledgeProvenanceKind;

export type KnowledgeSearchResult =
  | { kind: 'topic'; id: string; title: string; detail: string; preview: string; topic: KnowledgeTopic }
  | { kind: 'source'; id: string; title: string; detail: string; preview: string; note: KnowledgeNote };

export interface KnowledgeReaderTarget {
  path: string;
  page: number;
  documentId?: string;
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
}

const MAX_SOURCE_FOCUS_RECTS = 8;
const MAX_SOURCE_FOCUS_QUERY_LENGTH = 640;
const MAX_DOCUMENT_ID_LENGTH = 200;
const MAX_READER_QUERY_LENGTH = 4096;

export interface KnowledgeReaderNavigation {
  documentId: string;
  page: number;
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
}

function validDocumentId(value: string | undefined): value is string {
  return Boolean(value && value.length <= MAX_DOCUMENT_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value));
}

function validPage(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 100_000;
}

function normalizedRects(value: unknown): KnowledgeReaderTarget['rects'] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCE_FOCUS_RECTS) return null;
  const rects: NonNullable<KnowledgeReaderTarget['rects']> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const rect = item as Record<string, unknown>;
    const { x, y, width, height } = rect;
    if (![x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
    const values = [x, y, width, height] as number[];
    const [left, top, rectWidth, rectHeight] = values;
    if (left < 0 || top < 0 || rectWidth <= 0 || rectHeight <= 0 || rectWidth > 1 || rectHeight > 1
      || left + rectWidth > 1.000001 || top + rectHeight > 1.000001) return null;
    rects.push({
      x: Number(left.toFixed(6)),
      y: Number(top.toFixed(6)),
      width: Number(rectWidth.toFixed(6)),
      height: Number(rectHeight.toFixed(6)),
    });
  }
  return rects;
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ko-KR');
}

function previewFor(value: string, query: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  const terms = query.split(/\s+/).filter(Boolean);
  const lower = normalized(text);
  const hit = terms.map((term) => lower.indexOf(normalized(term))).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 55);
  const end = Math.min(text.length, start + 190);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function matches(value: string, query: string): boolean {
  const terms = query.split(/\s+/).filter(Boolean).map(normalized);
  const haystack = normalized(value);
  return terms.every((term) => haystack.includes(term));
}

function noteSearchableText(note: KnowledgeNote): string {
  return [
    note.title,
    note.summary,
    note.sourceName,
    note.rawText,
    note.provenance?.kind ?? '',
    knowledgeProvenanceLabel(note.provenance?.kind),
    ...(note.sourceAnchors ?? []).map((anchor) => [anchor.text ?? '', anchor.page ? `p.${anchor.page}` : ''].join(' ')),
  ].join('\n');
}

export function knowledgeProvenanceLabel(kind: KnowledgeProvenanceKind | undefined): string {
  switch (kind) {
    case 'literature_claim': return '문헌 주장';
    case 'work_observation': return '업무 관찰';
    case 'personal_hypothesis': return '개인 가설';
    case 'ai_inference': return 'AI 추론';
    default: return '유형 미지정';
  }
}

export function searchKnowledgeRecords(
  snapshot: Pick<KnowledgeSnapshot, 'notes' | 'topics'>,
  rawQuery: string,
  filter: KnowledgeRetrievalFilter = 'all',
): KnowledgeSearchResult[] {
  const query = normalized(rawQuery.trim());
  if (!query) return [];
  const includeTopics = filter !== 'sources';
  const includeSources = filter !== 'topics';
  const results: KnowledgeSearchResult[] = [];

  if (includeTopics) {
    for (const topic of snapshot.topics) {
      if (!['all', 'topics'].includes(filter) && topic.provenance?.kind !== filter) continue;
      const searchable = `${topic.title}\n${topic.summary}\n${topic.bodyMarkdown}\n${topic.provenance?.kind ?? ''}\n${knowledgeProvenanceLabel(topic.provenance?.kind)}`;
      if (!matches(searchable, query)) continue;
      const preview = previewFor(`${topic.summary}\n${topic.bodyMarkdown}`, query);
      results.push({
        kind: 'topic',
        id: topic.id,
        title: topic.title,
        detail: `${knowledgeProvenanceLabel(topic.provenance?.kind)} · Rev.${topic.revision}`,
        preview,
        topic,
      });
    }
  }

  if (includeSources) {
    for (const note of snapshot.notes) {
      if (filter !== 'all' && filter !== 'sources' && note.provenance?.kind !== filter) continue;
      const searchable = noteSearchableText(note);
      if (!matches(searchable, query)) continue;
      const snippetSource = [...(note.sourceAnchors ?? []).map((item) => item.text ?? ''), note.rawText, note.summary, note.title, note.sourceName]
        .find((text) => matches(text, query)) || note.rawText;
      const anchor = note.sourceAnchors?.find((item) => item.text?.trim());
      results.push({
        kind: 'source',
        id: note.id,
        title: note.title || note.sourceName,
        detail: `${knowledgeProvenanceLabel(note.provenance?.kind)} · ${note.sourceName}${anchor?.page ? ` · p.${anchor.page}` : ''}`,
        preview: previewFor(snippetSource || anchor?.text || note.rawText, query),
        note,
      });
    }
  }

  return results.sort((a, b) => {
    const aDate = a.kind === 'topic' ? a.topic.updatedAt : a.note.createdAt;
    const bDate = b.kind === 'topic' ? b.topic.updatedAt : b.note.createdAt;
    return bDate.localeCompare(aDate) || a.title.localeCompare(b.title, 'ko');
  });
}

export function findKnowledgeReaderTarget(
  root: TreeNode | null | undefined,
  documentId: string | undefined,
  page: number | undefined,
  rects?: unknown,
): KnowledgeReaderTarget | null {
  if (!root || !validDocumentId(documentId) || !page || !validPage(page)) return null;
  const visit = (node: TreeNode): string | null => {
    if (node.type === 'pdf' && node.documentId === documentId && node.path.trim()) return node.path;
    for (const child of node.children ?? []) {
      const match = visit(child);
      if (match) return match;
    }
    return null;
  };
  const path = visit(root);
  if (!path) return null;
  const safeRects = normalizedRects(rects);
  return { path, page, documentId, ...(safeRects ? { rects: safeRects } : {}) };
}

/** Resolve a saved source anchor against today's Library tree for reusable source-open actions. */
export function buildKnowledgeSourceReaderUrl(
  root: TreeNode | null | undefined,
  navigation: { documentId?: string; page?: number; rects?: KnowledgeReaderTarget['rects'] } | null,
): string | null {
  if (!navigation?.documentId || !navigation.page) return null;
  return buildKnowledgeReaderUrl(findKnowledgeReaderTarget(
    root,
    navigation.documentId,
    navigation.page,
    navigation.rects,
  ));
}

export function buildKnowledgeReaderUrl(target: KnowledgeReaderTarget | null): string | null {
  if (!target || !target.path.trim() || !validPage(target.page)) return null;
  const query = new URLSearchParams({ pdf: target.path, page: String(target.page) });
  if (validDocumentId(target.documentId)) {
    query.set('doc', target.documentId);
    const rects = normalizedRects(target.rects);
    if (rects) {
      const focus = JSON.stringify(rects);
      if (focus.length <= MAX_SOURCE_FOCUS_QUERY_LENGTH) query.set('focus', focus);
    }
  }
  return `/?${query.toString()}`;
}

/** Parse the compact Reader URL handoff. Invalid focus is ignored; valid doc/page still open page-only. */
export function parseKnowledgeReaderNavigation(search: string): KnowledgeReaderNavigation | null {
  if (search.length > MAX_READER_QUERY_LENGTH) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  } catch {
    return null;
  }
  const documentId = params.get('doc') ?? undefined;
  const pageText = params.get('page') ?? '';
  if (!validDocumentId(documentId) || !/^[1-9]\d{0,5}$/.test(pageText)) return null;
  const page = Number(pageText);
  if (!validPage(page)) return null;
  const rawFocus = params.get('focus');
  if (!rawFocus || rawFocus.length > MAX_SOURCE_FOCUS_QUERY_LENGTH) return { documentId, page };
  try {
    const rects = normalizedRects(JSON.parse(rawFocus));
    return { documentId, page, ...(rects ? { rects } : {}) };
  } catch {
    return { documentId, page };
  }
}
