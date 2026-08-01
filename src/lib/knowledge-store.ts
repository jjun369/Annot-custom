import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';

export type KnowledgeNoteStatus = 'inbox' | 'review' | 'integrated' | 'dismissed' | 'error';
export type KnowledgeReviewStatus = 'pending' | 'accepted' | 'rejected';
export type KnowledgeReviewKind = 'create' | 'update' | 'conflict';
export type KnowledgeConflictStatus = 'open' | 'resolved' | 'dismissed';

export interface KnowledgeNote {
  id: string;
  rawText: string;
  sourceName: string;
  contentHash: string;
  title: string;
  summary: string;
  status: KnowledgeNoteStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeTopicRevision {
  revision: number;
  title: string;
  summary: string;
  bodyMarkdown: string;
  sourceNoteIds: string[];
  createdAt: string;
  reviewId?: string;
  restoredFromRevision?: number;
  editedBy?: 'user';
  changeNote?: string;
}

export interface KnowledgeRevisionTrashItem {
  id: string;
  topicId: string;
  topicTitle: string;
  revision: KnowledgeTopicRevision;
  sizeBytes: number;
  deletedAt: string;
}

export interface KnowledgeRevisionTrashSnapshot {
  version: 1;
  items: KnowledgeRevisionTrashItem[];
}

export interface KnowledgeStoreInfo {
  activeBytes: number;
  revisionTrashBytes: number;
  revisionTrashCount: number;
}

export interface KnowledgeTopic {
  id: string;
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  sourceNoteIds: string[];
  revision: number;
  revisions: KnowledgeTopicRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeProposal {
  kind: KnowledgeReviewKind;
  topicId: string;
  title: string;
  rationale: string;
  conflictSummary: string;
  proposedSummary: string;
  proposedBodyMarkdown: string;
  sourceClaims: string[];
}

export interface KnowledgeReview extends KnowledgeProposal {
  id: string;
  noteId: string;
  baseRevision: number;
  status: KnowledgeReviewStatus;
  contextWarnings: string[];
  createdAt: string;
  resolvedAt?: string;
}

export interface KnowledgeConflict {
  id: string;
  topicId: string;
  noteId: string;
  reviewId: string;
  title: string;
  summary: string;
  sourceClaims: string[];
  status: KnowledgeConflictStatus;
  resolutionNote: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface KnowledgeSnapshot {
  version: 2;
  notes: KnowledgeNote[];
  topics: KnowledgeTopic[];
  reviews: KnowledgeReview[];
  conflicts: KnowledgeConflict[];
}

export interface CaptureKnowledgeInput {
  text: string;
  sourceName?: string;
}

export interface CaptureKnowledgeResult {
  captured: KnowledgeNote[];
  duplicates: Array<{ sourceName: string; existingNoteId: string }>;
}

const EMPTY_STORE: KnowledgeSnapshot = {
  version: 2,
  notes: [],
  topics: [],
  reviews: [],
  conflicts: [],
};

const EMPTY_REVISION_TRASH: KnowledgeRevisionTrashSnapshot = { version: 1, items: [] };

let writeQueue: Promise<unknown> = Promise.resolve();

interface LoadedKnowledgeStore {
  store: KnowledgeSnapshot;
  legacySource: string | null;
}

function storePath(): string {
  return path.join(getWorkspaceRoot(), '.annot', 'knowledge-store.json');
}

function revisionTrashPath(): string {
  return path.join(getWorkspaceRoot(), '.annot', 'knowledge-revision-trash.json');
}

function timestamp(): string {
  return new Date().toISOString();
}

export function hashKnowledgeText(value: string): string {
  return createHash('sha256').update(value.normalize('NFC'), 'utf8').digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeStore(value: unknown): KnowledgeSnapshot {
  const record = asRecord(value);
  const rawNotes = Array.isArray(record.notes) ? record.notes : [];
  const notes: KnowledgeNote[] = rawNotes.map((item) => {
    const note = asRecord(item);
    const rawText = String(note.rawText ?? '');
    return {
      id: String(note.id ?? randomUUID()),
      rawText,
      sourceName: String(note.sourceName ?? '직접 입력'),
      contentHash: String(note.contentHash ?? hashKnowledgeText(rawText.trim())),
      title: String(note.title ?? rawText.split(/\r?\n/, 1)[0].slice(0, 80)),
      summary: String(note.summary ?? ''),
      status: ['inbox', 'review', 'integrated', 'dismissed', 'error'].includes(String(note.status))
        ? String(note.status) as KnowledgeNoteStatus
        : 'inbox',
      ...(typeof note.error === 'string' ? { error: note.error } : {}),
      createdAt: String(note.createdAt ?? timestamp()),
      updatedAt: String(note.updatedAt ?? note.createdAt ?? timestamp()),
    };
  });

  const rawTopics = Array.isArray(record.topics) ? record.topics : [];
  const topics: KnowledgeTopic[] = rawTopics.map((item) => {
    const topic = asRecord(item);
    const revision = Math.max(1, Number(topic.revision ?? 1));
    const sourceNoteIds = stringArray(topic.sourceNoteIds);
    const rawRevisions = Array.isArray(topic.revisions) ? topic.revisions : [];
    const revisions: KnowledgeTopicRevision[] = rawRevisions.map((entry) => {
      const historical = asRecord(entry);
      return {
        revision: Number(historical.revision ?? 1),
        title: String(historical.title ?? topic.title ?? ''),
        summary: String(historical.summary ?? topic.summary ?? ''),
        bodyMarkdown: String(historical.bodyMarkdown ?? topic.bodyMarkdown ?? ''),
        sourceNoteIds: stringArray(historical.sourceNoteIds),
        createdAt: String(historical.createdAt ?? topic.updatedAt ?? timestamp()),
        ...(typeof historical.reviewId === 'string' ? { reviewId: historical.reviewId } : {}),
        ...(typeof historical.restoredFromRevision === 'number'
          ? { restoredFromRevision: historical.restoredFromRevision }
          : {}),
        ...(historical.editedBy === 'user' ? { editedBy: 'user' as const } : {}),
        ...(typeof historical.changeNote === 'string' ? { changeNote: historical.changeNote } : {}),
      };
    });
    if (!revisions.length) {
      revisions.push({
        revision,
        title: String(topic.title ?? ''),
        summary: String(topic.summary ?? ''),
        bodyMarkdown: String(topic.bodyMarkdown ?? ''),
        sourceNoteIds,
        createdAt: String(topic.updatedAt ?? topic.createdAt ?? timestamp()),
      });
    }
    return {
      id: String(topic.id ?? randomUUID()),
      slug: String(topic.slug ?? ''),
      title: String(topic.title ?? ''),
      summary: String(topic.summary ?? ''),
      bodyMarkdown: String(topic.bodyMarkdown ?? ''),
      sourceNoteIds,
      revision,
      revisions,
      createdAt: String(topic.createdAt ?? timestamp()),
      updatedAt: String(topic.updatedAt ?? topic.createdAt ?? timestamp()),
    };
  });

  const topicRevision = new Map(topics.map((topic) => [topic.id, topic.revision]));
  const rawReviews = Array.isArray(record.reviews) ? record.reviews : [];
  const reviews: KnowledgeReview[] = rawReviews.map((item) => {
    const review = asRecord(item);
    const topicId = String(review.topicId ?? '');
    return {
      id: String(review.id ?? randomUUID()),
      noteId: String(review.noteId ?? ''),
      baseRevision: Number(review.baseRevision ?? topicRevision.get(topicId) ?? 0),
      kind: ['create', 'update', 'conflict'].includes(String(review.kind))
        ? String(review.kind) as KnowledgeReviewKind
        : 'create',
      topicId,
      title: String(review.title ?? ''),
      rationale: String(review.rationale ?? ''),
      conflictSummary: String(review.conflictSummary ?? ''),
      proposedSummary: String(review.proposedSummary ?? ''),
      proposedBodyMarkdown: String(review.proposedBodyMarkdown ?? ''),
      sourceClaims: stringArray(review.sourceClaims),
      status: ['pending', 'accepted', 'rejected'].includes(String(review.status))
        ? String(review.status) as KnowledgeReviewStatus
        : 'pending',
      contextWarnings: stringArray(review.contextWarnings),
      createdAt: String(review.createdAt ?? timestamp()),
      ...(typeof review.resolvedAt === 'string' ? { resolvedAt: review.resolvedAt } : {}),
    };
  });

  const rawConflicts = Array.isArray(record.conflicts) ? record.conflicts : [];
  const conflicts: KnowledgeConflict[] = rawConflicts.map((item) => {
    const conflict = asRecord(item);
    return {
      id: String(conflict.id ?? randomUUID()),
      topicId: String(conflict.topicId ?? ''),
      noteId: String(conflict.noteId ?? ''),
      reviewId: String(conflict.reviewId ?? ''),
      title: String(conflict.title ?? '확인 필요한 충돌'),
      summary: String(conflict.summary ?? ''),
      sourceClaims: stringArray(conflict.sourceClaims),
      status: ['open', 'resolved', 'dismissed'].includes(String(conflict.status))
        ? String(conflict.status) as KnowledgeConflictStatus
        : 'open',
      resolutionNote: String(conflict.resolutionNote ?? ''),
      createdAt: String(conflict.createdAt ?? timestamp()),
      ...(typeof conflict.resolvedAt === 'string' ? { resolvedAt: conflict.resolvedAt } : {}),
    };
  });

  return { version: 2, notes, topics, reviews, conflicts };
}

async function readStore(): Promise<LoadedKnowledgeStore> {
  try {
    const source = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(source) as unknown;
    const version = Number(asRecord(parsed).version ?? 1);
    if (version !== 1 && version !== 2) {
      throw new Error(`지원하지 않는 지식 저장소 버전입니다: ${version}`);
    }
    return {
      store: normalizeStore(parsed),
      legacySource: version === 1 ? source : null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { store: structuredClone(EMPTY_STORE), legacySource: null };
    }
    throw error;
  }
}

async function preserveLegacyStore(destination: string, source: string): Promise<void> {
  const digest = createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 12);
  const backupPath = path.join(path.dirname(destination), `knowledge-store.v1-backup-${digest}.json`);
  const temporary = `${backupPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' });
    if (await fs.readFile(temporary, 'utf8') !== source) {
      throw new Error('v1 지식 저장소 임시 백업 검증에 실패했습니다.');
    }
    await fs.link(temporary, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await fs.readFile(backupPath, 'utf8');
    if (existing !== source) throw new Error('기존 v1 지식 백업의 내용이 원본과 일치하지 않습니다.');
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  const verified = await fs.readFile(backupPath, 'utf8');
  const parsed = JSON.parse(verified) as unknown;
  if (Number(asRecord(parsed).version ?? 1) !== 1 || verified !== source) {
    throw new Error('v1 지식 저장소 백업 검증에 실패했습니다. 원본은 변경하지 않았습니다.');
  }
}

async function writeStore(store: KnowledgeSnapshot, legacySource: string | null): Promise<void> {
  const destination = storePath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (legacySource !== null) await preserveLegacyStore(destination, legacySource);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const serialized = JSON.stringify(store, null, 2);
    const verified = JSON.parse(serialized) as KnowledgeSnapshot;
    if (verified.version !== 2 || !Array.isArray(verified.notes) || !Array.isArray(verified.topics)) {
      throw new Error('v2 지식 저장소 검증에 실패했습니다.');
    }
    await fs.writeFile(temporary, serialized, 'utf8');
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function normalizeRevisionTrash(value: unknown): KnowledgeRevisionTrashSnapshot {
  const record = asRecord(value);
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    version: 1,
    items: items.map((item): KnowledgeRevisionTrashItem | null => {
      const entry = asRecord(item);
      const historical = asRecord(entry.revision);
      if (!entry.id || !entry.topicId || !Number.isInteger(Number(historical.revision))) return null;
      return {
        id: String(entry.id),
        topicId: String(entry.topicId),
        topicTitle: String(entry.topicTitle ?? ''),
        revision: {
          revision: Number(historical.revision),
          title: String(historical.title ?? ''),
          summary: String(historical.summary ?? ''),
          bodyMarkdown: String(historical.bodyMarkdown ?? ''),
          sourceNoteIds: stringArray(historical.sourceNoteIds),
          createdAt: String(historical.createdAt ?? timestamp()),
          ...(typeof historical.reviewId === 'string' ? { reviewId: historical.reviewId } : {}),
          ...(typeof historical.restoredFromRevision === 'number'
            ? { restoredFromRevision: historical.restoredFromRevision }
            : {}),
          ...(historical.editedBy === 'user' ? { editedBy: 'user' as const } : {}),
          ...(typeof historical.changeNote === 'string' ? { changeNote: historical.changeNote } : {}),
        },
        sizeBytes: Math.max(0, Number(entry.sizeBytes ?? 0)),
        deletedAt: String(entry.deletedAt ?? timestamp()),
      };
    }).filter((item): item is KnowledgeRevisionTrashItem => item !== null),
  };
}

async function readRevisionTrash(): Promise<KnowledgeRevisionTrashSnapshot> {
  try {
    return normalizeRevisionTrash(JSON.parse(await fs.readFile(revisionTrashPath(), 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_REVISION_TRASH);
    throw error;
  }
}

async function writeRevisionTrash(trash: KnowledgeRevisionTrashSnapshot): Promise<void> {
  const destination = revisionTrashPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const serialized = JSON.stringify(trash, null, 2);
    const verified = JSON.parse(serialized) as KnowledgeRevisionTrashSnapshot;
    if (verified.version !== 1 || !Array.isArray(verified.items)) {
      throw new Error('revision 휴지통 검증에 실패했습니다.');
    }
    await fs.writeFile(temporary, serialized, 'utf8');
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function runKnowledgeWrite<T>(operation: () => Promise<T>): Promise<T> {
  let result!: T;
  const queued = writeQueue.then(async () => { result = await operation(); });
  writeQueue = queued.catch(() => undefined);
  await queued;
  return result;
}

async function mutateStore<T>(mutation: (store: KnowledgeSnapshot) => T | Promise<T>): Promise<T> {
  let result!: T;
  const operation = writeQueue.then(async () => {
    const loaded = await readStore();
    result = await mutation(loaded.store);
    await writeStore(loaded.store, loaded.legacySource);
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

export async function getKnowledgeSnapshot(): Promise<KnowledgeSnapshot> {
  await writeQueue;
  const { store } = await readStore();
  return {
    ...store,
    notes: [...store.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    topics: [...store.topics].sort((a, b) => a.title.localeCompare(b.title, 'ko')),
    reviews: [...store.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    conflicts: [...store.conflicts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function captureKnowledgeNotes(inputs: CaptureKnowledgeInput[]): Promise<CaptureKnowledgeResult> {
  const prepared = inputs.map((input) => ({
    text: input.text.trim(),
    sourceName: input.sourceName?.trim() || '직접 입력',
  })).filter((input) => input.text.length > 0);
  if (!prepared.length) throw new Error('메모 내용이 비어 있습니다.');
  if (prepared.some((input) => input.text.length > 100_000)) {
    throw new Error('메모 파일 하나의 최대 크기는 100,000자입니다.');
  }

  return await mutateStore((store) => {
    const captured: KnowledgeNote[] = [];
    const duplicates: CaptureKnowledgeResult['duplicates'] = [];
    const knownHashes = new Map(store.notes.map((note) => [note.contentHash, note.id]));
    for (const input of prepared) {
      const contentHash = hashKnowledgeText(input.text);
      const duplicateId = knownHashes.get(contentHash);
      if (duplicateId) {
        duplicates.push({ sourceName: input.sourceName, existingNoteId: duplicateId });
        continue;
      }
      const createdAt = timestamp();
      const note: KnowledgeNote = {
        id: randomUUID(),
        rawText: input.text,
        sourceName: input.sourceName,
        contentHash,
        title: input.text.split(/\r?\n/, 1)[0].slice(0, 80),
        summary: '',
        status: 'inbox',
        createdAt,
        updatedAt: createdAt,
      };
      store.notes.push(note);
      captured.push(note);
      knownHashes.set(contentHash, note.id);
    }
    return { captured, duplicates };
  });
}

export async function captureKnowledgeNote(rawText: string, sourceName = '직접 입력'): Promise<KnowledgeNote> {
  const result = await captureKnowledgeNotes([{ text: rawText, sourceName }]);
  if (!result.captured[0]) throw new Error('이미 같은 내용의 메모가 수집되어 있습니다.');
  return result.captured[0];
}

export async function getKnowledgeNote(id: string): Promise<KnowledgeNote | null> {
  const store = await getKnowledgeSnapshot();
  return store.notes.find((note) => note.id === id) ?? null;
}

export async function markKnowledgeNoteError(id: string, message: string): Promise<void> {
  await mutateStore((store) => {
    const note = store.notes.find((item) => item.id === id);
    if (!note) throw new Error('메모를 찾을 수 없습니다.');
    note.status = 'error';
    note.error = message;
    note.updatedAt = timestamp();
  });
}

export async function resetKnowledgeNoteToInbox(id: string): Promise<void> {
  await mutateStore((store) => {
    const note = store.notes.find((item) => item.id === id);
    if (!note) throw new Error('메모를 찾을 수 없습니다.');
    note.status = 'inbox';
    delete note.error;
    note.updatedAt = timestamp();
  });
}

export async function saveKnowledgeProposals(
  noteId: string,
  analysis: { title: string; summary: string; proposals: KnowledgeProposal[]; contextWarnings?: string[] },
): Promise<KnowledgeReview[]> {
  if (!analysis.proposals.length) throw new Error('AI가 변경안을 만들지 못했습니다.');
  return await mutateStore((store) => {
    const note = store.notes.find((item) => item.id === noteId);
    if (!note) throw new Error('메모를 찾을 수 없습니다.');
    store.reviews = store.reviews.filter((review) => review.noteId !== noteId || review.status !== 'pending');
    const createdAt = timestamp();
    const reviews = analysis.proposals.map((proposal): KnowledgeReview => {
      const topic = proposal.topicId ? store.topics.find((item) => item.id === proposal.topicId) : undefined;
      return {
        ...proposal,
        id: randomUUID(),
        noteId,
        baseRevision: topic?.revision ?? 0,
        status: 'pending',
        contextWarnings: [...(analysis.contextWarnings ?? [])],
        createdAt,
      };
    });
    note.title = analysis.title.trim() || note.title;
    note.summary = analysis.summary.trim();
    note.status = 'review';
    delete note.error;
    note.updatedAt = createdAt;
    store.reviews.push(...reviews);
    return reviews;
  });
}

export async function updateKnowledgeReview(
  reviewId: string,
  update: { title?: string; proposedSummary?: string; proposedBodyMarkdown?: string },
): Promise<KnowledgeReview> {
  return await mutateStore((store) => {
    const review = store.reviews.find((item) => item.id === reviewId);
    if (!review) throw new Error('검토 항목을 찾을 수 없습니다.');
    if (review.status !== 'pending') throw new Error('처리된 변경안은 수정할 수 없습니다.');
    if (typeof update.title === 'string' && update.title.trim()) review.title = update.title.trim();
    if (typeof update.proposedSummary === 'string') review.proposedSummary = update.proposedSummary.trim();
    if (typeof update.proposedBodyMarkdown === 'string' && update.proposedBodyMarkdown.trim()) {
      review.proposedBodyMarkdown = update.proposedBodyMarkdown.trim();
    }
    return review;
  });
}

function slugify(value: string, fallback: string): string {
  const slug = value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return slug || fallback;
}

function topicRevision(
  topic: KnowledgeTopic,
  options: { reviewId?: string; restoredFromRevision?: number; editedBy?: 'user'; changeNote?: string } = {},
): KnowledgeTopicRevision {
  return {
    revision: topic.revision,
    title: topic.title,
    summary: topic.summary,
    bodyMarkdown: topic.bodyMarkdown,
    sourceNoteIds: [...topic.sourceNoteIds],
    createdAt: topic.updatedAt,
    ...(options.reviewId ? { reviewId: options.reviewId } : {}),
    ...(options.restoredFromRevision ? { restoredFromRevision: options.restoredFromRevision } : {}),
    ...(options.editedBy ? { editedBy: options.editedBy } : {}),
    ...(options.changeNote ? { changeNote: options.changeNote } : {}),
  };
}

export async function resolveKnowledgeReview(
  reviewId: string,
  decision: 'accept' | 'reject',
): Promise<{ review: KnowledgeReview; topic?: KnowledgeTopic; conflict?: KnowledgeConflict }> {
  return await mutateStore((store) => {
    const review = store.reviews.find((item) => item.id === reviewId);
    if (!review) throw new Error('검토 항목을 찾을 수 없습니다.');
    if (review.status !== 'pending') throw new Error('이미 처리된 검토 항목입니다.');
    const resolvedAt = timestamp();

    let topic: KnowledgeTopic | undefined;
    let conflict: KnowledgeConflict | undefined;
    if (decision === 'accept') {
      topic = review.topicId ? store.topics.find((item) => item.id === review.topicId) : undefined;
      if (review.kind !== 'create' && !topic) throw new Error('변경 대상 위키 문서를 찾을 수 없습니다.');

      if (review.kind === 'conflict' && topic) {
        conflict = {
          id: randomUUID(),
          topicId: topic.id,
          noteId: review.noteId,
          reviewId: review.id,
          title: review.title,
          summary: review.conflictSummary || review.rationale,
          sourceClaims: [...review.sourceClaims],
          status: 'open',
          resolutionNote: '',
          createdAt: resolvedAt,
        };
        store.conflicts.push(conflict);
      } else if (!topic) {
        const id = randomUUID();
        topic = {
          id,
          slug: slugify(review.title, id.slice(0, 8)),
          title: review.title,
          summary: review.proposedSummary,
          bodyMarkdown: review.proposedBodyMarkdown,
          sourceNoteIds: [review.noteId],
          revision: 1,
          revisions: [],
          createdAt: resolvedAt,
          updatedAt: resolvedAt,
        };
        topic.revisions.push(topicRevision(topic, { reviewId: review.id }));
        store.topics.push(topic);
      } else {
        if (topic.revision !== review.baseRevision) {
          throw new Error(`이 변경안은 revision ${review.baseRevision} 기준입니다. 현재 문서는 revision ${topic.revision}이므로 다시 분석해야 합니다.`);
        }
        topic.title = review.title || topic.title;
        topic.summary = review.proposedSummary;
        topic.bodyMarkdown = review.proposedBodyMarkdown;
        topic.sourceNoteIds = Array.from(new Set([...topic.sourceNoteIds, review.noteId]));
        topic.revision += 1;
        topic.updatedAt = resolvedAt;
        topic.revisions.push(topicRevision(topic, { reviewId: review.id }));
      }
      review.status = 'accepted';
    } else {
      review.status = 'rejected';
    }
    review.resolvedAt = resolvedAt;

    const note = store.notes.find((item) => item.id === review.noteId);
    const pending = store.reviews.some((item) => item.noteId === review.noteId && item.status === 'pending');
    if (note && !pending) {
      note.status = store.reviews.some((item) => item.noteId === review.noteId && item.status === 'accepted')
        ? 'integrated'
        : 'dismissed';
      note.updatedAt = resolvedAt;
    }
    return { review, topic, conflict };
  });
}

export async function resolveKnowledgeConflict(
  conflictId: string,
  status: 'resolved' | 'dismissed',
  resolutionNote = '',
): Promise<KnowledgeConflict> {
  return await mutateStore((store) => {
    const conflict = store.conflicts.find((item) => item.id === conflictId);
    if (!conflict) throw new Error('충돌 기록을 찾을 수 없습니다.');
    conflict.status = status;
    conflict.resolutionNote = resolutionNote.trim();
    conflict.resolvedAt = timestamp();
    return conflict;
  });
}

export async function restoreKnowledgeTopicRevision(topicId: string, revision: number): Promise<KnowledgeTopic> {
  return await mutateStore((store) => {
    const topic = store.topics.find((item) => item.id === topicId);
    if (!topic) throw new Error('위키 문서를 찾을 수 없습니다.');
    const historical = topic.revisions.find((item) => item.revision === revision);
    if (!historical) throw new Error('복원할 revision을 찾을 수 없습니다.');
    if (historical.revision === topic.revision) return topic;
    const restoredAt = timestamp();
    topic.title = historical.title;
    topic.summary = historical.summary;
    topic.bodyMarkdown = historical.bodyMarkdown;
    topic.sourceNoteIds = [...historical.sourceNoteIds];
    topic.revision += 1;
    topic.updatedAt = restoredAt;
    topic.revisions.push(topicRevision(topic, { restoredFromRevision: historical.revision }));
    return topic;
  });
}

export async function editKnowledgeTopic(
  topicId: string,
  update: { title: string; summary: string; bodyMarkdown: string; changeNote?: string },
): Promise<KnowledgeTopic> {
  const title = update.title.trim();
  const bodyMarkdown = update.bodyMarkdown.trim();
  if (!title || !bodyMarkdown) throw new Error('위키 제목과 본문은 비워 둘 수 없습니다.');
  return await mutateStore((store) => {
    const topic = store.topics.find((item) => item.id === topicId);
    if (!topic) throw new Error('위키 문서를 찾을 수 없습니다.');
    const summary = update.summary.trim();
    if (topic.title === title && topic.summary === summary && topic.bodyMarkdown === bodyMarkdown) {
      throw new Error('변경된 내용이 없습니다.');
    }
    topic.title = title;
    topic.summary = summary;
    topic.bodyMarkdown = bodyMarkdown;
    topic.revision += 1;
    topic.updatedAt = timestamp();
    topic.revisions.push(topicRevision(topic, {
      editedBy: 'user',
      changeNote: update.changeNote?.trim(),
    }));
    return topic;
  });
}

export async function getKnowledgeRevisionTrash(): Promise<KnowledgeRevisionTrashSnapshot> {
  await writeQueue;
  const trash = await readRevisionTrash();
  return { ...trash, items: [...trash.items].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)) };
}

export async function trashKnowledgeTopicRevision(
  topicId: string,
  revisionNumber: number,
): Promise<KnowledgeRevisionTrashItem> {
  return await runKnowledgeWrite(async () => {
    const loaded = await readStore();
    const topic = loaded.store.topics.find((item) => item.id === topicId);
    if (!topic) throw new Error('위키 문서를 찾을 수 없습니다.');
    if (revisionNumber === topic.revision) throw new Error('현재 revision은 휴지통으로 옮길 수 없습니다.');
    const historical = topic.revisions.find((item) => item.revision === revisionNumber);
    if (!historical) throw new Error('휴지통으로 옮길 revision을 찾을 수 없습니다.');
    const trash = await readRevisionTrash();
    const existing = trash.items.find((item) => item.topicId === topicId && item.revision.revision === revisionNumber);
    const entry: KnowledgeRevisionTrashItem = existing ?? {
      id: randomUUID(),
      topicId,
      topicTitle: topic.title,
      revision: structuredClone(historical),
      sizeBytes: Buffer.byteLength(JSON.stringify(historical), 'utf8'),
      deletedAt: timestamp(),
    };
    if (!existing) trash.items.push(entry);
    // Publish the recoverable copy before removing the active revision. A crash
    // between these writes can leave a duplicate, but never loses the history.
    await writeRevisionTrash(trash);
    topic.revisions = topic.revisions.filter((item) => item.revision !== revisionNumber);
    await writeStore(loaded.store, loaded.legacySource);
    return entry;
  });
}

export async function restoreTrashedKnowledgeRevision(trashId: string): Promise<KnowledgeTopicRevision> {
  return await runKnowledgeWrite(async () => {
    const trash = await readRevisionTrash();
    const entry = trash.items.find((item) => item.id === trashId);
    if (!entry) throw new Error('휴지통 revision을 찾을 수 없습니다.');
    const loaded = await readStore();
    const topic = loaded.store.topics.find((item) => item.id === entry.topicId);
    if (!topic) throw new Error('revision을 되돌릴 위키 문서를 찾을 수 없습니다.');
    if (!topic.revisions.some((item) => item.revision === entry.revision.revision)) {
      topic.revisions.push(structuredClone(entry.revision));
      topic.revisions.sort((a, b) => a.revision - b.revision);
      await writeStore(loaded.store, loaded.legacySource);
    }
    trash.items = trash.items.filter((item) => item.id !== trashId);
    await writeRevisionTrash(trash);
    return entry.revision;
  });
}

export async function permanentlyDeleteTrashedKnowledgeRevision(trashId: string): Promise<void> {
  await runKnowledgeWrite(async () => {
    const trash = await readRevisionTrash();
    if (!trash.items.some((item) => item.id === trashId)) throw new Error('휴지통 revision을 찾을 수 없습니다.');
    trash.items = trash.items.filter((item) => item.id !== trashId);
    await writeRevisionTrash(trash);
  });
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

export async function getKnowledgeStoreInfo(): Promise<KnowledgeStoreInfo> {
  await writeQueue;
  const [activeBytes, revisionTrashBytes, trash] = await Promise.all([
    fileSize(storePath()),
    fileSize(revisionTrashPath()),
    readRevisionTrash(),
  ]);
  return { activeBytes, revisionTrashBytes, revisionTrashCount: trash.items.length };
}

function searchTerms(value: string): string[] {
  return Array.from(new Set(value.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}#+.]+/u).map((term) => term.trim()).filter((term) => term.length >= 2))).slice(0, 100);
}

export async function findKnowledgeTopicCandidates(text: string, limit = 8): Promise<KnowledgeTopic[]> {
  const store = await getKnowledgeSnapshot();
  const terms = searchTerms(text);
  if (!terms.length) return store.topics.slice(0, Math.min(limit, 4));
  return store.topics
    .map((topic) => {
      const title = topic.title.toLowerCase();
      const haystack = `${topic.title}\n${topic.summary}\n${topic.bodyMarkdown}`.normalize('NFKC').toLowerCase();
      const score = terms.reduce((total, term) => total + (title.includes(term) ? 5 : haystack.includes(term) ? 1 : 0), 0);
      return { topic, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.topic.updatedAt.localeCompare(a.topic.updatedAt))
    .slice(0, limit)
    .map((item) => item.topic);
}
