import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import {
  getWorkspaceRoot,
  listSessions,
  removePdfSessions,
  resolveFolderPath,
  restoreSessions,
  rewriteSessionsForFolderMove,
} from '@/lib/annot-sessions';
import {
  getPaperMetadata,
  removePaperMetadata,
  removePaperMetadataForFolder,
  replacePaperMetadata,
  rewritePaperMetadataForFolderMove,
} from '@/lib/paper-metadata';
import { PaperMetadata, Session } from '@/types';

const RETENTION_DAYS = 30;

export interface TrashRecord {
  id: string;
  kind: 'pdf' | 'folder';
  name: string;
  originalPath: string;
  storedPath: string;
  deletedAt: string;
  expiresAt: string;
  metadata?: PaperMetadata;
  sessions?: Session[];
}

function trashRoot(): string {
  return path.join(getWorkspaceRoot(), '.annot', 'trash');
}

function recordPath(id: string): string {
  return path.join(trashRoot(), 'records', `${id}.json`);
}

function itemPath(id: string, name: string): string {
  return path.join(trashRoot(), 'items', id, name);
}

async function writeRecord(record: TrashRecord): Promise<void> {
  await fs.mkdir(path.dirname(recordPath(record.id)), { recursive: true });
  await fs.writeFile(recordPath(record.id), JSON.stringify(record, null, 2), 'utf8');
}

async function readRecord(id: string): Promise<TrashRecord> {
  return JSON.parse(await fs.readFile(recordPath(id), 'utf8')) as TrashRecord;
}

export async function movePdfToTrash(pdfPath: string): Promise<void> {
  const normalized = pdfPath.replace(/\\/g, '/');
  const name = path.posix.basename(normalized);
  const parent = path.posix.dirname(normalized) === '.' ? '' : path.posix.dirname(normalized);
  const id = randomUUID();
  const destination = itemPath(id, name);
  const metadata = await getPaperMetadata(normalized);
  const sessions = await listSessions(parent, { sessionKind: 'pdf', pdfPath: normalized });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(resolveFolderPath(normalized), destination);
  await removePaperMetadata(normalized);
  await removePdfSessions(parent, normalized);
  const deletedAt = new Date();
  await writeRecord({
    id,
    kind: 'pdf',
    name,
    originalPath: normalized,
    storedPath: destination,
    deletedAt: deletedAt.toISOString(),
    expiresAt: new Date(deletedAt.getTime() + RETENTION_DAYS * 86400000).toISOString(),
    metadata,
    sessions,
  });
}

export async function moveFolderToTrash(folderPath: string): Promise<void> {
  const normalized = folderPath.replace(/\\/g, '/').replace(/\/$/, '');
  const name = path.posix.basename(normalized);
  const id = randomUUID();
  const destination = itemPath(id, name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(resolveFolderPath(normalized), destination);
  const deletedAt = new Date();
  await writeRecord({
    id,
    kind: 'folder',
    name,
    originalPath: normalized,
    storedPath: destination,
    deletedAt: deletedAt.toISOString(),
    expiresAt: new Date(deletedAt.getTime() + RETENTION_DAYS * 86400000).toISOString(),
  });
}

async function uniqueRestorePath(originalPath: string): Promise<string> {
  try {
    await fs.access(resolveFolderPath(originalPath));
  } catch {
    return originalPath;
  }
  const parsed = path.posix.parse(originalPath);
  let index = 1;
  while (true) {
    const candidate = path.posix.join(parsed.dir, `${parsed.name}-복원-${index}${parsed.ext}`);
    try {
      await fs.access(resolveFolderPath(candidate));
      index += 1;
    } catch {
      return candidate;
    }
  }
}

export async function restoreTrashItem(id: string): Promise<{ restoredPath: string }> {
  const record = await readRecord(id);
  const restoredPath = await uniqueRestorePath(record.originalPath);
  const destination = resolveFolderPath(restoredPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(record.storedPath, destination);

  if (record.kind === 'pdf') {
    if (record.metadata) await replacePaperMetadata(restoredPath, record.metadata);
    const parent = path.posix.dirname(restoredPath) === '.' ? '' : path.posix.dirname(restoredPath);
    const sessions = (record.sessions || []).map((session) => ({ ...session, folderPath: parent, pdfPath: restoredPath }));
    await restoreSessions(parent, sessions);
  } else if (restoredPath !== record.originalPath) {
    await rewritePaperMetadataForFolderMove(record.originalPath, restoredPath);
    await rewriteSessionsForFolderMove(record.originalPath, restoredPath);
  }

  await fs.rm(path.dirname(record.storedPath), { recursive: true, force: true });
  await fs.rm(recordPath(id), { force: true });
  return { restoredPath };
}

export async function purgeTrashItem(id: string): Promise<void> {
  const record = await readRecord(id);
  await fs.rm(path.dirname(record.storedPath), { recursive: true, force: true });
  if (record.kind === 'folder') await removePaperMetadataForFolder(record.originalPath);
  await fs.rm(recordPath(id), { force: true });
}

export async function listTrash(): Promise<TrashRecord[]> {
  const directory = path.join(trashRoot(), 'records');
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readRecord(entry.name.replace(/\.json$/, ''))));
    const now = Date.now();
    await Promise.all(records.filter((record) => new Date(record.expiresAt).getTime() <= now).map((record) => purgeTrashItem(record.id)));
    return records
      .filter((record) => new Date(record.expiresAt).getTime() > now)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
