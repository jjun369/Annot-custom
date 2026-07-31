import { NextRequest, NextResponse } from 'next/server';

import { indexResearchDocument } from '@/lib/research-index';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { documentId?: string };
    if (!body.documentId) return NextResponse.json({ error: '문서 ID가 필요합니다.' }, { status: 400 });
    return NextResponse.json(await indexResearchDocument(body.documentId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '문서 색인에 실패했습니다.' }, { status: 500 });
  }
}
