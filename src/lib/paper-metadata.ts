import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot, resolveFolderPath } from '@/lib/annot-sessions';
import { PaperMetadata, PaperTranslation, ReadingStatus } from '@/types';

const METADATA_VERSION = 1;

interface StoredPaperMetadata extends PaperMetadata {
  version: number;
}

export interface PaperMetadataUpdate {
  documentId?: string;
  aiKeywords?: string[];
  personalTags?: string[];
  summaryKo?: string;
  noteMarkdown?: string;
  readingStatus?: ReadingStatus;
  rating?: number;
  importance?: number;
  analyzedAt?: string;
  analysisModel?: string;
  lastOpenedAt?: string;
  translations?: PaperTranslation[];
}

function normalizePdfPath(pdfPath: string): string {
  const normalized = path.posix.normalize(pdfPath.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('잘못된 PDF 경로입니다.');
  }
  return normalized;
}

function metadataId(pdfPath: string): string {
  return createHash('sha256').update(normalizePdfPath(pdfPath)).digest('hex').slice(0, 24);
}

function metadataDirectory(): string {
  return path.join(getWorkspaceRoot(), '.annot', 'papers');
}

function metadataFile(pdfPath: string): string {
  return path.join(metadataDirectory(), `${metadataId(pdfPath)}.json`);
}

