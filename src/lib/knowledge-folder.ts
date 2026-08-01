import { promises as fs } from 'fs';
import path from 'path';
import { TextDecoder } from 'util';

import {
  captureKnowledgeNotes,
  getKnowledgeSnapshot,
  hashKnowledgeText,
  type CaptureKnowledgeResult,
  type KnowledgeNote,
} from '@/lib/knowledge-store';
import { splitKnowledgeText, normalizeKnowledgeText, KNOWLEDGE_NOTE_MAX, KNOWLEDGE_SPLIT_PREVIEW_THRESHOLD } from '@/lib/knowledge-split';
import {
  readKnowledgeImportSettings,
  writeKnowledgeImportSettings,
  setKnowledgeImportDirectory,
  type KnowledgeImportFileRecord,
  type KnowledgeImportSettings,
} from '@/lib/knowledge-import-settings';

export const KNOWLEDGE_FOLDER_MAX_FILE_BYTES = 500_000;
export const KNOWLEDGE_FOLDER_MAX_NEW_FILES = 100;
export const KNOWLEDGE_FOLDER_MAX_READ_BYTES = 25_000_000;
export const KNOWLEDGE_FOLDER_MAX_DISCOVERED_FILES = 2_000;
export const KNOWLEDGE_FOLDER_MAX_DEPTH = 12;
export const KNOWLEDGE_EXPORT_MARKER = '.pagedock-knowledge-export';

const SUPPORTED_FILE = /\.(?:txt|md|markdown)$/i;
const SKIPPED_DIRECTORY_NAMES = new Set(['.git', '.annot', 'node_modules']);

export interface PendingKnowledgeFile {
  relativePath: string;
  sizeBytes: number;
  charCount: number;
  contentHash: string;
  suggestedSegments: number;
}

export interface SkippedKnowledgeFile {
  relativePath: string;
  reason: string;
}

export interface KnowledgeFolderScanResult {
  directory: string | null;
  available: boolean;
  lastScanAt?: string;
  captured: KnowledgeNote[];
  duplicates: CaptureKnowledgeResult['duplicates'];
  pending: PendingKnowledgeFile[];
  skipped: SkippedKnowledgeFile[];
  hasMore: boolean;
}

export interface KnowledgeFolderSegmentPreview {
  title: string;
  charCount: number;
  preview: string;
  hardSplit: boolean;
}

export interface KnowledgeFolderPreview {
  relativePath: string;
  sizeBytes: number;
  charCount: number;
  contentHash: string;
  segments: KnowledgeFolderSegmentPreview[];
  warnings: string[];
}

export interface KnowledgeFolderImportResult {
  relativePath: string;
  mode: 'single' | 'split';
  captured: KnowledgeNote[];
  duplicates: CaptureKnowledgeResult['duplicates'];
  segmentCount: number;
}

function now(): string {
  return new Date().toISOString();
}

function relativePathFor(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate !== normalizedRoot && normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function isUnchanged(record: KnowledgeImportFileRecord | undefined, stat: { size: number; mtimeMs: number }): boolean {
  return Boolean(record && record.sizeBytes === stat.size && Math.abs(record.mtimeMs - stat.mtimeMs) < 1);
}

function emptyResult(settings: KnowledgeImportSettings, available: boolean): KnowledgeFolderScanResult {
  return {
    directory: settings.directory,
    available,
    ...(settings.lastScanAt ? { lastScanAt: settings.lastScanAt } : {}),
    captured: [],
    duplicates: [],
    pending: [],
    skipped: [],
    hasMore: false,
  };
}

async function decodeUtf8(filePath: string): Promise<{ text: string; sizeBytes: number }> {
  const bytes = await fs.readFile(filePath);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: normalizeKnowledgeText(text), sizeBytes: bytes.byteLength };
  } catch {
    throw new Error('UTF-8 텍스트 파일이 아닙니다. 메모장을 UTF-8로 저장한 뒤 다시 확인하세요.');
  }
}

async function hasExportMarker(directory: string): Promise<boolean> {
  try {
    const marker = await fs.stat(path.join(directory, KNOWLEDGE_EXPORT_MARKER));
    return marker.isFile();
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<{ filePath: string; stat: { size: number; mtimeMs: number } }[]> {
  const files: { filePath: string; stat: { size: number; mtimeMs: number } }[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > KNOWLEDGE_FOLDER_MAX_DEPTH || files.length >= KNOWLEDGE_FOLDER_MAX_DISCOVERED_FILES) return;
    if (await hasExportMarker(directory)) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    for (const entry of entries) {
      if (files.length >= KNOWLEDGE_FOLDER_MAX_DISCOVERED_FILES) return;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) await visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !SUPPORTED_FILE.test(entry.name)) continue;
      try {
        const stat = await fs.stat(fullPath);
        files.push({ filePath: fullPath, stat: { size: stat.size, mtimeMs: stat.mtimeMs } });
      } catch {
        // The file may disappear while the folder is being scanned.
      }
    }
  }
  await visit(root, 0);
  return files;
}

