import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

import { resolveFolderPath } from '@/lib/annot-sessions';
import { buildExecutableCandidates, resolveExecutable } from '@/lib/command-runtime';
import { getCommonPythonCandidateBases } from '@/lib/platform-paths';

export interface PdfTextPage {
  page: number;
  text: string;
}

export type PdfTextStreamEvent =
  | { type: 'totalPages'; totalPages: number }
  | { type: 'page'; page: number; text: string }
  | { type: 'done'; pages: number };

export interface PdfTextExtraction {
  result: Promise<void>;
  cancel: () => void;
}

const MAX_EVENT_LINE_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const IDLE_TIMEOUT_MS = 60 * 1000;
const TOTAL_TIMEOUT_MS = 30 * 60 * 1000;

const PDF_TEXT_SCRIPT = String.raw`
import json
import sys

try:
    import pymupdf as fitz
except ImportError:
    import fitz

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

pdf_path = sys.argv[1]
document = fitz.open(pdf_path)
try:
    print(json.dumps({"type": "totalPages", "totalPages": document.page_count}, ensure_ascii=False), flush=True)
    for index, page in enumerate(document):
        print(json.dumps({"type": "page", "page": index + 1, "text": page.get_text("text") or ""}, ensure_ascii=False), flush=True)
    print(json.dumps({"type": "done", "pages": document.page_count}, ensure_ascii=False), flush=True)
finally:
    document.close()
`;

function pythonCandidates(): string[] {
  return buildExecutableCandidates(
    [process.env.PAGEDOCK_PYTHON_BIN, process.env.ANNOT_PYTHON_BIN, process.env.PYTHON_BIN, process.env.PYTHON],
    process.platform === 'win32' ? 'python' : 'python3',
    getCommonPythonCandidateBases(),
  );
}

async function resolvePython(): Promise<{ command: string; prefix: string[] }> {
  const candidates = [
    ...pythonCandidates(),
    ...buildExecutableCandidates([process.env.PAGEDOCK_PYTHON_BIN, process.env.ANNOT_PYTHON_BIN, process.env.PYTHON_BIN], 'python3', []),
    ...buildExecutableCandidates([process.env.ANNOT_PYTHON_LAUNCHER], 'py', [path.join(process.env.SystemRoot || 'C:\\Windows', 'py')]),
  ];
  const executable = await resolveExecutable([...new Set(candidates)]);
  if (!executable) throw new Error('PDF 본문을 읽을 Python 3 실행 파일을 찾지 못했습니다.');
  return /([\\/]|^)py(\.exe)?$/i.test(executable)
    ? { command: executable, prefix: ['-3'] }
    : { command: executable, prefix: [] };
}

function parseStreamEvent(line: string): PdfTextStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('PDF 본문 스트림 결과를 해석하지 못했습니다.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PDF 본문 스트림 형식이 올바르지 않습니다.');
  }
  const event = value as PdfTextStreamEvent;
  if (event.type !== 'totalPages' && event.type !== 'page' && event.type !== 'done') {
    throw new Error('알 수 없는 PDF 본문 스트림 이벤트입니다.');
  }
  return event;
}

function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill();
  if (process.platform !== 'win32' || !child.pid) return;
  const fallback = setTimeout(() => {
    if (child.exitCode === null) {
      // `pid` is supplied by Node, and taskkill is intentionally called without a shell.
      const taskkill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      taskkill.on('error', () => {});
    }
  }, 1500);
  child.once('close', () => clearTimeout(fallback));
}

export async function startPdfTextExtraction(
  pdfPath: string,
  onEvent: (event: PdfTextStreamEvent) => void | Promise<void>,
): Promise<PdfTextExtraction> {
  const python = await resolvePython();
  const absolutePath = resolveFolderPath(pdfPath);
  const child = spawn(python.command, [...python.prefix, '-c', PDF_TEXT_SCRIPT, absolutePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  });

  let cancelled = false;
  let stderr = '';
  let timeoutError: Error | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const stopForTimeout = (message: string) => {
    timeoutError ||= new Error(message);
    stopChild(child);
  };
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stopForTimeout('PDF 본문 추출이 60초 동안 진행되지 않았습니다.'), IDLE_TIMEOUT_MS);
  };
  resetIdleTimer();
  const totalTimer = setTimeout(() => stopForTimeout('PDF 본문 추출 시간이 30분을 초과했습니다.'), TOTAL_TIMEOUT_MS);
  child.stderr.on('data', (chunk: Buffer) => {
    if (Buffer.byteLength(stderr, 'utf8') >= MAX_STDERR_BYTES) return;
    const remaining = MAX_STDERR_BYTES - Buffer.byteLength(stderr, 'utf8');
    stderr += chunk.toString('utf8').slice(0, remaining);
  });

  const outcome = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('close', (code) => resolve({ code }));
  });

  const result = (async () => {
    let buffer = '';
    try {
      for await (const chunk of child.stdout) {
        resetIdleTimer();
        buffer += (chunk as Buffer).toString('utf8');
        if (Buffer.byteLength(buffer, 'utf8') > MAX_EVENT_LINE_BYTES) {
          throw new Error('PDF 본문 한 페이지가 허용된 크기를 초과했습니다.');
        }
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) {
            throw new Error('PDF 본문 한 페이지가 허용된 크기를 초과했습니다.');
          }
          if (line) await onEvent(parseStreamEvent(line));
          newline = buffer.indexOf('\n');
        }
      }
      if (buffer.trim()) await onEvent(parseStreamEvent(buffer.replace(/\r$/, '')));
      const completed = await outcome;
      if (timeoutError) throw timeoutError;
      if (completed.error) throw completed.error;
      if (completed.code !== 0) {
        throw new Error(stderr.trim() || 'PDF 본문을 읽지 못했습니다.');
      }
      if (cancelled) throw new Error('PDF 본문 읽기를 취소했습니다.');
    } catch (error) {
      stopChild(child);
      await outcome;
      throw error;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(totalTimer);
    }
  })();

  return {
    result,
    cancel: () => {
      cancelled = true;
      stopChild(child);
    },
  };
}

export async function extractPdfTextByPage(pdfPath: string): Promise<PdfTextPage[]> {
  const pages: PdfTextPage[] = [];
  let declaredPages: number | null = null;
  let completed = false;
  const extraction = await startPdfTextExtraction(pdfPath, (event) => {
    if (event.type === 'totalPages') {
      if (!Number.isInteger(event.totalPages) || event.totalPages < 0 || declaredPages !== null) {
        throw new Error('PDF 페이지 수 정보가 올바르지 않습니다.');
      }
      declaredPages = event.totalPages;
    } else if (event.type === 'page') {
      if (declaredPages === null || event.page !== pages.length + 1 || typeof event.text !== 'string') {
        throw new Error('PDF 페이지 순서가 올바르지 않습니다.');
      }
      pages.push({ page: event.page, text: event.text });
    } else if (declaredPages === null || event.pages !== pages.length || event.pages !== declaredPages || completed) {
      throw new Error('PDF 본문 완료 정보가 올바르지 않습니다.');
    } else {
      completed = true;
    }
  });
  await extraction.result;
  if (!completed) throw new Error('PDF 본문 완료 정보를 받지 못했습니다.');
  return pages;
}
