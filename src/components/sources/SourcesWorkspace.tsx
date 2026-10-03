'use client';

import { ExternalLink, FilePlus2, FolderOpen, Link2, LoaderCircle, Pencil, Plus, Search, Tag, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppHeader } from '@/components/layout/AppHeader';
import { buildKnowledgeSourceReaderUrl } from '@/lib/knowledge-retrieval';
import { shouldCloseStudioEscape, SOURCE_KINDS } from '@/lib/sources-studio-shared';
import type { StudioSource, StudioSourceKind } from '@/lib/sources-studio';
import type { TreeNode } from '@/types';

type SourcePayload = { sources: StudioSource[]; warnings: string[] };
type ComposeKind = 'memo' | 'clip' | 'edit' | null;

const KIND_LABELS: Record<StudioSourceKind, string> = {
  memo: '개인 메모', paper: '논문·학회', official_article: '공식·기술 자료', web_clip: '웹 클립', patent: '특허',
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '요청을 처리하지 못했습니다.');
  return body;
}

function SourceDialog({
  mode, source, onClose, onCreated, onUpdated,
}: {
  mode: Exclude<ComposeKind, null>;
  source?: StudioSource;
  onClose: () => void;
  onCreated: (source: StudioSource) => void;
  onUpdated: (source: StudioSource) => void;
}) {
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  const [title, setTitle] = useState(source?.title ?? '');
  const [url, setUrl] = useState(source?.url ?? '');
  const [kind, setKind] = useState<StudioSourceKind>(source?.kind ?? (mode === 'clip' ? 'web_clip' : 'memo'));
  const [tags, setTags] = useState(source?.tags.join(', ') ?? '');
  const [text, setText] = useState(mode === 'edit' && source?.ownsText ? source.text : '');
  const [error, setError] = useState('');

  useEffect(() => { busyRef.current = busy; closeRef.current = onClose; }, [busy, onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (shouldCloseStudioEscape(event) && !busyRef.current) closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus();
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      if (mode === 'memo' || mode === 'clip') {
        const response = await fetch('/api/sources-studio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: mode, title, url, kind, text, tags: tagList }),
        });
        const body = await readJson(response);
        onCreated(body.source as StudioSource);
      } else if (source) {
        const response = await fetch('/api/sources-studio', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'source', id: source.id, expectedUpdatedAt: source.updatedAt, title, url, kind, tags: tagList, ...(source.ownsText ? { text } : {}) }),
        });
        const body = await readJson(response);
        onUpdated(body.source as StudioSource);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '저장하지 못했습니다.');
      setBusy(false);
    }
  };

  const heading = mode === 'memo' ? '새 개인 메모' : mode === 'clip' ? '클립 추가' : '자료 메타데이터 편집';
  const original = source?.originalText ?? '';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="source-dialog-title" onSubmit={submit} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-ambient">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-primary">자료함</p><h2 id="source-dialog-title" className="mt-1 text-lg font-bold text-on-surface">{heading}</h2></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container" aria-label="닫기"><X size={17} /></button>
        </div>
        <label className="mt-4 block text-xs font-semibold text-on-surface">제목
          <input ref={titleRef} required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 outline-none focus:border-primary" />
        </label>
        {mode !== 'memo' && <label className="mt-3 block text-xs font-semibold text-on-surface">원문 URL · 선택
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" inputMode="url" className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 outline-none focus:border-primary" />
        </label>}
        <label className="mt-3 block text-xs font-semibold text-on-surface">자료 분류
          <select value={kind} onChange={(event) => setKind(event.target.value as StudioSourceKind)} className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5">
            {SOURCE_KINDS.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
          </select>
          {mode !== 'edit' && <span className="mt-1 block text-[10px] font-normal text-on-surface-variant">필요할 때만 바꾸세요. 기본값은 {mode === 'clip' ? '웹 클립' : '개인 메모'}입니다.</span>}
        </label>
        <label className="mt-3 block text-xs font-semibold text-on-surface">태그 · 쉼표로 구분
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="예: 센서, 공정 윈도우" className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 outline-none focus:border-primary" />
        </label>
        {mode !== 'edit' && <label className="mt-3 block text-xs font-semibold text-on-surface">붙여 넣은 원문
          <textarea required maxLength={200_000} value={text} onChange={(event) => setText(event.target.value)} rows={9} className="mt-1 w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 font-normal leading-6 outline-none focus:border-primary" placeholder="PDF 없이도 저장할 수 있습니다. 웹페이지는 직접 복사한 텍스트만 붙여 넣습니다." />
        </label>}
        {mode === 'edit' && source && <>
          {source.ownsText ? <label className="mt-3 block text-xs font-semibold text-on-surface">내 편집본
            <textarea required maxLength={200_000} value={text} onChange={(event) => setText(event.target.value)} rows={9} className="mt-1 w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 font-normal leading-6 outline-none focus:border-primary" />
            <span className="mt-1 block text-[10px] font-normal text-on-surface-variant">수정 전 텍스트는 Sources/Studio revision에 남고, Knowledge의 캡처 원문은 바뀌지 않습니다.</span>
          </label> : <div className="mt-3 rounded-xl bg-surface-container-low p-3 text-xs leading-5 text-on-surface-variant">원문 본문은 {source.origin === 'research' ? 'Research' : 'Knowledge'}의 기존 레코드에서 읽습니다. 이 화면은 별도 제목·분류·태그만 저장하며 캡처 원문을 덮어쓰지 않습니다.{original ? <span className="mt-2 block max-h-32 overflow-auto whitespace-pre-wrap text-[11px]">{original.slice(0, 1200)}</span> : null}</div>}
        </>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container">취소</button><button type="submit" disabled={busy} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-50">{busy && <LoaderCircle size={14} className="animate-spin" />}{busy ? '저장 중…' : '저장'}</button></div>
      </form>
    </div>
  );
}

