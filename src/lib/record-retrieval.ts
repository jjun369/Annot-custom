import { createHash } from 'node:crypto';
import { getKnowledgeSnapshot } from '@/lib/knowledge-store';
import { listSidecarHighlights, listSidecarVisualRegions } from '@/lib/highlight-sidecar';
import { getDocumentById, listDocuments } from '@/lib/research-db';
import { getStudioSnapshot, type StudioDraft, type StudioSource } from '@/lib/sources-studio';
import type { ChatRecordContextSnapshot, ChatSourceContext, Highlight } from '@/types';

export const MAX_RECORD_CONTEXT_ITEMS = 8;
export const MAX_RECORD_CONTEXT_CHARS = 8_000;
const MAX_RECORD_CONTEXT_SNIPPET = 1_600;
const MAX_RECORD_CONTEXT_CANDIDATES = 300;

export interface LocalRecordCandidate {
  id: string;
  title: string;
  originLabel: string;
  provenanceLabel: string;
  text: string;
  sourceUpdatedAt: string;
  anchor?: ChatSourceContext;
  sourceId?: string;
  kind: 'sidecar' | 'knowledge' | 'wiki' | 'personal' | 'research' | 'studio-draft';
}

const PROVENANCE_LABELS: Record<string, string> = {
  literature_claim: '문헌 주장', work_observation: '업무 관찰',
  personal_hypothesis: '개인 가설', ai_inference: 'AI 추론',
};

function provenanceForStudio(source: StudioSource): string {
  if (source.origin === 'wiki') return `정리된 위키 · ${source.originLabel}`;
  if (source.origin === 'knowledge') return source.originLabel;
  if (source.kind === 'memo') return '사용자 개인 메모';
  return source.originLabel;
}

function anchorForHighlight(item: Highlight, documentId: string): ChatSourceContext | undefined {
  if (!item.text.trim() || !item.page || !item.rects?.length) return undefined;
  return { id: `record:${item.annotationId || item.id}`, scope: 'selection', documentId, page: item.page,
    text: item.text.slice(0, 12_000), rects: item.rects.slice(0, 128), highlightId: item.annotationId || item.id };
}

function tokenize(value: string): string[] {
  return [...new Set(value.normalize('NFKC').toLocaleLowerCase('ko-KR').match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 80);
}

function relevance(query: string, candidate: LocalRecordCandidate): number {
  const terms = tokenize(query);
  if (!terms.length) return 0;
  const text = `${candidate.title}\n${candidate.text}\n${candidate.provenanceLabel}`.normalize('NFKC').toLocaleLowerCase('ko-KR');
  let score = 0;
  for (const term of terms) {
    const titleHits = candidate.title.normalize('NFKC').toLocaleLowerCase('ko-KR').split(term).length - 1;
    const hits = text.split(term).length - 1;
    score += Math.min(titleHits, 4) * 8 + Math.min(hits, 8) * 2;
  }
  return score;
}

export function excerptFor(query: string, text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  const terms = tokenize(query);
  const lower = normalized.normalize('NFKC').toLocaleLowerCase('ko-KR');
  let best = 0;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index >= 0) { best = Math.max(0, index - Math.floor(maxChars / 3)); break; }
  }
  const prefix = best > 0 ? '…' : '';
  const contentBudget = Math.max(0, maxChars - prefix.length - 1);
  return `${prefix}${normalized.slice(best, best + contentBudget)}${best + contentBudget < normalized.length ? '…' : ''}`;
}

export function previewLibraryRecords(query: string, candidates: LocalRecordCandidate[], limit = 40) {
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(0, limit) : 40;
  const records = candidates.slice(0, safeLimit).map((candidate) => ({
    id: candidate.id, title: candidate.title, originLabel: candidate.originLabel,
    provenanceLabel: candidate.provenanceLabel, excerpt: excerptFor(query, candidate.text, 420),
    sourceUpdatedAt: candidate.sourceUpdatedAt, ...(candidate.anchor ? { anchor: candidate.anchor } : {}),
  }));
  return { records, totalCount: candidates.length, omittedCount: Math.max(0, candidates.length - records.length) };
}

