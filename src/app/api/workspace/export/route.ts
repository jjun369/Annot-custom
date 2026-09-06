import { NextRequest, NextResponse } from 'next/server';

import {
  buildPdfEvidenceBriefMarkdown,
  buildPdfHighlightsMarkdown,
  getPdfEvidenceBriefMarkdownFileName,
  getPdfHighlightsMarkdownFileName,
  listPdfAnnotations,
} from '@/lib/pdf-annotations';
import { listSidecarHighlights } from '@/lib/highlight-sidecar';
import { mergeHighlights } from '@/lib/highlight-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const pdfPath = req.nextUrl.searchParams.get('path')?.trim();
    const format = req.nextUrl.searchParams.get('format')?.trim() || 'markdown';

    if (!pdfPath) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }

    if (format !== 'markdown' && format !== 'evidence-brief') {
      return NextResponse.json({ error: 'Unsupported export format' }, { status: 400 });
    }

    const sidecarHighlights = await listSidecarHighlights(pdfPath);
    let highlights = sidecarHighlights;
    try {
      const result = await listPdfAnnotations(pdfPath);
      highlights = mergeHighlights([...result.highlights, ...sidecarHighlights]);
    } catch {
      // Sidecar records are the local-first source of truth when the optional
      // native-PDF/Python reader is unavailable.
      if (sidecarHighlights.length === 0) throw new Error('PDF 주석을 읽지 못했습니다.');
    }
    const markdown = format === 'evidence-brief'
      ? buildPdfEvidenceBriefMarkdown(pdfPath, highlights)
      : buildPdfHighlightsMarkdown(pdfPath, highlights);
    const fileName = format === 'evidence-brief'
      ? getPdfEvidenceBriefMarkdownFileName(pdfPath)
      : getPdfHighlightsMarkdownFileName(pdfPath);

    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export markdown';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
