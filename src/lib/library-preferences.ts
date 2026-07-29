import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { AIProvider } from '@/types';

export interface PortablePreferences {
  aiProvider?: AIProvider;
  chatFontSize?: number;
  chatPanelWidth?: number;
  onboardingCompleted?: boolean;
  libraryImportExplained?: boolean;
  updatedAt?: string;
}

function preferencesFile(): string {
  return path.join(getWorkspaceRoot(), '.annot', 'settings.json');
}

export async function readPortablePreferences(): Promise<PortablePreferences> {
  try {
    return JSON.parse(await fs.readFile(preferencesFile(), 'utf8')) as PortablePreferences;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function updatePortablePreferences(updates: PortablePreferences): Promise<PortablePreferences> {
  const current = await readPortablePreferences();
  const next: PortablePreferences = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  if (next.aiProvider !== 'codex' && next.aiProvider !== 'claude') delete next.aiProvider;
  if (typeof next.chatFontSize === 'number') next.chatFontSize = Math.min(20, Math.max(11, Math.round(next.chatFontSize)));
  if (typeof next.chatPanelWidth === 'number') next.chatPanelWidth = Math.min(720, Math.max(320, Math.round(next.chatPanelWidth)));
  if (typeof next.onboardingCompleted !== 'boolean') delete next.onboardingCompleted;
  if (typeof next.libraryImportExplained !== 'boolean') delete next.libraryImportExplained;
  const filePath = preferencesFile();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporary, filePath);
  }
  return next;
}
