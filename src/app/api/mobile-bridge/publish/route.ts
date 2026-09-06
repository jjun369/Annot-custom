import { NextRequest, NextResponse } from 'next/server';

import { MobileBridgeConflictError, publishMobileBridge } from '@/lib/mobile-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { preserveConflict?: unknown };
    const preserveConflict = body.preserveConflict === true;
    return NextResponse.json(await publishMobileBridge({ preserveConflict }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '모바일 사본을 만들지 못했습니다.';
    return NextResponse.json({
      error: message,
      conflict: error instanceof MobileBridgeConflictError,
    }, { status: error instanceof MobileBridgeConflictError ? 409 : 500 });
  }
}
