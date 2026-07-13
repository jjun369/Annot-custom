import { NextRequest, NextResponse } from 'next/server';

import {
  getPaperMetadata,
  getPaperMetadataBatch,
  updatePaperMetadata,
} from '@/lib/paper-metadata';

export async function GET(req: NextRequest) {
  try {
    const paths = req.nextUrl.searchParams.getAll('path').map((value) => value.trim()).filter(Boolean);
    if (paths.length === 0) {
      return NextResponse.json({ error: 'PDF 경로가 필요합니다.' }, { status: 400 });
    }
    if (paths.length === 1) {
      return NextResponse.json(await getPaperMetadata(paths[0]));
    }
    return NextResponse.json(await getPaperMetadataBatch(paths));
  } catch (error) {
    const message = error instanceof Error ? error.message : '논문 정보를 불러오지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { paths?: unknown };
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (paths.length === 0) {
      return NextResponse.json({ error: 'PDF 경로가 필요합니다.' }, { status: 400 });
    }
    return NextResponse.json(await getPaperMetadataBatch(paths));
  } catch (error) {
    const message = error instanceof Error ? error.message : '논문 정보를 불러오지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { pdfPath, ...updates } = body as { pdfPath?: string } & Record<string, unknown>;
    if (!pdfPath?.trim()) {
      return NextResponse.json({ error: 'PDF 경로가 필요합니다.' }, { status: 400 });
    }
    return NextResponse.json(await updatePaperMetadata(pdfPath, updates));
  } catch (error) {
    const message = error instanceof Error ? error.message : '논문 정보를 저장하지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
