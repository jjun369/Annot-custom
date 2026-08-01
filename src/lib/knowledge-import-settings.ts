import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { getPageDockConfigDirectory } from '@/lib/platform-paths';

export type KnowledgeImportFileStatus = 'captured' | 'pending-split' | 'skipped';

export interface KnowledgeImportFileRecord {
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string;
  charCount: number;
  suggestedSegments: number;
  status: KnowledgeImportFileStatus;
  reason?: string;
  updatedAt: string;
}

export interface KnowledgeImportSettings {
  version: 1;
  directory: string | null;
  lastScanAt?: string;
  files: Record<string, KnowledgeImportFileRecord>;
}

export type KnowledgeImportSettingsSummary = Pick<KnowledgeImportSettings, 'version' | 'directory' | 'lastScanAt'>;

const EMPTY_SETTINGS: KnowledgeImportSettings = { version: 1, directory: null, files: {} };

export function knowledgeImportSettingsPath(): string {
  return path.join(getPageDockConfigDirectory(), 'knowledge-import.json');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeRecord(value: unknown): KnowledgeImportFileRecord | null {
  const record = asRecord(value);
  const status = String(record.status);
  if (!['captured', 'pending-split', 'skipped'].includes(status)) return null;
  if (typeof record.contentHash !== 'string') return null;
  return {
    sizeBytes: Math.max(0, Number(record.sizeBytes) || 0),
    mtimeMs: Math.max(0, Number(record.mtimeMs) || 0),
    contentHash: record.contentHash,
    charCount: Math.max(0, Number(record.charCount) || 0),
    suggestedSegments: Math.max(0, Number(record.suggestedSegments) || 0),
    status: status as KnowledgeImportFileStatus,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeSettings(value: unknown): KnowledgeImportSettings {
  const record = asRecord(value);
  const rawFiles = asRecord(record.files);
  const files: Record<string, KnowledgeImportFileRecord> = {};
  for (const [relativePath, item] of Object.entries(rawFiles)) {
    const normalized = normalizeRecord(item);
    if (normalized) files[relativePath] = normalized;
  }
  return {
    version: 1,
    directory: typeof record.directory === 'string' && path.isAbsolute(record.directory) ? path.normalize(record.directory) : null,
    ...(typeof record.lastScanAt === 'string' ? { lastScanAt: record.lastScanAt } : {}),
    files,
  };
}

export async function readKnowledgeImportSettings(): Promise<KnowledgeImportSettings> {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(knowledgeImportSettingsPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_SETTINGS, files: {} };
    throw error;
  }
}

export async function writeKnowledgeImportSettings(settings: KnowledgeImportSettings): Promise<KnowledgeImportSettings> {
  const filePath = knowledgeImportSettingsPath();
  const next = normalizeSettings(settings);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(String(code))) throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporary, filePath);
  }
  return next;
}

export async function setKnowledgeImportDirectory(directory: string | null): Promise<KnowledgeImportSettings> {
  if (directory === null) return writeKnowledgeImportSettings({ ...EMPTY_SETTINGS, files: {} });
  const normalized = path.normalize(path.resolve(directory.trim()));
  if (!path.isAbsolute(normalized)) throw new Error('메모 폴더는 전체 경로여야 합니다.');
  const stat = await fs.stat(normalized);
  if (!stat.isDirectory()) throw new Error('선택한 메모 폴더를 찾을 수 없습니다.');
  return writeKnowledgeImportSettings({ version: 1, directory: normalized, files: {} });
}
