import { NextRequest, NextResponse } from 'next/server';

import {
  captureKnowledgeNotes,
  getKnowledgeSnapshot,
  getKnowledgeStoreInfo,
  normalizeKnowledgeProvenance,
  normalizeKnowledgeSourceAnchors,
} from '@/lib/knowledge-store';

const MAX_CAPTURE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CAPTURE_NOTES = 100;
const MAX_CAPTURE_TOTAL_CHARS = 1_000_000;
const MAX_CAPTURE_SOURCE_NAME_CHARS = 300;

export async function GET() {
  const [snapshot, storeInfo] = await Promise.all([getKnowledgeSnapshot(), getKnowledgeStoreInfo()]);
  return NextResponse.json({ ...snapshot, storeInfo });
}

export async function POST(request: NextRequest) {
  try {
    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_CAPTURE_BODY_BYTES) {
        return NextResponse.json({ error: '메모 요청은 2MB 이하로 보내 주세요.' }, { status: 413 });
      }
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_CAPTURE_BODY_BYTES) {
      return NextResponse.json({ error: '메모 요청은 2MB 이하로 보내 주세요.' }, { status: 413 });
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
      text?: string;
      sourceName?: string;
      provenance?: unknown;
      sourceAnchors?: unknown;
      notes?: Array<{ text?: string; sourceName?: string; provenance?: unknown; sourceAnchors?: unknown }>;
    };
    if (body.notes && (!Array.isArray(body.notes) || body.notes.length > MAX_CAPTURE_NOTES)) {
      throw new RangeError(`한 번에 메모 ${MAX_CAPTURE_NOTES}개 이하만 수집할 수 있습니다.`);
    }
    const inputs = body.notes?.map((note) => ({
      text: note.text ?? '',
      sourceName: note.sourceName?.slice(0, MAX_CAPTURE_SOURCE_NAME_CHARS),
      provenance: normalizeKnowledgeProvenance(note.provenance),
      sourceAnchors: normalizeKnowledgeSourceAnchors(note.sourceAnchors),
    }))
      ?? [{
        text: body.text ?? '',
        sourceName: body.sourceName?.slice(0, MAX_CAPTURE_SOURCE_NAME_CHARS),
        provenance: normalizeKnowledgeProvenance(body.provenance),
        sourceAnchors: normalizeKnowledgeSourceAnchors(body.sourceAnchors),
      }];
    if (inputs.reduce((total, input) => total + input.text.length, 0) > MAX_CAPTURE_TOTAL_CHARS) {
      throw new RangeError(`한 번에 수집하는 메모 본문은 합계 ${MAX_CAPTURE_TOTAL_CHARS.toLocaleString('ko-KR')}자 이하여야 합니다.`);
    }
    return NextResponse.json(await captureKnowledgeNotes(inputs), { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '메모를 저장하지 못했습니다.',
    }, { status: error instanceof RangeError ? 413 : 400 });
  }
}
