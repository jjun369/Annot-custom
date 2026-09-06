import { NextRequest, NextResponse } from 'next/server';

import {
  addMobileShelfPdf,
  getMobileBridgeInfo,
  removeMobileShelfDocument,
} from '@/lib/mobile-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { pdfPath?: unknown };
    const pdfPath = typeof body.pdfPath === 'string' ? body.pdfPath.trim() : '';
    if (!pdfPath) return NextResponse.json({ error: 'pdfPath 값이 필요합니다.' }, { status: 400 });
    const result = await addMobileShelfPdf(pdfPath);
    return NextResponse.json({ ...result, bridge: await getMobileBridgeInfo() }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '모바일 보관함에 넣지 못했습니다.' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const documentId = req.nextUrl.searchParams.get('documentId')?.trim();
    if (!documentId) return NextResponse.json({ error: 'documentId 값이 필요합니다.' }, { status: 400 });
    await removeMobileShelfDocument(documentId);
    return NextResponse.json(await getMobileBridgeInfo());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '모바일 보관함에서 제거하지 못했습니다.' }, { status: 500 });
  }
}
