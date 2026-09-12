import { createHash, randomUUID } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';

import fontkit from '@pdf-lib/fontkit';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  StandardFonts,
  rgb,
  type PDFPage,
} from 'pdf-lib';

import { getWorkspaceRoot, listSessions, resolveFolderPath } from '@/lib/annot-sessions';
import { getKnowledgeSnapshot, type KnowledgeNote, type KnowledgeTopic } from '@/lib/knowledge-store';
import {
  getKnowledgeSourceAnchors,
  hasPendingMobileDirtyNotification,
  clearPendingMobileDirtyNotification,
  getMobileDirtyNotificationGeneration,
  getMobileKnowledgeShelf,
  knowledgeProvenanceLabel,
  selectAnchoredKnowledgeTopics,
  selectMobileKnowledge,
  type MobileKnowledgeMissingSelection,
  type MobileKnowledgeSourceRef,
} from '@/lib/mobile-knowledge';
import { getPaperMetadata } from '@/lib/paper-metadata';
import {
  listSidecarHighlights,
  listSidecarStudyCards,
  listSidecarVisualRegions,
} from '@/lib/highlight-sidecar';
import { getPageDockConfigDirectory } from '@/lib/platform-paths';
import { getDocumentById, getDocumentByPath } from '@/lib/research-db';
import { getStudyKindLabel, inferStudyKind, isUnresolvedHighlight } from '@/lib/highlight-study';
import { getVisualRegionKindLabel } from '@/lib/visual-regions';
import type { Highlight, ResearchDocument, StudyCard, VisualRegion } from '@/types';

export const MOBILE_BRIDGE_SCHEMA_VERSION = 1;
export const MOBILE_ARTIFACT_FILE = 'PageDock-Mobile.pdf';
export const MOBILE_MANIFEST_FILE = 'manifest.json';
export const MOBILE_AUTO_PUBLISH_DELAY_MS = 90_000;
export const MOBILE_AUTO_PUBLISH_MIN_INTERVAL_MS = 10 * 60_000;
export const MOBILE_AUTO_PUBLISH_RETRY_DELAY_MS = 5 * 60_000;

const MOBILE_PDF_WIDTH = 390;
const MOBILE_PDF_HEIGHT = 844;
const MOBILE_MARGIN = 30;
const MOBILE_CONTENT_WIDTH = MOBILE_PDF_WIDTH - MOBILE_MARGIN * 2;
const MAX_EXPORTED_HIGHLIGHT_CHARS = 12_000;
const MAX_EXPORTED_CHAT_CHARS = 14_000;
const MAX_EXPORTED_MEMO_CHARS = 8_000;
const MAX_VISUAL_REGIONS_PER_DOCUMENT = 12;

export interface MobileBridgeSettings {
  version: 1;
  bridgeRoot?: string;
  shelfDocumentIds: string[];
  shelfTopicIds: string[];
  shelfNoteIds: string[];
  /** A convenience feature only; the Library save path never depends on it. */
  autoPublishEnabled: boolean;
  /** Durable reminder that the derived PDF no longer reflects the Library. */
  mobileExportDirty: boolean;
  mobileExportDirtyAt?: string;
  mobileExportRevision: number;
  lastSuccessfulExportId?: string;
  lastSuccessfulExportAt?: string;
  lastAutomaticPublishAt?: string;
  /** One bounded retry is allowed for a particular dirty revision. */
  autoPublishRetryRevision?: number;
  autoPublishRetryAt?: string;
  lastPublishFailureAt?: string;
  updatedAt?: string;
}

export interface MobileBridgeShelfItem {
  documentId: string;
  title: string;
  path?: string;
  missing: boolean;
}

export interface MobileBridgeInfo {
  bridgeRoot?: string;
  shelf: MobileBridgeShelfItem[];
  knowledgeShelf: Array<{ id: string; kind: 'topic' | 'note'; title: string; missing: boolean }>;
  artifact?: {
    generatedAt: string;
    exportId: string;
    fileName: string;
  };
  conflict: boolean;
  autoPublishEnabled: boolean;
  dirty: boolean;
  status: 'up-to-date' | 'manual-required' | 'automatic-pending' | 'publishing' | 'retry-pending' | 'failed' | 'conflict';
  scheduledAt?: string;
  lastFailureAt?: string;
}

interface MobileManifest {
  schemaVersion: 1;
  exportId: string;
  generatedAt: string;
  artifact: string;
  sha256: string;
}

interface BridgePaths {
  root: string;
  mobile: string;
  inbox: string;
  manualBackups: string;
  autoBackups: string;
  conflicts: string;
  stage: string;
  artifact: string;
  manifest: string;
}

interface CurrentMobilePair {
  state: 'empty' | 'valid' | 'conflict';
  manifest?: MobileManifest;
  exportId?: string;
  generatedAt?: string;
}

interface ExportDocumentData {
  document: ResearchDocument;
  pdfPath: string;
  highlights: Highlight[];
  cards: StudyCard[];
  visualRegions: VisualRegion[];
  chatAnswers: Array<{ question?: string; answer: string; page?: number }>;
  noteMarkdown: string;
  publicationYear?: number;
  knowledgeTopics: KnowledgeTopic[];
}

interface ExportKnowledgeTopic {
  topic: KnowledgeTopic;
  sourceRefs: MobileKnowledgeSourceRef[];
}

interface ExportKnowledgeNote {
  note: KnowledgeNote;
  sourceRefs: MobileKnowledgeSourceRef[];
}

interface ExportKnowledgeData {
  topics: ExportKnowledgeTopic[];
  notes: ExportKnowledgeNote[];
  missing: MobileKnowledgeMissingSelection[];
}

export class MobileBridgeConflictError extends Error {
  constructor(message = '모바일 사본이 외부에서 변경되어 자동 갱신을 멈췄습니다. 수정본을 보존한 뒤 새 사본을 만들거나 나중에 다시 시도해 주세요.') {
    super(message);
    this.name = 'MobileBridgeConflictError';
  }
}

const publishTimers = new Map<string, ReturnType<typeof setTimeout>>();
let scheduledAutomaticPublish: { kind: 'debounce' | 'retry'; at: number } | undefined;
let mobilePublishInFlight: Promise<MobileBridgePublishResult> | undefined;

interface MobileBridgePublishResult {
  exportId: string;
  generatedAt: string;
  documentCount: number;
  topicCount: number;
  noteCount: number;
  skippedKnowledgeCount: number;
}

function settingsFile(): string {
  return path.join(getPageDockConfigDirectory(), 'mobile-bridge.json');
}

function normalizeDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))];
}

const normalizeKnowledgeIds = normalizeDocumentIds;

function normalizeBridgeRoot(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = path.resolve(value.trim());
  if (!path.isAbsolute(normalized)) return undefined;
  return normalized;
}

function normalizeDate(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function normalizeRevision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeSettings(value: unknown): MobileBridgeSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<MobileBridgeSettings> : {};
  return {
    version: MOBILE_BRIDGE_SCHEMA_VERSION,
    bridgeRoot: normalizeBridgeRoot(candidate.bridgeRoot),
    shelfDocumentIds: normalizeDocumentIds(candidate.shelfDocumentIds),
    shelfTopicIds: normalizeKnowledgeIds(candidate.shelfTopicIds),
    shelfNoteIds: normalizeKnowledgeIds(candidate.shelfNoteIds),
    autoPublishEnabled: candidate.autoPublishEnabled === true,
    mobileExportDirty: candidate.mobileExportDirty === true,
    mobileExportDirtyAt: normalizeDate(candidate.mobileExportDirtyAt),
    mobileExportRevision: normalizeRevision(candidate.mobileExportRevision),
    lastSuccessfulExportId: typeof candidate.lastSuccessfulExportId === 'string' && candidate.lastSuccessfulExportId.trim()
      ? candidate.lastSuccessfulExportId.trim()
      : undefined,
    lastSuccessfulExportAt: normalizeDate(candidate.lastSuccessfulExportAt),
    lastAutomaticPublishAt: normalizeDate(candidate.lastAutomaticPublishAt),
    autoPublishRetryRevision: normalizeRevision(candidate.autoPublishRetryRevision) || undefined,
    autoPublishRetryAt: normalizeDate(candidate.autoPublishRetryAt),
    lastPublishFailureAt: normalizeDate(candidate.lastPublishFailureAt),
    updatedAt: normalizeDate(candidate.updatedAt),
  };
}

