import { getClaudeAuthStatus, probeClaudeConnection, runClaudeTurn } from '@/lib/claude-code';
import { buildProviderSourceContextBlock } from '@/lib/ai-providers/source-context';
import { fetchCodexModels, getCodexAuthStatus, sendCodexChat } from '@/lib/codex-auth';
import {
  getCodexCliAuthStatus,
  isCodexCliUnavailableError,
  listCodexModelsFromCli,
  runCodexTurn,
} from '@/lib/codex-exec';
import { AIProvider } from '@/types';
import { DEFAULT_AI_PROVIDER } from './config';
import { AUTO_MODEL_ID, withAutoModel } from './model-policy';

import {
  ProviderModel,
  ProviderRuntime,
  ProviderTurnInput,
  ProviderTurnResult,
  ProviderTurnEvent,
} from './types';

const codexRuntime: ProviderRuntime = {
  id: 'codex',
  async listModels(): Promise<ProviderModel[]> {
    try {
      const cliModels = await listCodexModelsFromCli();
      if (cliModels.length > 0) {
        return withAutoModel('codex', cliModels);
      }
    } catch {
      // Older Codex clients do not expose `codex debug models`.
    }

    try {
      const models = await fetchCodexModels();
      return withAutoModel('codex', models ?? []);
    } catch {
      // Automatic mode still works because Codex chooses its recommended model
      // when Annot omits the --model flag.
      return withAutoModel('codex', []);
    }
  },
  async getStatus() {
    const fileStatus = await getCodexAuthStatus();
    try {
      const cliStatus = await getCodexCliAuthStatus();
      if (cliStatus.authenticated) {
        return {
          provider: 'codex',
          ...fileStatus,
          ...cliStatus,
          authenticated: true,
        };
      }
    } catch {
      // Fall back to file-based status for older or unavailable CLI installs.
    }
    return {
      provider: 'codex',
      ...fileStatus,
    };
  },
  async validateConnection() {
    const accountStatus = await getCodexAuthStatus();
    let cliAuthenticated = false;
    let cliCatalogUnavailable = false;

    try {
      cliAuthenticated = (await getCodexCliAuthStatus()).authenticated;
    } catch {
      // The account status remains authoritative when the standalone CLI is
      // missing or an older installation cannot answer status queries.
    }

    if (!accountStatus.authenticated && !cliAuthenticated) {
      throw new Error('Codex 로그인이 확인되지 않았습니다. 설정에서 로그인 상태를 확인해 주세요.');
    }

    try {
      const cliModels = await listCodexModelsFromCli();
      if (cliModels.length > 0) {
        return {
          provider: 'codex' as const,
          ok: true,
          model: cliModels[0].id,
          response: '인증됨',
          message: 'Codex 로그인을 확인했고 모델 목록을 읽었습니다. 실제 turn은 실행하지 않았습니다.',
        };
      }
      cliCatalogUnavailable = true;
    } catch {
      cliCatalogUnavailable = true;
    }

    // Account validation must not spend a Codex turn. The models endpoint
    // verifies the token/account pairing and available model catalog without
    // consuming a chat quota.
    if (accountStatus.authenticated) {
      const models = await fetchCodexModels();
      if (!models || models.length === 0) {
        throw new Error('Codex 로그인은 확인했지만 사용할 수 있는 모델을 확인하지 못했습니다.');
      }

      return {
        provider: 'codex' as const,
        ok: true,
        model: models[0].id,
        response: '인증됨',
        message: 'OpenAI 계정과 Codex 모델 목록을 확인했습니다. 실제 turn은 실행하지 않았습니다.',
      };
    }

    if (cliAuthenticated && cliCatalogUnavailable) {
      return {
        provider: 'codex' as const,
        ok: true,
        model: AUTO_MODEL_ID,
        response: '로그인 확인',
        message: 'Codex 로그인은 확인했지만 이 CLI에서 모델 목록을 확인하지 못했습니다. 실제 사용 시 자동 모델 선택을 시도합니다.',
      };
    }

    throw new Error('Codex 로그인은 확인했지만 사용할 모델을 확인하지 못했습니다.');
  },
  async runTurn(
    input: ProviderTurnInput,
    options?: { onEvent?: (event: ProviderTurnEvent) => void },
  ): Promise<ProviderTurnResult> {
    try {
      const result = await runCodexTurn(
        {
          codexSessionId: input.providerSessionId,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          folderPath: input.folderPath,
          sessionKind: input.sessionKind,
          prompt: input.prompt,
          currentPdfPath: input.currentPdfPath,
          sourceContext: input.sourceContext,
        },
        options,
      );

      return {
        providerSessionId: result.codexSessionId,
        content: result.content,
      };
    } catch (error) {
      if (!isCodexCliUnavailableError(error)) throw error;

      const accountStatus = await getCodexAuthStatus();
      if (!accountStatus.authenticated) throw error;

      options?.onEvent?.({
        type: 'status',
        message: 'OpenAI 계정 연결로 Codex에 연결했습니다. 답변을 준비하고 있습니다.',
      });

      const conversation = (input.conversation || [])
        .filter((message) => message.content.trim())
        .slice(-24);
      const result = await sendCodexChat(
        [
          ...conversation,
          { role: 'user', content: input.prompt },
        ],
        input.model,
        input.sourceContext ? buildProviderSourceContextBlock(input.sourceContext).join('\n') : undefined,
      );

      return {
        // The account API has no native CLI session id. The persisted chat
        // messages remain the source of truth for the next fallback turn.
        providerSessionId: '',
        content: result.content,
      };
    }
  },
};

const claudeRuntime: ProviderRuntime = {
  id: 'claude',
  async listModels(): Promise<ProviderModel[]> {
    return withAutoModel('claude', [
      {
        id: 'sonnet',
        owned_by: 'anthropic',
        created: 0,
        display_name: 'Sonnet',
      },
      {
        id: 'opus',
        owned_by: 'anthropic',
        created: 0,
        display_name: 'Opus',
      },
    ]);
  },
  async getStatus() {
    return {
      provider: 'claude',
      ...(await getClaudeAuthStatus()),
    };
  },
  async validateConnection() {
    const result = await probeClaudeConnection();

    return {
      provider: 'claude',
      ok: /^ok\b/i.test(result.response.trim()),
      model: result.model,
      response: result.response,
      message: 'Claude Code responded successfully.',
    };
  },
  async runTurn(
    input: ProviderTurnInput,
    options?: { onEvent?: (event: ProviderTurnEvent) => void },
  ): Promise<ProviderTurnResult> {
    return await runClaudeTurn(input, options);
  },
};

const providerRegistry: Record<AIProvider, ProviderRuntime> = {
  codex: codexRuntime,
  claude: claudeRuntime,
};

export function getProviderRuntime(provider: AIProvider = DEFAULT_AI_PROVIDER): ProviderRuntime {
  const runtime = providerRegistry[provider];
  if (!runtime) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  return runtime;
}
