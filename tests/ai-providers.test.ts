import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchCodexModels: vi.fn(),
  getCodexAuthStatus: vi.fn(),
  sendCodexChat: vi.fn(),
  getCodexCliAuthStatus: vi.fn(),
  listCodexModelsFromCli: vi.fn(),
  runCodexTurn: vi.fn(),
  getClaudeAuthStatus: vi.fn(),
  probeClaudeConnection: vi.fn(),
  runClaudeTurn: vi.fn(),
}));

vi.mock('@/lib/codex-auth', () => ({
  fetchCodexModels: mocks.fetchCodexModels,
  getCodexAuthStatus: mocks.getCodexAuthStatus,
  sendCodexChat: mocks.sendCodexChat,
}));
vi.mock('@/lib/codex-exec', () => ({
  getCodexCliAuthStatus: mocks.getCodexCliAuthStatus,
  listCodexModelsFromCli: mocks.listCodexModelsFromCli,
  runCodexTurn: mocks.runCodexTurn,
  isCodexCliUnavailableError: (error: unknown) => error instanceof Error && error.message === 'cli unavailable',
}));
vi.mock('@/lib/claude-code', () => ({
  getClaudeAuthStatus: mocks.getClaudeAuthStatus,
  probeClaudeConnection: mocks.probeClaudeConnection,
  runClaudeTurn: mocks.runClaudeTurn,
}));

import { getProviderRuntime } from '@/lib/ai-providers';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCodexAuthStatus.mockResolvedValue({ authenticated: false });
  mocks.getCodexCliAuthStatus.mockRejectedValue(new Error('cli unavailable'));
  mocks.listCodexModelsFromCli.mockRejectedValue(new Error('catalog unsupported'));
  mocks.fetchCodexModels.mockResolvedValue(null);
});

describe('Codex connection validation', () => {
  it('uses CLI/account status and model catalogs without spending a turn', async () => {
    mocks.getCodexAuthStatus.mockResolvedValue({ authenticated: true });
    mocks.fetchCodexModels.mockResolvedValue([{ id: 'account-model' }]);

    const result = await getProviderRuntime('codex').validateConnection();

    expect(result.ok).toBe(true);
    expect(result.model).toBe('account-model');
    expect(mocks.runCodexTurn).not.toHaveBeenCalled();
    expect(mocks.sendCodexChat).not.toHaveBeenCalled();
  });

  it('reports CLI login while being honest when an old CLI lacks a model catalog', async () => {
    mocks.getCodexCliAuthStatus.mockResolvedValue({ authenticated: true });

    const result = await getProviderRuntime('codex').validateConnection();

    expect(result.ok).toBe(true);
    expect(result.response).toBe('로그인 확인');
    expect(result.message).toContain('모델 목록을 확인하지 못했습니다');
    expect(mocks.runCodexTurn).not.toHaveBeenCalled();
    expect(mocks.sendCodexChat).not.toHaveBeenCalled();
  });

  it('treats an empty legacy CLI catalog as unknown rather than a successful model check', async () => {
    mocks.getCodexCliAuthStatus.mockResolvedValue({ authenticated: true });
    mocks.listCodexModelsFromCli.mockResolvedValue([]);

    const result = await getProviderRuntime('codex').validateConnection();

    expect(result.ok).toBe(true);
    expect(result.response).toBe('로그인 확인');
    expect(result.message).toContain('모델 목록을 확인하지 못했습니다');
    expect(mocks.runCodexTurn).not.toHaveBeenCalled();
    expect(mocks.sendCodexChat).not.toHaveBeenCalled();
  });

  it('does not switch transport after a real turn failure or quota-like error', async () => {
    mocks.getCodexAuthStatus.mockResolvedValue({ authenticated: true });
    mocks.runCodexTurn.mockRejectedValue(new Error('Codex 사용 한도에 도달했습니다.'));

    await expect(getProviderRuntime('codex').runTurn({
      model: 'model-a',
      folderPath: '',
      sessionKind: 'folder',
      prompt: 'synthetic test prompt',
    })).rejects.toThrow('사용 한도');
    expect(mocks.sendCodexChat).not.toHaveBeenCalled();
  });
});