export function selectBoundedRecords(query: string, candidates: LocalRecordCandidate[], options?: { limit?: number; totalChars?: number; scope?: 'document' | 'library'; includeIds?: string[]; preserveIncludeOrder?: boolean }): ChatRecordContextSnapshot {
  const deduped = new Map<string, LocalRecordCandidate>();
  for (const candidate of candidates.slice(0, MAX_RECORD_CONTEXT_CANDIDATES)) {
    const contentHash = createHash('sha256').update(candidate.text.normalize('NFKC').trim()).digest('hex');
    const key = options?.preserveIncludeOrder ? `selected:${candidate.id}` : candidate.anchor?.highlightId ? `anchor:${candidate.anchor.highlightId}:${contentHash}` : `${candidate.kind}:${contentHash}`;
    const previous = deduped.get(key);
    if (!previous || candidate.kind === 'sidecar') deduped.set(key, candidate);
  }
  const included = options?.includeIds ? new Set(options.includeIds) : null;
  const includeOrder = options?.preserveIncludeOrder ? new Map<string, number>((options.includeIds ?? []).map((id, index) => [id, index])) : null;
  const ranked = [...deduped.values()].filter((item) => !included || included.has(item.id)).map((item, index) => ({ item, score: relevance(query, item), index }))
    .filter((row) => included && options?.preserveIncludeOrder ? true : row.score > 0)
    .sort((a, b) => includeOrder ? (includeOrder.get(a.item.id) ?? Infinity) - (includeOrder.get(b.item.id) ?? Infinity) : b.score - a.score || a.index - b.index);
  const maxItems = options?.limit ?? MAX_RECORD_CONTEXT_ITEMS;
  const maxChars = options?.totalChars ?? MAX_RECORD_CONTEXT_CHARS;
  let remaining = maxChars;
  const records: ChatRecordContextSnapshot['records'] = [];
  let omittedChars = 0;
  for (let index = 0; index < ranked.length; index += 1) {
    const { item } = ranked[index];
    if (records.length >= maxItems || remaining <= 0) { omittedChars += item.text.length; continue; }
    const openSlots = Math.min(maxItems - records.length, ranked.length - index);
    const allowance = Math.min(MAX_RECORD_CONTEXT_SNIPPET, remaining, Math.ceil(remaining / Math.max(1, openSlots)));
    const excerpt = excerptFor(query, item.text, allowance);
    if (!excerpt.trim()) continue;
    records.push({ id: item.id, title: item.title.slice(0, 180), originLabel: item.originLabel.slice(0, 180),
      provenanceLabel: item.provenanceLabel.slice(0, 100), excerpt, sourceUpdatedAt: item.sourceUpdatedAt,
      ...(item.anchor ? { anchor: item.anchor } : {}) });
    remaining -= excerpt.length;
    if (item.text.length > excerpt.length) omittedChars += item.text.length - excerpt.length;
  }
  const snapshot = { scope: options?.scope ?? 'document', records, omittedCount: Math.max(0, ranked.length - records.length), omittedChars } as ChatRecordContextSnapshot;
  snapshot.snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return snapshot;
}

function studioCandidate(source: StudioSource): LocalRecordCandidate | null {
  if (!source.text.trim() || source.text.length > 100_000) return null;
  const target = source.readerTargets?.[0];
  const anchor = target ? { id: `studio:${source.id}`, scope: 'page' as const, documentId: target.documentId, page: target.page } : undefined;
  return { id: source.id, sourceId: source.id, title: source.title, originLabel: source.originLabel,
    provenanceLabel: provenanceForStudio(source), text: source.text, sourceUpdatedAt: source.sourceUpdatedAt,
    ...(anchor ? { anchor } : {}), kind: source.origin === 'wiki' ? 'wiki' : source.origin === 'knowledge' ? 'knowledge' : 'personal' };
}

