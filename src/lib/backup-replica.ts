import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { getPageDockConfigDirectory } from '@/lib/platform-paths';

export const BACKUP_REPLICA_SCHEMA_VERSION = 1;
export const BACKUP_REPLICA_AUTOMATIC_RETENTION = 14;

export interface BackupReplicaArtifact {
  fileName: string;
  size: number;
  sha256: string;
  copiedAt: string;
}

export interface BackupReplicaSettings {
  version: 1;
  /** A Windows-selected folder, commonly a mapped Synology SMB share. */
  targetRoot?: string;
  /** Opt-in only. A Library save never waits for this copy. */
  automaticEnabled: boolean;
  lastAutomaticArtifact?: BackupReplicaArtifact;
  lastFailureAt?: string;
  updatedAt?: string;
}

export interface BackupReplicaInfo {
  targetRoot?: string;
  automaticEnabled: boolean;
  automaticRetention: number;
  lastAutomaticArtifact?: BackupReplicaArtifact;
  lastFailureAt?: string;
  status: 'not-configured' | 'manual-only' | 'up-to-date' | 'failed';
}

interface BackupReplicaPaths {
  root: string;
  snapshots: string;
  automatic: string;
  manual: string;
}

function settingsFile(): string {
  return path.join(getPageDockConfigDirectory(), 'backup-replica.json');
}

function normalizeTargetRoot(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = path.resolve(value.trim());
  return path.isAbsolute(normalized) ? normalized : undefined;
}

function normalizeDate(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function normalizeArtifact(value: unknown): BackupReplicaArtifact | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<BackupReplicaArtifact>;
  const copiedAt = normalizeDate(candidate.copiedAt);
  if (
    typeof candidate.fileName !== 'string'
    || !candidate.fileName.trim()
    || typeof candidate.size !== 'number'
    || !Number.isSafeInteger(candidate.size)
    || candidate.size < 0
    || typeof candidate.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(candidate.sha256)
    || !copiedAt
  ) return undefined;
  return {
    fileName: path.basename(candidate.fileName),
    size: candidate.size,
    sha256: candidate.sha256.toLowerCase(),
    copiedAt,
  };
}

function normalizeSettings(value: unknown): BackupReplicaSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<BackupReplicaSettings> : {};
  return {
    version: BACKUP_REPLICA_SCHEMA_VERSION,
    targetRoot: normalizeTargetRoot(candidate.targetRoot),
    automaticEnabled: candidate.automaticEnabled === true,
    lastAutomaticArtifact: normalizeArtifact(candidate.lastAutomaticArtifact),
    lastFailureAt: normalizeDate(candidate.lastFailureAt),
    updatedAt: normalizeDate(candidate.updatedAt),
  };
}

function isInsidePath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateTargetRoot(targetRoot: string): string {
  const normalized = path.resolve(targetRoot);
  const libraryRoot = path.resolve(getWorkspaceRoot());
  if (isInsidePath(normalized, libraryRoot) || isInsidePath(libraryRoot, normalized)) {
    throw new Error('보호 사본 폴더는 PageDock Library와 분리해 주세요. Library를 NAS 동기화 폴더로 쓰지 않습니다.');
  }
  return normalized;
}

function replicaPaths(targetRoot: string): BackupReplicaPaths {
  const root = validateTargetRoot(targetRoot);
  const snapshots = path.join(root, 'PageDock-Backups');
  return {
    root,
    snapshots,
    automatic: path.join(snapshots, 'Auto'),
    manual: path.join(snapshots, 'Manual'),
  };
}

