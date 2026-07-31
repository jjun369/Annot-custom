import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

import {
  getWorkspaceRoot,
  movePdfSessions,
  resolveFolderPath,
  rewriteSessionsForFolderMove,
} from '@/lib/annot-sessions';
import { TreeNode } from '@/types';
import {
  movePaperMetadata,
  rewritePaperMetadataForFolderMove,
} from '@/lib/paper-metadata';
import { moveFolderToTrash, movePdfToTrash } from '@/lib/library-trash';
import { moveSidecarHighlights } from '@/lib/highlight-sidecar';
import {
  ensureDocumentForPath,
  getDocumentByPath,
  recordDocumentPathChange,
  syncWorkspaceDocuments,
} from '@/lib/research-db';

function isVisibleEntry(name: string): boolean {
  return !name.startsWith('.');
}

function isPdfFile(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

function sanitizeSegment(name: string, kind: 'folder' | 'file'): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(`${kind === 'folder' ? 'Folder' : 'File'} name is required`);
  }

  const base = path.basename(trimmed);
  if (base !== trimmed || base === '.' || base === '..') {
    throw new Error(`Invalid ${kind} name`);
  }

  if (/[<>:"/\\|?*\u0000-\u001F]/.test(base) || /[. ]$/.test(base)) {
    throw new Error('Windows에서 사용할 수 없는 문자 또는 끝의 점·공백이 포함되어 있습니다.');
  }
  const deviceName = base.replace(/\.[^.]*$/, '').toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceName)) {
    throw new Error('Windows 예약 이름은 파일이나 폴더 이름으로 사용할 수 없습니다.');
  }

  return base;
}

async function ensureWorkspaceRoot(): Promise<void> {
  await fs.mkdir(getWorkspaceRoot(), { recursive: true });
}

async function ensureUniqueFilePath(dirPath: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName);
  let attempt = 0;

  while (true) {
    const candidateName = attempt === 0
      ? fileName
      : `${parsed.name}-${attempt}${parsed.ext}`;
    const candidatePath = path.join(dirPath, candidateName);

    try {
      await fs.access(candidatePath);
      attempt += 1;
    } catch {
      return candidatePath;
    }
  }
}

async function findDuplicatePdf(buffer: Buffer): Promise<string | null> {
  const root = getWorkspaceRoot();
  const expectedHash = createHash('sha256').update(buffer).digest('hex');
  async function walk(directory: string): Promise<string | null> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const match = await walk(absolutePath);
        if (match) return match;
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
      const stats = await fs.stat(absolutePath);
      if (stats.size !== buffer.byteLength) continue;
      const digest = createHash('sha256').update(await fs.readFile(absolutePath)).digest('hex');
      if (digest === expectedHash) {
        return path.relative(root, absolutePath).split(path.sep).join('/');
      }
    }
    return null;
  }
  return await walk(root);
}

async function ensureDirectory(relativePath: string): Promise<void> {
  const absolutePath = relativePath ? resolveFolderPath(relativePath) : getWorkspaceRoot();
  const stats = await fs.stat(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error('Target folder does not exist');
  }
}

async function ensurePathDoesNotExist(absolutePath: string, errorMessage: string): Promise<void> {
  try {
    await fs.access(absolutePath);
    throw new Error(errorMessage);
  } catch (error) {
    if (error instanceof Error && error.message === errorMessage) {
      throw error;
    }
  }
}

