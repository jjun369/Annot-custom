import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { normalizeChatSourceContext } from '@/lib/ai-providers/source-context';
import { notifyMobileBridgeOfKnowledgeChange } from '@/lib/mobile-knowledge';
import type { ChatSourceContext } from '@/types';

export type KnowledgeNoteStatus = 'inbox' | 'review' | 'integrated' | 'dismissed' | 'error';
export type KnowledgeReviewStatus = 'pending' | 'accepted' | 'rejected';
export type KnowledgeReviewKind = 'create' | 'update' | 'conflict';
export type KnowledgeConflictStatus = 'open' | 'resolved' | 'dismissed';
export type KnowledgeProvenanceKind = 'literature_claim' | 'work_observation' | 'personal_hypothesis' | 'ai_inference';
export type KnowledgeReviewReason = 'manual' | 'source_changed';

/**
 * Provenance says where a captured statement came from. It deliberately does
 * not rank whether that statement is true, current, or more valuable than a
 * different type of evidence.
 */
export interface KnowledgeProvenance {
  kind: KnowledgeProvenanceKind;
  /** A publication, observation, authoring, or answer-generation date. */
  originDate?: string;
  ai?: {
    answerId?: string;
    provider?: string;
    model?: string;
    generatedAt?: string;
  };
}

/** User-controlled attention state. Absence means no warning or expiry. */
export interface KnowledgeTrustState {
  lastReviewedAt?: string;
  reviewRequestedAt?: string;
  reviewReason?: KnowledgeReviewReason;
}

/**
 * A user-selected image kept beside the Knowledge JSON, never embedded in it.
 * `id` deliberately equals the content hash so duplicate diagrams are stored
 * once even when they are referenced by several captured notes.
 */
export interface KnowledgeImageAttachment {
  id: string;
  sha256: string;
  mime: 'image/png' | 'image/jpeg';
  byteLength: number;
}

