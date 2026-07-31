import { NextRequest, NextResponse } from 'next/server';

import {
  getKnowledgeRevisionTrash,
  permanentlyDeleteTrashedKnowledgeRevision,
  restoreTrashedKnowledgeRevision,
  trashKnowledgeTopicRevision,
} from '@/lib/knowledge-store';

export async function GET() {
  return NextResponse.json(await getKnowledgeRevisionTrash());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { topicId?: string; revision?: number };
    if (!body.topicId || !Number.isInteger(body.revision)) {
      return NextResponse.json({ error: 'topicId와 revision이 필요합니다.' }, { status: 400 });
    }
    return NextResponse.json({
      item: await trashKnowledgeTopicRevision(body.topicId, body.revision!),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'revision을 휴지통으로 옮기지 못했습니다.',
    }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as { trashId?: string };
    if (!body.trashId) return NextResponse.json({ error: 'trashId가 필요합니다.' }, { status: 400 });
    return NextResponse.json({ revision: await restoreTrashedKnowledgeRevision(body.trashId) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'revision을 복원하지 못했습니다.',
    }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json() as { trashId?: string };
    if (!body.trashId) return NextResponse.json({ error: 'trashId가 필요합니다.' }, { status: 400 });
    await permanentlyDeleteTrashedKnowledgeRevision(body.trashId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'revision을 영구 삭제하지 못했습니다.',
    }, { status: 400 });
  }
}
