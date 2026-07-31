import { createHash } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import JSZip from 'jszip';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { restoreSessions } from '@/lib/annot-sessions';
import { replacePaperMetadata } from '@/lib/paper-metadata';
import { replaceSidecarHighlights } from '@/lib/highlight-sidecar';
import { Highlight, PaperMetadata, Session } from '@/types';
import { APP_VERSION } from '@/lib/app-info';
import { exportResearchData, importResearchData } from '@/lib/research-db';

const BACKUP_VERSION = 2;
const BACKUP_RETENTION = 7;

interface BackupFileRecord {
  path: string;
  size: number;
  sha256: string;
}

interface BackupManifest {
  format: 'annot-portable-backup';
  version: number;
  createdAt: string;
  appVersion: string;
  includesPdfs: boolean;
  files: BackupFileRecord[];
}

function toZipPath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isExcluded(relativePath: string, includePdfs: boolean): boolean {
  const normalized = toZipPath(relativePath);
  if (/^\.annot\/pagedock\.sqlite(?:-wal|-shm)?$/i.test(normalized)) return true;
  if (normalized === '.annot/research-export.json') return true;
  if (normalized === '.annot/backups' || normalized.startsWith('.annot/backups/')) return true;
  if (normalized === '.annot/trash' || normalized.startsWith('.annot/trash/')) return true;
  if (normalized.toLowerCase().endsWith('.tmp')) return true;
  if (!includePdfs && normalized.toLowerCase().endsWith('.pdf')) return true;
  return false;
}

