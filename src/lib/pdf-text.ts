import { spawn } from 'child_process';
import path from 'path';

import { buildExecutableCandidates, resolveExecutable } from '@/lib/command-runtime';
import { resolveFolderPath } from '@/lib/annot-sessions';
import { getCommonPythonCandidateBases } from '@/lib/platform-paths';

export interface PdfTextPage {
  page: number;
  text: string;
}

const PDF_TEXT_SCRIPT = String.raw`
import fitz
import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

pdf_path = sys.argv[1]
document = fitz.open(pdf_path)
try:
    pages = [{"page": index + 1, "text": page.get_text("text") or ""} for index, page in enumerate(document)]
    json.dump(pages, sys.stdout, ensure_ascii=False)
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
    ...buildExecutableCandidates([process.env.PAGEDOCK_PYTHON_BIN, process.env.ANNOT_PYTHON_BIN, process.env.PYTHON_BIN], 'python3', []),
    ...pythonCandidates(),
    ...buildExecutableCandidates([process.env.ANNOT_PYTHON_LAUNCHER], 'py', [path.join(process.env.SystemRoot || 'C:\\Windows', 'py')]),
  ];
  const executable = await resolveExecutable([...new Set(candidates)]);
  if (!executable) throw new Error('PDF 본문을 읽을 Python 3 실행 파일을 찾지 못했습니다.');
  return /([\\/]|^)py(\.exe)?$/i.test(executable)
    ? { command: executable, prefix: ['-3'] }
    : { command: executable, prefix: [] };
}

export async function extractPdfTextByPage(pdfPath: string): Promise<PdfTextPage[]> {
  const python = await resolvePython();
  const absolutePath = resolveFolderPath(pdfPath);
  return new Promise((resolve, reject) => {
    const child = spawn(python.command, [...python.prefix, '-c', PDF_TEXT_SCRIPT, absolutePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'PDF 본문을 읽지 못했습니다.'));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as PdfTextPage[];
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        reject(new Error('PDF 본문 결과를 해석하지 못했습니다.'));
      }
    });
  });
}