export interface KnowledgeNote {
  id: string;
  rawText: string;
  sourceName: string;
  contentHash: string;
  title: string;
  summary: string;
  status: KnowledgeNoteStatus;
  provenance?: KnowledgeProvenance;
  /** Existing Reader/Chat anchors are reused; this is not another PDF locator. */
  sourceAnchors?: ChatSourceContext[];
  /** Deliberately captured diagrams, screenshots, or handwritten figures. */
  attachments?: KnowledgeImageAttachment[];
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
  provenance?: KnowledgeProvenance;
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
  provenance?: KnowledgeProvenance;
  trust?: KnowledgeTrustState;
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
  provenance?: KnowledgeProvenance;
  sourceAnchors?: ChatSourceContext[];
  attachments?: KnowledgeImageAttachment[];
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

/**
 * Preserve the v1/v2 text-only hash so existing duplicate detection remains
 * unchanged. Image notes additionally include their immutable blob hashes.
 */
export function hashKnowledgeCapture(text: string, attachments?: readonly KnowledgeImageAttachment[]): string {
  if (!attachments?.length) return hashKnowledgeText(text);
  const hashes = attachments.map((attachment) => attachment.sha256).sort();
  return createHash('sha256')
    .update('pagedock-knowledge-image-note\0', 'utf8')
    .update(text.normalize('NFC'), 'utf8')
    .update('\0', 'utf8')
    .update(hashes.join('\0'), 'utf8')
    .digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

const PROVENANCE_KINDS: readonly KnowledgeProvenanceKind[] = [
  'literature_claim',
  'work_observation',
  'personal_hypothesis',
  'ai_inference',
];

function optionalIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function optionalIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

export function normalizeKnowledgeProvenance(value: unknown): KnowledgeProvenance | undefined {
  const record = asRecord(value);
  const kind = record.kind;
  if (typeof kind !== 'string' || !PROVENANCE_KINDS.includes(kind as KnowledgeProvenanceKind)) {
    return undefined;
  }
  const aiRecord = asRecord(record.ai);
  const ai = kind === 'ai_inference'
    ? {
      ...(typeof aiRecord.answerId === 'string' && aiRecord.answerId.trim()
        ? { answerId: aiRecord.answerId.trim().slice(0, 200) }
        : {}),
      ...(typeof aiRecord.provider === 'string' && aiRecord.provider.trim()
        ? { provider: aiRecord.provider.trim().slice(0, 80) }
        : {}),
      ...(typeof aiRecord.model === 'string' && aiRecord.model.trim()
        ? { model: aiRecord.model.trim().slice(0, 160) }
        : {}),
      ...(optionalIsoTimestamp(aiRecord.generatedAt) ? { generatedAt: optionalIsoTimestamp(aiRecord.generatedAt) } : {}),
    }
    : undefined;

  return {
    kind: kind as KnowledgeProvenanceKind,
    ...(optionalIsoDate(record.originDate) ? { originDate: optionalIsoDate(record.originDate) } : {}),
    ...(ai && Object.keys(ai).length > 0 ? { ai } : {}),
  };
}

export function normalizeKnowledgeSourceAnchors(value: unknown): ChatSourceContext[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const anchors = value
    .slice(0, 16)
    .map((entry) => normalizeChatSourceContext(entry))
    .filter((entry): entry is ChatSourceContext => Boolean(entry));
  return anchors.length ? anchors : undefined;
}

export function normalizeKnowledgeImageAttachments(value: unknown): KnowledgeImageAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const attachments = value.slice(0, 4).flatMap((item): KnowledgeImageAttachment[] => {
    const record = asRecord(item);
    const sha256 = typeof record.sha256 === 'string' ? record.sha256.toLowerCase() : '';
    const mime = record.mime;
    const byteLength = Number(record.byteLength);
    if (!/^[a-f0-9]{64}$/.test(sha256)
      || record.id !== sha256
      || (mime !== 'image/png' && mime !== 'image/jpeg')
      || !Number.isInteger(byteLength)
      || byteLength < 1
      || byteLength > 10 * 1024 * 1024
      || seen.has(sha256)) return [];
    seen.add(sha256);
    return [{ id: sha256, sha256, mime, byteLength }];
  });
  return attachments.length ? attachments : undefined;
}

function normalizeKnowledgeTrust(value: unknown): KnowledgeTrustState | undefined {
  const record = asRecord(value);
  const lastReviewedAt = optionalIsoTimestamp(record.lastReviewedAt);
  const reviewRequestedAt = optionalIsoTimestamp(record.reviewRequestedAt);
  const reviewReason = record.reviewReason === 'manual' || record.reviewReason === 'source_changed'
    ? record.reviewReason
    : undefined;
  if (!lastReviewedAt && !reviewRequestedAt && !reviewReason) return undefined;
  return {
    ...(lastReviewedAt ? { lastReviewedAt } : {}),
    ...(reviewRequestedAt ? { reviewRequestedAt } : {}),
    ...(reviewReason ? { reviewReason } : {}),
  };
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
      ...(normalizeKnowledgeProvenance(note.provenance) ? { provenance: normalizeKnowledgeProvenance(note.provenance) } : {}),
      ...(normalizeKnowledgeSourceAnchors(note.sourceAnchors) ? { sourceAnchors: normalizeKnowledgeSourceAnchors(note.sourceAnchors) } : {}),
      ...(normalizeKnowledgeImageAttachments(note.attachments) ? { attachments: normalizeKnowledgeImageAttachments(note.attachments) } : {}),
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
        ...(normalizeKnowledgeProvenance(historical.provenance)
          ? { provenance: normalizeKnowledgeProvenance(historical.provenance) }
          : {}),
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
        ...(normalizeKnowledgeProvenance(topic.provenance)
          ? { provenance: normalizeKnowledgeProvenance(topic.provenance) }
          : {}),
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
      ...(normalizeKnowledgeProvenance(topic.provenance) ? { provenance: normalizeKnowledgeProvenance(topic.provenance) } : {}),
      ...(normalizeKnowledgeTrust(topic.trust) ? { trust: normalizeKnowledgeTrust(topic.trust) } : {}),
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
          ...(normalizeKnowledgeProvenance(historical.provenance)
            ? { provenance: normalizeKnowledgeProvenance(historical.provenance) }
            : {}),
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
    const before = structuredClone(loaded.store);
    result = await mutation(loaded.store);
    await writeStore(loaded.store, loaded.legacySource);
    try {
      await notifyMobileBridgeOfKnowledgeChange(before, loaded.store);
    } catch {
      // Knowledge persistence must succeed even when the optional derived
      // mobile-dirty reminder cannot be updated.
    }
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
  const invalidAttachments = inputs.some((input) => {
    if (!input.attachments?.length) return false;
    const normalized = normalizeKnowledgeImageAttachments(input.attachments);
    return !normalized || normalized.length !== input.attachments.length;
  });
  if (invalidAttachments) throw new Error('이미지 메모 참조가 올바르지 않습니다. 이미지를 다시 추가해 주세요.');
  const prepared = inputs.map((input) => ({
    text: input.text.trim(),
    sourceName: input.sourceName?.trim() || '직접 입력',
    provenance: normalizeKnowledgeProvenance(input.provenance),
    sourceAnchors: normalizeKnowledgeSourceAnchors(input.sourceAnchors),
    attachments: normalizeKnowledgeImageAttachments(input.attachments),
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
      const contentHash = hashKnowledgeCapture(input.text, input.attachments);
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
        ...(input.provenance ? { provenance: input.provenance } : {}),
        ...(input.sourceAnchors ? { sourceAnchors: input.sourceAnchors } : {}),
        ...(input.attachments ? { attachments: input.attachments } : {}),
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

export async function captureKnowledgeNote(
  rawText: string,
  sourceName = '직접 입력',
  options: Pick<CaptureKnowledgeInput, 'provenance' | 'sourceAnchors' | 'attachments'> = {},
): Promise<KnowledgeNote> {
  const result = await captureKnowledgeNotes([{ text: rawText, sourceName, ...options }]);
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
    ...(topic.provenance ? { provenance: structuredClone(topic.provenance) } : {}),
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
    const note = store.notes.find((item) => item.id === review.noteId);

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
          ...(note?.provenance ? { provenance: structuredClone(note.provenance) } : {}),
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
        if (!topic.provenance && note?.provenance) topic.provenance = structuredClone(note.provenance);
        topic.revision += 1;
        topic.updatedAt = resolvedAt;
        topic.revisions.push(topicRevision(topic, { reviewId: review.id }));
      }
      review.status = 'accepted';
    } else {
      review.status = 'rejected';
    }
    review.resolvedAt = resolvedAt;

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
    topic.provenance = historical.provenance ? structuredClone(historical.provenance) : topic.provenance;
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

/**
 * Marks a topic for a human revisit without changing its current text or
 * creating a revision. Time never creates this state automatically.
 */
export async function requestKnowledgeTopicReview(
  topicId: string,
  reason: KnowledgeReviewReason = 'manual',
): Promise<KnowledgeTopic> {
  return await mutateStore((store) => {
    const topic = store.topics.find((item) => item.id === topicId);
    if (!topic) throw new Error('위키 문서를 찾을 수 없습니다.');
    topic.trust = {
      ...(topic.trust?.lastReviewedAt ? { lastReviewedAt: topic.trust.lastReviewedAt } : {}),
      reviewRequestedAt: timestamp(),
      reviewReason: reason,
    };
    return topic;
  });
}

/**
 * Records that a human rechecked an unchanged topic. This intentionally does
 * not create a synthetic content revision.
 */
export async function completeKnowledgeTopicReview(topicId: string): Promise<KnowledgeTopic> {
  return await mutateStore((store) => {
    const topic = store.topics.find((item) => item.id === topicId);
    if (!topic) throw new Error('위키 문서를 찾을 수 없습니다.');
    const reviewedAt = timestamp();
    topic.trust = { lastReviewedAt: reviewedAt };
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
