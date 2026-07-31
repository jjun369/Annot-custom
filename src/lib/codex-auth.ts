import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import {
  buildExecutableCandidates,
  finalizeResolvedCommand,
  resolveExecutable,
} from '@/lib/command-runtime';
import { normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const CODEX_AUTH_FILE = path.join(CODEX_HOME, 'auth.json');
const CODEX_VERSION_FILE = path.join(CODEX_HOME, 'version.json');
const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

const AUTH_CLAIM_PATH = 'https://api.openai.com/auth';
const PROFILE_CLAIM_PATH = 'https://api.openai.com/profile';

interface CodexAuthTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  account_id?: string;
}

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: CodexAuthTokens;
  last_refresh?: string;
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

export interface CodexAuthStatus {
  authenticated: boolean;
  hasRefreshToken?: boolean;
  isExpired?: boolean;
  expiresAt?: number;
  planType?: string;
  email?: string;
}

export interface CodexSession {
  accessToken: string;
  accountId: string;
  expiresAt?: number;
  planType?: string;
  email?: string;
}

interface CodexModelRecord {
  slug: string;
  display_name?: string;
  visibility?: string;
  priority?: number;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
}

interface CodexModelsResponse {
  models?: CodexModelRecord[];
}

interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface CodexChatResult {
  content: string;
  model: string;
}

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractAuthClaims(token?: string): Record<string, unknown> | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const authClaims = payload[AUTH_CLAIM_PATH];
  if (!authClaims || typeof authClaims !== 'object') return null;
  return authClaims as Record<string, unknown>;
}

function extractProfileClaims(token?: string): Record<string, unknown> | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const profileClaims = payload[PROFILE_CLAIM_PATH];
  if (!profileClaims || typeof profileClaims !== 'object') return null;
  return profileClaims as Record<string, unknown>;
}

function extractExpiry(token?: string): number | undefined {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === 'number' ? exp * 1000 : undefined;
}

function extractAccountId(tokens?: CodexAuthTokens): string | undefined {
  const explicit = tokens?.account_id?.trim();
  if (explicit) return explicit;

  const accessClaims = extractAuthClaims(tokens?.access_token);
  const accessAccountId = accessClaims?.chatgpt_account_id;
  if (typeof accessAccountId === 'string' && accessAccountId.trim()) return accessAccountId;

  const idClaims = extractAuthClaims(tokens?.id_token);
  const idAccountId = idClaims?.chatgpt_account_id;
  if (typeof idAccountId === 'string' && idAccountId.trim()) return idAccountId;

  return undefined;
}

function extractPlanType(tokens?: CodexAuthTokens): string | undefined {
  const accessClaims = extractAuthClaims(tokens?.access_token);
  const accessPlan = accessClaims?.chatgpt_plan_type;
  if (typeof accessPlan === 'string' && accessPlan.trim()) return accessPlan;

  const idClaims = extractAuthClaims(tokens?.id_token);
  const idPlan = idClaims?.chatgpt_plan_type;
  if (typeof idPlan === 'string' && idPlan.trim()) return idPlan;

  return undefined;
}

function extractEmail(tokens?: CodexAuthTokens): string | undefined {
  const profileClaims = extractProfileClaims(tokens?.access_token) ?? extractProfileClaims(tokens?.id_token);
  const email = profileClaims?.email;
  return typeof email === 'string' && email.trim() ? email : undefined;
}

async function readCodexAuthFile(): Promise<CodexAuthFile | null> {
  try {
    const raw = await fs.readFile(CODEX_AUTH_FILE, 'utf8');
    return JSON.parse(raw) as CodexAuthFile;
  } catch {
    return null;
  }
}

async function writeCodexAuthFile(authFile: CodexAuthFile): Promise<void> {
  await fs.mkdir(path.dirname(CODEX_AUTH_FILE), { recursive: true });
  await fs.writeFile(CODEX_AUTH_FILE, JSON.stringify(authFile, null, 2), { mode: 0o600 });
}

