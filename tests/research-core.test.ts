import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
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

  test('restores a small backup without Python after creating a safety snapshot', async () => {
    const { createPortableBackup, importPortableBackupFile } = await import('@/lib/library-backup');
    const uploadDirectory = await mkdtemp(path.join(tmpdir(), 'pagedock-backup-upload-test-'));
    const archivePath = path.join(uploadDirectory, 'backup.zip');
    await writeFile(archivePath, await createPortableBackup(false));
    const result = await importPortableBackupFile(archivePath, { forceInProcessFallback: true });
    expect(result.imported).toBeGreaterThan(0);
    const safetySnapshots = await readdir(path.join(root, '.annot', 'backups'));
    expect(safetySnapshots.some((name) => name.endsWith('.zip'))).toBe(true);
  });
});

describe('Windows-safe filenames', () => {
  test('removes reserved filename characters and trailing dots', async () => {
    const { sanitizeFilenamePart } = await import('@/lib/research-index');
    expect(sanitizeFilenamePart('A: title? <test>.  ', 100)).toBe('A title test');
    expect(sanitizeFilenamePart('CON', 100)).toBe('_CON');
  });
});
