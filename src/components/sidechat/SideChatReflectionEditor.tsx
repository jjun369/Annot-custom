'use client';

import { useEffect, useRef, useState } from 'react';
import { SIDE_CHAT_MAX_REFLECTION_CHARS } from '@/lib/side-chat';

export function SideChatReflectionEditor({ questionId, initialText, onSave }: {
  questionId: string;
  initialText: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const activeQuestion = useRef(questionId);
  const previousQuestion = useRef(questionId);
  const draftRef = useRef(initialText);
  const savedRef = useRef(initialText);

  useEffect(() => {
    activeQuestion.current = questionId;
    if (previousQuestion.current !== questionId) {
      draftRef.current = initialText;
      savedRef.current = initialText;
      setDraft(initialText);
      setSavedText(initialText);
      setStatus('');
      previousQuestion.current = questionId;
    }
  }, [initialText, questionId]);

  useEffect(() => {
    if (draftRef.current === savedRef.current && initialText !== savedRef.current) {
      draftRef.current = initialText;
      savedRef.current = initialText;
      setDraft(initialText);
      setSavedText(initialText);
    }
  }, [initialText]);

  const updateDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
    setStatus('');
  };

  const save = async () => {
    if (saving || draft.length > SIDE_CHAT_MAX_REFLECTION_CHARS || draft === savedText) return;
    const capturedQuestionId = questionId;
    const capturedText = draftRef.current;
    setSaving(true);
    setStatus('');
    try {
      await onSave(capturedText);
      if (activeQuestion.current === capturedQuestionId) {
        savedRef.current = capturedText;
        setSavedText(capturedText);
        setStatus(capturedText ? '이 사이드 대화에만 저장됨' : '사이드채팅 메모를 지웠습니다.');
      }
    } catch (error) {
      if (activeQuestion.current === capturedQuestionId) {
        setStatus(error instanceof Error ? error.message : '저장하지 못했습니다. 입력은 유지됩니다.');
      }
    } finally {
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
        <button type="button" onClick={() => void save()} disabled={saving || draft.length > SIDE_CHAT_MAX_REFLECTION_CHARS || draft === savedText} className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-40">{saving ? '저장 중…' : '내 이해 저장'}</button>
      </div>
      {status && <p role="status" className="mt-2 text-[11px] text-primary">{status}</p>}
    </section>
  );
}
