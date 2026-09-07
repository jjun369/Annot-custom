import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getSession, mutateSession } from '@/lib/annot-sessions';
import { promptHash, WebRequestError } from '@/lib/side-chat-requests';
import {
  buildSideChatOutboundPrompt,
  canUseSideChatSource,
  SIDE_CHAT_MAX_RESPONSE_CHARS,
  SIDE_CHAT_WEB_PROVIDERS,
} from '@/lib/side-chat';
import type {
  ChatMessage,
  SideChatOutboundMode,
  SideChatWebPerspective,
  SideChatWebProviderId,
} from '@/types';

class SideChatPerspectiveError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function isProviderId(value: unknown): value is SideChatWebProviderId {
  return typeof value === 'string' && SIDE_CHAT_WEB_PROVIDERS.some((provider) => provider.id === value);
}

function isOutboundMode(value: unknown): value is SideChatOutboundMode {
  return value === 'question' || value === 'source-question' || value === 'source-question-answer';
}

function normalizeResponse(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').trim();
}

function validateResponse(value: unknown): string | null {
  const normalized = normalizeResponse(value);
  if (!normalized) return '웹 AI 답변을 붙여넣어 주세요.';
  if (normalized.length > SIDE_CHAT_MAX_RESPONSE_CHARS) {
    return `웹 AI 답변이 너무 깁니다. ${SIDE_CHAT_MAX_RESPONSE_CHARS.toLocaleString('ko-KR')}자 이하로 줄여 주세요.`;
  }
  return null;
}

