import { readFileSync } from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_FILE = path.join(os.homedir(), '.annot', 'config.json');

interface AnnotConfig {
  workspaceRoot?: string;
}

export function readConfiguredWorkspaceRoot(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as AnnotConfig;
    return typeof parsed.workspaceRoot === 'string' && path.isAbsolute(parsed.workspaceRoot)
      ? path.normalize(parsed.workspaceRoot)
      : null;
  } catch {
    return null;
  }
}

export async function writeConfiguredWorkspaceRoot(workspaceRoot: string): Promise<void> {
  const normalized = path.normalize(workspaceRoot.trim());
  if (!path.isAbsolute(normalized)) throw new Error('라이브러리 경로는 전체 경로로 입력해 주세요.');
  await fs.mkdir(normalized, { recursive: true });
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify({ workspaceRoot: normalized }, null, 2), 'utf8');
}
