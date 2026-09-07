import { NextRequest, NextResponse } from 'next/server';

import { mutateSession } from '@/lib/annot-sessions';
import { SIDE_CHAT_MAX_REFLECTION_CHARS } from '@/lib/side-chat';
import type { SideChatReflection } from '@/types';

class ReflectionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folderPath?: unknown;
      sessionId?: unknown;
      questionMessageId?: unknown;
      text?: unknown;
    };
    if (typeof body.folderPath !== 'string' || typeof body.sessionId !== 'string'
      || typeof body.questionMessageId !== 'string' || typeof body.text !== 'string') {
      return NextResponse.json({ error: '사이드채팅 메모 정보가 올바르지 않습니다.' }, { status: 400 });
    }

    const text = normalizeText(body.text);
    if (text.length > SIDE_CHAT_MAX_REFLECTION_CHARS) {
      return NextResponse.json({ error: `메모는 ${SIDE_CHAT_MAX_REFLECTION_CHARS.toLocaleString('ko-KR')}자 이하로 저장할 수 있습니다.` }, { status: 400 });
    }

    let reflection: SideChatReflection | undefined;
    await mutateSession(body.folderPath, body.sessionId, (session) => {
      if (session.sessionKind !== 'sidechat') throw new ReflectionError(400, '사이드채팅 메모는 독립 사이드채팅에만 저장할 수 있습니다.');
      const question = session.messages.find((message) => message.id === body.questionMessageId && message.role === 'user');
      if (!question) throw new ReflectionError(404, '메모를 연결할 사이드채팅 질문을 찾을 수 없습니다.');

      reflection = text ? { text, updatedAt: new Date().toISOString() } : undefined;
      return {
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== question.id) return message;
          const next = { ...message };
          if (reflection) next.sideChatReflection = reflection;
          else delete next.sideChatReflection;
          return next;
        }),
      };
    });

    return NextResponse.json({ sessionId: body.sessionId, questionMessageId: body.questionMessageId, reflection });
  } catch (error) {
    if (error instanceof ReflectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.message.startsWith('Session not found:')) {
      return NextResponse.json({ error: '사이드채팅을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ error: '메모를 저장하지 못했습니다. 입력은 유지됩니다.' }, { status: 500 });
  }
}
