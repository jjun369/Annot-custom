import { existsSync, readFileSync, readdirSync } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { DEFAULT_LIBRARY_FOLDER_NAME } from '@/lib/app-info';
import { getPageDockConfigDirectory } from '@/lib/platform-paths';

const LEGACY_CONFIG_FILE = path.join(os.homedir(), '.annot', 'config.json');
const CONFIG_FILE = path.join(getPageDockConfigDirectory(), 'config.json');

interface PageDockConfig {
  workspaceRoot?: string;
}

function readConfigFile(filePath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PageDockConfig;
    return typeof parsed.workspaceRoot === 'string' && path.isAbsolute(parsed.workspaceRoot)
      ? path.normalize(parsed.workspaceRoot)
      : null;
  } catch {
    return null;
  }
}

export function readConfiguredWorkspaceRoot(): string | null {
  return readConfigFile(CONFIG_FILE) || readConfigFile(LEGACY_CONFIG_FILE);
}

export function getDefaultWorkspaceRoot(): string {
  const legacyRoot = path.join(os.homedir(), 'Annot');
  try {
    if (existsSync(legacyRoot) && readdirSync(legacyRoot).length > 0) return legacyRoot;
  } catch {
    // A damaged legacy directory should not block a fresh PageDock library.
  }

  const documentsDirectory = process.env.PAGEDOCK_DOCUMENTS_DIR
    || path.join(os.homedir(), 'Documents');
  return path.join(documentsDirectory, DEFAULT_LIBRARY_FOLDER_NAME);
}

export async function writeConfiguredWorkspaceRoot(workspaceRoot: string): Promise<void> {
  const normalized = path.normalize(workspaceRoot.trim());
  if (!path.isAbsolute(normalized)) throw new Error('라이브러리 경로는 전체 경로로 입력해 주세요.');
  await fs.mkdir(normalized, { recursive: true });
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify({ workspaceRoot: normalized }, null, 2), 'utf8');
}