function studioDraftCandidate(draft: StudioDraft, documentId?: string, page?: number): LocalRecordCandidate | null {
  const text = draft.text.trim();
  if (!text || text.length > 100_000) return null;
  const hasMatchingAnchor = draft.references.some((reference) => {
    const anchor = reference.evidenceSnapshot?.anchor;
    return Boolean(anchor && anchor.documentId === documentId && (!page || anchor.page === page));
  });
  if (documentId && !hasMatchingAnchor) return null;
  return {
    id: `studio-draft:${draft.id}`,
    title: draft.title.trim() || '제목 없는 Studio 초안',
    originLabel: 'Studio 저장 초안 · 로컬 작업물',
    provenanceLabel: 'Studio 초안 · Knowledge 미게시 · 미검증 · 문헌 근거 아님',
    text: text.slice(0, 100_000),
    sourceUpdatedAt: draft.updatedAt,
    kind: 'studio-draft',
  };
}

export async function retrieveDocumentRecords(input: { documentId: string; query: string; page?: number; excludeIds?: string[]; includeIds?: string[] }): Promise<ChatRecordContextSnapshot> {
  if (!input.documentId || !input.query.trim()) return { scope: 'document', records: [], omittedCount: 0, omittedChars: 0 };
  const document = await getDocumentById(input.documentId);
  if (!document) return { scope: 'document', records: [], omittedCount: 0, omittedChars: 0 };
  const warnings: string[] = [];
  const candidates: LocalRecordCandidate[] = [];
  if (document.currentPath && !document.missing) {
    try {
      const highlights = await listSidecarHighlights(document.currentPath);
      const visualRegions = await listSidecarVisualRegions(document.currentPath);
      for (const highlight of highlights) {
        if (input.page && input.page !== highlight.page) continue;
        const kind = highlight.studyKind || (highlight.type === 'unknown' ? '이해 필요' : '중요');
        const text = [highlight.text, highlight.note?.trim() ? `사용자 메모: ${highlight.note.trim()}` : ''].filter(Boolean).join('\n');
        if (!text.trim()) continue;
        const id = `reader:${document.id}:${highlight.annotationId || highlight.id}`;
        candidates.push({ id, title: `p.${highlight.page} · ${kind}`, originLabel: '현재 PDF · Reader 기록',
          provenanceLabel: `원문 발췌 · ${kind}${highlight.note?.trim() ? ' · 사용자 해석 포함' : ''}`, text,
          sourceUpdatedAt: highlight.updatedAt || highlight.createdAt || '', anchor: anchorForHighlight(highlight, document.id), kind: 'sidecar' });
      }
      for (const region of visualRegions) {
        if (input.page && input.page !== region.page || !region.memo.trim()) continue;
        candidates.push({ id: `region:${document.id}:${region.id}`, title: `p.${region.page} · ${region.kind} 영역 메모`,
          originLabel: '현재 PDF · 사용자가 작성한 영역 메모', provenanceLabel: '사용자 메모 · 그림/영역은 텍스트로 전송하지 않음',
          text: region.memo, sourceUpdatedAt: region.updatedAt, anchor: { id: `region:${region.id}`, scope: 'page', documentId: document.id, page: region.page }, kind: 'sidecar' });
      }
    } catch { warnings.push('Reader sidecar를 읽지 못했습니다.'); }
  } else warnings.push('현재 PDF 파일을 찾지 못해 Reader sidecar를 확인하지 못했습니다.');

  let knowledgeNotes: Awaited<ReturnType<typeof getKnowledgeSnapshot>>['notes'] = [];
  let knowledgeTopics: Awaited<ReturnType<typeof getKnowledgeSnapshot>>['topics'] = [];
  try {
    const knowledge = await getKnowledgeSnapshot();
    knowledgeNotes = knowledge.notes;
    knowledgeTopics = knowledge.topics;
  } catch { warnings.push('Knowledge 자료 일부를 읽지 못했습니다.'); }
  let studio: Awaited<ReturnType<typeof getStudioSnapshot>> = { sources: [], drafts: [], warnings: [] };
  try { studio = await getStudioSnapshot(); }
  catch { warnings.push('Sources 메모 일부를 읽지 못했습니다.'); }
  const { sources: studioSources, drafts: studioDrafts } = studio;
  const studioIds = new Set(studioSources.map((source) => source.id));
  for (const note of knowledgeNotes) {
      if (studioIds.has(`knowledge:${note.id}`)) continue;
      const anchors = note.sourceAnchors ?? [];
      if (!anchors.some((anchor) => anchor.documentId === document.id)) continue;
      const anchor = anchors.find((item) => item.documentId === document.id)!;
      if (input.page && anchor.page && input.page !== anchor.page) continue;
      candidates.push({ id: `knowledge:${note.id}`, title: note.title || note.sourceName, originLabel: `Knowledge 수집 메모 · ${note.sourceName}`,
        provenanceLabel: PROVENANCE_LABELS[note.provenance?.kind ?? ''] ?? '출처 유형 미지정', text: note.rawText, sourceUpdatedAt: note.updatedAt, anchor, kind: 'knowledge' });
  }
  for (const topic of knowledgeTopics) {
      const sourceAnchors = topic.sourceNoteIds.flatMap((id) => knowledgeNotes.find((note) => note.id === id)?.sourceAnchors ?? [])
        .filter((anchor) => anchor.documentId === document.id && (!input.page || !anchor.page || anchor.page === input.page));
      if (!sourceAnchors.length) continue;
      candidates.push({ id: `wiki:${topic.id}:r${topic.revision}`, title: topic.title, originLabel: `Knowledge 위키 · revision ${topic.revision}`,
        provenanceLabel: PROVENANCE_LABELS[topic.provenance?.kind ?? ''] ?? '위키 종합 · 원출처 확인 필요', text: topic.bodyMarkdown, sourceUpdatedAt: topic.updatedAt,
        anchor: sourceAnchors[0], kind: 'wiki' });
  }
  for (const source of studioSources) {
      const candidate = studioCandidate(source);
      if (!candidate) continue;
      const targets = source.readerTargets ?? [];
      const explicitlyLinked = source.documentId === document.id;
      const target = targets.find((item) => item.documentId === document.id && (!input.page || item.page === input.page));
      if (!explicitlyLinked && !target) continue;
      if (input.page && target && target.page !== input.page) continue;
      if (candidate.anchor && target) candidate.anchor = { ...candidate.anchor, documentId: document.id, page: target.page };
      if (source.origin === 'knowledge') {
        const note = knowledgeNotes.find((item) => item.id === source.recordId);
        if (note?.provenance?.kind) candidate.provenanceLabel = PROVENANCE_LABELS[note.provenance.kind];
      }
      candidates.push(candidate);
  }
  for (const draft of studioDrafts) {
    const candidate = studioDraftCandidate(draft, document.id, input.page);
    if (candidate) candidates.push(candidate);
  }
  const excluded = new Set(input.excludeIds ?? []);
  const eligible = candidates.filter((item) => !excluded.has(item.id));
  const result = selectBoundedRecords(input.query, eligible, { limit: 6, totalChars: 8_000, includeIds: input.includeIds });
  result.omittedCount += warnings.length;
  return result;
}

