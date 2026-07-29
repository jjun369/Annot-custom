import { NextResponse } from 'next/server';

import { APP_NAME, APP_VERSION } from '@/lib/app-info';

export async function GET() {
  return NextResponse.json({
    ok: true,
    name: APP_NAME,
    version: process.env.PAGEDOCK_APP_VERSION || APP_VERSION,
    desktop: process.env.PAGEDOCK_DESKTOP === '1',
  });
}
