import { NextRequest, NextResponse } from 'next/server';

import { downloadPublicPdf } from '@/lib/public-pdf-download';
import { createExternalDocument, ensureDocumentForPath, setProjectDocument, updateDocument } from '@/lib/research-db';
import type { OnlineResearchResult } from '@/lib/research-sources';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action?: 'save-metadata' | 'download-pdf';
      result?: OnlineResearchResult;
      projectId?: string;
      url?: string;
      folderPath?: string;
      preferredName?: string;
    };
    if (body.action === 'download-pdf') {
      if (!body.url) return NextResponse.json({ error: 'PDF URL이 필요합니다.' }, { status: 400 });
      const pdf = await downloadPublicPdf({ url: body.url, folderPath: body.folderPath, preferredName: body.preferredName });
      const document = await ensureDocumentForPath(pdf.path);
      if (body.projectId) await setProjectDocument(body.projectId, document.id, true);
      if (body.result) {
        await updateDocument(document.id, {
          displayTitle: body.result.title,
          doi: body.result.doi,
          sourceUrl: body.result.url,
          sourceProvider: body.result.source,
          abstractText: body.result.abstractText,
          authors: body.result.authors,
          publicationYear: body.result.publicationYear,
        });
      }
      return NextResponse.json({ document, pdf });
    }
    if (!body.result) return NextResponse.json({ error: '저장할 검색 결과가 필요합니다.' }, { status: 400 });
    const document = await createExternalDocument({
      displayTitle: body.result.title,
      kind: body.result.kind,
      doi: body.result.doi,
      sourceUrl: body.result.url,
      sourceProvider: body.result.source,
      abstractText: body.result.abstractText,
      authors: body.result.authors,
      publicationYear: body.result.publicationYear,
      tags: body.result.venue ? [body.result.venue] : [],
    });
    if (body.projectId) await setProjectDocument(body.projectId, document.id, true);
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '자료를 가져오지 못했습니다.' }, { status: 500 });
  }
}
