import { NextRequest, NextResponse } from 'next/server';

import { editKnowledgeTopic, restoreKnowledgeTopicRevision } from '@/lib/knowledge-store';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      action?: 'edit' | 'restore';
      topicId?: string;
      revision?: number;
      update?: { title?: string; summary?: string; bodyMarkdown?: string; changeNote?: string };
    };
    if (!body.topicId) return NextResponse.json({ error: 'topicId가 필요합니다.' }, { status: 400 });
    if (body.action === 'edit') {
      if (!body.update?.title || !body.update.bodyMarkdown) {
        return NextResponse.json({ error: '제목과 Markdown 본문이 필요합니다.' }, { status: 400 });
      }
      return NextResponse.json({
        topic: await editKnowledgeTopic(body.topicId, {
          title: body.update.title,
          summary: body.update.summary ?? '',
          bodyMarkdown: body.update.bodyMarkdown,
          changeNote: body.update.changeNote,
        }),
      });
    }
    if (!Number.isInteger(body.revision)) {
      return NextResponse.json({ error: '복원할 revision이 필요합니다.' }, { status: 400 });
    }
    return NextResponse.json({ topic: await restoreKnowledgeTopicRevision(body.topicId, body.revision!) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '위키 revision을 복원하지 못했습니다.',
    }, { status: 400 });
  }
}
