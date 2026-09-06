import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/annot-sessions';
import {
  buildDeepSeekWebPrompt,
  canRequestDeepSeekWebPerspective,
  normalizeManualPerspectiveResponse,
} from '@/lib/deepseek-web-bridge';
import { ChatSecondaryPerspective } from '@/types';

function normalizeClientTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      folderPath?: unknown;
      sessionId?: unknown;
      assistantMessageId?: unknown;
      promptSnapshot?: unknown;
      responseText?: unknown;
      requestedAt?: unknown;
    };

    if (
      typeof body.folderPath !== 'string'
      || typeof body.sessionId !== 'string'
      || typeof body.assistantMessageId !== 'string'
      || typeof body.promptSnapshot !== 'string'
    ) {
      return NextResponse.json({ error: '가져올 대화 정보가 올바르지 않습니다.' }, { status: 400 });
    }

    const responseText = normalizeManualPerspectiveResponse(body.responseText);
    if (!responseText) {
      return NextResponse.json({ error: 'DeepSeek 답변을 붙여넣어 주세요.' }, { status: 400 });
    }

    const session = await getSession(body.folderPath, body.sessionId);
    if (!session) {
      return NextResponse.json({ error: '대화를 찾을 수 없습니다.' }, { status: 404 });
    }

    const sourceMessage = session.messages.find((message) => message.id === body.assistantMessageId);
    if (!sourceMessage || !canRequestDeepSeekWebPerspective(sourceMessage)) {
      return NextResponse.json({ error: '선택 원문에 연결된 AI 답변에서만 다른 관점을 가져올 수 있습니다.' }, { status: 400 });
    }

    const questionMessage = session.messages.find((message) => message.id === sourceMessage.replyToMessageId);
    if (!questionMessage || questionMessage.role !== 'user') {
      return NextResponse.json({ error: '연결된 원래 질문을 찾을 수 없습니다.' }, { status: 400 });
    }

    const promptSnapshot = buildDeepSeekWebPrompt({
      sourceText: sourceMessage.sourceContext.text ?? '',
      question: questionMessage.content,
    });
    if (body.promptSnapshot !== promptSnapshot) {
      return NextResponse.json({ error: '확인한 전송 내용과 일치하지 않습니다. 다른 관점 보기를 다시 시작해 주세요.' }, { status: 400 });
    }

    const importedAt = new Date().toISOString();
    const perspective: ChatSecondaryPerspective = {
      id: `deepseek-web-${randomUUID()}`,
      provider: 'deepseek',
      transport: 'web-manual',
      acquisition: 'user-paste',
      sourceMessageId: sourceMessage.id,
      questionMessageId: questionMessage.id,
      promptSnapshot,
      promptSha256: createHash('sha256').update(promptSnapshot, 'utf8').digest('hex'),
      responseText,
      requestedAt: normalizeClientTimestamp(body.requestedAt, importedAt),
      importedAt,
      model: null,
    };

    const messages = session.messages.map((message) => (
      message.id === sourceMessage.id
        ? {
          ...message,
          secondaryPerspectives: [...(message.secondaryPerspectives ?? []), perspective],
        }
        : message
    ));
    const nextSession = await updateSession(body.folderPath, body.sessionId, { messages });

    return NextResponse.json({ session: nextSession, perspective });
  } catch {
    return NextResponse.json({ error: 'DeepSeek 답변을 저장하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.' }, { status: 500 });
  }
}
