'use client';

import { FileText, Loader2, Scissors, X } from 'lucide-react';

export interface SplitDialogSegment {
  title: string;
  charCount: number;
  preview: string;
  hardSplit: boolean;
}

interface KnowledgeSplitDialogProps {
  sourceName: string;
  charCount: number;
  segments: SplitDialogSegment[];
  warnings: string[];
  allowSingle: boolean;
  busy: boolean;
  onCancel: () => void;
  onImport: (mode: 'single' | 'split') => void;
}

export function KnowledgeSplitDialog({
  sourceName,
  charCount,
  segments,
  warnings,
  allowSingle,
  busy,
  onCancel,
  onImport,
}: KnowledgeSplitDialogProps) {
  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-black/25 px-4 py-[8vh]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="knowledge-split-title" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-ambient">
        <div className="flex items-start gap-3 border-b border-outline-variant/20 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-container text-primary"><Scissors size={17} /></div>
          <div className="min-w-0 flex-1"><h2 id="knowledge-split-title" className="text-base font-bold">긴 메모를 나눠서 수집할까요?</h2><p className="mt-1 truncate text-xs text-on-surface-variant" title={sourceName}>{sourceName} · {charCount.toLocaleString()}자</p></div>
          <button type="button" onClick={onCancel} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container disabled:opacity-40" aria-label="분할 미리보기 닫기"><X size={16} /></button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto px-5 py-5">
          <p className="text-xs leading-5 text-on-surface-variant">제목과 문단 경계를 기준으로 나눈 미리보기입니다. 원본 파일은 바뀌지 않으며, 수집된 조각도 각각 원본 메모로 보관됩니다.</p>
          {warnings.map((warning) => <p key={warning} className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">{warning}</p>)}
          <div className="mt-4 space-y-2">
            {segments.map((segment, index) => <article key={`${segment.title}-${index}`} className="rounded-xl border border-outline-variant/25 bg-surface-container-low p-3"><div className="flex items-center gap-2"><FileText size={14} className="shrink-0 text-primary" /><h3 className="min-w-0 flex-1 truncate text-xs font-bold">{index + 1}. {segment.title}</h3><span className="shrink-0 text-[10px] text-outline">{segment.charCount.toLocaleString()}자</span></div><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] leading-5 text-on-surface-variant">{segment.preview}</p>{segment.hardSplit && <p className="mt-2 text-[10px] text-amber-800">경계가 없는 긴 문단에서 나눈 조각</p>}</article>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-outline-variant/20 px-5 py-3"><button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-bold text-on-surface-variant disabled:opacity-40">취소</button>{allowSingle && <button type="button" onClick={() => onImport('single')} disabled={busy} className="rounded-lg bg-surface-container px-3 py-2 text-xs font-bold text-on-surface-variant disabled:opacity-40">한 메모로 수집</button>}<button type="button" onClick={() => onImport('split')} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:opacity-40">{busy && <Loader2 size={13} className="animate-spin" />}제안대로 {segments.length}개 수집</button></div>
      </div>
    </div>
  );
}
