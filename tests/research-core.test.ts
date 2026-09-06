import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { beforeAll, describe, expect, test } from 'vitest';

let root: string;
let db: typeof import('@/lib/research-db');

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pagedock-research-test-'));
  process.env.PAGEDOCK_ROOT = root;
  process.env.ANNOT_ROOT = root;
  db = await import('@/lib/research-db');
});

describe('stable document identity', () => {
  test('keeps identity after an external filename change', async () => {
    await mkdir(path.join(root, 'papers'), { recursive: true });
    const first = path.join(root, 'papers', 'bad-name.pdf');
    const second = path.join(root, 'papers', '2024 - Author - Useful title.pdf');
    const content = Buffer.from('%PDF-1.4\nPageDock identity fixture\n%%EOF');
    await writeFile(first, content);
    const original = await db.ensureDocumentForPath('papers/bad-name.pdf');
    expect(original.sha256).toBe(createHash('sha256').update(content).digest('hex'));

    await rename(first, second);
    const synced = await db.syncWorkspaceDocuments();
    const moved = synced.documents.find((item) => item.currentPath === 'papers/2024 - Author - Useful title.pdf');
    expect(moved?.id).toBe(original.id);
  });

  test('does not guess when the same hash has multiple paths', async () => {
    const content = Buffer.from('%PDF-1.4\nduplicate fixture\n%%EOF');
    await writeFile(path.join(root, 'papers', 'duplicate-a.pdf'), content);
    await writeFile(path.join(root, 'papers', 'duplicate-b.pdf'), content);
    const synced = await db.syncWorkspaceDocuments();
    expect(synced.conflicts).toBeGreaterThan(0);
    expect((await db.listDocumentConflicts()).some((item) => item.kind === 'duplicate')).toBe(true);
  });

  test('requires explicit approval when a PDF is replaced at the same path', async () => {
    const relativePath = 'papers/replaced-in-explorer.pdf';
    const absolutePath = path.join(root, ...relativePath.split('/'));
    const originalContent = Buffer.from('%PDF-1.4\noriginal document\n%%EOF');
    const replacementContent = Buffer.from('%PDF-1.4\ncompletely different replacement document\n%%EOF');
    await writeFile(absolutePath, originalContent);
    const original = await db.ensureDocumentForPath(relativePath);

    await writeFile(absolutePath, replacementContent);
    const pending = await db.ensureDocumentForPath(relativePath);
    expect(pending.id).toBe(original.id);
    expect(pending.sha256).toBe(createHash('sha256').update(originalContent).digest('hex'));
    expect(pending.missing).toBe(true);

    const conflict = (await db.listDocumentConflicts()).find((item) => (
      item.documentId === original.id && item.kind === 'content-changed'
    ));
    expect(conflict).toBeDefined();
    await db.resolveDocumentConflict(conflict!.id, 'accept-current-file');

    const accepted = await db.getDocumentById(original.id);
    expect(accepted?.sha256).toBe(createHash('sha256').update(replacementContent).digest('hex'));
    expect(accepted?.missing).toBe(false);
  });
});

describe('research relationships and search', () => {
  test('links one document to multiple projects and finds Korean/English text', async () => {
    const document = await db.createExternalDocument({
      displayTitle: 'Samsung CIS small pixel isolation', kind: 'patent', tags: ['삼성', 'DTI'],
    });
    await db.replaceDocumentChunks(document.id, [{ page: 1, text: '0.7 μm 이하 이미지센서의 crosstalk 저감 구조' }]);
    await db.upsertPatentMetadata({
      documentId: document.id,
      assignees: ['Samsung Electronics'],
      inventors: [],
      citations: [],
      claimsText: 'A storage node coupled to a floating diffusion region.',
      updatedAt: new Date().toISOString(),
    });
    const first = await db.createProject({ name: '삼성 CIS', profileId: 'profile-cis-pa' });
    const second = await db.createProject({ name: 'HDR 구조', profileId: 'profile-cis-pa' });
    await db.setProjectDocument(first.id, document.id, true);
    await db.setProjectDocument(second.id, document.id, true);
    expect(new Set(await db.getDocumentProjectIds(document.id))).toEqual(new Set([first.id, second.id]));
    expect((await db.searchDocuments('crosstalk', first.id))[0]?.document.id).toBe(document.id);
    expect((await db.searchDocuments('이미지센서', second.id))[0]?.document.id).toBe(document.id);
    expect((await db.searchDocuments('storage node', first.id))[0]?.document.id).toBe(document.id);
  });

  test('indexes personal notes and tags stored with a local PDF', async () => {
    const relativePath = 'papers/searchable-personal-note.pdf';
    await writeFile(path.join(root, ...relativePath.split('/')), Buffer.from('%PDF-1.4\nsearch note fixture\n%%EOF'));
    const document = await db.ensureDocumentForPath(relativePath);
    const { updatePaperMetadata } = await import('@/lib/paper-metadata');
    await updatePaperMetadata(relativePath, {
      noteMarkdown: '후면 산란 억제 공정 아이디어',
      personalTags: ['공정검토'],
    });
    await db.refreshDocumentSearchIndex(relativePath);
    expect((await db.searchDocuments('후면 산란'))[0]?.document.id).toBe(document.id);
    expect((await db.searchDocuments('공정검토'))[0]?.document.id).toBe(document.id);
  });
});

