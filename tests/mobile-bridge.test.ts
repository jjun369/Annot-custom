import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, test } from 'vitest';

let root: string;
let configRoot: string;
let bridgeRoot: string;
let mobile: typeof import('@/lib/mobile-bridge');
let sidecars: typeof import('@/lib/highlight-sidecar');
let database: typeof import('@/lib/research-db');
let backups: typeof import('@/lib/library-backup');

async function createFixturePdf(relativePath: string, label: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 540]);
  page.drawText(label, {
    x: 40,
    y: 460,
    size: 20,
    font: await pdf.embedFont(StandardFonts.Helvetica),
  });
  await writeFile(path.join(root, ...relativePath.split('/')), await pdf.save());
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pagedock-mobile-bridge-test-'));
  configRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-mobile-bridge-config-'));
  bridgeRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-mobile-bridge-output-'));
  process.env.PAGEDOCK_ROOT = root;
  process.env.ANNOT_ROOT = root;
  process.env.PAGEDOCK_CONFIG_DIR = configRoot;
  await mkdir(path.join(root, 'papers'), { recursive: true });
  mobile = await import('@/lib/mobile-bridge');
  sidecars = await import('@/lib/highlight-sidecar');
  database = await import('@/lib/research-db');
  backups = await import('@/lib/library-backup');
});

