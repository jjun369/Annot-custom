import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { listDocuments } from '@/lib/research-db';
import { getKnowledgeSnapshot, captureKnowledgeNotes } from '@/lib/knowledge-store';
import type { KnowledgeNote } from '@/lib/knowledge-store';
import type { ResearchDocument } from '@/types';
import { makeStudioExcerpt } from '@/lib/sources-studio-shared';
import { MAX_STUDIO_REFERENCE_EXCERPT, MAX_STUDIO_TEXT_CHARS, MAX_STUDIO_TITLE_CHARS, SOURCE_KINDS } from '@/lib/sources-studio-shared';
import { normalizeChatSourceContext } from '@/lib/ai-providers/source-context';
import type { StudioSourceKind } from '@/lib/sources-studio-shared';

export { SOURCE_KINDS, buildStudioPrompt, inspectProposalReferenceIds, makeStudioExcerpt } from '@/lib/sources-studio-shared';
export type { StudioSourceKind } from '@/lib/sources-studio-shared';

export interface StudioReference {
  sourceId: string;
  title: string;
  kind: StudioSourceKind;
  originLabel: string;
  sourceUpdatedAt: string;
  excerpt: string;
  includeInRequest: boolean;
  /** Optional immutable citation snapshot for records not registered in Sources. */
  evidenceSnapshot?: { provenanceLabel: string; anchor?: import('@/types').ChatSourceContext };
}

