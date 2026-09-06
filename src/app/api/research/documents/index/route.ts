import { NextRequest, NextResponse } from 'next/server';

import { researchIndexJobs, ResearchIndexJobError } from '@/lib/research-index-jobs';

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof ResearchIndexJobError) {
    const status = error.code === 'INDEXER_BUSY' || error.code === 'NOT_CANCELLABLE' ? 409
      : error.code === 'JOB_NOT_FOUND' ? 404
        : 400;
    return NextResponse.json({ error: message, code: error.code }, { status });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { documentId?: string };
    if (!body.documentId) return NextResponse.json({ error: '문서 ID가 필요합니다.' }, { status: 400 });
    const result = await researchIndexJobs.start(body.documentId);
    return NextResponse.json(result, { status: result.reused ? 200 : 202 });
  } catch (error) {
    return errorResponse(error, '문서 색인을 시작하지 못했습니다.');
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: '색인 작업 ID가 필요합니다.' }, { status: 400 });
  const job = researchIndexJobs.get(jobId);
  if (!job) {
    return NextResponse.json({
      error: '색인 작업 상태를 찾을 수 없습니다. 앱이 다시 시작된 경우에는 기존 색인이 그대로 유지되며 다시 시작할 수 있습니다.',
      code: 'JOB_NOT_FOUND',
    }, { status: 404 });
  }
  return NextResponse.json({ job });
}

export async function DELETE(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: '색인 작업 ID가 필요합니다.' }, { status: 400 });
  try {
    return NextResponse.json({ job: await researchIndexJobs.cancel(jobId) }, { status: 202 });
  } catch (error) {
    return errorResponse(error, '문서 색인을 취소하지 못했습니다.');
  }
}
