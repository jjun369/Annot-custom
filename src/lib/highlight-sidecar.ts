import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { mergeHighlights, normalizeHighlightRects } from '@/lib/highlight-utils';
import { inferStudyKind, isHighlightStudyKind, normalizeResolvedAt } from '@/lib/highlight-study';
import { isHighlightWorkKind, normalizeWorkDoneAt } from '@/lib/highlight-work';
import { ensureDocumentForPath, getDocumentByPath } from '@/lib/research-db';
import {
  createStudyCard,
  normalizeStudyCard,
  STUDY_CARD_SIDECAR_VERSION,
  StudyCardDraft,
  StudyCardPatch,
  updateStudyCard,
} from '@/lib/study-cards';
import {
  createVisualRegion,
  normalizeVisualRegion,
  updateVisualRegion,
  VisualRegionDraft,
  VisualRegionPatch,
} from '@/lib/visual-regions';
import { Highlight, StudyCard, VisualRegion } from '@/types';

const SIDECAR_VERSION = 1;

interface StoredHighlightSidecar {
  [key: string]: unknown;
  version: number;
  documentId?: string;
  pdfPath: string;
  highlights: Highlight[];
  study?: {
    version: number;
    cards: StudyCard[];
  };
  /**
   * An additive, portable list of PDF-region anchors. It deliberately stores
   * only source coordinates and user-authored metadata; the PDF remains the
   * visual source of truth.
   */
  visualRegions?: VisualRegion[];
  updatedAt: string;
}

const sidecarMutationLocks = new Map<string, Promise<void>>();

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
  const studyKind = isHighlightStudyKind(value.studyKind)
    ? value.studyKind
    : inferStudyKind({ type, studyKind: undefined });
  const workKind = isHighlightWorkKind(value.workKind) ? value.workKind : undefined;
  const workDoneAt = workKind && workKind !== 'finding'
    ? normalizeWorkDoneAt(value.workDoneAt)
    : undefined;
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
    studyKind,
    resolvedAt: normalizeResolvedAt(value.resolvedAt),
    workKind,
    workDoneAt,
    createdAt: typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
      ? value.createdAt
      : undefined,
    updatedAt: typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
      ? value.updatedAt
      : undefined,
  };
}

function normalizeStudy(value: unknown, documentId?: string): StoredHighlightSidecar['study'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { cards?: unknown };
  if (!Array.isArray(candidate.cards)) return undefined;
  const cards = candidate.cards
    .map((card) => normalizeStudyCard(card, documentId))
    .filter((card): card is StudyCard => card !== null);
  return cards.length > 0
    ? { version: STUDY_CARD_SIDECAR_VERSION, cards }
    : undefined;
}

function normalizeVisualRegions(value: unknown, documentId?: string): VisualRegion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const regions = value
    .map((region) => normalizeVisualRegion(region, documentId))
    .filter((region): region is VisualRegion => region !== null);
  return regions.length > 0 ? regions : undefined;
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
      ...parsed,
      version: SIDECAR_VERSION,
      documentId: locations.documentId,
      pdfPath: normalizedPath,
      highlights: mergeSidecarHighlights(highlights),
      study: normalizeStudy(parsed.study, locations.documentId),
      visualRegions: normalizeVisualRegions(parsed.visualRegions, locations.documentId),
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

function mergeSidecarHighlights(highlights: Highlight[]): Highlight[] {
  return mergeHighlights(highlights);
}

function emptySidecar(pdfPath: string, documentId?: string): StoredHighlightSidecar {
  return {
    version: SIDECAR_VERSION,
    documentId,
    pdfPath,
    highlights: [],
    updatedAt: new Date().toISOString(),
  };
}

async function writeSidecar(pdfPath: string, current: StoredHighlightSidecar): Promise<StoredHighlightSidecar> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const locations = await sidecarPaths(normalizedPath);
  const filePath = locations.primary;
  const value: StoredHighlightSidecar = {
    ...current,
    version: SIDECAR_VERSION,
    documentId: locations.documentId,
    pdfPath: normalizedPath,
    highlights: mergeSidecarHighlights(current.highlights
      .map((highlight) => normalizeHighlight(normalizedPath, highlight, locations.documentId))
      .filter((highlight): highlight is Highlight => highlight !== null)),
    study: normalizeStudy(current.study, locations.documentId),
    visualRegions: normalizeVisualRegions(current.visualRegions, locations.documentId),
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
  return value;
}