export interface StudioDraft {
  id: string;
  title: string;
  text: string;
  references: StudioReference[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudioSource {
  id: string;
  origin: 'knowledge' | 'research' | 'wiki';
  recordId: string;
  kind: StudioSourceKind;
  title: string;
  originalText: string;
  text: string;
  url?: string;
  tags: string[];
  originLabel: string;
  sourceUpdatedAt: string;
  updatedAt: string;
  documentId?: string;
  relativePath?: string;
  ownsText: boolean;
  readerTargets?: Array<{ documentId: string; page: number; rects?: Array<{ x: number; y: number; width: number; height: number }> }>;
  metadataWarning?: string;
}

interface SourceMetadata {
  id: string;
  kind?: StudioSourceKind;
  title?: string;
  url?: string;
  tags: string[];
  textOverride?: string;
  ownsText?: boolean;
  pendingCapture?: { sourceName: string; text: string };
  textRevisions: Array<{ text: string; savedAt: string }>;
  createdAt: string;
  updatedAt: string;
}

interface StudioStore {
  version: 1;
  sources: SourceMetadata[];
  drafts: StudioDraft[];
}

const EMPTY_STORE: StudioStore = { version: 1, sources: [], drafts: [] };
const MAX_STORE_BYTES = 12 * 1024 * 1024;
const MAX_DRAFTS = 200;
const MAX_SOURCE_METADATA = 5_000;
const MAX_TEXT_CHARS = MAX_STUDIO_TEXT_CHARS;
const MAX_TITLE_CHARS = MAX_STUDIO_TITLE_CHARS;
const MAX_TAGS = 40;
const MAX_TAG_CHARS = 80;
const MAX_REFERENCES = 40;
const MAX_REFERENCE_EXCERPT = MAX_STUDIO_REFERENCE_EXCERPT;

let writeQueue: Promise<unknown> = Promise.resolve();

function storePath(): string {
  return path.join(getWorkspaceRoot(), '.annot', 'sources-studio.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.normalize('NFKC').trim().slice(0, MAX_TAG_CHARS)).filter(Boolean))].slice(0, MAX_TAGS);
}

function validKind(value: unknown): value is StudioSourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value);
}

function normalizeReference(value: unknown): StudioReference | null {
  if (!isRecord(value) || typeof value.sourceId !== 'string' || !value.sourceId.trim()
    || typeof value.title !== 'string' || !validKind(value.kind)
    || typeof value.originLabel !== 'string' || typeof value.sourceUpdatedAt !== 'string'
    || typeof value.excerpt !== 'string' || value.sourceId.length > 220
    || value.title.length > MAX_TITLE_CHARS || value.originLabel.length > 200
    || value.sourceUpdatedAt.length > 80 || value.excerpt.length > MAX_REFERENCE_EXCERPT
    || typeof value.includeInRequest !== 'boolean' || value.sourceId !== value.sourceId.trim()
    || value.title !== value.title.trim() || value.originLabel !== value.originLabel.trim()) return null;
  return {
    ...value,
    sourceId: value.sourceId,
    title: value.title.trim() || '제목 없음',
    kind: value.kind,
    originLabel: value.originLabel,
    sourceUpdatedAt: value.sourceUpdatedAt,
    excerpt: value.excerpt,
    includeInRequest: value.includeInRequest,
    ...(isRecord(value.evidenceSnapshot) && typeof value.evidenceSnapshot.provenanceLabel === 'string'
      ? { evidenceSnapshot: { provenanceLabel: value.evidenceSnapshot.provenanceLabel.slice(0, 180),
        ...(value.evidenceSnapshot.anchor !== undefined && normalizeChatSourceContext(value.evidenceSnapshot.anchor)
          ? { anchor: normalizeChatSourceContext(value.evidenceSnapshot.anchor)! } : {}) } }
      : {}),
  };
}

function normalizeStore(value: unknown): StudioStore {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.drafts)) {
    throw new Error('Sources/Studio 저장 데이터의 형식을 확인할 수 없습니다. 원본 파일은 보존했습니다.');
  }
  if (value.sources.length > MAX_SOURCE_METADATA || value.drafts.length > MAX_DRAFTS) {
    throw new Error('Sources/Studio 저장 데이터가 지원 범위를 넘었습니다. 원본 파일은 보존했습니다.');
  }
  const sources = value.sources.flatMap((entry): SourceMetadata[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()
      || !Array.isArray(entry.textRevisions) || !Array.isArray(entry.tags)
      || (entry.title !== undefined && typeof entry.title !== 'string')
      || (entry.url !== undefined && typeof entry.url !== 'string')
      || (entry.kind !== undefined && !validKind(entry.kind))
      || (entry.textOverride !== undefined && typeof entry.textOverride !== 'string')
      || (entry.ownsText !== undefined && typeof entry.ownsText !== 'boolean')
      || (entry.pendingCapture !== undefined && (!isRecord(entry.pendingCapture)
        || typeof entry.pendingCapture.sourceName !== 'string' || typeof entry.pendingCapture.text !== 'string'))) {
      throw new Error('Sources/Studio 자료 메타데이터가 올바르지 않습니다. 원본 파일은 보존했습니다.');
    }
    if (entry.id.length > 220 || typeof entry.title === 'string' && entry.title.length > MAX_TITLE_CHARS
      || typeof entry.url === 'string' && entry.url.length > 2_000
      || typeof entry.textOverride === 'string' && entry.textOverride.length > MAX_TEXT_CHARS
      || isRecord(entry.pendingCapture) && ((entry.pendingCapture.text as string).length > MAX_TEXT_CHARS || (entry.pendingCapture.sourceName as string).length > 300)) {
      throw new Error('Sources/Studio 자료가 저장 한도를 넘었습니다. 원본 파일은 보존했습니다.');
    }
    const storedTags = entry.tags as unknown[];
    const tags = normalizedTags(storedTags);
    if (storedTags.length > MAX_TAGS || tags.length !== storedTags.length
      || tags.some((tag, index) => tag !== storedTags[index])) throw new Error('Sources/Studio 태그가 올바르지 않습니다. 원본 파일은 보존했습니다.');
    const revisions = entry.textRevisions.flatMap((revision): Array<{ text: string; savedAt: string }> => (
      isRecord(revision) && typeof revision.text === 'string' && typeof revision.savedAt === 'string'
        ? [{ ...revision, text: revision.text, savedAt: revision.savedAt }]
        : []
    ));
    if (revisions.length !== entry.textRevisions.length || revisions.length > 100
      || revisions.some((revision) => revision.text.length > MAX_TEXT_CHARS || revision.savedAt.length > 80)) {
      throw new Error('Sources/Studio 본문 revision이 올바르지 않습니다. 원본 파일은 보존했습니다.');
    }
    if (typeof entry.createdAt !== 'string' || entry.createdAt.length > 80
      || typeof entry.updatedAt !== 'string' || entry.updatedAt.length > 80) {
      throw new Error('Sources/Studio 자료 날짜가 올바르지 않습니다. 원본 파일은 보존했습니다.');
    }
    return [{
      ...entry,
      id: entry.id,
      ...(validKind(entry.kind) ? { kind: entry.kind } : {}),
      ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      tags: normalizedTags(entry.tags),
      ...(typeof entry.textOverride === 'string' ? { textOverride: entry.textOverride } : {}),
      ...(entry.ownsText === true ? { ownsText: true } : {}),
      ...(isRecord(entry.pendingCapture) ? { pendingCapture: { ...entry.pendingCapture, sourceName: entry.pendingCapture.sourceName as string, text: entry.pendingCapture.text as string } } : {}),
      textRevisions: revisions,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }];
  });
  const drafts = value.drafts.flatMap((entry): StudioDraft[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.text !== 'string'
      || typeof entry.title !== 'string' || typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string'
      || !Array.isArray(entry.references) || typeof entry.revision !== 'number' || !Number.isSafeInteger(entry.revision) || entry.revision < 1) throw new Error('Sources/Studio 초안 레코드가 올바르지 않습니다. 원본 파일은 보존했습니다.');
    if (entry.title.length > MAX_TITLE_CHARS || entry.text.length > MAX_TEXT_CHARS
      || entry.references.length > MAX_REFERENCES) throw new Error('Sources/Studio 초안이 저장 한도를 넘었습니다. 원본 파일은 보존했습니다.');
    const references = entry.references.map(normalizeReference);
    if (references.some((item) => !item)) throw new Error('Sources/Studio 참조 레코드가 올바르지 않습니다. 원본 파일은 보존했습니다.');
    return [{
      ...entry,
      id: entry.id,
      title: entry.title,
      text: entry.text,
      references: references as StudioReference[],
      revision: Number.isInteger(entry.revision) && Number(entry.revision) > 0 ? Number(entry.revision) : 1,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }];
  });
  if (sources.length !== value.sources.length || drafts.length !== value.drafts.length) {
    throw new Error('Sources/Studio 저장 데이터의 일부를 해석할 수 없습니다. 원본 파일은 보존했습니다.');
  }
  return { ...value, version: 1, sources, drafts } as StudioStore;
}

