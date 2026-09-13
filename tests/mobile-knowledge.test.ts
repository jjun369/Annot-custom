import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';

let root: string;
let configRoot: string;
let bridgeRoot: string;
let mobile: typeof import('@/lib/mobile-bridge');
let store: typeof import('@/lib/knowledge-store');
let imageAssets: typeof import('@/lib/knowledge-image-assets');
let database: typeof import('@/lib/research-db');
let mobileKnowledge: typeof import('@/lib/mobile-knowledge');
let knowledgeRoute: typeof import('@/app/api/mobile-bridge/knowledge/route');

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+X1VdNwAAAABJRU5ErkJggg==',
  'base64',
);

async function extractPdfText(filePath: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await readFile(filePath)), verbosity: 0 } as never);
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await loadingTask.destroy();
  return pages.join('\n');
}

async function captureTopic(title: string, body: string, provenance: 'literature_claim' | 'ai_inference' = 'literature_claim') {
  const note = await store.captureKnowledgeNote(`${title} 원문 메모`, `${title}.md`, {
    provenance: { kind: provenance, originDate: '2024-02' },
  });
  const [review] = await store.saveKnowledgeProposals(note.id, {
    title,
    summary: `${title} 요약`,
    proposals: [{
      kind: 'create', topicId: '', title, rationale: '합성 테스트', conflictSummary: '',
      proposedSummary: `${title} 요약`, proposedBodyMarkdown: body, sourceClaims: [note.rawText],
    }],
  });
  const resolved = await store.resolveKnowledgeReview(review.id, 'accept');
  return { note, topic: resolved.topic! };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pagedock-mobile-knowledge-test-'));
  configRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-mobile-knowledge-config-'));
  bridgeRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-mobile-knowledge-output-'));
  process.env.PAGEDOCK_ROOT = root;
  process.env.ANNOT_ROOT = root;
  process.env.PAGEDOCK_CONFIG_DIR = configRoot;
  await mkdir(path.join(root, 'papers'), { recursive: true });
  mobile = await import('@/lib/mobile-bridge');
  store = await import('@/lib/knowledge-store');
  imageAssets = await import('@/lib/knowledge-image-assets');
  database = await import('@/lib/research-db');
  mobileKnowledge = await import('@/lib/mobile-knowledge');
  knowledgeRoute = await import('@/app/api/mobile-bridge/knowledge/route');
});

