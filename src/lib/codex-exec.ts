import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import {
  buildExecutableCandidates,
  finalizeResolvedCommand,
  ResolvedCommand,
  resolveExecutable,
} from '@/lib/command-runtime';
import { isAutoModel } from '@/lib/ai-providers/model-policy';
import { isAutoReasoningEffort, normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import type { ReasoningEffort } from '@/types';

export interface ExecResult {
  codexSessionId: string;
  content: string;
}

export interface CodexTurnEvent {
  type: 'status' | 'assistant_delta' | 'tool_use' | 'tool_result';
  message?: string;
  text?: string;
  name?: string;
  input?: string;
  output?: string;
  exitCode?: number | null;
}

interface RunTurnOptions {
  onEvent?: (event: CodexTurnEvent) => void;
}

interface RunTurnInput {
  codexSessionId?: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  folderPath: string;
  sessionKind: 'folder' | 'pdf';
  prompt: string;
  currentPdfPath?: string | null;
  ephemeral?: boolean;
}

export interface CodexCatalogModel {
  id: string;
  owned_by: string;
  created: number;
  display_name?: string;
  default_reasoning_level?: ReasoningEffort;
  supported_reasoning_levels?: Array<{
    effort: ReasoningEffort;
    description?: string;
  }>;
}

export interface CodexCliAuthStatus {
  authenticated: boolean;
  authMethod?: string;
}

interface ParsedEvent {
  type?: string;
  event?: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    message?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
  message?: string;
}

let resolvedCodexExecutablePromise: Promise<ResolvedCommand> | null = null;

async function getResolvedCodexExecutable(): Promise<ResolvedCommand> {
  if (!resolvedCodexExecutablePromise) {
    resolvedCodexExecutablePromise = resolveCodexExecutable();
  }
  try {
    return await resolvedCodexExecutablePromise;
  } catch (error) {
    resolvedCodexExecutablePromise = null;
    throw error;
  }
}

export function resetCodexExecutableCache(): void {
  resolvedCodexExecutablePromise = null;
}

export async function resolveCodexExecutableFresh(): Promise<ResolvedCommand> {
  return await resolveCodexExecutable();
}

function buildPrompt({
  folderPath,
  sessionKind,
  prompt,
  currentPdfPath,
}: Omit<RunTurnInput, 'codexSessionId' | 'model'>): string {
  const workspaceRoot = getWorkspaceRoot();
  const contextLines = [
    'PageDock session context:',
    `- Workspace root: ${workspaceRoot}`,
    `- Current session folder: ${folderPath || '.'}`,
    `- Session type: ${sessionKind === 'pdf' ? 'PDF-focused reading session' : 'Folder-wide research session'}`,
    currentPdfPath ? `- Current PDF open in the viewer: ${currentPdfPath}` : '- No PDF is currently open in the viewer.',
    sessionKind === 'pdf'
      ? '- Treat the current PDF as the primary document for this conversation. Only branch out when it materially helps.'
      : '- Prefer the current folder first, but you may inspect other files in the workspace if needed.',
    '- When writing math, wrap standalone equations in \\[ ... \\] (or $$ ... $$). Do not emit bare equation lines.',
    '- Wrap inline math in \\( ... \\) or $ ... $. Do not leave LaTeX commands bare inside prose.',
    '- Keep inline variables or short expressions inline, for example `x`, `M_t`, or `alpha_t`.',
    '- Use tools and shell commands silently when needed.',
    '- In your final answer to the user, do not include progress updates, tool narration, or chain-of-thought.',
    '- The final answer should contain only the user-facing result.',
    '',
    'User request:',
    prompt,
  ];

  return contextLines.join('\n');
}

function getCodexExecutableCandidates(): string[] {
  const home = os.homedir();
  const envCandidates = [
    process.env.CODEX_BIN,
    process.env.CODEX_PATH,
  ];

  return buildExecutableCandidates(envCandidates, 'codex', [
    path.join(home, '.npm-global', 'bin', 'codex'),
    path.join(home, '.local', 'bin', 'codex'),
    path.join(home, '.bun', 'bin', 'codex'),
    path.join(home, '.codex', 'bin', 'codex'),
    path.join(home, 'AppData', 'Roaming', 'npm', 'codex'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'codex'),
    path.join('/Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
    path.join('/opt/homebrew/bin', 'codex'),
    path.join('/usr/local/bin', 'codex'),
  ]);
}

async function resolveCodexExecutable(): Promise<ResolvedCommand> {
  const candidates = getCodexExecutableCandidates();
  const executable = await resolveExecutable(candidates);

  if (executable) {
    return finalizeResolvedCommand(executable);
  }

  const searchedPaths = candidates.slice(0, 12).join(', ');
  throw new Error(
    `Could not find the Codex CLI executable. Searched: ${searchedPaths}. ` +
    'Set CODEX_BIN to the full path to your codex binary if needed.',
  );
}

function createCodexArgs(input: RunTurnInput): string[] {
  const baseArgs = ['exec'];

  if (input.codexSessionId) {
    baseArgs.push('resume', '--json', '--skip-git-repo-check', input.codexSessionId);
  } else {
    if (input.ephemeral) {
      baseArgs.push('--ephemeral');
    }
    baseArgs.push(
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--cd',
      getWorkspaceRoot(),
    );
  }

  if (!isAutoModel(input.model)) {
    baseArgs.push('--model', input.model);
  }
  if (!isAutoReasoningEffort(input.reasoningEffort)) {
    baseArgs.push('-c', `model_reasoning_effort="${input.reasoningEffort}"`);
  }

  baseArgs.push(buildPrompt(input));
  return baseArgs;
}

function describeCodexSpawnError(error: Error): Error {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || /access is denied/i.test(error.message)) {
    return new Error(
      'Codex CLI를 실행할 권한이 없습니다. WindowsApps에 포함된 실행 파일 대신 ' +
      'standalone Codex CLI를 설치하거나 CODEX_BIN에 실행 가능한 codex.exe 경로를 지정해 주세요.',
    );
  }
  return error;
}

function collectCatalogRecords(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => (
      typeof item === 'object' && item !== null
    ));
  }

  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['models', 'data', 'catalog']) {
    if (Array.isArray(record[key])) {
      return collectCatalogRecords(record[key]);
    }
  }
  return [];
}