function pendingFromRecord(relativePath: string, record: KnowledgeImportFileRecord): PendingKnowledgeFile {
  return {
    relativePath,
    sizeBytes: record.sizeBytes,
    charCount: record.charCount,
    contentHash: record.contentHash,
    suggestedSegments: record.suggestedSegments,
  };
}

function recordFor(input: {
  stat: { size: number; mtimeMs: number };
  contentHash: string;
  charCount: number;
  suggestedSegments: number;
  status: KnowledgeImportFileRecord['status'];
  reason?: string;
}): KnowledgeImportFileRecord {
  return {
    sizeBytes: input.stat.size,
    mtimeMs: input.stat.mtimeMs,
    contentHash: input.contentHash,
    charCount: input.charCount,
    suggestedSegments: input.suggestedSegments,
    status: input.status,
    ...(input.reason ? { reason: input.reason } : {}),
    updatedAt: now(),
  };
}

export async function scanKnowledgeImportFolder(): Promise<KnowledgeFolderScanResult> {
  const settings = await readKnowledgeImportSettings();
  if (!settings.directory) return emptyResult(settings, false);
  try {
    const rootStat = await fs.stat(settings.directory);
    if (!rootStat.isDirectory()) return emptyResult(settings, false);
  } catch {
    return emptyResult(settings, false);
  }

  const result = emptyResult(settings, true);
  const snapshot = await getKnowledgeSnapshot();
  const knownHashes = new Map(snapshot.notes.map((note) => [note.contentHash, note.id]));
  const files = await listFiles(settings.directory);
  const updatedFiles = { ...settings.files };
  const smallInputs: Array<{ text: string; sourceName: string }> = [];
  const smallPaths: string[] = [];
  let bytesRead = 0;
  if (files.length >= KNOWLEDGE_FOLDER_MAX_DISCOVERED_FILES) result.hasMore = true;

  for (const item of files) {
    const relativePath = relativePathFor(settings.directory, item.filePath);
    const previous = settings.files[relativePath];
    if (isUnchanged(previous, item.stat)) {
      if (previous?.status === 'pending-split') result.pending.push(pendingFromRecord(relativePath, previous));
      continue;
    }
    if (item.stat.size > KNOWLEDGE_FOLDER_MAX_FILE_BYTES) {
      result.skipped.push({ relativePath, reason: '파일 크기가 500KB를 초과했습니다.' });
      updatedFiles[relativePath] = recordFor({ stat: item.stat, contentHash: '', charCount: 0, suggestedSegments: 0, status: 'skipped', reason: '파일 크기가 500KB를 초과했습니다.' });
      continue;
    }
    if (bytesRead + item.stat.size > KNOWLEDGE_FOLDER_MAX_READ_BYTES) {
      result.hasMore = true;
      continue;
    }
    bytesRead += item.stat.size;
    let decoded: { text: string; sizeBytes: number };
    try {
      decoded = await decodeUtf8(item.filePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'UTF-8 텍스트 파일을 읽지 못했습니다.';
      result.skipped.push({ relativePath, reason });
      updatedFiles[relativePath] = recordFor({ stat: item.stat, contentHash: '', charCount: 0, suggestedSegments: 0, status: 'skipped', reason });
      continue;
    }
    if (!decoded.text) {
      result.skipped.push({ relativePath, reason: '빈 메모는 수집하지 않습니다.' });
      updatedFiles[relativePath] = recordFor({ stat: item.stat, contentHash: '', charCount: 0, suggestedSegments: 0, status: 'skipped', reason: '빈 메모' });
      continue;
    }
    const contentHash = hashKnowledgeText(decoded.text);
    const split = splitKnowledgeText(decoded.text);
    if (split.segments.length > 1 || decoded.text.length > KNOWLEDGE_SPLIT_PREVIEW_THRESHOLD) {
      const allSegmentsKnown = split.segments.every((segment) => knownHashes.has(hashKnowledgeText(segment.text)));
      if (allSegmentsKnown) {
        updatedFiles[relativePath] = recordFor({ stat: item.stat, contentHash, charCount: decoded.text.length, suggestedSegments: split.segments.length, status: 'captured' });
      } else {
        updatedFiles[relativePath] = recordFor({ stat: item.stat, contentHash, charCount: decoded.text.length, suggestedSegments: split.segments.length, status: 'pending-split' });
        result.pending.push({ relativePath, sizeBytes: item.stat.size, charCount: decoded.text.length, contentHash, suggestedSegments: split.segments.length });
      }
      continue;
    }
    const knownId = knownHashes.get(contentHash);
    if (knownId) {
      result.duplicates.push({ sourceName: relativePath, existingNoteId: knownId });
      updatedFiles[relativePath] = recordFor({ stat: item.stat, contentHash, charCount: decoded.text.length, suggestedSegments: 1, status: 'captured' });
      continue;
    }
    if (smallInputs.length >= KNOWLEDGE_FOLDER_MAX_NEW_FILES) {
      result.hasMore = true;
      continue;
    }
    smallInputs.push({ text: decoded.text, sourceName: relativePath });
    smallPaths.push(relativePath);
  }

  if (smallInputs.length) {
    const captured = await captureKnowledgeNotes(smallInputs);
    result.captured.push(...captured.captured);
    result.duplicates.push(...captured.duplicates);
    for (const note of captured.captured) {
      const index = smallPaths.indexOf(note.sourceName);
      if (index >= 0) {
        const source = smallInputs[index];
        const stat = files.find((item) => relativePathFor(settings.directory!, item.filePath) === note.sourceName)?.stat;
        if (stat) updatedFiles[note.sourceName] = recordFor({ stat, contentHash: note.contentHash, charCount: source.text.length, suggestedSegments: 1, status: 'captured' });
      }
    }
    for (const duplicate of captured.duplicates) {
      const index = smallPaths.indexOf(duplicate.sourceName);
      const source = index >= 0 ? smallInputs[index] : undefined;
      const stat = files.find((item) => relativePathFor(settings.directory!, item.filePath) === duplicate.sourceName)?.stat;
      if (source && stat) updatedFiles[duplicate.sourceName] = recordFor({ stat, contentHash: hashKnowledgeText(source.text), charCount: source.text.length, suggestedSegments: 1, status: 'captured' });
    }
  }

  const lastScanAt = now();
  await writeKnowledgeImportSettings({ ...settings, lastScanAt, files: updatedFiles });
  result.lastScanAt = lastScanAt;
  return result;
}

async function resolveConfiguredFile(relativePath: string): Promise<{ settings: KnowledgeImportSettings; filePath: string; stat: { size: number; mtimeMs: number } }> {
  const settings = await readKnowledgeImportSettings();
  if (!settings.directory) throw new Error('먼저 메모 폴더를 연결하세요.');
  const normalized = relativePath.trim().replaceAll('/', path.sep);
  const filePath = path.resolve(settings.directory, normalized);
  if (!isWithin(settings.directory, filePath)) throw new Error('메모 폴더 바깥의 파일은 읽을 수 없습니다.');
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || !SUPPORTED_FILE.test(filePath)) throw new Error('지원하는 txt·md 파일을 찾을 수 없습니다.');
  if (stat.size > KNOWLEDGE_FOLDER_MAX_FILE_BYTES) throw new Error('파일 크기가 500KB를 초과했습니다.');
  return { settings, filePath, stat: { size: stat.size, mtimeMs: stat.mtimeMs } };
}

