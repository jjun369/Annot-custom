import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';

import { createAutomaticBackup, createPortableBackupStream } from '@/lib/library-backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const includePdfs = req.nextUrl.searchParams.get('includePdfs') !== 'false';
    const data = await createPortableBackupStream(includePdfs);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(Readable.toWeb(data as Readable) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="pagedock-backup-${date}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '백업을 만들지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    return NextResponse.json(await createAutomaticBackup());
  } catch (error) {
    const message = error instanceof Error ? error.message : '자동 백업을 만들지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
