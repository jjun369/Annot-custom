import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  createSidecarVisualRegion,
  deleteSidecarVisualRegion,
  listSidecarVisualRegions,
  updateSidecarVisualRegion,
} from '@/lib/highlight-sidecar';
import { isVisualRegionKind, normalizeVisualRegionRect } from '@/lib/visual-regions';
import { markMobileBridgeExportDirtyForPdfPath } from '@/lib/mobile-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getPdfPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getRegionId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error && error.message
    ? error.message
    : '그림·표 기록을 저장하지 못했습니다.';
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    const pdfPath = getPdfPath(req.nextUrl.searchParams.get('path'));
    if (!pdfPath) return NextResponse.json({ error: 'path is required' }, { status: 400 });
    return NextResponse.json({ regions: await listSidecarVisualRegions(pdfPath) }, {
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
    const rect = normalizeVisualRegionRect(body?.rect);
    if (!rect || !Number.isInteger(body?.page) || body.page < 1 || !isVisualRegionKind(body?.kind)) {
      return NextResponse.json({ error: '기록할 페이지, 영역 또는 종류가 올바르지 않습니다.' }, { status: 400 });
    }
    const region = await createSidecarVisualRegion(pdfPath, randomUUID(), {
      page: body.page,
      rect,
      kind: body.kind,
      memo: body?.memo,
    });
    await markMobileBridgeExportDirtyForPdfPath(pdfPath).catch(() => undefined);
    return NextResponse.json({ region }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const pdfPath = getPdfPath(body?.pdfPath);
    const regionId = getRegionId(body?.regionId);
    if (!pdfPath || !regionId) {
      return NextResponse.json({ error: 'pdfPath and regionId are required' }, { status: 400 });
    }
    const hasKind = Object.prototype.hasOwnProperty.call(body, 'kind');
    const hasMemo = Object.prototype.hasOwnProperty.call(body, 'memo');
    if (!hasKind && !hasMemo) {
      return NextResponse.json({ error: '변경할 그림·표 기록이 없습니다.' }, { status: 400 });
    }
    if (hasKind && !isVisualRegionKind(body.kind)) {
      return NextResponse.json({ error: '기록 종류가 올바르지 않습니다.' }, { status: 400 });
    }
    if (hasMemo && typeof body.memo !== 'string') {
      return NextResponse.json({ error: '메모는 텍스트여야 합니다.' }, { status: 400 });
    }
    const region = await updateSidecarVisualRegion(pdfPath, regionId, {
      kind: hasKind ? body.kind : undefined,
      memo: hasMemo ? body.memo : undefined,
    });
    await markMobileBridgeExportDirtyForPdfPath(pdfPath).catch(() => undefined);
    return NextResponse.json({ region }, {
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
    const regionId = getRegionId(body?.regionId);
    if (!pdfPath || !regionId) {
      return NextResponse.json({ error: 'pdfPath and regionId are required' }, { status: 400 });
    }
    const regions = await deleteSidecarVisualRegion(pdfPath, regionId);
    await markMobileBridgeExportDirtyForPdfPath(pdfPath).catch(() => undefined);
    return NextResponse.json({ regions }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
