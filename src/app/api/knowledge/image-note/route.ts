import { NextRequest, NextResponse } from 'next/server';

import { MAX_KNOWLEDGE_IMAGE_BYTES, storeKnowledgeImageAsset } from '@/lib/knowledge-image-assets';
import {
  captureKnowledgeNotes,
  normalizeKnowledgeProvenance,
  type KnowledgeProvenance,
} from '@/lib/knowledge-store';

function parseProvenance(value: FormDataEntryValue | null): KnowledgeProvenance | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return normalizeKnowledgeProvenance(JSON.parse(value));
  } catch {
    return undefined;
  }
}

const MAX_IMAGE_NOTE_MULTIPART_BYTES = MAX_KNOWLEDGE_IMAGE_BYTES + 256 * 1024;

async function readBoundedMultipartForm(request: NextRequest): Promise<FormData> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 1
      || contentLength > MAX_IMAGE_NOTE_MULTIPART_BYTES) {
      throw new RangeError('이미지 메모 요청은 10MB 이미지와 짧은 설명만 포함할 수 있습니다.');
    }
  }
  if (!request.body) throw new Error('이미지 메모 요청 내용이 비어 있습니다.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_NOTE_MULTIPART_BYTES) {
        throw new RangeError('이미지 메모 요청은 10MB 이미지와 짧은 설명만 포함할 수 있습니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  return new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      return NextResponse.json({ error: '이미지 메모 요청 형식이 올바르지 않습니다.' }, { status: 415 });
    }
    const form = await readBoundedMultipartForm(request);
    const image = form.get('image');
    const text = typeof form.get('text') === 'string' ? String(form.get('text')) : '';
    if (!(image instanceof File)) throw new Error('추가할 이미지 파일을 선택해 주세요.');
    if (!text.trim()) throw new Error('나중에 그림의 뜻을 알 수 있도록 짧은 설명을 함께 적어 주세요.');
    if (text.length > 100_000) throw new Error('메모 내용은 100,000자 이하로 적어 주세요.');
    if (image.size < 1 || image.size > MAX_KNOWLEDGE_IMAGE_BYTES) {
      throw new Error('이미지 메모 하나는 10MB 이하로 추가해 주세요.');
    }

    const attachment = await storeKnowledgeImageAsset(new Uint8Array(await image.arrayBuffer()), image.type);
    const sourceName = image.name.trim() ? `이미지 메모 · ${image.name.trim().slice(0, 180)}` : '이미지 메모';
    const result = await captureKnowledgeNotes([{
      text,
      sourceName,
      provenance: parseProvenance(form.get('provenance')),
      attachments: [attachment],
    }]);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '이미지 메모를 저장하지 못했습니다.',
    }, { status: error instanceof RangeError ? 413 : 400 });
  }
}
