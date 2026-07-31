import { NextRequest, NextResponse } from 'next/server';

import { resolveKnowledgeReview, updateKnowledgeReview } from '@/lib/knowledge-store';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      reviewId?: string;
      decision?: 'accept' | 'reject';
      update?: { title?: string; proposedSummary?: string; proposedBodyMarkdown?: string };
    };
    if (!body.reviewId) return NextResponse.json({ error: 'reviewId가 필요합니다.' }, { status: 400 });
    if (body.update) return NextResponse.json(await updateKnowledgeReview(body.reviewId, body.update));
    if (!body.decision) return NextResponse.json({ error: 'decision이 필요합니다.' }, { status: 400 });
    return NextResponse.json(await resolveKnowledgeReview(body.reviewId, body.decision));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '변경안을 처리하지 못했습니다.',
    }, { status: 400 });
  }
}
