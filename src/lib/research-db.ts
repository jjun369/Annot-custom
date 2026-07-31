import { createReadStream, promises as fs } from 'fs';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { getWorkspaceRoot, resolveFolderPath } from '@/lib/annot-sessions';
import { getPaperMetadata, updatePaperMetadata } from '@/lib/paper-metadata';
import type {
  AnalysisProfile,
  EvidenceAnchor,
  EvidenceLevel,
  PatentMetadata,
  ResearchAnalysisReport,
  ResearchDocument,
  ResearchDocumentKind,
  ResearchProject,
  ResearchSearchResult,
} from '@/types';

const SCHEMA_VERSION = 1;
const connectionCache = new Map<string, DatabaseSync>();

type SqlRow = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function sqlScalar(value: unknown): string | number | bigint | Uint8Array | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array
    ? value
    : null;
}

function normalizeRelativePath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('잘못된 문서 경로입니다.');
  }
  return normalized;
}

function researchDirectory(): string {
  return path.join(getWorkspaceRoot(), '.annot');
}

export function getResearchDatabasePath(): string {
  return path.join(researchDirectory(), 'pagedock.sqlite');
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      sha256 TEXT,
      current_path TEXT UNIQUE,
      file_name TEXT,
      display_title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'paper',
      doi TEXT,
      source_url TEXT,
      source_provider TEXT,
      abstract_text TEXT NOT NULL DEFAULT '',
      authors_json TEXT NOT NULL DEFAULT '[]',
      publication_year INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      file_size INTEGER,
      file_mtime_ms REAL,
      missing INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_doi ON documents(doi) WHERE doi IS NOT NULL AND doi <> '';

    CREATE TABLE IF NOT EXISTS document_aliases (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(document_id, path)
    );

    CREATE TABLE IF NOT EXISTS analysis_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      built_in INTEGER NOT NULL DEFAULT 0,
      focus_areas_json TEXT NOT NULL DEFAULT '[]',
      questions_json TEXT NOT NULL DEFAULT '[]',
      metrics_json TEXT NOT NULL DEFAULT '[]',
      terminology_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL REFERENCES analysis_profiles(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_documents (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(project_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS patent_metadata (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      publication_number TEXT,
      application_number TEXT,
      registration_number TEXT,
      priority_date TEXT,
      filing_date TEXT,
      publication_date TEXT,
      jurisdiction TEXT,
      legal_status TEXT,
      assignees_json TEXT NOT NULL DEFAULT '[]',
      inventors_json TEXT NOT NULL DEFAULT '[]',
      family_id TEXT,
      citations_json TEXT NOT NULL DEFAULT '[]',
      claims_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_patent_publication ON patent_metadata(publication_number);
    CREATE INDEX IF NOT EXISTS idx_patent_family ON patent_metadata(family_id);

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      page INTEGER,
      chunk_kind TEXT NOT NULL DEFAULT 'page',
      section TEXT,
      claim TEXT,
      figure TEXT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(document_id, ordinal)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      document_id UNINDEXED,
      title,
      body,
      tags,
      tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS analysis_reports (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      profile_id TEXT NOT NULL REFERENCES analysis_profiles(id),
      status TEXT NOT NULL,
      model TEXT,
      reasoning_effort TEXT,
      report_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_anchors (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES analysis_reports(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      page INTEGER,
      section TEXT,
      claim TEXT,
      figure TEXT,
      quote TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS document_conflicts (
      id TEXT PRIMARY KEY,
      document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

const BUILT_IN_PROFILES = [
  {
    id: 'profile-general',
    name: '범용 리서치',
    description: '논문·특허의 문제, 구현, 효과, 한계와 근거를 균형 있게 검토합니다.',
    focusAreas: ['핵심 아이디어', '구현 방법', '성능 효과', '한계', '관련 기술'],
    questions: ['무슨 문제를 해결하는가?', '핵심 구현은 무엇인가?', '근거와 추정은 어떻게 구분되는가?'],
    metrics: ['성능', '비용', '복잡도', '신뢰성'],
    terminology: {},
  },
  {
    id: 'profile-cis-pa',
    name: '이미지센서 PA',
    description: '픽셀·소자·공정 구현과 CIS 성능 trade-off를 중심으로 분석합니다.',
    focusAreas: ['픽셀 구조', '소자 배치', '공정 순서', '격리', 'HDR', 'small pixel'],
    questions: ['추가 mask·implant·etch·deposition이 필요한가?', 'small-pixel 적용 시 병목은 무엇인가?'],
    metrics: ['FWC', 'CG', 'DR', 'QE', 'dark current', 'crosstalk', 'noise'],
    terminology: { iDCG: ['in-pixel dual conversion gain', 'dual conversion gain'] },
  },
  {
    id: 'profile-logic',
    name: '로직 반도체',
    description: '소자·공정 통합, PPA, 수율과 신뢰성을 중심으로 분석합니다.',
    focusAreas: ['소자 구조', '공정 통합', '배선', '전력', '성능', '수율'],
    questions: ['기존 공정과 호환되는가?', 'PPA와 수율 trade-off는 무엇인가?'],
    metrics: ['power', 'performance', 'area', 'yield', 'reliability'],
    terminology: {},
  },
];

function seedProfiles(db: DatabaseSync): void {
  const insert = db.prepare(`
    INSERT INTO analysis_profiles (
      id, name, description, built_in, focus_areas_json, questions_json,
      metrics_json, terminology_json, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      built_in = 1,
      focus_areas_json = excluded.focus_areas_json,
      questions_json = excluded.questions_json,
      metrics_json = excluded.metrics_json,
      terminology_json = excluded.terminology_json,
      updated_at = excluded.updated_at
  `);
  const timestamp = now();
  for (const profile of BUILT_IN_PROFILES) {
    insert.run(
      profile.id,
      profile.name,
      profile.description,
      JSON.stringify(profile.focusAreas),
      JSON.stringify(profile.questions),
      JSON.stringify(profile.metrics),
      JSON.stringify(profile.terminology),
      timestamp,
      timestamp,
    );
  }
}

export async function getResearchDb(): Promise<DatabaseSync> {
  const filePath = getResearchDatabasePath();
  const cached = connectionCache.get(filePath);
  if (cached) return cached;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  createSchema(db);
  seedProfiles(db);
  connectionCache.set(filePath, db);
  return db;
}

function documentFromRow(row: SqlRow): ResearchDocument {
  return {
    id: String(row.id),
    sha256: typeof row.sha256 === 'string' ? row.sha256 : undefined,
    currentPath: typeof row.current_path === 'string' ? row.current_path : undefined,
    fileName: typeof row.file_name === 'string' ? row.file_name : undefined,
    displayTitle: String(row.display_title || row.file_name || '제목 없음'),
    kind: String(row.kind || 'paper') as ResearchDocumentKind,
    doi: typeof row.doi === 'string' ? row.doi : undefined,
    sourceUrl: typeof row.source_url === 'string' ? row.source_url : undefined,
    sourceProvider: typeof row.source_provider === 'string' ? row.source_provider : undefined,
    abstractText: String(row.abstract_text || ''),
    authors: parseJson<string[]>(row.authors_json, []),
    publicationYear: typeof row.publication_year === 'number' ? row.publication_year : undefined,
    tags: parseJson<string[]>(row.tags_json, []),
    fileSize: typeof row.file_size === 'number' ? row.file_size : undefined,
    fileMtimeMs: typeof row.file_mtime_ms === 'number' ? row.file_mtime_ms : undefined,
    missing: Number(row.missing || 0) === 1,
    indexedAt: typeof row.indexed_at === 'string' ? row.indexed_at : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function profileFromRow(row: SqlRow): AnalysisProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description || ''),
    builtIn: Number(row.built_in || 0) === 1,
    focusAreas: parseJson<string[]>(row.focus_areas_json, []),
    questions: parseJson<string[]>(row.questions_json, []),
    metrics: parseJson<string[]>(row.metrics_json, []),
    terminology: parseJson<Record<string, string[]>>(row.terminology_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function projectFromRow(row: SqlRow): ResearchProject {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description || ''),
    profileId: String(row.profile_id),
    documentCount: Number(row.document_count || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer);
  return digest.digest('hex');
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(resolveFolderPath(relativePath));
    return true;
  } catch {
    return false;
  }
}

function createDocumentConflict(
  db: DatabaseSync,
  input: { documentId?: string; path: string; kind: string; details: string },
): void {
  const existing = db.prepare(`
    SELECT id FROM document_conflicts
    WHERE document_id IS ? AND path = ? AND kind = ? AND resolved_at IS NULL
    LIMIT 1
  `).get(input.documentId || null, input.path, input.kind) as SqlRow | undefined;
  if (existing) return;
  db.prepare(`
    INSERT INTO document_conflicts(id, document_id, path, kind, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.documentId || null, input.path, input.kind, input.details, now());
}

async function createDocumentForFile(relativePath: string, sha256: string, fileSize: number, mtimeMs: number): Promise<ResearchDocument> {
  const db = await getResearchDb();
  const normalizedPath = normalizeRelativePath(relativePath);
  const metadata = await getPaperMetadata(normalizedPath);
  const timestamp = now();
  const id = metadata.documentId || randomUUID();
  const title = path.posix.basename(normalizedPath).replace(/\.pdf$/i, '');
  db.prepare(`
    INSERT INTO documents (
      id, sha256, current_path, file_name, display_title, kind, abstract_text,
      tags_json, file_size, file_mtime_ms, missing, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'paper', ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    sha256,
    normalizedPath,
    path.posix.basename(normalizedPath),
    title,
    metadata.summaryKo || '',
    JSON.stringify([...metadata.aiKeywords, ...metadata.personalTags]),
    fileSize,
    mtimeMs,
    timestamp,
    timestamp,
  );
  db.prepare('INSERT OR IGNORE INTO document_aliases(document_id, path, created_at) VALUES (?, ?, ?)')
    .run(id, normalizedPath, timestamp);
  if (metadata.documentId !== id) await updatePaperMetadata(normalizedPath, { documentId: id });
  await rebuildDocumentFts(id);
  return (await getDocumentById(id))!;
}

export async function getDocumentById(id: string): Promise<ResearchDocument | null> {
  const db = await getResearchDb();
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as SqlRow | undefined;
  return row ? documentFromRow(row) : null;
}

export async function getDocumentByPath(relativePath: string): Promise<ResearchDocument | null> {
  const db = await getResearchDb();
  const normalizedPath = normalizeRelativePath(relativePath);
  const row = db.prepare(`
    SELECT d.* FROM documents d
    LEFT JOIN document_aliases a ON a.document_id = d.id
    WHERE d.current_path = ? OR a.path = ?
    LIMIT 1
  `).get(normalizedPath, normalizedPath) as SqlRow | undefined;
  return row ? documentFromRow(row) : null;
}

export async function ensureDocumentForPath(relativePath: string): Promise<ResearchDocument> {
  const normalizedPath = normalizeRelativePath(relativePath);
  const existing = await getDocumentByPath(normalizedPath);
  const absolutePath = resolveFolderPath(normalizedPath);
  const stats = await fs.stat(absolutePath);
  if (existing) {
    if (existing.fileSize !== stats.size || existing.fileMtimeMs !== stats.mtimeMs) {
      const digest = await sha256File(absolutePath);
      const db = await getResearchDb();
      if (existing.sha256 && existing.sha256 !== digest) {
        createDocumentConflict(db, {
          documentId: existing.id,
          path: normalizedPath,
          kind: 'content-changed',
          details: '같은 경로의 PDF 내용이 달라졌습니다. 기존 메모 연결을 유지할지 확인해 주세요.',
        });
        db.prepare('UPDATE documents SET missing = 1, updated_at = ? WHERE id = ?')
          .run(now(), existing.id);
        return (await getDocumentById(existing.id))!;
      }
      db.prepare(`UPDATE documents SET sha256 = ?, file_size = ?, file_mtime_ms = ?, missing = 0, updated_at = ? WHERE id = ?`)
        .run(digest, stats.size, stats.mtimeMs, now(), existing.id);
      return (await getDocumentById(existing.id))!;
    }
    return existing;
  }
  const digest = await sha256File(absolutePath);
  const db = await getResearchDb();
  const matches = db.prepare('SELECT * FROM documents WHERE sha256 = ?').all(digest) as SqlRow[];
  const missingMatches: SqlRow[] = [];
  for (const match of matches) {
    const currentPath = typeof match.current_path === 'string' ? match.current_path : '';
    if (!currentPath || !(await pathExists(currentPath))) missingMatches.push(match);
  }
  if (missingMatches.length === 1) {
    const documentId = String(missingMatches[0].id);
    const oldPath = typeof missingMatches[0].current_path === 'string' ? missingMatches[0].current_path : null;
    const timestamp = now();
    db.prepare(`UPDATE documents SET current_path = ?, file_name = ?, file_size = ?, file_mtime_ms = ?, missing = 0, updated_at = ? WHERE id = ?`)
      .run(normalizedPath, path.posix.basename(normalizedPath), stats.size, stats.mtimeMs, timestamp, documentId);
    db.prepare('INSERT OR IGNORE INTO document_aliases(document_id, path, created_at) VALUES (?, ?, ?)')
      .run(documentId, normalizedPath, timestamp);
    if (oldPath) db.prepare('INSERT OR IGNORE INTO document_aliases(document_id, path, created_at) VALUES (?, ?, ?)')
      .run(documentId, oldPath, timestamp);
    return (await getDocumentById(documentId))!;
  }
  if (matches.length === 1) {
    const documentId = String(matches[0].id);
    const timestamp = now();
    db.prepare('INSERT OR IGNORE INTO document_aliases(document_id, path, created_at) VALUES (?, ?, ?)')
      .run(documentId, normalizedPath, timestamp);
    createDocumentConflict(db, {
      documentId,
      path: normalizedPath,
      kind: 'duplicate',
      details: '같은 내용의 PDF가 여러 경로에 있습니다.',
    });
    return (await getDocumentById(documentId))!;
  }
  return createDocumentForFile(normalizedPath, digest, stats.size, stats.mtimeMs);
}

async function collectPdfPaths(): Promise<string[]> {
  const root = getWorkspaceRoot();
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        result.push(path.relative(root, absolutePath).split(path.sep).join('/'));
      }
    }
  }
  await fs.mkdir(root, { recursive: true });
  await walk(root);
  return result.sort((a, b) => a.localeCompare(b));
}

export async function syncWorkspaceDocuments(): Promise<{ documents: ResearchDocument[]; conflicts: number }> {
  const paths = await collectPdfPaths();
  for (const pdfPath of paths) await ensureDocumentForPath(pdfPath);
  const db = await getResearchDb();
  const pathSet = new Set(paths);
  const changedPaths = new Set((db.prepare(`
    SELECT path FROM document_conflicts
    WHERE kind = 'content-changed' AND resolved_at IS NULL
  `).all() as SqlRow[]).map((row) => String(row.path)));
  const rows = db.prepare('SELECT id, current_path FROM documents WHERE current_path IS NOT NULL').all() as SqlRow[];
  const updateMissing = db.prepare('UPDATE documents SET missing = ?, updated_at = ? WHERE id = ?');
  for (const row of rows) {
    const currentPath = String(row.current_path);
    updateMissing.run(pathSet.has(currentPath) && !changedPaths.has(currentPath) ? 0 : 1, now(), String(row.id));
  }
  const documents = (db.prepare('SELECT * FROM documents ORDER BY updated_at DESC').all() as SqlRow[]).map(documentFromRow);
  const conflictRow = db.prepare('SELECT COUNT(*) AS count FROM document_conflicts WHERE resolved_at IS NULL').get() as SqlRow;
  return { documents, conflicts: Number(conflictRow.count || 0) };
}

export async function recordDocumentPathChange(oldPath: string, newPath: string): Promise<ResearchDocument> {
  const oldNormalized = normalizeRelativePath(oldPath);
  const nextNormalized = normalizeRelativePath(newPath);
  const document = await getDocumentByPath(oldNormalized) || await ensureDocumentForPath(nextNormalized);
  const stats = await fs.stat(resolveFolderPath(nextNormalized));
  const db = await getResearchDb();
  const timestamp = now();
  db.prepare(`UPDATE documents SET current_path = ?, file_name = ?, file_size = ?, file_mtime_ms = ?, missing = 0, updated_at = ? WHERE id = ?`)
    .run(nextNormalized, path.posix.basename(nextNormalized), stats.size, stats.mtimeMs, timestamp, document.id);
  const alias = db.prepare('INSERT OR IGNORE INTO document_aliases(document_id, path, created_at) VALUES (?, ?, ?)');
  alias.run(document.id, oldNormalized, timestamp);
  alias.run(document.id, nextNormalized, timestamp);
  return (await getDocumentById(document.id))!;
}

export async function listDocuments(projectId?: string): Promise<ResearchDocument[]> {
  const db = await getResearchDb();
  const rows = projectId
    ? db.prepare(`SELECT d.* FROM documents d JOIN project_documents pd ON pd.document_id = d.id WHERE pd.project_id = ? ORDER BY d.updated_at DESC`).all(projectId)
    : db.prepare('SELECT * FROM documents ORDER BY updated_at DESC').all();
  return (rows as SqlRow[]).map(documentFromRow);
}

export async function createExternalDocument(input: {
  displayTitle: string;
  kind?: ResearchDocumentKind;
  doi?: string;
  sourceUrl?: string;
  sourceProvider?: string;
  abstractText?: string;
  authors?: string[];
  publicationYear?: number;
  tags?: string[];
}): Promise<ResearchDocument> {
  const db = await getResearchDb();
  const normalizedDoi = input.doi?.trim().toLowerCase() || null;
  if (normalizedDoi) {
    const existing = db.prepare('SELECT * FROM documents WHERE doi = ?').get(normalizedDoi) as SqlRow | undefined;
    if (existing) return updateDocument(String(existing.id), { ...input, doi: normalizedDoi });
  }
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`
    INSERT INTO documents(id, display_title, kind, doi, source_url, source_provider, abstract_text,
      authors_json, publication_year, tags_json, missing, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id, input.displayTitle.trim() || '제목 없음', input.kind || 'paper', normalizedDoi,
    input.sourceUrl || null, input.sourceProvider || null, input.abstractText || '',
    JSON.stringify(input.authors || []), input.publicationYear || null, JSON.stringify(input.tags || []),
    timestamp, timestamp,
  );
  await rebuildDocumentFts(id);
  return (await getDocumentById(id))!;
}

export async function getDocumentProjectIds(documentId: string): Promise<string[]> {
  const db = await getResearchDb();
  return (db.prepare('SELECT project_id FROM project_documents WHERE document_id = ? ORDER BY created_at').all(documentId) as SqlRow[])
    .map((row) => String(row.project_id));
}

export async function listDocumentConflicts(): Promise<Array<{ id: string; documentId?: string; path: string; kind: string; details: string; createdAt: string }>> {
  const db = await getResearchDb();
  return (db.prepare('SELECT * FROM document_conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC').all() as SqlRow[])
    .map((row) => ({
      id: String(row.id),
      documentId: typeof row.document_id === 'string' ? row.document_id : undefined,
      path: String(row.path),
      kind: String(row.kind),
      details: String(row.details || ''),
      createdAt: String(row.created_at),
    }));
}

export async function resolveDocumentConflict(
  id: string,
  action: 'acknowledge' | 'accept-current-file' = 'acknowledge',
): Promise<void> {
  const db = await getResearchDb();
  const conflict = db.prepare('SELECT * FROM document_conflicts WHERE id = ? AND resolved_at IS NULL').get(id) as SqlRow | undefined;
  if (!conflict) throw new Error('이미 처리되었거나 존재하지 않는 확인 항목입니다.');
  if (String(conflict.kind) === 'content-changed') {
    if (action !== 'accept-current-file') {
      throw new Error('내용이 바뀐 PDF는 현재 파일을 새 버전으로 사용할지 명시적으로 선택해 주세요.');
    }
    const documentId = typeof conflict.document_id === 'string' ? conflict.document_id : '';
    const relativePath = String(conflict.path);
    if (!documentId) throw new Error('연결할 문서 정보가 없습니다.');
    const absolutePath = resolveFolderPath(relativePath);
    const stats = await fs.stat(absolutePath);
    const digest = await sha256File(absolutePath);
    db.prepare(`
      UPDATE documents
      SET sha256 = ?, file_size = ?, file_mtime_ms = ?, missing = 0, updated_at = ?
      WHERE id = ?
    `).run(digest, stats.size, stats.mtimeMs, now(), documentId);
  }
  db.prepare('UPDATE document_conflicts SET resolved_at = ? WHERE id = ?').run(now(), id);
}

export async function updateDocument(
  id: string,
  updates: Partial<Pick<ResearchDocument, 'displayTitle' | 'kind' | 'doi' | 'sourceUrl' | 'sourceProvider' | 'abstractText' | 'authors' | 'publicationYear' | 'tags'>>,
): Promise<ResearchDocument> {
  const current = await getDocumentById(id);
  if (!current) throw new Error('문서를 찾지 못했습니다.');
  const next = { ...current, ...updates };
  const db = await getResearchDb();
  db.prepare(`
    UPDATE documents SET display_title = ?, kind = ?, doi = ?, source_url = ?, source_provider = ?,
      abstract_text = ?, authors_json = ?, publication_year = ?, tags_json = ?, updated_at = ? WHERE id = ?
  `).run(
    next.displayTitle.trim() || current.displayTitle,
    next.kind,
    next.doi || null,
    next.sourceUrl || null,
    next.sourceProvider || null,
    next.abstractText || '',
    JSON.stringify(next.authors || []),
    next.publicationYear || null,
    JSON.stringify(next.tags || []),
    now(),
    id,
  );
  await rebuildDocumentFts(id);
  return (await getDocumentById(id))!;
}

export async function replaceDocumentChunks(
  documentId: string,
  chunks: Array<{ page?: number; kind?: string; section?: string; claim?: string; figure?: string; text: string }>,
): Promise<void> {
  const db = await getResearchDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(documentId);
    const insert = db.prepare(`
      INSERT INTO document_chunks(id, document_id, ordinal, page, chunk_kind, section, claim, figure, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    chunks.forEach((chunk, index) => insert.run(
      randomUUID(), documentId, index, chunk.page || null, chunk.kind || 'page', chunk.section || null,
      chunk.claim || null, chunk.figure || null, chunk.text, now(),
    ));
    db.prepare('UPDATE documents SET indexed_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), documentId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  await rebuildDocumentFts(documentId);
}

export async function getDocumentChunks(documentId: string): Promise<Array<{ id: string; page?: number; kind: string; section?: string; claim?: string; figure?: string; text: string }>> {
  const db = await getResearchDb();
  return (db.prepare('SELECT * FROM document_chunks WHERE document_id = ? ORDER BY ordinal').all(documentId) as SqlRow[])
    .map((row) => ({
      id: String(row.id),
      page: typeof row.page === 'number' ? row.page : undefined,
      kind: String(row.chunk_kind),
      section: typeof row.section === 'string' ? row.section : undefined,
      claim: typeof row.claim === 'string' ? row.claim : undefined,
      figure: typeof row.figure === 'string' ? row.figure : undefined,
      text: String(row.text),
    }));
}

async function rebuildDocumentFts(documentId: string): Promise<void> {
  const db = await getResearchDb();
  const document = await getDocumentById(documentId);
  if (!document) return;
  const bodyRows = db.prepare('SELECT text FROM document_chunks WHERE document_id = ? ORDER BY ordinal').all(documentId) as SqlRow[];
  const patentRow = db.prepare('SELECT claims_text FROM patent_metadata WHERE document_id = ?').get(documentId) as SqlRow | undefined;
  const metadata = document.currentPath ? await getPaperMetadata(document.currentPath) : null;
  const body = [
    document.abstractText,
    String(patentRow?.claims_text || ''),
    metadata?.noteMarkdown || '',
    ...bodyRows.map((row) => String(row.text)),
  ].join('\n');
  const tags = [...document.tags, ...(metadata?.aiKeywords || []), ...(metadata?.personalTags || [])];
  db.prepare('DELETE FROM document_fts WHERE document_id = ?').run(documentId);
  db.prepare('INSERT INTO document_fts(document_id, title, body, tags) VALUES (?, ?, ?, ?)')
    .run(documentId, document.displayTitle, body, tags.join(' '));
}

export async function refreshDocumentSearchIndex(pdfPath: string): Promise<void> {
  const document = await getDocumentByPath(pdfPath);
  if (document) await rebuildDocumentFts(document.id);
}

function ftsQuery(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).map((term) => `"${term.replace(/"/g, '""')}"*`).join(' OR ');
}

export async function searchDocuments(query: string, projectId?: string): Promise<ResearchSearchResult[]> {
  const db = await getResearchDb();
  const normalized = ftsQuery(query);
  if (!normalized) return [];
  const rows = projectId
    ? db.prepare(`
        SELECT d.*, bm25(document_fts) AS rank,
          snippet(document_fts, 2, '<mark>', '</mark>', ' … ', 24) AS snippet
        FROM document_fts
        JOIN documents d ON d.id = document_fts.document_id
        JOIN project_documents pd ON pd.document_id = d.id
        WHERE document_fts MATCH ? AND pd.project_id = ?
        ORDER BY rank LIMIT 100
      `).all(normalized, projectId)
    : db.prepare(`
        SELECT d.*, bm25(document_fts) AS rank,
          snippet(document_fts, 2, '<mark>', '</mark>', ' … ', 24) AS snippet
        FROM document_fts JOIN documents d ON d.id = document_fts.document_id
        WHERE document_fts MATCH ? ORDER BY rank LIMIT 100
      `).all(normalized);
  const projectLookup = db.prepare('SELECT project_id FROM project_documents WHERE document_id = ?');
  return (rows as SqlRow[]).map((row) => ({
    document: documentFromRow(row),
    score: Math.abs(Number(row.rank || 0)),
    snippet: String(row.snippet || ''),
    matches: query.trim().split(/\s+/).filter(Boolean),
    projectIds: (projectLookup.all(String(row.id)) as SqlRow[]).map((item) => String(item.project_id)),
  }));
}

export async function listProfiles(): Promise<AnalysisProfile[]> {
  const db = await getResearchDb();
  return (db.prepare('SELECT * FROM analysis_profiles ORDER BY built_in DESC, name').all() as SqlRow[]).map(profileFromRow);
}

export async function upsertProfile(input: Partial<AnalysisProfile> & { name: string }): Promise<AnalysisProfile> {
  const db = await getResearchDb();
  const id = input.id || randomUUID();
  const existing = db.prepare('SELECT * FROM analysis_profiles WHERE id = ?').get(id) as SqlRow | undefined;
  if (existing && Number(existing.built_in) === 1) throw new Error('기본 프로필은 직접 변경할 수 없습니다. 복사본을 만들어 주세요.');
  const timestamp = now();
  db.prepare(`
    INSERT INTO analysis_profiles(id, name, description, built_in, focus_areas_json, questions_json, metrics_json, terminology_json, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
      focus_areas_json=excluded.focus_areas_json, questions_json=excluded.questions_json,
      metrics_json=excluded.metrics_json, terminology_json=excluded.terminology_json, updated_at=excluded.updated_at
  `).run(
    id, input.name.trim(), input.description || '', JSON.stringify(input.focusAreas || []),
    JSON.stringify(input.questions || []), JSON.stringify(input.metrics || []),
    JSON.stringify(input.terminology || {}), existing ? String(existing.created_at) : timestamp, timestamp,
  );
  return profileFromRow(db.prepare('SELECT * FROM analysis_profiles WHERE id = ?').get(id) as SqlRow);
}

export async function listProjects(): Promise<ResearchProject[]> {
  const db = await getResearchDb();
  return (db.prepare(`
    SELECT p.*, COUNT(pd.document_id) AS document_count FROM projects p
    LEFT JOIN project_documents pd ON pd.project_id = p.id
    GROUP BY p.id ORDER BY p.updated_at DESC
  `).all() as SqlRow[]).map(projectFromRow);
}

export async function createProject(input: { name: string; description?: string; profileId?: string }): Promise<ResearchProject> {
  const db = await getResearchDb();
  const id = randomUUID();
  const timestamp = now();
  db.prepare('INSERT INTO projects(id, name, description, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.name.trim(), input.description || '', input.profileId || 'profile-general', timestamp, timestamp);
  return projectFromRow(db.prepare(`SELECT p.*, 0 AS document_count FROM projects p WHERE id = ?`).get(id) as SqlRow);
}

export async function updateProject(id: string, updates: Partial<Pick<ResearchProject, 'name' | 'description' | 'profileId'>>): Promise<ResearchProject> {
  const db = await getResearchDb();
  const current = (await listProjects()).find((project) => project.id === id);
  if (!current) throw new Error('프로젝트를 찾지 못했습니다.');
  db.prepare('UPDATE projects SET name = ?, description = ?, profile_id = ?, updated_at = ? WHERE id = ?')
    .run(updates.name?.trim() || current.name, updates.description ?? current.description, updates.profileId || current.profileId, now(), id);
  return (await listProjects()).find((project) => project.id === id)!;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getResearchDb();
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export async function setProjectDocument(projectId: string, documentId: string, linked: boolean): Promise<void> {
  const db = await getResearchDb();
  if (linked) {
    db.prepare('INSERT OR IGNORE INTO project_documents(project_id, document_id, created_at) VALUES (?, ?, ?)')
      .run(projectId, documentId, now());
  } else {
    db.prepare('DELETE FROM project_documents WHERE project_id = ? AND document_id = ?').run(projectId, documentId);
  }
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);
}

export async function getPatentMetadata(documentId: string): Promise<PatentMetadata | null> {
  const db = await getResearchDb();
  const row = db.prepare('SELECT * FROM patent_metadata WHERE document_id = ?').get(documentId) as SqlRow | undefined;
  if (!row) return null;
  return {
    documentId,
    publicationNumber: typeof row.publication_number === 'string' ? row.publication_number : undefined,
    applicationNumber: typeof row.application_number === 'string' ? row.application_number : undefined,
    registrationNumber: typeof row.registration_number === 'string' ? row.registration_number : undefined,
    priorityDate: typeof row.priority_date === 'string' ? row.priority_date : undefined,
    filingDate: typeof row.filing_date === 'string' ? row.filing_date : undefined,
    publicationDate: typeof row.publication_date === 'string' ? row.publication_date : undefined,
    jurisdiction: typeof row.jurisdiction === 'string' ? row.jurisdiction : undefined,
    legalStatus: typeof row.legal_status === 'string' ? row.legal_status : undefined,
    assignees: parseJson<string[]>(row.assignees_json, []),
    inventors: parseJson<string[]>(row.inventors_json, []),
    familyId: typeof row.family_id === 'string' ? row.family_id : undefined,
    citations: parseJson<string[]>(row.citations_json, []),
    claimsText: String(row.claims_text || ''),
    updatedAt: String(row.updated_at),
  };
}

export async function upsertPatentMetadata(input: PatentMetadata): Promise<PatentMetadata> {
  const db = await getResearchDb();
  db.prepare(`
    INSERT INTO patent_metadata(document_id, publication_number, application_number, registration_number,
      priority_date, filing_date, publication_date, jurisdiction, legal_status, assignees_json,
      inventors_json, family_id, citations_json, claims_text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET publication_number=excluded.publication_number,
      application_number=excluded.application_number, registration_number=excluded.registration_number,
      priority_date=excluded.priority_date, filing_date=excluded.filing_date, publication_date=excluded.publication_date,
      jurisdiction=excluded.jurisdiction, legal_status=excluded.legal_status, assignees_json=excluded.assignees_json,
      inventors_json=excluded.inventors_json, family_id=excluded.family_id,
      citations_json=excluded.citations_json, claims_text=excluded.claims_text, updated_at=excluded.updated_at
  `).run(
    input.documentId, input.publicationNumber || null, input.applicationNumber || null, input.registrationNumber || null,
    input.priorityDate || null, input.filingDate || null, input.publicationDate || null, input.jurisdiction || null,
    input.legalStatus || null, JSON.stringify(input.assignees || []), JSON.stringify(input.inventors || []),
    input.familyId || null, JSON.stringify(input.citations || []), input.claimsText || '', now(),
  );
  await updateDocument(input.documentId, { kind: 'patent' });
  return (await getPatentMetadata(input.documentId))!;
}

export async function saveAnalysisReport(input: {
  id?: string;
  documentId: string;
  projectId?: string;
  profileId: string;
  status: ResearchAnalysisReport['status'];
  model?: string;
  reasoningEffort?: ResearchAnalysisReport['reasoningEffort'];
  report?: Record<string, unknown>;
  evidence?: Array<Omit<EvidenceAnchor, 'id' | 'reportId' | 'documentId'> & { id?: string }>;
  error?: string;
}): Promise<ResearchAnalysisReport> {
  const db = await getResearchDb();
  const id = input.id || randomUUID();
  const timestamp = now();
  const existing = db.prepare('SELECT created_at FROM analysis_reports WHERE id = ?').get(id) as SqlRow | undefined;
  db.prepare(`
    INSERT INTO analysis_reports(id, document_id, project_id, profile_id, status, model, reasoning_effort, report_json, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, model=excluded.model, reasoning_effort=excluded.reasoning_effort,
      report_json=excluded.report_json, error=excluded.error, updated_at=excluded.updated_at
  `).run(
    id, input.documentId, input.projectId || null, input.profileId, input.status, input.model || null,
    input.reasoningEffort || null, JSON.stringify(input.report || {}), input.error || null,
    existing ? String(existing.created_at) : timestamp, timestamp,
  );
  db.prepare('DELETE FROM evidence_anchors WHERE report_id = ?').run(id);
  const evidenceInsert = db.prepare(`
    INSERT INTO evidence_anchors(id, report_id, document_id, level, page, section, claim, figure, quote, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const anchor of input.evidence || []) {
    evidenceInsert.run(
      anchor.id || randomUUID(), id, input.documentId, anchor.level, anchor.page || null,
      anchor.section || null, anchor.claim || null, anchor.figure || null, anchor.quote || '', anchor.note || '',
    );
  }
  return (await listAnalysisReports(input.documentId)).find((report) => report.id === id)!;
}

export async function listAnalysisReports(documentId: string): Promise<ResearchAnalysisReport[]> {
  const db = await getResearchDb();
  const rows = db.prepare('SELECT * FROM analysis_reports WHERE document_id = ? ORDER BY created_at DESC').all(documentId) as SqlRow[];
  const evidenceQuery = db.prepare('SELECT * FROM evidence_anchors WHERE report_id = ? ORDER BY page, id');
  return rows.map((row) => ({
    id: String(row.id),
    documentId: String(row.document_id),
    projectId: typeof row.project_id === 'string' ? row.project_id : undefined,
    profileId: String(row.profile_id),
    status: String(row.status) as ResearchAnalysisReport['status'],
    model: typeof row.model === 'string' ? row.model : undefined,
    reasoningEffort: typeof row.reasoning_effort === 'string' ? row.reasoning_effort as ResearchAnalysisReport['reasoningEffort'] : undefined,
    report: parseJson<Record<string, unknown>>(row.report_json, {}),
    evidence: (evidenceQuery.all(String(row.id)) as SqlRow[]).map((anchor) => ({
      id: String(anchor.id), reportId: String(row.id), documentId: String(row.document_id),
      level: String(anchor.level) as EvidenceLevel,
      page: typeof anchor.page === 'number' ? anchor.page : undefined,
      section: typeof anchor.section === 'string' ? anchor.section : undefined,
      claim: typeof anchor.claim === 'string' ? anchor.claim : undefined,
      figure: typeof anchor.figure === 'string' ? anchor.figure : undefined,
      quote: String(anchor.quote || ''), note: String(anchor.note || ''),
    })),
    error: typeof row.error === 'string' ? row.error : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function exportResearchData(): Promise<Record<string, unknown>> {
  const db = await getResearchDb();
  const tableNames = ['documents', 'document_aliases', 'analysis_profiles', 'projects', 'project_documents', 'patent_metadata', 'document_chunks', 'analysis_reports', 'evidence_anchors'];
  return {
    format: 'pagedock-research-export',
    version: 1,
    createdAt: now(),
    tables: Object.fromEntries(tableNames.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])),
  };
}

export async function importResearchData(
  payload: unknown,
  pathMap: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  if (!payload || typeof payload !== 'object') throw new Error('리서치 백업 데이터가 올바르지 않습니다.');
  const data = payload as { format?: string; version?: number; tables?: Record<string, unknown> };
  if (data.format !== 'pagedock-research-export' || data.version !== 1 || !data.tables) {
    throw new Error('지원하지 않는 리서치 백업 형식입니다.');
  }
  const rows = (name: string): SqlRow[] => Array.isArray(data.tables?.[name])
    ? data.tables[name] as SqlRow[]
    : [];
  const db = await getResearchDb();
  const documentIds = new Map<string, string>();
  const projectIds = new Map<string, string>();
  const profileIds = new Map<string, string>();
  const reportIds = new Map<string, string>();
  const timestamp = now();

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows('analysis_profiles')) {
      const oldId = String(row.id || randomUUID());
      const existing = db.prepare('SELECT id FROM analysis_profiles WHERE id = ?').get(oldId) as SqlRow | undefined;
      const id = existing ? oldId : oldId;
      profileIds.set(oldId, id);
      db.prepare(`INSERT OR IGNORE INTO analysis_profiles
        (id,name,description,built_in,focus_areas_json,questions_json,metrics_json,terminology_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id, String(row.name || '복원된 프로필'), String(row.description || ''), Number(row.built_in || 0),
        String(row.focus_areas_json || '[]'), String(row.questions_json || '[]'), String(row.metrics_json || '[]'),
        String(row.terminology_json || '{}'), String(row.created_at || timestamp), timestamp,
      );
    }

    for (const row of rows('documents')) {
      const oldId = String(row.id || randomUUID());
      const sha = typeof row.sha256 === 'string' ? row.sha256 : null;
      const doi = typeof row.doi === 'string' ? row.doi : null;
      const existing = (sha
        ? db.prepare('SELECT id FROM documents WHERE sha256 = ? ORDER BY missing, created_at LIMIT 1').get(sha)
        : doi ? db.prepare('SELECT id FROM documents WHERE doi = ? LIMIT 1').get(doi) : undefined) as SqlRow | undefined;
      const id = existing ? String(existing.id) : oldId;
      documentIds.set(oldId, id);
      if (existing) continue;
      const oldPath = typeof row.current_path === 'string' ? row.current_path : undefined;
      const mappedPath = oldPath ? pathMap.get(oldPath) || oldPath : null;
      db.prepare(`INSERT OR IGNORE INTO documents
        (id,sha256,current_path,file_name,display_title,kind,doi,source_url,source_provider,abstract_text,
         authors_json,publication_year,tags_json,file_size,file_mtime_ms,missing,indexed_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, sha, mappedPath, mappedPath ? path.posix.basename(mappedPath) : sqlScalar(row.file_name),
        String(row.display_title || row.file_name || '복원된 문서'), String(row.kind || 'paper'), doi,
        sqlScalar(row.source_url), sqlScalar(row.source_provider), String(row.abstract_text || ''),
        String(row.authors_json || '[]'), sqlScalar(row.publication_year), String(row.tags_json || '[]'),
        sqlScalar(row.file_size), sqlScalar(row.file_mtime_ms), Number(row.missing || 0), sqlScalar(row.indexed_at),
        String(row.created_at || timestamp), timestamp,
      );
    }

    for (const row of rows('document_aliases')) {
      const documentId = documentIds.get(String(row.document_id));
      if (!documentId) continue;
      const oldPath = String(row.path || '');
      const mappedPath = pathMap.get(oldPath) || oldPath;
      if (mappedPath) db.prepare('INSERT OR IGNORE INTO document_aliases(document_id,path,created_at) VALUES (?,?,?)')
        .run(documentId, mappedPath, String(row.created_at || timestamp));
    }

    for (const row of rows('projects')) {
      const oldId = String(row.id || randomUUID());
      const id = (db.prepare('SELECT id FROM projects WHERE id = ?').get(oldId) as SqlRow | undefined) ? randomUUID() : oldId;
      projectIds.set(oldId, id);
      const profileId = profileIds.get(String(row.profile_id)) || String(row.profile_id || 'profile-general');
      db.prepare('INSERT INTO projects(id,name,description,profile_id,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, String(row.name || '복원된 프로젝트'), String(row.description || ''), profileId, String(row.created_at || timestamp), timestamp);
    }

    for (const row of rows('project_documents')) {
      const projectId = projectIds.get(String(row.project_id));
      const documentId = documentIds.get(String(row.document_id));
      if (projectId && documentId) db.prepare('INSERT OR IGNORE INTO project_documents(project_id,document_id,created_at) VALUES (?,?,?)')
        .run(projectId, documentId, String(row.created_at || timestamp));
    }

    for (const row of rows('patent_metadata')) {
      const documentId = documentIds.get(String(row.document_id));
      if (!documentId) continue;
      db.prepare(`INSERT OR REPLACE INTO patent_metadata
        (document_id,publication_number,application_number,registration_number,priority_date,filing_date,publication_date,
         jurisdiction,legal_status,assignees_json,inventors_json,family_id,citations_json,claims_text,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        documentId, sqlScalar(row.publication_number), sqlScalar(row.application_number), sqlScalar(row.registration_number),
        sqlScalar(row.priority_date), sqlScalar(row.filing_date), sqlScalar(row.publication_date), sqlScalar(row.jurisdiction),
        sqlScalar(row.legal_status), String(row.assignees_json || '[]'), String(row.inventors_json || '[]'),
        sqlScalar(row.family_id), String(row.citations_json || '[]'), String(row.claims_text || ''), timestamp,
      );
    }

    for (const row of rows('document_chunks')) {
      const documentId = documentIds.get(String(row.document_id));
      if (!documentId) continue;
      db.prepare(`INSERT OR IGNORE INTO document_chunks
        (id,document_id,ordinal,page,chunk_kind,section,claim,figure,text,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), documentId, Number(row.ordinal || 0), sqlScalar(row.page), String(row.chunk_kind || 'page'),
        sqlScalar(row.section), sqlScalar(row.claim), sqlScalar(row.figure), String(row.text || ''), String(row.created_at || timestamp),
      );
    }

    for (const row of rows('analysis_reports')) {
      const oldId = String(row.id || randomUUID());
      const documentId = documentIds.get(String(row.document_id));
      if (!documentId) continue;
      const id = randomUUID();
      reportIds.set(oldId, id);
      db.prepare(`INSERT INTO analysis_reports
        (id,document_id,project_id,profile_id,status,model,reasoning_effort,report_json,error,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, documentId, projectIds.get(String(row.project_id)) || null,
        profileIds.get(String(row.profile_id)) || String(row.profile_id || 'profile-general'),
        String(row.status || 'succeeded'), sqlScalar(row.model), sqlScalar(row.reasoning_effort),
        String(row.report_json || '{}'), sqlScalar(row.error), String(row.created_at || timestamp), timestamp,
      );
    }

    for (const row of rows('evidence_anchors')) {
      const reportId = reportIds.get(String(row.report_id));
      const documentId = documentIds.get(String(row.document_id));
      if (!reportId || !documentId) continue;
      db.prepare(`INSERT INTO evidence_anchors
        (id,report_id,document_id,level,page,section,claim,figure,quote,note) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), reportId, documentId, String(row.level || '불확실'), sqlScalar(row.page), sqlScalar(row.section),
        sqlScalar(row.claim), sqlScalar(row.figure), String(row.quote || ''), String(row.note || ''),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  for (const id of new Set(documentIds.values())) await rebuildDocumentFts(id);
}
