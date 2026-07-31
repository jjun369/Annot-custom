import { NextResponse } from 'next/server';

import { getPdfEngineStatus, installPdfEngine } from '@/lib/pdf-engine-setup';

export async function GET() {
  return NextResponse.json(await getPdfEngineStatus());
}

export async function POST() {
  try {
    return NextResponse.json(await installPdfEngine());
  } catch (error) {
    return NextResponse.json({
      ready: false,
      platform: process.platform,
      canAutoInstall: false,
      setupUrl: process.platform === 'darwin' ? 'https://www.python.org/downloads/macos/' : undefined,
      error: error instanceof Error ? error.message : 'PDF 도구 준비에 실패했습니다.',
    }, { status: 500 });
  }
}
