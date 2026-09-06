import { createHash, randomUUID } from 'crypto';
import { once } from 'events';
import { createReadStream, createWriteStream, promises as fs, type Stats } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { resolveFolderPath } from '@/lib/annot-sessions';
import { startPdfTextExtraction, type PdfTextExtraction, type PdfTextStreamEvent } from '@/lib/pdf-text';
import { inferFirstPageTitle, splitResearchText } from '@/lib/research-index';
import {
  getDocumentById,
  replaceDocumentChunksFromStaging,
  updateInferredDocumentTitleIfUnchanged,
} from '@/lib/research-db';

const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_STAGED_BYTES = 1024 * 1024 * 1024;

export type ResearchIndexJobState = 'starting' | 'extracting' | 'cancelling' | 'committing' | 'succeeded' | 'cancelled' | 'failed';

export interface ResearchIndexJobSnapshot {
  id: string;
  documentId: string;
  state: ResearchIndexJobState;
  totalPages?: number;
  pagesProcessed: number;
  chunks: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: { code: string; message: string };
  warnings: string[];
}

interface SourceSnapshot {
  relativePath: string;
  absolutePath: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

interface JobContext {
  snapshot: ResearchIndexJobSnapshot;
  cancelled: boolean;
  extraction?: PdfTextExtraction;
  source?: SourceSnapshot;
  stagingDirectory: string;
  stagingPath: string;
  staging?: ReturnType<typeof createWriteStream>;
  stagingFailure?: Error;
  stagingClosed: boolean;
  stagedBytes: number;
  declaredPages?: number;
  expectedPage: number;
  done: boolean;
  firstPageText: string;
}

export class ResearchIndexJobError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ResearchIndexJobError';
  }
}

function snapshotOf(context: JobContext): ResearchIndexJobSnapshot {
  return {
    ...context.snapshot,
    error: context.snapshot.error ? { ...context.snapshot.error } : undefined,
    warnings: [...context.snapshot.warnings],
  };
}

function isTerminal(state: ResearchIndexJobState): boolean {
  return state === 'succeeded' || state === 'cancelled' || state === 'failed';
}

function matchingStats(stats: Stats, source: SourceSnapshot): boolean {
  return stats.isFile() && stats.size === source.size && stats.mtimeMs === source.mtimeMs;
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer);
  return digest.digest('hex');
}

function asJobError(error: unknown): ResearchIndexJobError {
  if (error instanceof ResearchIndexJobError) return error;
  return new ResearchIndexJobError(
    'INDEX_FAILED',
    error instanceof Error && error.message ? error.message : 'PDF 본문 색인에 실패했습니다.',
  );
}

export class ResearchIndexJobManager {
  #jobs = new Map<string, JobContext>();
  #activeJobId?: string;
  #stagingRoot = path.join(tmpdir(), 'PageDock', 'research-index');
  #initialization?: Promise<void>;

