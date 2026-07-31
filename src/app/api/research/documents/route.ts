import { NextRequest, NextResponse } from 'next/server';

import {
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
