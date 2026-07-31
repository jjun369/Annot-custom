import { NextRequest, NextResponse } from 'next/server';

import { captureKnowledgeNotes, getKnowledgeSnapshot, getKnowledgeStoreInfo } from '@/lib/knowledge-store';

export async function GET() {
  const [snapshot, storeInfo] = await Promise.all([getKnowledgeSnapshot(), getKnowledgeStoreInfo()]);
  return NextResponse.json({ ...snapshot, storeInfo });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      text?: string;
      sourceName?: string;
      notes?: Array<{ text?: string; sourceName?: string }>;
    };
    const inputs = body.notes?.map((note) => ({ text: note.text ?? '', sourceName: note.sourceName }))
      ?? [{ text: body.text ?? '', sourceName: body.sourceName }];
    return NextResponse.json(await captureKnowledgeNotes(inputs), { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '메모를 저장하지 못했습니다.',
    }, { status: 400 });
  }
}
