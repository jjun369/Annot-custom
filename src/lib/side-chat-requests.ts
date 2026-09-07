import { createHash } from 'node:crypto';
import { mutateSession } from '@/lib/annot-sessions';
import { buildSideChatOutboundPrompt, canUseSideChatSource, SIDE_CHAT_MAX_PROMPT_CHARS, SIDE_CHAT_PROMPT_VERSION, SIDE_CHAT_OUTBOUND_MODES, SIDE_CHAT_WEB_PROVIDERS, sideChatModeUsesAnswer, sideChatModeUsesSource } from '@/lib/side-chat';
import type { SideChatOutboundMode, SideChatWebProviderId, SideChatWebRequest } from '@/types';

export class WebRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const promptHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export async function prepareWebRequest(body: Record<string, unknown>) {
  if (typeof body.sessionId !== 'string' || typeof body.questionMessageId !== 'string'
    || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(body.requestId)
    || !SIDE_CHAT_WEB_PROVIDERS.some((p) => p.id === body.provider)
    || !SIDE_CHAT_OUTBOUND_MODES.some((m) => m.id === body.promptMode)
    || typeof body.promptSnapshot !== 'string' || body.promptSnapshot.length > SIDE_CHAT_MAX_PROMPT_CHARS) {
    throw new WebRequestError(400, '질문과 확인한 전송 내용이 필요합니다.');
  }
  const sessionId = body.sessionId;
  let request!: SideChatWebRequest;
  await mutateSession('.', sessionId, (session) => {
    if (session.sessionKind !== 'sidechat') throw new WebRequestError(400, '독립 사이드채팅에서만 준비할 수 있습니다.');
    const question = session.messages.find((m) => m.id === body.questionMessageId && m.role === 'user');
    if (!question) throw new WebRequestError(404, '질문을 찾을 수 없습니다.');
    const existing = session.messages.flatMap((m) => m.sideChatWebRequests || []).find((r) => r.id === body.requestId);
    if (existing) {
      if (existing.questionMessageId !== question.id || existing.provider !== body.provider || existing.promptMode !== body.promptMode
        || existing.promptSnapshot !== body.promptSnapshot || (existing.answerMessageId || undefined) !== (body.answerMessageId || undefined)) {
        throw new WebRequestError(409, '같은 요청 ID에 다른 전송 내용이 있습니다.');
      }
      request = existing;
      return session;
    }
    const mode = body.promptMode as SideChatOutboundMode;
    const usesAnswer = sideChatModeUsesAnswer(mode);
    const answer = usesAnswer ? session.messages.find((m) => m.id === body.answerMessageId && m.role === 'assistant' && m.replyToMessageId === question.id) : undefined;
    if (usesAnswer && !answer?.content.trim()) throw new WebRequestError(400, '이 질문에 연결된 답변을 선택해 주세요.');
    if (sideChatModeUsesSource(mode) && !canUseSideChatSource(question.sourceContext)) throw new WebRequestError(400, '선택 원문이 필요합니다.');
    const promptSnapshot = buildSideChatOutboundPrompt({ mode, question: question.content, sourceText: question.sourceContext?.text, answerText: answer?.content });
    if (promptSnapshot !== body.promptSnapshot) throw new WebRequestError(409, '전송 내용이 바뀌었습니다. 갱신된 미리보기를 확인해 주세요.');
    request = {
      id: body.requestId as string, sessionId, questionMessageId: question.id, provider: body.provider as SideChatWebProviderId,
      intent: usesAnswer ? 'review' : 'independent', promptMode: mode, promptVersion: SIDE_CHAT_PROMPT_VERSION,
      promptSnapshot, promptSha256: promptHash(promptSnapshot), questionText: question.content,
      ...(answer ? { answerMessageId: answer.id, answerText: answer.content } : {}),
      ...(question.sourceContext ? { sourceContext: structuredClone(question.sourceContext) } : {}),
      ...(question.sourcePdfPath ? { sourcePdfPath: question.sourcePdfPath } : {}), preparedAt: new Date().toISOString(),
    };
    return { ...session, messages: session.messages.map((m) => m.id === question.id ? { ...m, sideChatWebRequests: [...(m.sideChatWebRequests || []), request] } : m) };
  });
  return request;
}

export async function acknowledgeWebCopy(sessionId: string, requestId: string) {
  let request!: SideChatWebRequest;
  await mutateSession('.', sessionId, (session) => {
    if (session.sessionKind !== 'sidechat') throw new WebRequestError(400, '독립 사이드채팅이 아닙니다.');
    const question = session.messages.find((m) => m.sideChatWebRequests?.some((r) => r.id === requestId));
    const existing = question?.sideChatWebRequests?.find((r) => r.id === requestId);
    if (!existing || !question) throw new WebRequestError(404, '요청을 찾을 수 없습니다.');
    request = existing.copiedAt ? existing : { ...existing, copiedAt: new Date().toISOString() };
    if (request === existing) return session;
    return { ...session, messages: session.messages.map((m) => m.id === question.id ? { ...m, sideChatWebRequests: m.sideChatWebRequests?.map((r) => r.id === requestId ? request : r) } : m) };
  });
  return request;
}
