import { NextRequest, NextResponse } from 'next/server';

import { readKnowledgeImageAsset } from '@/lib/knowledge-image-assets';
import { getKnowledgeNote } from '@/lib/knowledge-store';

export async function GET(request: NextRequest) {
  const noteId = request.nextUrl.searchParams.get('noteId')?.trim() || '';
  const assetId = request.nextUrl.searchParams.get('assetId')?.trim().toLowerCase() || '';
  if (!noteId || !/^[a-f0-9]{64}$/.test(assetId)) {
    return NextResponse.json({ error: '이미지 메모 위치가 올바르지 않습니다.' }, { status: 400 });
  }
  const note = await getKnowledgeNote(noteId);
  const attachment = note?.attachments?.find((item) => item.id === assetId);
  if (!attachment) return NextResponse.json({ error: '이미지 메모를 찾을 수 없습니다.' }, { status: 404 });
  try {
    const image = await readKnowledgeImageAsset(attachment);
    const body = new ArrayBuffer(image.byteLength);
    new Uint8Array(body).set(image);
    return new NextResponse(body, {
      headers: {
        'Content-Type': attachment.mime,
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: '이미지 메모 파일을 확인하지 못했습니다. 원본을 다시 추가해 주세요.' }, { status: 409 });
  }
}
