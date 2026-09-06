import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, mutateSession } from '@/lib/annot-sessions';
import {
  buildDeepSeekWebPrompt,
  canRequestDeepSeekWebPerspective,
  getManualPerspectiveResponseError,
  normalizeManualPerspectiveResponse,
} from '@/lib/deepseek-web-bridge';
import { ChatMessage, ChatSecondaryPerspective } from '@/types';

class DeepSeekPerspectiveRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function normalizeClientTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function canUseDirectQuestionAnchor(message: ChatMessage): boolean {
  return message.role === 'user'
    && Boolean(message.content.trim())
    && message.sourceContext?.scope === 'selection'
    && Boolean(message.sourceContext.text?.trim());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folderPath?: unknown;
      sessionId?: unknown;
      assistantMessageId?: unknown;
      questionMessageId?: unknown;
      promptSnapshot?: unknown;
      responseText?: unknown;
      requestedAt?: unknown;
    };

    if (
      typeof body.folderPath !== 'string'
      || typeof body.sessionId !== 'string'
      || (typeof body.assistantMessageId !== 'string' && typeof body.questionMessageId !== 'string')
      || typeof body.promptSnapshot !== 'string'
    ) {
      return NextResponse.json({ error: '가져올 대화 정보가 올바르지 않습니다.' }, { status: 400 });
    }

    const responseError = getManualPerspectiveResponseError(body.responseText);
    if (responseError) {
      return NextResponse.json({ error: responseError }, { status: 400 });
    }
    const responseText = normalizeManualPerspectiveResponse(body.responseText)!;

    const session = await getSession(body.folderPath, body.sessionId);
    if (!session) {
      return NextResponse.json({ error: '대화를 찾을 수 없습니다.' }, { status: 404 });
    }

    const isDirectQuestion = typeof body.questionMessageId === 'string' && typeof body.assistantMessageId !== 'string';
    const sourceMessage = session.messages.find((message) => message.id === (isDirectQuestion ? body.questionMessageId : body.assistantMessageId));
    if (!sourceMessage || (isDirectQuestion ? !canUseDirectQuestionAnchor(sourceMessage) : !canRequestDeepSeekWebPerspective(sourceMessage))) {
      return NextResponse.json({ error: isDirectQuestion ? '선택 원문에 연결된 질문에서만 DeepSeek 답변을 가져올 수 있습니다.' : '선택 원문에 연결된 AI 답변에서만 다른 관점을 가져올 수 있습니다.' }, { status: 400 });
    }

    const questionMessage = isDirectQuestion
      ? sourceMessage
      : session.messages.find((message) => message.id === sourceMessage.replyToMessageId);
    if (!questionMessage || questionMessage.role !== 'user') {
      return NextResponse.json({ error: '연결된 원래 질문을 찾을 수 없습니다.' }, { status: 400 });
    }

    const promptSnapshot = buildDeepSeekWebPrompt({
      sourceText: sourceMessage.sourceContext?.text ?? '',
      question: questionMessage.content,
    });
    if (body.promptSnapshot !== promptSnapshot) {
      return NextResponse.json({ error: '확인한 전송 내용과 일치하지 않습니다. 다른 관점 보기를 다시 시작해 주세요.' }, { status: 400 });
    }

    let perspective: ChatSecondaryPerspective | undefined;
    const promptSha256 = createHash('sha256').update(promptSnapshot, 'utf8').digest('hex');
    const requestedAt = normalizeClientTimestamp(body.requestedAt, '');
    const nextSession = await mutateSession(body.folderPath, body.sessionId, (currentSession) => {
      const currentSourceMessage = currentSession.messages.find((message) => message.id === (isDirectQuestion ? body.questionMessageId : body.assistantMessageId));
      if (!currentSourceMessage || (isDirectQuestion ? !canUseDirectQuestionAnchor(currentSourceMessage) : !canRequestDeepSeekWebPerspective(currentSourceMessage))) {
        throw new DeepSeekPerspectiveRequestError(400, isDirectQuestion ? '선택 원문에 연결된 질문에서만 DeepSeek 답변을 가져올 수 있습니다.' : '선택 원문에 연결된 AI 답변에서만 다른 관점을 가져올 수 있습니다.');
      }

      const currentQuestionMessage = isDirectQuestion
        ? currentSourceMessage
        : currentSession.messages.find((message) => message.id === currentSourceMessage.replyToMessageId);
      if (!currentQuestionMessage || currentQuestionMessage.role !== 'user') {
        throw new DeepSeekPerspectiveRequestError(400, '연결된 원래 질문을 찾을 수 없습니다.');
      }

      const currentPromptSnapshot = buildDeepSeekWebPrompt({
        sourceText: currentSourceMessage.sourceContext?.text ?? '',
        question: currentQuestionMessage.content,
      });
      if (currentPromptSnapshot !== body.promptSnapshot) {
        throw new DeepSeekPerspectiveRequestError(400, '확인한 전송 내용과 일치하지 않습니다. 다른 관점 보기를 다시 시작해 주세요.');
      }

      const existingPerspective = (currentSourceMessage.secondaryPerspectives ?? []).find((candidate) => (
        candidate.provider === 'deepseek'
        && candidate.transport === 'web-manual'
        && candidate.acquisition === 'user-paste'
        && candidate.sourceMessageId === currentSourceMessage.id
        && candidate.questionMessageId === currentQuestionMessage.id
        && candidate.promptSha256 === promptSha256
        && candidate.responseText === responseText
      ));
      if (existingPerspective) {
        perspective = existingPerspective;
        return currentSession;
      }

      const importedAt = new Date().toISOString();
      perspective = {
        id: `deepseek-web-${randomUUID()}`,
        provider: 'deepseek',
        transport: 'web-manual',
        acquisition: 'user-paste',
        sourceMessageId: currentSourceMessage.id,
        questionMessageId: currentQuestionMessage.id,
        promptSnapshot: currentPromptSnapshot,
        promptSha256,
        responseText,
        ...(requestedAt ? { requestedAt } : {}),
        importedAt,
        model: null,
      };

      return {
        ...currentSession,
        messages: currentSession.messages.map((message) => (
          message.id === currentSourceMessage.id
            ? {
              ...message,
              secondaryPerspectives: [...(message.secondaryPerspectives ?? []), perspective!],
            }
            : message
        )),
      };
    });

    if (!perspective) {
      throw new Error('DeepSeek 답변을 저장하지 못했습니다.');
    }

    return NextResponse.json({ session: nextSession, perspective });
  } catch (error) {
    if (error instanceof DeepSeekPerspectiveRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message.startsWith('Session not found:')) {
      return NextResponse.json({ error: '대화를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'DeepSeek 답변을 저장하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.' }, { status: 500 });
  }
}