async function ensureReplicaDirectories(paths: BackupReplicaPaths): Promise<void> {
  await Promise.all([
    fs.mkdir(paths.automatic, { recursive: true }),
    fs.mkdir(paths.manual, { recursive: true }),
  ]);
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

async function fingerprint(filePath: string): Promise<{ size: number; sha256: string }> {
  const data = await fs.readFile(filePath);
  return {
    size: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

let settingsWriteQueue: Promise<unknown> = Promise.resolve();

async function readSettingsFile(): Promise<BackupReplicaSettings> {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(settingsFile(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: BACKUP_REPLICA_SCHEMA_VERSION, automaticEnabled: false };
    }
    throw new Error('보호 사본 설정을 읽지 못했습니다.');
  }
}

export async function readBackupReplicaSettings(): Promise<BackupReplicaSettings> {
  await settingsWriteQueue;
  return readSettingsFile();
}

async function persistSettings(settings: BackupReplicaSettings): Promise<BackupReplicaSettings> {
  const next = normalizeSettings({ ...settings, updatedAt: new Date().toISOString() });
  await writeJsonAtomic(settingsFile(), next);
  return next;
}

async function mutateSettings(
  mutation: (current: BackupReplicaSettings) => BackupReplicaSettings | Promise<BackupReplicaSettings>,
): Promise<BackupReplicaSettings> {
  let result!: BackupReplicaSettings;
  const operation = settingsWriteQueue.then(async () => {
    const current = await readSettingsFile();
    const candidate = await mutation(current);
    const normalizedCurrent = normalizeSettings(current);
    const normalizedCandidate = normalizeSettings(candidate);
    if (JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedCandidate)) {
      result = normalizedCurrent;
      return;
    }
    result = await persistSettings(normalizedCandidate);
  });
  settingsWriteQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

export async function updateBackupReplicaSettings(
  updates: Partial<Pick<BackupReplicaSettings, 'targetRoot' | 'automaticEnabled'>>,
): Promise<BackupReplicaSettings> {
  if (Object.prototype.hasOwnProperty.call(updates, 'targetRoot')) {
    const targetRoot = normalizeTargetRoot(updates.targetRoot);
    if (targetRoot) {
      validateTargetRoot(targetRoot);
      await ensureReplicaDirectories(replicaPaths(targetRoot));
    }
  }
  return mutateSettings((current) => {
    const targetRoot = Object.prototype.hasOwnProperty.call(updates, 'targetRoot')
      ? normalizeTargetRoot(updates.targetRoot)
      : current.targetRoot;
    if (targetRoot) validateTargetRoot(targetRoot);
    return {
      ...current,
      version: BACKUP_REPLICA_SCHEMA_VERSION,
      targetRoot,
      automaticEnabled: Object.prototype.hasOwnProperty.call(updates, 'automaticEnabled')
        ? updates.automaticEnabled === true
        : current.automaticEnabled,
    };
  });
}

function infoFromSettings(settings: BackupReplicaSettings): BackupReplicaInfo {
  const status: BackupReplicaInfo['status'] = !settings.targetRoot
    ? 'not-configured'
    : settings.lastFailureAt
      ? 'failed'
      : settings.lastAutomaticArtifact
        ? 'up-to-date'
        : 'manual-only';
  return {
    targetRoot: settings.targetRoot,
    automaticEnabled: settings.automaticEnabled,
    automaticRetention: BACKUP_REPLICA_AUTOMATIC_RETENTION,
    lastAutomaticArtifact: settings.lastAutomaticArtifact,
    lastFailureAt: settings.lastFailureAt,
    status,
  };
}

export async function getBackupReplicaInfo(): Promise<BackupReplicaInfo> {
  return infoFromSettings(await readBackupReplicaSettings());
}

async function existingFileFingerprint(filePath: string): Promise<{ size: number; sha256: string } | undefined> {
  try {
    return await fingerprint(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function duplicateName(fileName: string): string {
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return `${stem}-${randomUUID().slice(0, 8)}${extension}`;
}

async function publishVerifiedCopy(sourcePath: string, destination: string, expected: { size: number; sha256: string }): Promise<void> {
  const partial = `${destination}.${randomUUID()}.partial`;
  try {
    await fs.copyFile(sourcePath, partial);
    const copied = await fingerprint(partial);
    if (copied.size !== expected.size || copied.sha256 !== expected.sha256) {
      throw new Error('보호 사본 파일 검증에 실패했습니다.');
    }
    await fs.rename(partial, destination);
  } finally {
    await fs.rm(partial, { force: true });
  }
}

async function recordCopySuccess(targetRoot: string, artifact: BackupReplicaArtifact): Promise<void> {
  await mutateSettings((current) => (
    current.targetRoot === targetRoot
      ? { ...current, lastAutomaticArtifact: artifact, lastFailureAt: undefined }
      : current
  ));
}

async function recordCopyFailure(targetRoot: string): Promise<void> {
  await mutateSettings((current) => (
    current.targetRoot === targetRoot
      ? { ...current, lastFailureAt: new Date().toISOString() }
      : current
  ));
}

/**
 * Copies only a previously validated local portable archive. The destination is
 * never a live Library; a partial file is hashed before it becomes a visible ZIP.
 */
export async function copyAutomaticBackupToReplica(
  sourcePath: string,
  fileName: string,
  options: { force?: boolean } = {},
): Promise<{ copied: boolean; destination?: string }> {
  const settings = await readBackupReplicaSettings();
  if (!settings.targetRoot || (!settings.automaticEnabled && !options.force)) return { copied: false };

  const targetRoot = settings.targetRoot;
  try {
    const paths = replicaPaths(targetRoot);
    await ensureReplicaDirectories(paths);
    const source = await fingerprint(sourcePath);
    let finalName = path.basename(fileName);
    let destination = path.join(paths.automatic, finalName);
    const existing = await existingFileFingerprint(destination);
    if (existing && (existing.size !== source.size || existing.sha256 !== source.sha256)) {
      finalName = duplicateName(finalName);
      destination = path.join(paths.automatic, finalName);
    }
    if (!existing || destination !== path.join(paths.automatic, fileName)) {
      await publishVerifiedCopy(sourcePath, destination, source);
    }
    await recordCopySuccess(targetRoot, {
      fileName: finalName,
      size: source.size,
      sha256: source.sha256,
      copiedAt: new Date().toISOString(),
    });
    return { copied: true, destination };
  } catch (error) {
    await recordCopyFailure(targetRoot).catch(() => undefined);
    if (error instanceof Error && error.message.startsWith('보호 사본 폴더는')) throw error;
    throw new Error('보호 사본 위치로 복사하지 못했습니다. Windows 원본과 로컬 복구 ZIP은 그대로 안전합니다.');
  }
}

export async function pruneReplicaAutomaticBackups(retention = BACKUP_REPLICA_AUTOMATIC_RETENTION): Promise<void> {
  const settings = await readBackupReplicaSettings();
  if (!settings.targetRoot) return;
  const paths = replicaPaths(settings.targetRoot);
  await ensureReplicaDirectories(paths);
  const entries = (await fs.readdir(paths.automatic, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^(?:pagedock|annot)-auto-.*\.zip$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  await Promise.all(entries.slice(Math.max(0, retention)).map((fileName) => (
    fs.rm(path.join(paths.automatic, fileName), { force: true })
  )));
}