function isInsidePath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateBridgeRoot(bridgeRoot: string): string {
  const normalized = path.resolve(bridgeRoot);
  const libraryRoot = path.resolve(getWorkspaceRoot());
  if (isInsidePath(normalized, libraryRoot) || isInsidePath(libraryRoot, normalized)) {
    throw new Error('연결 폴더는 PageDock Library와 분리된 폴더로 선택해 주세요. 라이브러리 자체를 동기화 대상으로 쓰지 않습니다.');
  }
  return normalized;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporary, filePath);
  }
}

async function hashFile(filePath: string): Promise<{ size: number; sha256: string }> {
  const data = await fs.readFile(filePath);
  return {
    size: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function timestampForFileName(date = new Date()): string {
  return date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.(\d{3})Z$/, '-$1Z')
    .replace('T', '-');
}

function bridgePaths(bridgeRoot: string): BridgePaths {
  const root = validateBridgeRoot(bridgeRoot);
  const mobile = path.join(root, 'Mobile');
  return {
    root,
    mobile,
    inbox: path.join(root, 'Inbox'),
    manualBackups: path.join(root, 'Backups', 'Manual'),
    autoBackups: path.join(root, 'Backups', 'Auto'),
    conflicts: path.join(mobile, 'Conflicts'),
    stage: path.join(mobile, '.pagedock-stage'),
    artifact: path.join(mobile, MOBILE_ARTIFACT_FILE),
    manifest: path.join(mobile, MOBILE_MANIFEST_FILE),
  };
}

async function ensureBridgeDirectories(paths: BridgePaths): Promise<void> {
  await Promise.all([
    fs.mkdir(paths.mobile, { recursive: true }),
    fs.mkdir(paths.inbox, { recursive: true }),
    fs.mkdir(paths.manualBackups, { recursive: true }),
    fs.mkdir(paths.autoBackups, { recursive: true }),
    fs.mkdir(paths.conflicts, { recursive: true }),
    fs.mkdir(paths.stage, { recursive: true }),
  ]);
}

let mobileSettingsWriteQueue: Promise<unknown> = Promise.resolve();

/**
 * Serializes device-local settings read-modify-write operations within this
 * PageDock process. The app has one desktop writer; this is not a multi-process
 * file lock, and the external bridge remains protected by its PDF/manifest
 * conflict check.
 */
async function readMobileBridgeSettingsFile(): Promise<MobileBridgeSettings> {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(settingsFile(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        version: MOBILE_BRIDGE_SCHEMA_VERSION,
        shelfDocumentIds: [],
        shelfTopicIds: [],
        shelfNoteIds: [],
        autoPublishEnabled: false,
        mobileExportDirty: false,
        mobileExportRevision: 0,
      };
    }
    throw new Error('모바일 연결 설정을 읽지 못했습니다.');
  }
}

export async function readMobileBridgeSettings(): Promise<MobileBridgeSettings> {
  await mobileSettingsWriteQueue;
  return readMobileBridgeSettingsFile();
}

async function persistMobileBridgeSettingsFile(settings: MobileBridgeSettings): Promise<MobileBridgeSettings> {
  const next = normalizeSettings({ ...settings, updatedAt: new Date().toISOString() });
  if (next.bridgeRoot) validateBridgeRoot(next.bridgeRoot);
  await writeJsonAtomic(settingsFile(), next);
  if (next.bridgeRoot) await ensureBridgeDirectories(bridgePaths(next.bridgeRoot));
  return next;
}

async function mutateMobileBridgeSettings(
  mutation: (current: MobileBridgeSettings) => MobileBridgeSettings | Promise<MobileBridgeSettings>,
): Promise<MobileBridgeSettings> {
  let result!: MobileBridgeSettings;
  const operation = mobileSettingsWriteQueue.then(async () => {
    const current = await readMobileBridgeSettingsFile();
    const candidate = await mutation(current);
    const normalizedCurrent = normalizeSettings(current);
    const normalizedCandidate = normalizeSettings(candidate);
    if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedCandidate)) {
      result = normalizedCurrent;
      return;
    }
    result = await persistMobileBridgeSettingsFile(normalizedCandidate);
  });
  mobileSettingsWriteQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

function dirtySettings(current: MobileBridgeSettings): MobileBridgeSettings {
  return {
    ...current,
    mobileExportDirty: true,
    mobileExportDirtyAt: new Date().toISOString(),
    mobileExportRevision: current.mobileExportRevision + 1,
    autoPublishRetryRevision: undefined,
    autoPublishRetryAt: undefined,
    lastPublishFailureAt: undefined,
  };
}

export async function updateMobileBridgeSettings(
  updates: Partial<Pick<MobileBridgeSettings, 'bridgeRoot' | 'shelfDocumentIds' | 'shelfTopicIds' | 'shelfNoteIds' | 'autoPublishEnabled'>>,
): Promise<MobileBridgeSettings> {
  const next = await mutateMobileBridgeSettings((current) => {
    const bridgeRoot = Object.prototype.hasOwnProperty.call(updates, 'bridgeRoot')
      ? normalizeBridgeRoot(updates.bridgeRoot)
      : current.bridgeRoot;
    if (bridgeRoot) validateBridgeRoot(bridgeRoot);
    const nextAutoPublishEnabled = Object.prototype.hasOwnProperty.call(updates, 'autoPublishEnabled')
      ? updates.autoPublishEnabled === true
      : current.autoPublishEnabled;
    const candidate: MobileBridgeSettings = {
      ...current,
      version: MOBILE_BRIDGE_SCHEMA_VERSION,
      bridgeRoot,
      shelfDocumentIds: Object.prototype.hasOwnProperty.call(updates, 'shelfDocumentIds')
        ? normalizeDocumentIds(updates.shelfDocumentIds)
        : current.shelfDocumentIds,
      shelfTopicIds: Object.prototype.hasOwnProperty.call(updates, 'shelfTopicIds')
        ? normalizeKnowledgeIds(updates.shelfTopicIds)
        : current.shelfTopicIds,
      shelfNoteIds: Object.prototype.hasOwnProperty.call(updates, 'shelfNoteIds')
        ? normalizeKnowledgeIds(updates.shelfNoteIds)
        : current.shelfNoteIds,
      autoPublishEnabled: nextAutoPublishEnabled,
      autoPublishRetryRevision: nextAutoPublishEnabled ? current.autoPublishRetryRevision : undefined,
      autoPublishRetryAt: nextAutoPublishEnabled ? current.autoPublishRetryAt : undefined,
    };
    const selectionChanged = (['shelfDocumentIds', 'shelfTopicIds', 'shelfNoteIds'] as const)
      .some((key) => JSON.stringify([...candidate[key]].sort()) !== JSON.stringify([...current[key]].sort()));
    return selectionChanged || candidate.bridgeRoot !== current.bridgeRoot ? dirtySettings(candidate) : candidate;
  });
  if (!next.autoPublishEnabled) clearScheduledMobileBridgePublish();
  if (next.autoPublishEnabled && next.mobileExportDirty) await scheduleMobileBridgePublish();
  return next;
}

export async function addMobileShelfPdf(pdfPath: string): Promise<{ documentId: string; added: boolean }> {
  const document = await getDocumentByPath(pdfPath);
  if (!document) throw new Error('모바일 보관함에 넣기 전에 PDF를 PageDock Library에서 다시 열어 주세요.');
  let added = false;
  const next = await mutateMobileBridgeSettings((current) => {
    added = !current.shelfDocumentIds.includes(document.id);
    return added
      ? dirtySettings({ ...current, shelfDocumentIds: [...current.shelfDocumentIds, document.id] })
      : current;
  });
  if (added && next.autoPublishEnabled && next.mobileExportDirty) await scheduleMobileBridgePublish();
  return { documentId: document.id, added };
}

export async function removeMobileShelfDocument(documentId: string): Promise<MobileBridgeSettings> {
  let removed = false;
  const next = await mutateMobileBridgeSettings((current) => {
    const shelfDocumentIds = current.shelfDocumentIds.filter((candidate) => candidate !== documentId);
    removed = shelfDocumentIds.length !== current.shelfDocumentIds.length;
    return removed ? dirtySettings({ ...current, shelfDocumentIds }) : current;
  });
  if (removed && next.autoPublishEnabled && next.mobileExportDirty) await scheduleMobileBridgePublish();
  return next;
}

