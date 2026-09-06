import { describe, expect, test } from 'vitest';

import { isCodexCliUnavailableError, runCodexStructured } from '@/lib/codex-exec';

describe('Codex transport selection', () => {
  test('recognizes protected desktop-app binaries as unavailable CLI transport', () => {
    expect(isCodexCliUnavailableError(Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }))).toBe(true);
    expect(isCodexCliUnavailableError(new Error(
      'Codex CLI를 실행할 권한이 없습니다. WindowsApps에 포함된 실행 파일 대신 standalone Codex CLI를 설치하세요.',
    ))).toBe(false);
  });

  test('does not hide a normal provider turn failure behind the account fallback', () => {
    expect(isCodexCliUnavailableError(new Error('Codex 작업이 실패했습니다. (1)'))).toBe(false);
    expect(isCodexCliUnavailableError(new Error('EPERM: operation not permitted, open state.db'))).toBe(false);
    expect(isCodexCliUnavailableError(new Error('작업 시간이 너무 오래 걸려 중단했습니다.'))).toBe(false);
    expect(isCodexCliUnavailableError(new Error('Codex 모델을 사용할 수 없습니다.'))).toBe(false);
  });
});

describe('structured Codex cancellation', () => {
  test('rejects an already-cancelled request before resolving or spawning Codex', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runCodexStructured({
      prompt: 'unused',
      schema: { type: 'object' },
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
