import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export interface ResearchSourceSettings {
  unpaywallEmail?: string;
  openAlexKey?: string;
  kiprisKey?: string;
  epoClientId?: string;
  epoClientSecret?: string;
}

interface StoredResearchSourceSettings {
  version: 1;
  unpaywallEmail?: string;
  secrets?: Partial<Record<'openAlexKey' | 'kiprisKey' | 'epoClientId' | 'epoClientSecret', string>>;
}

const SECRET_KEYS = ['openAlexKey', 'kiprisKey', 'epoClientId', 'epoClientSecret'] as const;

function settingsFile(): string {
  const configDirectory = process.env.PAGEDOCK_CONFIG_DIR
    || path.join(process.env.APPDATA || os.homedir(), 'PageDock');
  return path.join(configDirectory, 'research-sources.json');
}

function runDpapi(mode: 'protect' | 'unprotect', value: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('자격증명 암호화는 Windows에서만 지원합니다.');
  }
  const operation = mode === 'protect'
    ? '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($inputValue), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputValue), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))';
  const script = [
    '$ErrorActionPreference="Stop"',
    'Add-Type -AssemblyName System.Security',
    '$inputValue=[Console]::In.ReadToEnd()',
    operation,
  ].join(';');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || 'Windows 자격증명 암호화에 실패했습니다.'));
    });
    child.stdin.end(value);
  });
}

async function readStored(): Promise<StoredResearchSourceSettings> {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as StoredResearchSourceSettings;
    return parsed?.version === 1 ? parsed : { version: 1 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 };
    throw error;
  }
}

async function writeStored(value: StoredResearchSourceSettings): Promise<void> {
  const filePath = settingsFile();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath).catch(async () => {
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  });
}

export async function getResearchSourceSettings(): Promise<ResearchSourceSettings> {
  const stored = await readStored();
  const result: ResearchSourceSettings = { unpaywallEmail: stored.unpaywallEmail };
  for (const key of SECRET_KEYS) {
    const encrypted = stored.secrets?.[key];
    if (!encrypted) continue;
    try {
      result[key] = await runDpapi('unprotect', encrypted);
    } catch {
      // A credential encrypted by another Windows account is intentionally ignored.
    }
  }
  return result;
}

export async function updateResearchSourceSettings(
  updates: Partial<Record<keyof ResearchSourceSettings, string | null>>,
): Promise<ResearchSourceSettings> {
  const stored = await readStored();
  if ('unpaywallEmail' in updates) {
    stored.unpaywallEmail = updates.unpaywallEmail?.trim() || undefined;
  }
  stored.secrets ||= {};
  for (const key of SECRET_KEYS) {
    if (!(key in updates)) continue;
    const value = updates[key]?.trim();
    if (!value) delete stored.secrets[key];
    else stored.secrets[key] = await runDpapi('protect', value);
  }
  await writeStored(stored);
  return getResearchSourceSettings();
}

export async function getResearchSourceStatus(): Promise<{
  unpaywallEmail?: string;
  openAlexConfigured: boolean;
  kiprisConfigured: boolean;
  epoConfigured: boolean;
}> {
  const settings = await getResearchSourceSettings();
  return {
    unpaywallEmail: settings.unpaywallEmail,
    openAlexConfigured: Boolean(settings.openAlexKey),
    kiprisConfigured: Boolean(settings.kiprisKey),
    epoConfigured: Boolean(settings.epoClientId && settings.epoClientSecret),
  };
}
