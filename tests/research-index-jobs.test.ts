import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

type EventHandler = (event: { type: string; [key: string]: unknown }) => void | Promise<void>;

interface ExtractionControl {
  onEvent?: EventHandler;
  resolve: () => void;
  reject: (error: Error) => void;
  cancelled: boolean;
  result: Promise<void>;
}

const mocks = vi.hoisted(() => ({
  sourcePath: '',
  document: null as Record<string, unknown> | null,
  extraction: null as ExtractionControl | null,
  replace: vi.fn(),
  updateTitle: vi.fn(),
}));

vi.mock('@/lib/annot-sessions', () => ({ resolveFolderPath: () => mocks.sourcePath }));
vi.mock('@/lib/research-index', () => ({
  splitResearchText: (text: string) => text ? [text] : [],
  inferFirstPageTitle: () => null,
}));
vi.mock('@/lib/research-db', () => ({
  getDocumentById: vi.fn(async () => mocks.document),
  replaceDocumentChunksFromStaging: mocks.replace,
  updateInferredDocumentTitleIfUnchanged: mocks.updateTitle,
}));
vi.mock('@/lib/pdf-text', () => ({
  startPdfTextExtraction: vi.fn(async (_path: string, onEvent: EventHandler) => {
    const extraction = mocks.extraction;
    if (!extraction) throw new Error('test extraction was not prepared');
    extraction.onEvent = onEvent;
    return {
      result: extraction.result,
      cancel: () => {
        extraction.cancelled = true;
        extraction.reject(new Error('cancelled by test'));
      },
    };
  }),
}));

import { ResearchIndexJobManager } from '@/lib/research-index-jobs';

function createExtraction(): ExtractionControl {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const result = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { resolve, reject, cancelled: false, result };
}

async function waitFor<T>(callback: () => T | null | undefined): Promise<T> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = callback();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for index job state.');
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.extraction = createExtraction();
  const directory = await mkdtemp(path.join(tmpdir(), 'pagedock-index-job-test-'));
  mocks.sourcePath = path.join(directory, 'source.pdf');
  const source = Buffer.from('original source bytes');
  await writeFile(mocks.sourcePath, source);
  mocks.document = {
    id: 'document-1',
    currentPath: 'papers/source.pdf',
    sha256: createHash('sha256').update(source).digest('hex'),
    displayTitle: 'custom title',
  };
  mocks.replace.mockImplementation(async (_documentId: string, stagingPath: string) => {
    const staged = await readFile(stagingPath, 'utf8');
    expect(staged).toContain('page text');
    return 1;
  });
  mocks.updateTitle.mockResolvedValue(false);
});

describe('ephemeral PDF index jobs', () => {
  test('reports verified extraction progress and commits staged chunks once', async () => {
    const manager = new ResearchIndexJobManager();
    const started = await manager.start('document-1');
    const extraction = await waitFor(() => mocks.extraction?.onEvent ? mocks.extraction : null);

    await extraction.onEvent!({ type: 'totalPages', totalPages: 1 });
    await extraction.onEvent!({ type: 'page', page: 1, text: 'page text' });
    expect(manager.get(started.job.id)).toMatchObject({ state: 'extracting', totalPages: 1, pagesProcessed: 1, chunks: 0 });
    await extraction.onEvent!({ type: 'done', pages: 1 });
    extraction.resolve();

    const finished = await waitFor(() => {
      const job = manager.get(started.job.id);
      return job?.state === 'succeeded' ? job : null;
    });
    expect(finished).toMatchObject({ pagesProcessed: 1, chunks: 1, warnings: [] });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });

  test('cancels during extraction without replacing the current index', async () => {
    const manager = new ResearchIndexJobManager();
    const started = await manager.start('document-1');
    await waitFor(() => mocks.extraction?.onEvent ? mocks.extraction : null);

    expect((await manager.cancel(started.job.id)).state).toBe('cancelling');
    const finished = await waitFor(() => {
      const job = manager.get(started.job.id);
      return job?.state === 'cancelled' ? job : null;
    });
    expect(finished.error).toBeUndefined();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  test('rejects a source changed after extraction and retains the current index', async () => {
    const manager = new ResearchIndexJobManager();
    const started = await manager.start('document-1');
    const extraction = await waitFor(() => mocks.extraction?.onEvent ? mocks.extraction : null);

    await extraction.onEvent!({ type: 'totalPages', totalPages: 1 });
    await extraction.onEvent!({ type: 'page', page: 1, text: 'page text' });
    await extraction.onEvent!({ type: 'done', pages: 1 });
    await writeFile(mocks.sourcePath, 'changed source bytes');
    extraction.resolve();

    const finished = await waitFor(() => {
      const job = manager.get(started.job.id);
      return job?.state === 'failed' ? job : null;
    });
    expect(finished.error?.code).toBe('SOURCE_CHANGED');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
