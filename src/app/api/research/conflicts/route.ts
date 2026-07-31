import { NextRequest, NextResponse } from 'next/server';

import { listDocumentConflicts, resolveDocumentConflict } from '@/lib/research-db';

export async function GET() {
  return NextResponse.json({ conflicts: await listDocumentConflicts() });
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as { id?: string };
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
    await resolveDocumentConflict(body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '복구 확인을 완료하지 못했습니다.' }, { status: 500 });
  }
}
