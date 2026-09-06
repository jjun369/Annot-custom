import { NextRequest, NextResponse } from 'next/server';

import { listSidecarHighlights } from '@/lib/highlight-sidecar';
import { getPaperMetadataBatch } from '@/lib/paper-metadata';
import { deriveReaderSummary } from '@/lib/reader-summary';
import { ReaderSummary } from '@/types';

export const runtime = 'nodejs';

function isSafePdfPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  const normalized = value.replace(/\\/g, '/');
  return normalized.toLowerCase().endsWith('.pdf')
    && !normalized.startsWith('/')
    && !/^[a-z]:/i.test(normalized)
    && !normalized.split('/').includes('..');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { paths?: unknown };
    const paths = Array.isArray(body.paths)
      ? [...new Set(body.paths.filter(isSafePdfPath))].slice(0, 500)
      : [];
    if (paths.length === 0) return NextResponse.json({ summaries: {} });

    const metadataByPath = await getPaperMetadataBatch(paths);
    const entries = await Promise.all(paths.map(async (pdfPath) => {
      const highlights = await listSidecarHighlights(pdfPath).catch(() => []);
      const metadata = metadataByPath[pdfPath];
      const summary: ReaderSummary = deriveReaderSummary(
        metadata?.readingPosition,
        highlights,
        metadata?.lastOpenedAt,
      );
      return [pdfPath, summary] as const;
    }));

    return NextResponse.json({ summaries: Object.fromEntries(entries) });
  } catch {
    return NextResponse.json({ error: '읽기 요약을 불러오지 못했습니다.' }, { status: 500 });
  }
}