async function buildNode(relativePath: string): Promise<TreeNode> {
  const absolutePath = relativePath ? resolveFolderPath(relativePath) : getWorkspaceRoot();
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });

  const folderChildren = entries
    .filter((entry) => entry.isDirectory() && isVisibleEntry(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => {
      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      return buildNode(childPath);
    });

  const pdfChildren = entries
    .filter((entry) => entry.isFile() && isVisibleEntry(entry.name) && isPdfFile(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => {
      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const document = await getDocumentByPath(childPath);
      return {
        id: document ? `document:${document.id}` : `pdf:${childPath}`,
        documentId: document?.id,
        name: entry.name,
        type: 'pdf' as const,
        path: childPath,
      };
    });

  return {
    id: relativePath ? `folder:${relativePath}` : 'root',
    name: relativePath ? path.basename(relativePath) : path.basename(getWorkspaceRoot()),
    type: 'folder',
    path: relativePath,
    children: [...await Promise.all(folderChildren), ...await Promise.all(pdfChildren)],
  };
}

export async function getWorkspaceTree(): Promise<TreeNode> {
  await ensureWorkspaceRoot();
  await syncWorkspaceDocuments();
  return buildNode('');
}

export async function createWorkspaceFolder(parentPath: string, folderName: string): Promise<TreeNode> {
  await ensureWorkspaceRoot();
  const safeName = sanitizeSegment(folderName, 'folder');
  const absoluteParent = parentPath ? resolveFolderPath(parentPath) : getWorkspaceRoot();
  const absolutePath = path.join(absoluteParent, safeName);

  await fs.mkdir(absoluteParent, { recursive: true });

  const parentStats = await fs.stat(absoluteParent);
  if (!parentStats.isDirectory()) {
    throw new Error('Target folder does not exist');
  }

  await ensurePathDoesNotExist(absolutePath, 'A folder with that name already exists');
  await fs.mkdir(absolutePath, { recursive: false });

  const relativePath = parentPath ? `${parentPath}/${safeName}` : safeName;
  return {
    id: `folder:${relativePath}`,
    name: safeName,
    type: 'folder',
    path: relativePath,
    children: [],
  };
}

export async function saveUploadedPdf(folderPath: string, file: File): Promise<TreeNode & { duplicate?: boolean }> {
  await ensureWorkspaceRoot();

  const originalName = sanitizeSegment(file.name, 'file');
  const fileName = originalName.toLowerCase().endsWith('.pdf') ? originalName : `${originalName}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const duplicatePath = await findDuplicatePdf(buffer);
  if (duplicatePath) {
    const document = await ensureDocumentForPath(duplicatePath);
    return {
      id: `document:${document.id}`,
      documentId: document.id,
      name: path.posix.basename(duplicatePath),
      type: 'pdf',
      path: duplicatePath,
      duplicate: true,
    };
  }

  const absoluteFolder = folderPath ? resolveFolderPath(folderPath) : getWorkspaceRoot();

  await fs.mkdir(absoluteFolder, { recursive: true });

  const absolutePath = await ensureUniqueFilePath(absoluteFolder, fileName);
  await fs.writeFile(absolutePath, buffer, { flag: 'wx' });

  const storedName = path.basename(absolutePath);
  const relativePath = folderPath ? `${folderPath}/${storedName}` : storedName;
  const document = await ensureDocumentForPath(relativePath);
  return {
    id: `document:${document.id}`,
    documentId: document.id,
    name: storedName,
    type: 'pdf',
    path: relativePath,
  };
}

export async function renameWorkspaceFolder(folderPath: string, nextName: string): Promise<TreeNode> {
  await ensureWorkspaceRoot();

  const normalizedFolderPath = folderPath.trim();
  if (!normalizedFolderPath) {
    throw new Error('Root folder cannot be renamed');
  }

  const safeName = sanitizeSegment(nextName, 'folder');
  const parentPath = path.posix.dirname(normalizedFolderPath) === '.'
    ? ''
    : path.posix.dirname(normalizedFolderPath);
  const nextRelativePath = parentPath ? `${parentPath}/${safeName}` : safeName;
  const sourceAbsolutePath = resolveFolderPath(normalizedFolderPath);
  const targetAbsolutePath = resolveFolderPath(nextRelativePath);

  await ensurePathDoesNotExist(targetAbsolutePath, 'A folder with that name already exists');
  await fs.rename(sourceAbsolutePath, targetAbsolutePath);
  await rewritePaperMetadataForFolderMove(normalizedFolderPath, nextRelativePath);
  await rewriteSessionsForFolderMove(normalizedFolderPath, nextRelativePath);
  await syncWorkspaceDocuments();

  return {
    id: `folder:${nextRelativePath}`,
    name: safeName,
    type: 'folder',
    path: nextRelativePath,
    children: [],
  };
}

export async function deleteWorkspaceFolder(folderPath: string): Promise<void> {
  await ensureWorkspaceRoot();

  const normalizedFolderPath = folderPath.trim();
  if (!normalizedFolderPath) {
    throw new Error('Root folder cannot be deleted');
  }

  await moveFolderToTrash(normalizedFolderPath);
}

export async function renameWorkspacePdf(pdfPath: string, nextName: string): Promise<TreeNode> {
  await ensureWorkspaceRoot();

  const normalizedPdfPath = pdfPath.trim();
  const safeName = sanitizeSegment(nextName, 'file');
  const fileName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  const parentPath = path.posix.dirname(normalizedPdfPath) === '.'
    ? ''
    : path.posix.dirname(normalizedPdfPath);
  const nextRelativePath = parentPath ? `${parentPath}/${fileName}` : fileName;
  const sourceAbsolutePath = resolveFolderPath(normalizedPdfPath);
  const targetAbsolutePath = resolveFolderPath(nextRelativePath);
  const document = await ensureDocumentForPath(normalizedPdfPath);

  await ensurePathDoesNotExist(targetAbsolutePath, 'A PDF with that name already exists');
  await fs.rename(sourceAbsolutePath, targetAbsolutePath);
  let documentPathChanged = false;
  try {
    await movePaperMetadata(normalizedPdfPath, nextRelativePath);
    await movePdfSessions(parentPath, parentPath, normalizedPdfPath, nextRelativePath);
    await recordDocumentPathChange(normalizedPdfPath, nextRelativePath);
    documentPathChanged = true;
    await moveSidecarHighlights(normalizedPdfPath, nextRelativePath);
  } catch (error) {
    await fs.rename(targetAbsolutePath, sourceAbsolutePath).catch(() => undefined);
    if (documentPathChanged) {
      await recordDocumentPathChange(nextRelativePath, normalizedPdfPath).catch(() => undefined);
    }
    await moveSidecarHighlights(nextRelativePath, normalizedPdfPath).catch(() => undefined);
    await movePaperMetadata(nextRelativePath, normalizedPdfPath).catch(() => undefined);
    await movePdfSessions(parentPath, parentPath, nextRelativePath, normalizedPdfPath).catch(() => undefined);
    throw error;
  }

  return {
    id: `document:${document.id}`,
    documentId: document.id,
    name: fileName,
    type: 'pdf',
    path: nextRelativePath,
  };
}

export async function deleteWorkspacePdf(pdfPath: string): Promise<void> {
  await ensureWorkspaceRoot();

  const normalizedPdfPath = pdfPath.trim();
  await movePdfToTrash(normalizedPdfPath);
}

export async function moveWorkspacePdf(pdfPath: string, targetFolderPath: string): Promise<TreeNode> {
  await ensureWorkspaceRoot();

  const normalizedPdfPath = pdfPath.trim();
  const normalizedTargetFolderPath = targetFolderPath.trim();
  await ensureDirectory(normalizedTargetFolderPath);

  const fileName = path.posix.basename(normalizedPdfPath);
  const nextRelativePath = normalizedTargetFolderPath
    ? `${normalizedTargetFolderPath}/${fileName}`
    : fileName;
  const sourceAbsolutePath = resolveFolderPath(normalizedPdfPath);
  const targetAbsolutePath = resolveFolderPath(nextRelativePath);
  const document = await ensureDocumentForPath(normalizedPdfPath);

  if (normalizedPdfPath === nextRelativePath) {
    return {
      id: `document:${document.id}`,
      documentId: document.id,
      name: fileName,
      type: 'pdf',
      path: nextRelativePath,
    };
  }

  await ensurePathDoesNotExist(targetAbsolutePath, 'A PDF with that name already exists in the target folder');
  await fs.rename(sourceAbsolutePath, targetAbsolutePath);
  const sourceFolderPath = path.posix.dirname(normalizedPdfPath) === '.'
    ? ''
    : path.posix.dirname(normalizedPdfPath);
  let documentPathChanged = false;
  try {
    await movePaperMetadata(normalizedPdfPath, nextRelativePath);
    await movePdfSessions(sourceFolderPath, normalizedTargetFolderPath, normalizedPdfPath, nextRelativePath);
    await recordDocumentPathChange(normalizedPdfPath, nextRelativePath);
    documentPathChanged = true;
    await moveSidecarHighlights(normalizedPdfPath, nextRelativePath);
  } catch (error) {
    await fs.rename(targetAbsolutePath, sourceAbsolutePath).catch(() => undefined);
    if (documentPathChanged) {
      await recordDocumentPathChange(nextRelativePath, normalizedPdfPath).catch(() => undefined);
    }
    await moveSidecarHighlights(nextRelativePath, normalizedPdfPath).catch(() => undefined);
    await movePaperMetadata(nextRelativePath, normalizedPdfPath).catch(() => undefined);
    await movePdfSessions(normalizedTargetFolderPath, sourceFolderPath, nextRelativePath, normalizedPdfPath).catch(() => undefined);
    throw error;
  }

  return {
    id: `document:${document.id}`,
    documentId: document.id,
    name: fileName,
    type: 'pdf',
    path: nextRelativePath,
  };
}
