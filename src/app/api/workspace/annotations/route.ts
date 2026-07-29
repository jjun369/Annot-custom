import { NextRequest, NextResponse } from 'next/server';

import {
  deletePdfAnnotations,
  listPdfAnnotations,
  savePdfAnnotations,
  updatePdfAnnotations,
} from '@/lib/pdf-annotations';
import { Highlight } from '@/types';
import { normalizeHighlightRects } from '@/lib/highlight-utils';
import {
  deleteSidecarHighlights,
  listSidecarHighlights,
  replaceSidecarHighlights,
  updateSidecarHighlights,
  upsertSidecarHighlights,
} from '@/lib/highlight-sidecar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function friendlyAnnotationError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : '';
  if (/No module named ['"]?fitz|ModuleNotFoundError/i.test(raw)) {
    return 'PDF 주석 기능에 필요한 Python PDF 모듈을 찾지 못했습니다.';
  }
  if (/FileNotFoundError|no such file/i.test(raw)) {
    return 'PDF 원본 파일을 찾지 못했습니다. 라이브러리 동기화 상태를 확인해 주세요.';
  }
  if (/FileDataError|no objects found|Failed to open/i.test(raw)) {
    return 'PDF 원본을 읽지 못했습니다. 파일이 완전히 동기화되었는지 확인해 주세요.';
  }
  return raw.includes('Traceback') || !raw ? fallback : raw;
}

export async function GET(req: NextRequest) {
  try {
    const pdfPath = req.nextUrl.searchParams.get('path')?.trim();
    if (!pdfPath) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }

    const sidecarHighlights = await listSidecarHighlights(pdfPath);
    try {
      const result = await listPdfAnnotations(pdfPath);
      const highlights = Array.isArray(result.highlights)
        ? [...result.highlights, ...sidecarHighlights]
        : sidecarHighlights;
      const mergedHighlights = await replaceSidecarHighlights(pdfPath, highlights);
      return NextResponse.json({ ...result, highlights: mergedHighlights, embedded: true }, {
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      if (sidecarHighlights.length === 0) {
        throw new Error(friendlyAnnotationError(error, 'PDF 주석을 읽지 못했습니다.'));
      }
      return NextResponse.json({
        highlights: sidecarHighlights,
        embedded: false,
        warning: 'PDF 원본 주석을 읽지 못해 PageDock 기록을 표시합니다.',
      }, {
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load PDF annotations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      pdfPath,
      highlights,
    } = body as {
      pdfPath?: string;
      highlights?: Highlight[];
    };

    if (!pdfPath?.trim()) {
      return NextResponse.json({ error: 'pdfPath is required' }, { status: 400 });
    }

    if (!Array.isArray(highlights) || highlights.length === 0) {
      return NextResponse.json({ error: 'highlights are required' }, { status: 400 });
    }

    const normalizedHighlights = highlights.map((highlight) => ({
      ...highlight,
      pdfPath: pdfPath.trim(),
      rects: normalizeHighlightRects(highlight.rects?.length ? highlight.rects : [highlight.position]),
      position: normalizeHighlightRects(highlight.rects?.length ? highlight.rects : [highlight.position])[0] || highlight.position,
    }));
    let embedded = true;
    let warning: string | undefined;
    let result: { highlights: Highlight[]; migrated?: number; added?: number } = { highlights: [] };

    try {
      result = await savePdfAnnotations(
        pdfPath.trim(),
        normalizedHighlights.map((highlight) => ({
          page: highlight.page,
          type: highlight.type,
          text: highlight.text,
          note: highlight.note,
          rects: highlight.rects,
        })),
      );
    } catch (error) {
      embedded = false;
      warning = friendlyAnnotationError(error, 'PDF 원본에 주석을 반영하지 못했습니다.');
    }

    const savedHighlights = await upsertSidecarHighlights(
      pdfPath.trim(),
      [...(result.highlights || []), ...normalizedHighlights],
    );

    return NextResponse.json({ ...result, highlights: savedHighlights, embedded, warning }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save PDF annotations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      pdfPath,
      updates,
    } = body as {
      pdfPath?: string;
      updates?: Array<{
        annotationId?: string;
        note?: string;
        text?: string;
        type?: Highlight['type'];
      }>;
    };

    if (!pdfPath?.trim()) {
      return NextResponse.json({ error: 'pdfPath is required' }, { status: 400 });
    }

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: 'updates are required' }, { status: 400 });
    }

    const normalizedUpdates = updates
      .filter((update) => typeof update.annotationId === 'string' && update.annotationId.trim().length > 0)
      .map((update) => ({
        annotationId: update.annotationId!.trim(),
        note: typeof update.note === 'string' ? update.note : undefined,
        text: typeof update.text === 'string' ? update.text : undefined,
        type: update.type,
      }));

    if (normalizedUpdates.length === 0) {
      return NextResponse.json({ error: 'valid annotationId values are required' }, { status: 400 });
    }

    let result: { highlights: Highlight[]; updated?: number } = { highlights: [] };
    let embedded = true;
    let warning: string | undefined;
    try {
      result = await updatePdfAnnotations(pdfPath.trim(), normalizedUpdates);
    } catch (error) {
      embedded = false;
      warning = friendlyAnnotationError(error, 'PDF 원본 주석을 수정하지 못했습니다.');
    }
    const sidecarHighlights = await updateSidecarHighlights(pdfPath.trim(), normalizedUpdates);
    const highlights = await replaceSidecarHighlights(pdfPath.trim(), [
      ...(result.highlights || []),
      ...sidecarHighlights,
    ]);
    return NextResponse.json({ ...result, highlights, embedded, warning }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update PDF annotations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      pdfPath,
      annotationIds,
      highlightIds,
    } = body as {
      pdfPath?: string;
      annotationIds?: string[];
      highlightIds?: string[];
    };

    if (!pdfPath?.trim()) {
      return NextResponse.json({ error: 'pdfPath is required' }, { status: 400 });
    }

    const nativeIds = Array.isArray(annotationIds) ? annotationIds : [];
    const localIds = Array.isArray(highlightIds) ? highlightIds : [];
    if (nativeIds.length === 0 && localIds.length === 0) {
      return NextResponse.json({ error: 'annotationIds or highlightIds are required' }, { status: 400 });
    }

    let result: { highlights: Highlight[]; deleted?: number } = { highlights: [] };
    let embedded = true;
    let warning: string | undefined;
    if (nativeIds.length > 0) {
      try {
        result = await deletePdfAnnotations(pdfPath.trim(), nativeIds);
      } catch (error) {
        embedded = false;
        warning = friendlyAnnotationError(error, 'PDF 원본 주석을 지우지 못했습니다.');
      }
    }
    const sidecarHighlights = await deleteSidecarHighlights(pdfPath.trim(), [...nativeIds, ...localIds]);
    const highlights = await replaceSidecarHighlights(pdfPath.trim(), [
      ...(result.highlights || []),
      ...sidecarHighlights,
    ]);
    return NextResponse.json({ ...result, highlights, embedded, warning }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete PDF annotations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
