import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  createSidecarStudyCard,
  deleteSidecarStudyCard,
  listSidecarStudyCards,
  updateSidecarStudyCard,
} from '@/lib/highlight-sidecar';
import { StudyCardKind, StudyCardOrigin, StudyCardReviewResult } from '@/types';
import { markMobileBridgeExportDirtyForPdfPath } from '@/lib/mobile-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getPdfPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error && error.message
    ? error.message
    : '복습 카드를 저장하지 못했습니다.';
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    const pdfPath = getPdfPath(req.nextUrl.searchParams.get('path'));
    if (!pdfPath) return NextResponse.json({ error: 'path is required' }, { status: 400 });
    return NextResponse.json({ cards: await listSidecarStudyCards(pdfPath) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const pdfPath = getPdfPath(body?.pdfPath);
    if (!pdfPath) return NextResponse.json({ error: 'pdfPath is required' }, { status: 400 });
    if (body?.origin !== 'selection' && body?.origin !== 'chat') {
      return NextResponse.json({ error: '복습 카드의 생성 위치가 올바르지 않습니다.' }, { status: 400 });
    }
    if (body?.kind !== undefined && body.kind !== 'basic' && body.kind !== 'cloze') {
      return NextResponse.json({ error: '복습 카드 종류가 올바르지 않습니다.' }, { status: 400 });
    }
    if (body?.kind === 'cloze' && body.origin !== 'selection') {
      return NextResponse.json({ error: '빈칸 카드는 PDF에서 선택한 원문으로만 만들 수 있습니다.' }, { status: 400 });
    }
    const card = await createSidecarStudyCard(pdfPath, randomUUID(), {
      sourceContext: body?.sourceContext,
      front: body?.front,
      back: body?.back,
      origin: body.origin as StudyCardOrigin,
      kind: body?.kind as StudyCardKind | undefined,
      cloze: body?.cloze,
    });
    await markMobileBridgeExportDirtyForPdfPath(pdfPath).catch(() => undefined);
    return NextResponse.json({ card }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const pdfPath = getPdfPath(body?.pdfPath);
    const cardId = typeof body?.cardId === 'string' ? body.cardId.trim() : '';
    if (!pdfPath || !cardId) {
      return NextResponse.json({ error: 'pdfPath and cardId are required' }, { status: 400 });
    }
    const hasFront = Object.prototype.hasOwnProperty.call(body, 'front');
    const hasBack = Object.prototype.hasOwnProperty.call(body, 'back');
    const hasCloze = Object.prototype.hasOwnProperty.call(body, 'cloze');
    const hasReviewResult = Object.prototype.hasOwnProperty.call(body, 'reviewResult');
    if (!hasFront && !hasBack && !hasCloze && !hasReviewResult) {
      return NextResponse.json({ error: '변경할 카드 내용이 없습니다.' }, { status: 400 });
    }
    if (hasReviewResult && body.reviewResult !== 'again' && body.reviewResult !== 'remembered') {
      return NextResponse.json({ error: '복습 결과가 올바르지 않습니다.' }, { status: 400 });
    }
    const card = await updateSidecarStudyCard(pdfPath, cardId, {
      front: hasFront ? body.front : undefined,
      back: hasBack ? body.back : undefined,
      cloze: hasCloze ? body.cloze : undefined,
      reviewResult: hasReviewResult ? body.reviewResult as StudyCardReviewResult : undefined,
    });
    await markMobileBridgeExportDirtyForPdfPath(pdfPath).catch(() => undefined);
    return NextResponse.json({ card }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const pdfPath = getPdfPath(body?.pdfPath);
    const cardId = typeof body?.cardId === 'string' ? body.cardId.trim() : '';
    if (!pdfPath || !cardId) {
      return NextResponse.json({ error: 'pdfPath and cardId are required' }, { status: 400 });
    }
    const cards = await deleteSidecarStudyCard(pdfPath, cardId);
    await markMobileBridgeExportDirtyForPdfPath(pdfPath).catch(() => undefined);
    return NextResponse.json({ cards }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