export async function previewKnowledgeFolderFile(relativePath: string): Promise<KnowledgeFolderPreview> {
  const { filePath, stat } = await resolveConfiguredFile(relativePath);
  const decoded = await decodeUtf8(filePath);
  if (!decoded.text) throw new Error('빈 메모는 수집할 수 없습니다.');
  const split = splitKnowledgeText(decoded.text);
  return {
    relativePath,
    sizeBytes: stat.size,
    charCount: decoded.text.length,
    contentHash: hashKnowledgeText(decoded.text),
    segments: split.segments.map((segment) => ({ title: segment.title, charCount: segment.text.length, preview: segment.text.slice(0, 240), hardSplit: segment.hardSplit })),
    warnings: split.warnings,
  };
}

export async function importKnowledgeFolderFile(relativePath: string, expectedHash: string, mode: 'single' | 'split'): Promise<KnowledgeFolderImportResult> {
  const { settings, filePath, stat } = await resolveConfiguredFile(relativePath);
  const decoded = await decodeUtf8(filePath);
  const contentHash = hashKnowledgeText(decoded.text);
  if (contentHash !== expectedHash) throw new Error('미리보기 이후 파일 내용이 바뀌었습니다. 다시 확인해 주세요.');
  const split = splitKnowledgeText(decoded.text);
  if (mode === 'single' && decoded.text.length > KNOWLEDGE_NOTE_MAX) throw new Error('100,000자를 넘는 파일은 나누어 수집해야 합니다.');
  const sourceName = relativePath.trim();
  const inputs = mode === 'single'
    ? [{ text: decoded.text, sourceName }]
    : split.segments.map((segment, index) => ({ text: segment.text, sourceName: `${sourceName} · ${index + 1}/${split.segments.length}` }));
  const captured = await captureKnowledgeNotes(inputs);
  const files = {
    ...settings.files,
    [sourceName]: recordFor({ stat, contentHash, charCount: decoded.text.length, suggestedSegments: split.segments.length, status: 'captured' }),
  };
  await writeKnowledgeImportSettings({ ...settings, files, lastScanAt: now() });
  return { relativePath: sourceName, mode, captured: captured.captured, duplicates: captured.duplicates, segmentCount: inputs.length };
}

export { setKnowledgeImportDirectory };
