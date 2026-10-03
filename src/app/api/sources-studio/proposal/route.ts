import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { getProviderRuntime } from '@/lib/ai-providers';
import { normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import { getStudioSnapshot, isStudioProposalBaseCurrent, validateStudioProposalBase } from '@/lib/sources-studio';
import { buildStudioPrompt, inspectProposalReferenceIds, makeStudioExcerpt } from '@/lib/sources-studio-shared';
import type { StudioDraft } from '@/lib/sources-studio';
import type { AIProvider, ReasoningEffort } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      draftId?: string; expectedRevision?: number; instruction?: string;
      referenceIds?: string[]; provider?: AIProvider; model?: string; reasoningEffort?: ReasoningEffort;
      validateOnly?: boolean; expectedTitle?: string; expectedText?: string; expectedReferences?: unknown;
    };
    if (!body.draftId || !Number.isInteger(body.expectedRevision)) {
      return NextResponse.json({ error: '저장된 초안과 revision이 필요합니다.' }, { status: 400 });
    }
    const snapshot = await getStudioSnapshot();
    const draft = snapshot.drafts.find((item) => item.id === body.draftId);
    if (!draft) return NextResponse.json({ error: '초안을 찾을 수 없습니다.' }, { status: 404 });
    if (draft.revision !== body.expectedRevision) return NextResponse.json({ error: '초안이 바뀌었습니다. 저장 후 요청을 다시 준비해 주세요.' }, { status: 409 });
    const ids = Array.isArray(body.referenceIds) ? [...new Set(body.referenceIds.filter((id): id is string => typeof id === 'string'))] : [];
    if (ids.length > 6) return NextResponse.json({ error: '한 번의 요청에는 자료를 최대 6개까지 포함할 수 있습니다.' }, { status: 400 });
    if (body.validateOnly === true) {
      if (typeof body.expectedTitle !== 'string' || typeof body.expectedText !== 'string'
        || !Array.isArray(body.expectedReferences)) return NextResponse.json({ error: '제안 기준 자료가 올바르지 않습니다.' }, { status: 400 });
      const valid = isStudioProposalBaseCurrent({
        draft, sources: snapshot.sources, expectedRevision: body.expectedRevision,
        expectedTitle: body.expectedTitle, expectedText: body.expectedText,
        expectedReferences: body.expectedReferences as StudioDraft['references'], selectedSourceIds: ids,
      });
      return valid
        ? NextResponse.json({ valid: true })
        : NextResponse.json({ valid: false, error: '제안 이후 초안이나 자료가 바뀌어 이 결과는 적용할 수 없습니다.' }, { status: 409 });
    }
    const shelf = new Map(draft.references.map((reference) => [reference.sourceId, reference]));
    const selected = ids.map((id) => {
      const reference = shelf.get(id);
      if (!reference || !reference.includeInRequest) throw new Error('이번 요청에 포함하도록 저장된 참조만 보낼 수 있습니다. 먼저 초안을 저장해 주세요.');
      const currentSource = snapshot.sources.find((source) => source.id === id);
      if (!currentSource) throw new Error(`선택 자료를 찾을 수 없습니다: ${reference.title}`);
      if (makeStudioExcerpt(currentSource.text) !== reference.excerpt
        || currentSource.title !== reference.title || currentSource.kind !== reference.kind
        || currentSource.originLabel !== reference.originLabel) {
        throw new Error(`참조 자료가 바뀌었습니다: ${reference.title}. 참조를 제거한 뒤 다시 추가해 주세요.`);
      }
      return reference;
    });
    const provider: AIProvider = body.provider === 'claude' ? 'claude' : 'codex';
    const model = normalizeModelPreference(body.model);
    const reasoningEffort = normalizeReasoningEffort(body.reasoningEffort);
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 8_000) : '';
    if (!instruction) return NextResponse.json({ error: '요청 내용을 적어 주세요.' }, { status: 400 });
    const prompt = buildStudioPrompt({
      draftTitle: draft.title,
      draftText: draft.text,
      instruction,
      references: selected,
    });
    const result = await getProviderRuntime(provider).runTurn({
      model,
      reasoningEffort,
      folderPath: '',
      sessionKind: 'sidechat',
      prompt,
    });
    if (request.signal.aborted) return NextResponse.json({ error: '요청이 끝난 뒤 화면이 닫혔습니다. 초안에는 반영되지 않았습니다.' }, { status: 499 });
    const stillCurrent = await validateStudioProposalBase({
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedTitle: draft.title,
      expectedText: draft.text,
      expectedReferences: draft.references,
      selectedSourceIds: ids,
    });
    if (!stillCurrent) return NextResponse.json({ error: 'AI 응답을 기다리는 동안 초안 또는 선택 자료가 바뀌었습니다. 결과를 버렸습니다.' }, { status: 409 });
    const selectedIds = selected.map((reference) => reference.sourceId);
    return NextResponse.json({
      requestId: randomUUID(),
      content: result.content,
      provider,
      model,
      selectedIds,
      unselectedReferenceIds: inspectProposalReferenceIds(result.content, selectedIds),
      requestPreview: prompt,
      note: 'AI 초안입니다. 인용 ID는 선택 집합과 대조했지만 주장과 원문의 함의는 검증하지 않았습니다.',
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI 제안을 만들지 못했습니다.' }, { status: 400 });
  }
}