async function readStore(): Promise<StudioStore> {
  try {
    const raw = await fs.readFile(storePath());
    if (raw.byteLength > MAX_STORE_BYTES) throw new Error('Sources/Studio 저장 파일이 너무 큽니다. 원본 파일은 보존했습니다.');
    return normalizeStore(JSON.parse(raw.toString('utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_STORE);
    throw error;
  }
}

async function writeStore(store: StudioStore): Promise<void> {
  const file = storePath();
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const serialized = JSON.stringify(store, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) throw new Error('Sources/Studio 저장 한도에 도달했습니다.');
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, serialized, { encoding: 'utf8', flag: 'wx' });
    normalizeStore(JSON.parse(await fs.readFile(temp, 'utf8')) as unknown);
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function mutateStore<T>(mutator: (store: StudioStore) => T): Promise<T> {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    const result = mutator(store);
    await writeStore(store);
    return result;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

function sourceId(origin: StudioSource['origin'], recordId: string): string {
  return `${origin}:${recordId}`;
}

function metadataFor(store: StudioStore, id: string): SourceMetadata | undefined {
  return store.sources.find((source) => source.id === id);
}

function knowledgeOriginLabel(note: KnowledgeNote): string {
  const labels: Record<string, string> = {
    literature_claim: '문헌 주장', work_observation: '업무 관찰',
    personal_hypothesis: '개인 가설', ai_inference: 'AI 추론',
  };
  return note.provenance?.kind ? labels[note.provenance.kind] ?? note.sourceName : note.sourceName;
}

function sourceAnchorsForReader(note: KnowledgeNote): StudioSource['readerTargets'] {
  const grouped = new Map<string, NonNullable<StudioSource['readerTargets']>[number]>();
  for (const anchor of note.sourceAnchors ?? []) {
    const documentId = anchor.documentId?.trim();
    const page = anchor.page;
    if (!documentId || !Number.isSafeInteger(page) || !page || page < 1) continue;
    const current = grouped.get(documentId) ?? { documentId, page, rects: [] };
    if (current.page === page && current.rects && current.rects.length < 8) {
      current.rects.push(...(anchor.rects?.slice(0, 8 - current.rects.length) ?? []));
    }
    grouped.set(documentId, current);
  }
  return [...grouped.values()].slice(0, 3).map((item) => ({
    ...item,
    ...(item.rects?.length ? { rects: item.rects.slice(0, 8) } : {}),
  }));
}

async function reconcilePendingCaptures(resolvedIds = new Map<string, string>()): Promise<string[]> {
  const pendingStore = await readStore();
  const pending = pendingStore.sources.filter((source) => source.pendingCapture);
  const warnings: string[] = [];
  for (const item of pending) {
    const capture = item.pendingCapture!;
    try {
      const result = await captureKnowledgeNotes([{ text: capture.text, sourceName: capture.sourceName }]);
      const noteId = result.captured[0]?.id ?? result.duplicates[0]?.existingNoteId;
      if (!noteId) throw new Error('Knowledge 캡처 ID가 없습니다.');
      await mutateStore((store) => {
        const index = store.sources.findIndex((source) => source.id === item.id && source.pendingCapture);
        if (index < 0) return;
        const current = store.sources[index];
        const destinationId = sourceId('knowledge', noteId);
        const existing = store.sources.find((source) => source.id === destinationId);
        if (existing && existing !== current) {
          existing.kind = current.kind ?? existing.kind;
          existing.title = current.title ?? existing.title;
          existing.url = current.url ?? existing.url;
          existing.tags = [...new Set([...existing.tags, ...current.tags])];
          if (current.textOverride !== undefined) existing.textOverride = current.textOverride;
          existing.ownsText ||= current.ownsText;
          existing.textRevisions.push(...current.textRevisions);
          existing.textRevisions.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
          delete existing.pendingCapture;
          existing.updatedAt = new Date().toISOString();
          store.sources.splice(index, 1);
        } else {
          current.id = destinationId;
          delete current.pendingCapture;
        }
      });
      resolvedIds.set(item.id, sourceId('knowledge', noteId));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Knowledge 캡처 복구를 완료하지 못했습니다.');
    }
  }
  return warnings;
}

function researchKind(document: ResearchDocument): StudioSourceKind {
  if (document.kind === 'patent') return 'patent';
  if (document.kind === 'paper' || document.kind === 'conference') return 'paper';
  return 'official_article';
}

export async function getStudioSnapshot(): Promise<{ drafts: StudioDraft[]; sources: StudioSource[]; warnings: string[] }> {
  await writeQueue;
  const warnings = await reconcilePendingCaptures();
  const [store, knowledge] = await Promise.all([readStore(), getKnowledgeSnapshot()]);
  let documents: ResearchDocument[] = [];
  try {
    documents = await listDocuments();
  } catch {
    warnings.push('리서치 문서 목록을 읽지 못했습니다. 메모와 클립은 계속 사용할 수 있습니다.');
  }
  const sources: StudioSource[] = [];
  for (const note of knowledge.notes) {
    const id = sourceId('knowledge', note.id);
    const metadata = metadataFor(store, id);
    sources.push({
      id, origin: 'knowledge', recordId: note.id,
      kind: metadata?.kind ?? 'memo',
      title: metadata?.title ?? note.title ?? note.sourceName,
      originalText: note.rawText,
      text: metadata?.textOverride ?? note.rawText,
      ...(metadata?.url ? { url: metadata.url } : {}),
      tags: metadata?.tags ?? [],
      originLabel: knowledgeOriginLabel(note),
      sourceUpdatedAt: note.updatedAt,
      updatedAt: metadata?.updatedAt ?? note.updatedAt,
      ownsText: metadata?.ownsText === true,
      ...(sourceAnchorsForReader(note)?.length ? { readerTargets: sourceAnchorsForReader(note) } : {}),
    });
  }
  for (const metadata of store.sources) {
    if (!metadata.pendingCapture) continue;
    sources.push({
      id: metadata.id, origin: 'knowledge', recordId: metadata.id, kind: metadata.kind ?? 'memo',
      title: metadata.title ?? metadata.pendingCapture.sourceName, originalText: metadata.pendingCapture.text,
      text: metadata.textOverride ?? metadata.pendingCapture.text, ...(metadata.url ? { url: metadata.url } : {}),
      tags: metadata.tags, originLabel: 'Knowledge 캡처 복구 대기', sourceUpdatedAt: metadata.updatedAt,
      updatedAt: metadata.updatedAt, ownsText: true,
    });
  }
  for (const topic of knowledge.topics) {
    const id = sourceId('wiki', topic.id);
    const metadata = metadataFor(store, id);
    const sourceNotes = topic.sourceNoteIds.flatMap((noteId) => {
      const note = knowledge.notes.find((item) => item.id === noteId);
      return note ? sourceAnchorsForReader(note) ?? [] : [];
    });
    sources.push({
      id, origin: 'wiki', recordId: topic.id,
      kind: metadata?.kind ?? 'memo',
      title: metadata?.title ?? topic.title,
      originalText: topic.bodyMarkdown,
      text: topic.bodyMarkdown,
      tags: metadata?.tags ?? [],
      originLabel: `지식 위키 · revision ${topic.revision}`,
      sourceUpdatedAt: topic.updatedAt,
      updatedAt: metadata?.updatedAt ?? topic.updatedAt,
      ownsText: false,
      ...(sourceNotes.length ? { readerTargets: sourceNotes.slice(0, 3) } : {}),
    });
  }
  for (const document of documents) {
    const id = sourceId('research', document.id);
    const metadata = metadataFor(store, id);
    const originalText = [document.abstractText, document.doi ? `DOI: ${document.doi}` : ''].filter(Boolean).join('\n\n');
    sources.push({
      id, origin: 'research', recordId: document.id,
      kind: metadata?.kind ?? researchKind(document),
      title: metadata?.title ?? document.displayTitle,
      originalText,
      text: metadata?.textOverride ?? originalText,
      ...(metadata?.url ?? document.sourceUrl ? { url: metadata?.url ?? document.sourceUrl } : {}),
      tags: [...new Set([...document.tags, ...(metadata?.tags ?? [])])],
      originLabel: document.sourceProvider ? `리서치 · ${document.sourceProvider}` : '리서치 문서',
      sourceUpdatedAt: document.updatedAt,
      updatedAt: metadata?.updatedAt ?? document.updatedAt,
      documentId: document.id,
      ...(document.currentPath ? { relativePath: document.currentPath } : {}),
      ownsText: false,
    });
  }
  return {
    drafts: [...store.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    sources: sources.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    warnings,
  };
}

async function beginStudioCapture(input: {
  kind: StudioSourceKind; title: string; url?: string; text: string; tags?: string[]; sourceName: string;
}): Promise<StudioSource> {
  const now = new Date().toISOString();
  const pendingId = `pending:${randomUUID()}`;
  await mutateStore((store) => {
    store.sources.push({
      id: pendingId,
      kind: input.kind,
      title: input.title.slice(0, MAX_TITLE_CHARS),
      ...(input.url ? { url: input.url } : {}),
      tags: normalizedTags(input.tags),
      ownsText: true,
      pendingCapture: { sourceName: input.sourceName, text: input.text },
      textRevisions: [], createdAt: now, updatedAt: now,
    });
  });
  try {
    const resolvedIds = new Map<string, string>();
    const warnings = await reconcilePendingCaptures(resolvedIds);
    if (warnings.length) throw new Error(warnings[0]);
    const snapshot = await getStudioSnapshot();
    const result = snapshot.sources.find((source) => source.id === resolvedIds.get(pendingId));
    if (result) return result;
  } catch (error) {
    return {
      id: pendingId, origin: 'knowledge', recordId: pendingId, kind: input.kind, title: input.title,
      originalText: input.text, text: input.text, ...(input.url ? { url: input.url } : {}),
      tags: normalizedTags(input.tags), originLabel: 'Knowledge 캡처 복구 대기',
      sourceUpdatedAt: now, updatedAt: now, ownsText: true,
      metadataWarning: `자료 텍스트를 복구 가능한 임시 기록으로 보존했습니다. Knowledge 연결은 이후 자동 재시도됩니다. ${error instanceof Error ? error.message : ''}`,
    };
  }
  return {
    id: pendingId, origin: 'knowledge', recordId: pendingId, kind: input.kind, title: input.title,
    originalText: input.text, text: input.text, ...(input.url ? { url: input.url } : {}),
    tags: normalizedTags(input.tags), originLabel: 'Knowledge 캡처 복구 대기',
    sourceUpdatedAt: now, updatedAt: now, ownsText: true,
    metadataWarning: '자료 텍스트는 저장했고 Knowledge 캡처 연결을 다음 불러오기에서 재시도합니다.',
  };
}

export async function createStudioMemo(input: { title?: string; kind?: StudioSourceKind; text: string; tags?: string[] }): Promise<StudioSource> {
  const text = input.text.trim();
  if (!text || text.length > MAX_TEXT_CHARS) throw new Error(`메모는 1자 이상 ${MAX_TEXT_CHARS.toLocaleString()}자 이하로 입력해 주세요.`);
  const kind = input.kind ?? 'memo';
  if (!validKind(kind)) throw new Error('자료 유형이 올바르지 않습니다.');
  const title = input.title?.trim().slice(0, MAX_TITLE_CHARS) || text.split(/\r?\n/, 1)[0].slice(0, MAX_TITLE_CHARS);
  return beginStudioCapture({ kind, title, text, tags: input.tags, sourceName: `Sources 개인 메모 · ${title}`.slice(0, 300) });
}

export async function createStudioClip(input: { title: string; kind?: StudioSourceKind; url?: string; text: string; tags?: string[] }): Promise<StudioSource> {
  const title = input.title.trim().slice(0, MAX_TITLE_CHARS);
  const text = input.text.trim();
  if (!title || !text || text.length > MAX_TEXT_CHARS) throw new Error('클립 제목과 본문을 입력해 주세요. 본문은 200,000자 이하여야 합니다.');
  const kind = input.kind ?? 'web_clip';
  if (!validKind(kind)) throw new Error('자료 유형이 올바르지 않습니다.');
  const url = input.url?.trim();
  if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('URL 형식이 올바르지 않습니다.'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('클립 URL은 HTTP 또는 HTTPS만 허용합니다.');
  }
  return beginStudioCapture({ kind, title, ...(url ? { url } : {}), text, tags: input.tags, sourceName: `클립 · ${title}`.slice(0, 300) });
}

export async function updateStudioSource(input: {
  id: string; expectedUpdatedAt: string; title?: string; kind?: StudioSourceKind; url?: string;
  tags?: string[]; text?: string;
}): Promise<StudioSource> {
  if (!input.id || input.id.length > 220) throw new Error('자료 ID가 올바르지 않습니다.');
  const current = (await getStudioSnapshot()).sources.find((source) => source.id === input.id);
  if (!current) throw new Error('자료를 찾을 수 없습니다.');
  if (current.updatedAt !== input.expectedUpdatedAt) throw new Error('자료가 다른 변경으로 갱신되었습니다. 다시 불러온 뒤 수정해 주세요.');
  if (input.text !== undefined && !current.ownsText) throw new Error('가져온 원문은 immutable Knowledge/Research 데이터입니다. 제목과 태그만 별도 메타데이터로 수정할 수 있습니다.');
  if (input.text !== undefined && (!input.text.trim() || input.text.length > MAX_TEXT_CHARS)) throw new Error('자료 본문은 비워 둘 수 없고 200,000자 이하여야 합니다.');
  if (input.url?.trim()) {
    let parsed: URL;
    try { parsed = new URL(input.url.trim()); } catch { throw new Error('URL 형식이 올바르지 않습니다.'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('자료 URL은 HTTP 또는 HTTPS만 허용합니다.');
  }
  await mutateStore((store) => {
    let metadata = metadataFor(store, input.id);
    if (metadata ? metadata.updatedAt !== input.expectedUpdatedAt : current.updatedAt !== input.expectedUpdatedAt) {
      throw new Error('자료가 다른 변경으로 갱신되었습니다. 다시 불러온 뒤 수정해 주세요.');
    }
    const expectedTime = Date.parse(input.expectedUpdatedAt);
    const now = new Date(Number.isFinite(expectedTime) ? Math.max(Date.now(), expectedTime + 1) : Date.now()).toISOString();
    if (!metadata) {
      metadata = { id: input.id, tags: [], textRevisions: [], createdAt: current.updatedAt, updatedAt: current.updatedAt };
      store.sources.push(metadata);
    }
    if (input.text !== undefined && input.text !== current.text) {
      if (metadata.textRevisions.length >= 100) throw new Error('이 자료의 편집 이력이 최대 100 revision에 도달했습니다. 내보내기/보관 후 새 자료로 분리해 주세요.');
      metadata.textRevisions.push({ text: current.text, savedAt: now });
      metadata.textOverride = input.text;
    }
    if (input.title !== undefined) metadata.title = input.title.trim().slice(0, MAX_TITLE_CHARS);
    if (input.kind !== undefined) {
      if (!validKind(input.kind)) throw new Error('자료 유형이 올바르지 않습니다.');
      metadata.kind = input.kind;
    }
    if (input.url !== undefined) metadata.url = input.url.trim().slice(0, 2_000);
    if (input.tags !== undefined) metadata.tags = normalizedTags(input.tags);
    metadata.updatedAt = now;
  });
  const snapshot = await getStudioSnapshot();
  return snapshot.sources.find((source) => source.id === input.id)!;
}

export function isStudioProposalBaseCurrent(input: {
  draft: StudioDraft | undefined;
  sources: StudioSource[];
  expectedRevision: number;
  expectedTitle: string;
  expectedText: string;
  expectedReferences: StudioReference[];
  selectedSourceIds: string[];
}): boolean {
  const { draft } = input;
  if (!draft || draft.revision !== input.expectedRevision || draft.title !== input.expectedTitle
    || draft.text !== input.expectedText || JSON.stringify(draft.references) !== JSON.stringify(input.expectedReferences)) return false;
  return input.selectedSourceIds.every((id) => {
    const reference = draft.references.find((item) => item.sourceId === id);
    const source = input.sources.find((item) => item.id === id);
    return Boolean(reference?.includeInRequest && source
      && source.sourceUpdatedAt === reference.sourceUpdatedAt
      && source.title === reference.title && source.kind === reference.kind
      && source.originLabel === reference.originLabel
      && makeStudioExcerpt(source.text) === reference.excerpt);
  });
}

export async function validateStudioProposalBase(input: {
  draftId: string; expectedRevision: number; expectedTitle: string; expectedText: string;
  expectedReferences: StudioReference[]; selectedSourceIds: string[];
}): Promise<boolean> {
  const snapshot = await getStudioSnapshot();
  return isStudioProposalBaseCurrent({
    ...input,
    draft: snapshot.drafts.find((item) => item.id === input.draftId),
    sources: snapshot.sources,
  });
}

export async function createStudioDraft(input: { title?: string; text?: string; references?: StudioReference[] } = {}): Promise<StudioDraft> {
  const title = input.title?.trim() || '새 글';
  const text = input.text ?? '';
  const references = (input.references ?? []).map(normalizeReference);
  if (title.length > MAX_TITLE_CHARS || text.length > MAX_TEXT_CHARS) throw new Error('초안 제목 또는 본문이 저장 한도를 넘었습니다.');
  if (references.length > MAX_REFERENCES || references.some((reference) => !reference)
    || new Set(references.map((reference) => reference!.sourceId)).size !== references.length) throw new Error('초안 참조 정보가 올바르지 않습니다.');
  return mutateStore((store) => {
    if (store.drafts.length >= MAX_DRAFTS) throw new Error(`초안은 최대 ${MAX_DRAFTS}개까지 보관할 수 있습니다.`);
    const now = new Date().toISOString();
    const draft: StudioDraft = { id: randomUUID(), title, text, references: references as StudioReference[], revision: 1, createdAt: now, updatedAt: now };
    store.drafts.push(draft);
    return draft;
  });
}

export async function saveStudioDraft(input: {
  id: string; expectedRevision: number; title: string; text: string; references: StudioReference[];
}): Promise<StudioDraft> {
  if (input.title.trim().length > MAX_TITLE_CHARS || input.text.length > MAX_TEXT_CHARS) throw new Error('초안 제목 또는 본문이 저장 한도를 넘었습니다.');
  if (!Array.isArray(input.references) || input.references.length > MAX_REFERENCES) throw new Error(`초안 참조는 최대 ${MAX_REFERENCES}개까지 저장할 수 있습니다.`);
  const references = input.references.map(normalizeReference);
  if (references.some((reference) => !reference)) throw new Error('참조 정보가 올바르지 않습니다.');
  if (new Set(references.map((reference) => reference!.sourceId)).size !== references.length) throw new Error('같은 자료가 중복 선택되었습니다.');
  return mutateStore((store) => {
    const index = store.drafts.findIndex((draft) => draft.id === input.id);
    if (index < 0) throw new Error('초안을 찾을 수 없습니다.');
    const previous = store.drafts[index];
    if (previous.revision !== input.expectedRevision) throw new Error('초안이 다른 변경으로 갱신되었습니다. 다시 불러온 뒤 저장해 주세요.');
    const next: StudioDraft = {
      ...previous, title: input.title.trim() || '제목 없는 초안', text: input.text,
      references: references as StudioReference[], revision: previous.revision + 1, updatedAt: new Date().toISOString(),
    };
    store.drafts[index] = next;
    return next;
  });
}

export async function deleteStudioDraft(id: string): Promise<void> {
  await mutateStore((store) => {
    const index = store.drafts.findIndex((draft) => draft.id === id);
    if (index < 0) throw new Error('초안을 찾을 수 없습니다.');
    store.drafts.splice(index, 1);
  });
}
