'use client';

import { useCallback, useRef, useState } from 'react';

import { MAX_STUDY_CARD_CLOZE_CHARS } from '@/lib/study-cards';
import { StudyCardCloze } from '@/types';

interface ClozeRangePickerProps {
  sourceText: string;
  value: StudyCardCloze | null;
  onChange: (value: StudyCardCloze | null) => void;
  disabled?: boolean;
}

function getSelectionRange(root: HTMLElement, sourceText: string): StudyCardCloze | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const text = range.toString();
  const end = start + text.length;
  if (!text.trim() || text.length > MAX_STUDY_CARD_CLOZE_CHARS || start < 0 || end > sourceText.length) return null;
  const exactText = sourceText.slice(start, end);
  return exactText === text ? { text: exactText, start, end } : null;
}

/**
 * A small range picker for source-anchored cloze cards. It only exposes a
 * span inside the already immutable source excerpt; it never edits that text.
 */
export function ClozeRangePicker({ sourceText, value, onChange, disabled = false }: ClozeRangePickerProps) {
  const rootRef = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const capture = useCallback(() => {
    if (disabled || !rootRef.current) return;
    const range = getSelectionRange(rootRef.current, sourceText);
    if (range) {
      setNotice(null);
      onChange(range);
      return;
    }
    const selection = window.getSelection()?.toString() || '';
    if (selection && rootRef.current.contains(window.getSelection()?.anchorNode || null)) {
      setNotice(selection.length > MAX_STUDY_CARD_CLOZE_CHARS
        ? `빈칸 답은 ${MAX_STUDY_CARD_CLOZE_CHARS}자 이하의 짧은 구로 지정해 주세요.`
        : '원문 안에서 공백이 아닌 연속된 구를 다시 선택해 주세요.');
    }
  }, [disabled, onChange, sourceText]);

  return (
    <div className="rounded-xl bg-surface-container px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-widest text-on-surface-variant">원문에서 숨길 구 지정</div>
      <p className="mt-2 text-[11px] leading-5 text-on-surface-variant">아래 원문 안에서 외울 짧은 구 하나를 다시 드래그해 선택하세요.</p>
      <p
        ref={rootRef}
        tabIndex={0}
        onMouseUp={capture}
        onKeyUp={capture}
        aria-label="빈칸으로 만들 원문 구 선택"
        className="mt-3 max-h-36 cursor-text overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-outline-variant/25 bg-surface px-3 py-2.5 text-sm leading-6 text-on-surface outline-none focus-visible:border-outline disabled:cursor-default disabled:opacity-60"
      >
        {sourceText}
      </p>
      {value ? (
        <p className="mt-2 text-xs leading-5 text-on-surface-variant">빈칸으로 지정됨: <span className="font-medium text-on-surface">{value.text}</span></p>
      ) : (
        <p className="mt-2 text-xs leading-5 text-on-surface-variant">아직 숨길 구를 선택하지 않았습니다.</p>
      )}
      {notice && <p className="mt-2 text-xs leading-5 text-error" role="alert">{notice}</p>}
    </div>
  );
}
