'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, Trash2 } from 'lucide-react';

export type MobileKnowledgeKind = 'topic' | 'note';

export interface MobileKnowledgeShelfItem {
  id: string;
  kind: MobileKnowledgeKind;
  title: string;
  missing: boolean;
  status?: string;
}

interface MobileKnowledgeSearchItem {
  id: string;
  kind: MobileKnowledgeKind;
  title: string;
  updatedAt: string;
  status?: string;
}

interface MobileKnowledgeSearchResult {
  items: MobileKnowledgeSearchItem[];
  total: number;
  offset: number;
  limit: number;
}

interface MobileKnowledgeShelfProps {
  selectedItems: MobileKnowledgeShelfItem[];
  disabled?: boolean;
  onSelectionChange: (items: MobileKnowledgeShelfItem[]) => Promise<void> | void;
}

const PAGE_SIZE = 50;

function itemKey(item: Pick<MobileKnowledgeShelfItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

function kindLabel(kind: MobileKnowledgeKind, status?: string): string {
  if (kind === 'topic') return '정리 노트';
  const statusLabel: Record<string, string> = {
    inbox: '정리 전',
    review: '검토 중',
    integrated: '반영됨',
    dismissed: '제외됨',
    error: '오류',
  };
  return `수집 메모 · 상태: ${statusLabel[status || ''] || '확인 필요'}`;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR');
}

export function MobileKnowledgeShelf({ selectedItems, disabled = false, onSelectionChange }: MobileKnowledgeShelfProps) {
  const [queryDraft, setQueryDraft] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [items, setItems] = useState<MobileKnowledgeSearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const requestId = useRef(0);
  const mutationId = useRef(0);
  const mutationGate = useRef(false);
  const activeController = useRef<AbortController | null>(null);

  const selectedKeys = new Set(selectedItems.map(itemKey));

  const loadPage = async (query: string, nextOffset: number) => {
    const currentRequestId = ++requestId.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ q: query, offset: String(nextOffset), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/mobile-bridge/knowledge?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json() as Partial<MobileKnowledgeSearchResult> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || '지식 목록을 불러오지 못했습니다.');
      if (currentRequestId !== requestId.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setOffset(typeof data.offset === 'number' ? data.offset : nextOffset);
    } catch (loadError) {
      if (controller.signal.aborted || currentRequestId !== requestId.current) return;
      setItems([]);
      setTotal(0);
      setError(loadError instanceof Error ? loadError.message : '지식 목록을 불러오지 못했습니다.');
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage('', 0);
    return () => activeController.current?.abort();
  }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = queryDraft.trim();
    setSubmittedQuery(nextQuery);
    void loadPage(nextQuery, 0);
  };

  const changePage = (nextOffset: number) => {
    if (loading || nextOffset < 0 || nextOffset >= total) return;
    void loadPage(submittedQuery, nextOffset);
  };

  const mutateSelection = async (item: MobileKnowledgeSearchItem | MobileKnowledgeShelfItem) => {
    const key = itemKey(item);
    if (disabled || pendingKey || mutationGate.current) return;
    const removing = selectedKeys.has(key);
    const currentMutationId = ++mutationId.current;
    mutationGate.current = true;
    setPendingKey(key);

    try {
      const response = await fetch(
        removing
          ? `/api/mobile-bridge/knowledge?kind=${encodeURIComponent(item.kind)}&id=${encodeURIComponent(item.id)}`
          : '/api/mobile-bridge/knowledge',
        {
          method: removing ? 'DELETE' : 'POST',
          headers: removing ? undefined : { 'Content-Type': 'application/json' },
          body: removing ? undefined : JSON.stringify({ kind: item.kind, id: item.id }),
        },
      );
      const data = await response.json() as { bridge?: { knowledgeShelf?: MobileKnowledgeShelfItem[] }; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || '모바일 지식 보관함을 변경하지 못했습니다.');
      if (currentMutationId !== mutationId.current) return;
      const nextItems = Array.isArray(data.bridge?.knowledgeShelf)
        ? data.bridge.knowledgeShelf
        : removing
          ? selectedItems.filter((selected) => itemKey(selected) !== key)
          : [...selectedItems, { ...item, missing: false }];
      await onSelectionChange(nextItems);
    } catch (mutationError) {
      if (currentMutationId !== mutationId.current) return;
      setError(mutationError instanceof Error ? mutationError.message : '모바일 지식 보관함을 변경하지 못했습니다.');
    } finally {
      if (currentMutationId === mutationId.current) {
        mutationGate.current = false;
        setPendingKey(null);
      }
    }
  };

  return (
    <div className="mt-4 rounded-xl bg-surface-container p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">정리 노트·수집 메모 고르기</p>
          <p className="mt-1 text-[11px] leading-4 text-on-surface-variant">
            읽기 사본에 넣을 지식만 직접 고릅니다. 정리 노트와 수집 메모는 구분해 표시하며, 수집 메모의 원문이나 AI 상태를 확인된 지식으로 바꾸지 않습니다.
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-outline">선택 {selectedItems.length}개</span>
      </div>

      {selectedItems.length > 0 && (
        <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto pr-1" aria-label="선택한 모바일 지식">
          <p className="text-[10px] font-semibold text-on-surface-variant">선택한 항목</p>
          {selectedItems.map((item) => {
            const key = itemKey(item);
            const isPending = pendingKey === key;
            return (
              <div key={key} className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-container-lowest px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-on-surface" title={item.title}>{item.title}</p>
                  <p className="truncate text-[10px] text-outline" title={kindLabel(item.kind, item.status)}>
                    {kindLabel(item.kind, item.status)}{item.missing ? ' · 항목을 찾을 수 없음' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`${item.title} 선택 해제`}
                  onClick={() => void mutateSelection(item)}
                  disabled={disabled || Boolean(pendingKey)}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  제거
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <p role="alert" aria-live="assertive" className="mt-2 rounded-lg bg-error-container px-3 py-2 text-[11px] leading-4 text-error">{error}</p>}

      <details
        className="mt-3 rounded-lg border border-outline-variant/25 bg-surface-container-lowest"
        open={pickerOpen}
        onToggle={(event) => setPickerOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-semibold text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span className="inline-flex min-w-0 items-center gap-1.5"><Search size={13} className="shrink-0 text-outline" />고를 항목 찾기</span>
          <span className="shrink-0 text-[10px] font-normal text-outline">최대 {PAGE_SIZE}개씩 표시</span>
        </summary>
        <div className="border-t border-outline-variant/20 px-3 pb-3">
          <form onSubmit={submitSearch} className="mt-3 flex min-w-0 flex-wrap gap-2">
            <label htmlFor="mobile-knowledge-search" className="sr-only">정리 노트·수집 메모 검색</label>
            <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container px-2.5">
              <Search size={14} className="shrink-0 text-outline" aria-hidden="true" />
              <input
                id="mobile-knowledge-search"
                value={queryDraft}
                onChange={(event) => setQueryDraft(event.target.value)}
                placeholder="제목·본문·메모 검색"
                maxLength={200}
                className="min-w-0 flex-1 bg-transparent py-2 text-xs text-on-surface outline-none placeholder:text-outline"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              검색
            </button>
          </form>

          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
            {!loading && !error && items.length === 0 && (
              <p className="rounded-lg border border-dashed border-outline-variant/40 px-3 py-4 text-center text-[11px] text-on-surface-variant">
                {submittedQuery ? '검색 결과가 없습니다.' : '고를 수 있는 정리 노트·수집 메모가 없습니다.'}
              </p>
            )}
            {items.map((item) => {
              const key = itemKey(item);
              const isSelected = selectedKeys.has(key);
              const isPending = pendingKey === key;
              return (
                <div key={key} className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-container px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-on-surface" title={item.title}>{item.title}</p>
                    <p className="truncate text-[10px] text-outline" title={kindLabel(item.kind, item.status)}>
                      {kindLabel(item.kind, item.status)}{formatUpdatedAt(item.updatedAt) ? ` · ${formatUpdatedAt(item.updatedAt)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={isSelected ? `${item.title} 선택 해제` : `${item.title} 모바일에 추가`}
                    onClick={() => void mutateSelection(item)}
                    disabled={disabled || Boolean(pendingKey)}
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold text-primary hover:bg-primary-container disabled:opacity-50"
                  >
                    {isPending ? <Loader2 size={12} className="animate-spin" /> : isSelected ? <Trash2 size={12} /> : <Plus size={12} />}
                    {isSelected ? '제거' : '추가'}
                  </button>
                </div>
              );
            })}
          </div>

          {total > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-outline">
              <span>{offset + 1}–{Math.min(offset + items.length, total)} / {total}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="이전 지식 목록"
                  onClick={() => changePage(offset - PAGE_SIZE)}
                  disabled={loading || offset === 0}
                  className="rounded p-1.5 hover:bg-surface-container-high disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  aria-label="다음 지식 목록"
                  onClick={() => changePage(offset + PAGE_SIZE)}
                  disabled={loading || offset + PAGE_SIZE >= total}
                  className="rounded p-1.5 hover:bg-surface-container-high disabled:opacity-40"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