describe('mobile knowledge selection', () => {
  test('normalizes absent legacy arrays without rewriting settings', async () => {
    const settingsPath = path.join(configRoot, 'mobile-bridge.json');
    const legacy = JSON.stringify({ version: 1, shelfDocumentIds: ['legacy-document'] });
    await writeFile(settingsPath, legacy, 'utf8');
    expect((await mobile.readMobileBridgeSettings()).shelfTopicIds).toEqual([]);
    expect((await mobile.readMobileBridgeSettings()).shelfNoteIds).toEqual([]);
    expect(await readFile(settingsPath, 'utf8')).toBe(legacy);
  });

  test('lists combined searchable summaries with bounded pagination and rejects malformed ranges', async () => {
    const first = await store.captureKnowledgeNote('검색 가능한 원문 메모', '검색-메모.md');
    const second = await captureTopic('검색 주제', '검색 본문');
    const result = mobileKnowledge.listMobileKnowledgeItems(await store.getKnowledgeSnapshot(), '검색', 0, 1);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: expect.any(String), kind: expect.any(String), title: expect.any(String) });
    expect(result.items[0]).not.toHaveProperty('rawText');
    expect(second.topic.id).not.toBe(first.id);

    const invalid = await knowledgeRoute.GET(new NextRequest('http://localhost/api/mobile-bridge/knowledge?offset=-1'));
    expect(invalid.status).toBe(400);
    const invalidLimit = await knowledgeRoute.GET(new NextRequest('http://localhost/api/mobile-bridge/knowledge?limit=101'));
    expect(invalidLimit.status).toBe(400);
  });

  test('publishes a knowledge-only PDF with full Korean and long-token text', async () => {
    const longUrl = `https://example.test/${'가'.repeat(180)}?source=${'x'.repeat(120)}`;
    const note = await store.captureKnowledgeNote(`출퇴근 메모\n${longUrl}`, '출퇴근-캡처.md', {
      provenance: { kind: 'ai_inference', originDate: '2025-03-04' },
    });
    const topic = await captureTopic('휴대폰 읽기 주제', '# 원문 제목\n\n## 긴 한국어 제목\n\n한국어 본문과 긴 URL을 함께 읽습니다.', 'literature_claim');
    const sourcePdfPath = path.join(root, 'papers', 'not-selected.pdf');
    const sourcePdf = await PDFDocument.create();
    const sourcePage = sourcePdf.addPage([420, 540]);
    sourcePage.drawText('synthetic original', { x: 40, y: 460, size: 20, font: await sourcePdf.embedFont(StandardFonts.Helvetica) });
    const originalBytes = await sourcePdf.save();
    await writeFile(sourcePdfPath, originalBytes);

    await mobile.updateMobileBridgeSettings({
      bridgeRoot,
      shelfDocumentIds: [],
      shelfTopicIds: [topic.topic.id],
      shelfNoteIds: [note.id],
    });
    const result = await mobile.publishMobileBridge();
    expect(result).toMatchObject({ documentCount: 0, topicCount: 1, noteCount: 1, skippedKnowledgeCount: 0 });
    const artifact = path.join(bridgeRoot, 'Mobile', 'PageDock-Mobile.pdf');
    const text = await extractPdfText(artifact);
    expect(text).toContain('휴대폰 읽기 주제');
    expect(text).toContain('정리된 지식 주제');
    expect(text).toContain('캡처한 원문 메모');
    expect(text).toContain('AI 추론');
    expect(text).toContain('출퇴근 메모');
    expect(text).toContain('한국어 본문과 긴 URL을 함께 읽습니다.');
    expect(text).toContain('https://example.test/');
    expect(text).not.toContain('# 원문 제목');
    expect(Buffer.from(await readFile(sourcePdfPath)).equals(Buffer.from(originalBytes))).toBe(true);
    if (process.env.PAGEDOCK_PRINT_MOBILE_FIXTURE === '1') console.log(artifact);
  });

  test('renders a selected local image memo into the phone PDF without a web upload', async () => {
    const attachment = await imageAssets.storeKnowledgeImageAsset(ONE_PIXEL_PNG, 'image/png');
    const result = await store.captureKnowledgeNotes([{
      text: '회로도에서 전원 경로를 다시 점검한다.',
      sourceName: '이미지 메모 · power-path.png',
      attachments: [attachment],
    }]);
    const note = result.captured[0];
    await mobile.updateMobileBridgeSettings({
      bridgeRoot,
      shelfDocumentIds: [],
      shelfTopicIds: [],
      shelfNoteIds: [note.id],
    });
    await mobile.publishMobileBridge();
    const text = await extractPdfText(path.join(bridgeRoot, 'Mobile', 'PageDock-Mobile.pdf'));
    expect(text).toContain('회로도에서 전원 경로를 다시 점검한다.');
    expect(text).toContain('로컬 이미지 메모 1');
  });

  test('keeps unselected notes out, preserves missing selections, and deletes missing ids', async () => {
    const selected = await store.captureKnowledgeNote('선택된 메모 본문', 'selected.md');
    const unselected = await store.captureKnowledgeNote('선택하지 않은 메모 본문', 'unselected.md');
    const missingId = 'missing-knowledge-id';
    await mobile.updateMobileBridgeSettings({ shelfTopicIds: [], shelfNoteIds: [selected.id, missingId] });
    const info = await mobile.getMobileBridgeInfo();
    expect(info.knowledgeShelf).toEqual(expect.arrayContaining([
      { id: selected.id, kind: 'note', title: selected.title, missing: false, status: selected.status },
      { id: missingId, kind: 'note', title: '선택한 캡처 메모를 찾을 수 없습니다.', missing: true },
    ]));
    const result = await mobile.publishMobileBridge();
    expect(result.skippedKnowledgeCount).toBe(1);
    const text = await extractPdfText(path.join(bridgeRoot, 'Mobile', 'PageDock-Mobile.pdf'));
    expect(text).toContain('선택된 메모 본문');
    expect(text).not.toContain('선택하지 않은 메모 본문');
    expect(text).toContain('선택했지만 이번 사본에서 찾지 못한 Knowledge');
    await mobile.removeMobileKnowledgeSelection('note', missingId);
    expect((await mobile.readMobileBridgeSettings()).shelfNoteIds).toEqual([selected.id]);
    expect(unselected.id).not.toBe(selected.id);
  });

  test('keeps concurrent selections and only selected changes mark the bridge dirty', async () => {
    const first = await store.captureKnowledgeNote('동시 선택 A', 'a.md');
    const second = await store.captureKnowledgeNote('동시 선택 B', 'b.md');
    await mobile.updateMobileBridgeSettings({ shelfTopicIds: [], shelfNoteIds: [] });
    const [a, b] = await Promise.all([
      mobile.addMobileKnowledgeSelection('note', first.id),
      mobile.addMobileKnowledgeSelection('note', second.id),
    ]);
    expect(a.added).toBe(true);
    expect(b.added).toBe(true);
    expect((await mobile.readMobileBridgeSettings()).shelfNoteIds).toEqual(expect.arrayContaining([first.id, second.id]));
    await mobile.publishMobileBridge();
    expect((await mobile.getMobileBridgeInfo()).dirty).toBe(false);

    const unselected = await store.captureKnowledgeNote('동시 선택되지 않은 메모', 'unselected-concurrent.md');
    await store.markKnowledgeNoteError(unselected.id, 'synthetic');
    expect((await mobile.getMobileBridgeInfo()).dirty).toBe(false);
    await store.markKnowledgeNoteError(first.id, 'selected note changed');
    expect((await mobile.getMobileBridgeInfo()).dirty).toBe(true);
  });

  test('direct shelf changes invalidate a published copy but no-op settings do not', async () => {
    const note = await store.captureKnowledgeNote('보관함 변경 회귀 테스트', 'shelf-change.md');
    await mobile.updateMobileBridgeSettings({ shelfDocumentIds: [], shelfTopicIds: [], shelfNoteIds: [note.id] });
    await mobile.publishMobileBridge();
    const revision = (await mobile.readMobileBridgeSettings()).mobileExportRevision;
    await mobile.updateMobileBridgeSettings({ shelfNoteIds: [note.id] });
    expect((await mobile.getMobileBridgeInfo()).dirty).toBe(false);
    expect((await mobile.readMobileBridgeSettings()).mobileExportRevision).toBe(revision);
    await mobile.updateMobileBridgeSettings({ shelfNoteIds: [] });
    expect((await mobile.getMobileBridgeInfo()).dirty).toBe(true);
    expect((await mobile.readMobileBridgeSettings()).mobileExportRevision).toBeGreaterThan(revision);
  });

  test('deduplicates an explicitly selected topic anchored to multiple selected PDFs', async () => {
    const relativePdfPath = 'papers/anchored.pdf';
    const pdfPath = path.join(root, ...relativePdfPath.split('/'));
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([420, 540]);
    page.drawText('anchored source', { x: 40, y: 460, size: 20, font: await pdf.embedFont(StandardFonts.Helvetica) });
    const sourceBytes = await pdf.save();
    await writeFile(pdfPath, sourceBytes);
    const document = await database.ensureDocumentForPath(relativePdfPath);
    const secondPdf = await PDFDocument.create();
    secondPdf.addPage([430, 550]);
    await writeFile(path.join(root, 'papers', 'anchored-second.pdf'), await secondPdf.save());
    const secondDocument = await database.ensureDocumentForPath('papers/anchored-second.pdf');
    const note = await store.captureKnowledgeNote('앵커 원문', 'anchor.pdf · p.2', {
      sourceAnchors: [
        { id: 'anchor-1', scope: 'selection', documentId: document.id, page: 2, text: '앵커 원문' },
        { id: 'anchor-2', scope: 'selection', documentId: secondDocument.id, page: 1, text: '앵커 원문' },
      ],
    });
    const [review] = await store.saveKnowledgeProposals(note.id, {
      title: '앵커 주제', summary: '', proposals: [{
        kind: 'create', topicId: '', title: '앵커 주제', rationale: '', conflictSummary: '',
        proposedSummary: '', proposedBodyMarkdown: '앵커 주제의 전체 본문입니다.', sourceClaims: [note.rawText],
      }],
    });
    const topic = (await store.resolveKnowledgeReview(review.id, 'accept')).topic!;
    await mobile.updateMobileBridgeSettings({ shelfDocumentIds: [document.id, secondDocument.id], shelfTopicIds: [topic.id], shelfNoteIds: [] });
    const result = await mobile.publishMobileBridge();
    expect(result.topicCount).toBe(1);
    const text = await extractPdfText(path.join(bridgeRoot, 'Mobile', 'PageDock-Mobile.pdf'));
    expect(text.match(/앵커 주제의 전체 본문입니다\./g)?.length).toBe(1);
    expect(text).toContain('앵커 주제의 전체 본문입니다.');
    expect(text).toContain('정리된 지식 주제');
    expect(createHash('sha256').update(await readFile(pdfPath)).digest('hex')).toBe(createHash('sha256').update(sourceBytes).digest('hex'));
  });
});
