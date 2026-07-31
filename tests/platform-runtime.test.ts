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
});
