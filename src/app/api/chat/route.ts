import { NextRequest, NextResponse } from 'next/server';
import { appendMessage, getSession, updateSession } from '@/lib/annot-sessions';
import { getProviderRuntime } from '@/lib/ai-providers';
import { normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
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
    } = body as {
      folderPath?: string;
      sessionId?: string;
      prompt?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      currentPdfPath?: string | null;
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

    const userMessage = {
      id: `u-${Date.now()}`,
      role: 'user' as const,
      content: prompt.trim(),
      timestamp: new Date().toISOString(),
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
              currentPdfPath: currentPdfPath ?? session.pdfPath ?? null,
            }, {
              onEvent: (event) => {
                writeEvent(event);
              },
            });

            const assistantMessage = {
              id: `a-${Date.now()}`,
              role: 'assistant' as const,
              content: turn.content,
              timestamp: new Date().toISOString(),
              model: resolvedModel,
              reasoningEffort: resolvedReasoningEffort,
            };

            const nextMessages = appendMessage(
              appendMessage(session.messages, userMessage),
              assistantMessage,
            );

            const messageSavedSession = await updateSession(folderPath, sessionId, {
              messages: nextMessages,
              provider: session.provider,
              providerSessionId: turn.providerSessionId,
              model: resolvedModel,
            });

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
