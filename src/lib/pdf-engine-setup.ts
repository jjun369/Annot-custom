import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

import { buildExecutableCandidates, resolveExecutable } from '@/lib/command-runtime';
import {
  getCommonPythonCandidateBases,
  getManagedPythonExecutable,
  getPageDockConfigDirectory,
} from '@/lib/platform-paths';

const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

export interface PdfEngineStatus {
  ready: boolean;
  pythonInstalled: boolean;
  platform: NodeJS.Platform;
  canAutoInstall: boolean;
  setupUrl?: string;
  pythonPath?: string;
  pymupdfVersion?: string;
  error?: string;
}

function runProcess(command: string, args: string[], timeoutMs = PROCESS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString()}`.slice(-12000); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-12000); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('PDF 도구 준비 시간이 너무 오래 걸려 중단했습니다.'));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `PDF 도구 작업이 실패했습니다. (${code})`));
    });
  });
}

function pythonCandidates(): string[] {
  return buildExecutableCandidates(
    [process.env.PAGEDOCK_PYTHON_BIN, process.env.ANNOT_PYTHON_BIN, process.env.PYTHON_BIN],
    process.platform === 'win32' ? 'python' : 'python3',
    getCommonPythonCandidateBases(),
  );
}

async function findPython(): Promise<string | null> {
  return await resolveExecutable(pythonCandidates());
}

export async function getPdfEngineStatus(): Promise<PdfEngineStatus> {
  const python = await findPython();
  const platformDetails = {
    platform: process.platform,
    canAutoInstall: process.platform === 'win32' || (process.platform === 'darwin' && Boolean(python)),
    setupUrl: process.platform === 'darwin' ? 'https://www.python.org/downloads/macos/' : undefined,
  };
  if (!python) {
    return { ...platformDetails, ready: false, pythonInstalled: false, error: 'Python을 찾지 못했습니다.' };
  }
  try {
    const version = await runProcess(python, [
      '-c',
      'import fitz; print(getattr(fitz, "pymupdf_version", getattr(fitz, "VersionBind", "ready")))',
    ], 30000);
    return {
      ...platformDetails,
      ready: true,
      pythonInstalled: true,
      pythonPath: python,
      pymupdfVersion: version.split(/\r?\n/).at(-1)?.trim() || 'ready',
    };
  } catch (error) {
    return {
      ...platformDetails,
      ready: false,
      pythonInstalled: true,
      pythonPath: python,
      error: error instanceof Error ? error.message : 'PyMuPDF를 찾지 못했습니다.',
    };
  }
}

export async function installPdfEngine(): Promise<PdfEngineStatus> {
  if (process.platform === 'darwin') {
    let python = await findPython();
    if (!python) {
      throw new Error('Python 3을 먼저 설치한 뒤 다시 확인해 주세요. 기본 PDF 읽기와 메모는 계속 사용할 수 있습니다.');
    }
    const managedPython = getManagedPythonExecutable();
    try {
      await fs.access(managedPython);
    } catch {
      const environmentDirectory = path.join(getPageDockConfigDirectory(), 'python-env');
      await fs.mkdir(path.dirname(environmentDirectory), { recursive: true });
      await runProcess(python, ['-m', 'venv', environmentDirectory]);
    }
    python = managedPython;
    await runProcess(python, [
      '-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', '--no-input', 'PyMuPDF',
    ]);
    const status = await getPdfEngineStatus();
    if (!status.ready) throw new Error(status.error || 'PDF 도구 준비를 확인하지 못했습니다.');
    return status;
  }

  if (process.platform !== 'win32') {
    throw new Error('이 운영체제에서는 PDF 도구 자동 설치를 지원하지 않습니다.');
  }

  let python = await findPython();
  if (!python) {
    const winget = await resolveExecutable(buildExecutableCandidates([], 'winget', [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'winget'),
    ]));
    if (!winget) throw new Error('Windows 앱 설치 도구(winget)를 찾지 못했습니다.');
    await runProcess(winget, [
      'install',
      '--id', 'Python.Python.3.12',
      '--exact',
      '--scope', 'user',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--disable-interactivity',
    ]);
    python = await findPython();
  }
  if (!python) throw new Error('Python 설치 후 실행 파일을 찾지 못했습니다.');

  await runProcess(python, [
    '-m', 'pip', 'install', '--user', '--upgrade', '--disable-pip-version-check', '--no-input', 'PyMuPDF',
  ]);
  const status = await getPdfEngineStatus();
  if (!status.ready) throw new Error(status.error || 'PDF 도구 준비를 확인하지 못했습니다.');
  return status;
}
