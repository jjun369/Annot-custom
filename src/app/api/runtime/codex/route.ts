import { NextRequest, NextResponse } from 'next/server';

import { getCodexSetupStatus, installOrUpdateCodex, loginCodex } from '@/lib/codex-setup';

export async function GET() {
  return NextResponse.json(await getCodexSetupStatus());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: 'install' | 'update' | 'login' };
    if (body.action === 'install' || body.action === 'update') {
      return NextResponse.json(await installOrUpdateCodex());
    }
    if (body.action === 'login') {
      return NextResponse.json(await loginCodex());
    }
    return NextResponse.json({ error: '지원하지 않는 Codex 작업입니다.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Codex 준비에 실패했습니다.',
    }, { status: 500 });
  }
}
