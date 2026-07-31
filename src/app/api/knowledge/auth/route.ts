import { NextResponse } from 'next/server';

import { getCodexCliAuthStatus } from '@/lib/codex-exec';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const auth = await getCodexCliAuthStatus();
    return NextResponse.json({ installed: true, ...auth }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return NextResponse.json({
      installed: false,
      authenticated: false,
      error: error instanceof Error ? error.message : 'Codex 상태를 확인하지 못했습니다.',
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}
