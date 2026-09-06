import { NextRequest, NextResponse } from 'next/server';

import { getMobileBridgeInfo, updateMobileBridgeSettings } from '@/lib/mobile-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getMobileBridgeInfo(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '모바일 연결 정보를 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { bridgeRoot?: unknown; autoPublishEnabled?: unknown };
    const hasBridgeRoot = Object.prototype.hasOwnProperty.call(body, 'bridgeRoot');
    const hasAutoPublishEnabled = Object.prototype.hasOwnProperty.call(body, 'autoPublishEnabled');
    if (!hasBridgeRoot && !hasAutoPublishEnabled) {
      return NextResponse.json({ error: '변경할 모바일 사본 설정이 필요합니다.' }, { status: 400 });
    }
    const bridgeRoot = body.bridgeRoot === null ? undefined : body.bridgeRoot;
    if (hasBridgeRoot && bridgeRoot !== undefined && typeof bridgeRoot !== 'string') {
      return NextResponse.json({ error: '연결 폴더 경로가 올바르지 않습니다.' }, { status: 400 });
    }
    if (hasAutoPublishEnabled && typeof body.autoPublishEnabled !== 'boolean') {
      return NextResponse.json({ error: '자동 발행 설정이 올바르지 않습니다.' }, { status: 400 });
    }
    await updateMobileBridgeSettings({
      ...(hasBridgeRoot ? { bridgeRoot: bridgeRoot as string | undefined } : {}),
      ...(hasAutoPublishEnabled ? { autoPublishEnabled: body.autoPublishEnabled as boolean } : {}),
    });
    return NextResponse.json(await getMobileBridgeInfo(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '연결 폴더를 저장하지 못했습니다.' }, { status: 500 });
  }
}
