import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { analyzeResearchDocument } from '@/lib/research-ai';
import { listAnalysisReports, saveAnalysisReport } from '@/lib/research-db';
import type { ReasoningEffort } from '@/types';

export async function GET(request: NextRequest) {
  const documentId = request.nextUrl.searchParams.get('documentId');
  if (!documentId) return NextResponse.json({ error: '문서 ID가 필요합니다.' }, { status: 400 });
  return NextResponse.json({ analyses: await listAnalysisReports(documentId) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      documentId?: string;
      projectId?: string;
      profileId?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      imagePaths?: string[];
    };
    if (!body.documentId || !body.profileId) {
      return NextResponse.json({ error: '문서와 분석 프로필이 필요합니다.' }, { status: 400 });
    }
    const reportId = randomUUID();
    const queued = await saveAnalysisReport({
      id: reportId,
      documentId: body.documentId,
      projectId: body.projectId,
      profileId: body.profileId,
      status: 'queued',
      model: body.model || 'auto',
      reasoningEffort: body.reasoningEffort || 'auto',
    });
    void analyzeResearchDocument({
      reportId,
      documentId: body.documentId,
      projectId: body.projectId,
      profileId: body.profileId,
      model: body.model || 'auto',
      reasoningEffort: body.reasoningEffort || 'auto',
      imagePaths: Array.isArray(body.imagePaths) ? body.imagePaths : undefined,
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '분석을 시작하지 못했습니다.' }, { status: 500 });
  }
}
