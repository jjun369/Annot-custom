import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/annot-sessions';
import { getProviderRuntime } from '@/lib/ai-providers';
import { normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import { previewLibraryRecords, retrieveDocumentRecords, searchLibraryRecords, selectBoundedRecords, selectLibraryRecordSnapshot } from '@/lib/record-retrieval';
import { buildConceptSynthesisPrompt } from '@/lib/concept-synthesis-prompt';
import { createStudioDraft, type StudioReference } from '@/lib/sources-studio';
import type { AIProvider, ReasoningEffort } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'chat-prepare') {
      const folderPath = typeof body.folderPath === 'string' ? body.folderPath : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const query = typeof body.query === 'string' ? body.query.trim().slice(0, 4_000) : '';
      const ids = Array.isArray(body.recordIds) ? [...new Set(body.recordIds.filter((id): id is string => typeof id === 'string'))] : [];
      if (!query || !ids.length || ids.length > 8) return NextResponse.json({ error: '질문과 최대 8개의 기록을 선택해 주세요.' }, { status: 400 });
      if (typeof body.scope === 'string' && !['document', 'library'].includes(body.scope)) return NextResponse.json({ error: '기록 검색 범위가 올바르지 않습니다.' }, { status: 400 });
      const scope = body.scope === 'library' ? 'library' : 'document';
      if (scope === 'library') {
        const candidates = await searchLibraryRecords(query, { includeStudioDrafts: true });
        const snapshot = selectBoundedRecords(query, candidates, { scope, includeIds: ids, limit: 8, totalChars: 8_000 });
        if (snapshot.records.length !== ids.length) return NextResponse.json({ error: '선택한 기록이 바뀌었습니다. 다시 검색해 주세요.' }, { status: 409 });
        return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (!folderPath || !sessionId) return NextResponse.json({ error: 'PDF 대화가 필요합니다.' }, { status: 400 });
      const session = await getSession(folderPath, sessionId);
      if (!session || session.sessionKind !== 'pdf' || !session.documentId) return NextResponse.json({ error: '등록된 PDF 대화를 확인할 수 없습니다.' }, { status: 409 });
      const page = Number.isSafeInteger(body.page) && Number(body.page) > 0 ? Number(body.page) : undefined;
      const snapshot = await retrieveDocumentRecords({ documentId: session.documentId, query, page, includeIds: ids });
      if (snapshot.records.length !== ids.length) return NextResponse.json({ error: '선택한 기록이 바뀌었습니다. 다시 검색해 주세요.' }, { status: 409 });
      return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'chat-search') {
      const folderPath = typeof body.folderPath === 'string' ? body.folderPath : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const query = typeof body.query === 'string' ? body.query.trim().slice(0, 4_000) : '';
      if (!query) return NextResponse.json({ error: '검색어가 필요합니다.' }, { status: 400 });
      if (body.scope === 'library') {
        const records = await searchLibraryRecords(query, { includeStudioDrafts: true });
        return NextResponse.json(selectBoundedRecords(query, records, { scope: 'library' }), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (!folderPath || !sessionId) return NextResponse.json({ error: 'PDF 대화가 필요합니다.' }, { status: 400 });
      const session = await getSession(folderPath, sessionId);
      if (!session || session.sessionKind !== 'pdf' || !session.documentId) return NextResponse.json({ error: '등록된 PDF 대화를 확인할 수 없습니다.' }, { status: 409 });
      const page = Number.isSafeInteger(body.page) && Number(body.page) > 0 ? Number(body.page) : undefined;
      const result = await retrieveDocumentRecords({ documentId: session.documentId, query, page });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'library-search') {
      const query = typeof body.query === 'string' ? body.query.trim().slice(0, 2_000) : '';
      if (!query) return NextResponse.json({ records: [] }, { headers: { 'Cache-Control': 'no-store' } });
      const candidates = await searchLibraryRecords(query, { includeStudioDrafts: body.includeStudioDrafts === true });
      return NextResponse.json(previewLibraryRecords(query, candidates), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'save-synthesis-draft') {
      const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2_000) : '';
      const ids = Array.isArray(body.recordIds) ? [...new Set(body.recordIds.filter((id): id is string => typeof id === 'string'))] : [];
      const content = typeof body.content === 'string' ? body.content : '';
      if (body.includeStudioDrafts !== undefined && typeof body.includeStudioDrafts !== 'boolean') return NextResponse.json({ error: 'Studio 초안 검색 선택이 올바르지 않습니다.' }, { status: 400 });
      const includeStudioDrafts = body.includeStudioDrafts === true;
      if (!question || !content.trim() || !ids.length || ids.length > 8) return NextResponse.json({ error: '주제, 제안 본문과 최대 8개의 선택 기록이 필요합니다.' }, { status: 400 });
      const snapshot = await selectLibraryRecordSnapshot(question, ids, { includeStudioDrafts });
      if (snapshot.records.length !== ids.length) return NextResponse.json({ error: '선택한 자료가 바뀌었습니다. 원문을 다시 확인해 주세요.' }, { status: 409 });
      if (typeof body.snapshotHash !== 'string' || body.snapshotHash !== snapshot.snapshotHash) return NextResponse.json({ error: '미리보기 이후 기록이 달라졌습니다. 새 미리보기를 준비하고 제안을 다시 생성해 주세요.' }, { status: 409 });
      const references: StudioReference[] = snapshot.records.map((record) => ({
        sourceId: record.id, title: record.title, kind: 'memo', originLabel: record.originLabel,
        sourceUpdatedAt: record.sourceUpdatedAt || new Date(0).toISOString(), excerpt: record.excerpt,
        includeInRequest: false,
        evidenceSnapshot: { provenanceLabel: `AI 합성 제안 · ${record.provenanceLabel}`, ...(record.anchor ? { anchor: record.anchor } : {}) },
      }));
      const draft = await createStudioDraft({ title: `개념 정리 · ${question.slice(0, 80)}`, text: content, references });
      return NextResponse.json({ draft }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'prepare-synthesis' || action === 'synthesize') {
      const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2_000) : '';
      const ids = Array.isArray(body.recordIds) ? [...new Set(body.recordIds.filter((id): id is string => typeof id === 'string'))] : [];
      if (body.includeStudioDrafts !== undefined && typeof body.includeStudioDrafts !== 'boolean') return NextResponse.json({ error: 'Studio 초안 검색 선택이 올바르지 않습니다.' }, { status: 400 });
      const includeStudioDrafts = body.includeStudioDrafts === true;
      if (ids.length > 8) return NextResponse.json({ error: '한 번에 기록은 최대 8개까지 선택할 수 있습니다.' }, { status: 400 });
      if (!question || !ids.length) return NextResponse.json({ error: '주제와 선택한 기록이 필요합니다.' }, { status: 400 });
      const snapshot = await selectLibraryRecordSnapshot(question, ids, { includeStudioDrafts });
      if (snapshot.records.length !== ids.length) return NextResponse.json({ error: '선택한 자료가 바뀌었거나 검색 결과에서 확인되지 않습니다. 다시 검색해 주세요.' }, { status: 409 });
      if (action === 'prepare-synthesis') return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
      if (typeof body.snapshotHash !== 'string' || body.snapshotHash !== snapshot.snapshotHash) return NextResponse.json({ error: '미리보기 이후 기록이 달라졌습니다. 자료를 다시 확인해 주세요.' }, { status: 409 });
      const provider: AIProvider = body.provider === 'claude' ? 'claude' : 'codex';
      const model = normalizeModelPreference(typeof body.model === 'string' ? body.model : undefined);
      const reasoningEffort: ReasoningEffort = normalizeReasoningEffort(body.reasoningEffort as ReasoningEffort | undefined);
      const prompt = buildConceptSynthesisPrompt(question);
      const result = await getProviderRuntime(provider).runTurn({
        model, reasoningEffort, folderPath: '', sessionKind: 'sidechat', prompt,
        recordContext: snapshot,
      });
      if (request.signal.aborted) return NextResponse.json({ error: '요청이 끝난 뒤 화면이 닫혔습니다. 초안은 저장되지 않았습니다.' }, { status: 499 });
      const current = await selectLibraryRecordSnapshot(question, ids, { includeStudioDrafts });
      if (JSON.stringify(current.records) !== JSON.stringify(snapshot.records)) return NextResponse.json({ error: 'AI 응답을 기다리는 동안 원본 메모가 바뀌었습니다. 결과를 버렸습니다.' }, { status: 409 });
      return NextResponse.json({ content: result.content, provider, model, records: snapshot.records,
        snapshotHash: snapshot.snapshotHash, note: 'AI 제안입니다. 인용 ID와 출처 발췌만 연결했으며, 주장의 사실 여부는 검증하지 않았습니다.' });
    }
    return NextResponse.json({ error: '지원하지 않는 기록 작업입니다.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '기록 검색을 완료하지 못했습니다.' }, { status: 400 });
  }
}