describe('portable paper metadata', () => {
  test('moves reading position metadata even when it is the only meaningful study state', async () => {
    const originalPath = 'papers/reading-position-original.pdf';
    const movedPath = 'papers/reading-position-renamed.pdf';
    await writeFile(path.join(root, ...originalPath.split('/')), Buffer.from('%PDF-1.4\nresume fixture\n%%EOF'));
    const { getPaperMetadata, movePaperMetadata, updatePaperMetadata } = await import('@/lib/paper-metadata');
    await updatePaperMetadata(originalPath, {
      readingPosition: {
        page: 137,
        pageOffsetRatio: 0.43,
        viewMode: 'scroll',
        updatedAt: '2026-08-31T12:00:00.000Z',
      },
    });
    await rename(path.join(root, ...originalPath.split('/')), path.join(root, ...movedPath.split('/')));
    await movePaperMetadata(originalPath, movedPath);

    expect((await getPaperMetadata(movedPath)).readingPosition).toMatchObject({
      page: 137,
      pageOffsetRatio: 0.43,
      viewMode: 'scroll',
    });
  });
});

describe('portable study highlight sidecars', () => {
  test('round-trips optional study state without changing sidecar version', async () => {
    const relativePath = 'papers/study-highlight-sidecar.pdf';
    await writeFile(path.join(root, ...relativePath.split('/')), Buffer.from('%PDF-1.4\nstudy highlight fixture\n%%EOF'));
    const document = await db.ensureDocumentForPath(relativePath);
    const { listSidecarHighlights, replaceSidecarHighlights } = await import('@/lib/highlight-sidecar');
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.04 };
    await replaceSidecarHighlights(relativePath, [{
      id: 'study-highlight-1',
      documentId: document.id,
      pdfPath: relativePath,
      page: 12,
      type: 'unknown',
      studyKind: 'unclear',
      resolvedAt: '2026-08-31T12:00:00.000Z',
      createdAt: '2026-08-30T12:00:00.000Z',
      updatedAt: '2026-08-31T12:00:00.000Z',
      text: 'Unclear source sentence.',
      note: 'Need to revisit.',
      rects: [rect],
      position: rect,
    }]);

    expect(await listSidecarHighlights(relativePath)).toMatchObject([{
      id: 'study-highlight-1',
      documentId: document.id,
      studyKind: 'unclear',
      resolvedAt: '2026-08-31T12:00:00.000Z',
    }]);
  });

  test('stores source-anchored recall cards in the same v1 sidecar without touching highlights', async () => {
    const relativePath = 'papers/study-card-sidecar.pdf';
    await writeFile(path.join(root, ...relativePath.split('/')), Buffer.from('%PDF-1.4\nstudy card fixture\n%%EOF'));
    const document = await db.ensureDocumentForPath(relativePath);
    const {
      createSidecarStudyCard,
      listSidecarStudyCards,
      replaceSidecarHighlights,
      updateSidecarStudyCard,
    } = await import('@/lib/highlight-sidecar');
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.04 };
    const card = await createSidecarStudyCard(relativePath, 'study-card-1', {
      sourceContext: {
        id: 'source-card-1',
        scope: 'selection',
        documentId: 'untrusted-client-document-id',
        page: 12,
        text: 'A selected source sentence.',
        rects: [rect],
      },
      front: 'What should I remember?',
      back: 'A learner-written answer.',
      origin: 'selection',
    });
    const clozeSourceText = 'The mitochondrion is the powerhouse of the cell.';
    const clozeAnswer = 'mitochondrion';
    const clozeStart = clozeSourceText.indexOf(clozeAnswer);
    await createSidecarStudyCard(relativePath, 'study-card-cloze', {
      sourceContext: {
        id: 'source-card-cloze',
        scope: 'selection',
        page: 12,
        text: clozeSourceText,
        rects: [rect],
      },
      front: 'unused',
      back: 'unused',
      origin: 'selection',
      kind: 'cloze',
      cloze: { text: clozeAnswer, start: clozeStart, end: clozeStart + clozeAnswer.length },
    });
    await replaceSidecarHighlights(relativePath, [{
      id: 'highlight-after-card',
      pdfPath: relativePath,
      page: 12,
      type: 'important',
      text: 'A separate highlight.',
      rects: [rect],
      position: rect,
    }]);
    const reviewed = await updateSidecarStudyCard(relativePath, card.id, { reviewResult: 'remembered' });
    const cards = await listSidecarStudyCards(relativePath);

    expect(cards).toContainEqual(expect.objectContaining({
      id: 'study-card-1',
      documentId: document.id,
      sourceContext: expect.objectContaining({ documentId: document.id, page: 12, rects: [rect] }),
      review: expect.objectContaining({ reviewCount: 1, lastResult: 'remembered', nextReviewDate: expect.any(String) }),
    }));
    expect(reviewed.sourceContext.documentId).toBe(document.id);
    expect(reviewed.review.nextReviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cards).toContainEqual(expect.objectContaining({
      id: 'study-card-cloze',
      kind: 'cloze',
      clozeText: clozeAnswer,
      clozeStart,
      clozeEnd: clozeStart + clozeAnswer.length,
      sourceContext: expect.objectContaining({ text: clozeSourceText }),
    }));

    await Promise.all([
      createSidecarStudyCard(relativePath, 'study-card-concurrent', {
        sourceContext: {
          id: 'source-card-concurrent',
          scope: 'selection',
          page: 13,
          text: 'A second selected source sentence.',
          rects: [rect],
        },
        front: 'Concurrent question',
        back: 'Concurrent answer',
        origin: 'selection',
      }),
      replaceSidecarHighlights(relativePath, [{
        id: 'highlight-concurrent',
        pdfPath: relativePath,
        page: 13,
        type: 'unknown',
        text: 'A concurrent highlight.',
        rects: [rect],
        position: rect,
      }]),
    ]);
    expect((await listSidecarStudyCards(relativePath)).map((item) => item.id)).toContain('study-card-concurrent');
  });

  test('keeps visual-region anchors additive across highlights, cards, and a document rename', async () => {
    const originalPath = 'papers/visual-region-before-rename.pdf';
    const renamedPath = 'papers/visual-region-after-rename.pdf';
    await writeFile(path.join(root, ...originalPath.split('/')), Buffer.from('%PDF-1.4\nvisual region fixture\n%%EOF'));
    const document = await db.ensureDocumentForPath(originalPath);
    const {
      createSidecarStudyCard,
      createSidecarVisualRegion,
      listSidecarStudyCards,
      listSidecarVisualRegions,
      replaceSidecarHighlights,
      updateSidecarVisualRegion,
    } = await import('@/lib/highlight-sidecar');
    const region = await createSidecarVisualRegion(originalPath, 'visual-region-1', {
      page: 8,
      rect: { x: 0.14, y: 0.318, width: 0.521, height: 0.207 },
      kind: 'table',
      memo: '온도 조건별 dark current 비교',
    });
    const sidecarPath = path.join(root, '.annot', 'annotations', `${document.id}.json`);
    const originalSidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as Record<string, unknown>;
    expect(originalSidecar.version).toBe(1);
    expect(originalSidecar.visualRegions).toEqual([expect.objectContaining({ id: region.id, documentId: document.id })]);
    await writeFile(sidecarPath, JSON.stringify({ ...originalSidecar, futureAdditiveState: { keep: true } }, null, 2), 'utf8');
    await createSidecarStudyCard(originalPath, 'visual-card-1', {
      sourceContext: {
        id: 'visual-card-source', scope: 'selection', page: 8, text: 'Anchored visual context.',
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      },
      front: 'What does this table compare?',
      back: 'Temperature-dependent dark current.',
      origin: 'selection',
    });
    await replaceSidecarHighlights(originalPath, [{
      id: 'visual-highlight-1', pdfPath: originalPath, page: 8, type: 'important', text: 'A separate highlight.',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }], position: { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
    }]);
    const updated = await updateSidecarVisualRegion(originalPath, region.id, { kind: 'figure', memo: '변경한 메모' });
    expect(updated).toMatchObject({ documentId: document.id, page: 8, kind: 'figure', memo: '변경한 메모' });
    expect(JSON.parse(await readFile(sidecarPath, 'utf8')).futureAdditiveState).toEqual({ keep: true });
    expect((await listSidecarStudyCards(originalPath)).map((card) => card.id)).toContain('visual-card-1');

    await rename(path.join(root, ...originalPath.split('/')), path.join(root, ...renamedPath.split('/')));
    await db.syncWorkspaceDocuments();
    expect(await listSidecarVisualRegions(renamedPath)).toEqual([expect.objectContaining({
      id: 'visual-region-1', documentId: document.id, page: 8, kind: 'figure', memo: '변경한 메모',
    })]);
  });

  test('loads an unscheduled 0.6 card as due without rewriting its sidecar', async () => {
    const relativePath = 'papers/legacy-study-card.pdf';
    await writeFile(path.join(root, ...relativePath.split('/')), Buffer.from('%PDF-1.4\nlegacy card fixture\n%%EOF'));
    const document = await db.ensureDocumentForPath(relativePath);
    const sidecarPath = path.join(root, '.annot', 'annotations', `${document.id}.json`);
    const legacySidecar = JSON.stringify({
      version: 1,
      documentId: document.id,
      pdfPath: relativePath,
      highlights: [],
      study: {
        version: 1,
        cards: [{
          id: 'legacy-card-1',
          documentId: document.id,
          sourceContext: {
            id: 'legacy-source-1',
            scope: 'selection',
            documentId: document.id,
            page: 2,
            text: 'A legacy source sentence.',
            rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
          },
          front: 'Legacy question',
          back: 'Legacy answer',
          origin: 'selection',
          createdAt: '2026-08-31T12:00:00.000Z',
          updatedAt: '2026-08-31T12:00:00.000Z',
          review: { reviewCount: 0 },
        }],
      },
      updatedAt: '2026-08-31T12:00:00.000Z',
    }, null, 2);
    await writeFile(sidecarPath, legacySidecar, 'utf8');
    const { listSidecarStudyCards } = await import('@/lib/highlight-sidecar');

    const cards = await listSidecarStudyCards(relativePath);
    expect(cards[0]?.review.nextReviewDate).toBeUndefined();
    expect(await readFile(sidecarPath, 'utf8')).toBe(legacySidecar);
  });

  test('keeps a recall card discoverable after the document path changes', async () => {
    const originalPath = 'papers/study-card-before-rename.pdf';
    const renamedPath = 'papers/study-card-after-rename.pdf';
    await writeFile(path.join(root, ...originalPath.split('/')), Buffer.from('%PDF-1.4\nrename study card fixture\n%%EOF'));
    const original = await db.ensureDocumentForPath(originalPath);
    const { createSidecarStudyCard, listSidecarStudyCards } = await import('@/lib/highlight-sidecar');
    await createSidecarStudyCard(originalPath, 'renamed-study-card', {
      sourceContext: {
        id: 'renamed-source', scope: 'selection', page: 4, text: 'Rename-safe source.',
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      },
      front: 'Rename-safe question',
      back: 'Rename-safe answer',
      origin: 'selection',
    });
    const clozeSourceText = 'Rename-safe source text for cloze recall.';
    const clozeAnswer = 'cloze';
    const clozeStart = clozeSourceText.indexOf(clozeAnswer);
    await createSidecarStudyCard(originalPath, 'renamed-cloze-card', {
      sourceContext: {
        id: 'renamed-cloze-source', scope: 'selection', page: 4, text: clozeSourceText,
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      },
      front: 'unused',
      back: 'unused',
      origin: 'selection',
      kind: 'cloze',
      cloze: { text: clozeAnswer, start: clozeStart, end: clozeStart + clozeAnswer.length },
    });
    await rename(path.join(root, ...originalPath.split('/')), path.join(root, ...renamedPath.split('/')));
    await db.syncWorkspaceDocuments();

    const cards = await listSidecarStudyCards(renamedPath);
    expect(cards.map((item) => item.id)).toEqual(expect.arrayContaining(['renamed-study-card', 'renamed-cloze-card']));
    expect(cards.find((item) => item.id === 'renamed-study-card')?.documentId).toBe(original.id);
    expect(cards).toContainEqual(expect.objectContaining({
      id: 'renamed-cloze-card', documentId: original.id, kind: 'cloze', clozeText: clozeAnswer,
    }));
  });
});

