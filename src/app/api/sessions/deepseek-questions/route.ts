import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { mutateSession, getSession } from '@/lib/annot-sessions';
import { normalizeChatSourceContext } from '@/lib/ai-providers/source-context';
import { ChatMessage, ChatSourceContext } from '@/types';

class DeepSeekQuestionRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function sameSourceContext(left: ChatSourceContext | undefined, right: ChatSourceContext): boolean {
  return Boolean(left
    && left.scope === 'selection'
    && left.id === right.id
    && left.documentId === right.documentId
    && left.page === right.page
    && left.text === right.text
    && JSON.stringify(left.rects ?? []) === JSON.stringify(right.rects ?? [])
    && left.highlightId === right.highlightId);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folderPath?: unknown;
      sessionId?: unknown;
      requestId?: unknown;
      prompt?: unknown;
      sourceContext?: unknown;
    };

    if (typeof body.folderPath !== 'string' || typeof body.sessionId !== 'string' || typeof body.prompt !== 'string') {
      return NextResponse.json({ error: '대화, 질문, 선택 원문이 필요합니다.' }, { status: 400 });
    }
    const prompt = body.prompt.trim();
    if (!prompt) return NextResponse.json({ error: '질문을 입력해 주세요.' }, { status: 400 });
    const requestId = typeof body.requestId === 'string' && body.requestId.trim()
      ? body.requestId.trim()
      : randomUUID();

    const session = await getSession(body.folderPath, body.sessionId);
    if (!session) return NextResponse.json({ error: '대화를 찾을 수 없습니다.' }, { status: 404 });
    if (session.sessionKind !== 'pdf') {
      return NextResponse.json({ error: '선택 원문은 PDF 대화에서만 저장할 수 있습니다.' }, { status: 400 });
    }
    const sourceContext = normalizeChatSourceContext(body.sourceContext, { documentId: session.documentId });
    if (!sourceContext || sourceContext.scope !== 'selection') {
      return NextResponse.json({ error: 'DeepSeek 질문은 한 페이지의 선택 원문에만 연결할 수 있습니다.' }, { status: 400 });
    }
    if (!session.documentId) delete sourceContext.documentId;

    let questionMessage: ChatMessage | undefined;
    const nextSession = await mutateSession(body.folderPath, body.sessionId, (currentSession) => {
      const currentSourceContext = normalizeChatSourceContext(sourceContext, { documentId: currentSession.documentId });
      if (!currentSourceContext || currentSourceContext.scope !== 'selection') {
        throw new DeepSeekQuestionRequestError(400, '선택 원문을 다시 확인해 주세요.');
      }
      if (!currentSession.documentId) delete currentSourceContext.documentId;

      const existing = currentSession.messages.find((message) => message.deepSeekRequestId === requestId);
      if (existing) {
        if (existing.role !== 'user' || existing.content !== prompt || !sameSourceContext(existing.sourceContext, currentSourceContext)) {
          throw new DeepSeekQuestionRequestError(409, '같은 요청 ID에 다른 질문이 연결되어 있습니다. 새로 시도해 주세요.');
        }
        questionMessage = existing;
        return currentSession;
      }

      questionMessage = {
        id: `u-deepseek-${requestId}`,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        sourceContext: currentSourceContext,
        deepSeekRequestId: requestId,
      };
      return {
        ...currentSession,
        messages: [...currentSession.messages, questionMessage],
      };
    });

    if (!questionMessage) throw new Error('질문을 저장하지 못했습니다.');
    return NextResponse.json({ session: nextSession, questionMessage });
  } catch (error) {
    if (error instanceof DeepSeekQuestionRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.startsWith('Session not found:')) {
      return NextResponse.json({ error: '대화를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ error: '질문을 로컬에 저장하지 못했습니다. 원문을 유지한 채 다시 시도해 주세요.' }, { status: 500 });
  }
}