async function collectFiles(root: string, includePdfs: boolean): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (isExcluded(relativePath, includePdfs)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

export async function createPortableBackup(includePdfs = true): Promise<Buffer> {
  const root = getWorkspaceRoot();
  await fs.mkdir(root, { recursive: true });
  const zip = new JSZip();
  const files = await collectFiles(root, includePdfs);
  const records: BackupFileRecord[] = [];

  for (const relativePath of files) {
    const data = await fs.readFile(path.join(root, relativePath));
    const zipPath = toZipPath(relativePath);
    zip.file(`library/${zipPath}`, data);
    records.push({
      path: zipPath,
      size: data.byteLength,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }

  const researchData = Buffer.from(JSON.stringify(await exportResearchData(), null, 2), 'utf8');
  zip.file('library/.annot/research-export.json', researchData);
  records.push({
    path: '.annot/research-export.json',
    size: researchData.byteLength,
    sha256: createHash('sha256').update(researchData).digest('hex'),
  });

  const manifest: BackupManifest = {
    format: 'annot-portable-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    includesPdfs: includePdfs,
    files: records,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function hashFile(filePath: string): Promise<{ size: number; sha256: string }> {
  const digest = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    digest.update(chunk as Buffer);
  }
  const stats = await fs.stat(filePath);
  return { size: stats.size, sha256: digest.digest('hex') };
}

/**
 * Creates a ZIP stream without holding the PDFs or the final archive in RAM.
 * JSZip reads each file stream while generating the archive and emits the
 * result progressively when streamFiles is enabled.
 */
export async function createPortableBackupStream(includePdfs = true): Promise<NodeJS.ReadableStream> {
  const root = getWorkspaceRoot();
  await fs.mkdir(root, { recursive: true });
  const zip = new JSZip();
  const files = await collectFiles(root, includePdfs);
  const records: BackupFileRecord[] = [];

  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    const record = await hashFile(absolutePath);
    const zipPath = toZipPath(relativePath);
    zip.file(`library/${zipPath}`, createReadStream(absolutePath), {
      binary: true,
      createFolders: false,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    records.push({ path: zipPath, ...record });
  }

  const researchData = Buffer.from(JSON.stringify(await exportResearchData(), null, 2), 'utf8');
  zip.file('library/.annot/research-export.json', researchData);
  records.push({
    path: '.annot/research-export.json',
    size: researchData.byteLength,
    sha256: createHash('sha256').update(researchData).digest('hex'),
  });

  const manifest: BackupManifest = {
    format: 'annot-portable-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    includesPdfs: includePdfs,
    files: records,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

async function writePortableBackupFile(filePath: string, includePdfs: boolean): Promise<number> {
  const stream = await createPortableBackupStream(includePdfs);
  await pipeline(stream as Parameters<typeof pipeline>[0], createWriteStream(filePath));
  return (await fs.stat(filePath)).size;
}

function timestampForName(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-');
}

export async function createAutomaticBackup(): Promise<{ fileName: string; size: number }> {
  // Daily snapshots intentionally omit PDFs. OneDrive already carries the originals,
  // while keeping seven full PDF copies would multiply storage use dramatically.
  const backupDirectory = path.join(getWorkspaceRoot(), '.annot', 'backups');
  await fs.mkdir(backupDirectory, { recursive: true });
  const fileName = `pagedock-auto-${timestampForName()}.zip`;
  const size = await writePortableBackupFile(path.join(backupDirectory, fileName), false);

  const entries = (await fs.readdir(backupDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^(?:pagedock|annot)-auto-.*\.zip$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  await Promise.all(entries.slice(BACKUP_RETENTION).map((name) => (
    fs.rm(path.join(backupDirectory, name), { force: true })
  )));
  return { fileName, size };
}

function safeArchivePath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`안전하지 않은 백업 경로입니다: ${value}`);
  }
  return normalized;
}

const PYTHON_ZIP_EXTRACT_SCRIPT = String.raw`
import hashlib
import json
import os
import sys
import zipfile

archive_path, destination = sys.argv[1], sys.argv[2]
os.makedirs(destination, exist_ok=True)
base = os.path.abspath(destination)

with zipfile.ZipFile(archive_path, "r") as archive:
    manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    with open(os.path.join(destination, "manifest.json"), "w", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, ensure_ascii=False)

    for record in manifest.get("files", []):
        relative = str(record.get("path", "")).replace("\\", "/").lstrip("/")
        if not relative or relative.startswith("../") or "/../" in relative:
            raise ValueError("unsafe archive path")
        target = os.path.abspath(os.path.join(destination, "library", *relative.split("/")))
        if os.path.commonpath([base, target]) != base:
            raise ValueError("unsafe archive path")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        entry_name = "library/" + relative
        try:
            source = archive.open(entry_name, "r")
        except KeyError as error:
            raise ValueError("missing archive entry: " + relative) from error
        with source, open(target, "wb") as output:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if int(record.get("size", -1)) != size or str(record.get("sha256", "")) != digest.hexdigest():
            raise ValueError("backup file verification failed: " + relative)
`;

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `백업 압축을 풀지 못했습니다. (${code})`));
    });
  });
}

