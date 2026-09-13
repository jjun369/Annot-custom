import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import type { KnowledgeImageAttachment } from '@/lib/knowledge-store';

export const MAX_KNOWLEDGE_IMAGE_BYTES = 10 * 1024 * 1024;

type KnowledgeImageMime = KnowledgeImageAttachment['mime'];

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function mimeForBytes(bytes: Uint8Array): KnowledgeImageMime | null {
  if (isPng(bytes)) return 'image/png';
  if (isJpeg(bytes)) return 'image/jpeg';
  return null;
}

function extensionForMime(mime: KnowledgeImageMime): 'png' | 'jpg' {
  return mime === 'image/png' ? 'png' : 'jpg';
}

function isHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function assetPath(attachment: Pick<KnowledgeImageAttachment, 'sha256' | 'mime'>): string {
  if (!isHash(attachment.sha256)) throw new Error('이미지 자산 식별자가 올바르지 않습니다.');
  return path.join(
    getWorkspaceRoot(),
    '.annot',
    'knowledge-assets',
    attachment.sha256.slice(0, 2),
    `${attachment.sha256}.${extensionForMime(attachment.mime)}`,
  );
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function verifyStoredImage(destination: string, attachment: KnowledgeImageAttachment): Promise<Uint8Array> {
  const bytes = await fs.readFile(destination);
  if (bytes.length !== attachment.byteLength
    || hashBytes(bytes) !== attachment.sha256
    || mimeForBytes(bytes) !== attachment.mime) {
    throw new Error('저장된 이미지 메모의 무결성을 확인하지 못했습니다. 원본을 다시 추가해 주세요.');
  }
  return bytes;
}

/**
 * Stores a deliberate note image as a local, content-addressed asset. The
 * browser MIME label is not trusted: only PNG and JPEG magic bytes are kept.
 */
export async function storeKnowledgeImageAsset(
  bytes: Uint8Array,
  declaredMime?: string,
): Promise<KnowledgeImageAttachment> {
  if (!bytes.length) throw new Error('비어 있는 이미지 파일은 추가할 수 없습니다.');
  if (bytes.length > MAX_KNOWLEDGE_IMAGE_BYTES) {
    throw new Error('이미지 메모 하나는 10MB 이하로 추가해 주세요.');
  }
  const mime = mimeForBytes(bytes);
  if (!mime) throw new Error('현재는 PNG 또는 JPEG 이미지만 메모에 추가할 수 있습니다.');
  if (declaredMime && declaredMime !== mime && declaredMime !== 'image/jpg') {
    throw new Error('선택한 파일의 이미지 형식이 브라우저 정보와 일치하지 않습니다.');
  }
  const sha256 = hashBytes(bytes);
  const attachment: KnowledgeImageAttachment = { id: sha256, sha256, mime, byteLength: bytes.length };
  const destination = assetPath(attachment);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await verifyStoredImage(destination, attachment);
    return attachment;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporary = `${destination}.${randomUUID()}.partial`;
  try {
    const handle = await fs.open(temporary, 'w');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await verifyStoredImage(temporary, attachment);
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      // Two captures can finish the same content hash at once. Windows may
      // reject the second rename; an already-complete, identical blob is the
      // desired deduplicated result, never a reason to overwrite it.
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
    await verifyStoredImage(destination, attachment);
    return attachment;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function readKnowledgeImageAsset(attachment: KnowledgeImageAttachment): Promise<Uint8Array> {
  return verifyStoredImage(assetPath(attachment), attachment);
}
