import { NextRequest, NextResponse } from 'next/server';

import { storeKnowledgeImageAsset } from '@/lib/knowledge-image-assets';
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

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const image = form.get('image');
    const text = typeof form.get('text') === 'string' ? String(form.get('text')) : '';
    if (!(image instanceof File)) throw new Error('추가할 이미지 파일을 선택해 주세요.');
    if (!text.trim()) throw new Error('나중에 그림의 뜻을 알 수 있도록 짧은 설명을 함께 적어 주세요.');

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
    }, { status: 400 });
  }
}
