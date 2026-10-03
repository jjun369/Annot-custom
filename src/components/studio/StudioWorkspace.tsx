'use client';

import { ArrowDownToLine, BookOpen, ChevronDown, ChevronRight, CircleHelp, Eye, LoaderCircle, Plus, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppHeader } from '@/components/layout/AppHeader';
import { buildKnowledgeSourceReaderUrl } from '@/lib/knowledge-retrieval';
import { buildStudioPrompt, shouldCloseStudioEscape } from '@/lib/sources-studio-shared';
import type { StudioDraft, StudioReference, StudioSource, StudioSourceKind } from '@/lib/sources-studio';
import type { TreeNode } from '@/types';

type WorkspaceData = { drafts: StudioDraft[]; sources: StudioSource[]; warnings: string[] };
type Proposal = {
  requestId: string; content: string; selectedIds: string[]; unselectedReferenceIds: string[];
  note: string; provider: string; model: string;
  baseDraft: Pick<StudioDraft, 'id' | 'revision' | 'title' | 'text' | 'references'>;
};
type ReferenceTarget = { documentId: string; page: number; rects?: Array<{ x: number; y: number; width: number; height: number }> };

const LABELS: Record<StudioSourceKind, string> = {
  memo: '개인 메모', paper: '논문·학회', official_article: '공식·기술 자료', web_clip: '웹 클립', patent: '특허',
};
const RECOVERY_PREFIX = 'pagedock:studio-recovery:';
const DEFAULT_INSTRUCTION = '이 초안을 선택한 자료를 바탕으로 더 명료하게 다듬어 주세요. 주장의 범위와 불확실성을 보존하고, 제안된 본문만 반환해 주세요.';
const MAX_REQUEST_REFS = 6;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '요청을 처리하지 못했습니다.');
  return body;
}

function excerpt(text: string): string {
  const clean = text.trim();
  if (clean.length <= 4_000) return clean;
  return `${clean.slice(0, 2_600)}\n\n[… 중간 생략 · 원문은 자료함에서 확인 …]\n\n${clean.slice(-1_300)}`;
}

function referenceFor(source: StudioSource): StudioReference {
  return {
    sourceId: source.id, title: source.title, kind: source.kind,
    originLabel: source.originLabel, sourceUpdatedAt: source.sourceUpdatedAt,
    excerpt: excerpt(source.text), includeInRequest: false,
  };
}

function toReaderTarget(source: StudioSource): ReferenceTarget | null {
  if (source.origin === 'research' && source.documentId) return { documentId: source.documentId, page: 1 };
  if (source.readerTargets?.[0]) return source.readerTargets[0];
  return null;
}

function FocusableSourceLink({ source, root }: { source: StudioSource; root: TreeNode | null }) {
  const target = toReaderTarget(source);
  const href = target && root ? buildKnowledgeSourceReaderUrl(root, target) : null;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/25 px-2 py-1.5 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container"><Eye size={12} />원문</a>;
  if (source.url) return <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/25 px-2 py-1.5 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container"><Eye size={12} />원문</a>;
  if (source.origin === 'wiki') return <Link href="/knowledge" className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/25 px-2 py-1.5 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container"><Eye size={12} />원문</Link>;
  return <span title="현재 라이브러리에서 연결된 PDF를 찾지 못했습니다." className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/20 px-2 py-1.5 text-[10px] text-outline"><Eye size={12} />원문 위치 없음</span>;
}

