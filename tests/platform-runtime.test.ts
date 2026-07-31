import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  getCommonPythonCandidateBases,
  getManagedPythonExecutable,
  getPageDockConfigDirectory,
} from '@/lib/platform-paths';
import { getResearchCredentialBackend } from '@/lib/research-settings';

describe('cross-platform runtime policy', () => {
  test('selects protected credential backends per desktop platform', () => {
    expect(getResearchCredentialBackend('win32')).toBe('dpapi');
    expect(getResearchCredentialBackend('darwin')).toBe('keychain');
    expect(getResearchCredentialBackend('linux')).toBe('unsupported');
  });

  test('keeps the managed Python environment outside the library', () => {
    expect(getManagedPythonExecutable()).toContain('python-env');
    expect(getManagedPythonExecutable().startsWith(getPageDockConfigDirectory())).toBe(true);
    expect(getCommonPythonCandidateBases()).toContain(getManagedPythonExecutable());
  });

  test('keeps the native macOS Close Window role for Command+W', () => {
    const electronMain = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.cjs'), 'utf8');
    expect(electronMain).toMatch(/role:\s*['"]close['"]/);
  });

  test('keeps the primary navigation in library, research, knowledge order', () => {
    const header = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'layout', 'AppHeader.tsx'), 'utf8');
    expect(header.indexOf("id: 'library'")).toBeLessThan(header.indexOf("id: 'research'"));
    expect(header.indexOf("id: 'research'")).toBeLessThan(header.indexOf("id: 'knowledge'"));
  });

  test('exposes only the native directory picker through the Electron preload', () => {
    const electronMain = fs.readFileSync(path.join(process.cwd(), 'electron', 'main.cjs'), 'utf8');
    const preload = fs.readFileSync(path.join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
    expect(electronMain).toContain("preload: path.join(__dirname, 'preload.cjs')");
    expect(preload).toContain("ipcRenderer.invoke('pagedock:select-directory')");
    expect(preload).not.toMatch(/readFile|writeFile|shell|spawn/);
  });
});
