import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  getCodexCliAuthStatus,
  resetCodexExecutableCache,
  resolveCodexExecutableFresh,
} from '@/lib/codex-exec';

const OFFICIAL_INSTALLER_URL = 'https://raw.githubusercontent.com/openai/codex/main/scripts/install/install.ps1';
const CODEX_SETUP_URL = 'https://chatgpt.com/codex';
const PROCESS_TIMEOUT_MS = 15 * 60 * 1000;

export interface CodexSetupStatus {
  installed: boolean;
  authenticated: boolean;
  platform: NodeJS.Platform;
  canAutoInstall: boolean;
  setupUrl: string;
  version?: string;
  authMethod?: string;
  error?: string;
}

function runProcess(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env,
    });
    let stdout = '';
    let stderr = '';
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString()}`.slice(-12000);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('작업 시간이 너무 오래 걸려 중단했습니다. 인터넷 연결을 확인해 주세요.'));
    }, options.timeoutMs || PROCESS_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `Codex 작업이 실패했습니다. (${code})`));
    });
  });
}

async function readCodexVersion(): Promise<string | undefined> {
  const command = await resolveCodexExecutableFresh();
  const result = await runProcess(command.command, [...command.argsPrefix, '--version'], { timeoutMs: 30000 });
  return result.stdout.trim().match(/([0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.]+)?)$/)?.[1];
}

export async function getCodexSetupStatus(): Promise<CodexSetupStatus> {
  const platformDetails = {
    platform: process.platform,
    canAutoInstall: process.platform === 'win32',
    setupUrl: CODEX_SETUP_URL,
  };
  try {
    const version = await readCodexVersion();
    resetCodexExecutableCache();
    const auth = await getCodexCliAuthStatus().catch(() => ({
      authenticated: false,
      authMethod: undefined,
    }));
    return {
      ...platformDetails,
      installed: true,
      authenticated: auth.authenticated,
      authMethod: auth.authMethod,
      version,
    };
  } catch (error) {
    return {
      ...platformDetails,
      installed: false,
      authenticated: false,
      error: error instanceof Error ? error.message : 'Codex를 찾지 못했습니다.',
    };
  }
}

export async function installOrUpdateCodex(): Promise<CodexSetupStatus> {
  if (process.platform !== 'win32') {
    throw new Error('macOS에서는 공식 Codex 앱 또는 CLI를 설치한 뒤 PageDock에서 다시 확인해 주세요.');
  }

  const response = await fetch(OFFICIAL_INSTALLER_URL, {
    cache: 'no-store',
    headers: { 'User-Agent': 'PageDock-Codex-Setup' },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`Codex 공식 설치 프로그램을 받지 못했습니다. (${response.status})`);
  }
  const installer = await response.text();
  if (!installer.includes('releases.openai.com/codex') || !installer.includes('CODEX_NON_INTERACTIVE')) {
    throw new Error('받은 Codex 설치 프로그램을 확인하지 못했습니다.');
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pagedock-codex-'));
  const installerPath = path.join(temporaryDirectory, 'install-codex.ps1');
  const powerShell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  try {
    await fs.writeFile(installerPath, installer, 'utf8');
    await runProcess(powerShell, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      installerPath,
    ], {
      env: { ...process.env, CODEX_NON_INTERACTIVE: '1' },
    });
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }

  resetCodexExecutableCache();
  const status = await getCodexSetupStatus();
  if (!status.installed) throw new Error(status.error || 'Codex 설치 확인에 실패했습니다.');
  return status;
}

export async function loginCodex(): Promise<CodexSetupStatus> {
  const command = await resolveCodexExecutableFresh();
  await runProcess(command.command, [...command.argsPrefix, 'login']);
  resetCodexExecutableCache();
  const status = await getCodexSetupStatus();
  if (!status.authenticated) throw new Error('Codex 로그인이 완료되지 않았습니다.');
  return status;
}