async function mutateSidecar<T>(
  pdfPath: string,
  mutation: (sidecar: StoredHighlightSidecar) => T,
): Promise<T> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const locations = await sidecarPaths(normalizedPath);
  const lockKey = locations.primary;
  const previous = sidecarMutationLocks.get(lockKey) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => completion);
  sidecarMutationLocks.set(lockKey, queued);
  await previous.catch(() => undefined);

  try {
    const current = await readSidecar(normalizedPath) ?? emptySidecar(normalizedPath, locations.documentId);
    const result = mutation(current);
    await writeSidecar(normalizedPath, current);
    return result;
  } finally {
    release?.();
    if (sidecarMutationLocks.get(lockKey) === queued) {
      sidecarMutationLocks.delete(lockKey);
    }
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
  return mutateSidecar(normalizedPath, (sidecar) => {
    sidecar.highlights = next;
    return next;
  });
}

export async function moveSidecarHighlights(oldPdfPath: string, newPdfPath: string): Promise<void> {
  const current = await readSidecar(oldPdfPath);
  if (!current || (
    current.highlights.length === 0
    && (current.study?.cards.length ?? 0) === 0
    && (current.visualRegions?.length ?? 0) === 0
  )) return;
  const normalizedNewPath = normalizePdfPath(newPdfPath);
  await mutateSidecar(normalizedNewPath, (destination) => {
    destination.highlights = mergeSidecarHighlights([
      ...destination.highlights,
      ...current.highlights.map((highlight) => ({ ...highlight, pdfPath: normalizedNewPath })),
    ]);
    const cards = [...(destination.study?.cards ?? [])];
    for (const card of current.study?.cards ?? []) {
      if (!cards.some((candidate) => candidate.id === card.id)) cards.push(card);
    }
    destination.study = cards.length > 0
      ? { version: STUDY_CARD_SIDECAR_VERSION, cards }
      : undefined;
    const visualRegions = [...(destination.visualRegions ?? [])];
    for (const region of current.visualRegions ?? []) {
      if (!visualRegions.some((candidate) => candidate.id === region.id)) visualRegions.push(region);
    }
    destination.visualRegions = visualRegions.length > 0 ? visualRegions : undefined;
  });
}

export async function upsertSidecarHighlights(pdfPath: string, highlights: Highlight[]): Promise<Highlight[]> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const document = await getDocumentByPath(normalizedPath);
  const normalizedHighlights = highlights
    .map((highlight) => normalizeHighlight(normalizedPath, highlight, document?.id))
    .filter((highlight): highlight is Highlight => highlight !== null);
  return mutateSidecar(normalizedPath, (sidecar) => {
    const next = mergeSidecarHighlights([...sidecar.highlights, ...normalizedHighlights]);
    sidecar.highlights = next;
    return next;
  });
}

export async function updateSidecarHighlights(
  pdfPath: string,
  updates: Array<{
    annotationId: string;
    text?: string;
    note?: string;
    type?: Highlight['type'];
    studyKind?: Highlight['studyKind'];
    resolvedAt?: string | null;
    workKind?: Highlight['workKind'] | null;
    workDoneAt?: string | null;
  }>,
): Promise<Highlight[]> {
  return mutateSidecar(pdfPath, (sidecar) => {
    const next = sidecar.highlights.map((highlight) => {
      const update = updates.find((item) => (
        item.annotationId === highlight.annotationId || item.annotationId === highlight.id
      ));
      if (!update) return highlight;
      const shouldUpdateResolvedAt = Object.prototype.hasOwnProperty.call(update, 'resolvedAt');
      const shouldUpdateWorkKind = Object.prototype.hasOwnProperty.call(update, 'workKind');
      const shouldUpdateWorkDoneAt = Object.prototype.hasOwnProperty.call(update, 'workDoneAt');
      const nextWorkKind = shouldUpdateWorkKind && isHighlightWorkKind(update.workKind)
        ? update.workKind
        : shouldUpdateWorkKind
          ? undefined
          : highlight.workKind;
      const workKindChanged = nextWorkKind !== highlight.workKind;
      return {
        ...highlight,
        text: typeof update.text === 'string' ? update.text : highlight.text,
        note: typeof update.note === 'string' ? update.note : highlight.note,
        type: update.type || highlight.type,
        studyKind: isHighlightStudyKind(update.studyKind) ? update.studyKind : highlight.studyKind,
        resolvedAt: shouldUpdateResolvedAt ? normalizeResolvedAt(update.resolvedAt) : highlight.resolvedAt,
        workKind: nextWorkKind,
        workDoneAt: nextWorkKind && nextWorkKind !== 'finding' && !workKindChanged
          ? (shouldUpdateWorkDoneAt ? normalizeWorkDoneAt(update.workDoneAt) : highlight.workDoneAt)
          : undefined,
        updatedAt: new Date().toISOString(),
      };
    });
    sidecar.highlights = next;
    return next;
  });
}

