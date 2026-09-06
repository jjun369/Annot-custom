import { SessionKind, AIProvider, ChatSourceContext, ReasoningEffort } from '@/types';

export interface ProviderReasoningLevel {
  effort: ReasoningEffort;
  description?: string;
}

export interface ProviderModel {
  id: string;
  owned_by: string;
  created: number;
  display_name?: string;
  default_reasoning_level?: ReasoningEffort;
  supported_reasoning_levels?: ProviderReasoningLevel[];
}

export interface ProviderStatus {
  provider: AIProvider;
  authenticated: boolean;
  email?: string;
  planType?: string;
  authMethod?: string;
  expiresAt?: number;
  hasRefreshToken?: boolean;
}

export interface ProviderValidationResult {
  provider: AIProvider;
  ok: boolean;
  model?: string;
  response?: string;
  message: string;
}

export interface ProviderTurnEvent {
  type: 'status' | 'assistant_delta' | 'tool_use' | 'tool_result';
  message?: string;
  text?: string;
  name?: string;
  input?: string;
  output?: string;
  exitCode?: number | null;
}

export interface ProviderTurnInput {
  providerSessionId?: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  folderPath: string;
  sessionKind: SessionKind;
  prompt: string;
  currentPdfPath?: string | null;
  sourceContext?: ChatSourceContext;
  /**
   * Existing messages used when a provider cannot resume its native session
   * (for example, the desktop Codex app has account auth but no standalone
   * CLI). Kept bounded by the caller and optional so other providers retain
   * their existing session contract.
   */
  conversation?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface ProviderTurnResult {
  providerSessionId: string;
  content: string;
}

export interface ProviderRuntime {
  id: AIProvider;
  listModels: () => Promise<ProviderModel[]>;
  getStatus: () => Promise<ProviderStatus>;
  validateConnection: () => Promise<ProviderValidationResult>;
  runTurn: (
    input: ProviderTurnInput,
    options?: { onEvent?: (event: ProviderTurnEvent) => void }
  ) => Promise<ProviderTurnResult>;
}