describe('mobile bridge', () => {
  test('exports an explicit document shelf as a self-contained PDF and tiny receipt', async () => {
    const pdfPath = 'papers/mobile-source.pdf';
    await createFixturePdf(pdfPath, 'PageDock visual export fixture');
    const source = await database.ensureDocumentForPath(pdfPath);
    await mobile.updateMobileBridgeSettings({ bridgeRoot, shelfDocumentIds: [] });
    await mobile.addMobileShelfPdf(pdfPath);
    const pendingInfo = await mobile.getMobileBridgeInfo();
    expect(pendingInfo.autoPublishEnabled).toBe(false);
    expect(pendingInfo.dirty).toBe(true);
    expect(pendingInfo.status).toBe('manual-required');
    await sidecars.upsertSidecarHighlights(pdfPath, [{
      id: 'mobile-highlight',
      documentId: source.id,
      pdfPath,
      page: 1,
      type: 'unknown',
      studyKind: 'unclear',
      text: 'A source-grounded study sentence.',
      note: 'Check this assumption again in the meeting.',
      rects: [{ x: 0.1, y: 0.12, width: 0.55, height: 0.06 }],
      position: { x: 0.1, y: 0.12, width: 0.55, height: 0.06 },
    }]);
    await sidecars.createSidecarVisualRegion(pdfPath, 'mobile-visual', {
      page: 1,
      rect: { x: 0.1, y: 0.1, width: 0.7, height: 0.3 },
      kind: 'figure',
      memo: 'Keep the relationship between the labels and the result.',
    });

    const result = await mobile.publishMobileBridge();
    expect(result.documentCount).toBe(1);
    const artifact = path.join(bridgeRoot, 'Mobile', 'PageDock-Mobile.pdf');
    const manifestPath = path.join(bridgeRoot, 'Mobile', 'manifest.json');
    const [artifactBytes, manifest] = await Promise.all([
      readFile(artifact),
      readFile(manifestPath, 'utf8').then((raw) => JSON.parse(raw) as Record<string, unknown>),
    ]);
    expect(artifactBytes.byteLength).toBeGreaterThan(1000);
    expect(Object.keys(manifest).sort()).toEqual(['artifact', 'exportId', 'generatedAt', 'schemaVersion', 'sha256']);
    expect(manifest.artifact).toBe('PageDock-Mobile.pdf');
    expect(manifest.sha256).toBe(createHash('sha256').update(artifactBytes).digest('hex'));
    expect((await readdir(path.join(bridgeRoot, 'Mobile'))).some((name) => name.endsWith('.png'))).toBe(false);
    expect((await mobile.getMobileBridgeInfo()).conflict).toBe(false);
    expect((await mobile.getMobileBridgeInfo()).dirty).toBe(false);
  });

  test('keeps automatic derived publishing opt-in and calculates debounce plus rate limit from durable state', async () => {
    const start = Date.parse('2026-09-04T10:00:00.000Z');
    expect(mobile.getNextMobileBridgeAutomaticPublishAt({
      autoPublishEnabled: false,
      mobileExportDirty: true,
      mobileExportDirtyAt: new Date(start).toISOString(),
      lastAutomaticPublishAt: undefined,
    }, start)).toBeUndefined();
    expect(mobile.getNextMobileBridgeAutomaticPublishAt({
      autoPublishEnabled: true,
      mobileExportDirty: true,
      mobileExportDirtyAt: new Date(start).toISOString(),
      lastAutomaticPublishAt: new Date(start - 2 * 60_000).toISOString(),
    }, start)).toBe(start + 8 * 60_000);

    const settings = await mobile.readMobileBridgeSettings();
    expect(settings.autoPublishEnabled).toBe(false);
    await mobile.updateMobileBridgeSettings({ autoPublishEnabled: true });
    expect((await mobile.readMobileBridgeSettings()).autoPublishEnabled).toBe(true);
    await mobile.updateMobileBridgeSettings({ autoPublishEnabled: false });
  });

  test('never silently overwrites an externally changed mobile PDF', async () => {
    const artifact = path.join(bridgeRoot, 'Mobile', 'PageDock-Mobile.pdf');
    await appendFile(artifact, Buffer.from('external change'));
    await expect(mobile.publishMobileBridge()).rejects.toMatchObject({ name: 'MobileBridgeConflictError' });
    await expect(mobile.publishMobileBridge({ preserveConflict: true })).resolves.toMatchObject({ documentCount: 1 });
    const conflicts = await readdir(path.join(bridgeRoot, 'Mobile', 'Conflicts'));
    expect(conflicts.some((name) => name.endsWith('.pdf'))).toBe(true);
    expect((await mobile.getMobileBridgeInfo()).conflict).toBe(false);
  });

  test('does not automatically recreate a previously issued mobile pair after external deletion, but allows an explicit fresh publish', async () => {
    const artifact = path.join(bridgeRoot, 'Mobile', 'PageDock-Mobile.pdf');
    const manifest = path.join(bridgeRoot, 'Mobile', 'manifest.json');
    await unlink(artifact);
    await unlink(manifest);
    await expect(mobile.publishMobileBridge({ automatic: true })).rejects.toMatchObject({ name: 'MobileBridgeConflictError' });
    await expect(mobile.publishMobileBridge()).resolves.toMatchObject({ documentCount: 1 });
  });

  test('copies a verified local automatic archive byte-for-byte and prunes bridge automatic snapshots independently', async () => {
    const localArchive = path.join(root, 'fixture-auto.zip');
    await writeFile(localArchive, Buffer.from('portable backup fixture'));
    const copied = await mobile.copyPortableBackupToMobileBridge(localArchive, 'pagedock-auto-20260904-010101.zip', 'auto');
    expect(copied.copied).toBe(true);
    const copiedBytes = await readFile(path.join(bridgeRoot, 'Backups', 'Auto', 'pagedock-auto-20260904-010101.zip'));
    expect(copiedBytes.equals(await readFile(localArchive))).toBe(true);
    for (const suffix of ['010102', '010103', '010104']) {
      await writeFile(path.join(bridgeRoot, 'Backups', 'Auto', `pagedock-auto-20260904-${suffix}.zip`), suffix);
    }
    await mobile.pruneMobileBridgeAutomaticBackups(3);
    expect((await readdir(path.join(bridgeRoot, 'Backups', 'Auto'))).filter((name) => name.endsWith('.zip')).sort()).toEqual([
      'pagedock-auto-20260904-010102.zip',
      'pagedock-auto-20260904-010103.zip',
      'pagedock-auto-20260904-010104.zip',
    ]);
  });

  test('writes a full bridge manual backup without applying automatic retention', async () => {
    const backup = await backups.createManualBackupInMobileBridge();
    expect(backup.fileName).toMatch(/^PageDock-Full-.*\.zip$/);
    await backups.verifyPortableBackupFile(backup.destination);
    expect((await readdir(path.join(bridgeRoot, 'Backups', 'Manual'))).some((name) => name === backup.fileName)).toBe(true);
  });

  test('publishes a validated local automatic backup before reporting bridge-copy failure or success', async () => {
    const backup = await backups.createAutomaticBackup();
    expect(backup.bridgeCopied).toBe(true);
    const localPath = path.join(root, '.annot', 'backups', backup.fileName);
    await backups.verifyPortableBackupFile(localPath);
    const bridgePath = path.join(bridgeRoot, 'Backups', 'Auto', backup.fileName);
    expect((await readFile(bridgePath)).equals(await readFile(localPath))).toBe(true);
    expect((await readdir(path.join(bridgeRoot, 'Backups', 'Auto'))).filter((name) => name.endsWith('.zip')).length).toBeLessThanOrEqual(3);
  });
});