export async function addMobileKnowledgeSelection(
  kind: 'topic' | 'note',
  id: string,
): Promise<{ added: boolean; settings: MobileBridgeSettings }> {
  const trimmedId = id.trim();
  if (!trimmedId) throw new Error('Knowledge 선택 ID가 필요합니다.');
  const snapshot = await getKnowledgeSnapshot();
  const record = kind === 'topic'
    ? snapshot.topics.find((topic) => topic.id === trimmedId)
    : snapshot.notes.find((note) => note.id === trimmedId && note.status !== 'dismissed');
  if (!record) throw new Error('선택할 수 있는 Knowledge 기록을 찾을 수 없습니다.');
  let added = false;
  const next = await mutateMobileBridgeSettings((current) => {
    const ids = kind === 'topic' ? current.shelfTopicIds : current.shelfNoteIds;
    if (ids.includes(trimmedId)) return current;
    added = true;
    return dirtySettings(kind === 'topic'
      ? { ...current, shelfTopicIds: [...ids, trimmedId] }
      : { ...current, shelfNoteIds: [...ids, trimmedId] });
  });
  if (next.autoPublishEnabled && next.mobileExportDirty) await scheduleMobileBridgePublish();
  return { added, settings: next };
}

export async function removeMobileKnowledgeSelection(
  kind: 'topic' | 'note',
  id: string,
): Promise<MobileBridgeSettings> {
  const trimmedId = id.trim();
  if (!trimmedId) throw new Error('Knowledge 선택 ID가 필요합니다.');
  const next = await mutateMobileBridgeSettings((current) => {
    const ids = kind === 'topic' ? current.shelfTopicIds : current.shelfNoteIds;
    if (!ids.includes(trimmedId)) return current;
    return dirtySettings(kind === 'topic'
      ? { ...current, shelfTopicIds: ids.filter((candidate) => candidate !== trimmedId) }
      : { ...current, shelfNoteIds: ids.filter((candidate) => candidate !== trimmedId) });
  });
  if (next.autoPublishEnabled && next.mobileExportDirty) await scheduleMobileBridgePublish();
  return next;
}

async function inspectMobilePair(paths: BridgePaths): Promise<CurrentMobilePair> {
  const [pdfResult, manifestResult] = await Promise.allSettled([
    fs.readFile(paths.artifact),
    fs.readFile(paths.manifest, 'utf8'),
  ]);
  if (pdfResult.status === 'rejected' && manifestResult.status === 'rejected') return { state: 'empty' };
  if (pdfResult.status !== 'fulfilled' || manifestResult.status !== 'fulfilled') return { state: 'conflict' };

  let manifest: MobileManifest;
  try {
    manifest = JSON.parse(manifestResult.value) as MobileManifest;
  } catch {
    return { state: 'conflict' };
  }
  if (
    manifest.schemaVersion !== MOBILE_BRIDGE_SCHEMA_VERSION
    || manifest.artifact !== MOBILE_ARTIFACT_FILE
    || typeof manifest.exportId !== 'string'
    || typeof manifest.generatedAt !== 'string'
    || typeof manifest.sha256 !== 'string'
  ) return { state: 'conflict' };
  const sha256 = createHash('sha256').update(pdfResult.value).digest('hex');
  if (sha256 !== manifest.sha256) return { state: 'conflict' };
  try {
    const document = await PDFDocument.load(pdfResult.value, { ignoreEncryption: true });
    if (document.getPageCount() < 1 || !(document.getSubject() || '').includes(manifest.exportId)) {
      return { state: 'conflict' };
    }
  } catch {
    return { state: 'conflict' };
  }
  return {
    state: 'valid',
    manifest,
    exportId: manifest.exportId,
    generatedAt: manifest.generatedAt,
  };
}

async function replaceWithStage(source: string, destination: string, expectedHash: string): Promise<void> {
  const partial = `${destination}.${randomUUID()}.partial`;
  await fs.copyFile(source, partial);
  if ((await hashFile(partial)).sha256 !== expectedHash) {
    await fs.rm(partial, { force: true });
    throw new Error('연결 폴더에 복사한 파일을 검증하지 못했습니다.');
  }
  try {
    await fs.rename(partial, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
    await fs.rm(destination, { force: true });
    await fs.rename(partial, destination);
  }
}

async function readStageManifest(stageDirectory: string): Promise<{ manifest: MobileManifest; pdfPath: string; manifestPath: string } | null> {
  const pdfPath = path.join(stageDirectory, MOBILE_ARTIFACT_FILE);
  const manifestPath = path.join(stageDirectory, MOBILE_MANIFEST_FILE);
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as MobileManifest;
    if (
      manifest.schemaVersion !== MOBILE_BRIDGE_SCHEMA_VERSION
      || manifest.artifact !== MOBILE_ARTIFACT_FILE
      || !manifest.exportId
      || !manifest.sha256
    ) return null;
    if ((await hashFile(pdfPath)).sha256 !== manifest.sha256) return null;
    const pdf = await PDFDocument.load(await fs.readFile(pdfPath), { ignoreEncryption: true });
    if (pdf.getPageCount() < 1 || !(pdf.getSubject() || '').includes(manifest.exportId)) return null;
    return { manifest, pdfPath, manifestPath };
  } catch {
    return null;
  }
}

async function recoverInterruptedMobilePublish(paths: BridgePaths): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(paths.stage, { withFileTypes: true });
  } catch {
    return;
  }
  const stages = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => ({
      directory: path.join(paths.stage, entry.name),
      stage: await readStageManifest(path.join(paths.stage, entry.name)),
    })));
  for (const candidate of stages) {
    if (!candidate.stage) {
      await fs.rm(candidate.directory, { recursive: true, force: true });
      continue;
    }
    const current = await inspectMobilePair(paths);
    if (current.state === 'valid') {
      await fs.rm(candidate.directory, { recursive: true, force: true });
      continue;
    }
    let currentPdfExportId: string | undefined;
    try {
      const currentPdf = await PDFDocument.load(await fs.readFile(paths.artifact), { ignoreEncryption: true });
      const subject = currentPdf.getSubject() || '';
      currentPdfExportId = subject.includes(candidate.stage.manifest.exportId)
        ? candidate.stage.manifest.exportId
        : undefined;
    } catch {
      // A missing final PDF after a failed replace can safely be completed from
      // the verified PageDock stage. Any unrelated existing PDF remains a
      // conflict rather than being overwritten.
    }
    const bothFinalFilesMissing = await Promise.all([paths.artifact, paths.manifest].map(async (filePath) => {
      try {
        await fs.access(filePath);
        return false;
      } catch {
        return true;
      }
    }));
    if (currentPdfExportId === candidate.stage.manifest.exportId || bothFinalFilesMissing.every(Boolean)) {
      await replaceWithStage(candidate.stage.pdfPath, paths.artifact, candidate.stage.manifest.sha256);
      await replaceWithStage(candidate.stage.manifestPath, paths.manifest, createHash('sha256').update(await fs.readFile(candidate.stage.manifestPath)).digest('hex'));
      await fs.rm(candidate.directory, { recursive: true, force: true });
    }
  }
}

