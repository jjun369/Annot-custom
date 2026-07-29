import { getClaudeAuthStatus, probeClaudeConnection, runClaudeTurn } from '@/lib/claude-code';
import { fetchCodexModels, getCodexAuthStatus } from '@/lib/codex-auth';
import { getCodexCliAuthStatus, listCodexModelsFromCli, runCodexTurn } from '@/lib/codex-exec';
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
    const result = await runCodexTurn({
      model: AUTO_MODEL_ID,
      folderPath: '',
      sessionKind: 'folder',
      prompt: 'Reply with exactly OK.',
      ephemeral: true,
    });

    return {
      provider: 'codex',
      ok: /^ok\b/i.test(result.content.trim()),
      model: AUTO_MODEL_ID,
      response: result.content.trim(),
      message: 'Codex responded successfully.',
    };
  },
  async runTurn(
    input: ProviderTurnInput,
    options?: { onEvent?: (event: ProviderTurnEvent) => void },
  ): Promise<ProviderTurnResult> {
    const result = await runCodexTurn(
      {
        codexSessionId: input.providerSessionId,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        folderPath: input.folderPath,
        sessionKind: input.sessionKind,
        prompt: input.prompt,
        currentPdfPath: input.currentPdfPath,
      },
      options,
    );

    return {
      providerSessionId: result.codexSessionId,
      content: result.content,
    };
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
