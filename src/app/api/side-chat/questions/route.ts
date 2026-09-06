import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getSession, mutateSession } from '@/lib/annot-sessions';
import { normalizeChatSourceContext } from '@/lib/ai-providers/source-context';
import { canUseSideChatSource, hasInvalidSideChatPdfPathHint, normalizeSideChatPdfPathHint, SIDE_CHAT_FOLDER_PATH } from '@/lib/side-chat';
import type { ChatMessage, ChatSourceContext } from '@/types';

class SideChatQuestionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function sameSource(left: ChatSourceContext | undefined, right: ChatSourceContext | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folderPath?: unknown;
      sessionId?: unknown;
      requestId?: unknown;
      prompt?: unknown;
      sourceContext?: unknown;
      sourcePdfPath?: unknown;
    };
    if (
      typeof body.folderPath !== 'string'
      || typeof body.sessionId !== 'string'
      || typeof body.prompt !== 'string'
    ) {
      return NextResponse.json({ error: '사이드채팅과 질문이 필요합니다.' }, { status: 400 });
    }
    const prompt = body.prompt.trim();
    if (!prompt) return NextResponse.json({ error: '질문을 입력해 주세요.' }, { status: 400 });
    const requestId = typeof body.requestId === 'string' && body.requestId.trim()
      ? body.requestId.trim()
      : randomUUID();
    const session = await getSession(body.folderPath, body.sessionId);
    if (!session) return NextResponse.json({ error: '사이드채팅을 찾을 수 없습니다.' }, { status: 404 });
    if (session.sessionKind !== 'sidechat' || body.folderPath !== SIDE_CHAT_FOLDER_PATH) {
      return NextResponse.json({ error: '독립 사이드채팅에서만 질문을 저장할 수 있습니다.' }, { status: 400 });
    }
    const sourceContext = body.sourceContext === undefined
      ? undefined
      : normalizeChatSourceContext(body.sourceContext);
    if (body.sourceContext !== undefined && (!sourceContext || !canUseSideChatSource(sourceContext))) {
      return NextResponse.json({ error: '원문 연결 정보가 올바르지 않습니다.' }, { status: 400 });
    }
    if (hasInvalidSideChatPdfPathHint(body.sourcePdfPath)) {
      return NextResponse.json({ error: '원문 파일 경로가 올바르지 않습니다.' }, { status: 400 });
    }
    const sourcePdfPath = normalizeSideChatPdfPathHint(body.sourcePdfPath);
    let questionMessage: ChatMessage | undefined;
    const nextSession = await mutateSession(body.folderPath, body.sessionId, (currentSession) => {
      const existing = currentSession.messages.find((message) => message.sideChatQuestionRequestId === requestId);
      if (existing) {
        if (
          existing.role !== 'user'
          || existing.content !== prompt
          || !sameSource(existing.sourceContext, sourceContext)
          || existing.sourcePdfPath !== sourcePdfPath
        ) {
          throw new SideChatQuestionError(409, '같은 요청 ID에 다른 질문이 연결되어 있습니다. 새로 시도해 주세요.');
        }
        questionMessage = existing;
        return currentSession;
      }
      questionMessage = {
        id: `u-sidechat-${requestId}`,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        ...(sourceContext ? { sourceContext } : {}),
        ...(sourcePdfPath ? { sourcePdfPath } : {}),
        sideChatQuestionRequestId: requestId,
      };
      return { ...currentSession, messages: [...currentSession.messages, questionMessage] };
    });
    if (!questionMessage) throw new Error('질문을 저장하지 못했습니다.');
    return NextResponse.json({ session: nextSession, questionMessage });
  } catch (error) {
    if (error instanceof SideChatQuestionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.startsWith('Session not found:')) {
      return NextResponse.json({ error: '사이드채팅을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ error: '질문을 로컬에 저장하지 못했습니다. 질문과 원문을 유지한 채 다시 시도해 주세요.' }, { status: 500 });
  }
}
