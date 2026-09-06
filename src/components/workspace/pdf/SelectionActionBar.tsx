'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Highlighter, MoreHorizontal, NotebookPen, Sparkles } from 'lucide-react';
import { HighlightWorkKind } from '@/types';

export interface SelectionActionBarProps {
  left: number;
  top: number;
  onExplain: () => void;
  onDeepSeek: () => void;
  onStudyCard: () => void;
  onClozeCard: () => void;
  onImportant: () => void;
  onUnclear: () => void;
  onConcept: () => void;
  onMemorize: () => void;
  onQuestion: () => void;
  onNote: () => void;
  onWorkKind: (kind: HighlightWorkKind) => void;
  onTranslate: () => void;
  onDismiss: () => void;
}

function preserveSelection(event: React.MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

export function SelectionActionBar({
  left,
  top,
  onExplain,
  onDeepSeek,
  onStudyCard,
  onClozeCard,
  onImportant,
  onUnclear,
  onConcept,
  onMemorize,
  onQuestion,
  onNote,
  onWorkKind,
  onTranslate,
  onDismiss,
}: SelectionActionBarProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [onDismiss]);

  const action = (callback: () => void) => () => {
    setMoreMenuOpen(false);
    callback();
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-[70] flex max-w-[calc(100vw-16px)] items-center gap-0.5 rounded-xl border border-outline-variant/35 bg-surface-container-lowest/95 p-1 shadow-ambient backdrop-blur-sm"
      style={{ left, top }}
      role="toolbar"
      aria-label="선택한 PDF 문장 작업"
    >
      <button
        type="button"
        onMouseDown={preserveSelection}
        onClick={action(onImportant)}
        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-tertiary-fixed hover:bg-surface-container"
        aria-label="선택 영역을 중요로 표시"
        title="중요 표시"
      >
        <Highlighter size={12} aria-hidden="true" />
        중요
      </button>
      <button
        type="button"
        onMouseDown={preserveSelection}
        onClick={action(onUnclear)}
        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-study-unclear hover:bg-study-unclear-container"
        aria-label="선택 영역을 이해 필요로 표시"
        title="나중에 다시 볼 이해 필요 기록"
      >
        <CircleHelp size={12} aria-hidden="true" />
        이해 필요
      </button>
      <button
        type="button"
        onMouseDown={preserveSelection}
        onClick={action(onExplain)}
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-primary/20 bg-primary-container px-2 text-[11px] font-semibold text-primary hover:bg-primary-container/70"
        aria-label="선택 영역을 AI로 설명"
        title="선택 문장을 AI에게 설명 요청"
      >
        <Sparkles size={13} aria-hidden="true" />
        AI 설명
      </button>
      <button
        type="button"
        onMouseDown={preserveSelection}
        onClick={action(onNote)}
        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-on-surface hover:bg-surface-container"
        aria-label="선택 영역에 메모 남기기"
        title="메모 남기기"
      >
        <NotebookPen size={12} aria-hidden="true" />
        메모
      </button>
      <div className="relative">
        <button
          type="button"
          onMouseDown={preserveSelection}
          onClick={() => setMoreMenuOpen((current) => !current)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container"
          aria-label="선택 영역의 더 많은 작업"
          aria-expanded={moreMenuOpen}
          aria-haspopup="menu"
          aria-controls="pdf-selection-more-menu"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {moreMenuOpen && (
          <div id="pdf-selection-more-menu" role="menu" className="absolute right-0 top-full z-10 mt-1 w-44 rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-1 shadow-ambient" aria-label="선택 영역의 더 많은 작업">
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-on-surface-variant">표시</p>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(onConcept)} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">개념/정의로 표시</button>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(onMemorize)} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">외울 것으로 표시</button>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(onQuestion)} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">질문으로 표시</button>
            <div className="my-1 border-t border-outline-variant/20" />
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-on-surface-variant">학습</p>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(onStudyCard)} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">복습 카드</button>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(onClozeCard)} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">빈칸 카드</button>
            <div className="my-1 border-t border-outline-variant/20" />
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-on-surface-variant">업무</p>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(() => onWorkKind('finding'))} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">Finding</button>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(() => onWorkKind('verify'))} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">Verify</button>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(() => onWorkKind('discuss'))} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">Discuss</button>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(() => onWorkKind('try'))} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">Try</button>
            <div className="my-1 border-t border-outline-variant/20" />
            <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-on-surface-variant">AI</p>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(onDeepSeek)} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-primary hover:bg-primary-container/50">DeepSeek 웹에 물어보기</button>
            <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={action(onTranslate)} className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-on-surface hover:bg-surface-container">선택 영역 번역</button>
          </div>
        )}
      </div>
    </div>
  );
}
