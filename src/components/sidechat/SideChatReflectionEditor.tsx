'use client';

import { useEffect, useRef, useState } from 'react';
import { SIDE_CHAT_MAX_REFLECTION_CHARS } from '@/lib/side-chat';

export function hasReflectionSaveConflict(initialText: string, savedText: string, draftText: string): boolean {
  return draftText !== savedText && initialText !== savedText;
}

const REFLECTION_CONFLICT_MESSAGE = '최신 내 이해가 바뀌어 저장하지 않았습니다. 현재 내용을 복사하거나 창을 다시 열어 확인하세요.';

export function SideChatReflectionEditor({ questionId, initialText, onSave, onStateChange }: {
  questionId: string;
  initialText: string;
  onSave: (text: string) => Promise<void>;
  onStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const activeQuestion = useRef(questionId);
  const previousQuestion = useRef(questionId);
  const draftRef = useRef(initialText);
  const savedRef = useRef(initialText);
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    onStateChange?.({ dirty: draft !== savedText, saving });
  }, [draft, onStateChange, savedText, saving]);

  useEffect(() => {
    activeQuestion.current = questionId;
    if (previousQuestion.current !== questionId) {
      draftRef.current = initialText;
      savedRef.current = initialText;
      conflictRef.current = false;
      setConflict(false);
      setDraft(initialText);
      setSavedText(initialText);
      setStatus('');
      previousQuestion.current = questionId;
    }
  }, [initialText, questionId]);

  useEffect(() => {
    if (savingRef.current) return;
    const dirty = draftRef.current !== savedRef.current;
    if (hasReflectionSaveConflict(initialText, savedRef.current, draftRef.current)) {
      conflictRef.current = true;
      setConflict(true);
      setStatus(REFLECTION_CONFLICT_MESSAGE);
      return;
    }
    if (draftRef.current === savedRef.current && initialText !== savedRef.current) {
      draftRef.current = initialText;
      savedRef.current = initialText;
      conflictRef.current = false;
      setConflict(false);
      setDraft(initialText);
      setSavedText(initialText);
    }
    if (!dirty && conflictRef.current) {
      conflictRef.current = false;
      setConflict(false);
    }
  }, [initialText, questionId]);

  const updateDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
    setStatus(conflictRef.current ? REFLECTION_CONFLICT_MESSAGE : '');
  };

  const save = async () => {
    if (savingRef.current || saving) return;
    const currentDraft = draftRef.current;
    if (currentDraft.length > SIDE_CHAT_MAX_REFLECTION_CHARS || currentDraft === savedRef.current) return;
    if (conflictRef.current || hasReflectionSaveConflict(initialText, savedRef.current, currentDraft)) {
      conflictRef.current = true;
      setConflict(true);
      setStatus(REFLECTION_CONFLICT_MESSAGE);
      return;
    }
    const capturedQuestionId = questionId;
    const capturedText = currentDraft;
    savingRef.current = true;
    setSaving(true);
    setStatus('');
    try {
      await onSave(capturedText);
      if (activeQuestion.current === capturedQuestionId) {
        savedRef.current = capturedText;
        setSavedText(capturedText);
        conflictRef.current = false;
        setConflict(false);
        setStatus(capturedText ? '이 사이드 대화에만 저장됨' : '사이드채팅 메모를 지웠습니다.');
      }
    } catch (error) {
      if (activeQuestion.current === capturedQuestionId) {
        setStatus(error instanceof Error ? error.message : '저장하지 못했습니다. 입력은 유지됩니다.');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-primary/20 bg-primary-container/20 p-3" aria-label="내 이해 기록">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`sidechat-reflection-${questionId}`} className="text-xs font-semibold text-on-surface">내 이해 / 아직 확인할 점</label>
        <span className="text-[10px] text-on-surface-variant">이 사이드 대화에만 저장</span>
      </div>
      <textarea
        id={`sidechat-reflection-${questionId}`}
        aria-label="내 이해 / 아직 확인할 점"
        value={draft}
        onChange={(event) => updateDraft(event.target.value)}
        maxLength={SIDE_CHAT_MAX_REFLECTION_CHARS}
        placeholder="비교 후 이해한 점이나 다음에 확인할 내용을 짧게 적어 보세요. (선택)"
        className="mt-2 min-h-20 w-full resize-y rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-sm leading-6 text-on-surface outline-none focus:border-primary"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-[10px] ${draft.length > SIDE_CHAT_MAX_REFLECTION_CHARS ? 'text-error' : 'text-on-surface-variant'}`}>{draft.length.toLocaleString()} / {SIDE_CHAT_MAX_REFLECTION_CHARS.toLocaleString()}자</span>
        <button type="button" onClick={() => void save()} disabled={saving || conflict || draft.length > SIDE_CHAT_MAX_REFLECTION_CHARS || draft === savedText} className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-40">{saving ? '저장 중…' : '내 이해 저장'}</button>
      </div>
      {status && <p role="status" className="mt-2 text-[11px] text-primary">{status}</p>}
    </section>
  );
}
