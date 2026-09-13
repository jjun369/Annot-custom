import type {
  ChatSourceContext,
} from '@/types';
import type {
  KnowledgeNote,
  KnowledgeSnapshot,
  KnowledgeTopic,
} from '@/lib/knowledge-store';

export type MobileKnowledgeKind = 'topic' | 'note';

export interface MobileKnowledgeShelfItem {
  id: string;
  kind: MobileKnowledgeKind;
  title: string;
  missing: boolean;
  status?: string;
}

export interface MobileKnowledgeListItem {
  id: string;
  kind: MobileKnowledgeKind;
  title: string;
  updatedAt: string;
  status?: string;
}

export interface MobileKnowledgeMissingSelection extends MobileKnowledgeShelfItem {
  missing: true;
}

export interface MobileKnowledgeSelection {
  topics: KnowledgeTopic[];
  notes: KnowledgeNote[];
  missing: MobileKnowledgeMissingSelection[];
}

export interface MobileKnowledgeSourceRef {
  documentId?: string;
  documentTitle?: string;
  page?: number;
}

const KNOWLEDGE_PROVENANCE_LABELS: Record<string, string> = {
  literature_claim: '문헌 주장 · literature claim',
  work_observation: '업무 관찰 · work observation',
  personal_hypothesis: '개인 가설 · personal hypothesis',
  ai_inference: 'AI 추론 · AI inference · 확인 전',
};

let pendingMobileDirtyNotification = false;
let mobileDirtyNotificationGeneration = 0;

export function hasPendingMobileDirtyNotification(): boolean {
  return pendingMobileDirtyNotification;
}

export function getMobileDirtyNotificationGeneration(): number {
  return mobileDirtyNotificationGeneration;
}

export function clearPendingMobileDirtyNotification(expectedGeneration?: number): void {
  if (expectedGeneration !== undefined && expectedGeneration !== mobileDirtyNotificationGeneration) return;
  pendingMobileDirtyNotification = false;
}

function normalizedSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function topicStatus(topic: KnowledgeTopic): string {
  return topic.trust?.reviewRequestedAt ? 'review-requested' : 'current';
}

function topicSearchText(topic: KnowledgeTopic): string {
  return `${topic.title}\n${topic.summary}\n${topic.bodyMarkdown}`;
}

function noteSearchText(note: KnowledgeNote): string {
  return `${note.title}\n${note.sourceName}\n${note.summary}\n${note.rawText}`;
}

function compareListItems(left: MobileKnowledgeListItem, right: MobileKnowledgeListItem): number {
  return right.updatedAt.localeCompare(left.updatedAt)
    || (left.kind === right.kind ? 0 : left.kind === 'topic' ? -1 : 1)
    || left.title.localeCompare(right.title, 'ko')
    || left.id.localeCompare(right.id);
}

export function listMobileKnowledgeItems(
  snapshot: KnowledgeSnapshot,
  query = '',
  offset = 0,
  limit = 50,
): { items: MobileKnowledgeListItem[]; total: number; offset: number; limit: number } {
  const normalizedQuery = normalizedSearch(query.trim());
  const topicsById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
  const notesById = new Map(snapshot.notes.map((note) => [note.id, note]));
  const all = [
    ...snapshot.topics
      .filter((topic) => !normalizedQuery || normalizedSearch(topicSearchText(topic)).includes(normalizedQuery))
      .map((topic): MobileKnowledgeListItem => ({
      id: topic.id,
      kind: 'topic',
      title: topic.title || '제목 없는 Knowledge 주제',
      updatedAt: topic.updatedAt,
      status: topicStatus(topic),
      })),
    ...snapshot.notes
      .filter((note) => note.status !== 'dismissed')
      .filter((note) => !normalizedQuery || normalizedSearch(noteSearchText(note)).includes(normalizedQuery))
      .map((note): MobileKnowledgeListItem => ({
        id: note.id,
        kind: 'note',
        title: note.title || note.sourceName || '제목 없는 캡처 메모',
        updatedAt: note.updatedAt,
        status: note.status,
      })),
  ].filter((item) => item.kind === 'topic' ? topicsById.has(item.id) : notesById.has(item.id)).sort(compareListItems);

  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    offset,
    limit,
  };
}