describe('staged research indexing', () => {
  test('atomically replaces live chunks from sequential NDJSON staging', async () => {
    const document = await db.createExternalDocument({ displayTitle: 'staged document', kind: 'paper' });
    await db.replaceDocumentChunks(document.id, [{ page: 1, text: 'old searchable text' }]);
    const stagingDirectory = await mkdtemp(path.join(tmpdir(), 'pagedock-index-stage-'));
    const stagingPath = path.join(stagingDirectory, 'chunks.ndjson');
    await writeFile(stagingPath, [
      JSON.stringify({ page: 1, kind: 'page', text: 'new Korean 본문 색인' }),
      JSON.stringify({ page: 2, kind: 'page', text: 'new English search body' }),
    ].join('\n'));

    expect(await db.replaceDocumentChunksFromStaging(document.id, stagingPath)).toBe(2);
    expect((await db.getDocumentChunks(document.id)).map((chunk) => chunk.text)).toEqual([
      'new Korean 본문 색인',
      'new English search body',
    ]);
    expect((await db.searchDocuments('English'))[0]?.document.id).toBe(document.id);
    expect((await db.searchDocuments('old searchable')).some((result) => result.document.id === document.id)).toBe(false);
  });

  test('leaves the current index untouched when staged data is invalid', async () => {
    const document = await db.createExternalDocument({ displayTitle: 'rollback document', kind: 'paper' });
    await db.replaceDocumentChunks(document.id, [{ page: 1, text: 'keep the old index' }]);
    const stagingDirectory = await mkdtemp(path.join(tmpdir(), 'pagedock-index-stage-'));
    const stagingPath = path.join(stagingDirectory, 'chunks.ndjson');
    await writeFile(stagingPath, `${JSON.stringify({ page: 1, kind: 'page', text: 'new text' })}\nnot-json`);

    await expect(db.replaceDocumentChunksFromStaging(document.id, stagingPath)).rejects.toThrow('임시 색인 조각');
    expect((await db.getDocumentChunks(document.id)).map((chunk) => chunk.text)).toEqual(['keep the old index']);
  });

  test('does not overwrite a title changed while an inferred-title update was pending', async () => {
    const document = await db.createExternalDocument({ displayTitle: 'original filename', kind: 'paper' });
    expect(await db.updateInferredDocumentTitleIfUnchanged(document.id, 'original filename', 'inferred paper title')).toBe(true);
    await db.updateDocument(document.id, { displayTitle: 'user edited title' });
    expect(await db.updateInferredDocumentTitleIfUnchanged(document.id, 'original filename', 'stale inferred title')).toBe(false);
    expect((await db.getDocumentById(document.id))?.displayTitle).toBe('user edited title');
  });
});