function parseCatalogModels(stdout: string): CodexCatalogModel[] {
  const payload = JSON.parse(stdout) as unknown;
  const models: CodexCatalogModel[] = [];
  const seen = new Set<string>();
  for (const record of collectCatalogRecords(payload)) {
    if (record.visibility === 'hide') continue;
    const id = [record.slug, record.id, record.model]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName = [record.display_name, record.displayName, record.name]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const defaultReasoningLevel = normalizeReasoningEffort(record.default_reasoning_level);
    const supportedReasoningLevels: Array<{ effort: ReasoningEffort; description?: string }> = [];
    if (Array.isArray(record.supported_reasoning_levels)) {
      for (const value of record.supported_reasoning_levels) {
        if (!value || typeof value !== 'object') continue;
        const level = value as Record<string, unknown>;
        const effort = normalizeReasoningEffort(level.effort);
        if (effort === 'auto') continue;
        supportedReasoningLevels.push({
          effort,
          description: typeof level.description === 'string' ? level.description : undefined,
        });
      }
    }
    models.push({
      id,
      owned_by: 'codex',
      created: 0,
      display_name: displayName || id,
      default_reasoning_level: defaultReasoningLevel === 'auto' ? undefined : defaultReasoningLevel,
      supported_reasoning_levels: supportedReasoningLevels,
    });
  }
  return models;
}

export async function listCodexModelsFromCli(): Promise<CodexCatalogModel[]> {
  const codexExecutable = await getResolvedCodexExecutable();
  return await new Promise<CodexCatalogModel[]>((resolve, reject) => {
    const child = spawn(
      codexExecutable.command,
      [...codexExecutable.argsPrefix, 'debug', 'models'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(describeCodexSpawnError(error)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `codex debug models failed with exit code ${code}`));
        return;
      }
      try {
        resolve(parseCatalogModels(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function getCodexCliAuthStatus(): Promise<CodexCliAuthStatus> {
  const codexExecutable = await getResolvedCodexExecutable();
  return await new Promise<CodexCliAuthStatus>((resolve, reject) => {
    const child = spawn(
      codexExecutable.command,
      [...codexExecutable.argsPrefix, 'login', 'status'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => reject(describeCodexSpawnError(error)));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ authenticated: false });
        return;
      }
      const normalized = output.trim().toLowerCase();
      const authMethod = normalized.includes('api key')
        ? 'API key'
        : normalized.includes('chatgpt')
          ? 'ChatGPT'
          : 'Codex CLI';
      resolve({ authenticated: true, authMethod });
    });
  });
}

function truncateForEvent(value: string, maxLength = 600): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function shouldIgnoreStatusMessage(message: string): boolean {
  return (
    message.includes('Under-development features enabled:') ||
    message.includes('failed to open state db') ||
    message.includes('failed to initialize state runtime') ||
    message.includes('Failed to delete shell snapshot')
  );
}

function collectAssistantText(event: ParsedEvent): string[] {
  if (event.item?.type !== 'agent_message') return [];

  const parts: string[] = [];
  if (typeof event.item.text === 'string' && event.item.text.length > 0) {
    parts.push(event.item.text);
  }

  for (const part of event.item.content ?? []) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
      parts.push(part.text);
    }
  }

  return parts;
}