function ReferencePicker({
  sources, currentIds, onAdd, onClose,
}: { sources: StudioSource[]; currentIds: string[]; onAdd: (source: StudioSource) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (shouldCloseStudioEscape(event)) closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); returnFocusRef.current?.focus(); };
  }, []);
  const available = sources.filter((source) => !currentIds.includes(source.id));
  const needle = query.trim().normalize('NFKC').toLowerCase();
  const results = available.filter((source) =>
    `${source.title}\n${source.text}\n${source.tags.join(' ')}`.normalize('NFKC').toLowerCase().includes(needle)).slice(0, 150);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="reference-picker-title" className="flex max-h-[86dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-ambient">
      <div className="flex items-center justify-between border-b border-outline-variant/20 px-4 py-3"><div><p className="text-[10px] font-bold text-primary">참조 자료 선택</p><h2 id="reference-picker-title" className="mt-0.5 text-sm font-bold text-on-surface">내 자료·Research·Knowledge</h2></div><button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-2 hover:bg-surface-container"><X size={16} /></button></div>
      <label className="m-3 flex items-center gap-2 rounded-lg border border-outline-variant/25 px-3 py-2"><Eye size={14} className="text-outline" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="자료 제목·본문·태그 찾기" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
      <p className="px-4 pb-1 text-[10px] text-outline">추가 가능 {available.length} · 이미 추가 {sources.length - available.length}{needle ? ` · 검색 결과 ${results.length}` : ''}</p>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {results.map((source) => <div key={source.id} className="mb-1 flex items-center gap-3 rounded-xl border border-outline-variant/15 p-3">
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-on-surface">{source.title}</p><p className="mt-0.5 truncate text-[10px] text-outline">{LABELS[source.kind]} · {source.originLabel} · {source.id}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-on-surface-variant">{source.text.slice(0, 280)}</p></div>
          <button type="button" onClick={() => onAdd(source)} className="shrink-0 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-on-primary">추가</button>
        </div>)}
        {!sources.length && <div className="p-8 text-center text-xs text-on-surface-variant"><p>아직 자료함에 추가한 자료가 없습니다.</p><Link href="/sources" className="mt-2 inline-block text-primary underline">자료함에서 개인 메모 만들기</Link></div>}
        {sources.length > 0 && !available.length && <div className="p-8 text-center text-xs text-on-surface-variant"><p>사용 가능한 자료를 모두 참조 선반에 추가했습니다.</p><p className="mt-1">필요 없는 참조를 선반에서 제거하거나 새 자료를 추가하세요.</p><Link href="/sources" className="mt-2 inline-block text-primary underline">자료함에서 새 자료 추가</Link></div>}
        {available.length > 0 && !results.length && <div className="p-8 text-center text-xs text-on-surface-variant"><p>“{query.trim()}”와 일치하는 추가 가능 자료가 없습니다.</p><button type="button" onClick={() => setQuery('')} className="mt-2 rounded-lg border border-outline-variant/25 px-2.5 py-1.5 text-primary">검색 지우기</button><Link href="/sources" className="ml-2 text-primary underline">새 자료 추가</Link></div>}
      </div>
      <p className="border-t border-outline-variant/15 px-4 py-2 text-[10px] text-outline">참조를 추가해도 전송되지 않습니다. 각 자료의 요청 포함 확인은 별도로 켜야 합니다.</p>
    </div>
  </div>;
}

function ConfirmationDialog({
  title, children, onCancel, onConfirm, busy, confirmLabel,
}: { title: string; children: React.ReactNode; onCancel: () => void; onConfirm: () => void; busy?: boolean; confirmLabel: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  useEffect(() => { busyRef.current = busy; cancelRef.current = onCancel; }, [busy, onCancel]);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    buttonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (shouldCloseStudioEscape(event) && !busyRef.current) cancelRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); returnFocusRef.current?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><section role="dialog" aria-modal="true" aria-labelledby="studio-dialog-title" className="w-full max-w-2xl rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-ambient"><div className="flex justify-between gap-3"><h2 id="studio-dialog-title" className="text-base font-bold text-on-surface">{title}</h2><button type="button" onClick={onCancel} disabled={busy} aria-label="닫기" className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container"><X size={16} /></button></div><div className="mt-3 text-xs leading-5 text-on-surface-variant">{children}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-semibold hover:bg-surface-container">취소</button><button ref={buttonRef} type="button" onClick={onConfirm} disabled={busy} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:opacity-60">{busy && <LoaderCircle size={13} className="animate-spin" />}{confirmLabel}</button></div></section></div>;
}

