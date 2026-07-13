import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { ReadableStream as NodeReadableStream } from 'stream/web';

import { importPortableBackupFile } from '@/lib/library-backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: 'Annot ZIP 백업 파일을 선택해 주세요.' }, { status: 400 });
    }
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'annot-upload-'));
    const archivePath = path.join(temporaryDirectory, 'backup.zip');
    try {
      await pipeline(
        Readable.fromWeb(file.stream() as unknown as NodeReadableStream<Uint8Array>),
        createWriteStream(archivePath, { flags: 'wx' }),
      );
      return NextResponse.json(await importPortableBackupFile(archivePath));
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '백업을 가져오지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