function emitParsedEvent(
  event: ParsedEvent,
  emit: ((event: CodexTurnEvent) => void) | undefined,
  completedAgentMessageIds: Set<string>,
): void {
  if (!emit) return;

  const eventType = event.type || event.event;
  if (!eventType) return;

  if (eventType === 'thread.started') {
    emit({ type: 'status', message: 'Connected to Codex session.' });
    return;
  }

  if (eventType === 'turn.started') {
    emit({ type: 'status', message: 'Thinking...' });
    return;
  }

  if (eventType === 'error' && event.message && !shouldIgnoreStatusMessage(event.message)) {
    emit({ type: 'status', message: event.message });
    return;
  }

  if (event.item?.type === 'error' && event.item.message && !shouldIgnoreStatusMessage(event.item.message)) {
    emit({ type: 'status', message: event.item.message });
    return;
  }

  if (event.item?.type === 'command_execution') {
    if (eventType === 'item.started' && event.item.command) {
      emit({
        type: 'tool_use',
        name: 'shell',
        input: event.item.command,
      });
      return;
    }

    if (eventType === 'item.completed') {
      emit({
        type: 'tool_result',
        name: 'shell',
        input: event.item.command,
        output: event.item.aggregated_output ? truncateForEvent(event.item.aggregated_output) : undefined,
        exitCode: event.item.exit_code ?? null,
      });
      return;
    }
  }

  const itemId = event.item?.id;
  if (eventType === 'item.delta') {
    const assistantTexts = collectAssistantText(event);
    for (const text of assistantTexts) {
      emit({ type: 'assistant_delta', text });
    }
    if (itemId) {
      completedAgentMessageIds.add(itemId);
    }
    return;
  }

  if (eventType === 'item.completed' && event.item?.type === 'agent_message') {
    if (itemId && completedAgentMessageIds.has(itemId)) {
      return;
    }

    const assistantTexts = collectAssistantText(event);
    for (const text of assistantTexts) {
      emit({ type: 'assistant_delta', text });
    }
  }
}

export async function runCodexTurn(input: RunTurnInput, options: RunTurnOptions = {}): Promise<ExecResult> {
  const codexExecutable = await getResolvedCodexExecutable();
  const args = createCodexArgs(input);

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(codexExecutable.command, [...codexExecutable.argsPrefix, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    const completedAgentMessageIds = new Set<string>();

    const handleStdoutLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed) as ParsedEvent;
        emitParsedEvent(event, options.onEvent, completedAgentMessageIds);
      } catch {
        // Ignore non-JSON lines in stdout.
      }
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;

      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        handleStdoutLine(line);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(describeCodexSpawnError(error));
    });

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        handleStdoutLine(stdoutBuffer);
      }

      const events = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as ParsedEvent];
          } catch {
            return [];
          }
        });

      const threadStarted = events.find((event) => event.type === 'thread.started');
      const codexSessionId = threadStarted?.thread_id || input.codexSessionId;

      const agentMessages = events
        .filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message')
        .map((event) => event.item?.text || '')
        .filter((text) => text.length > 0);

      const errorMessages = events
        .filter((event) => event.type === 'item.completed' && event.item?.type === 'error')
        .map((event) => event.item?.message || '')
        .filter((text) => text.length > 0);

      const content = agentMessages.join('\n\n').trim();

      if (code !== 0) {
        const detail = [content, ...errorMessages, stderr.trim()].filter(Boolean).join('\n');
        reject(new Error(detail || `codex exec failed with exit code ${code}`));
        return;
      }

      if (!codexSessionId) {
        reject(new Error('Codex did not return a session id'));
        return;
      }

      if (!content) {
        const detail = errorMessages.join('\n') || stderr.trim() || 'Codex returned no assistant message';
        reject(new Error(detail));
        return;
      }

      resolve({
        codexSessionId,
        content,
      });
    });
  });
}