async function collectLibraryRecords(options?: { includeStudioDrafts?: boolean }): Promise<LocalRecordCandidate[]> {
  const [studio, knowledge] = await Promise.all([getStudioSnapshot(), getKnowledgeSnapshot()]);
  const candidates = studio.sources.flatMap((source) => {
    const candidate = studioCandidate(source);
    return candidate ? [candidate] : [];
  });
  if (options?.includeStudioDrafts) {
    for (const draft of studio.drafts) {
      const candidate = studioDraftCandidate(draft);
      if (candidate) candidates.push(candidate);
    }
  }
  const studioIds = new Set(studio.sources.map((source) => source.id));
  for (const topic of knowledge.topics) {
    candidates.push({ id: `wiki:${topic.id}:r${topic.revision}`, title: topic.title, originLabel: `Knowledge 위키 · revision ${topic.revision}`,
      provenanceLabel: PROVENANCE_LABELS[topic.provenance?.kind ?? ''] ?? '위키 종합 · 원출처 확인 필요', text: topic.bodyMarkdown,
      sourceUpdatedAt: topic.updatedAt, kind: 'wiki' });
  }
  for (const note of knowledge.notes) {
    if (studioIds.has(`knowledge:${note.id}`)) continue;
    candidates.push({ id: `knowledge:${note.id}`, title: note.title || note.sourceName, originLabel: `Knowledge 수집 메모 · ${note.sourceName}`,
      provenanceLabel: PROVENANCE_LABELS[note.provenance?.kind ?? ''] ?? '출처 유형 미지정', text: note.rawText,
      sourceUpdatedAt: note.updatedAt, ...(note.sourceAnchors?.[0] ? { anchor: note.sourceAnchors[0] } : {}), kind: 'knowledge' });
  }
  try {
    const documents = (await listDocuments()).filter((document) => document.currentPath && !document.missing).slice(0, 200);
    for (const document of documents) {
      try {
        const [highlights, regions] = await Promise.all([
          listSidecarHighlights(document.currentPath!), listSidecarVisualRegions(document.currentPath!),
        ]);
        for (const highlight of highlights) {
          const text = [highlight.text, highlight.note?.trim() ? `사용자 메모: ${highlight.note.trim()}` : ''].filter(Boolean).join('\n');
          if (!text.trim()) continue;
          const id = `reader:${document.id}:${highlight.annotationId || highlight.id}`;
          candidates.push({ id, title: `${document.displayTitle} · p.${highlight.page}`, originLabel: 'PDF Reader 기록',
            provenanceLabel: `${highlight.studyKind || '중요'} · ${highlight.note?.trim() ? '사용자 메모 포함' : '문헌 발췌'}`, text,
            sourceUpdatedAt: highlight.updatedAt || highlight.createdAt || '', anchor: anchorForHighlight(highlight, document.id), kind: 'sidecar' });
        }
        for (const region of regions) if (region.memo.trim()) candidates.push({
          id: `region:${document.id}:${region.id}`, title: `${document.displayTitle} · p.${region.page} · ${region.kind}`,
          originLabel: 'PDF 영역 기록', provenanceLabel: '사용자 작성 메모 · 이미지는 전송되지 않음', text: region.memo,
          sourceUpdatedAt: region.updatedAt, anchor: { id: `region:${region.id}`, scope: 'page', documentId: document.id, page: region.page }, kind: 'sidecar',
        });
      } catch { /* One unreadable sidecar does not hide other local records. */ }
      if (candidates.length >= MAX_RECORD_CONTEXT_CANDIDATES) break;
    }
  } catch { /* A local index problem leaves Knowledge and personal memos searchable. */ }
  return candidates;
}

export async function searchLibraryRecords(query: string, options?: { includeStudioDrafts?: boolean }): Promise<LocalRecordCandidate[]> {
  const needle = query.trim();
  if (!needle) return [];
  const candidates = await collectLibraryRecords(options);
  const ranked = candidates.map((item, index) => ({ item, score: relevance(needle, item), index }))
    .filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 100);
  return ranked.map(({ item }) => item);
}

export async function selectLibraryRecordSnapshot(query: string, ids: string[], options?: { includeStudioDrafts?: boolean }): Promise<ChatRecordContextSnapshot> {
  const requestedIds = [...new Set(ids)];
  const candidates = await collectLibraryRecords(options);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected = requestedIds.flatMap((id) => {
    const candidate = byId.get(id);
    return candidate ? [candidate] : [];
  });
  return selectBoundedRecords(query, selected, { scope: 'library', includeIds: requestedIds, preserveIncludeOrder: true, limit: 8, totalChars: 8_000 });
}