function clampScale(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(5, Math.max(0, Math.round(numeric)));
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function defaultMetadata(pdfPath: string): StoredPaperMetadata {
  return {
    version: METADATA_VERSION,
    pdfPath: normalizePdfPath(pdfPath),
    aiKeywords: [],
    personalTags: [],
    summaryKo: '',
    noteMarkdown: '',
    readingStatus: 'unread',
    rating: 0,
    importance: 0,
    updatedAt: new Date(0).toISOString(),
    translations: [],
  };
}

function normalizeMetadata(pdfPath: string, value: Partial<StoredPaperMetadata>): StoredPaperMetadata {
  const readingStatus: ReadingStatus = value.readingStatus === 'reading' || value.readingStatus === 'completed'
    ? value.readingStatus
    : 'unread';
  return {
    ...defaultMetadata(pdfPath),
    ...value,
    version: METADATA_VERSION,
    pdfPath: normalizePdfPath(pdfPath),
    documentId: typeof value.documentId === 'string' && value.documentId ? value.documentId : undefined,
    aiKeywords: uniqueStrings(value.aiKeywords),
    personalTags: uniqueStrings(value.personalTags),
    summaryKo: typeof value.summaryKo === 'string' ? value.summaryKo : '',
    noteMarkdown: typeof value.noteMarkdown === 'string' ? value.noteMarkdown : '',
    readingStatus,
    rating: clampScale(value.rating),
    importance: clampScale(value.importance),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    translations: Array.isArray(value.translations)
      ? value.translations.filter((item): item is PaperTranslation => (
        !!item && typeof item.id === 'string' && typeof item.bilingualMarkdown === 'string'
      ))
      : [],
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  }
}

export async function getPaperMetadata(pdfPath: string): Promise<PaperMetadata> {
  const normalizedPath = normalizePdfPath(pdfPath);
  try {
    const raw = await fs.readFile(metadataFile(normalizedPath), 'utf8');
    return normalizeMetadata(normalizedPath, JSON.parse(raw) as Partial<StoredPaperMetadata>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return defaultMetadata(normalizedPath);
  }
}

export async function getPaperMetadataBatch(pdfPaths: string[]): Promise<Record<string, PaperMetadata>> {
  const entries = await Promise.all(pdfPaths.map(async (pdfPath) => (
    [pdfPath, await getPaperMetadata(pdfPath)] as const
  )));
  return Object.fromEntries(entries);
}

export async function updatePaperMetadata(
  pdfPath: string,
  updates: PaperMetadataUpdate,
): Promise<PaperMetadata> {
  const current = await getPaperMetadata(pdfPath);
  const next = normalizeMetadata(pdfPath, {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  await fs.access(resolveFolderPath(next.pdfPath));
  await writeJsonAtomic(metadataFile(next.pdfPath), next);
  return next;
}

export async function replacePaperMetadata(pdfPath: string, metadata: PaperMetadata): Promise<PaperMetadata> {
  const next = normalizeMetadata(pdfPath, {
    ...metadata,
    pdfPath,
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(metadataFile(next.pdfPath), next);
  return next;
}

export async function addPaperTranslation(
  pdfPath: string,
  translation: Omit<PaperTranslation, 'id' | 'createdAt'>,
): Promise<PaperMetadata> {
  const current = await getPaperMetadata(pdfPath);
  const nextTranslation: PaperTranslation = {
    ...translation,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const next = normalizeMetadata(pdfPath, {
    ...current,
    translations: [...current.translations, nextTranslation],
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(metadataFile(next.pdfPath), next);
  return next;
}

export async function deletePaperTranslation(pdfPath: string, translationId: string): Promise<PaperMetadata> {
  const current = await getPaperMetadata(pdfPath);
  const next = normalizeMetadata(pdfPath, {
    ...current,
    translations: current.translations.filter((item) => item.id !== translationId),
    updatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(metadataFile(next.pdfPath), next);
  return next;
}

export async function movePaperMetadata(oldPdfPath: string, newPdfPath: string): Promise<void> {
  const oldPath = normalizePdfPath(oldPdfPath);
  const nextPath = normalizePdfPath(newPdfPath);
  const current = await getPaperMetadata(oldPath);
  const source = metadataFile(oldPath);
  const target = metadataFile(nextPath);
  const hasData = current.updatedAt !== new Date(0).toISOString()
    || current.summaryKo.length > 0
    || current.noteMarkdown.length > 0
    || current.translations.length > 0;
  if (!hasData) return;
  await writeJsonAtomic(target, normalizeMetadata(nextPath, current));
  await fs.rm(source, { force: true });
}

export async function removePaperMetadata(pdfPath: string): Promise<void> {
  await fs.rm(metadataFile(normalizePdfPath(pdfPath)), { force: true });
}

async function readAllStoredMetadata(): Promise<Array<{ filePath: string; metadata: StoredPaperMetadata }>> {
  try {
    const entries = await fs.readdir(metadataDirectory(), { withFileTypes: true });
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(metadataDirectory(), entry.name);
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw) as Partial<StoredPaperMetadata>;
          if (!parsed.pdfPath) return null;
          return { filePath, metadata: normalizeMetadata(parsed.pdfPath, parsed) };
        } catch {
          return null;
        }
      }));
    return records.filter((record): record is { filePath: string; metadata: StoredPaperMetadata } => !!record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function rewritePaperMetadataForFolderMove(oldFolderPath: string, newFolderPath: string): Promise<void> {
  const oldPrefix = oldFolderPath.replace(/\\/g, '/').replace(/\/$/, '');
  const newPrefix = newFolderPath.replace(/\\/g, '/').replace(/\/$/, '');
  const records = await readAllStoredMetadata();
  await Promise.all(records.map(async ({ filePath, metadata }) => {
    if (metadata.pdfPath !== oldPrefix && !metadata.pdfPath.startsWith(`${oldPrefix}/`)) return;
    const nextPdfPath = `${newPrefix}${metadata.pdfPath.slice(oldPrefix.length)}`;
    await writeJsonAtomic(metadataFile(nextPdfPath), normalizeMetadata(nextPdfPath, metadata));
    await fs.rm(filePath, { force: true });
  }));
}

export async function removePaperMetadataForFolder(folderPath: string): Promise<void> {
  const prefix = folderPath.replace(/\\/g, '/').replace(/\/$/, '');
  const records = await readAllStoredMetadata();
  await Promise.all(records
    .filter(({ metadata }) => metadata.pdfPath === prefix || metadata.pdfPath.startsWith(`${prefix}/`))
    .map(({ filePath }) => fs.rm(filePath, { force: true })));
}