export async function deleteSidecarHighlights(
  pdfPath: string,
  identifiers: string[],
): Promise<Highlight[]> {
  const idSet = new Set(identifiers);
  return mutateSidecar(pdfPath, (sidecar) => {
    const next = sidecar.highlights.filter((highlight) => (
      !idSet.has(highlight.id) && (!highlight.annotationId || !idSet.has(highlight.annotationId))
    ));
    sidecar.highlights = next;
    return next;
  });
}

export async function listSidecarStudyCards(pdfPath: string): Promise<StudyCard[]> {
  const sidecar = await readSidecar(pdfPath);
  return sidecar?.study?.cards ?? [];
}

export async function createSidecarStudyCard(
  pdfPath: string,
  id: string,
  draft: StudyCardDraft,
): Promise<StudyCard> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const document = await getDocumentByPath(normalizedPath);
  const card = createStudyCard(id, draft, document?.id);
  if (!card) throw new Error('복습 카드의 원문 위치, 질문 또는 답이 올바르지 않습니다.');
  return mutateSidecar(normalizedPath, (sidecar) => {
    const cards = [...(sidecar.study?.cards ?? [])];
    if (cards.some((candidate) => candidate.id === card.id)) {
      throw new Error('이미 저장된 복습 카드입니다.');
    }
    cards.push(card);
    sidecar.study = { version: STUDY_CARD_SIDECAR_VERSION, cards };
    return card;
  });
}

export async function updateSidecarStudyCard(
  pdfPath: string,
  cardId: string,
  patch: StudyCardPatch,
): Promise<StudyCard> {
  return mutateSidecar(pdfPath, (sidecar) => {
    const cards = sidecar.study?.cards ?? [];
    const index = cards.findIndex((card) => card.id === cardId);
    if (index < 0) throw new Error('복습 카드를 찾을 수 없습니다.');
    const next = updateStudyCard(cards[index], patch);
    cards[index] = next;
    sidecar.study = { version: STUDY_CARD_SIDECAR_VERSION, cards };
    return next;
  });
}

export async function deleteSidecarStudyCard(pdfPath: string, cardId: string): Promise<StudyCard[]> {
  return mutateSidecar(pdfPath, (sidecar) => {
    const cards = (sidecar.study?.cards ?? []).filter((card) => card.id !== cardId);
    sidecar.study = cards.length > 0
      ? { version: STUDY_CARD_SIDECAR_VERSION, cards }
      : undefined;
    return cards;
  });
}

export async function listSidecarVisualRegions(pdfPath: string): Promise<VisualRegion[]> {
  const sidecar = await readSidecar(pdfPath);
  return sidecar?.visualRegions ?? [];
}

export async function createSidecarVisualRegion(
  pdfPath: string,
  id: string,
  draft: VisualRegionDraft,
): Promise<VisualRegion> {
  const normalizedPath = normalizePdfPath(pdfPath);
  const document = await getDocumentByPath(normalizedPath) ?? await ensureDocumentForPath(normalizedPath);
  const region = createVisualRegion(id, draft, document?.id);
  if (!region) throw new Error('기록할 PDF 영역 또는 종류가 올바르지 않습니다.');
  return mutateSidecar(normalizedPath, (sidecar) => {
    const regions = [...(sidecar.visualRegions ?? [])];
    if (regions.some((candidate) => candidate.id === region.id)) {
      throw new Error('이미 저장된 그림·표 기록입니다.');
    }
    regions.push(region);
    sidecar.visualRegions = regions;
    return region;
  });
}

export async function updateSidecarVisualRegion(
  pdfPath: string,
  regionId: string,
  patch: VisualRegionPatch,
): Promise<VisualRegion> {
  return mutateSidecar(pdfPath, (sidecar) => {
    const regions = sidecar.visualRegions ?? [];
    const index = regions.findIndex((region) => region.id === regionId);
    if (index < 0) throw new Error('그림·표 기록을 찾을 수 없습니다.');
    const next = updateVisualRegion(regions[index], patch);
    regions[index] = next;
    sidecar.visualRegions = regions;
    return next;
  });
}

export async function deleteSidecarVisualRegion(pdfPath: string, regionId: string): Promise<VisualRegion[]> {
  return mutateSidecar(pdfPath, (sidecar) => {
    const regions = (sidecar.visualRegions ?? []).filter((region) => region.id !== regionId);
    sidecar.visualRegions = regions.length > 0 ? regions : undefined;
    return regions;
  });
}
