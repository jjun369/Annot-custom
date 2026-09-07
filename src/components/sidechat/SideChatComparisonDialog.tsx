'use client';
import { useEffect, useRef, useState } from 'react';
import { ChatMarkdown } from '@/components/workspace/ChatMarkdown';
import { SIDE_CHAT_WEB_PROVIDERS, getSideChatModeLabel } from '@/lib/side-chat';
import type { ChatMessage, SideChatWebPerspective } from '@/types';

export function SideChatComparisonDialog({ question, messages, initial, onClose, onSource }: {
  question: ChatMessage; messages: ChatMessage[]; initial?: SideChatWebPerspective;
  onClose: () => void; onSource: (question: ChatMessage) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const answers = messages.filter((m) => m.role === 'assistant' && m.replyToMessageId === question.id)
    .map((m) => ({ id: m.id, label: `PageDock · ${m.model || '모델 확인 안 됨'} · ${m.timestamp}`, text: m.content, source: question }));
  const options = [...answers, ...(question.sideChatPerspectives || []).map((p) => {
    const request = question.sideChatWebRequests?.find((r) => r.id === p.requestId);
    return { id: p.id, label: `${SIDE_CHAT_WEB_PROVIDERS.find((v) => v.id === p.provider)?.label} · 직접 붙여넴 · ${getSideChatModeLabel(p.promptMode)}${p.model ? ` · ${p.model} (미확인)` : ''} · ${p.importedAt}`, text: p.responseText,
      source: request ? { ...question, content: request.questionText, sourceContext: request.sourceContext, sourcePdfPath: request.sourcePdfPath } : question };
  })];
  const [left, setLeft] = useState(answers[0]?.id || initial?.id || options[0]?.id || '');
  const [right, setRight] = useState(answers.length ? initial?.id || '' : '');
  const [single, setSingle] = useState(options.length < 2);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, summary, [tabindex="0"]') || []).filter((el) => el.getClientRects().length > 0);
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
      {option && <><div className="mt-3 overflow-x-auto text-sm leading-6"><ChatMarkdown content={option.text} fontSize={14} className="chat-markdown" /></div><button className="mt-3 text-xs text-primary" disabled={!option.source.sourceContext} onClick={() => onSource(option.source)}>이 설명의 원문으로 돌아가기</button></>}
    </section>;
  };
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="저장된 설명 읽기와 비교" className="flex max-h-full w-full max-w-6xl flex-col rounded-xl bg-surface p-4 shadow-lg">
      <div className="flex justify-between gap-3"><h2 className="font-semibold">{single ? '저장된 설명' : '설명 비교'}</h2><button onClick={onClose}>닫기</button></div>
      <p className="mt-1 text-xs text-on-surface-variant">설명은 서로 다른 맥락의 참고 자료입니다. 우열·정답·합의를 자동 판단하지 않습니다.</p>
      <div className="min-h-0 overflow-y-auto py-3"><p className="whitespace-pre-wrap text-sm">{question.content}</p>
        {question.sourceContext && <details className="my-3 text-xs"><summary>선택 원문 · p.{question.sourceContext.page}</summary><p className="whitespace-pre-wrap py-2">{question.sourceContext.text}</p></details>}
        <button className="my-3 text-xs text-primary" onClick={() => setSingle(!single)}>{single ? '두 설명 직접 선택하여 비교' : '한 설명만 읽기'}</button>
        <div className={`grid gap-3 ${single ? '' : 'lg:grid-cols-2'}`}>{show(left, setLeft, '왼쪽')}{!single && show(right, setRight, '오른쪽')}</div>
      </div>
    </div>
  </div>;
}