async function refreshCodexTokens(refreshToken: string): Promise<CodexAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CODEX_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Codex token refresh failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as RefreshResponse;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    id_token: data.id_token,
    account_id: extractAccountId({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      id_token: data.id_token,
    }),
  };
}

async function loadUsableTokens(): Promise<CodexAuthTokens | null> {
  const authFile = await readCodexAuthFile();
  const tokens = authFile?.tokens;
  if (!tokens?.access_token) return null;

  const expiresAt = extractExpiry(tokens.access_token);
  if (!expiresAt || Date.now() <= expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return {
      ...tokens,
      account_id: extractAccountId(tokens),
    };
  }

  if (!tokens.refresh_token) {
    return {
      ...tokens,
      account_id: extractAccountId(tokens),
    };
  }

  const refreshed = await refreshCodexTokens(tokens.refresh_token);
  const nextAuthFile: CodexAuthFile = {
    ...authFile,
    tokens: refreshed,
    last_refresh: new Date().toISOString(),
  };
  await writeCodexAuthFile(nextAuthFile);
  return refreshed;
}

function buildCodexHeaders(session: CodexSession): HeadersInit {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    'chatgpt-account-id': session.accountId,
    'Content-Type': 'application/json',
    originator: 'desktop',
  };
}

function extractAssistantTextFromResponse(responsePayload: Record<string, unknown>): string {
  const response = responsePayload.response;
  if (!response || typeof response !== 'object') return '';

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return '';

  const texts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if ((part as { type?: unknown }).type !== 'output_text') continue;

      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string' && text.length > 0) {
        texts.push(text);
      }
    }
  }

  return texts.join('\n\n').trim();
}

async function collectSseText(stream: ReadableStream<Uint8Array>): Promise<{ content: string; model?: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finalContent = '';
  let model: string | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const rawEvent of events) {
      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length === 0) continue;
      if (dataLines.join('\n') === '[DONE]') continue;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (payload.type === 'response.output_text.delta') {
        const delta = payload.delta;
        if (typeof delta === 'string') content += delta;
      }

      if (payload.type === 'response.completed') {
        finalContent = extractAssistantTextFromResponse(payload);
        const response = payload.response;
        if (response && typeof response === 'object') {
          const resolvedModel = (response as { model?: unknown }).model;
          if (typeof resolvedModel === 'string' && resolvedModel.length > 0) {
            model = resolvedModel;
          }
        }
      }
    }
  }

  const resolvedContent = (content || finalContent).trim();
  return { content: resolvedContent, model };
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  const authFile = await readCodexAuthFile();
  const tokens = authFile?.tokens;
  const accountId = extractAccountId(tokens);
  const expiresAt = extractExpiry(tokens?.access_token);
  const isExpired = expiresAt ? Date.now() > expiresAt : false;

  if (!tokens?.access_token || !accountId) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    hasRefreshToken: !!tokens.refresh_token,
    isExpired,
    expiresAt,
    planType: extractPlanType(tokens),
    email: extractEmail(tokens),
  };
}

export async function getCodexSession(): Promise<CodexSession | null> {
  const tokens = await loadUsableTokens();
  const accountId = extractAccountId(tokens || undefined);
  if (!tokens?.access_token || !accountId) return null;

  return {
    accessToken: tokens.access_token,
    accountId,
    expiresAt: extractExpiry(tokens.access_token),
    planType: extractPlanType(tokens),
    email: extractEmail(tokens),
  };
}