export function SourcesWorkspace() {
  const [sources, setSources] = useState<StudioSource[]>([]);
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<StudioSourceKind | 'all'>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [filterRailCollapsed, setFilterRailCollapsed] = useState(false);
  const [dialog, setDialog] = useState<ComposeKind>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const importRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [response, treeResponse] = await Promise.all([
        fetch('/api/sources-studio', { cache: 'no-store' }),
        fetch('/api/workspace/tree', { cache: 'no-store' }).catch(() => null),
      ]);
      const body = await readJson(response);
      if (treeResponse?.ok) setRoot(await treeResponse.json() as TreeNode);
      const data = body as unknown as SourcePayload;
      setSources(data.sources ?? []);
      setWarnings(data.warnings ?? []);
      setSelectedId((previous) => (data.sources ?? []).some((source) => source.id === previous) ? previous : data.sources?.[0]?.id ?? '');
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '자료를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const onPointer = (event: MouseEvent) => { if (!importRef.current?.contains(event.target as Node)) setImportOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (shouldCloseStudioEscape(event)) setImportOpen(false); };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onPointer); window.removeEventListener('keydown', onKey); };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().normalize('NFKC').toLowerCase();
    return sources.filter((source) => {
      if (kindFilter !== 'all' && source.kind !== kindFilter) return false;
      if (tagFilter && !source.tags.includes(tagFilter)) return false;
      if (!needle) return true;
      return `${source.title}\n${source.text}\n${source.tags.join(' ')}\n${source.originLabel}`.normalize('NFKC').toLowerCase().includes(needle);
    });
  }, [sources, query, kindFilter, tagFilter]);
  const selected = sources.find((source) => source.id === selectedId) ?? filtered[0] ?? null;
  const tags = useMemo(() => [...new Set(sources.flatMap((source) => source.tags))].sort((a, b) => a.localeCompare(b, 'ko')), [sources]);
  const kindCounts = useMemo(() => SOURCE_KINDS.map((kind) => ({ kind, count: sources.filter((source) => source.kind === kind).length })), [sources]);

  const newSource = (source: StudioSource) => {
    setSources((current) => [source, ...current.filter((item) => item.id !== source.id)]);
    setSelectedId(source.id);
  };
  const openOriginal = (source: StudioSource): { href: string; external: boolean } | null => {
    const target = source.readerTargets?.[0]
      ?? (source.documentId ? { documentId: source.documentId, page: 1 } : null);
    const readerHref = target && root ? buildKnowledgeSourceReaderUrl(root, target) : null;
    if (readerHref) return { href: readerHref, external: false };
    if (source.url) return { href: source.url, external: true };
    if (source.origin === 'wiki') return { href: '/knowledge', external: false };
    if (source.origin === 'research') return { href: '/research', external: false };
    return null;
  };
  const originalTarget = selected ? openOriginal(selected) : null;

  return <div className="flex h-dvh min-h-[620px] flex-col bg-surface">
    <AppHeader active="sources" actions={<div className="flex items-center gap-1.5">
      <div ref={importRef} className="relative"><button type="button" onClick={() => setImportOpen((value) => !value)} aria-expanded={importOpen} className="flex h-9 items-center gap-1.5 rounded-lg border border-outline-variant/25 px-3 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"><FolderOpen size={14} />가져오기</button>
        {importOpen && <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-1 shadow-ambient"><Link href="/" onClick={() => setImportOpen(false)} className="block rounded-lg px-3 py-2 text-xs hover:bg-surface-container">라이브러리 파일·PDF 추가</Link><Link href="/research" onClick={() => setImportOpen(false)} className="block rounded-lg px-3 py-2 text-xs hover:bg-surface-container">Research 검색·프로젝트 자료</Link><Link href="/knowledge" onClick={() => setImportOpen(false)} className="block rounded-lg px-3 py-2 text-xs hover:bg-surface-container">Knowledge 파일·이미지·폴더 가져오기</Link></div>}
      </div>
      <button type="button" onClick={() => setDialog('clip')} className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"><Link2 size={14} />클립 추가</button>
      <button type="button" onClick={() => setDialog('memo')} className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-on-primary"><Plus size={14} />새 메모</button>
    </div>} />
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 min-h-0 flex-col px-3 py-3 sm:px-5">
      <div className="mb-3 flex items-center justify-between border-b border-outline-variant/20 px-1">
        <nav aria-label="자료함 메뉴" className="flex gap-5"><span className="border-b-2 border-primary px-1 pb-2 text-xs font-bold text-primary">내 자료</span><Link href="/research" className="px-1 pb-2 text-xs font-medium text-on-surface-variant hover:text-on-surface">리서치 검색·프로젝트</Link></nav>
        <div className="flex items-center gap-2">
          <span className="hidden pb-2 text-[10px] text-outline sm:block">Research·Knowledge 원문은 기존 저장소에서 읽습니다.</span>
          <button type="button" aria-controls="sources-filter-rail" aria-expanded={!filterRailCollapsed} onClick={() => setFilterRailCollapsed((value) => !value)} className="hidden rounded-lg border border-outline-variant/25 px-2.5 py-1.5 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container xl:inline-flex">{filterRailCollapsed ? '필터 펼치기' : '필터 접기'}</button>
        </div>
      </div>
      <div className={`mb-2 grid grid-cols-2 gap-2 ${filterRailCollapsed ? '' : 'xl:hidden'}`}>
        <label className="flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-2.5 py-2 text-[10px] font-semibold text-on-surface-variant">유형
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as StudioSourceKind | 'all')} aria-label="자료 유형 필터" className="min-w-0 flex-1 bg-transparent text-xs outline-none">
            <option value="all">전체</option>{SOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-2.5 py-2 text-[10px] font-semibold text-on-surface-variant">태그
          <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="자료 태그 필터" className="min-w-0 flex-1 bg-transparent text-xs outline-none">
            <option value="">전체</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
      </div>
      <div className={`grid min-h-0 flex-1 grid-cols-1 gap-3 ${filterRailCollapsed ? 'xl:grid-cols-[300px_minmax(0,1fr)]' : 'xl:grid-cols-[180px_300px_minmax(0,1fr)]'}`}>
        <aside id="sources-filter-rail" className={`${filterRailCollapsed ? 'hidden' : 'hidden xl:block'} min-h-0 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3`}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-outline">자료 유형</p>
          <button type="button" onClick={() => { setKindFilter('all'); setTagFilter(''); }} className={`mb-1 flex w-full justify-between rounded-lg px-2.5 py-2 text-left text-xs ${kindFilter === 'all' ? 'bg-primary-container font-bold text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}><span>전체</span><span>{sources.length}</span></button>
          {kindCounts.map(({ kind, count }) => <button key={kind} type="button" onClick={() => setKindFilter(kind)} className={`mb-1 flex w-full justify-between rounded-lg px-2.5 py-2 text-left text-xs ${kindFilter === kind ? 'bg-primary-container font-bold text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}><span>{KIND_LABELS[kind]}</span><span>{count}</span></button>)}
          <p className="mb-2 mt-5 text-[10px] font-bold uppercase tracking-wide text-outline">태그</p>
          {tags.length ? tags.map((tag) => <button key={tag} type="button" onClick={() => setTagFilter((value) => value === tag ? '' : tag)} className={`mb-1 flex w-full items-center gap-1.5 truncate rounded-lg px-2.5 py-2 text-left text-xs ${tagFilter === tag ? 'bg-primary-container font-bold text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}><Tag size={12} />{tag}</button>) : <p className="text-[11px] text-outline">아직 태그가 없습니다.</p>}
        </aside>
        <section className={`flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest ${selected ? 'max-xl:max-h-[38dvh]' : ''}`} aria-label="자료 목록">
          <label className="flex items-center gap-2 border-b border-outline-variant/15 px-3 py-2.5"><Search size={15} className="text-outline" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·본문·태그 검색" aria-label="자료 검색" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /><span className="text-[10px] text-outline">{filtered.length}</span></label>
          {loadError ? <div className="m-3 rounded-lg bg-error-container p-3 text-xs text-on-error-container" role="alert">{loadError}<button type="button" onClick={() => void refresh()} className="ml-2 underline">다시 시도</button></div> : null}
          {warnings.map((warning) => <p key={warning} className="border-b border-outline-variant/15 bg-tertiary-container/40 px-3 py-2 text-[10px] text-on-surface-variant">{warning}</p>)}
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {filtered.map((source) => <button key={source.id} type="button" onClick={() => setSelectedId(source.id)} className={`mb-1 block w-full rounded-lg border px-3 py-2.5 text-left ${source.id === selected?.id ? 'border-primary/25 bg-primary-container/70' : 'border-transparent hover:bg-surface-container-low'}`}>
              <span className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-on-surface">{source.title || '제목 없음'}</span><span className="shrink-0 text-[9px] text-outline">{KIND_LABELS[source.kind]}</span></span>
              <span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-on-surface-variant">{source.text || '본문 미리보기 없음'}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">{source.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-surface-container px-1.5 py-0.5 text-[9px] text-on-surface-variant">{tag}</span>)}</span>
            </button>)}
            {!filtered.length && !loadError && <div className="p-6 text-center"><FilePlus2 size={22} className="mx-auto text-outline" /><p className="mt-2 text-xs font-semibold text-on-surface">{sources.length ? '검색 결과가 없습니다.' : '아직 자료가 없습니다.'}</p><p className="mt-1 text-[10px] leading-4 text-on-surface-variant">PDF 없이 개인 메모를 저장하거나 웹에서 직접 복사한 텍스트를 클립으로 붙여 넣으세요.</p><button type="button" onClick={() => setDialog('memo')} className="mt-3 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-on-primary">+ 새 메모</button></div>}
          </div>
        </section>
        <section className="min-h-0 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 sm:p-6" aria-label="자료 상세">
          {selected ? <>
            <div className="mx-auto max-w-[78ch]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-[10px] font-semibold text-primary">{KIND_LABELS[selected.kind]} · {selected.originLabel}</p><h1 className="mt-1 break-words text-xl font-bold text-on-surface">{selected.title}</h1><p className="mt-1 break-all text-[10px] text-outline">{selected.id}</p></div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {originalTarget && <a href={originalTarget.href} target={originalTarget.external ? '_blank' : undefined} rel={originalTarget.external ? 'noreferrer' : undefined} className="flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/25 px-2.5 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container"><ExternalLink size={13} />원문 열기</a>}
                  <Link href={`/studio?source=${encodeURIComponent(selected.id)}`} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[10px] font-bold text-on-primary"><Pencil size={13} />글에 활용</Link>
                  <button type="button" onClick={() => setDialog('edit')} className="flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/25 px-2.5 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container"><Pencil size={13} />편집</button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">{selected.tags.map((tag) => <button key={tag} type="button" onClick={() => setTagFilter(tag)} className="rounded-full bg-surface-container px-2.5 py-1 text-[10px] text-on-surface-variant">#{tag}</button>)}</div>
              {selected.url && <a href={selected.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex max-w-full items-center gap-1 break-all text-[11px] text-primary hover:underline"><ExternalLink size={12} />{selected.url}</a>}
              {selected.ownsText && selected.text !== selected.originalText && <p className="mt-4 rounded-lg bg-tertiary-container/50 px-3 py-2 text-[10px] leading-4 text-on-surface-variant">아래는 사용자가 편집한 버전입니다. 캡처 당시 원문은 별도 탭에 보존되어 있습니다.</p>}
              <SourceText text={selected.text} original={selected.originalText} ownsText={selected.ownsText} />
              <div className="mt-5 border-t border-outline-variant/20 pt-3 text-[10px] text-outline">Stable ID: {selected.id} · 원문 기록 {new Date(selected.sourceUpdatedAt).toLocaleString()}</div>
            </div>
          </> : <div className="flex h-full flex-col items-center justify-center text-center text-on-surface-variant"><FolderOpen size={28} /><p className="mt-2 text-sm font-semibold">자료를 선택해 주세요</p><p className="mt-1 text-xs">새 메모는 PDF 없이도 만들 수 있습니다.</p></div>}
        </section>
      </div>
    </div>
    {dialog && <SourceDialog key={`${dialog}-${selected?.id ?? 'new'}`} mode={dialog} source={dialog === 'edit' ? selected ?? undefined : undefined} onClose={() => setDialog(null)} onCreated={(source) => { newSource(source); void refresh(); }} onUpdated={(source) => { setSources((items) => items.map((item) => item.id === source.id ? source : item)); }} />}
  </div>;
}

function SourceText({ text, original, ownsText }: { text: string; original: string; ownsText: boolean }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const displayed = ownsText && showOriginal ? original : text;
  return <>
    {ownsText && text !== original && <div className="mt-4 flex gap-1" role="tablist" aria-label="자료 본문 종류">
      <button type="button" role="tab" aria-selected={!showOriginal} onClick={() => setShowOriginal(false)} className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold ${!showOriginal ? 'bg-primary-container text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>편집본</button>
      <button type="button" role="tab" aria-selected={showOriginal} onClick={() => setShowOriginal(true)} className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold ${showOriginal ? 'bg-primary-container text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>캡처 원문</button>
    </div>}
    <article className="selectable-text mt-5 min-h-64 whitespace-pre-wrap break-words rounded-xl bg-surface-container-low p-4 text-[13px] leading-7 text-on-surface">{displayed || '저장된 본문이 없습니다.'}</article>
  </>;
}