describe('portable backup v2', () => {
  test('treats basic and cloze recall cards as ordinary portable annotation-sidecar data', async () => {
    const relativePath = 'papers/backup-study-card.pdf';
    await writeFile(path.join(root, ...relativePath.split('/')), Buffer.from('%PDF-1.4\nbackup study card fixture\n%%EOF'));
    const document = await db.ensureDocumentForPath(relativePath);
    const { createSidecarStudyCard, createSidecarVisualRegion } = await import('@/lib/highlight-sidecar');
    await createSidecarStudyCard(relativePath, 'backup-card-1', {
      sourceContext: {
        id: 'backup-source',
        scope: 'selection',
        page: 2,
        text: 'Portable source text.',
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      },
      front: 'Portable question',
      back: 'Portable answer',
      origin: 'selection',
    });
    const clozeSourceText = 'Portable source text for a cloze card.';
    const clozeAnswer = 'cloze';
    const clozeStart = clozeSourceText.indexOf(clozeAnswer);
    await createSidecarStudyCard(relativePath, 'backup-cloze-card-1', {
      sourceContext: {
        id: 'backup-cloze-source',
        scope: 'selection',
        page: 2,
        text: clozeSourceText,
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      },
      front: 'unused',
      back: 'unused',
      origin: 'selection',
      kind: 'cloze',
      cloze: { text: clozeAnswer, start: clozeStart, end: clozeStart + clozeAnswer.length },
    });
    await createSidecarVisualRegion(relativePath, 'backup-visual-region-1', {
      page: 2,
      rect: { x: 0.12, y: 0.22, width: 0.4, height: 0.2 },
      kind: 'figure',
      memo: '백업에도 남아야 하는 그림 메모',
    });
    const { createPortableBackup } = await import('@/lib/library-backup');
    const zip = await JSZip.loadAsync(await createPortableBackup(false));
    const sidecar = JSON.parse(await zip.file(`library/.annot/annotations/${document.id}.json`)!.async('string')) as { version: number; study?: { cards?: Array<{ id: string; kind?: string; clozeText?: string; clozeStart?: number; clozeEnd?: number; review?: { nextReviewDate?: string } }> }; visualRegions?: Array<{ id: string; kind: string; memo: string }> };
    expect(sidecar.version).toBe(1);
    expect(sidecar.study?.cards?.map((card) => card.id)).toContain('backup-card-1');
    expect(sidecar.study?.cards?.[0]?.review?.nextReviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sidecar.study?.cards).toContainEqual(expect.objectContaining({
      id: 'backup-cloze-card-1',
      kind: 'cloze',
      clozeText: clozeAnswer,
      clozeStart,
      clozeEnd: clozeStart + clozeAnswer.length,
    }));
    expect(sidecar.visualRegions).toContainEqual(expect.objectContaining({
      id: 'backup-visual-region-1', kind: 'figure', memo: '백업에도 남아야 하는 그림 메모',
    }));
  });

  test('exports normalized research JSON instead of the live SQLite files', async () => {
    await mkdir(path.join(root, '.annot'), { recursive: true });
    await writeFile(
      path.join(root, '.annot', 'knowledge-revision-trash.json'),
      JSON.stringify({ version: 1, items: [] }),
    );
    const { createPortableBackup } = await import('@/lib/library-backup');
    const zip = await JSZip.loadAsync(await createPortableBackup(false));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { version: number; files: Array<{ path: string }> };
    expect(manifest.version).toBe(2);
    expect(manifest.files.some((item) => item.path === '.annot/research-export.json')).toBe(true);
    expect(manifest.files.some((item) => item.path === '.annot/knowledge-revision-trash.json')).toBe(true);
    expect(manifest.files.some((item) => /pagedock\.sqlite/i.test(item.path))).toBe(false);
    expect(zip.file('library/.annot/research-export.json')).not.toBeNull();
    expect(zip.file('library/.annot/knowledge-revision-trash.json')).not.toBeNull();
  });

  test('restores a small backup without Python after creating a safety snapshot', async () => {
    const { createPortableBackup, importPortableBackupFile } = await import('@/lib/library-backup');
    const cardPath = 'papers/restore-study-card.pdf';
    await writeFile(path.join(root, ...cardPath.split('/')), Buffer.from('%PDF-1.4\nrestore study card fixture\n%%EOF'));
    await db.ensureDocumentForPath(cardPath);
    const { createSidecarStudyCard, listSidecarStudyCards } = await import('@/lib/highlight-sidecar');
    await createSidecarStudyCard(cardPath, 'restore-card-1', {
      sourceContext: {
        id: 'restore-source', scope: 'selection', page: 1, text: 'Restore-safe source.',
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      },
      front: 'Restore-safe question',
      back: 'Restore-safe answer',
      origin: 'selection',
    });
    const uploadDirectory = await mkdtemp(path.join(tmpdir(), 'pagedock-backup-upload-test-'));
    const archivePath = path.join(uploadDirectory, 'backup.zip');
    await writeFile(archivePath, await createPortableBackup(false));
    const result = await importPortableBackupFile(archivePath, { forceInProcessFallback: true });
    expect(result.imported).toBeGreaterThan(0);
    const safetySnapshots = await readdir(path.join(root, '.annot', 'backups'));
    expect(safetySnapshots.some((name) => name.endsWith('.zip'))).toBe(true);
    expect((await listSidecarStudyCards(cardPath)).map((card) => card.id)).toContain('restore-card-1');
  });
});

describe('Windows-safe filenames', () => {
  test('removes reserved filename characters and trailing dots', async () => {
    const { sanitizeFilenamePart } = await import('@/lib/research-index');
    expect(sanitizeFilenamePart('A: title? <test>.  ', 100)).toBe('A title test');
    expect(sanitizeFilenamePart('CON', 100)).toBe('_CON');
  });
});
