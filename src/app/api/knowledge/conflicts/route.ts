import { NextRequest, NextResponse } from 'next/server';

import { resolveKnowledgeConflict } from '@/lib/knowledge-store';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      conflictId?: string;
      status?: 'resolved' | 'dismissed';
      resolutionNote?: string;
    };
    if (!body.conflictId || !body.status) {
      return NextResponse.json({ error: 'conflictId와 status가 필요합니다.' }, { status: 400 });
    }
    return NextResponse.json({
      conflict: await resolveKnowledgeConflict(body.conflictId, body.status, body.resolutionNote),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '충돌 상태를 변경하지 못했습니다.',
    }, { status: 400 });
  }
}