function missingSelection(kind: MobileKnowledgeKind, id: string, title: string): MobileKnowledgeMissingSelection {
  return { id, kind, title, missing: true };
}

export function selectMobileKnowledge(
  snapshot: KnowledgeSnapshot,
  shelfTopicIds: readonly string[],
  shelfNoteIds: readonly string[],
): MobileKnowledgeSelection {
  const topicsById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
  const notesById = new Map(snapshot.notes.map((note) => [note.id, note]));
  const topics: KnowledgeTopic[] = [];
  const notes: KnowledgeNote[] = [];
  const missing: MobileKnowledgeMissingSelection[] = [];

  for (const id of [...new Set(shelfTopicIds)]) {
    const topic = topicsById.get(id);
    if (topic) topics.push(topic);
    else missing.push(missingSelection('topic', id, '선택한 Knowledge 주제를 찾을 수 없습니다.'));
  }
  for (const id of [...new Set(shelfNoteIds)]) {
    const note = notesById.get(id);
    if (note && note.status !== 'dismissed') notes.push(note);
    else missing.push(missingSelection('note', id, note?.status === 'dismissed'
      ? `${note.title || '선택한 캡처 메모'} · 닫힘`
      : '선택한 캡처 메모를 찾을 수 없습니다.'));
  }
  return { topics, notes, missing };
}

export function getMobileKnowledgeShelf(
  snapshot: KnowledgeSnapshot,
  shelfTopicIds: readonly string[],
  shelfNoteIds: readonly string[],
): MobileKnowledgeShelfItem[] {
  const selected = selectMobileKnowledge(snapshot, shelfTopicIds, shelfNoteIds);
  const topicsById = new Map(selected.topics.map((topic) => [topic.id, topic]));
  const notesById = new Map(selected.notes.map((note) => [note.id, note]));
  const missingByKey = new Map(selected.missing.map((item) => [`${item.kind}:${item.id}`, item]));
  return [
    ...[...new Set(shelfTopicIds)].map((id) => {
      const topic = topicsById.get(id);
      return topic
        ? { id, kind: 'topic' as const, title: topic.title || '제목 없는 Knowledge 주제', missing: false, status: topicStatus(topic) }
        : missingByKey.get(`topic:${id}`)!;
    }),
    ...[...new Set(shelfNoteIds)].map((id) => {
      const note = notesById.get(id);
      return note
        ? { id, kind: 'note' as const, title: note.title || note.sourceName || '제목 없는 캡처 메모', missing: false, status: note.status }
        : missingByKey.get(`note:${id}`)!;
    }),
  ];
}

export function selectAnchoredKnowledgeTopics(
  documentId: string,
  notes: readonly KnowledgeNote[],
  topics: readonly KnowledgeTopic[],
): KnowledgeTopic[] {
  const matchingNoteIds = new Set(notes
    .filter((note) => note.sourceAnchors?.some((anchor) => anchor.documentId === documentId))
    .map((note) => note.id));
  if (matchingNoteIds.size === 0) return [];
  return topics.filter((topic) => topic.sourceNoteIds.some((id) => matchingNoteIds.has(id)));
}

function anchoredTopicIds(
  shelfDocumentIds: readonly string[],
  snapshot: KnowledgeSnapshot,
): Set<string> {
  const ids = new Set<string>();
  for (const documentId of shelfDocumentIds) {
    for (const topic of selectAnchoredKnowledgeTopics(documentId, snapshot.notes, snapshot.topics)) ids.add(topic.id);
  }
  return ids;
}

