'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, MessageSquare, PanelRightOpen, X, Loader2, FileText } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-store';
import { PaperMetadata, TreeNode } from '@/types';
import { AppHeader } from '@/components/layout/AppHeader';

interface SearchResult {
  pdf: TreeNode;
  metadata: PaperMetadata;
  matches: string[];
}

export function Topbar() {
  const {
    activeSessionFolder,
    chatOpen,
    toggleChat,
    openPdf,
  } = useWorkspace();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const openSideChat = () => {
    if (window.pageDockDesktop?.sideChat) {
      void window.pageDockDesktop.sideChat.open();
      return;
    }
    // A normal browser is useful for local UI review too. Do not infer popup
    // success from window.open: browsers may return null for a blocked popup.
    void window.open('/side-chat', '_blank', 'popup,width=1260,height=860');
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const timeout = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/papers/search?q=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled) setResults(res.ok && Array.isArray(data.results) ? data.results : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, searchOpen]);

  return (
    <>
      <AppHeader
        active="library"
        onSearch={() => setSearchOpen(true)}
        actions={(
          <div className="mr-1 flex items-center gap-1 border-r border-outline-variant/35 pr-2">
            <button
              type="button"
              onClick={openSideChat}
              className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              aria-label="독립 사이드채팅 열기"
              title="PDF 대화와 분리된 사이드채팅 열기"
            >
              <PanelRightOpen size={15} strokeWidth={2} />
              <span className="hidden lg:inline">사이드채팅</span>
            </button>
            {activeSessionFolder && (
            <button
              onClick={toggleChat}
              className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                chatOpen
                  ? 'bg-primary-container text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
              }`}
              aria-label="AI 대화창 열기 또는 닫기"
            >
              <MessageSquare size={15} strokeWidth={2} />
              <span className="hidden lg:inline">AI 대화</span>
            </button>
            )}
          </div>
        )}
      />
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSearchOpen(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="통합 검색" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-ambient">
            <div className="flex items-center gap-3 border-b border-outline-variant/20 px-4 py-3">
              <Search size={18} className="text-outline" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="제목, 본문, 태그, 메모 검색"
                className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-outline"
              />
              <kbd className="hidden rounded bg-surface-container px-2 py-1 text-[10px] text-outline sm:inline">ESC</kbd>
              <button
                onClick={() => setSearchOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container"
                aria-label="검색 닫기"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {searching && (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-on-surface-variant">
                  <Loader2 size={14} className="animate-spin" /> 검색 중...
                </div>
              )}
              {!searching && query.trim().length < 2 && (
                <div className="px-3 py-5 text-xs leading-5 text-on-surface-variant">
                  두 글자 이상 입력하면 논문 파일명과 저장된 연구 기록을 검색합니다.
                </div>
              )}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <div className="px-3 py-5 text-xs leading-5 text-on-surface-variant" role="status">
                  <p><span className="font-semibold text-on-surface">“{query.trim()}”</span>과 일치하는 항목이 없습니다.</p>
                  <p className="mt-1">다른 단어로 찾아보거나, 현재 PDF 안의 문장은 Reader 상단 검색을 사용해 보세요.</p>
                </div>
              )}
              {!searching && results.map((result) => (
                <button
                  key={result.pdf.path}
                  onClick={() => {
                    openPdf(result.pdf);
                    setSearchOpen(false);
                  }}
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-container"
                >
                  <FileText size={17} className="mt-0.5 shrink-0 text-outline" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-on-surface">{result.pdf.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-outline">{result.pdf.path}</span>
                    <span className="mt-1 block text-[10px] font-semibold text-primary">논문 파일 · 저장한 메모까지 검색</span>
                    <span className="mt-1 block text-[11px] text-on-surface-variant">
                      {result.matches.join(' · ')}
                      {result.metadata.summaryKo ? ` · ${result.metadata.summaryKo.split('\n')[0]}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