  async start(documentId: string): Promise<{ job: ResearchIndexJobSnapshot; reused: boolean }> {
    await this.ensureStagingRoot();
    let active = this.#activeJobId ? this.#jobs.get(this.#activeJobId) : undefined;
    if (active && isTerminal(active.snapshot.state)) {
      this.#activeJobId = undefined;
      active = undefined;
    }
    if (active) {
      if (active.snapshot.documentId === documentId) return { job: snapshotOf(active), reused: true };
      throw new ResearchIndexJobError('INDEXER_BUSY', '다른 PDF의 본문 색인이 진행 중입니다. 완료하거나 취소한 뒤 다시 시도하세요.');
    }

    const id = randomUUID();
    const context: JobContext = {
      snapshot: {
        id,
        documentId,
        state: 'starting',
        pagesProcessed: 0,
        chunks: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        warnings: [],
      },
      cancelled: false,
      stagingDirectory: path.join(this.#stagingRoot, id),
      stagingPath: path.join(this.#stagingRoot, id, 'chunks.ndjson'),
      stagingClosed: false,
      stagedBytes: 0,
      expectedPage: 1,
      done: false,
      firstPageText: '',
    };
    this.#jobs.set(id, context);
    this.#activeJobId = id;
    void this.run(context);
    return { job: snapshotOf(context), reused: false };
  }

  get(jobId: string): ResearchIndexJobSnapshot | null {
    this.expireTerminalJobs();
    const context = this.#jobs.get(jobId);
    return context ? snapshotOf(context) : null;
  }

  async cancel(jobId: string): Promise<ResearchIndexJobSnapshot> {
    this.expireTerminalJobs();
    const context = this.#jobs.get(jobId);
    if (!context) throw new ResearchIndexJobError('JOB_NOT_FOUND', '색인 작업 상태를 찾을 수 없습니다. 앱이 다시 시작된 경우에는 기존 색인은 그대로 유지되며 다시 시작할 수 있습니다.');
    if (context.snapshot.state === 'starting' || context.snapshot.state === 'extracting') {
      context.cancelled = true;
      this.setState(context, 'cancelling');
      context.extraction?.cancel();
      return snapshotOf(context);
    }
    if (context.snapshot.state === 'cancelling') return snapshotOf(context);
    if (context.snapshot.state === 'committing') {
      throw new ResearchIndexJobError('NOT_CANCELLABLE', '색인 저장을 시작했습니다. 이 단계는 기존 색인을 안전하게 교체하므로 취소할 수 없습니다.');
    }
    throw new ResearchIndexJobError('NOT_CANCELLABLE', '이미 끝난 색인 작업은 취소할 수 없습니다.');
  }

  private async ensureStagingRoot(): Promise<void> {
    if (!this.#initialization) {
      this.#initialization = (async () => {
        // Staging is disposable process-local work, never a workspace file or backup input.
        await fs.rm(this.#stagingRoot, { recursive: true, force: true });
        await fs.mkdir(this.#stagingRoot, { recursive: true });
      })();
    }
    await this.#initialization;
  }

  private setState(context: JobContext, state: ResearchIndexJobState): void {
    context.snapshot.state = state;
    context.snapshot.updatedAt = new Date().toISOString();
    if (isTerminal(state)) context.snapshot.completedAt = context.snapshot.updatedAt;
  }

  private expireTerminalJobs(): void {
    const threshold = Date.now() - JOB_TTL_MS;
    for (const [id, context] of this.#jobs) {
      if (isTerminal(context.snapshot.state) && context.snapshot.completedAt && Date.parse(context.snapshot.completedAt) < threshold) {
        this.#jobs.delete(id);
      }
    }
  }

  private async captureSource(documentId: string): Promise<SourceSnapshot> {
    const document = await getDocumentById(documentId);
    if (!document) throw new ResearchIndexJobError('DOCUMENT_NOT_FOUND', '문서를 찾지 못했습니다.');
    if (!document.currentPath || !document.sha256) {
      throw new ResearchIndexJobError('SOURCE_UNAVAILABLE', 'PDF 원문 또는 원문 식별 정보가 연결되지 않았습니다.');
    }
    const absolutePath = resolveFolderPath(document.currentPath);
    let stats: Stats;
    try {
      stats = await fs.stat(absolutePath);
    } catch {
      throw new ResearchIndexJobError('SOURCE_UNAVAILABLE', 'PDF 원문 파일을 찾을 수 없습니다.');
    }
    if (!stats.isFile()) throw new ResearchIndexJobError('SOURCE_UNAVAILABLE', '연결된 PDF 원문 경로가 파일이 아닙니다.');
    return {
      relativePath: document.currentPath,
      absolutePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: document.sha256,
    };
  }

  private async verifySource(context: JobContext): Promise<void> {
    const source = context.source;
    if (!source) throw new ResearchIndexJobError('SOURCE_UNAVAILABLE', 'PDF 원문 정보를 찾지 못했습니다.');
    const document = await getDocumentById(context.snapshot.documentId);
    if (!document || document.currentPath !== source.relativePath || document.sha256 !== source.sha256) {
      throw new ResearchIndexJobError('SOURCE_CHANGED', '색인 중 문서 연결 또는 원문 식별 정보가 바뀌었습니다. 기존 색인은 유지했습니다.');
    }
    let beforeHash: Stats;
    try {
      beforeHash = await fs.stat(source.absolutePath);
    } catch {
      throw new ResearchIndexJobError('SOURCE_CHANGED', '색인 중 PDF 원문을 찾을 수 없게 되었습니다. 기존 색인은 유지했습니다.');
    }
    if (!matchingStats(beforeHash, source)) {
      throw new ResearchIndexJobError('SOURCE_CHANGED', '색인 중 PDF 원문이 바뀌었습니다. 기존 색인은 유지했습니다.');
    }
    const digest = await sha256File(source.absolutePath);
    const afterHash = await fs.stat(source.absolutePath);
    if (!matchingStats(afterHash, source) || digest !== source.sha256) {
      throw new ResearchIndexJobError('SOURCE_CHANGED', '색인 중 PDF 원문이 바뀌었습니다. 기존 색인은 유지했습니다.');
    }
  }

  private async writeChunk(context: JobContext, chunk: { page: number; text: string }): Promise<void> {
    const staging = context.staging;
    if (!staging) throw new ResearchIndexJobError('INDEX_FAILED', '임시 색인 저장소를 열지 못했습니다.');
    if (context.stagingFailure) throw context.stagingFailure;
    const line = `${JSON.stringify({ page: chunk.page, kind: 'page', text: chunk.text })}\n`;
    const byteLength = Buffer.byteLength(line, 'utf8');
    if (context.stagedBytes + byteLength > MAX_STAGED_BYTES) {
      throw new ResearchIndexJobError('INDEX_TOO_LARGE', '색인할 본문이 임시 저장 한도를 초과했습니다. 기존 색인은 유지했습니다.');
    }
    context.stagedBytes += byteLength;
    if (!staging.write(line, 'utf8')) await once(staging, 'drain');
    if (context.stagingFailure) throw context.stagingFailure;
  }

  private async closeStaging(context: JobContext): Promise<void> {
    const staging = context.staging;
    if (!staging || context.stagingClosed) return;
    if (context.stagingFailure) throw context.stagingFailure;
    await new Promise<void>((resolve, reject) => {
      staging.once('error', reject);
      staging.end(resolve);
    });
    context.stagingClosed = true;
  }

  private validateAndStageEvent(context: JobContext, event: PdfTextStreamEvent): Promise<void> | void {
    if (context.cancelled) throw new ResearchIndexJobError('CANCELLED', '색인 취소가 요청되었습니다.');
    if (event.type === 'totalPages') {
      if (context.declaredPages !== undefined || !Number.isSafeInteger(event.totalPages) || event.totalPages < 0) {
        throw new ResearchIndexJobError('INVALID_PDF_STREAM', 'PDF 페이지 수 정보가 올바르지 않습니다.');
      }
      context.declaredPages = event.totalPages;
      context.snapshot.totalPages = event.totalPages;
      context.snapshot.updatedAt = new Date().toISOString();
      return;
    }
    if (event.type === 'page') {
      if (context.declaredPages === undefined || context.done
        || !Number.isSafeInteger(event.page) || event.page !== context.expectedPage
        || event.page > context.declaredPages || typeof event.text !== 'string') {
        throw new ResearchIndexJobError('INVALID_PDF_STREAM', 'PDF 페이지 순서 또는 내용이 올바르지 않습니다.');
      }
      const stagePage = async () => {
        if (event.page === 1) context.firstPageText = event.text;
        for (const text of splitResearchText(event.text)) await this.writeChunk(context, { page: event.page, text });
        context.expectedPage += 1;
        context.snapshot.pagesProcessed += 1;
        context.snapshot.updatedAt = new Date().toISOString();
      };
      return stagePage();
    }
    if (context.declaredPages === undefined || context.done || !Number.isSafeInteger(event.pages)
      || event.pages !== context.declaredPages || event.pages !== context.snapshot.pagesProcessed) {
      throw new ResearchIndexJobError('INVALID_PDF_STREAM', 'PDF 본문 완료 정보가 올바르지 않습니다.');
    }
    context.done = true;
    context.snapshot.updatedAt = new Date().toISOString();
  }

  private async markCancelled(context: JobContext): Promise<void> {
    context.cancelled = true;
    this.setState(context, 'cancelled');
  }

  private async run(context: JobContext): Promise<void> {
    try {
      context.source = await this.captureSource(context.snapshot.documentId);
      if (context.cancelled) return this.markCancelled(context);
      await fs.mkdir(context.stagingDirectory, { recursive: true });
      context.staging = createWriteStream(context.stagingPath, { encoding: 'utf8', flags: 'wx' });
      context.staging.on('error', (error) => { context.stagingFailure = error; });
      if (context.cancelled) return this.markCancelled(context);
      this.setState(context, 'extracting');
      context.extraction = await startPdfTextExtraction(context.source.relativePath, (event) => this.validateAndStageEvent(context, event));
      if (context.cancelled) context.extraction.cancel();
      await context.extraction.result;
      context.extraction = undefined;
      await this.closeStaging(context);
      if (!context.done || context.declaredPages === undefined || context.snapshot.pagesProcessed !== context.declaredPages) {
        throw new ResearchIndexJobError('INVALID_PDF_STREAM', 'PDF 본문 완료 정보를 받지 못했습니다.');
      }
      if (context.cancelled) return this.markCancelled(context);
      await this.verifySource(context);
      if (context.cancelled) return this.markCancelled(context);
      this.setState(context, 'committing');
      context.snapshot.chunks = await replaceDocumentChunksFromStaging(context.snapshot.documentId, context.stagingPath);
      const initialTitle = path.posix.basename(context.source.relativePath).replace(/\.pdf$/i, '');
      if (initialTitle && (await getDocumentById(context.snapshot.documentId))?.displayTitle === initialTitle) {
        const inferredTitle = inferFirstPageTitle(context.firstPageText);
        if (inferredTitle) {
          try {
            await updateInferredDocumentTitleIfUnchanged(context.snapshot.documentId, initialTitle, inferredTitle);
          } catch {
            context.snapshot.warnings.push('본문 색인은 완료했지만 자동 제목 갱신에는 실패했습니다. 제목은 직접 수정할 수 있습니다.');
          }
        }
      }
      this.setState(context, 'succeeded');
    } catch (error) {
      if (context.cancelled) await this.markCancelled(context);
      else {
        const failure = asJobError(error);
        context.snapshot.error = { code: failure.code, message: failure.message };
        this.setState(context, 'failed');
      }
    } finally {
      try {
        await this.closeStaging(context);
      } catch {
        if (!isTerminal(context.snapshot.state)) {
          context.snapshot.error = { code: 'INDEX_FAILED', message: '임시 색인 파일을 마무리하지 못했습니다.' };
          this.setState(context, 'failed');
        }
      }
      await fs.rm(context.stagingDirectory, { recursive: true, force: true });
      if (this.#activeJobId === context.snapshot.id) this.#activeJobId = undefined;
    }
  }
}

export const researchIndexJobs = new ResearchIndexJobManager();