async function extractBackupArchive(archivePath: string, destination: string): Promise<void> {
  const configured = process.env.PAGEDOCK_PYTHON_BIN || process.env.ANNOT_PYTHON_BIN || process.env.PYTHON_BIN;
  const candidates = [
    ...(configured ? [configured] : []),
    ...(process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python']),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const args = /(^|[\\/])py(\.exe)?$/i.test(candidate)
        ? ['-3', '-c', PYTHON_ZIP_EXTRACT_SCRIPT, archivePath, destination]
        : ['-c', PYTHON_ZIP_EXTRACT_SCRIPT, archivePath, destination];
      await runProcess(candidate, args);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError instanceof Error ? lastError.message : '백업을 처리할 Python 실행 파일을 찾지 못했습니다.');
}

interface DeferredSidecar {
  pdfPath?: string;
  highlights?: Highlight[];
}

async function importExtractedBackup(extractionRoot: string, manifest: BackupManifest): Promise<{
  imported: number;
  renamed: number;
  skipped: number;
  skippedPaths: string[];
}> {
  if (manifest.format !== 'annot-portable-backup' || manifest.version > BACKUP_VERSION || !Array.isArray(manifest.files)) {
    throw new Error('지원하지 않는 PageDock 백업 형식입니다.');
  }

  const root = getWorkspaceRoot();
  await fs.mkdir(root, { recursive: true });
  const suffix = timestampForName();
  let imported = 0;
  let renamed = 0;
  let skipped = 0;
  const skippedPaths: string[] = [];
  const pdfPathMap = new Map<string, string>();
  const deferredMetadata: PaperMetadata[] = [];
  const deferredSidecars: DeferredSidecar[] = [];
  const deferredSessions: Array<{ folderPath: string; sessions: Session[] }> = [];
  let deferredResearchData: unknown;

  for (const record of manifest.files) {
    const relativePath = safeArchivePath(record.path);
    const sourcePath = path.join(extractionRoot, ...relativePath.split('/'));
    try {
      await fs.access(sourcePath);
    } catch {
      skipped += 1;
      skippedPaths.push(`${relativePath} (파일 없음)`);
      continue;
    }

    if (/^\.annot\/papers\/[^/]+\.json$/i.test(relativePath)) {
      try {
        deferredMetadata.push(JSON.parse(await fs.readFile(sourcePath, 'utf8')) as PaperMetadata);
        imported += 1;
      } catch {
        skipped += 1;
        skippedPaths.push(`${relativePath} (메타데이터 해석 실패)`);
      }
      continue;
    }

    if (relativePath === '.annot/research-export.json') {
      try {
        deferredResearchData = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as unknown;
        imported += 1;
      } catch {
        skipped += 1;
        skippedPaths.push(`${relativePath} (리서치 데이터 해석 실패)`);
      }
      continue;
    }

    if (/^\.annot\/annotations\/[^/]+\.json$/i.test(relativePath)) {
      try {
        deferredSidecars.push(JSON.parse(await fs.readFile(sourcePath, 'utf8')) as DeferredSidecar);
        imported += 1;
      } catch {
        skipped += 1;
        skippedPaths.push(`${relativePath} (주석 데이터 해석 실패)`);
      }
      continue;
    }

    if (/(^|\/)\.annot\/sessions\.json$/i.test(relativePath)) {
      try {
        const marker = '/.annot/sessions.json';
        const normalized = `/${relativePath}`;
        const folderPath = normalized.slice(1, normalized.lastIndexOf(marker));
        deferredSessions.push({
          folderPath,
          sessions: JSON.parse(await fs.readFile(sourcePath, 'utf8')) as Session[],
        });
        imported += 1;
      } catch {
        skipped += 1;
        skippedPaths.push(`${relativePath} (대화 데이터 해석 실패)`);
      }
      continue;
    }

    const directPath = path.join(root, ...relativePath.split('/'));
    const destination = await uniqueDestination(root, relativePath, suffix);
    if (destination !== directPath) renamed += 1;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await pipeline(createReadStream(sourcePath), createWriteStream(destination, { flags: 'wx' }));
    if (relativePath.toLowerCase().endsWith('.pdf')) {
      pdfPathMap.set(relativePath, toZipPath(path.relative(root, destination)));
    }
    imported += 1;
  }

  for (const metadata of deferredMetadata) {
    if (!metadata?.pdfPath) {
      skipped += 1;
      skippedPaths.push('메타데이터: PDF 경로 없음');
      continue;
    }
    const targetPath = pdfPathMap.get(metadata.pdfPath) || metadata.pdfPath;
    await replacePaperMetadata(targetPath, metadata);
  }

  for (const sidecar of deferredSidecars) {
    if (!sidecar.pdfPath || !Array.isArray(sidecar.highlights)) continue;
    const targetPath = pdfPathMap.get(sidecar.pdfPath) || sidecar.pdfPath;
    await replaceSidecarHighlights(targetPath, sidecar.highlights.map((highlight) => ({
      ...highlight,
      pdfPath: targetPath,
    })));
  }

  for (const deferred of deferredSessions) {
    const sessions = deferred.sessions.map((session) => {
      const mappedPdfPath = session.pdfPath ? pdfPathMap.get(session.pdfPath) : undefined;
      const nextPdfPath = mappedPdfPath || session.pdfPath;
      const nextFolderPath = nextPdfPath
        ? (path.posix.dirname(nextPdfPath) === '.' ? '' : path.posix.dirname(nextPdfPath))
        : deferred.folderPath;
      return {
        ...session,
        folderPath: nextFolderPath,
        pdfPath: nextPdfPath,
        providerSessionId: undefined,
      };
    });
    const groups = sessions.reduce<Map<string, Session[]>>((accumulator, session) => {
      const group = accumulator.get(session.folderPath) || [];
      group.push(session);
      accumulator.set(session.folderPath, group);
      return accumulator;
    }, new Map());
    for (const [folderPath, groupedSessions] of groups) {
      await restoreSessions(folderPath, groupedSessions);
    }
  }


  if (deferredResearchData) {
    await importResearchData(deferredResearchData, pdfPathMap);
  }

  return { imported, renamed, skipped, skippedPaths };
}

export async function importPortableBackupFile(archivePath: string): Promise<{
  imported: number;
  renamed: number;
  skipped: number;
  skippedPaths: string[];
}> {
  const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pagedock-backup-'));
  try {
    await extractBackupArchive(archivePath, extractionRoot);
    const manifest = JSON.parse(await fs.readFile(path.join(extractionRoot, 'manifest.json'), 'utf8')) as BackupManifest;
    return await importExtractedBackup(path.join(extractionRoot, 'library'), manifest);
  } finally {
    await fs.rm(extractionRoot, { recursive: true, force: true });
  }
}

async function uniqueDestination(root: string, relativePath: string, suffix: string): Promise<string> {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  try {
    await fs.access(absolutePath);
  } catch {
    return absolutePath;
  }
  const parsed = path.parse(absolutePath);
  let index = 0;
  while (true) {
    const number = index === 0 ? '' : `-${index}`;
    const candidate = path.join(parsed.dir, `${parsed.name}-가져옴-${suffix}${number}${parsed.ext}`);
    try {
      await fs.access(candidate);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

export async function importPortableBackup(data: Buffer): Promise<{
  imported: number;
  renamed: number;
  skipped: number;
}> {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('PageDock 백업 설명 파일이 없습니다.');
  const manifest = JSON.parse(await manifestFile.async('string')) as BackupManifest;
  if (manifest.format !== 'annot-portable-backup' || manifest.version > BACKUP_VERSION) {
    throw new Error('지원하지 않는 PageDock 백업 형식입니다.');
  }

  const root = getWorkspaceRoot();
  await fs.mkdir(root, { recursive: true });
  const suffix = timestampForName();
  let imported = 0;
  let renamed = 0;
  let skipped = 0;
  const pdfPathMap = new Map<string, string>();
  const deferredMetadata: PaperMetadata[] = [];
  const deferredSessions: Array<{ folderPath: string; sessions: Session[] }> = [];
  const deferredSidecars: DeferredSidecar[] = [];
  let deferredResearchData: unknown;

  for (const record of manifest.files) {
    const relativePath = safeArchivePath(record.path);
    const entry = zip.file(`library/${relativePath}`);
    if (!entry) {
      skipped += 1;
      continue;
    }
    const fileData = Buffer.from(await entry.async('uint8array'));
    const digest = createHash('sha256').update(fileData).digest('hex');
    if (digest !== record.sha256) {
      throw new Error(`백업 파일 검증에 실패했습니다: ${relativePath}`);
    }

    if (/^\.annot\/papers\/[^/]+\.json$/i.test(relativePath)) {
      try {
        deferredMetadata.push(JSON.parse(fileData.toString('utf8')) as PaperMetadata);
        imported += 1;
      } catch {
        skipped += 1;
      }
      continue;
    }

    if (relativePath === '.annot/research-export.json') {
      try {
        deferredResearchData = JSON.parse(fileData.toString('utf8')) as unknown;
        imported += 1;
      } catch {
        skipped += 1;
      }
      continue;
    }

    if (/^\.annot\/annotations\/[^/]+\.json$/i.test(relativePath)) {
      try {
        deferredSidecars.push(JSON.parse(fileData.toString('utf8')) as DeferredSidecar);
        imported += 1;
      } catch {
        skipped += 1;
      }
      continue;
    }

    if (/(^|\/)\.annot\/sessions\.json$/i.test(relativePath)) {
      try {
        const marker = '/.annot/sessions.json';
        const normalized = `/${relativePath}`;
        const folderPath = normalized.slice(1, normalized.lastIndexOf(marker));
        deferredSessions.push({
          folderPath,
          sessions: JSON.parse(fileData.toString('utf8')) as Session[],
        });
        imported += 1;
      } catch {
        skipped += 1;
      }
      continue;
    }

    const directPath = path.join(root, ...relativePath.split('/'));
    const destination = await uniqueDestination(root, relativePath, suffix);
    if (destination !== directPath) renamed += 1;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, fileData, { flag: 'wx' });
    if (relativePath.toLowerCase().endsWith('.pdf')) {
      pdfPathMap.set(relativePath, toZipPath(path.relative(root, destination)));
    }
    imported += 1;
  }

  for (const metadata of deferredMetadata) {
    if (!metadata?.pdfPath) {
      skipped += 1;
      continue;
    }
    const targetPath = pdfPathMap.get(metadata.pdfPath) || metadata.pdfPath;
    await replacePaperMetadata(targetPath, metadata);
  }

  for (const deferred of deferredSessions) {
    const sessions = deferred.sessions.map((session) => {
      const mappedPdfPath = session.pdfPath ? pdfPathMap.get(session.pdfPath) : undefined;
      const nextPdfPath = mappedPdfPath || session.pdfPath;
      const nextFolderPath = nextPdfPath
        ? (path.posix.dirname(nextPdfPath) === '.' ? '' : path.posix.dirname(nextPdfPath))
        : deferred.folderPath;
      return {
        ...session,
        folderPath: nextFolderPath,
        pdfPath: nextPdfPath,
        // Runtime session identifiers are machine-local. The visible chat
        // history remains portable and a fresh runtime session starts on send.
        providerSessionId: undefined,
      };
    });
    const groups = sessions.reduce<Map<string, Session[]>>((accumulator, session) => {
      const group = accumulator.get(session.folderPath) || [];
      group.push(session);
      accumulator.set(session.folderPath, group);
      return accumulator;
    }, new Map());
    for (const [folderPath, groupedSessions] of groups) {
      await restoreSessions(folderPath, groupedSessions);
    }
  }
  for (const sidecar of deferredSidecars) {
    if (!sidecar.pdfPath || !Array.isArray(sidecar.highlights)) continue;
    const targetPath = pdfPathMap.get(sidecar.pdfPath) || sidecar.pdfPath;
    await replaceSidecarHighlights(targetPath, sidecar.highlights.map((highlight) => ({
      ...highlight,
      pdfPath: targetPath,
    })));
  }
  if (deferredResearchData) await importResearchData(deferredResearchData, pdfPathMap);
  return { imported, renamed, skipped };
}

export async function getLibraryInfo() {
  const root = getWorkspaceRoot();
  const backupDirectory = path.join(root, '.annot', 'backups');
  let latestBackup: { fileName: string; size: number; modifiedAt: string } | null = null;
  try {
    const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
      .map(async (entry) => {
        const filePath = path.join(backupDirectory, entry.name);
        const stats = await fs.stat(filePath);
        return { fileName: entry.name, size: stats.size, modifiedAt: stats.mtime.toISOString() };
      }));
    latestBackup = files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0] || null;
  } catch {
    latestBackup = null;
  }
  return {
    root,
    oneDriveLikely: /(^|[\\/])OneDrive([\\/]|$)/i.test(root),
    backupRetention: BACKUP_RETENTION,
    libraryExists: true,
    latestBackup,
  };
}
