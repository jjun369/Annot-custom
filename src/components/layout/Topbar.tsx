'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Settings, MessageSquare, PictureInPicture2, X, Loader2, FileText } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-store';
import { useFeedback } from '@/components/common/FeedbackProvider';
import Link from 'next/link';
import { PaperMetadata, TreeNode } from '@/types';

interface SearchResult {
  pdf: TreeNode;
  metadata: PaperMetadata;
  matches: string[];
}

export function Topbar() {
  const {
    activeSessionFolder,
    activeSessionKind,
    activeSessionPdfPath,
    activeSessionId,
    chatOpen,
    toggleChat,
    openPdf,
  } = useWorkspace();
  const { notify } = useFeedback();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const detachChat = () => {
    if (!activeSessionFolder || !activeSessionKind) return;
    const params = new URLSearchParams({
      folderPath: activeSessionFolder,
      sessionKind: activeSessionKind,
    });
    if (activeSessionPdfPath) params.set('pdfPath', activeSessionPdfPath);
    if (activeSessionId) params.set('sessionId', activeSessionId);
    const popup = window.open(
      `/chat-window?${params.toString()}`,
      'annot-detached-chat',
      'popup=yes,width=560,height=860,resizable=yes,scrollbars=no',
    );
    if (!popup) {
      notify('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.', 'error');
      return;
    }
    popup.focus();
    if (chatOpen) toggleChat();
  };

  return (
    <header className="h-12 px-4 flex items-center justify-between shrink-0 bg-surface">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-md bg-on-surface text-surface-container-lowest flex items-center justify-center font-bold text-[11px]">
          A.
        </div>
        <span className="text-sm font-bold text-on-surface tracking-tight">Annot</span>
      </div>

      {/* Center: Breadcrumb (if session active) */}
      {activeSessionFolder && (
        <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          {activeSessionFolder.split('/').map((segment, i, arr) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-outline">/</span>}
              <span className={i === arr.length - 1 ? 'text-on-surface font-medium' : ''}>
                {segment}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setSearchOpen(true)}
          className="flex h-8 items-center gap-2 rounded-lg px-2 text-on-surface-variant hover:bg-surface-container-high transition-colors"
          title="통합 검색 (Ctrl+K)"
        >
          <Search size={15} strokeWidth={2} />
          <span className="hidden text-[11px] sm:inline">검색</span>
        </button>
        {activeSessionFolder && (
          <button
            onClick={detachChat}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="AI 대화창 분리"
          >
            <PictureInPicture2 size={15} strokeWidth={2} />
          </button>
        )}
        {activeSessionFolder && (
          <button
            onClick={toggleChat}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              chatOpen
                ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            aria-label="AI 대화창 열기 또는 닫기"
          >
            <MessageSquare size={15} strokeWidth={2} />
          </button>
        )}
        <Link
          href="/settings"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
          aria-label="설정"
          title="설정"
        >
          <Settings size={15} strokeWidth={2} />
        </Link>
      </div>
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSearchOpen(false);
          }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-ambient">
            <div className="flex items-center gap-3 border-b border-outline-variant/20 px-4 py-3">
              <Search size={18} className="text-outline" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="파일명, 태그, 요약, 개인 메모 검색"
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
                <div className="px-3 py-5 text-xs text-on-surface-variant">검색 결과가 없습니다.</div>
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
    </header>
  );
}