export async function getCodexClientVersion(): Promise<string | null> {
  const explicitVersion = process.env.CODEX_CLIENT_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  const installedVersion = await detectInstalledCodexVersion();
  if (installedVersion) return installedVersion;

  try {
    const raw = await fs.readFile(CODEX_VERSION_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { latest_version?: unknown };
    if (typeof parsed.latest_version === 'string' && parsed.latest_version.trim()) {
      return parsed.latest_version;
    }
  } catch {
    // ignore and use fallback
  }

  return null;
}

let detectedCodexVersionPromise: Promise<string | null> | null = null;

async function detectInstalledCodexVersion(): Promise<string | null> {
  detectedCodexVersionPromise ??= (async () => {
    const home = os.homedir();
    const candidates = buildExecutableCandidates(
      [process.env.CODEX_BIN, process.env.CODEX_PATH],
      'codex',
      [
        path.join(home, '.npm-global', 'bin', 'codex'),
        path.join(home, '.local', 'bin', 'codex'),
        path.join(home, '.volta', 'bin', 'codex'),
        path.join(home, 'Library', 'pnpm', 'codex'),
        path.join(home, '.codex', 'bin', 'codex'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'codex'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'codex'),
        path.join('/Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
        path.join('/Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
        path.join('/opt/homebrew/bin', 'codex'),
        path.join('/usr/local/bin', 'codex'),
      ],
    );
    const executable = await resolveExecutable(candidates);
    if (!executable) return null;
    const command = await finalizeResolvedCommand(executable);
    return new Promise<string | null>((resolve) => {
      const child = spawn(command.command, [...command.argsPrefix, '--version'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
      child.on('error', () => resolve(null));
      child.on('close', () => {
        const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/);
        resolve(match?.[1] || null);
      });
    });
  })();
  return detectedCodexVersionPromise;
}

export async function fetchCodexModels() {
  const session = await getCodexSession();
  if (!session) return null;

  const clientVersion = await getCodexClientVersion();
  const query = clientVersion
    ? `?client_version=${encodeURIComponent(clientVersion)}`
    : '';
  const response = await fetch(
    `${CHATGPT_CODEX_BASE_URL}/models${query}`,
    { headers: buildCodexHeaders(session), cache: 'no-store' },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to fetch Codex models (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as CodexModelsResponse;
  const models = (payload.models || [])
    .filter((model) => model.visibility !== 'hide')
    .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))
    .map((model) => ({
      id: model.slug,
      owned_by: 'codex',
      created: 0,
      display_name: model.display_name || model.slug,
      default_reasoning_level: normalizeReasoningEffort(model.default_reasoning_level) === 'auto'
        ? undefined
        : normalizeReasoningEffort(model.default_reasoning_level),
      supported_reasoning_levels: (model.supported_reasoning_levels || [])
        .map((level) => ({
          effort: normalizeReasoningEffort(level.effort),
          description: level.description,
        }))
        .filter((level) => level.effort !== 'auto'),
    }));

  return models;
}

export async function sendCodexChat(
  messages: ChatMessageInput[],
  model: string,
  pdfContext?: string,
): Promise<CodexChatResult> {
  const session = await getCodexSession();
  if (!session) {
    throw new Error('Not authenticated. Sign in to Codex on this machine first.');
  }

  const instructions = `You are a research assistant helping a user understand an academic paper.
${pdfContext ? `\nThe user is currently reading a paper. Here is the relevant context:\n${pdfContext}` : ''}
Provide clear, accurate, and well-structured responses. Use markdown formatting when helpful.
When referencing specific parts of the paper, be precise about locations.`;

  const input = messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: 'input_text',
        text: message.content,
      },
    ],
  }));

  const response = await fetch(`${CHATGPT_CODEX_BASE_URL}/responses`, {
    method: 'POST',
    headers: buildCodexHeaders(session),
    body: JSON.stringify({
      model,
      instructions,
      input,
      stream: true,
      store: false,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Codex response error (${response.status}): ${detail.slice(0, 500)}`);
  }

  if (!response.body) {
    throw new Error('Codex response stream was empty');
  }

  const { content, model: resolvedModel } = await collectSseText(response.body);
  if (!content) {
    throw new Error('Codex returned an empty response');
  }

  return {
    content,
    model: resolvedModel || model,
  };
}
