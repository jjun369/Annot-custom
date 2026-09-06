import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const runFile = promisify(execFile);
const python = process.env.PAGEDOCK_E2E_PYTHON_BIN;
const liveTest = python ? test : test.skip;
const temporaryRootPrefix = path.join(tmpdir(), 'pagedock-index-e2e-test-');

let root = '';
let documentId = '';
let db: typeof import('@/lib/research-db');
let manager: import('@/lib/research-index-jobs').ResearchIndexJobManager;

async function waitFor<T>(callback: () => Promise<T | null>): Promise<T> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = await callback();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for real PDF indexing.');
}

beforeAll(async () => {
  if (!python) return;
  root = await mkdtemp(temporaryRootPrefix);
  process.env.PAGEDOCK_ROOT = root;
  process.env.ANNOT_ROOT = root;
  const pdfPath = path.join(root, 'streaming-index-fixture.pdf');
  await runFile(python, ['-c', [
    'import pymupdf, sys',
    'document = pymupdf.open()',
    "document.new_page().insert_text((72, 72), 'PageDock streaming index verification')",
    "document.new_page().insert_text((72, 72), 'second page searchable phrase')",
    'document.save(sys.argv[1])',
    'document.close()',
  ].join('\n'), pdfPath]);
  db = await import('@/lib/research-db');
  const document = await db.ensureDocumentForPath('streaming-index-fixture.pdf');
  documentId = document.id;
  const jobs = await import('@/lib/research-index-jobs');
  manager = new jobs.ResearchIndexJobManager();
});

afterAll(async () => {
  db?.closeResearchDatabaseConnections();
  if (root.startsWith(temporaryRootPrefix)) await rm(root, { recursive: true, force: true });
});

describe('real PyMuPDF streaming index', () => {
  liveTest('indexes a real two-page PDF and makes its text searchable', async () => {
    const started = await manager.start(documentId);
    const completed = await waitFor(async () => {
      const job = manager.get(started.job.id);
      return job && ['succeeded', 'failed', 'cancelled'].includes(job.state) ? job : null;
    });

    expect(completed.state, completed.error?.message).toBe('succeeded');
    expect(completed).toMatchObject({ totalPages: 2, pagesProcessed: 2, chunks: 2 });
    const results = await db.searchDocuments('searchable phrase');
    expect(results.some((result) => result.document.id === documentId)).toBe(true);
    const bytes = await readFile(path.join(root, 'streaming-index-fixture.pdf'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe((await db.getDocumentById(documentId))?.sha256);
  });
});
