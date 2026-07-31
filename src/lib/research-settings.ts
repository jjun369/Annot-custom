import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

import { getPageDockConfigDirectory } from '@/lib/platform-paths';

export interface ResearchSourceSettings {
  unpaywallEmail?: string;
  openAlexKey?: string;
  kiprisKey?: string;
  epoClientId?: string;
  epoClientSecret?: string;
}

type SecretKey = 'openAlexKey' | 'kiprisKey' | 'epoClientId' | 'epoClientSecret';

interface StoredResearchSourceSettings {
  version: 1;
  unpaywallEmail?: string;
  secrets?: Partial<Record<SecretKey, string>>;
}

const SECRET_KEYS: SecretKey[] = ['openAlexKey', 'kiprisKey', 'epoClientId', 'epoClientSecret'];
const KEYCHAIN_SERVICE = 'app.pagedock.desktop.research';
const KEYCHAIN_MARKER = 'keychain:';

function settingsFile(): string {
  return path.join(getPageDockConfigDirectory(), 'research-sources.json');
}

function runProcess(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
      else reject(new Error(stderr.trim() || `자격 증명 보호 작업에 실패했습니다. (${code})`));
    });
    child.stdin.end(input || '');
  });
}

function runDpapi(mode: 'protect' | 'unprotect', value: string): Promise<string> {
  const operation = mode === 'protect'
    ? '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($inputValue), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputValue), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))';
  const script = [
    '$ErrorActionPreference="Stop"',
    'Add-Type -AssemblyName System.Security',
    '$inputValue=[Console]::In.ReadToEnd()',
    operation,
  ].join(';');
  return runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], value);
}

async function writeKeychainSecret(key: SecretKey, value: string): Promise<void> {
  await runProcess('/usr/bin/security', [
    'add-generic-password',
    '-U',
    '-s', KEYCHAIN_SERVICE,
    '-a', key,
    '-w', value,
  ]);
}

async function readKeychainSecret(key: SecretKey): Promise<string> {
  return await runProcess('/usr/bin/security', [
    'find-generic-password',
    '-s', KEYCHAIN_SERVICE,
    '-a', key,
    '-w',
  ]);
}

async function deleteKeychainSecret(key: SecretKey): Promise<void> {
  await runProcess('/usr/bin/security', [
    'delete-generic-password',
    '-s', KEYCHAIN_SERVICE,
    '-a', key,
  ]).catch(() => undefined);
}

export function getResearchCredentialBackend(
  platform: NodeJS.Platform = process.platform,
): 'dpapi' | 'keychain' | 'unsupported' {
  if (platform === 'win32') return 'dpapi';
  if (platform === 'darwin') return 'keychain';
  return 'unsupported';
}

async function protectSecret(key: SecretKey, value: string): Promise<string> {
  const backend = getResearchCredentialBackend();
  if (backend === 'dpapi') return await runDpapi('protect', value);
  if (backend === 'keychain') {
    await writeKeychainSecret(key, value);
    return `${KEYCHAIN_MARKER}${key}`;
  }
  throw new Error('이 운영체제에서는 연구 서비스 자격 증명 저장을 지원하지 않습니다.');
}

async function unprotectSecret(key: SecretKey, storedValue: string): Promise<string | undefined> {
  const backend = getResearchCredentialBackend();
  if (backend === 'dpapi') return await runDpapi('unprotect', storedValue);
  if (backend === 'keychain' && storedValue === `${KEYCHAIN_MARKER}${key}`) {
    return await readKeychainSecret(key);
  }
  return undefined;
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
      const value = await unprotectSecret(key, encrypted);
      if (value) result[key] = value;
    } catch {
      // Credentials from another account or a locked keychain remain unavailable without blocking local use.
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
    if (!value) {
      if (getResearchCredentialBackend() === 'keychain') await deleteKeychainSecret(key);
      delete stored.secrets[key];
    } else {
      stored.secrets[key] = await protectSecret(key, value);
    }
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