export function StudioWorkspace() {
  const [data, setData] = useState<WorkspaceData>({ drafts: [], sources: [], warnings: [] });
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [activeId, setActiveId] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [references, setReferences] = useState<StudioReference[]>([]);
  const [baseDraft, setBaseDraft] = useState<StudioDraft | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [requestTab, setRequestTab] = useState<'references' | 'proposal'>('references');
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalMessage, setProposalMessage] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishResult, setPublishResult] = useState('');
  const [publishHref, setPublishHref] = useState('');
  const [unsavedNavigation, setUnsavedNavigation] = useState('');
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryRecord, setRecoveryRecord] = useState<{ title: string; text: string; references: StudioReference[] } | null>(null);
  const [undoContent, setUndoContent] = useState<string | null>(null);
  const [draftListCollapsed, setDraftListCollapsed] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editEpoch = useRef(0);
  const proposalEpoch = useRef(0);
  const initialSourceHandled = useRef(false);

  const dirty = Boolean(baseDraft && (title !== baseDraft.title || text !== baseDraft.text || JSON.stringify(references) !== JSON.stringify(baseDraft.references)));
  const selectedForRequest = references.filter((reference) => reference.includeInRequest);
  const selectedIds = new Set(references.map((reference) => reference.sourceId));
  const previewPrompt = useMemo(() => buildStudioPrompt({
    draftTitle: title,
    draftText: text,
    instruction,
    references: selectedForRequest,
  }), [title, text, instruction, selectedForRequest]);
  const liveProposal = proposal && proposal.requestId && proposal.selectedIds.every((id) => references.some((reference) => reference.sourceId === id)) ? proposal : null;
  const proposalCanApply = Boolean(liveProposal && !dirty && baseDraft && liveProposal.requestId && !busy);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/sources-studio', { cache: 'no-store' });
    const body = await readJson(response);
    const next = body as unknown as WorkspaceData;
    setData({ drafts: next.drafts ?? [], sources: next.sources ?? [], warnings: next.warnings ?? [] });
    return next;
  }, []);

  const installDraft = useCallback((draft: StudioDraft) => {
    editEpoch.current += 1;
    proposalEpoch.current += 1;
    setActiveId(draft.id);
    setBaseDraft(draft);
    setTitle(draft.title);
    setText(draft.text);
    setReferences(draft.references);
    setProposal(null);
    setUndoContent(null);
    setProposalMessage('');
    setRecoveryAvailable(false);
    setRecoveryRecord(null);
  }, []);

  const load = useCallback(async () => {
    try {
      const [next, treeResponse] = await Promise.all([
        refresh(),
        fetch('/api/workspace/tree', { cache: 'no-store' }).catch(() => null),
      ]);
      if (treeResponse?.ok) setRoot(await treeResponse.json() as TreeNode);
      let drafts = next.drafts ?? [];
      if (!drafts.length) {
        const created = await fetch('/api/sources-studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft' }) });
        const result = await readJson(created);
        drafts = [result.draft as StudioDraft];
        setData((current) => ({ ...current, drafts }));
      }
      const requestedSource = new URLSearchParams(window.location.search).get('source');
      const draft = drafts[0];
      installDraft(draft);
      if (requestedSource && !initialSourceHandled.current) {
        initialSourceHandled.current = true;
        const source = (next.sources ?? []).find((item) => item.id === requestedSource);
        if (source && !draft.references.some((reference) => reference.sourceId === source.id)) {
          setReferences([...draft.references, referenceFor(source)]);
          editEpoch.current += 1;
        }
        window.history.replaceState({}, '', '/studio');
      }
      const recovery = localStorage.getItem(`${RECOVERY_PREFIX}${draft.id}`);
      if (recovery) {
        try {
          const record = JSON.parse(recovery) as { revision: number; title: string; text: string; references: StudioReference[]; savedAt: string };
          if (record.revision === draft.revision && record.savedAt > draft.updatedAt
            && (record.title !== draft.title || record.text !== draft.text || JSON.stringify(record.references) !== JSON.stringify(draft.references))) {
            setRecoveryRecord(record);
            setRecoveryAvailable(true);
          }
        } catch { localStorage.removeItem(`${RECOVERY_PREFIX}${draft.id}`); }
      }
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Studio 자료를 불러오지 못했습니다.');
    }
  }, [installDraft, refresh]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!baseDraft || !dirty) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(`${RECOVERY_PREFIX}${baseDraft.id}`, JSON.stringify({
          revision: baseDraft.revision, title, text, references, savedAt: new Date().toISOString(),
        }));
      } catch { /* Recovery is best-effort; the explicit Library save remains authoritative. */ }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [baseDraft, dirty, title, text, references]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const composing = (event as KeyboardEvent & { isComposing?: boolean }).isComposing;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !composing) {
        event.preventDefault();
        void saveDraft();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!target || target.target === '_blank' || target.origin !== window.location.origin) return;
      event.preventDefault();
      setUnsavedNavigation(target.href);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); window.removeEventListener('click', onClick, true); };
  }, [dirty]);

  const saveDraft = useCallback(async (): Promise<StudioDraft | null> => {
    if (!baseDraft) return null;
    setBusy(true);
    try {
      const response = await fetch('/api/sources-studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-draft', id: baseDraft.id, expectedRevision: baseDraft.revision, title, text, references }),
      });
      const body = await readJson(response);
      const saved = body.draft as StudioDraft;
      setData((current) => ({ ...current, drafts: [saved, ...current.drafts.filter((draft) => draft.id !== saved.id)] }));
      installDraft(saved);
      localStorage.setItem(`${RECOVERY_PREFIX}${saved.id}`, JSON.stringify({ revision: saved.revision, title: saved.title, text: saved.text, references: saved.references, savedAt: saved.updatedAt }));
      setProposalMessage('초안을 저장했습니다.');
      return saved;
    } catch (error) {
      setProposalMessage(error instanceof Error ? error.message : '저장하지 못했습니다.');
      if (error instanceof Error && /다른 변경/.test(error.message)) void refresh();
      return null;
    } finally { setBusy(false); }
  }, [baseDraft, title, text, references, installDraft, refresh]);

  const addReference = (source: StudioSource) => {
    setReferences((current) => current.some((reference) => reference.sourceId === source.id) ? current : [...current, referenceFor(source)]);
    editEpoch.current += 1;
    setProposal(null);
    setProposalMessage('참조를 추가했습니다. 초안을 저장하면 요청 포함 여부를 조정할 수 있습니다.');
  };

  const createDraft = async () => {
    if (dirty && !await saveDraft()) return;
    setBusy(true);
    try {
      const response = await fetch('/api/sources-studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft' }) });
      const body = await readJson(response);
      const draft = body.draft as StudioDraft;
      setData((current) => ({ ...current, drafts: [draft, ...current.drafts] }));
      installDraft(draft);
      editorRef.current?.focus();
    } catch (error) { setProposalMessage(error instanceof Error ? error.message : '초안을 만들지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const selectDraft = async (id: string) => {
    if (id === activeId) return;
    if (dirty && !await saveDraft()) return;
    const draft = data.drafts.find((item) => item.id === id);
    if (draft) installDraft(draft);
  };

  const openPreview = async () => {
    if (!baseDraft) return;
    if (dirty) {
      const saved = await saveDraft();
      if (!saved) return;
    }
    setPreviewOpen(true);
  };

  const requestProposal = async () => {
    if (!baseDraft || busy) return;
    const selected = references.filter((reference) => reference.includeInRequest);
    if (selected.length > MAX_REQUEST_REFS) {
      setProposalMessage(`한 번에 ${MAX_REQUEST_REFS}개까지만 요청에 포함할 수 있습니다.`);
      return;
    }
    const requestEditEpoch = editEpoch.current;
    const requestDraftId = baseDraft.id;
    const requestRevision = baseDraft.revision;
    const requestId = ++proposalEpoch.current;
    setBusy(true);
    setPreviewOpen(false);
    setProposalMessage('AI 제안을 기다리는 중입니다. 편집은 계속할 수 있습니다.');
    try {
      const response = await fetch('/api/sources-studio/proposal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: requestDraftId, expectedRevision: requestRevision, instruction, referenceIds: selected.map((item) => item.sourceId), provider, model: 'auto' }),
      });
      const body = await readJson(response);
      if (requestId !== proposalEpoch.current || requestDraftId !== activeId || requestEditEpoch !== editEpoch.current) {
        setProposalMessage('초안이나 선택 자료가 바뀌어 늦게 도착한 제안을 버렸습니다. 현재 글은 변경하지 않았습니다.');
        return;
      }
      setProposal({
        requestId: body.requestId as string,
        content: body.content as string,
        selectedIds: body.selectedIds as string[],
        unselectedReferenceIds: body.unselectedReferenceIds as string[],
        note: body.note as string,
        provider: body.provider as string,
        model: body.model as string,
        baseDraft: {
          id: requestDraftId, revision: requestRevision, title: baseDraft.title,
          text: baseDraft.text, references: baseDraft.references,
        },
      });
      setRequestTab('proposal');
      setProposalMessage('AI 제안이 준비되었습니다. 비교한 뒤 본문에 명시적으로 적용하세요.');
    } catch (error) {
      setProposalMessage(error instanceof Error ? error.message : 'AI 제안을 만들지 못했습니다.');
    } finally { setBusy(false); }
  };

  const applyProposal = async () => {
    if (!liveProposal || !proposalCanApply) return;
    const candidate = liveProposal;
    const requestEditEpoch = editEpoch.current;
    const requestId = candidate.requestId;
    setBusy(true);
    setProposalMessage('제안 기준이 저장된 초안과 자료에서 여전히 최신인지 확인 중입니다.');
    try {
      const response = await fetch('/api/sources-studio/proposal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validateOnly: true,
          draftId: candidate.baseDraft.id,
          expectedRevision: candidate.baseDraft.revision,
          expectedTitle: candidate.baseDraft.title,
          expectedText: candidate.baseDraft.text,
          expectedReferences: candidate.baseDraft.references,
          referenceIds: candidate.selectedIds,
        }),
      });
      await readJson(response);
      if (requestEditEpoch !== editEpoch.current || requestId !== proposal?.requestId || activeId !== candidate.baseDraft.id) {
        setProposalMessage('검토 중 초안이 바뀌어 제안을 적용하지 않았습니다.');
        return;
      }
      setUndoContent(text);
      setText(candidate.content);
      editEpoch.current += 1;
      setProposalMessage('제안을 본문에 적용했습니다. 아직 저장하지 않았습니다. 적용 취소로 되돌릴 수 있습니다.');
    } catch (error) {
      setProposalMessage(error instanceof Error ? error.message : '제안을 적용하기 전에 최신 상태를 확인하지 못했습니다.');
      setProposal(null);
    } finally { setBusy(false); }
  };

  const undoProposal = () => {
    if (undoContent === null) return;
    setText(undoContent);
    setUndoContent(null);
    editEpoch.current += 1;
    setProposalMessage('제안 적용을 되돌렸습니다.');
  };

  const publishToKnowledge = async () => {
    if (!baseDraft) return;
    let draftToPublish = baseDraft;
    if (dirty) {
      const saved = await saveDraft();
      if (!saved) return;
      draftToPublish = saved;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/sources-studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish-draft', id: draftToPublish.id, expectedRevision: draftToPublish.revision }) });
      const body = await readJson(response);
      setPublishResult(`Knowledge 검토함에 ${body.captured ? '새 immutable note' : '기존 동일 note'}로 연결했습니다. 위키 본문은 바뀌지 않았습니다.`);
      setPublishHref(body.href as string);
      setPublishOpen(false);
    } catch (error) { setProposalMessage(error instanceof Error ? error.message : 'Knowledge 검토함으로 보내지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const restoreRecovery = () => {
    if (!recoveryRecord) return;
    setTitle(recoveryRecord.title);
    setText(recoveryRecord.text);
    setReferences(recoveryRecord.references);
    editEpoch.current += 1;
    setRecoveryAvailable(false);
    setRecoveryRecord(null);
    setProposalMessage('이 장치의 임시 복구본을 불러왔습니다. 계속 사용하려면 초안 저장을 누르세요.');
  };

  const discardRecovery = () => {
    if (baseDraft) localStorage.removeItem(`${RECOVERY_PREFIX}${baseDraft.id}`);
    setRecoveryAvailable(false);
    setRecoveryRecord(null);
  };

  const leaveAfterUnsaved = async (save: boolean) => {
    const href = unsavedNavigation;
    if (save && !await saveDraft()) return;
    if (!save && baseDraft) {
      try { localStorage.setItem(`${RECOVERY_PREFIX}${baseDraft.id}`, JSON.stringify({ revision: baseDraft.revision, title, text, references, savedAt: new Date().toISOString() })); } catch { /* keep navigation available */ }
    }
    setUnsavedNavigation('');
    if (href) window.location.assign(href);
  };

  const includedCount = selectedForRequest.length;
  const originalText = liveProposal ? (baseDraft?.text ?? '') : '';
  const applyPreview = liveProposal?.content ?? '';
  const refLimitReached = includedCount >= MAX_REQUEST_REFS;

  return <div className="flex h-dvh min-h-[620px] flex-col bg-surface">
    <AppHeader active="studio" />
    <div className="mx-auto flex w-full max-w-[1800px] min-h-0 flex-1 flex-col px-3 py-3 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-[10px] font-bold text-primary">STUDIO · 로컬 초안</p><label className="sr-only" htmlFor="studio-title">초안 제목</label><input id="studio-title" value={title} maxLength={300} onChange={(event) => { setTitle(event.target.value); editEpoch.current += 1; setUndoContent(null); }} className="mt-0.5 w-full truncate bg-transparent text-base font-bold text-on-surface outline-none" placeholder="초안 제목" /></div>
          <select value={activeId} onChange={(event) => void selectDraft(event.target.value)} aria-label="초안 선택" className="max-w-48 rounded-lg border border-outline-variant/25 bg-surface-container-low px-2 py-2 text-[10px] font-semibold 2xl:hidden">
            {data.drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title || '제목 없는 초안'}</option>)}
          </select>
          <span className={`hidden rounded-full px-2.5 py-1 text-[10px] font-semibold sm:inline ${dirty ? 'bg-tertiary-container text-on-surface' : 'bg-surface-container text-on-surface-variant'}`}>{dirty ? '저장되지 않은 변경' : '저장됨'}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => void saveDraft()} disabled={busy || !dirty} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-on-primary disabled:opacity-45"><ArrowDownToLine size={14} />초안 저장</button>
          {undoContent !== null && <button type="button" onClick={undoProposal} className="flex h-9 items-center gap-1 rounded-lg border border-outline-variant/25 px-2.5 text-[10px] font-semibold"><Undo2 size={13} />적용 취소</button>}
          <button type="button" onClick={() => setPublishOpen(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-outline-variant/25 px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"><BookOpen size={14} />위키 검토함으로…</button>
        </div>
      </div>

      {loadError && <div role="alert" className="mb-3 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container">{loadError}<button type="button" onClick={() => void load()} className="ml-2 underline">다시 불러오기</button></div>}
      {data.warnings.map((warning) => <p key={warning} className="mb-2 rounded-lg bg-tertiary-container/50 px-3 py-2 text-[10px] text-on-surface-variant">{warning}</p>)}
      {recoveryAvailable && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary-container/50 px-3 py-2"><p className="text-[11px] text-on-surface">저장 전 편집본이 이 장치의 브라우저 복구 사본에 있습니다. 복구 사본은 다른 PC로 이동하지 않습니다.</p><div className="flex gap-1.5"><button type="button" onClick={restoreRecovery} className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-bold text-on-primary">복구</button><button type="button" onClick={discardRecovery} className="rounded-lg px-2.5 py-1.5 text-[10px] hover:bg-surface-container">버리기</button></div></div>}
      {publishResult && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary-container/55 px-3 py-2 text-[11px] text-on-surface"><span>{publishResult}</span><div className="flex gap-3">{publishHref && <Link href={publishHref} className="font-bold text-primary underline">Knowledge 열기</Link>}<button type="button" onClick={() => setPublishResult('')} className="text-outline">닫기</button></div></div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[190px_minmax(0,1fr)_360px]">
        <aside className={`hidden min-h-0 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-2 2xl:block ${draftListCollapsed ? '2xl:w-14' : ''}`}>
          <div className="flex items-center justify-between px-2 py-1"><span className={`text-[10px] font-bold uppercase tracking-wide text-outline ${draftListCollapsed ? 'hidden' : ''}`}>초안</span><button type="button" onClick={() => setDraftListCollapsed((value) => !value)} className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container" aria-label={draftListCollapsed ? '초안 목록 펼치기' : '초안 목록 접기'}>{draftListCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button></div>
          {!draftListCollapsed && <><button type="button" onClick={() => void createDraft()} disabled={busy} className="mb-2 flex w-full items-center justify-center gap-1 rounded-lg bg-primary-container px-2 py-2 text-[10px] font-bold text-primary"><Plus size={13} />새 초안</button>{data.drafts.map((draft) => <button key={draft.id} type="button" onClick={() => void selectDraft(draft.id)} className={`mb-1 block w-full rounded-lg px-2.5 py-2 text-left ${draft.id === activeId ? 'bg-primary-container text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}><span className="block truncate text-[11px] font-semibold">{draft.title || '제목 없는 초안'}</span><span className="mt-0.5 block text-[9px] opacity-70">{new Date(draft.updatedAt).toLocaleDateString()}</span></button>)}</>}
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest">
          <div className="flex items-center justify-between border-b border-outline-variant/15 px-3 py-2"><div><p className="text-[10px] font-bold text-on-surface">초안 본문</p><p className="text-[9px] text-outline">Ctrl+S 저장 · AI 제안은 명시적으로 적용할 때만 본문에 들어갑니다.</p></div><span className="text-[9px] text-outline">{text.length.toLocaleString()}자</span></div>
          <textarea ref={editorRef} value={text} onChange={(event) => { setText(event.target.value); editEpoch.current += 1; if (undoContent !== null) setUndoContent(null); }} placeholder="참조 없이도 바로 작성할 수 있습니다. 이 초안은 로컬에 저장되며 자동으로 AI에 전송되지 않습니다." className="min-h-0 flex-1 resize-none bg-transparent p-4 text-[13px] leading-7 text-on-surface outline-none sm:p-6 sm:text-sm" aria-label="초안 본문" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/15 px-3 py-2"><span className="text-[9px] text-outline">{busy ? '요청 중이어도 편집할 수 있습니다. 늦게 도착한 결과는 변경된 초안에 적용되지 않습니다.' : '원문 미참조 상태로도 작성 가능'}</span><button type="button" onClick={() => void openPreview()} disabled={busy || !baseDraft} className="flex items-center gap-1.5 rounded-lg border border-outline-variant/25 px-2.5 py-1.5 text-[10px] font-bold text-on-surface-variant disabled:opacity-40"><Eye size={13} />요청 검토</button></div>
        </main>

        <aside className="flex min-h-[260px] flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest">
          <div className="flex border-b border-outline-variant/15 p-1.5" role="tablist" aria-label="Studio 도구">
            <button type="button" role="tab" aria-selected={requestTab === 'references'} onClick={() => setRequestTab('references')} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-bold ${requestTab === 'references' ? 'bg-primary-container text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>참조 선반 · {references.length}</button>
            <button type="button" role="tab" aria-selected={requestTab === 'proposal'} onClick={() => setRequestTab('proposal')} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-bold ${requestTab === 'proposal' ? 'bg-primary-container text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>AI 제안</button>
          </div>
          {requestTab === 'references' ? <>
            <div className="flex items-center justify-between px-3 py-2"><div><p className="text-[10px] font-semibold text-on-surface">선택한 자료</p><p className="text-[9px] text-outline">추가만으로는 AI에 전송되지 않습니다.</p></div><button type="button" onClick={() => setPickerOpen(true)} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-bold text-on-primary"><Plus size={12} />추가</button></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {references.map((reference) => {
                const source = data.sources.find((item) => item.id === reference.sourceId);
                const included = reference.includeInRequest;
                return <article key={reference.sourceId} className="mb-2 rounded-xl border border-outline-variant/20 bg-surface-container-low p-2.5">
                  <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-[11px] font-bold leading-4 text-on-surface" title={reference.title}>{reference.title}</p><p className="mt-0.5 truncate text-[9px] text-outline" title={`${LABELS[reference.kind]} · ${reference.originLabel}`}>{LABELS[reference.kind]} · {reference.originLabel}</p></div><button type="button" onClick={() => { setReferences((current) => current.filter((item) => item.sourceId !== reference.sourceId)); setProposal(null); editEpoch.current += 1; }} aria-label={`${reference.title} 참조 제거`} className="shrink-0 rounded-md p-1 text-outline hover:bg-surface-container-lowest hover:text-on-surface"><X size={13} /></button></div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><label className={`flex items-center gap-1.5 text-[9px] font-semibold ${refLimitReached && !included ? 'text-outline' : 'text-on-surface-variant'}`}><input type="checkbox" checked={included} disabled={refLimitReached && !included} onChange={(event) => { const checked = event.target.checked; setReferences((current) => current.map((item) => item.sourceId === reference.sourceId ? { ...item, includeInRequest: checked } : item)); setProposal(null); editEpoch.current += 1; }} />이번 요청에 포함</label>{source && <FocusableSourceLink source={source} root={root} />}</div>
                  <details className="mt-1.5 border-t border-outline-variant/15 pt-1.5"><summary className="cursor-pointer text-[9px] font-medium text-on-surface-variant">참조 발췌 보기</summary><p className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-[10px] leading-4 text-on-surface-variant">{reference.excerpt || '본문 미리보기 없음'}</p></details>
                </article>;
              })}
              {!references.length && <div className="p-5 text-center"><p className="text-xs font-semibold text-on-surface">참조 없이 쓸 수 있습니다.</p><p className="mt-1 text-[10px] leading-4 text-on-surface-variant">원문 근거가 필요하면 자료를 추가하고 전송 여부를 선택하세요.</p><Link href="/sources" className="mt-3 inline-block rounded-lg border border-outline-variant/25 px-2.5 py-1.5 text-[10px] font-semibold">자료함 열기</Link></div>}
            </div>
            <div className="border-t border-outline-variant/15 px-3 py-2"><p className="text-[9px] text-on-surface-variant">이번 요청에 포함: {includedCount} / {MAX_REQUEST_REFS}</p><p className="mt-0.5 text-[9px] leading-4 text-outline">요청 전 미리보기에서 실제 전송될 초안·자료를 확인합니다.</p></div>
          </> : <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {proposalMessage && <p role="status" className="mb-2 rounded-lg bg-surface-container-low px-2.5 py-2 text-[10px] leading-4 text-on-surface-variant">{proposalMessage}</p>}
            {liveProposal ? <>
              <p className="text-[10px] font-bold text-primary">{liveProposal.provider} · {liveProposal.model} · AI 초안 · 검토 전</p><p className="mt-1 text-[9px] leading-4 text-on-surface-variant">{liveProposal.note}</p>
              {liveProposal.unselectedReferenceIds.length > 0 && <p role="alert" className="mt-2 rounded-lg bg-error-container p-2 text-[10px] text-on-error-container">선택되지 않은 참조 ID를 사용했습니다. 적용 전에 직접 확인하세요: {liveProposal.unselectedReferenceIds.join(', ')}</p>}
              <div className="mt-3 grid gap-2"><section className="rounded-lg border border-outline-variant/20"><h3 className="border-b border-outline-variant/15 px-2.5 py-1.5 text-[9px] font-bold text-outline">현재 본문</h3><pre className="max-h-36 overflow-auto whitespace-pre-wrap p-2.5 text-[10px] leading-4 text-on-surface-variant">{originalText || '(비어 있음)'}</pre></section><section className="rounded-lg border border-primary/25"><h3 className="border-b border-primary/15 px-2.5 py-1.5 text-[9px] font-bold text-primary">제안 본문</h3><pre className="max-h-48 overflow-auto whitespace-pre-wrap p-2.5 text-[10px] leading-4 text-on-surface">{applyPreview}</pre></section></div>
              <div className="mt-2 flex gap-2"><button type="button" onClick={applyProposal} disabled={!proposalCanApply} className="flex-1 rounded-lg bg-primary px-2.5 py-2 text-[10px] font-bold text-on-primary disabled:opacity-40">본문 전체에 적용</button>{undoContent !== null && <button type="button" onClick={undoProposal} className="rounded-lg border border-outline-variant/25 px-2 py-2 text-[10px] font-semibold"><Undo2 size={13} /></button>}</div>
              {!proposalCanApply && <p className="mt-1 text-[9px] text-error">초안이 바뀌었습니다. 현재 제안은 적용할 수 없습니다.</p>}
            </> : <div className="flex h-full flex-col items-center justify-center text-center"><CircleHelp size={22} className="text-outline" /><p className="mt-2 text-xs font-semibold text-on-surface">아직 제안이 없습니다.</p><p className="mt-1 text-[10px] leading-4 text-on-surface-variant">요청 검토에서 선택 범위를 확인한 다음 직접 실행하세요.</p></div>}
          </div>}
        </aside>
      </div>
      {proposalMessage && requestTab === 'references' && <p role="status" className="mt-2 text-[10px] text-on-surface-variant">{proposalMessage}</p>}
    </div>

    {pickerOpen && <ReferencePicker sources={data.sources} currentIds={[...selectedIds]} onAdd={addReference} onClose={() => setPickerOpen(false)} />}
    {previewOpen && baseDraft && <ConfirmationDialog title="AI 요청 전송 내용 확인" confirmLabel="확인 후 AI 제안 요청" busy={busy} onCancel={() => setPreviewOpen(false)} onConfirm={() => void requestProposal()}>
      <p className="font-semibold text-on-surface">실제 전송 범위: 저장된 초안 본문 + {includedCount}개 선택 자료 + 아래 요청 지시문</p>
      <p className="mt-1">자료를 참조 선반에 추가한 것만으로는 전송되지 않습니다. 이 버튼을 누르면 선택된 텍스트가 {provider === 'codex' ? 'Codex' : 'Claude Code'} provider를 통해 전송됩니다.</p>
      <label className="mt-3 block font-semibold text-on-surface">요청 내용
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={8_000} rows={3} className="mt-1 w-full rounded-lg border border-outline-variant/25 bg-surface-container-low p-2 text-xs font-normal leading-5 outline-none focus:border-primary" />
      </label>
      <label className="mt-3 block font-semibold text-on-surface">기존 provider
        <select value={provider} onChange={(event) => setProvider(event.target.value as 'codex' | 'claude')} className="mt-1 w-full rounded-lg border border-outline-variant/25 bg-surface-container-low px-2 py-2 text-xs"><option value="codex">Codex (자동 모델)</option><option value="claude">Claude Code (자동 모델)</option></select>
      </label>
      <details className="mt-3 rounded-lg border border-outline-variant/20"><summary className="cursor-pointer px-2.5 py-2 text-[10px] font-bold">전송 프롬프트 전체 보기 · {previewPrompt.length.toLocaleString()}자</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-outline-variant/15 p-2.5 text-[9px] leading-4 text-on-surface-variant">{previewPrompt}</pre></details>
      <p className="mt-2 text-[9px]">모델의 인용 ID만 요청 집합과 대조합니다. 사실 주장과 원문 간 entailment는 검증되지 않습니다.</p>
    </ConfirmationDialog>}
    {publishOpen && <ConfirmationDialog title="기존 Knowledge 검토함에 연결" confirmLabel="검토함에 저장" busy={busy} onCancel={() => setPublishOpen(false)} onConfirm={() => void publishToKnowledge()}>
      <p>저장된 Studio 초안과 참조 제목·안정 ID를 하나의 immutable Knowledge 입력으로 캡처합니다. 이는 위키 본문에 반영하는 작업이 아닙니다.</p><p className="mt-2">Knowledge 화면에서 기존 Codex 검토를 명시적으로 실행하고, 변경안을 비교·승인해야 위키가 바뀝니다. 초안 본문·참조 식별자는 선택된 다른 자료로 전송되지 않습니다.</p>
    </ConfirmationDialog>}
    {unsavedNavigation && <ConfirmationDialog title="저장되지 않은 변경" confirmLabel="저장 후 이동" onCancel={() => setUnsavedNavigation('')} onConfirm={() => void leaveAfterUnsaved(true)}><p>현재 편집은 아직 라이브러리 초안에 저장되지 않았습니다.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void leaveAfterUnsaved(false)} className="rounded-lg border border-outline-variant/25 px-3 py-2 text-[10px] font-semibold text-on-surface-variant">이 장치 복구본 남기고 이동</button><button type="button" onClick={() => setUnsavedNavigation('')} className="rounded-lg px-3 py-2 text-[10px] font-semibold">계속 편집</button></div></ConfirmationDialog>}
  </div>;
}
