import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { inflateSync } from 'zlib';

import { getWorkspaceRoot } from '@/lib/annot-sessions';
import type { KnowledgeImageAttachment } from '@/lib/knowledge-store';

export const MAX_KNOWLEDGE_IMAGE_BYTES = 10 * 1024 * 1024;

type KnowledgeImageMime = KnowledgeImageAttachment['mime'];

function hasPngSignature(bytes: Uint8Array): boolean {
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

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isValidPng(bytes: Uint8Array): boolean {
  if (!hasPngSignature(bytes)) return false;
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  const compressed: Uint8Array[] = [];
  try {
    while (offset + 12 <= bytes.length) {
      const length = readUint32(bytes, offset);
      if (length > MAX_KNOWLEDGE_IMAGE_BYTES || offset + 12 + length > bytes.length) return false;
      const typeStart = offset + 4;
      const dataStart = typeStart + 4;
      const crcOffset = dataStart + length;
      const type = String.fromCharCode(...bytes.subarray(typeStart, dataStart));
      if (crc32(bytes.subarray(typeStart, crcOffset)) !== readUint32(bytes, crcOffset)) return false;
      if (!sawHeader) {
        if (type !== 'IHDR' || length !== 13) return false;
        const width = readUint32(bytes, dataStart);
        const height = readUint32(bytes, dataStart + 4);
        if (width < 1 || height < 1 || width > 100_000 || height > 100_000) return false;
        sawHeader = true;
      } else if (type === 'IHDR') return false;
      if (type === 'IDAT') {
        sawData = true;
        compressed.push(bytes.slice(dataStart, crcOffset));
      }
      offset = crcOffset + 4;
      if (type === 'IEND') {
        if (length !== 0 || !sawData || offset !== bytes.length) return false;
        inflateSync(Buffer.concat(compressed), { maxOutputLength: 512 * 1024 * 1024 });
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function isValidJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return sawFrame && sawScan && offset === bytes.length;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) return false;
    if (offset + 2 > bytes.length) return false;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) sawFrame = true;
    offset += length;
    if (marker !== 0xda) continue;
    sawScan = true;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      let next = offset + 1;
      while (next < bytes.length && bytes[next] === 0xff) next += 1;
      if (next >= bytes.length) return false;
      const scanMarker = bytes[next];
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset = next + 1;
        continue;
      }
      offset = next - 1;
      break;
    }
  }
  return false;
}

function validatedMime(bytes: Uint8Array): KnowledgeImageMime | null {
  if (isValidPng(bytes)) return 'image/png';
  if (isValidJpeg(bytes)) return 'image/jpeg';
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
    || validatedMime(bytes) !== attachment.mime) {
    throw new Error('저장된 이미지 메모의 무결성을 확인하지 못했습니다. 원본을 다시 추가해 주세요.');
  }
  return bytes;
}

/**
 * Stores a deliberate note image as a local, content-addressed asset. The
 * browser MIME label is not trusted: the full PNG/JPEG structure and encoded
 * payload must validate before the bytes are published.
 */
export async function storeKnowledgeImageAsset(
  bytes: Uint8Array,
  declaredMime?: string,
): Promise<KnowledgeImageAttachment> {
  if (!bytes.length) throw new Error('비어 있는 이미지 파일은 추가할 수 없습니다.');
  if (bytes.length > MAX_KNOWLEDGE_IMAGE_BYTES) {
    throw new Error('이미지 메모 하나는 10MB 이하로 추가해 주세요.');
  }
  const mime = validatedMime(bytes);
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
      // Publish with an atomic no-overwrite operation. A concurrent writer of
      // the same hash wins safely; unrelated EPERM/ENOTEMPTY failures must not
      // be mistaken for successful deduplication.
      await fs.link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
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
