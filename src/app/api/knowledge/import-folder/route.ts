import { NextRequest, NextResponse } from 'next/server';

import {
  importKnowledgeFolderFile,
  previewKnowledgeFolderFile,
  scanKnowledgeImportFolder,
  setKnowledgeImportDirectory,
} from '@/lib/knowledge-folder';
import { readKnowledgeImportSettings } from '@/lib/knowledge-import-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await readKnowledgeImportSettings();
  return NextResponse.json({ version: settings.version, directory: settings.directory, ...(settings.lastScanAt ? { lastScanAt: settings.lastScanAt } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as { directory?: string | null };
    return NextResponse.json(await setKnowledgeImportDirectory(body.directory?.trim() || null));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '메모 폴더를 저장하지 못했습니다.' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: string; relativePath?: string; expectedHash?: string; mode?: 'single' | 'split' };
    if (body.action === 'scan') return NextResponse.json(await scanKnowledgeImportFolder());
    if (body.action === 'preview' && body.relativePath) return NextResponse.json(await previewKnowledgeFolderFile(body.relativePath));
    if (body.action === 'import' && body.relativePath && body.expectedHash && (body.mode === 'single' || body.mode === 'split')) {
      return NextResponse.json(await importKnowledgeFolderFile(body.relativePath, body.expectedHash, body.mode));
    }
    return NextResponse.json({ error: '올바른 메모 폴더 작업이 필요합니다.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '메모 폴더를 처리하지 못했습니다.' }, { status: 400 });
  }
}
