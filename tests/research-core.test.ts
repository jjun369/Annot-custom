import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rename, writeFile } from 'node:fs/promises';
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
});

describe('research relationships and search', () => {
  test('links one document to multiple projects and finds Korean/English text', async () => {
    const document = await db.createExternalDocument({
      displayTitle: 'Samsung CIS small pixel isolation', kind: 'patent', tags: ['삼성', 'DTI'],
    });
    await db.replaceDocumentChunks(document.id, [{ page: 1, text: '0.7 μm 이하 이미지센서의 crosstalk 저감 구조' }]);
    const first = await db.createProject({ name: '삼성 CIS', profileId: 'profile-cis-pa' });
    const second = await db.createProject({ name: 'HDR 구조', profileId: 'profile-cis-pa' });
    await db.setProjectDocument(first.id, document.id, true);
    await db.setProjectDocument(second.id, document.id, true);
    expect(new Set(await db.getDocumentProjectIds(document.id))).toEqual(new Set([first.id, second.id]));
    expect((await db.searchDocuments('crosstalk', first.id))[0]?.document.id).toBe(document.id);
    expect((await db.searchDocuments('이미지센서', second.id))[0]?.document.id).toBe(document.id);
  });
});

describe('portable backup v2', () => {
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
});

describe('Windows-safe filenames', () => {
  test('removes reserved filename characters and trailing dots', async () => {
    const { sanitizeFilenamePart } = await import('@/lib/research-index');
    expect(sanitizeFilenamePart('A: title? <test>.  ', 100)).toBe('A title test');
  });
});
