import { NextRequest, NextResponse } from 'next/server';

import { exportKnowledgeMarkdown } from '@/lib/knowledge-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { destination?: string };
    if (!body.destination?.trim()) return NextResponse.json({ error: 'Markdown 내보내기 폴더를 선택하세요.' }, { status: 400 });
    return NextResponse.json(await exportKnowledgeMarkdown(body.destination));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Markdown을 내보내지 못했습니다.' }, { status: 400 });
  }
}
