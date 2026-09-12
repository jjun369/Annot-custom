'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMarkdown } from '@/components/workspace/ChatMarkdown';
import { SIDE_CHAT_WEB_PROVIDERS, getSideChatModeLabel } from '@/lib/side-chat';
import type { ChatMessage, SideChatWebPerspective } from '@/types';
import { SideChatReflectionEditor } from './SideChatReflectionEditor';

export function SideChatComparisonDialog({ question, messages, initial, onClose, onSource, onReflectionSave }: {
  question: ChatMessage; messages: ChatMessage[]; initial?: SideChatWebPerspective;
  onClose: () => void; onSource: (question: ChatMessage) => void;
  onReflectionSave: (questionId: string, text: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canonicalQuestion = messages.find((message) => message.id === question.id) || question;
  const answers = messages.filter((m) => m.role === 'assistant' && m.replyToMessageId === canonicalQuestion.id)
    .map((m) => ({ id: m.id, label: `PageDock · ${m.model || '모델 확인 안 됨'} · ${m.timestamp}`, text: m.content, source: canonicalQuestion }));
  const options = [...answers, ...(canonicalQuestion.sideChatPerspectives || []).map((p) => {
    const request = canonicalQuestion.sideChatWebRequests?.find((r) => r.id === p.requestId);
    return { id: p.id, label: `${SIDE_CHAT_WEB_PROVIDERS.find((v) => v.id === p.provider)?.label} · 직접 붙여넣은 설명 · ${getSideChatModeLabel(p.promptMode)}${p.model ? ` · ${p.model} (미확인)` : ''} · ${p.importedAt}`, text: p.responseText,
      source: request ? { ...canonicalQuestion, content: request.questionText, sourceContext: request.sourceContext || canonicalQuestion.sourceContext, sourcePdfPath: request.sourcePdfPath || canonicalQuestion.sourcePdfPath } : canonicalQuestion };
  })];
  const [left, setLeft] = useState(answers[0]?.id || initial?.id || options[0]?.id || '');
  const [right, setRight] = useState(answers.length ? initial?.id || '' : '');
  const [single, setSingle] = useState(options.length < 2);
  const [reflectionState, setReflectionState] = useState({ dirty: false, saving: false });
  const [closeWarning, setCloseWarning] = useState('');
  const onReflectionStateChange = useCallback((state: { dirty: boolean; saving: boolean }) => {
    setReflectionState(state);
    if (!state.saving) setCloseWarning('');
  }, []);
  const canClose = useCallback(() => {
    if (reflectionState.saving) {
      setCloseWarning('내 이해를 저장하는 중에는 닫을 수 없습니다. 저장이 끝난 뒤 다시 시도하세요.');
      return false;
    }
    if (reflectionState.dirty && !window.confirm('저장하지 않은 내 이해가 있습니다. 저장하지 않고 닫을까요?')) return false;
    setCloseWarning('');
    return true;
  }, [reflectionState]);
  const close = useCallback(() => {
    if (canClose()) onClose();
  }, [canClose, onClose]);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);
  const handleSource = useCallback((source: ChatMessage) => {
    if (!canClose()) return;
    onSource(source);
    onClose();
  }, [canClose, onClose, onSource]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, textarea, input, summary, [tabindex="0"]') || []).filter((el) => el.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => items()[0]?.focus());
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const list = items(); if (!list.length) return;
        const index = list.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); list[(index + (e.shiftKey ? -1 : 1) + list.length) % list.length]?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  const show = (value: string, change: (id: string) => void, side: string) => {
    const option = options.find((o) => o.id === value);
    return <section className="min-w-0 rounded-xl border border-outline-variant/30 p-3">
      <select aria-label={`${side} 설명 선택`} value={value} onChange={(e) => change(e.target.value)} className="w-full rounded border p-2 text-xs"><option value="">설명을 직접 선택하세요</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      {option && <><div className="mt-3 overflow-x-auto text-sm leading-6"><ChatMarkdown content={option.text} fontSize={14} className="chat-markdown" /></div><button className="mt-3 text-xs text-primary" disabled={!option.source.sourceContext} onClick={() => handleSource(option.source)}>이 설명의 원문으로 돌아가기</button></>}
    </section>;
  };
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="저장된 설명 읽기와 비교" className="flex max-h-full w-full max-w-6xl flex-col rounded-xl bg-surface p-4 shadow-lg">
      <div className="flex justify-between gap-3"><h2 className="font-semibold">{single ? '저장된 설명' : '설명 비교'}</h2><button onClick={close}>닫기</button></div>
      <p className="mt-1 text-xs text-on-surface-variant">설명은 서로 다른 맥락의 참고 자료입니다. 우열·정답·합의를 자동 판단하지 않습니다.</p>
      {closeWarning && <p role="status" className="mt-2 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container">{closeWarning}</p>}
      <div className="min-h-0 overflow-y-auto py-3"><p className="whitespace-pre-wrap text-sm">{canonicalQuestion.content}</p>
        {canonicalQuestion.sourceContext && <details className="my-3 text-xs"><summary>선택 원문 · p.{canonicalQuestion.sourceContext.page}</summary><p className="whitespace-pre-wrap py-2">{canonicalQuestion.sourceContext.text}</p><button className="text-primary" onClick={() => handleSource(canonicalQuestion)}>이 선택 영역의 원문으로 돌아가기</button></details>}
        <button className="my-3 text-xs text-primary" onClick={() => setSingle(!single)}>{single ? '두 설명 직접 선택하여 비교' : '한 설명만 읽기'}</button>
        <div className={`grid gap-3 ${single ? '' : 'lg:grid-cols-2'}`}>{show(left, setLeft, '왼쪽')}{!single && show(right, setRight, '오른쪽')}</div>
        <SideChatReflectionEditor questionId={canonicalQuestion.id} initialText={canonicalQuestion.sideChatReflection?.text || ''} onSave={(text) => onReflectionSave(canonicalQuestion.id, text)} onStateChange={onReflectionStateChange} />
      </div>
    </div>
  </div>;
}
