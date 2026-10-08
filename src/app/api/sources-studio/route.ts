import { NextRequest, NextResponse } from 'next/server';

import { captureKnowledgeNotes } from '@/lib/knowledge-store';
import {
  createStudioClip,
  createStudioDraft,
  createStudioMemo,
  deleteStudioDraft,
  getStudioSnapshot,
  saveStudioDraft,
  updateStudioSource,
  type StudioReference,
  type StudioSourceKind,
} from '@/lib/sources-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getStudioSnapshot(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '자료를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > 2 * 1024 * 1024) {
      return NextResponse.json({ error: '요청은 2MB 이하로 보내 주세요.' }, { status: 413 });
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>;
    if (body.action === 'memo') {
      const source = await createStudioMemo({
        title: typeof body.title === 'string' ? body.title : undefined,
        kind: typeof body.kind === 'string' ? body.kind as StudioSourceKind : undefined,
        text: typeof body.text === 'string' ? body.text : '',
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      });
      return NextResponse.json({ source }, { status: 201 });
    }
    if (body.action === 'clip') {
      const source = await createStudioClip({
        title: typeof body.title === 'string' ? body.title : '',
        kind: typeof body.kind === 'string' ? body.kind as StudioSourceKind : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
        text: typeof body.text === 'string' ? body.text : '',
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      });
      return NextResponse.json({ source }, { status: 201 });
    }
    if (body.action === 'draft') {
      const references = Array.isArray(body.references) ? body.references as StudioReference[] : [];
      return NextResponse.json({ draft: await createStudioDraft({
        title: typeof body.title === 'string' ? body.title : undefined,
        text: typeof body.text === 'string' ? body.text : undefined,
        references,
      }) }, { status: 201 });
    }
    if (body.action === 'save-draft') {
      const references = Array.isArray(body.references) ? body.references as StudioReference[] : [];
      const draft = await saveStudioDraft({
        id: typeof body.id === 'string' ? body.id : '',
        expectedRevision: Number(body.expectedRevision),
        title: typeof body.title === 'string' ? body.title : '',
        text: typeof body.text === 'string' ? body.text : '',
        references,
      });
      return NextResponse.json({ draft });
    }
    if (body.action === 'publish-draft') {
      const snapshot = await getStudioSnapshot();
      const draft = snapshot.drafts.find((item) => item.id === body.id);
      if (!draft) return NextResponse.json({ error: '초안을 찾을 수 없습니다.' }, { status: 404 });
      if (draft.revision !== Number(body.expectedRevision)) {
        return NextResponse.json({ error: '초안이 갱신되었습니다. 저장한 뒤 다시 시도해 주세요.' }, { status: 409 });
      }
      const refIndex = new Map(snapshot.sources.map((source) => [source.id, source]));
      const referenceLines = draft.references.map((reference) => {
        const source = refIndex.get(reference.sourceId);
        const evidence = reference.evidenceSnapshot;
        const anchorLabel = evidence?.anchor?.page ? ` · ${evidence.anchor.documentId ? `document ${evidence.anchor.documentId} ` : ''}p.${evidence.anchor.page}` : '';
        return source ? `- ${source.title} · ${source.originLabel} · ${evidence?.provenanceLabel ?? source.originLabel} · ${source.id}${anchorLabel}` : `- ${reference.title} · ${evidence?.provenanceLabel ?? reference.originLabel} · ${reference.sourceId}${anchorLabel}\n  > ${reference.excerpt}`;
      });
      const text = [draft.text.trim(), referenceLines.length
        ? `## Sources/Studio 참조 선반 (출처 표기이며 주장 검증 완료를 뜻하지 않음)\n${referenceLines.join('\n')}`
        : ''].filter(Boolean).join('\n\n');
      if (!text.trim()) return NextResponse.json({ error: '본문 또는 참조가 있는 초안을 먼저 작성해 주세요.' }, { status: 400 });
      const sourceName = `Studio · ${draft.title}`.slice(0, 300);
      const synthesisRefs = draft.references.filter((reference) => reference.evidenceSnapshot?.provenanceLabel.startsWith('AI 합성 제안'));
      const sourceAnchors = draft.references.flatMap((reference) => reference.evidenceSnapshot?.anchor ? [reference.evidenceSnapshot.anchor] : []);
      const captured = await captureKnowledgeNotes([{
        text, sourceName,
        ...(synthesisRefs.length ? { provenance: { kind: 'ai_inference' as const } } : {}),
        ...(sourceAnchors.length ? { sourceAnchors } : {}),
      }]);
      const noteId = captured.captured[0]?.id ?? captured.duplicates[0]?.existingNoteId;
      if (!noteId) throw new Error('초안 검토 자료를 만들지 못했습니다.');
      return NextResponse.json({ noteId, captured: captured.captured.length > 0, href: '/knowledge' }, { status: 201 });
    }
    return NextResponse.json({ error: '지원하지 않는 Sources/Studio 작업입니다.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '저장하지 못했습니다.' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== 'source') return NextResponse.json({ error: '지원하지 않는 수정입니다.' }, { status: 400 });
    const kind = typeof body.kind === 'string' ? body.kind as StudioSourceKind : undefined;
    const source = await updateStudioSource({
      id: typeof body.id === 'string' ? body.id : '',
      expectedUpdatedAt: typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : '',
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(kind ? { kind } : {}),
      ...(typeof body.url === 'string' ? { url: body.url } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
      ...(typeof body.text === 'string' ? { text: body.text } : {}),
    });
    return NextResponse.json({ source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '자료를 수정하지 못했습니다.' }, { status: 409 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('draftId') ?? '';
    await deleteStudioDraft(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '초안을 삭제하지 못했습니다.' }, { status: 400 });
  }
}