function topicFingerprint(topic: KnowledgeTopic | undefined, notes: readonly KnowledgeNote[]): string {
  if (!topic) return '';
  return JSON.stringify({
    id: topic.id,
    title: topic.title,
    summary: topic.summary,
    bodyMarkdown: topic.bodyMarkdown,
    sourceNoteIds: topic.sourceNoteIds,
    revision: topic.revision,
    provenance: topic.provenance,
    trust: topic.trust,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
    sourceAnchors: getKnowledgeSourceAnchors(topic, notes).map((anchor) => ({
      documentId: anchor.documentId,
      page: anchor.page,
      highlightId: anchor.highlightId,
      text: anchor.text,
    })),
    sourceNotes: topic.sourceNoteIds.map((id) => noteFingerprint(notes.find((note) => note.id === id))),
  });
}

function noteFingerprint(note: KnowledgeNote | undefined): string {
  if (!note) return '';
  return JSON.stringify({
    id: note.id,
    rawText: note.rawText,
    sourceName: note.sourceName,
    title: note.title,
    summary: note.summary,
    status: note.status,
    provenance: note.provenance,
    sourceAnchors: note.sourceAnchors,
    attachments: note.attachments,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  });
}

export function hasProjectedKnowledgeChange(
  before: KnowledgeSnapshot,
  after: KnowledgeSnapshot,
  settings: { shelfDocumentIds?: readonly string[]; shelfTopicIds?: readonly string[]; shelfNoteIds?: readonly string[] },
): boolean {
  const topicIds = new Set([
    ...(settings.shelfTopicIds ?? []),
    ...anchoredTopicIds(settings.shelfDocumentIds ?? [], before),
    ...anchoredTopicIds(settings.shelfDocumentIds ?? [], after),
  ]);
  const beforeTopics = new Map(before.topics.map((topic) => [topic.id, topic]));
  const afterTopics = new Map(after.topics.map((topic) => [topic.id, topic]));
  if ([...topicIds].some((id) => topicFingerprint(beforeTopics.get(id), before.notes) !== topicFingerprint(afterTopics.get(id), after.notes))) return true;

  const noteIds = new Set(settings.shelfNoteIds ?? []);
  const beforeNotes = new Map(before.notes.map((note) => [note.id, note]));
  const afterNotes = new Map(after.notes.map((note) => [note.id, note]));
  return [...noteIds].some((id) => noteFingerprint(beforeNotes.get(id)) !== noteFingerprint(afterNotes.get(id)));
}

/**
 * Knowledge writes cannot import mobile-bridge at module initialization: the
 * bridge reads this store for its PDF projection. Resolve the notification
 * after the store write so the two persistence queues never wait on each
 * other during module initialization.
 */
export async function notifyMobileBridgeOfKnowledgeChange(
  before: KnowledgeSnapshot,
  after: KnowledgeSnapshot,
): Promise<void> {
  try {
    const bridge = await import('@/lib/mobile-bridge');
    const settings = await bridge.readMobileBridgeSettings();
    if (!hasProjectedKnowledgeChange(before, after, settings)) return;
    await bridge.markMobileBridgeExportDirty();
    pendingMobileDirtyNotification = false;
  } catch {
    // The Knowledge file is already durable. Keep a process-local warning so
    // the bridge cannot claim a clean projection after an optional reminder
    // failure; the next relevant write retries notification.
    pendingMobileDirtyNotification = true;
    mobileDirtyNotificationGeneration += 1;
  }
}

export function knowledgeProvenanceLabel(kind?: string): string {
  return KNOWLEDGE_PROVENANCE_LABELS[kind ?? ''] || '유형 미지정 · 기존 지식 · unspecified legacy knowledge';
}

export function getKnowledgeSourceAnchors(
  record: KnowledgeNote | KnowledgeTopic,
  notes: readonly KnowledgeNote[],
): ChatSourceContext[] {
  const anchors = 'rawText' in record
    ? record.sourceAnchors ?? []
    : notes
      .filter((note) => record.sourceNoteIds.includes(note.id))
      .flatMap((note) => note.sourceAnchors ?? []);
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = `${anchor.documentId ?? ''}:${anchor.page ?? ''}:${anchor.id}:${anchor.text ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((anchor) => ({
    ...anchor,
    // Mobile standalone projections carry the source title/page locator, not
    // an implicit excerpt from an unselected raw note.
    text: undefined,
  }));
}