function isQuestionMessage(message: ChatMessage | undefined): message is ChatMessage & { role: 'user' } {
  return Boolean(message?.role === 'user' && message.content.trim());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folderPath?: unknown;
      sessionId?: unknown;
      questionMessageId?: unknown;
      answerMessageId?: unknown;
      provider?: unknown;
      promptMode?: unknown;
      promptSnapshot?: unknown;
      responseText?: unknown;
      model?: unknown;
      requestId?: unknown;
    };

    if (body.requestId !== undefined) {
      if (body.folderPath !== '.' || typeof body.sessionId !== 'string' || typeof body.requestId !== 'string') {
        return NextResponse.json({ error: '저장된 요청 ID가 필요합니다.' }, { status: 400 });
      }
      const responseError = validateResponse(body.responseText);
      if (responseError) return NextResponse.json({ error: responseError }, { status: 400 });
      const responseText = normalizeResponse(body.responseText);
      let perspective!: SideChatWebPerspective;
      await mutateSession('.', body.sessionId, (session) => {
        if (session.sessionKind !== 'sidechat') throw new WebRequestError(400, '독립 사이드채팅이 아닙니다.');
        const question = session.messages.find((m) => m.role === 'user' && m.sideChatWebRequests?.some((r) => r.id === body.requestId));
        const stored = question?.sideChatWebRequests?.find((r) => r.id === body.requestId);
        if (!question || !stored || stored.sessionId !== session.id || stored.questionMessageId !== question.id) throw new WebRequestError(404, '저장된 요청을 찾을 수 없습니다.');
        if (promptHash(stored.promptSnapshot) !== stored.promptSha256) throw new WebRequestError(409, '저장된 요청의 무결성을 확인할 수 없습니다.');
        if ((body.provider !== undefined && body.provider !== stored.provider) || (body.promptMode !== undefined && body.promptMode !== stored.promptMode)
          || (body.promptSnapshot !== undefined && body.promptSnapshot !== stored.promptSnapshot)) throw new WebRequestError(409, '저장된 요청과 다른 전송 정보입니다.');
        const existing = question.sideChatPerspectives?.find((p) => p.requestId === stored.id && p.responseText === responseText);
        if (existing) { perspective = existing; return session; }
        perspective = { id: `sidechat-web-${randomUUID()}`, requestId: stored.id, provider: stored.provider, acquisition: 'user-paste',
          promptMode: stored.promptMode, promptSnapshot: stored.promptSnapshot, promptSha256: stored.promptSha256,
          responseText, importedAt: new Date().toISOString(),
          ...(typeof body.model === 'string' && body.model.trim() ? { model: body.model.trim().slice(0, 120) } : {}),
        };
        return { ...session, messages: session.messages.map((m) => m.id === question.id ? { ...m, sideChatPerspectives: [...(m.sideChatPerspectives || []), perspective] } : m) };
      });
      return NextResponse.json({ perspective });
    }

    if (
      typeof body.folderPath !== 'string'
      || typeof body.sessionId !== 'string'
      || typeof body.questionMessageId !== 'string'
      || !isProviderId(body.provider)
      || !isOutboundMode(body.promptMode)
      || typeof body.promptSnapshot !== 'string'
    ) {
      return NextResponse.json({ error: '사이드채팅 웹 답변 정보가 올바르지 않습니다.' }, { status: 400 });
    }
    const provider = body.provider;
    const promptMode = body.promptMode;

    const responseError = validateResponse(body.responseText);
    if (responseError) return NextResponse.json({ error: responseError }, { status: 400 });
    const responseText = normalizeResponse(body.responseText);
    const model = typeof body.model === 'string' && body.model.trim()
      ? body.model.trim().slice(0, 120)
      : undefined;

    const session = await getSession(body.folderPath, body.sessionId);
    if (!session) return NextResponse.json({ error: '사이드채팅을 찾을 수 없습니다.' }, { status: 404 });
    if (session.sessionKind !== 'sidechat') {
      return NextResponse.json({ error: '웹 답변은 독립 사이드채팅에만 저장할 수 있습니다.' }, { status: 400 });
    }

    const question = session.messages.find((message) => message.id === body.questionMessageId);
    if (!isQuestionMessage(question)) {
      return NextResponse.json({ error: '연결할 사이드채팅 질문을 찾을 수 없습니다.' }, { status: 400 });
    }
    const answerMessageId = typeof body.answerMessageId === 'string' && body.answerMessageId.trim()
      ? body.answerMessageId.trim()
      : undefined;
    if (promptMode === 'source-question-answer' && !answerMessageId) {
      return NextResponse.json({ error: '비교할 PageDock 답변을 선택해 주세요.' }, { status: 400 });
    }

    const sourceText = question.sourceContext?.text;
    if (promptMode !== 'question' && !canUseSideChatSource(question.sourceContext)) {
      return NextResponse.json({ error: '원문을 포함하려면 한 페이지의 선택 원문이 질문에 연결되어야 합니다.' }, { status: 400 });
    }
    const answer = answerMessageId
      ? session.messages.find((message) => message.id === answerMessageId)
      : undefined;
    if (promptMode === 'source-question-answer' && (
      answer?.role !== 'assistant' || answer.replyToMessageId !== question.id || !answer.content.trim()
    )) {
      return NextResponse.json({ error: '현재 질문에 연결된 PageDock 답변만 함께 보낼 수 있습니다.' }, { status: 400 });
    }

    const promptSnapshot = buildSideChatOutboundPrompt({
      mode: promptMode,
      question: question.content,
      sourceText,
      answerText: answer?.content,
      version: body.promptSnapshot.includes('(pagedock-sidechat-v1)') ? 'pagedock-sidechat-v1' : undefined,
    });
    if (body.promptSnapshot !== promptSnapshot) {
      return NextResponse.json({ error: '확인한 웹 전송 내용이 바뀌었습니다. 미리보기를 다시 열어 주세요.' }, { status: 400 });
    }

    const promptSha256 = createHash('sha256').update(promptSnapshot, 'utf8').digest('hex');
    let perspective: SideChatWebPerspective | undefined;
    const nextSession = await mutateSession(body.folderPath, body.sessionId, (currentSession) => {
      if (currentSession.sessionKind !== 'sidechat') {
        throw new SideChatPerspectiveError(400, '웹 답변은 독립 사이드채팅에만 저장할 수 있습니다.');
      }
      const currentQuestion = currentSession.messages.find((message) => message.id === body.questionMessageId);
      if (!isQuestionMessage(currentQuestion)) {
        throw new SideChatPerspectiveError(400, '연결할 사이드채팅 질문을 찾을 수 없습니다.');
      }
      const currentAnswer = answerMessageId
        ? currentSession.messages.find((message) => message.id === answerMessageId)
        : undefined;
      if (promptMode === 'source-question-answer' && (
        currentAnswer?.role !== 'assistant'
        || currentAnswer.replyToMessageId !== currentQuestion.id
        || !currentAnswer.content.trim()
      )) {
        throw new SideChatPerspectiveError(400, '현재 질문에 연결된 PageDock 답변만 함께 보낼 수 있습니다.');
      }
      if (promptMode !== 'question' && !canUseSideChatSource(currentQuestion.sourceContext)) {
        throw new SideChatPerspectiveError(400, '원문을 포함할 수 없는 질문입니다.');
      }

      const currentPromptSnapshot = buildSideChatOutboundPrompt({
        mode: promptMode,
        question: currentQuestion.content,
        sourceText: currentQuestion.sourceContext?.text,
        answerText: currentAnswer?.content,
        version: typeof body.promptSnapshot === 'string' && body.promptSnapshot.includes('(pagedock-sidechat-v1)') ? 'pagedock-sidechat-v1' : undefined,
      });
      if (currentPromptSnapshot !== body.promptSnapshot) {
        throw new SideChatPerspectiveError(400, '확인한 웹 전송 내용이 바뀌었습니다. 미리보기를 다시 열어 주세요.');
      }

      const existing = (currentQuestion.sideChatPerspectives ?? []).find((candidate) => (
        candidate.provider === provider
        && candidate.promptMode === promptMode
        && candidate.promptSha256 === promptSha256
        && candidate.responseText === responseText
      ));
      if (existing) {
        perspective = existing;
        return currentSession;
      }

      perspective = {
        id: `sidechat-web-${randomUUID()}`,
        provider,
        acquisition: 'user-paste',
        promptMode,
        promptSnapshot: currentPromptSnapshot,
        promptSha256,
        responseText,
        importedAt: new Date().toISOString(),
        ...(model ? { model } : {}),
      };

      return {
        ...currentSession,
        messages: currentSession.messages.map((message) => (
          message.id === currentQuestion.id
            ? { ...message, sideChatPerspectives: [...(message.sideChatPerspectives ?? []), perspective!] }
            : message
        )),
      };
    });

    if (!perspective) throw new Error('웹 답변을 저장하지 못했습니다.');
    return NextResponse.json({ session: nextSession, perspective });
  } catch (error) {
    if (error instanceof SideChatPerspectiveError || error instanceof WebRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.startsWith('Session not found:')) {
      return NextResponse.json({ error: '사이드채팅을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ error: '웹 답변을 저장하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.' }, { status: 500 });
  }
}
