import { NextRequest, NextResponse } from 'next/server';

import { getBackupReplicaInfo, updateBackupReplicaSettings } from '@/lib/backup-replica';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getBackupReplicaInfo(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '보호 사본 설정을 읽지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { targetRoot?: unknown; automaticEnabled?: unknown };
    const hasTargetRoot = Object.prototype.hasOwnProperty.call(body, 'targetRoot');
    const hasAutomaticEnabled = Object.prototype.hasOwnProperty.call(body, 'automaticEnabled');
    if (!hasTargetRoot && !hasAutomaticEnabled) {
      return NextResponse.json({ error: '변경할 보호 사본 설정이 필요합니다.' }, { status: 400 });
    }
    const targetRoot = body.targetRoot === null ? undefined : body.targetRoot;
    if (hasTargetRoot && targetRoot !== undefined && typeof targetRoot !== 'string') {
      return NextResponse.json({ error: '보호 사본 폴더 경로가 올바르지 않습니다.' }, { status: 400 });
    }
    if (hasAutomaticEnabled && typeof body.automaticEnabled !== 'boolean') {
      return NextResponse.json({ error: '자동 보호 사본 설정이 올바르지 않습니다.' }, { status: 400 });
    }
    await updateBackupReplicaSettings({
      ...(hasTargetRoot ? { targetRoot: targetRoot as string | undefined } : {}),
      ...(hasAutomaticEnabled ? { automaticEnabled: body.automaticEnabled as boolean } : {}),
    });
    return NextResponse.json(await getBackupReplicaInfo(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '보호 사본 설정을 저장하지 못했습니다.' }, { status: 500 });
  }
}
