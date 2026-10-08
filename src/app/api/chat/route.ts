import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appendMessage, getSession, mutateSession } from '@/lib/annot-sessions';
import { getProviderRuntime } from '@/lib/ai-providers';
import { normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import { normalizeChatSourceContext } from '@/lib/ai-providers/source-context';
import { retrieveDocumentRecords, searchLibraryRecords, selectBoundedRecords } from '@/lib/record-retrieval';
import { markMobileBridgeExportDirtyForDocument } from '@/lib/mobile-bridge';
import { hasInvalidSideChatPdfPathHint, normalizeSideChatPdfPathHint } from '@/lib/side-chat';
import type { ReasoningEffort } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      folderPath,
      sessionId,
      prompt,
      model,
      reasoningEffort,
      currentPdfPath,
      sourceContext: requestedSourceContext,
      recordLookup: requestedRecordLookup,
      sourcePdfPath,
      userMessageId,
    } = body as {
      folderPath?: string;
      sessionId?: string;
      prompt?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      currentPdfPath?: string | null;
      sourceContext?: unknown;
      recordLookup?: unknown;
      sourcePdfPath?: unknown;
      userMessageId?: string;
    };

    if (!folderPath || !sessionId || !prompt?.trim()) {
      return NextResponse.json(
        { error: 'folderPath, sessionId, and prompt are required' },
        { status: 400 }
      );
    }

    const session = await getSession(folderPath, sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    if (requestedSourceContext && session.sessionKind === 'folder') {
      return NextResponse.json(
        { error: 'PDF 대화에서만 원문 위치를 연결할 수 있습니다.' },
        { status: 400 },
      );
    }
    if (hasInvalidSideChatPdfPathHint(sourcePdfPath)) {
      return NextResponse.json(
        { error: '원문 파일 경로가 올바르지 않습니다.' },
        { status: 400 },
      );
    }
    const normalizedSourcePdfPath = normalizeSideChatPdfPathHint(sourcePdfPath);
    const sourceContext = requestedSourceContext
      ? normalizeChatSourceContext(requestedSourceContext, { documentId: session.documentId })
      : undefined;
    if (requestedSourceContext && !sourceContext) {
      return NextResponse.json(
        { error: '선택 영역 정보가 올바르지 않습니다. 더 작은 한 페이지 범위를 선택해 주세요.' },
        { status: 400 },
      );
    }
    if (sourceContext && !session.documentId && session.sessionKind === 'pdf') {
      // Older PDF sessions may not yet have a registered document id. Their
      // persisted session PDF remains authoritative; never adopt a client id.
      delete sourceContext.documentId;
    }

    let recordContext: import('@/types').ChatRecordContextSnapshot | undefined;
    if (requestedRecordLookup !== undefined && session.sessionKind === 'pdf') {
      const recordRequest = requestedRecordLookup && typeof requestedRecordLookup === 'object'
        ? requestedRecordLookup as { enabled?: unknown; scope?: unknown; page?: unknown; includeIds?: unknown; snapshotHash?: unknown }
        : null;
      if (recordRequest?.enabled === true) {
        const ids = Array.isArray(recordRequest.includeIds)
          ? [...new Set(recordRequest.includeIds.filter((id): id is string => typeof id === 'string'))]
          : [];
        if (ids.length > 8) return NextResponse.json({ error: '한 번에 기록은 최대 8개까지 포함할 수 있습니다.' }, { status: 400 });
        const scope = recordRequest.scope === 'library' ? 'library' : 'document';
        const page = Number.isSafeInteger(recordRequest.page) && Number(recordRequest.page) > 0 ? Number(recordRequest.page) : undefined;
        if (!ids.length) return NextResponse.json({ error: 'AI에 포함할 기록을 먼저 선택해 주세요.' }, { status: 400 });
        if (scope === 'library') {
          const candidates = await searchLibraryRecords(prompt.trim(), { includeStudioDrafts: true });
          recordContext = selectBoundedRecords(prompt.trim(), candidates, { scope, includeIds: ids, limit: 8, totalChars: 8_000 });
        } else if (session.documentId) {
          recordContext = await retrieveDocumentRecords({ documentId: session.documentId, query: prompt.trim(), page, includeIds: ids });
        }
        if (!recordContext || recordContext.records.length !== ids.length) {
          return NextResponse.json({ error: '선택한 기록이 바뀌었거나 현재 검색 범위에서 찾을 수 없습니다. 다시 검색해 주세요.' }, { status: 409 });
        }
        if (typeof recordRequest.snapshotHash !== 'string' || recordRequest.snapshotHash !== recordContext.snapshotHash) {
          return NextResponse.json({ error: '확인한 기록 발췌가 달라졌습니다. 다시 확인해 주세요.' }, { status: 409 });
        }
      }
    }

    const userMessage = {
      id: userMessageId?.trim() || `u-${randomUUID()}`,
      role: 'user' as const,
      content: prompt.trim(),
      timestamp: new Date().toISOString(),
      sourceContext,
      sourcePdfPath: normalizedSourcePdfPath,
      ...(recordContext ? { recordContext } : {}),
    };
    const sessionModel = normalizeModelPreference(session.model);
    const resolvedModel = normalizeModelPreference(model || sessionModel);
    const sessionReasoningEffort = normalizeReasoningEffort(session.reasoningEffort);
    const resolvedReasoningEffort = normalizeReasoningEffort(reasoningEffort || sessionReasoningEffort);
    const providerSessionId = resolvedModel === sessionModel && resolvedReasoningEffort === sessionReasoningEffort
      ? session.providerSessionId
      : undefined;
    const runtime = getProviderRuntime(session.provider);
    const encoder = new TextEncoder();

    await mutateSession(folderPath, sessionId, (currentSession) => {
      const existingUserMessage = currentSession.messages.find((message) => message.id === userMessage.id);
      if (existingUserMessage) {
        if (existingUserMessage.role !== 'user' || existingUserMessage.content !== userMessage.content) {
          throw new Error('같은 질문 ID에 다른 내용이 연결되어 있습니다.');
        }
        return currentSession;
      }
      return {
        ...currentSession,
        messages: appendMessage(currentSession.messages, userMessage),
      };
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const writeEvent = (payload: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        void (async () => {
          try {
            const turn = await runtime.runTurn({
              providerSessionId,
              model: resolvedModel,
              reasoningEffort: resolvedReasoningEffort,
              folderPath,
              prompt: prompt.trim(),
              sessionKind: session.sessionKind,
            currentPdfPath: session.sessionKind === 'sidechat'
              ? null
              : session.pdfPath ?? currentPdfPath ?? null,
              sourceContext,
              recordContext,
              conversation: session.messages
                .filter((message) => message.role === 'user' || message.role === 'assistant')
                .filter((message) => message.id !== userMessage.id)
                .slice(-24)
                .map((message) => ({
                  role: message.role,
                  content: message.content,
                })),
            }, {
              onEvent: (event) => {
                writeEvent(event);
              },
            });

            const assistantMessage = {
              id: `a-${randomUUID()}`,
              role: 'assistant' as const,
              content: turn.content,
              timestamp: new Date().toISOString(),
              model: resolvedModel,
              reasoningEffort: resolvedReasoningEffort,
              sourceContext,
              replyToMessageId: userMessage.id,
            };

            const messageSavedSession = await mutateSession(folderPath, sessionId, (currentSession) => ({
              ...currentSession,
              messages: currentSession.messages.some((message) => message.id === userMessage.id)
                ? appendMessage(currentSession.messages, assistantMessage)
                : appendMessage(appendMessage(currentSession.messages, userMessage), assistantMessage),
              providerSessionId: turn.providerSessionId,
              model: resolvedModel,
            }));
            if (session.sessionKind === 'pdf') {
              await markMobileBridgeExportDirtyForDocument(sourceContext?.documentId ?? session.documentId).catch(() => undefined);
            }

            writeEvent({
              type: 'final',
              content: assistantMessage.content,
              model: assistantMessage.model,
              provider: session.provider,
              session: messageSavedSession,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Internal server error';
            writeEvent({ type: 'error', message });
          } finally {
            controller.close();
          }
        })();
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
