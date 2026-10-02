import type { KnowledgeNote, KnowledgeProvenanceKind, KnowledgeSnapshot, KnowledgeTopic } from '@/lib/knowledge-store';
import type { TreeNode } from '@/types';

export type KnowledgeRetrievalFilter = 'all' | 'topics' | 'sources' | KnowledgeProvenanceKind;

export type KnowledgeSearchResult =
  | { kind: 'topic'; id: string; title: string; detail: string; preview: string; topic: KnowledgeTopic }
  | { kind: 'source'; id: string; title: string; detail: string; preview: string; note: KnowledgeNote };

export interface KnowledgeReaderTarget {
  path: string;
  page: number;
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
): KnowledgeReaderTarget | null {
  if (!root || !documentId || !Number.isSafeInteger(page) || !page || page < 1) return null;
  const visit = (node: TreeNode): string | null => {
    if (node.type === 'pdf' && node.documentId === documentId && node.path.trim()) return node.path;
    for (const child of node.children ?? []) {
      const match = visit(child);
      if (match) return match;
    }
    return null;
  };
  const path = visit(root);
  return path ? { path, page } : null;
}

export function buildKnowledgeReaderUrl(target: KnowledgeReaderTarget | null): string | null {
  if (!target || !target.path.trim() || !Number.isSafeInteger(target.page) || target.page < 1) return null;
  const query = new URLSearchParams({ pdf: target.path, page: String(target.page) });
  return `/?${query.toString()}`;
}
