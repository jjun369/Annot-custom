import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';

import { DEFAULT_AI_PROVIDER } from '@/lib/ai-providers/config';
import { isLegacyImplicitModel, normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import { AIProvider, ChatMessage, ReasoningEffort, Session, SessionKind, SessionTurnSummary } from '@/types';
import { getDefaultWorkspaceRoot, readConfiguredWorkspaceRoot } from '@/lib/library-config';

const SESSION_LOCK_RETRY_MS = 25;
const SESSION_LOCK_STALE_MS = 2 * 60 * 1000;
const SESSION_LOCK_MAX_WAIT_MS = 2 * 1000;
const sessionMutationQueues = new Map<string, Promise<void>>();

const WORKSPACE_ROOT = process.env.PAGEDOCK_ROOT
  || process.env.ANNOT_ROOT
  || readConfiguredWorkspaceRoot()
  || getDefaultWorkspaceRoot();

export type StoredSession = Session;

interface StoredSessionRecord extends Omit<StoredSession, 'provider'> {
  provider?: AIProvider;
  providerSessionId?: string;
  codexSessionId?: string;
}

interface SessionListOptions {
  sessionKind?: SessionKind;
  pdfPath?: string | null;
  provider?: AIProvider;
}

interface CreateSessionOptions {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessionKind?: SessionKind;
  pdfPath?: string | null;
  documentId?: string;
  provider?: AIProvider;
}

interface SessionPathRewrite {
  from: string;
  to: string;
}

interface ReconciledSessionResult {
  changed: boolean;
  session: StoredSession | null;
}

interface SessionsMutationResult<T> {
  sessions: StoredSession[];
  result: T;
  changed?: boolean;
}

function sanitizeRelativePath(folderPath: string): string {
  const normalized = path.normalize(folderPath || '.');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid folder path: ${folderPath}`);
  }
  return normalized === '.' ? '' : normalized;
}

function normalizePdfPath(pdfPath: string): string {
  return sanitizeRelativePath(pdfPath);
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(resolveFolderPath(relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readSessionsFile(folderPath: string): Promise<StoredSession[]> {
  const sessionsFile = await ensureSessionsFile(folderPath);
  const raw = await fs.readFile(sessionsFile, 'utf8');
  const records = JSON.parse(raw) as StoredSessionRecord[];
  return records.map((session) => normalizeSession(folderPath, session));
}

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

export function resolveFolderPath(folderPath: string): string {
  const relativePath = sanitizeRelativePath(folderPath);
  return path.join(WORKSPACE_ROOT, relativePath);
}

function getAnnotDir(folderPath: string): string {
  return path.join(resolveFolderPath(folderPath), '.annot');
}

function getSessionsFile(folderPath: string): string {
  return path.join(getAnnotDir(folderPath), 'sessions.json');
}

async function ensureSessionsFile(folderPath: string): Promise<string> {
  await ensureDir(getAnnotDir(folderPath));
  const sessionsFile = getSessionsFile(folderPath);

  try {
    await fs.access(sessionsFile);
  } catch {
    try {
      await fs.writeFile(sessionsFile, '[]', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  return sessionsFile;
}

export async function ensureFolderExists(folderPath: string): Promise<void> {
  await ensureDir(resolveFolderPath(folderPath));
  await ensureSessionsFile(folderPath);
}

async function collectPdfPaths(folderPath: string): Promise<string[]> {
  const basePath = resolveFolderPath(folderPath);
  const entries = await fs.readdir(basePath, { withFileTypes: true });
  const pdfPaths: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const relativePath = folderPath ? `${folderPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      pdfPaths.push(...await collectPdfPaths(relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
      pdfPaths.push(relativePath);
    }
  }

  return pdfPaths;
}

async function inferPdfPathFromSession(folderPath: string, session: StoredSession): Promise<string | null> {
  const titleStem = session.title.replace(/\s+session$/i, '').trim().toLowerCase();
  const pdfNameStem = session.pdfPath
    ? path.basename(session.pdfPath).replace(/\.pdf$/i, '').trim().toLowerCase()
    : '';

  const pdfPaths = await collectPdfPaths(folderPath);
  const matches = pdfPaths.filter((candidatePath) => {
    const candidateStem = path.basename(candidatePath).replace(/\.pdf$/i, '').trim().toLowerCase();
    return candidateStem === titleStem || (pdfNameStem.length > 0 && candidateStem === pdfNameStem);
  });

  return matches.length === 1 ? matches[0] : null;
}

function normalizeSession(folderPath: string, session: StoredSessionRecord): StoredSession {
  const normalizedFolderPath = sanitizeRelativePath(folderPath);
  const sessionKind = session.sessionKind === 'pdf' || typeof session.pdfPath === 'string' ? 'pdf' : 'folder';
  const normalizedPdfPath = typeof session.pdfPath === 'string' && session.pdfPath.length > 0
    ? normalizePdfPath(session.pdfPath)
    : undefined;
  const provider = session.provider ?? DEFAULT_AI_PROVIDER;
  const providerSessionId = isLegacyImplicitModel(session.model)
    ? undefined
    : session.providerSessionId ?? session.codexSessionId;

  return {
    id: session.id,
    folderPath: normalizedFolderPath,
    sessionKind,
    pdfPath: normalizedPdfPath,
    documentId: typeof session.documentId === 'string' && session.documentId.length > 0
      ? session.documentId
      : undefined,
    provider,
    providerSessionId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: Array.isArray(session.messages) ? session.messages : [],
    turnSummaries: Array.isArray(session.turnSummaries)
      ? session.turnSummaries.filter((summary): summary is SessionTurnSummary => (
        typeof summary === 'object' &&
        summary !== null &&
        typeof summary.id === 'string' &&
        typeof summary.questionMessageId === 'string' &&
        typeof summary.assistantMessageId === 'string' &&
        typeof summary.question === 'string' &&
        typeof summary.answerSummary === 'string' &&
        typeof summary.createdAt === 'string'
      ))
      : [],
    model: normalizeModelPreference(session.model),
    reasoningEffort: normalizeReasoningEffort(session.reasoningEffort),
  };
}

async function reconcileSession(folderPath: string, session: StoredSession): Promise<ReconciledSessionResult> {
  const normalizedSession = normalizeSession(folderPath, session);
  let nextSession = normalizedSession;
  let changed = (
    normalizedSession.folderPath !== session.folderPath ||
    normalizedSession.sessionKind !== session.sessionKind ||
    normalizedSession.pdfPath !== session.pdfPath ||
    normalizedSession.model !== session.model ||
    normalizedSession.reasoningEffort !== session.reasoningEffort ||
    normalizedSession.providerSessionId !== session.providerSessionId
  );

  if (nextSession.sessionKind === 'folder' && !nextSession.pdfPath) {
    const inferredPdfPath = await inferPdfPathFromSession(folderPath, nextSession);
    if (inferredPdfPath) {
      nextSession = {
        ...nextSession,
        sessionKind: 'pdf',
        pdfPath: inferredPdfPath,
      };
      changed = true;
    }
  }

  if (nextSession.sessionKind !== 'pdf') {
    return { session: nextSession, changed };
  }

  if (!nextSession.pdfPath) {
    return { session: null, changed: true };
  }

  if (await pathExists(nextSession.pdfPath)) {
    return { session: nextSession, changed };
  }

  const inferredPdfPath = await inferPdfPathFromSession(folderPath, nextSession);
  if (!inferredPdfPath) {
    return { session: null, changed: true };
  }

  return {
    session: {
      ...nextSession,
      pdfPath: inferredPdfPath,
    },
    changed: true,
  };
}

function matchesSession(session: StoredSession, options: SessionListOptions): boolean {
  if (options.provider && session.provider !== options.provider) {
    return false;
  }

  if (options.sessionKind && session.sessionKind !== options.sessionKind) {
    return false;
  }

  if (options.sessionKind === 'pdf') {
    if (!options.pdfPath) {
      return false;
    }
    return session.pdfPath === normalizePdfPath(options.pdfPath);
  }

  if (typeof options.pdfPath === 'string' && options.pdfPath.length > 0) {
    return session.pdfPath === normalizePdfPath(options.pdfPath);
  }

  return true;
}

export async function listSessions(folderPath: string, options: SessionListOptions = {}): Promise<StoredSession[]> {
  return withSessionsFileMutation(folderPath, async (currentSessions) => {
    const reconciled = await reconcileSessionsWithStatus(folderPath, currentSessions);
    return {
      sessions: reconciled.sessions,
      changed: reconciled.changed,
      result: reconciled.sessions
        .filter((session) => matchesSession(session, options))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    };
  });
}

async function writeSessions(folderPath: string, sessions: StoredSession[]): Promise<void> {
  const sessionsFile = await ensureSessionsFile(folderPath);
  const cleanedSessions = sessions.map((session) => ({
    id: session.id,
    folderPath: session.folderPath,
    sessionKind: session.sessionKind,
    pdfPath: session.pdfPath,
    documentId: session.documentId,
    provider: session.provider,
    providerSessionId: session.providerSessionId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages,
    turnSummaries: session.turnSummaries ?? [],
    model: session.model,
    reasoningEffort: session.reasoningEffort,
  }));
  const temporaryPath = `${sessionsFile}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(cleanedSessions, null, 2), 'utf8');
  try {
    await fs.rename(temporaryPath, sessionsFile);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
    await fs.rm(sessionsFile, { force: true });
    await fs.rename(temporaryPath, sessionsFile);
  }
}

interface SessionFileLockRecord {
  ownerToken: string;
  pid: number;
  acquiredAt: string;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function tryReclaimStaleLock(lockPath: string): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }

  if (Date.now() - stat.mtimeMs <= SESSION_LOCK_STALE_MS) return false;

  let record: Partial<SessionFileLockRecord>;
  try {
    record = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Partial<SessionFileLockRecord>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    // A partially written lock is only reclaimable after it is old. A live
    // process cannot be identified from it, so the bounded wait below is the
    // safer outcome than stealing a potentially live lock.
    return false;
  }

  if (typeof record.ownerToken === 'string' && isProcessAlive(Number(record.pid))) {
    return false;
  }

  const reclaimPath = `${lockPath}.reclaim-${randomUUID()}`;
  try {
    await fs.rename(lockPath, reclaimPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    if ((error as NodeJS.ErrnoException).code === 'EACCES' || (error as NodeJS.ErrnoException).code === 'EPERM') throw error;
    return false;
  }
  await fs.rm(reclaimPath, { force: true });
  return true;
}

async function acquireSessionsFileLock(sessionsFile: string): Promise<() => Promise<void>> {
  const lockPath = `${sessionsFile}.lock`;
  const ownerToken = randomUUID();
  const startedAt = Date.now();
  let delay = SESSION_LOCK_RETRY_MS;

  while (true) {
    if (Date.now() - startedAt > SESSION_LOCK_MAX_WAIT_MS) {
      throw new Error(`Timed out waiting for session lock: ${sessionsFile}`);
    }
    try {
      const handle = await fs.open(lockPath, 'wx');
      const record: SessionFileLockRecord = {
        ownerToken,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      };
      try {
        await handle.writeFile(JSON.stringify(record));
      } catch (error) {
        await handle.close().catch(() => undefined);
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        let currentRecord: Partial<SessionFileLockRecord>;
        try {
          currentRecord = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Partial<SessionFileLockRecord>;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        if (currentRecord.ownerToken !== ownerToken) return;
        await fs.rm(lockPath, { force: false });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      if (await tryReclaimStaleLock(lockPath)) {
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(250, delay + SESSION_LOCK_RETRY_MS);
    }
  }
}

async function withSessionsFileLocks<T>(
  folderPaths: string[],
  mutation: (sessionsByFolder: Map<string, StoredSession[]>) => Promise<T> | T,
): Promise<T> {
  const normalizedFolders = [...new Set(folderPaths.map((folderPath) => sanitizeRelativePath(folderPath)))];
  const entries = await Promise.all(normalizedFolders.map(async (folderPath) => ({
    folderPath,
    sessionsFile: await ensureSessionsFile(folderPath),
  })));
  entries.sort((a, b) => path.resolve(a.sessionsFile).localeCompare(path.resolve(b.sessionsFile)));

  const queueReleases: Array<() => void> = [];
  const queuedKeys: string[] = [];
  const queuedPromises: Array<Promise<void>> = [];
  const fileReleases: Array<() => Promise<void>> = [];
  try {
    for (const entry of entries) {
      const queueKey = path.resolve(entry.sessionsFile);
      const previous = sessionMutationQueues.get(queueKey) ?? Promise.resolve();
      let releaseQueue!: () => void;
      const current = new Promise<void>((resolve) => { releaseQueue = resolve; });
      const queued = previous.then(() => current);
      sessionMutationQueues.set(queueKey, queued);
      queuedKeys.push(queueKey);
      queuedPromises.push(queued);
      queueReleases.push(releaseQueue);
      await previous;
      fileReleases.push(await acquireSessionsFileLock(entry.sessionsFile));
    }

    const sessionsByFolder = new Map<string, StoredSession[]>();
    for (const entry of entries) {
      sessionsByFolder.set(entry.folderPath, await readSessionsFile(entry.folderPath));
    }
    return await mutation(sessionsByFolder);
  } finally {
    await Promise.allSettled(fileReleases.slice().reverse().map((releaseFile) => releaseFile()));
    for (let index = queueReleases.length - 1; index >= 0; index -= 1) {
      try {
        queueReleases[index]();
      } finally {
        const queueKey = queuedKeys[index];
        if (sessionMutationQueues.get(queueKey) === queuedPromises[index]) {
          sessionMutationQueues.delete(queueKey);
        }
      }
    }
  }
}

async function withSessionsFileMutation<T>(
  folderPath: string,
  mutation: (sessions: StoredSession[]) => Promise<SessionsMutationResult<T>> | SessionsMutationResult<T>,
): Promise<T> {
  return withSessionsFileLocks([folderPath], async (sessionsByFolder) => {
    const normalizedFolderPath = sanitizeRelativePath(folderPath);
    const currentSessions = sessionsByFolder.get(normalizedFolderPath) ?? [];
    const { sessions, result, changed } = await mutation(currentSessions);
    if (changed ?? JSON.stringify(currentSessions) !== JSON.stringify(sessions)) {
      await writeSessions(normalizedFolderPath, sessions);
    }
    return result;
  });
}

async function reconcileSessionsWithStatus(folderPath: string, sessions: StoredSession[]): Promise<{ sessions: StoredSession[]; changed: boolean }> {
  const reconciledResults = await Promise.all(sessions.map((session) => reconcileSession(folderPath, session)));
  return {
    sessions: reconciledResults.flatMap((result) => result.session ? [result.session] : []),
    changed: reconciledResults.some((result) => result.changed),
  };
}

async function reconcileSessions(folderPath: string, sessions: StoredSession[]): Promise<StoredSession[]> {
  return (await reconcileSessionsWithStatus(folderPath, sessions)).sessions;
}

function rewriteRelativePathPrefix(targetPath: string | undefined, rewrite: SessionPathRewrite): string | undefined {
  if (!targetPath) return targetPath;
  if (targetPath === rewrite.from) return rewrite.to;
  if (!targetPath.startsWith(`${rewrite.from}/`)) return targetPath;
  return `${rewrite.to}${targetPath.slice(rewrite.from.length)}`;
}

function rewriteSessionPaths(session: StoredSession, rewrite: SessionPathRewrite): StoredSession {
  return {
    ...session,
    folderPath: rewriteRelativePathPrefix(session.folderPath, rewrite) ?? session.folderPath,
    pdfPath: rewriteRelativePathPrefix(session.pdfPath, rewrite),
  };
}

async function collectAnnotSessionFolders(rootFolderPath: string): Promise<string[]> {
  const absoluteRoot = resolveFolderPath(rootFolderPath);
  const folders: string[] = [];

  async function walk(currentRelativePath: string): Promise<void> {
    const absoluteCurrentPath = currentRelativePath ? resolveFolderPath(currentRelativePath) : absoluteRoot;
    const annotDir = path.join(absoluteCurrentPath, '.annot');

    try {
      const stat = await fs.stat(path.join(annotDir, 'sessions.json'));
      if (stat.isFile()) {
        folders.push(currentRelativePath);
      }
    } catch {
      // Ignore missing .annot directories.
    }

    const entries = await fs.readdir(absoluteCurrentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const childRelativePath = currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name;
      await walk(childRelativePath);
    }
  }

  await walk(rootFolderPath);
  return folders;
}

export async function getSession(folderPath: string, sessionId: string): Promise<StoredSession | null> {
  const sessions = await listSessions(folderPath);
  return sessions.find((session) => session.id === sessionId) || null;
}

export async function createSession(
  folderPath: string,
  title: string,
  options: CreateSessionOptions = {},
): Promise<StoredSession> {
  await ensureFolderExists(folderPath);

  const sessionKind = options.sessionKind === 'pdf' ? 'pdf' : 'folder';
  const provider = options.provider ?? DEFAULT_AI_PROVIDER;
  const pdfPath = sessionKind === 'pdf' && options.pdfPath
    ? normalizePdfPath(options.pdfPath)
    : undefined;

  const now = new Date().toISOString();
  const session: StoredSession = {
    id: randomUUID(),
    folderPath: sanitizeRelativePath(folderPath),
    sessionKind,
    pdfPath,
    documentId: options.documentId,
    provider,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    turnSummaries: [],
    model: normalizeModelPreference(options.model),
    reasoningEffort: normalizeReasoningEffort(options.reasoningEffort),
  };

  return withSessionsFileMutation(folderPath, async (sessions) => ({
    sessions: [...sessions, session],
    result: session,
  }));
}

export async function mutateSession(
  folderPath: string,
  sessionId: string,
  mutation: (session: StoredSession) => StoredSession | Promise<StoredSession>,
): Promise<StoredSession> {
  return withSessionsFileMutation(folderPath, async (currentSessions) => {
    const sessions = await reconcileSessions(folderPath, currentSessions);
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const mutatedSession = await mutation(sessions[index]);
    if (mutatedSession === sessions[index]) {
      return { sessions, result: mutatedSession };
    }
    const nextSession = {
      ...mutatedSession,
      updatedAt: new Date().toISOString(),
    };
    sessions[index] = nextSession;
    return { sessions, result: nextSession };
  });
}

export async function updateSession(
  folderPath: string,
  sessionId: string,
  updates: Partial<Pick<StoredSession, 'messages' | 'title' | 'provider' | 'providerSessionId' | 'model' | 'reasoningEffort' | 'turnSummaries'>>
): Promise<StoredSession> {
  return mutateSession(folderPath, sessionId, (session) => ({
    ...session,
    ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)),
    model: updates.model === undefined
      ? session.model
      : normalizeModelPreference(updates.model),
    reasoningEffort: updates.reasoningEffort === undefined
      ? session.reasoningEffort
      : normalizeReasoningEffort(updates.reasoningEffort),
  }));
}

export async function restoreSessions(folderPath: string, restoredSessions: StoredSession[]): Promise<void> {
  if (restoredSessions.length === 0) return;
  await withSessionsFileMutation(folderPath, async (current) => {
    const ids = new Set(current.map((session) => session.id));
    const next = [...current];
    for (const session of restoredSessions) {
      const candidate = normalizeSession(folderPath, session);
      if (ids.has(candidate.id)) {
        candidate.id = randomUUID();
      }
      ids.add(candidate.id);
      next.push(candidate);
    }
    return { sessions: next, result: undefined };
  });
}

export function buildDefaultSessionTitle(folderPath: string): string {
  const folderName = folderPath.split('/').filter(Boolean).at(-1) || 'Workspace';
  return `${folderName} 연구 대화`;
}

export function buildSessionTitle(
  folderPath: string,
  sessionKind: SessionKind,
  pdfPath?: string | null,
): string {
  if (sessionKind === 'pdf' && pdfPath) {
    return `${path.basename(pdfPath).replace(/\.pdf$/i, '')} 대화`;
  }

  const folderName = folderPath.split('/').filter(Boolean).at(-1) || 'Workspace';
  return `${folderName} 연구 대화`;
}

export function appendMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return [...messages, message];
}

export async function removePdfSessions(folderPath: string, pdfPath: string): Promise<void> {
  const normalizedFolderPath = sanitizeRelativePath(folderPath);
  const normalizedPdfPath = normalizePdfPath(pdfPath);
  await withSessionsFileMutation(normalizedFolderPath, async (sessions) => ({
    sessions: sessions.filter((session) => (
      !(session.sessionKind === 'pdf' && session.pdfPath === normalizedPdfPath)
    )),
    result: undefined,
  }));
}

export async function movePdfSessions(
  fromFolderPath: string,
  toFolderPath: string,
  oldPdfPath: string,
  newPdfPath: string,
): Promise<void> {
  const normalizedFromFolderPath = sanitizeRelativePath(fromFolderPath);
  const normalizedToFolderPath = sanitizeRelativePath(toFolderPath);
  const normalizedOldPdfPath = normalizePdfPath(oldPdfPath);
  const normalizedNewPdfPath = normalizePdfPath(newPdfPath);

  await withSessionsFileLocks([normalizedFromFolderPath, normalizedToFolderPath], async (sessionsByFolder) => {
    const sourceSessions = sessionsByFolder.get(normalizedFromFolderPath) ?? [];
    const movedSessions = sourceSessions
      .filter((session) => session.sessionKind === 'pdf' && session.pdfPath === normalizedOldPdfPath)
      .map((session) => ({
        ...session,
        folderPath: normalizedToFolderPath,
        pdfPath: normalizedNewPdfPath,
        title: buildSessionTitle(normalizedToFolderPath, 'pdf', normalizedNewPdfPath),
        updatedAt: new Date().toISOString(),
      }));

    if (movedSessions.length === 0) return;

    const remainingSourceSessions = sourceSessions.filter((session) => (
      !(session.sessionKind === 'pdf' && session.pdfPath === normalizedOldPdfPath)
    ));
    const destinationSessions = sessionsByFolder.get(normalizedToFolderPath) ?? [];
    if (normalizedFromFolderPath === normalizedToFolderPath) {
      await writeSessions(normalizedFromFolderPath, [...remainingSourceSessions, ...movedSessions]);
    } else {
      // Publish the destination first. If removing the source fails, restore
      // the destination snapshot here so callers never need to guess whether
      // the move was half-applied.
      await writeSessions(normalizedToFolderPath, [...destinationSessions, ...movedSessions]);
      try {
        await writeSessions(normalizedFromFolderPath, remainingSourceSessions);
      } catch (error) {
        await writeSessions(normalizedToFolderPath, destinationSessions).catch(() => undefined);
        throw error;
      }
    }
  });
}

export async function rewriteSessionsForFolderMove(
  oldFolderPath: string,
  newFolderPath: string,
): Promise<void> {
  const normalizedOldFolderPath = sanitizeRelativePath(oldFolderPath);
  const normalizedNewFolderPath = sanitizeRelativePath(newFolderPath);
  const sessionFolders = await collectAnnotSessionFolders(normalizedNewFolderPath);

  await Promise.all(sessionFolders.map((sessionFolderPath) => withSessionsFileMutation(sessionFolderPath, async (rawSessions) => ({
    sessions: rawSessions.map((session) => rewriteSessionPaths(session, {
      from: normalizedOldFolderPath,
      to: normalizedNewFolderPath,
    })),
    result: undefined,
  }))));
}
