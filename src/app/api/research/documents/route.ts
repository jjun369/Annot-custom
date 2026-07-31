import { NextRequest, NextResponse } from 'next/server';

import {
  createExternalDocument,
  getDocumentById,
  getDocumentProjectIds,
  getPatentMetadata,
  listAnalysisReports,
  listDocuments,
  setProjectDocument,
  updateDocument,
  upsertPatentMetadata,
} from '@/lib/research-db';
import { suggestResearchFilename } from '@/lib/research-index';
import type { PatentMetadata, ResearchDocument } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      title?: string;
      publicationNumber?: string;
      sourceUrl?: string;
      projectId?: string;
    };
    const publicationNumber = body.publicationNumber?.trim();
    if (!publicationNumber) {
      return NextResponse.json({ error: '특허 공개번호 또는 출원번호가 필요합니다.' }, { status: 400 });
    }
    const document = await createExternalDocument({
      displayTitle: body.title?.trim() || publicationNumber,
      kind: 'patent',
      sourceUrl: body.sourceUrl?.trim() || undefined,
      sourceProvider: 'manual',
    });
    await upsertPatentMetadata({
      documentId: document.id,
      publicationNumber,
      assignees: [],
      inventors: [],
      citations: [],
      claimsText: '',
      updatedAt: new Date().toISOString(),
    });
    if (body.projectId) await setProjectDocument(body.projectId, document.id, true);
    return NextResponse.json({ document: await getDocumentById(document.id) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '특허 자료를 추가하지 못했습니다.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
    if (!id) return NextResponse.json({ documents: await listDocuments(projectId) });
    const document = await getDocumentById(id);
    if (!document) return NextResponse.json({ error: '문서를 찾지 못했습니다.' }, { status: 404 });
    const [projectIds, patent, analyses, filenameSuggestion] = await Promise.all([
      getDocumentProjectIds(id),
      getPatentMetadata(id),
      listAnalysisReports(id),
      suggestResearchFilename(id),
    ]);
    return NextResponse.json({ document, projectIds, patent, analyses, filenameSuggestion });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '문서를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      id?: string;
      updates?: Partial<ResearchDocument>;
      patent?: PatentMetadata;
      projectId?: string;
      linked?: boolean;
    };
    if (!body.id) return NextResponse.json({ error: '문서 ID가 필요합니다.' }, { status: 400 });
    if (body.projectId) await setProjectDocument(body.projectId, body.id, body.linked !== false);
    if (body.updates) await updateDocument(body.id, body.updates);
    if (body.patent) await upsertPatentMetadata({ ...body.patent, documentId: body.id });
    return NextResponse.json({ document: await getDocumentById(body.id), projectIds: await getDocumentProjectIds(body.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '문서를 수정하지 못했습니다.' }, { status: 500 });
  }
}
