'use client';

import { LoaderCircle, Search, Sparkles, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { InfoHint } from '@/components/common/InfoHint';
import { buildKnowledgeSourceReaderUrl } from '@/lib/knowledge-retrieval';
import { recordOriginForDisplay, recordProvenanceForDisplay } from '@/lib/record-display';
import { addSynthesisRecord, isConceptProposalCurrent, isConceptRequestCurrent, removeSynthesisRecord, type ConceptProposalBasis, type ConceptRequestBinding } from '@/lib/concept-synthesis-state';
import { studioDraftHrefFromRecordId, studioDraftIdFromRecordId } from '@/lib/studio-draft-search';
import type { ChatRecordContextSnapshot, TreeNode } from '@/types';

type SearchRecord = ChatRecordContextSnapshot['records'][number];

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '요청을 처리하지 못했습니다.');
  return body;
}

export function ConceptSynthesisDialog({ open, root, onClose }: { open: boolean; root: TreeNode | null; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [includeStudioDrafts, setIncludeStudioDrafts] = useState(false);
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<SearchRecord[]>([]);
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null);
  const [searchOmittedCount, setSearchOmittedCount] = useState(0);
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex');
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState('');
  const [proposalRecords, setProposalRecords] = useState<SearchRecord[]>([]);
  const [proposalBasis, setProposalBasis] = useState<ConceptProposalBasis | null>(null);
  const [approvedSnapshot, setApprovedSnapshot] = useState<ChatRecordContextSnapshot | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [savedDraftId, setSavedDraftId] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const basisEpoch = useRef(0);
  const searchEpoch = useRef(0);
  const questionRef = useRef(question);
  const searchQueryRef = useRef(searchQuery);
  const providerRef = useRef(provider);
  const selectedRef = useRef(selectedRecords);
  const approvedSnapshotRef = useRef(approvedSnapshot);
  const busyRef = useRef({ searching, generating, saving, preparing });
  const closeRef = useRef(onClose);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const selectedIds = selectedRecords.map((record) => record.id);
  const proposalIsCurrent = isConceptProposalCurrent({ basis: proposalBasis, question, provider,
    recordIds: selectedIds, snapshotHash: approvedSnapshot?.snapshotHash, epoch: basisEpoch.current });

  useEffect(() => { questionRef.current = question; }, [question]);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { providerRef.current = provider; }, [provider]);
  useEffect(() => { selectedRef.current = selectedRecords; }, [selectedRecords]);
  useEffect(() => { approvedSnapshotRef.current = approvedSnapshot; }, [approvedSnapshot]);
  useEffect(() => { busyRef.current = { searching, generating, saving, preparing }; }, [searching, generating, saving, preparing]);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (open) questionInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !Object.values(busyRef.current).some(Boolean)) closeRef.current();
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    if (open) window.addEventListener('keydown', onKeyDown);
    return () => { if (open) window.removeEventListener('keydown', onKeyDown); if (open) returnFocus?.focus(); };
  }, [open]);

  if (!open) return null;
  const resetProposal = () => { setProposal(''); setProposalRecords([]); setProposalBasis(null); setSavedDraftId(''); setApprovedSnapshot(null); };
  const currentBinding = (): ConceptRequestBinding => ({ epoch: basisEpoch.current, question: questionRef.current.trim(), provider: providerRef.current, recordIds: selectedRef.current.map((record) => record.id) });
  const replaceSelection = (next: SearchRecord[]) => { selectedRef.current = next; setSelectedRecords(next); };
  const search = async () => {
    const requestedQuery = searchQuery.trim();
    if (!requestedQuery || searching || generating || saving) return;
    const requestedEpoch = ++searchEpoch.current;
    setSearching(true); setError(''); resetProposal();
    setSearchResultCount(null); setSearchOmittedCount(0);
    try {
      const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'library-search', query: requestedQuery, includeStudioDrafts }) });
      const body = await readJson(response);
      if (requestedEpoch !== searchEpoch.current || searchQueryRef.current.trim() !== requestedQuery) return;
      const found = Array.isArray(body.records) ? body.records as SearchRecord[] : [];
      setRecords(found);
      replaceSelection(selectedRef.current.map((item) => found.find((record) => record.id === item.id) ?? item));
      setSearchResultCount(typeof body.totalCount === 'number' ? body.totalCount : found.length);
      setSearchOmittedCount(typeof body.omittedCount === 'number' ? body.omittedCount : 0);
    } catch (cause) { if (requestedEpoch === searchEpoch.current) setError(cause instanceof Error ? cause.message : '자료를 검색하지 못했습니다.'); }
    finally { if (requestedEpoch === searchEpoch.current) setSearching(false); }
  };
  const prepareSnapshot = async () => {
    const binding = currentBinding();
    if (!binding.question || !binding.recordIds.length || binding.recordIds.length > 8 || preparing || generating || saving) return;
    const requestedEpoch = basisEpoch.current;
    const requestRecords = [...selectedRef.current];
    setPreparing(true); setError(''); setApprovedSnapshot(null);
    try {
      const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare-synthesis', question: binding.question, recordIds: binding.recordIds, includeStudioDrafts }) });
      const body = await readJson(response) as unknown as ChatRecordContextSnapshot;
      if (!isConceptRequestCurrent(binding, currentBinding())) return;
      if (!body.records || body.records.length !== binding.recordIds.length) throw new Error('선택한 자료를 모두 확인하지 못했습니다. 다시 검색해 주세요.');
      replaceSelection(selectedRef.current.map((item) => body.records.find((record) => record.id === item.id) ?? item));
      setApprovedSnapshot(body);
      setProposalRecords(requestRecords);
    } catch (cause) { if (requestedEpoch === basisEpoch.current) setError(cause instanceof Error ? cause.message : '전송할 자료를 준비하지 못했습니다.'); }
    finally { setPreparing(false); }
  };
  const generate = async () => {
    const binding = currentBinding();
    if (!binding.question || !binding.recordIds.length || !approvedSnapshot?.snapshotHash || generating || searching || preparing) return;
    const requestedEpoch = basisEpoch.current;
    const requestedSnapshot = approvedSnapshot;
    const snapshotHash = requestedSnapshot.snapshotHash;
    if (!snapshotHash) return;
    setGenerating(true); setError(''); setProposal(''); setProposalBasis(null); setSavedDraftId('');
    try {
      const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'synthesize', question: binding.question, recordIds: binding.recordIds, snapshotHash: requestedSnapshot.snapshotHash, provider: binding.provider, model: 'auto', reasoningEffort: 'auto', includeStudioDrafts }) });
      const body = await readJson(response);
      if (!isConceptRequestCurrent(binding, currentBinding()) || approvedSnapshotRef.current?.snapshotHash !== requestedSnapshot.snapshotHash) throw new Error('질문, 선택 기록 또는 요청 기준이 바뀌어 늦게 도착한 결과를 버렸습니다. 다시 준비해 주세요.');
      setProposal(typeof body.content === 'string' ? body.content : '');
      setProposalRecords(Array.isArray(body.records) ? body.records as SearchRecord[] : []);
      setProposalBasis({ ...binding, snapshotHash });
    } catch (cause) { if (requestedEpoch === basisEpoch.current) setError(cause instanceof Error ? cause.message : '개념 초안을 만들지 못했습니다.'); }
    finally { setGenerating(false); }
  };
  const saveDraft = async () => {
    if (!proposal.trim() || !proposalRecords.length || !proposalIsCurrent || !proposalBasis || saving) return;
    const requestedEpoch = basisEpoch.current;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-synthesis-draft', question: proposalBasis.question, recordIds: proposalBasis.recordIds,
          snapshotHash: proposalBasis.snapshotHash, content: proposal, includeStudioDrafts }) });
      const body = await readJson(response);
      const draft = body.draft as { id?: string };
      if (!draft.id) throw new Error('새 개인 초안을 확인하지 못했습니다.');
      if (requestedEpoch === basisEpoch.current) setSavedDraftId(draft.id);
    } catch (cause) {
      if (requestedEpoch === basisEpoch.current) {
        if (cause instanceof Error && /미리보기 이후 기록이 달라졌습니다|선택한 자료가 바뀌었습니다/.test(cause.message)) setApprovedSnapshot(null);
        setError(cause instanceof Error ? cause.message : '개인 초안을 저장하지 못했습니다.');
      }
    }
    finally { setSaving(false); }
  };
  const close = () => { if (!Object.values(busyRef.current).some(Boolean)) onClose(); };
  const invalidateAnd = (action: () => void) => { basisEpoch.current += 1; resetProposal(); action(); };
  const changeStudioDraftSearch = (checked: boolean) => {
    searchEpoch.current += 1;
    setSearching(false);
    setRecords([]);
    setSearchResultCount(null);
    setSearchOmittedCount(0);
    invalidateAnd(() => {
      setIncludeStudioDrafts(checked);
      if (!checked) replaceSelection(selectedRef.current.filter((record) => !studioDraftIdFromRecordId(record.id)));
    });
  };
  const changeSearchQuery = (value: string) => {
    searchEpoch.current += 1;
    searchQueryRef.current = value;
    setSearching(false);
    setRecords([]);
    setSearchResultCount(null);
    setSearchOmittedCount(0);
    setSearchQuery(value);
  };
  const toggleRecord = (record: SearchRecord, checked: boolean) => {
    invalidateAnd(() => replaceSelection(checked
      ? addSynthesisRecord(selectedRef.current, record, 8, 8_000)
      : removeSynthesisRecord(selectedRef.current, record.id)));
  };
  const selectedChars = approvedSnapshot
    ? approvedSnapshot.records.reduce((sum, record) => sum + record.excerpt.length, 0)
    : selectedRecords.reduce((sum, record) => sum + record.excerpt.length, 0);
  const previewRecords = approvedSnapshot?.records ?? [];
  const previewRecord = (record: SearchRecord) => <p key={record.id} className="whitespace-pre-wrap text-[11px] leading-5">
    <b className="font-semibold">{record.title}</b>
    <span className="block text-[11px] text-on-surface-variant">{recordOriginForDisplay(record)} · {recordProvenanceForDisplay(record)}</span>
    <span className="mt-0.5 block">{record.excerpt}</span>
  </p>;

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-3" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="concept-synthesis-title" className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-ambient">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/20 px-5 py-3"><div><p className="text-xs font-semibold text-primary">직접 고른 기록만 사용</p><h2 id="concept-synthesis-title" className="mt-1 text-lg font-bold">내 기록으로 개념 정리</h2><p className="mt-1 max-w-3xl text-[12px] leading-5 text-on-surface-variant">검색은 이 기기에서 이뤄집니다. 보내기 전에 실제 발췌를 확인할 수 있고, 결과는 검토 전 초안으로 저장됩니다. 이미지 파일은 보내지 않습니다.</p></div><button type="button" onClick={close} disabled={saving} aria-label="개념 정리 닫기" className="rounded-lg p-2 hover:bg-surface-container disabled:opacity-50"><X size={16} /></button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <label className="block text-xs font-semibold text-on-surface-variant">정리할 질문 또는 주제<input ref={questionInputRef} value={question} disabled={saving} maxLength={2_000} onChange={(event) => invalidateAnd(() => { questionRef.current = event.target.value; setQuestion(event.target.value); })} placeholder="예: 이 논문들과 내 메모에서 열화 원인의 공통점은?" className="mt-1 w-full rounded-lg border border-outline-variant/25 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-primary disabled:opacity-60" /></label>
        <div className="mt-3 grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-3">
          <section className="flex min-h-[220px] flex-1 flex-col rounded-xl border border-outline-variant/20 bg-white p-3" aria-label="관련 기록 검색">
            <h3 className="text-sm font-bold text-on-surface">내 기록 찾기</h3><p className="mt-0.5 text-[11px] leading-4 text-on-surface-variant">검색어는 질문과 다르게 적어도 됩니다. 자료를 선택한 뒤 검색어를 바꿔도 선택은 유지됩니다.</p>
            <div className="mt-2 flex items-start gap-2 text-[12px] leading-5 text-on-surface-variant"><label className="flex items-start gap-2"><input type="checkbox" checked={includeStudioDrafts} disabled={searching || generating || preparing || saving} onChange={(event) => changeStudioDraftSearch(event.target.checked)} className="mt-1" /><span className="font-medium">저장한 초안도 검색</span></label><InfoHint label="저장한 초안 검색 안내" text="초안은 아직 검토되지 않은 개인 작업 메모입니다. 문헌의 근거로 검증된 내용이 아니며, 이 선택을 끄면 다음 검색뿐 아니라 선택 목록에서도 제외됩니다. 초안 문구와 원래 연결한 자료는 구분해서 표시합니다." /></div>
            <div className="mt-2 flex gap-2"><input value={searchQuery} maxLength={500} disabled={saving} onChange={(event) => changeSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} aria-label="관련 기록 검색어" placeholder="예: 열화 원인, 측정 조건" className="min-w-0 flex-1 rounded-lg border border-outline-variant/25 px-3 py-2.5 text-[12px] outline-none focus:border-primary disabled:opacity-60" /><button type="button" onClick={() => void search()} disabled={!searchQuery.trim() || searching || generating || saving} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary-container px-3 py-2.5 text-[12px] font-bold text-on-surface disabled:opacity-40">{searching ? <LoaderCircle size={14} className="animate-spin" /> : <Search size={14} />}검색</button></div>
            {searchResultCount !== null && <p role="status" aria-live="polite" className="mt-2 text-[11px] text-on-surface-variant">{searchResultCount === 0 ? '관련 기록을 찾지 못했습니다. 다른 검색어를 입력해 보세요.' : `검색 결과 ${records.length}개 표시${searchOmittedCount ? ` · ${searchOmittedCount}개 더 있음` : ''}`}</p>}
            <div className="mt-2 min-h-24 flex-1 space-y-1 overflow-y-auto rounded-lg border border-outline-variant/15 p-2">
              {records.map((record) => { const draftHref = studioDraftHrefFromRecordId(record.id); return <label key={record.id} className="flex cursor-pointer gap-2 rounded-md px-2 py-2 hover:bg-surface-container-low"><input type="checkbox" checked={selectedIds.includes(record.id)} disabled={generating || preparing || saving || (selectedIds.length >= 8 && !selectedIds.includes(record.id))} onChange={(event) => toggleRecord(record, event.target.checked)} className="mt-1" /><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold">{record.title}</span><span className="mt-0.5 block text-[11px] text-on-surface-variant">{recordOriginForDisplay(record)}</span>{draftHref && <span className="mt-1 inline-flex rounded-full bg-tertiary-container px-2.5 py-1 text-[12px] font-semibold text-on-surface">개인 초안 · 검토 전 · 문헌 근거 아님</span>}{!draftHref && <span className="block text-[11px] text-on-surface-variant">{recordProvenanceForDisplay(record)}</span>}<span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-[11px] leading-5 text-on-surface-variant">{record.excerpt}</span></span>{draftHref ? <Link href={draftHref} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="self-start whitespace-nowrap text-[11px] font-semibold text-primary" aria-label="초안 열기">초안 보기</Link> : record.anchor?.page && <a href={buildKnowledgeSourceReaderUrl(root, { documentId: record.anchor.documentId, page: record.anchor.page, rects: record.anchor.rects }) ?? undefined} target="_blank" onClick={(event) => event.stopPropagation()} className="self-start text-primary" aria-label="원문 열기"><ExternalLink size={14} /></a>}</label>; })}
              {!records.length && <p className="p-3 text-center text-[10px] text-outline">검색어를 입력하고 로컬 검색을 눌러 주세요.</p>}
            </div>
          </section>
          <section className="flex min-h-[180px] flex-1 flex-col rounded-xl border border-outline-variant/20 bg-white p-3" aria-label="선택한 기록">
            <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-bold text-on-surface">이번에 사용할 자료</h3><p className="mt-0.5 text-[11px] text-on-surface-variant">질문과 검색 결과를 바꿔도 직접 고른 자료는 유지됩니다.</p></div><select aria-label="개념 정리 AI" value={provider} disabled={generating || preparing || saving} onChange={(event) => invalidateAnd(() => { const next = event.target.value === 'claude' ? 'claude' : 'codex'; providerRef.current = next; setProvider(next); })} className="rounded-md border border-outline-variant/25 bg-white px-2 py-1.5 text-[11px]"><option value="codex">Codex</option><option value="claude">Claude</option></select></div>
            <div className="mt-2 min-h-20 flex-1 space-y-1 overflow-y-auto rounded-lg border border-outline-variant/15 p-2">{selectedRecords.map((record) => { const draftHref = studioDraftHrefFromRecordId(record.id); return <article key={record.id} className="flex items-start gap-2 rounded-md bg-surface-container-low p-2"><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold">{record.title}</p><p className="text-[11px] text-on-surface-variant">{recordOriginForDisplay(record)}</p>{draftHref && <p className="mt-1 inline-flex rounded-full bg-tertiary-container px-2.5 py-1 text-[12px] font-semibold text-on-surface">개인 초안 · 검토 전 · 문헌 근거 아님</p>}</div>{draftHref ? <Link href={draftHref} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-semibold text-primary">초안 보기 <ExternalLink size={12} className="inline" /></Link> : record.anchor?.page && <a href={buildKnowledgeSourceReaderUrl(root, { documentId: record.anchor.documentId, page: record.anchor.page, rects: record.anchor.rects }) ?? undefined} target="_blank" className="shrink-0 text-[11px] font-semibold text-primary">원문 보기 <ExternalLink size={12} className="inline" /></a>}<button type="button" onClick={() => toggleRecord(record, false)} disabled={saving} aria-label={`${record.title} 선택 해제`} className="shrink-0 rounded-md p-1 text-outline hover:bg-white hover:text-on-surface disabled:opacity-50"><X size={14} /></button></article>; })}{!selectedRecords.length && <p className="p-3 text-center text-[12px] leading-5 text-on-surface-variant">왼쪽에서 이번 정리에 참고할 자료를 골라 주세요.</p>}</div>
            {selectedRecords.length > 0 && <button type="button" onClick={() => invalidateAnd(() => replaceSelection([]))} disabled={generating || preparing || saving} className="self-start text-[11px] font-semibold text-primary underline disabled:opacity-40">선택 모두 해제</button>}
          </section>
          </div>
          <div className="flex min-h-[240px] flex-col rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold text-on-surface">AI 제안 · 검토 전</p><p className="text-[11px] text-on-surface-variant">저장해도 개인 초안으로만 남고, 위키에 바로 게시되지 않습니다.</p></div>{proposal && !savedDraftId && <button type="button" onClick={() => void saveDraft()} disabled={saving || !proposalIsCurrent} className="rounded-lg border border-outline-variant/25 px-3 py-2 text-[12px] font-semibold disabled:opacity-40">{saving ? '저장 중…' : '새 초안으로 저장'}</button>}</div>
          {proposal ? <><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[12px] leading-6 text-on-surface">{proposal}</pre>{!proposalIsCurrent && <p role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">선택한 자료가 바뀌었습니다. 새 전송 미리보기를 확인한 뒤 다시 만들어 주세요.</p>}<p className="mt-2 border-t border-outline-variant/15 pt-2 text-[11px] leading-5 text-on-surface-variant">연결된 출처는 참고 위치이며, 제안 내용이 사실로 검증됐다는 뜻은 아닙니다.</p>{savedDraftId && <p role="status" className="mt-2 rounded-lg bg-primary-container/50 px-3 py-2 text-[12px]">새 개인 초안에 저장했습니다. <Link href={`/studio?draft=${encodeURIComponent(savedDraftId)}`} onClick={onClose} className="font-bold text-primary underline">초안 열기</Link></p>}</> : <p className="mt-3 rounded-lg bg-surface-container-low p-3 text-center text-[12px] leading-5 text-on-surface-variant">주제와 참고할 자료를 고르면, AI 제안을 미리 확인하고 새 초안으로 저장할 수 있습니다.</p>}
          </div>
        </div>
      </div>
      {previewExpanded && approvedSnapshot && <div className="max-h-56 shrink-0 space-y-3 overflow-y-auto border-t border-outline-variant/15 bg-white px-4 py-3">{previewRecords.map(previewRecord)}</div>}
      <footer className="shrink-0 border-t border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
        {error && <p role="alert" className="mb-2 rounded-lg border border-error/20 bg-error-container/40 px-3 py-2 text-[12px] leading-5 text-error">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto inline-flex items-center gap-1 text-[12px] text-on-surface-variant">선택 {selectedRecords.length}개{approvedSnapshot ? ` · 보낼 발췌 ${approvedSnapshot.records.length}개 · ${selectedChars.toLocaleString()}자` : ' · 보낼 내용 확인 전'}<InfoHint label="선택 자료와 전송 분량 안내" text="한 번에 최대 8개 기록에서 총 8,000자까지 보냅니다. 미리보기에는 실제로 보낼 제목, 출처 성격, 발췌문이 표시됩니다. 기록 식별자는 기본 화면에 표시하지 않습니다. 검토 전에 제안을 새 개인 초안으로 저장할 수 있으며 기존 자료나 위키는 바뀌지 않습니다." /></span>
          <button type="button" onClick={() => setPreviewExpanded((value) => !value)} disabled={!approvedSnapshot || saving} className="rounded-lg border border-outline-variant/25 px-3 py-2.5 text-[12px] font-semibold disabled:opacity-40">{previewExpanded ? '발췌 접기' : '실제 보낼 발췌 보기'}</button>
          <button type="button" onClick={() => void prepareSnapshot()} disabled={!question.trim() || !selectedRecords.length || selectedRecords.length > 8 || preparing || generating || saving} className="rounded-lg border border-outline-variant/25 px-3 py-2.5 text-[12px] font-semibold disabled:opacity-40">{preparing ? '확인 중…' : approvedSnapshot ? '발췌 다시 확인' : '보낼 내용 확인'}</button>
          <button type="button" onClick={() => void generate()} disabled={!question.trim() || !selectedRecords.length || !approvedSnapshot?.snapshotHash || generating || searching || preparing || saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-[12px] font-bold text-on-primary disabled:opacity-40">{generating ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}초안 만들기</button>
        </div>
      </footer>
    </section>
  </div>;
}
