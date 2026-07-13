import { NextRequest, NextResponse } from 'next/server';

import { listTrash, purgeTrashItem, restoreTrashItem } from '@/lib/library-trash';

export async function GET() {
  return NextResponse.json(await listTrash());
}

export async function PATCH(req: NextRequest) {
  try {
    const { id } = await req.json() as { id?: string };
    if (!id) return NextResponse.json({ error: '휴지통 항목 ID가 필요합니다.' }, { status: 400 });
    return NextResponse.json(await restoreTrashItem(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '복원하지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: '휴지통 항목 ID가 필요합니다.' }, { status: 400 });
    await purgeTrashItem(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '완전히 삭제하지 못했습니다.' }, { status: 500 });
  }
}
