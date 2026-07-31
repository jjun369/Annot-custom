import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { normalizeHighlightRects } from '@/lib/highlight-utils';
import { getDocumentByPath } from '@/lib/research-db';
import { Highlight } from '@/types';

const SIDECAR_VERSION = 1;

interface StoredHighlightSidecar {
  version: number;
  documentId?: string;
  pdfPath: string;
  highlights: Highlight[];
  updatedAt: string;
}

function normalizePdfPath(pdfPath: string): string {
  const normalized = path.posix.normalize(pdfPath.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('잘못된 PDF 경로입니다.');
  }
  return normalized;
}

function legacySidecarPath(pdfPath: string): string {
  const digest = createHash('sha256').update(normalizePdfPath(pdfPath)).digest('hex').slice(0, 24);
  return path.join(getWorkspaceRoot(), '.annot', 'annotations', `${digest}.json`);
}

async function sidecarPaths(pdfPath: string): Promise<{ primary: string; legacy: string; documentId?: string }> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const document = await getDocumentByPath(normalizedPath);
  const legacy = legacySidecarPath(normalizedPath);
  return {
    primary: document
      ? path.join(getWorkspaceRoot(), '.annot', 'annotations', `${document.id}.json`)
      : legacy,
    legacy,
    documentId: document?.id,
  };
}

function normalizeHighlight(pdfPath: string, value: Partial<Highlight>, documentId?: string): Highlight | null {
  if (!value || typeof value !== 'object') return null;
  const page = Number(value.page);
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const rects = normalizeHighlightRects(
    Array.isArray(value.rects) && value.rects.length > 0
      ? value.rects
      : value.position ? [value.position] : [],
  );
  if (!Number.isFinite(page) || page < 1 || rects.length === 0) return null;
  const type = value.type === 'unknown' ? 'unknown' : 'important';
  return {
    id: typeof value.id === 'string' && value.id ? value.id : randomUUID(),
    documentId: documentId || value.documentId,
    annotationId: typeof value.annotationId === 'string' ? value.annotationId : undefined,
    pdfPath,
    page: Math.round(page),
    type,
    text,
    note: typeof value.note === 'string' ? value.note : '',
    rects,
    position: rects[0],
  };
}

async function readSidecar(pdfPath: string): Promise<StoredHighlightSidecar | null> {
  const locations = await sidecarPaths(pdfPath);
  try {
    let raw: string;
    let migrated = false;
    try {
      raw = await fs.readFile(locations.primary, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || locations.primary === locations.legacy) throw error;
      raw = await fs.readFile(locations.legacy, 'utf8');
      migrated = true;
    }
    const parsed = JSON.parse(raw) as Partial<StoredHighlightSidecar>;
    const normalizedPath = normalizePdfPath(pdfPath);
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights
        .map((highlight) => normalizeHighlight(normalizedPath, highlight, locations.documentId))
        .filter((highlight): highlight is Highlight => highlight !== null)
      : [];
    const result: StoredHighlightSidecar = {
      version: SIDECAR_VERSION,
      documentId: locations.documentId,
      pdfPath: normalizedPath,
      highlights: mergeSidecarHighlights(highlights),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
    if (migrated) {
      await fs.mkdir(path.dirname(locations.primary), { recursive: true });
      await fs.writeFile(locations.primary, JSON.stringify(result, null, 2), 'utf8');
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sidecarSignature(highlight: Highlight): string {
  const rects = normalizeHighlightRects(highlight.rects?.length ? highlight.rects : [highlight.position]);
  return [
    highlight.page,
    highlight.type,
    highlight.text.trim().toLocaleLowerCase(),
    rects.map((rect) => [rect.x, rect.y, rect.width, rect.height].map((value) => value.toFixed(4)).join(':')).join('|'),
  ].join('::');
}

function mergeSidecarHighlights(highlights: Highlight[]): Highlight[] {
  const result: Highlight[] = [];
  const indexBySignature = new Map<string, number>();
  for (const highlight of highlights) {
    const signature = sidecarSignature(highlight);
    const existingIndex = indexBySignature.get(signature);
    if (existingIndex === undefined) {
      indexBySignature.set(signature, result.length);
      result.push(highlight);
    } else if (!result[existingIndex].annotationId && highlight.annotationId) {
      result[existingIndex] = highlight;
    }
  }
  return result;
}

async function writeSidecar(pdfPath: string, highlights: Highlight[]): Promise<void> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const locations = await sidecarPaths(normalizedPath);
  const filePath = locations.primary;
  const value: StoredHighlightSidecar = {
    version: SIDECAR_VERSION,
    documentId: locations.documentId,
    pdfPath: normalizedPath,
    highlights: mergeSidecarHighlights(highlights
      .map((highlight) => normalizeHighlight(normalizedPath, highlight, locations.documentId))
      .filter((highlight): highlight is Highlight => highlight !== null)),
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
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

export async function listSidecarHighlights(pdfPath: string): Promise<Highlight[]> {
  const sidecar = await readSidecar(pdfPath);
  return sidecar?.highlights ?? [];
}

export async function replaceSidecarHighlights(pdfPath: string, highlights: Highlight[]): Promise<Highlight[]> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const document = await getDocumentByPath(normalizedPath);
  const next = mergeSidecarHighlights(highlights
    .map((highlight) => normalizeHighlight(normalizedPath, highlight, document?.id))
    .filter((highlight): highlight is Highlight => highlight !== null));
  await writeSidecar(normalizedPath, next);
  return next;
}

export async function moveSidecarHighlights(oldPdfPath: string, newPdfPath: string): Promise<void> {
  const current = await listSidecarHighlights(oldPdfPath);
  if (current.length === 0) return;
  await replaceSidecarHighlights(newPdfPath, current.map((highlight) => ({
    ...highlight,
    pdfPath: normalizePdfPath(newPdfPath),
  })));
}

export async function upsertSidecarHighlights(pdfPath: string, highlights: Highlight[]): Promise<Highlight[]> {
  const existing = await listSidecarHighlights(pdfPath);
  return replaceSidecarHighlights(pdfPath, [...existing, ...highlights]);
}

export async function updateSidecarHighlights(
  pdfPath: string,
  updates: Array<{
    annotationId: string;
    text?: string;
    note?: string;
    type?: Highlight['type'];
  }>,
): Promise<Highlight[]> {
  const current = await listSidecarHighlights(pdfPath);
  const next = current.map((highlight) => {
    const update = updates.find((item) => (
      item.annotationId === highlight.annotationId || item.annotationId === highlight.id
    ));
    if (!update) return highlight;
    return {
      ...highlight,
      text: typeof update.text === 'string' ? update.text : highlight.text,
      note: typeof update.note === 'string' ? update.note : highlight.note,
      type: update.type || highlight.type,
    };
  });
  return replaceSidecarHighlights(pdfPath, next);
}

export async function deleteSidecarHighlights(
  pdfPath: string,
  identifiers: string[],
): Promise<Highlight[]> {
  const idSet = new Set(identifiers);
  const current = await listSidecarHighlights(pdfPath);
  return replaceSidecarHighlights(pdfPath, current.filter((highlight) => (
    !idSet.has(highlight.id) && (!highlight.annotationId || !idSet.has(highlight.annotationId))
  )));
}
