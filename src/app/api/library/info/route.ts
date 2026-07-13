import { NextRequest, NextResponse } from 'next/server';

import { getLibraryInfo } from '@/lib/library-backup';
import { writeConfiguredWorkspaceRoot } from '@/lib/library-config';

export async function GET() {
  return NextResponse.json(await getLibraryInfo());
}

export async function PATCH(req: NextRequest) {
  try {
    const { root } = await req.json() as { root?: string };
    if (!root?.trim()) return NextResponse.json({ error: '라이브러리 경로가 필요합니다.' }, { status: 400 });
    await writeConfiguredWorkspaceRoot(root);
    return NextResponse.json({ ok: true, restartRequired: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '라이브러리 경로를 저장하지 못했습니다.' }, { status: 500 });
  }
}