function truncated(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n[PageDock 모바일 사본에서는 길이 때문에 일부만 표시했습니다.]`;
}

function titleForDocument(document: ResearchDocument): string {
  return document.displayTitle.trim() || document.fileName?.replace(/\.pdf$/i, '') || '제목 없는 문서';
}

async function resolveKnowledgeSourceRefs(
  anchors: readonly { documentId?: string; page?: number; text?: string }[],
): Promise<MobileKnowledgeSourceRef[]> {
  const documents = new Map<string, string>();
  await Promise.all([...new Set(anchors.map((anchor) => anchor.documentId).filter((id): id is string => Boolean(id)))].map(async (documentId) => {
    const document = await getDocumentById(documentId);
    if (document) documents.set(documentId, titleForDocument(document));
  }));
  return anchors.map((anchor) => ({
    documentId: anchor.documentId,
    documentTitle: anchor.documentId ? documents.get(anchor.documentId) : undefined,
    page: anchor.page,
  }));
}

async function prepareExportKnowledge(
  selection: ReturnType<typeof selectMobileKnowledge>,
  notes: readonly KnowledgeNote[],
): Promise<ExportKnowledgeData> {
  return {
    topics: await Promise.all(selection.topics.map(async (topic) => ({
      topic,
      sourceRefs: await resolveKnowledgeSourceRefs(getKnowledgeSourceAnchors(topic, notes)),
    }))),
    notes: await Promise.all(selection.notes.map(async (note) => ({
      note,
      sourceRefs: await resolveKnowledgeSourceRefs(getKnowledgeSourceAnchors(note, notes)),
    }))),
    missing: selection.missing,
  };
}

function sessionFolder(pdfPath: string): string {
  const folder = path.posix.dirname(pdfPath);
  return folder === '.' ? '' : folder;
}

async function loadExportDocument(documentId: string, knowledge: Awaited<ReturnType<typeof getKnowledgeSnapshot>>): Promise<ExportDocumentData | null> {
  const document = await getDocumentById(documentId);
  if (!document?.currentPath || document.missing) return null;
  const pdfPath = document.currentPath;
  try {
    await fs.access(resolveFolderPath(pdfPath));
  } catch {
    return null;
  }
  const [highlights, cards, visualRegions, metadata, sessions] = await Promise.all([
    listSidecarHighlights(pdfPath),
    listSidecarStudyCards(pdfPath),
    listSidecarVisualRegions(pdfPath),
    getPaperMetadata(pdfPath),
    listSessions(sessionFolder(pdfPath), { sessionKind: 'pdf', pdfPath }),
  ]);
  const chatAnswers = sessions.flatMap((session) => session.messages.flatMap((message) => {
    if (message.role !== 'assistant' || !message.sourceContext || message.sourceContext.documentId !== documentId) return [];
    const question = session.messages.find((candidate) => candidate.id === message.replyToMessageId);
    return [{
      question: question?.content,
      answer: message.content,
      page: message.sourceContext.page,
    }];
  }));
  return {
    document,
    pdfPath,
    highlights,
    cards,
    visualRegions,
    chatAnswers,
    noteMarkdown: metadata.noteMarkdown,
    publicationYear: document.publicationYear,
    knowledgeTopics: selectAnchoredKnowledgeTopics(document.id, knowledge.notes, knowledge.topics),
  };
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const token of paragraph.split(/(\s+)/)) {
      if (/^\s+$/.test(token)) {
        if (current && font.widthOfTextAtSize(`${current}${token}`, size) <= maxWidth) current += token;
        continue;
      }
      if (current && font.widthOfTextAtSize(`${current}${token}`, size) > maxWidth) {
        lines.push(current.trimEnd());
        current = '';
      }
      let chunk = '';
      for (const character of token) {
        const next = `${chunk}${character}`;
        if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
          if (current) {
            lines.push(current.trimEnd());
            current = '';
          }
          lines.push(chunk);
          chunk = character;
        } else {
          chunk = next;
        }
      }
      current += chunk;
    }
    if (current.trim()) lines.push(current.trimEnd());
  }
  return lines.length ? lines : [''];
}

interface PdfComposer {
  document: PDFDocument;
  font: PDFFont;
  boldFont: PDFFont;
  page: PDFPage;
  y: number;
  pages: PDFPage[];
}

function newMobilePage(composer: PdfComposer): void {
  composer.page = composer.document.addPage([MOBILE_PDF_WIDTH, MOBILE_PDF_HEIGHT]);
  composer.pages.push(composer.page);
  composer.y = MOBILE_PDF_HEIGHT - MOBILE_MARGIN;
}

function ensureHeight(composer: PdfComposer, height: number): void {
  if (composer.y - height < MOBILE_MARGIN) newMobilePage(composer);
}

function addLabel(composer: PdfComposer, label: string, color = rgb(0.29, 0.32, 0.36)): void {
  addText(composer, label, { size: 8, bold: true, color });
}

function addText(
  composer: PdfComposer,
  text: string,
  options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gapBefore?: number; gapAfter?: number } = {},
): void {
  const size = options.size ?? 10.5;
  const lineHeight = Math.ceil(size * 1.55);
  const font = options.bold ? composer.boldFont : composer.font;
  composer.y -= options.gapBefore ?? 0;
  const lines = wrapText(font, text, size, MOBILE_CONTENT_WIDTH);
  for (const line of lines) {
    ensureHeight(composer, lineHeight);
    if (line) {
      composer.page.drawText(line, {
        x: MOBILE_MARGIN,
        y: composer.y - size,
        font,
        size,
        color: options.color ?? rgb(0.12, 0.14, 0.16),
      });
    }
    composer.y -= lineHeight;
  }
  composer.y -= options.gapAfter ?? 0;
}

function addRule(composer: PdfComposer): void {
  ensureHeight(composer, 12);
  composer.page.drawLine({
    start: { x: MOBILE_MARGIN, y: composer.y },
    end: { x: MOBILE_PDF_WIDTH - MOBILE_MARGIN, y: composer.y },
    thickness: 0.55,
    color: rgb(0.82, 0.84, 0.86),
  });
  composer.y -= 12;
}

async function addImage(composer: PdfComposer, image: PDFImage, caption: string): Promise<void> {
  const scale = Math.min(MOBILE_CONTENT_WIDTH / image.width, 300 / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ensureHeight(composer, height + 32);
  composer.page.drawImage(image, {
    x: MOBILE_MARGIN + (MOBILE_CONTENT_WIDTH - width) / 2,
    y: composer.y - height,
    width,
    height,
  });
  composer.y -= height + 6;
  addText(composer, caption, { size: 8.5, color: rgb(0.34, 0.38, 0.42), gapAfter: 7 });
}

async function embedFonts(document: PDFDocument): Promise<{ font: PDFFont; boldFont: PDFFont }> {
  document.registerFontkit(fontkit);
  const fontsDirectory = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  try {
    const [normalBytes, boldBytes] = await Promise.all([
      fs.readFile(path.join(fontsDirectory, 'malgun.ttf')),
      fs.readFile(path.join(fontsDirectory, 'malgunbd.ttf')).catch(() => fs.readFile(path.join(fontsDirectory, 'malgun.ttf'))),
    ]);
    return {
      font: await document.embedFont(normalBytes, { subset: true }),
      boldFont: await document.embedFont(boldBytes, { subset: true }),
    };
  } catch {
    return {
      font: await document.embedFont(StandardFonts.Helvetica),
      boldFont: await document.embedFont(StandardFonts.HelveticaBold),
    };
  }
}

async function renderVisualRegionPng(pdfPath: string, region: VisualRegion): Promise<Uint8Array> {
  const canvasApi = { createCanvas, DOMMatrix, ImageData, Path2D };
  Object.assign(globalThis, {
    DOMMatrix: canvasApi.DOMMatrix,
    ImageData: canvasApi.ImageData,
    Path2D: canvasApi.Path2D,
  });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const source = new Uint8Array(await fs.readFile(resolveFolderPath(pdfPath)));
  const loadingTask = pdfjs.getDocument({ data: source, verbosity: 0 } as never);
  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(region.page);
    const initialViewport = page.getViewport({ scale: 1 });
    const regionWidth = Math.max(1, initialViewport.width * region.rect.width);
    const scale = Math.min(4, Math.max(1.5, 1800 / regionWidth));
    const viewport = page.getViewport({ scale });
    const surface = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasFactory = {
      create(width: number, height: number) {
        const canvas = createCanvas(width, height);
        return { canvas, context: canvas.getContext('2d') };
      },
      reset(holder: { canvas: { width: number; height: number } }, width: number, height: number) {
        holder.canvas.width = width;
        holder.canvas.height = height;
      },
      destroy() {},
    };
    await page.render({
      canvasContext: surface.getContext('2d') as unknown as CanvasRenderingContext2D,
      viewport,
      canvasFactory,
    } as never).promise;
    const x = Math.max(0, Math.floor(viewport.width * region.rect.x));
    const y = Math.max(0, Math.floor(viewport.height * region.rect.y));
    const width = Math.min(Math.ceil(viewport.width * region.rect.width), surface.width - x);
    const height = Math.min(Math.ceil(viewport.height * region.rect.height), surface.height - y);
    if (width < 1 || height < 1) throw new Error('시각 기록의 영역을 렌더링하지 못했습니다.');
    const cropped = createCanvas(width, height);
    cropped.getContext('2d').drawImage(surface, x, y, width, height, 0, 0, width, height);
    return cropped.toBuffer('image/png');
  } finally {
    await loadingTask.destroy();
  }
}

function addHighlightRecord(composer: PdfComposer, highlight: Highlight): void {
  const kind = inferStudyKind(highlight);
  addLabel(composer, `${getStudyKindLabel(kind)}${isUnresolvedHighlight(highlight) ? ' · 미해결' : highlight.resolvedAt ? ' · 해결됨' : ''}`);
  addText(composer, truncated(highlight.text, MAX_EXPORTED_HIGHLIGHT_CHARS), { size: 11, gapAfter: 3 });
  if (highlight.note?.trim()) {
    addLabel(composer, '내 메모', rgb(0.32, 0.45, 0.35));
    addText(composer, truncated(highlight.note, MAX_EXPORTED_MEMO_CHARS), { size: 10, gapAfter: 3 });
  }
  addText(composer, `출처 · p.${highlight.page}`, { size: 8.5, color: rgb(0.38, 0.42, 0.46), gapAfter: 8 });
}

function addChatAnswer(composer: PdfComposer, answer: { question?: string; answer: string; page?: number }): void {
  addLabel(composer, `AI 설명${answer.page ? ` · p.${answer.page}` : ''}`, rgb(0.42, 0.33, 0.57));
  if (answer.question?.trim()) {
    addText(composer, `질문 · ${truncated(answer.question, 1200)}`, { size: 9.5, color: rgb(0.25, 0.27, 0.3), gapAfter: 3 });
  }
  addText(composer, truncated(answer.answer, MAX_EXPORTED_CHAT_CHARS), { size: 10, gapAfter: 8 });
}

function addStudyCard(composer: PdfComposer, card: StudyCard): void {
  addLabel(composer, `복습 카드${card.review.nextReviewDate ? ` · 다음 복습 ${card.review.nextReviewDate}` : ''}`);
  addText(composer, `질문 · ${truncated(card.front, 3000)}`, { size: 10, gapAfter: 3 });
  addText(composer, `답 · ${truncated(card.back, 3000)}`, { size: 10, gapAfter: 7 });
}

function addKnowledgeSourceRefs(composer: PdfComposer, refs: readonly MobileKnowledgeSourceRef[]): void {
  if (!refs.length) {
    addText(composer, '출처 연결 · 없음', { size: 8.5, color: rgb(0.38, 0.42, 0.46), gapAfter: 8 });
    return;
  }
  for (const ref of refs) {
    const location = [ref.documentTitle || ref.documentId || '연결된 문서', ref.page ? `p.${ref.page}` : '페이지 정보 없음']
      .filter(Boolean).join(' · ');
    addText(composer, `원문 연결 · ${location}`, { size: 8.5, color: rgb(0.38, 0.42, 0.46), gapAfter: 2 });
  }
  composer.y -= 6;
}

function readableKnowledgeBody(value: string): string {
  return value.replace(/^\s{0,3}#{1,6}\s+/gm, '').trim();
}

function addStandaloneKnowledgeTopic(composer: PdfComposer, entry: ExportKnowledgeTopic): void {
  const topic = entry.topic;
  addLabel(composer, `정리된 Knowledge 주제 · ${knowledgeProvenanceLabel(topic.provenance?.kind)}`, rgb(0.22, 0.38, 0.5));
  addText(composer, topic.title || '제목 없는 Knowledge 주제', { size: 12, bold: true, gapAfter: 2 });
  addText(composer, `현재 revision ${topic.revision} · 수정 ${topic.updatedAt.slice(0, 10)}${topic.provenance?.originDate ? ` · 원출처 날짜 ${topic.provenance.originDate}` : ''}`, {
    size: 8.5,
    color: rgb(0.38, 0.42, 0.46),
    gapAfter: 4,
  });
  if (topic.trust?.lastReviewedAt) addText(composer, `사람 검토 기록 · ${topic.trust.lastReviewedAt.slice(0, 10)} · 사실 검증 표시는 아님`, { size: 8.5, color: rgb(0.38, 0.42, 0.46), gapAfter: 3 });
  if (topic.summary.trim()) addText(composer, `요약 · ${topic.summary}`, { size: 10.5, gapAfter: 4 });
  addText(composer, readableKnowledgeBody(topic.bodyMarkdown) || '[본문 없음]', { size: 12, gapAfter: 4 });
  addKnowledgeSourceRefs(composer, entry.sourceRefs);
}

function addStandaloneKnowledgeNote(composer: PdfComposer, entry: ExportKnowledgeNote): void {
  const note = entry.note;
  const status = ({ inbox: '받은 메모', review: '검토 중', integrated: '주제 반영됨', error: '처리 오류' } as Record<string, string>)[note.status] || note.status;
  addLabel(composer, `캡처한 원문 메모 · ${knowledgeProvenanceLabel(note.provenance?.kind)}`, rgb(0.42, 0.33, 0.57));
  addText(composer, note.title || note.sourceName || '제목 없는 캡처 메모', { size: 12, bold: true, gapAfter: 2 });
  addText(composer, `${status} · ${note.sourceName} · 캡처 ${note.createdAt.slice(0, 10)}${note.provenance?.originDate ? ` · 원출처 날짜 ${note.provenance.originDate}` : ''}`, {
    size: 8.5,
    color: rgb(0.38, 0.42, 0.46),
    gapAfter: 4,
  });
  addText(composer, note.rawText || '[빈 메모]', { size: 12, gapAfter: 4 });
  addKnowledgeSourceRefs(composer, entry.sourceRefs);
}

async function addVisualRegion(composer: PdfComposer, data: ExportDocumentData, region: VisualRegion): Promise<void> {
  addLabel(composer, `${getVisualRegionKindLabel(region.kind)} · p.${region.page}`);
  try {
    const image = await composer.document.embedPng(await renderVisualRegionPng(data.pdfPath, region));
    await addImage(composer, image, `${titleForDocument(data.document)} · p.${region.page}`);
  } catch {
    addText(composer, '[이 시각 기록은 이번 모바일 사본에 이미지를 만들지 못했습니다. Windows PageDock에서 원문 영역을 다시 확인해 주세요.]', {
      size: 9.5,
      color: rgb(0.55, 0.22, 0.18),
      gapAfter: 4,
    });
  }
  if (region.memo.trim()) {
    addLabel(composer, '내 메모', rgb(0.32, 0.45, 0.35));
    addText(composer, truncated(region.memo, MAX_EXPORTED_MEMO_CHARS), { size: 10, gapAfter: 8 });
  }
}

async function buildMobilePdf(
  documents: ExportDocumentData[],
  knowledge: ExportKnowledgeData,
  exportId: string,
  generatedAt: string,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const { font, boldFont } = await embedFonts(document);
  document.setTitle('PageDock Mobile');
  document.setAuthor('PageDock');
  document.setCreator('PageDock');
  document.setProducer('PageDock');
  document.setSubject(`PageDock Mobile export ${exportId}`);
  document.setKeywords(['PageDock Mobile', `export:${exportId}`]);
  const firstPage = document.addPage([MOBILE_PDF_WIDTH, MOBILE_PDF_HEIGHT]);
  const composer: PdfComposer = {
    document,
    font,
    boldFont,
    page: firstPage,
    y: MOBILE_PDF_HEIGHT - MOBILE_MARGIN,
    pages: [firstPage],
  };

  addText(composer, 'PageDock Mobile', { size: 24, bold: true, gapAfter: 8 });
  addText(composer, '읽기 전용 모바일 공부 사본', { size: 12, color: rgb(0.28, 0.32, 0.36), gapAfter: 16 });
  addText(composer, `생성 · ${new Date(generatedAt).toLocaleString('ko-KR')}`, { size: 9.5 });
  const projectedTopicCount = new Set([
    ...documents.flatMap((entry) => entry.knowledgeTopics.map((topic) => topic.id)),
    ...knowledge.topics.map((entry) => entry.topic.id),
  ]).size;
  addText(composer, `모바일 보관함 · ${documents.length}개 문서 · 정리된 지식 주제 ${projectedTopicCount}개 · 캡처 메모 ${knowledge.notes.length}개`, { size: 9.5, gapAfter: 12 });
  addText(composer, '이 파일은 생성 당시 Windows PageDock의 공부 기록 사본입니다. 원문 근거와 편집은 Windows PageDock에서 계속 관리합니다.', {
    size: 10.5,
    color: rgb(0.29, 0.32, 0.36),
    gapAfter: 18,
  });

  if (knowledge.missing.length) {
    addRule(composer);
    addText(composer, `선택했지만 이번 사본에서 찾지 못한 Knowledge ${knowledge.missing.length}개`, { size: 13, bold: true, gapAfter: 5 });
    addText(composer, '선택 자체는 유지됩니다. 원본이 복구되면 다시 발행해 주세요.', { size: 9.5, color: rgb(0.55, 0.22, 0.18), gapAfter: 4 });
    for (const item of knowledge.missing) addText(composer, `${item.kind === 'topic' ? '주제' : '메모'} · ${item.title} · id ${item.id}`, { size: 9, color: rgb(0.55, 0.22, 0.18), gapAfter: 2 });
  }

  const unresolved = documents.flatMap((entry) => entry.highlights
    .filter(isUnresolvedHighlight)
    .map((highlight) => ({ entry, highlight })));
  if (unresolved.length) {
    addRule(composer);
    addText(composer, '먼저 다시 볼 내용', { size: 16, bold: true, gapAfter: 8 });
    for (const { entry, highlight } of unresolved) {
      addText(composer, titleForDocument(entry.document), { size: 9, bold: true, color: rgb(0.24, 0.28, 0.32), gapAfter: 2 });
      addHighlightRecord(composer, highlight);
    }
  }

  for (const entry of documents) {
    newMobilePage(composer);
    addText(composer, titleForDocument(entry.document), { size: 17, bold: true, gapAfter: 4 });
    const authorLine = entry.document.authors.length ? entry.document.authors.slice(0, 3).join(', ') : '';
    addText(composer, [authorLine, entry.publicationYear ? `문헌일자 · ${entry.publicationYear}` : '문헌일자 · 알 수 없음']
      .filter(Boolean).join(' · '), { size: 9.5, color: rgb(0.36, 0.4, 0.44), gapAfter: 11 });

    if (entry.noteMarkdown.trim()) {
      addRule(composer);
      addText(composer, '문서 메모', { size: 13, bold: true, gapAfter: 5 });
      addLabel(composer, '내 메모', rgb(0.32, 0.45, 0.35));
      addText(composer, truncated(entry.noteMarkdown, MAX_EXPORTED_MEMO_CHARS), { size: 10, gapAfter: 8 });
    }

    if (entry.highlights.length) {
      addRule(composer);
      addText(composer, '원문 표시와 메모', { size: 13, bold: true, gapAfter: 5 });
      for (const highlight of entry.highlights) addHighlightRecord(composer, highlight);
    }

    if (entry.chatAnswers.length) {
      addRule(composer);
      addText(composer, '원문에 연결된 AI 대화', { size: 13, bold: true, gapAfter: 5 });
      for (const answer of entry.chatAnswers) addChatAnswer(composer, answer);
    }

    if (entry.cards.length) {
      addRule(composer);
      addText(composer, '복습 카드', { size: 13, bold: true, gapAfter: 5 });
      for (const card of entry.cards) addStudyCard(composer, card);
    }

    if (entry.visualRegions.length) {
      addRule(composer);
      addText(composer, '그림·표·수식 기록', { size: 13, bold: true, gapAfter: 5 });
      const included = entry.visualRegions.slice(0, MAX_VISUAL_REGIONS_PER_DOCUMENT);
      for (const region of included) await addVisualRegion(composer, entry, region);
      if (entry.visualRegions.length > included.length) {
        addText(composer, `이 문서의 시각 기록 ${entry.visualRegions.length - included.length}개는 파일 크기를 제한하기 위해 이번 사본에서 제외했습니다. Windows PageDock에서 원문을 확인해 주세요.`, {
          size: 9.5,
          color: rgb(0.42, 0.38, 0.2),
          gapAfter: 8,
        });
      }
    }

    if (entry.knowledgeTopics.length) {
      addRule(composer);
      addText(composer, '연결된 정리 노트', { size: 13, bold: true, gapAfter: 5 });
      for (const topic of entry.knowledgeTopics) {
        addLabel(composer, `정리된 지식 주제 · ${knowledgeProvenanceLabel(topic.provenance?.kind)}`);
        addText(composer, topic.title, { size: 11, bold: true, gapAfter: 2 });
        if (topic.trust?.lastReviewedAt) addText(composer, `사람 검토 기록 · ${topic.trust.lastReviewedAt.slice(0, 10)} · 사실 검증 표시는 아님`, { size: 8.5, color: rgb(0.38, 0.42, 0.46), gapAfter: 3 });
        addText(composer, readableKnowledgeBody(topic.bodyMarkdown) || '[본문 없음]', { size: 12, gapAfter: 8 });
      }
    }
  }

  if (knowledge.topics.length || knowledge.notes.length) {
    newMobilePage(composer);
    addText(composer, '선택한 Knowledge와 캡처 메모', { size: 17, bold: true, gapAfter: 4 });
    addText(composer, '선택한 현재 주제와 캡처 원문 메모를 문서 기록과 구분해 표시합니다. AI 추론은 확인 전 원본으로 남습니다.', {
      size: 9.5,
      color: rgb(0.36, 0.4, 0.44),
      gapAfter: 11,
    });
    if (knowledge.topics.length) {
      addRule(composer);
      addText(composer, '정리된 Knowledge 주제', { size: 13, bold: true, gapAfter: 5 });
      for (const topic of knowledge.topics) addStandaloneKnowledgeTopic(composer, topic);
    }
    if (knowledge.notes.length) {
      addRule(composer);
      addText(composer, '캡처한 원문 메모', { size: 13, bold: true, gapAfter: 5 });
      for (const note of knowledge.notes) addStandaloneKnowledgeNote(composer, note);
    }
  }

  for (let index = 0; index < composer.pages.length; index += 1) {
    composer.pages[index].drawText(`PageDock Mobile · ${index + 1}/${composer.pages.length}`, {
      x: MOBILE_MARGIN,
      y: 14,
      font,
      size: 7.5,
      color: rgb(0.46, 0.49, 0.52),
    });
  }
  return document.save();
}

async function archiveConflictingPair(paths: BridgePaths): Promise<void> {
  const suffix = timestampForFileName();
  const targets = [
    { source: paths.artifact, target: path.join(paths.conflicts, `PageDock-Mobile.modified-${suffix}.pdf`) },
    { source: paths.manifest, target: path.join(paths.conflicts, `PageDock-Mobile.modified-${suffix}.manifest.json`) },
  ];
  for (const entry of targets) {
    try {
      await fs.copyFile(entry.source, entry.target, fsConstants.COPYFILE_EXCL);
      const source = await hashFile(entry.source);
      const copied = await hashFile(entry.target);
      if (source.sha256 !== copied.sha256 || source.size !== copied.size) throw new Error('수정본 보존 검증에 실패했습니다.');
    } catch (error) {
      await fs.rm(entry.target, { force: true });
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function publishMobileBridgeInternal(options: { preserveConflict?: boolean; automatic?: boolean } = {}): Promise<MobileBridgePublishResult> {
  const settings = await readMobileBridgeSettings();
  const notificationGeneration = getMobileDirtyNotificationGeneration();
  if (!settings.bridgeRoot) throw new Error('먼저 설정에서 모바일 연결 폴더를 지정해 주세요.');
  const paths = bridgePaths(settings.bridgeRoot);
  await ensureBridgeDirectories(paths);
  await recoverInterruptedMobilePublish(paths);

  const current = await inspectMobilePair(paths);
  if (options.automatic && current.state === 'empty' && settings.lastSuccessfulExportId) {
    throw new MobileBridgeConflictError('모바일 사본이 외부에서 제거되어 자동 발행을 멈췄습니다. 필요하면 지금 모바일 사본 발행을 눌러 새 사본을 만들어 주세요.');
  }
  if (current.state === 'conflict' && !options.preserveConflict) throw new MobileBridgeConflictError();
  if (current.state === 'conflict' && options.preserveConflict) await archiveConflictingPair(paths);

  const sourceRevision = settings.mobileExportRevision;

  const knowledge = await getKnowledgeSnapshot();
  const documents = (await Promise.all(settings.shelfDocumentIds.map((id) => loadExportDocument(id, knowledge))))
    .filter((entry): entry is ExportDocumentData => entry !== null);
  const includedTopicIds = new Set<string>();
  for (const entry of documents) {
    entry.knowledgeTopics = entry.knowledgeTopics.filter((topic) => {
      if (includedTopicIds.has(topic.id)) return false;
      includedTopicIds.add(topic.id);
      return true;
    });
  }
  const knowledgeSelection = selectMobileKnowledge(knowledge, settings.shelfTopicIds, settings.shelfNoteIds);
  const anchoredTopicIds = new Set(documents.flatMap((entry) => entry.knowledgeTopics.map((topic) => topic.id)));
  const exportKnowledge = await prepareExportKnowledge({
    ...knowledgeSelection,
    topics: knowledgeSelection.topics.filter((topic) => !anchoredTopicIds.has(topic.id)),
  }, knowledge.notes);
  const projectedTopicCount = new Set([
    ...anchoredTopicIds,
    ...exportKnowledge.topics.map((entry) => entry.topic.id),
  ]).size;
  const exportId = randomUUID();
  const generatedAt = new Date().toISOString();
  const stageDirectory = path.join(paths.stage, exportId);
  await fs.mkdir(stageDirectory, { recursive: true });
  try {
    const pdf = await buildMobilePdf(documents, exportKnowledge, exportId, generatedAt);
    const manifest: MobileManifest = {
      schemaVersion: MOBILE_BRIDGE_SCHEMA_VERSION,
      exportId,
      generatedAt,
      artifact: MOBILE_ARTIFACT_FILE,
      sha256: createHash('sha256').update(pdf).digest('hex'),
    };
    const stagePdf = path.join(stageDirectory, MOBILE_ARTIFACT_FILE);
    const stageManifest = path.join(stageDirectory, MOBILE_MANIFEST_FILE);
    await fs.writeFile(stagePdf, pdf);
    await fs.writeFile(stageManifest, JSON.stringify(manifest, null, 2), 'utf8');
    const verifiedStage = await readStageManifest(stageDirectory);
    if (!verifiedStage) throw new Error('모바일 사본을 검증하지 못했습니다. 이전 정상 사본을 유지합니다.');

    const justBeforeReplace = await inspectMobilePair(paths);
    const pairChangedDuringRender = current.state === 'valid'
      ? justBeforeReplace.state !== 'valid' || justBeforeReplace.exportId !== current.exportId
      : current.state === 'empty'
        ? justBeforeReplace.state !== 'empty'
        : false;
    if (pairChangedDuringRender && !options.preserveConflict) {
      throw new MobileBridgeConflictError('모바일 사본이 만드는 동안 외부에서 변경되었으므로 덮어쓰지 않았습니다. 수정본을 보존한 뒤 새로 만들기를 사용해 주세요.');
    }
    if (justBeforeReplace.state === 'conflict' && !options.preserveConflict) throw new MobileBridgeConflictError();
    if (options.preserveConflict && (justBeforeReplace.state === 'conflict' || pairChangedDuringRender) && current.state !== 'conflict') {
      await archiveConflictingPair(paths);
    }
    await replaceWithStage(stagePdf, paths.artifact, manifest.sha256);
    const manifestHash = (await hashFile(stageManifest)).sha256;
    await replaceWithStage(stageManifest, paths.manifest, manifestHash);
    const finalPair = await inspectMobilePair(paths);
    if (finalPair.state !== 'valid' || finalPair.exportId !== exportId) {
      throw new Error('모바일 사본의 최종 검증에 실패했습니다.');
    }
    const persisted = await mutateMobileBridgeSettings((latest) => {
      const hasNewerExportInput = latest.mobileExportRevision !== sourceRevision;
      return {
        ...latest,
        mobileExportDirty: hasNewerExportInput,
        mobileExportDirtyAt: hasNewerExportInput ? latest.mobileExportDirtyAt : undefined,
        lastSuccessfulExportId: exportId,
        lastSuccessfulExportAt: generatedAt,
        lastAutomaticPublishAt: options.automatic ? generatedAt : latest.lastAutomaticPublishAt,
        autoPublishRetryRevision: undefined,
        autoPublishRetryAt: undefined,
        lastPublishFailureAt: undefined,
      };
    });
    if (!persisted.mobileExportDirty) clearPendingMobileDirtyNotification(notificationGeneration);
    if (!options.automatic) clearScheduledMobileBridgePublish();
    if (persisted.autoPublishEnabled && persisted.mobileExportDirty) await scheduleMobileBridgePublish();
    return {
      exportId,
      generatedAt,
      documentCount: documents.length,
      topicCount: projectedTopicCount,
      noteCount: exportKnowledge.notes.length,
      skippedKnowledgeCount: exportKnowledge.missing.length,
    };
  } finally {
    await fs.rm(stageDirectory, { recursive: true, force: true });
  }
}

export async function publishMobileBridge(options: { preserveConflict?: boolean; automatic?: boolean } = {}): Promise<MobileBridgePublishResult> {
  if (mobilePublishInFlight) return mobilePublishInFlight;
  mobilePublishInFlight = publishMobileBridgeInternal(options);
  try {
    return await mobilePublishInFlight;
  } finally {
    mobilePublishInFlight = undefined;
  }
}

function configuredDuration(environmentVariable: string, fallback: number): number {
  const value = Number(process.env[environmentVariable] || fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clearScheduledMobileBridgePublish(): void {
  const timerKey = 'mobile-bridge';
  const existing = publishTimers.get(timerKey);
  if (existing) clearTimeout(existing);
  publishTimers.delete(timerKey);
  scheduledAutomaticPublish = undefined;
}

export function getNextMobileBridgeAutomaticPublishAt(settings: Pick<MobileBridgeSettings, 'autoPublishEnabled' | 'mobileExportDirty' | 'mobileExportDirtyAt' | 'lastAutomaticPublishAt'>, now = Date.now()): number | undefined {
  if (!settings.autoPublishEnabled || !settings.mobileExportDirty) return undefined;
  const dirtyAt = Date.parse(settings.mobileExportDirtyAt || '');
  const idleAfter = Number.isFinite(dirtyAt)
    ? dirtyAt + configuredDuration('PAGEDOCK_MOBILE_BRIDGE_AUTO_PUBLISH_MS', MOBILE_AUTO_PUBLISH_DELAY_MS)
    : now + configuredDuration('PAGEDOCK_MOBILE_BRIDGE_AUTO_PUBLISH_MS', MOBILE_AUTO_PUBLISH_DELAY_MS);
  const lastAutoAt = Date.parse(settings.lastAutomaticPublishAt || '');
  const rateLimitedAfter = Number.isFinite(lastAutoAt)
    ? lastAutoAt + configuredDuration('PAGEDOCK_MOBILE_BRIDGE_AUTO_PUBLISH_MIN_INTERVAL_MS', MOBILE_AUTO_PUBLISH_MIN_INTERVAL_MS)
    : now;
  return Math.max(now, idleAfter, rateLimitedAfter);
}

async function recordAutomaticPublishFailure(): Promise<void> {
  let retryAt: string | undefined;
  await mutateMobileBridgeSettings((latest) => {
    if (!latest.autoPublishEnabled || !latest.mobileExportDirty) return latest;
    if (latest.autoPublishRetryRevision !== latest.mobileExportRevision) {
      retryAt = new Date(Date.now() + configuredDuration('PAGEDOCK_MOBILE_BRIDGE_AUTO_PUBLISH_RETRY_MS', MOBILE_AUTO_PUBLISH_RETRY_DELAY_MS)).toISOString();
      return {
        ...latest,
        autoPublishRetryRevision: latest.mobileExportRevision,
        autoPublishRetryAt: retryAt,
        lastPublishFailureAt: new Date().toISOString(),
      };
    }
    return {
      ...latest,
      autoPublishRetryAt: undefined,
      lastPublishFailureAt: new Date().toISOString(),
    };
  });
  if (retryAt) scheduleMobileBridgePublishAt(Date.parse(retryAt), 'retry');
}

async function runAutomaticMobileBridgePublish(): Promise<void> {
  const settings = await readMobileBridgeSettings();
  if (!settings.autoPublishEnabled || !settings.mobileExportDirty || !settings.bridgeRoot) return;
  if (mobilePublishInFlight) {
    try {
      await mobilePublishInFlight;
    } catch {
      // The active publish owns its own failure handling. The dirty state stays durable.
    }
    await scheduleMobileBridgePublish();
    return;
  }
  try {
    await publishMobileBridge({ automatic: true });
  } catch (error) {
    if (error instanceof MobileBridgeConflictError) return;
    await recordAutomaticPublishFailure();
    return;
  }
  const latest = await readMobileBridgeSettings();
  if (latest.autoPublishEnabled && latest.mobileExportDirty) await scheduleMobileBridgePublish();
}

function scheduleMobileBridgePublishAt(at: number, kind: 'debounce' | 'retry'): void {
  clearScheduledMobileBridgePublish();
  const delay = Math.max(0, at - Date.now());
  const timerKey = 'mobile-bridge';
  const timer = setTimeout(() => {
    publishTimers.delete(timerKey);
    scheduledAutomaticPublish = undefined;
    void runAutomaticMobileBridgePublish();
  }, delay);
  timer.unref?.();
  publishTimers.set(timerKey, timer);
  scheduledAutomaticPublish = { kind, at };
}

export async function getMobileBridgeInfo(): Promise<MobileBridgeInfo> {
  const settings = await readMobileBridgeSettings();
  const [shelf, knowledge] = await Promise.all([
    Promise.all(settings.shelfDocumentIds.map(async (documentId) => {
    const document = await getDocumentById(documentId);
    return {
      documentId,
      title: document ? titleForDocument(document) : '원본을 찾을 수 없는 문서',
      path: document?.currentPath,
      missing: !document || document.missing || !document.currentPath,
    };
    })),
    getKnowledgeSnapshot(),
  ]);
  const knowledgeShelf = getMobileKnowledgeShelf(knowledge, settings.shelfTopicIds, settings.shelfNoteIds);
  const notificationPending = hasPendingMobileDirtyNotification();
  const effectiveDirty = settings.mobileExportDirty || notificationPending;
  if (!settings.bridgeRoot) {
    return {
      shelf,
      knowledgeShelf,
      conflict: false,
      autoPublishEnabled: settings.autoPublishEnabled,
      dirty: effectiveDirty,
      status: notificationPending ? 'failed' : effectiveDirty ? 'manual-required' : 'up-to-date',
      lastFailureAt: settings.lastPublishFailureAt,
    };
  }
  const paths = bridgePaths(settings.bridgeRoot);
  await ensureBridgeDirectories(paths);
  await recoverInterruptedMobilePublish(paths);
  const current = await inspectMobilePair(paths);
  const conflict = current.state === 'conflict' || (current.state === 'empty' && Boolean(settings.lastSuccessfulExportId));
  const persistedRetryAt = Date.parse(settings.autoPublishRetryAt || '');
  const hasPendingRetry = settings.autoPublishRetryRevision === settings.mobileExportRevision && Number.isFinite(persistedRetryAt);
  const status: MobileBridgeInfo['status'] = conflict
    ? 'conflict'
    : mobilePublishInFlight
      ? 'publishing'
      : scheduledAutomaticPublish?.kind === 'retry' || hasPendingRetry
        ? 'retry-pending'
        : settings.lastPublishFailureAt
          ? 'failed'
          : notificationPending
            ? 'failed'
            : effectiveDirty && settings.autoPublishEnabled
            ? 'automatic-pending'
            : effectiveDirty
              ? 'manual-required'
              : 'up-to-date';
  return {
    bridgeRoot: settings.bridgeRoot,
    shelf,
    knowledgeShelf,
    conflict,
    autoPublishEnabled: settings.autoPublishEnabled,
    dirty: effectiveDirty,
    status,
    scheduledAt: scheduledAutomaticPublish
      ? new Date(scheduledAutomaticPublish.at).toISOString()
      : hasPendingRetry
        ? settings.autoPublishRetryAt
        : undefined,
    lastFailureAt: settings.lastPublishFailureAt,
    artifact: current.state === 'valid' && current.exportId && current.generatedAt
      ? { generatedAt: current.generatedAt, exportId: current.exportId, fileName: MOBILE_ARTIFACT_FILE }
      : undefined,
  };
}

export async function scheduleMobileBridgePublish(): Promise<void> {
  const settings = await readMobileBridgeSettings();
  if (!settings.bridgeRoot || !settings.autoPublishEnabled || !settings.mobileExportDirty) {
    clearScheduledMobileBridgePublish();
    return;
  }
  if (settings.lastPublishFailureAt && settings.autoPublishRetryRevision === settings.mobileExportRevision) {
    const retryAt = Date.parse(settings.autoPublishRetryAt || '');
    if (!Number.isFinite(retryAt)) return;
    scheduleMobileBridgePublishAt(Math.max(Date.now(), retryAt), 'retry');
    return;
  }
  const at = getNextMobileBridgeAutomaticPublishAt(settings);
  if (at !== undefined) scheduleMobileBridgePublishAt(at, 'debounce');
}

export async function markMobileBridgeExportDirty(): Promise<void> {
  const next = await mutateMobileBridgeSettings((current) => dirtySettings(current));
  if (next.autoPublishEnabled && next.bridgeRoot) await scheduleMobileBridgePublish();
}

export async function markMobileBridgeExportDirtyForDocument(documentId: string | undefined): Promise<void> {
  if (!documentId) return;
  const next = await mutateMobileBridgeSettings((current) => (
    current.shelfDocumentIds.includes(documentId) ? dirtySettings(current) : current
  ));
  if (next.autoPublishEnabled && next.bridgeRoot && next.mobileExportDirty) await scheduleMobileBridgePublish();
}

export async function markMobileBridgeExportDirtyForPdfPath(pdfPath: string): Promise<void> {
  const document = await getDocumentByPath(pdfPath);
  await markMobileBridgeExportDirtyForDocument(document?.id);
}

/** Only used by tests and the explicit UI force action; it never changes live Library data. */
export async function copyPortableBackupToMobileBridge(
  sourcePath: string,
  fileName: string,
  kind: 'auto' | 'manual',
): Promise<{ copied: boolean; destination?: string }> {
  const settings = await readMobileBridgeSettings();
  if (!settings.bridgeRoot) return { copied: false };
  const paths = bridgePaths(settings.bridgeRoot);
  await ensureBridgeDirectories(paths);
  const targetDirectory = kind === 'auto' ? paths.autoBackups : paths.manualBackups;
  const destination = path.join(targetDirectory, fileName);
  const source = await hashFile(sourcePath);
  await replaceWithStage(sourcePath, destination, source.sha256);
  const copied = await hashFile(destination);
  if (copied.size !== source.size || copied.sha256 !== source.sha256) {
    throw new Error('연결 폴더에 복사한 백업을 검증하지 못했습니다.');
  }
  return { copied: true, destination };
}

export async function pruneMobileBridgeAutomaticBackups(retention: number): Promise<void> {
  const settings = await readMobileBridgeSettings();
  if (!settings.bridgeRoot) return;
  const paths = bridgePaths(settings.bridgeRoot);
  await ensureBridgeDirectories(paths);
  const entries = (await fs.readdir(paths.autoBackups, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  await Promise.all(entries.slice(Math.max(0, retention)).map((fileName) => (
    fs.rm(path.join(paths.autoBackups, fileName), { force: true })
  )));
}

export async function writeManualPortableBackupToMobileBridge(
  writeBackup: (destination: string) => Promise<void>,
): Promise<{ fileName: string; size: number; destination: string }> {
  const settings = await readMobileBridgeSettings();
  if (!settings.bridgeRoot) throw new Error('먼저 설정에서 모바일 연결 폴더를 지정해 주세요.');
  const paths = bridgePaths(settings.bridgeRoot);
  await ensureBridgeDirectories(paths);
  const fileName = `PageDock-Full-${timestampForFileName()}.zip`;
  const destination = path.join(paths.manualBackups, fileName);
  const temporary = `${destination}.${randomUUID()}.partial`;
  try {
    await writeBackup(temporary);
    const { size } = await hashFile(temporary);
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
      await fs.rm(destination, { force: true });
      await fs.rename(temporary, destination);
    }
    return { fileName, size, destination };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function getMobileBridgePaths(bridgeRoot: string): BridgePaths {
  return bridgePaths(bridgeRoot);
}
