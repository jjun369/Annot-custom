'use client';
import { useEffect, useRef, useState } from 'react';
import { buildSideChatOutboundPrompt, getSideChatModeLabel, canUseSideChatSource, SIDE_CHAT_OUTBOUND_MODES, SIDE_CHAT_WEB_PROVIDERS, sideChatModeUsesAnswer, sideChatModeUsesSource, SIDE_CHAT_MAX_RESPONSE_CHARS } from '@/lib/side-chat';
import type { ChatMessage, SideChatOutboundMode, SideChatWebPerspective, SideChatWebProviderId, SideChatWebRequest } from '@/types';
import { useSideChatRequestDrafts } from './useSideChatRequestDrafts';
import { SideChatComparisonDialog } from './SideChatComparisonDialog';
import { buildSideChatWebDraftKey } from '@/lib/side-chat';

export function WebAiHandoffPanel({ namespace, sessionId, messages, target, ensureQuestion, onRequest, onPerspective, onReflectionSave, onSource, visible, initialProvider, initialMode }: {
  namespace: string; sessionId: string | null; messages: ChatMessage[];
  target: ReturnType<typeof import('@/lib/side-chat').resolveSideChatTarget>;
  ensureQuestion: () => Promise<{ sessionId: string; question: ChatMessage }>;
  onRequest: (request: SideChatWebRequest) => void;
  onPerspective: (sessionId: string, questionId: string, perspective: SideChatWebPerspective) => void;
  onReflectionSave: (sessionId: string, questionId: string, text: string) => Promise<void>;
  onSource: (question: ChatMessage) => void; visible: boolean;
  initialProvider: SideChatWebProviderId; initialMode: SideChatOutboundMode;
}) {
  const [provider, setProvider] = useState(initialProvider);
  const [opened, setOpened] = useState<SideChatWebProviderId[]>(['deepseek']);
  const [mode, setMode] = useState(initialMode);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [comparison, setComparison] = useState<{ question: ChatMessage; perspective: SideChatWebPerspective } | null>(null);
  const [viewState, setViewState] = useState('idle');
  const [retry, setRetry] = useState(0);
  const [webEnabled, setWebEnabled] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const operation = useRef(false);
  const saveOperation = useRef(false);
  const current = useRef({ sessionId, selected }); current.current = { sessionId, selected };
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const requests = messages.flatMap((m) => m.sideChatWebRequests || []);
  const request = requests.find((r) => r.id === selected);
  const draftId = request ? `${sessionId}:${request.id}` : buildSideChatWebDraftKey({ sessionId, provider, promptMode: mode, question: target.text, sourceContext: target.source, sourcePdfPath: target.sourcePath, answerText: target.answer?.content });
  const drafts = useSideChatRequestDrafts(namespace, setStatus);
  const draft = drafts.read(draftId);
  const prompt = request?.promptSnapshot || (target.text ? buildSideChatOutboundPrompt({ mode, question: target.text, sourceText: target.source?.text, answerText: target.answer?.content }) : '');
  const valid = Boolean(target.text && (!sideChatModeUsesSource(mode) || canUseSideChatSource(target.source)) && (!sideChatModeUsesAnswer(mode) || target.answer));
  const label = (id: SideChatWebProviderId) => SIDE_CHAT_WEB_PROVIDERS.find((p) => p.id === id)!.label;
  const destination = SIDE_CHAT_WEB_PROVIDERS.find((p) => p.id === provider)!;

  useEffect(() => { setSelected(''); setComparison(null); }, [sessionId]);
  useEffect(() => { setSelected(''); }, [target.text, target.answer?.id]);
  useEffect(() => { setMode(initialMode); setProvider(initialProvider); }, [initialMode, initialProvider, target.answer?.id]);
  useEffect(() => { setOpened((v) => v.includes(provider) ? v : [...v, provider]); }, [provider]);
  useEffect(() => { if (draft.response || draft.model) setImportOpen(true); }, [draftId, draft.response, draft.model]);
  useEffect(() => {
    const desktop = window.pageDockDesktop?.sideChat;
    if (!desktop) { setViewState('external'); return; }
    if (!visible || comparison || !webEnabled) { void desktop.hideWebProvider(); return; }
    let cancelled = false;
    setViewState('loading');
    const update = () => { const rect = host.current?.getBoundingClientRect(); if (rect) desktop.setWebViewBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }); };
    const observer = new ResizeObserver(update); if (host.current) observer.observe(host.current);
    window.addEventListener('resize', update);
    void desktop.showWebProvider(provider).then((result) => { if (!cancelled) { setViewState(result.mode); update(); } }).catch(() => { if (!cancelled) setViewState('failed'); });
    update();
    const unsubscribe = desktop.onWebFailed((failure) => { if (failure.providerId === provider && !cancelled) { setViewState('failed'); void desktop.hideWebProvider(); } });
    return () => { cancelled = true; observer.disconnect(); unsubscribe(); window.removeEventListener('resize', update); void desktop.hideWebProvider(); };
  }, [visible, provider, comparison, retry, webEnabled]);

  const copy = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    const oldDraft = { ...draft }; const oldDraftId = draftId;
    const originSession = sessionId;
    const originSelected = selected;
    try {
      let prepared = request;
      if (!prepared) {
        if (!valid) throw new Error('질문·선택 원문·선택 답변의 범위를 확인해 주세요.');
        const saved = await ensureQuestion();
        const fingerprint = JSON.stringify([saved.sessionId, saved.question.id, provider, mode, target.answer?.id, prompt]);
        if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
        const response = await fetch('/api/side-chat/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          sessionId: saved.sessionId, questionMessageId: saved.question.id, requestId: pending.current.id, provider, promptMode: mode,
          ...(sideChatModeUsesAnswer(mode) ? { answerMessageId: target.answer?.id } : {}), promptSnapshot: prompt,
        }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        prepared = data.request as SideChatWebRequest; onRequest(prepared);
        // Only the operation's original task may become the selected target.
        if (current.current.selected === originSelected && (current.current.sessionId === originSession || current.current.sessionId === saved.sessionId)) setSelected(prepared.id);
        drafts.write(`${prepared.sessionId}:${prepared.id}`, oldDraft); drafts.clearSaved(oldDraftId, oldDraft);
      }
      if (window.pageDockDesktop?.sideChat) await window.pageDockDesktop.sideChat.copyText(prepared.promptSnapshot);
      else await navigator.clipboard.writeText(prepared.promptSnapshot);
      const ack = await fetch('/api/side-chat/requests', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: prepared.sessionId, requestId: prepared.id }) });
      const data = await ack.json(); if (!ack.ok) throw new Error('복사됐지만 복사 시각 저장에 실패했습니다. 준비된 요청에서 다시 복사할 수 있습니다.');
      onRequest(data.request); pending.current = null;
      setStatus('복사됨 · 웹에서 직접 붙여넣고 전송하세요.');
    } catch (error) { setStatus(error instanceof Error ? error.message : '복사하지 못했습니다. 미리보기에서 직접 복사하거나 다시 시도하세요.'); }
    finally { operation.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!request || saveOperation.current) return;
    saveOperation.current = true; setSaving(true);
    const captured = { ...draft }; const capturedId = draftId;
    try {
      const response = await fetch('/api/side-chat/perspectives', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folderPath: '.', sessionId: request.sessionId, requestId: request.id, responseText: captured.response, model: captured.model }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      onPerspective(request.sessionId, request.questionMessageId, data.perspective);
      drafts.clearSaved(capturedId, captured);
      if (current.current.sessionId === request.sessionId && current.current.selected === request.id) {
        const original = messages.find((m) => m.id === request.questionMessageId)!;
        const question = { ...original, content: request.questionText, sourceContext: request.sourceContext || original.sourceContext, sourcePdfPath: request.sourcePdfPath || original.sourcePdfPath,
          sideChatPerspectives: [...(original.sideChatPerspectives || []).filter((p) => p.id !== data.perspective.id), data.perspective], sideChatReflection: original.sideChatReflection };
        setComparison({ question, perspective: data.perspective });
        setStatus('선택한 요청에 답변을 저장했습니다.');
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : '답변 저장 실패 · 입력은 유지됩니다.'); }
    finally { saveOperation.current = false; setSaving(false); }
  };
  const control = 'rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-xs';
  const requestLabel = request
    ? `${label(request.provider)} · ${getSideChatModeLabel(request.promptMode)} · ${request.copiedAt ? '복사됨' : '준비됨'}`
    : `${label(provider)} · ${getSideChatModeLabel(mode)} · 새 요청`;
  const questionLabel = request?.questionText || target.text || 'PageDock 탭에서 질문을 입력하거나 저장된 질문을 선택하세요.';
  return <div className={`min-h-0 flex-1 flex-col ${visible ? 'flex' : 'hidden'}`}>
    <div className="flex shrink-0 flex-wrap gap-2 px-3 py-2">{opened.map((id) => <span key={id} className={control}><button aria-pressed={id === provider} onClick={() => { setWebEnabled(true); setProvider(id); }}>{label(id)}</button><button aria-label={`${label(id)} 탭 닫기`} className="ml-2" onClick={() => { setOpened((v) => v.filter((p) => p !== id)); if (provider === id) { const next = opened.find((p) => p !== id); if (next) setProvider(next); else setWebEnabled(false); } }}>×</button></span>)}
      <select className={control} aria-label="웹 AI 추가" value="" onChange={(e) => { const id = e.target.value as SideChatWebProviderId; setOpened((v) => v.includes(id) ? v : [...v, id]); setProvider(id); setWebEnabled(true); }}><option value="">웹 AI 추가</option>{SIDE_CHAT_WEB_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
    </div>
    <div className="max-h-[55%] shrink-0 space-y-2 overflow-y-auto border-y p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-semibold text-on-surface" title={questionLabel}>{questionLabel}</p>
          <p className="mt-1 text-[10px] text-on-surface-variant">답변 귀속: {requestLabel}{(request?.sourceContext || target.source)?.page ? ` · 원문 p.${(request?.sourceContext || target.source)?.page}` : ''}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <button className="rounded-lg bg-primary px-2.5 py-2 text-[11px] font-semibold text-on-primary disabled:opacity-40" onClick={() => void copy()} disabled={busy || (!request && !valid)}>{busy ? '준비 중…' : request ? '질문 다시 복사' : '질문 복사'}</button>
          <button className="rounded-lg border border-ai-reference/35 px-2.5 py-2 text-[11px] font-semibold text-ai-reference" onClick={() => setImportOpen((value) => !value)} aria-expanded={importOpen}>{draft.response ? `작성 중 답변 · ${draft.response.length.toLocaleString()}자` : '답변 가져오기'}</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button className={control} onClick={() => { setWebEnabled(true); setOpened((v) => v.includes(provider) ? v : [...v, provider]); setRetry((v) => v + 1); }}>웹 탭 열기 / 재시도</button>
        <button className={control} onClick={() => window.open(destination.url, '_blank', 'noopener,noreferrer')}>기본 브라우저로 열기</button>
      </div>
      <details>
        <summary className="cursor-pointer text-xs">요청 선택·전송 범위·상세 정보</summary>
        <div className="mt-2 space-y-2">
          <label className="block text-xs">답변을 붙일 요청<select aria-label="저장된 웹 요청" className={`${control} ml-2 max-w-full`} value={request?.id || ''} onChange={(e) => { setSelected(e.target.value); const r = requests.find((v) => v.id === e.target.value); if (r) setProvider(r.provider); }}><option value="">새 요청 준비</option>{[...requests].reverse().map((r) => <option key={r.id} value={r.id}>{label(r.provider)} · {r.questionText.slice(0, 55)} · {getSideChatModeLabel(r.promptMode)} · {r.copiedAt ? '복사됨' : '준비됨'}</option>)}</select></label>
          {!request && <select aria-label="전송 범위" className={control} value={mode} onChange={(e) => setMode(e.target.value as SideChatOutboundMode)}>{SIDE_CHAT_OUTBOUND_MODES.map((m) => <option key={m.id} value={m.id} disabled={(sideChatModeUsesSource(m.id) && !canUseSideChatSource(target.source)) || (sideChatModeUsesAnswer(m.id) && !target.answer)}>{m.label}</option>)}</select>}
          <p className="text-[11px] text-on-surface-variant">외부에 복사되는 내용은 아래 미리보기의 질문·선택 범위뿐입니다. 웹 탭의 전송과 로그인은 직접 진행하세요.</p>
          <details><summary className="cursor-pointer text-xs">실제 전송 내용 미리보기 · {getSideChatModeLabel(request?.promptMode || mode)}</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs">{prompt}</pre></details>
          {request && <p className="text-[10px] text-on-surface-variant">준비 시각: {new Date(request.preparedAt).toLocaleString()} · 요청 귀속: {label(request.provider)} · 모델: 웹에서 확인하지 않음</p>}
        </div>
      </details>
      {importOpen && <div className="rounded-lg border border-ai-reference/20 bg-ai-reference-container/20 p-2.5">
        <p className="text-xs font-semibold">웹 답변을 직접 붙여넣기</p>
        <p className="mt-1 text-[10px] text-on-surface-variant">현재 요청: {request ? `${label(request.provider)} · ${request.questionText.slice(0, 90)}` : '먼저 질문을 복사해 요청을 준비하세요.'}</p>
        <textarea aria-label="요청 답변 붙여넣기" className={`${control} mt-2 h-24 w-full resize-y`} value={draft.response} disabled={saving} onChange={(e) => drafts.write(draftId, { ...draft, response: e.target.value })} placeholder="웹에서 직접 복사한 답변" />
        <div className="mt-2 flex flex-wrap items-center gap-2"><input className={control} aria-label="모델 표기 미확인" value={draft.model} disabled={saving} onChange={(e) => drafts.write(draftId, { ...draft, model: e.target.value })} placeholder="모델 표기 (미확인·선택)" /><button className={control} onClick={() => void save()} disabled={!request || saving || !draft.response.trim() || draft.response.length > SIDE_CHAT_MAX_RESPONSE_CHARS}>{saving ? '저장 중…' : `${request ? label(request.provider) : '요청 선택 후'} 답변 저장`}</button><span className={`text-[10px] ${draft.response.length > SIDE_CHAT_MAX_RESPONSE_CHARS ? 'font-semibold text-error' : 'text-on-surface-variant'}`}>{draft.response.length.toLocaleString()} / {SIDE_CHAT_MAX_RESPONSE_CHARS.toLocaleString()}자</span></div>
      </div>}
      {!importOpen && draft.response && <button className="text-left text-[10px] font-semibold text-ai-reference" onClick={() => setImportOpen(true)}>작성 중인 답변 열기 · {draft.response.length.toLocaleString()}자</button>}
      <p className="text-[10px] text-on-surface-variant">미저장 초안은 앱 전체 종료 후 복구를 보장하지 않습니다. 종료 전 답변을 저장하거나 복사하세요. 저장된 요청·답변은 Library 백업에 포함되며 사이드채팅 안에서만 비교됩니다.</p>
      {status && <p role="status" className="text-xs text-primary">{status}</p>}
    </div>
    <div ref={host} className="relative min-h-0 flex-1 bg-surface-container">{viewState !== 'embedded' && <p className="p-4 text-xs">{viewState === 'loading' ? '웹 페이지를 여는 중…' : '웹 탭을 다시 열거나 기본 브라우저를 사용하세요. 로그인과 전송은 직접 진행하세요.'}</p>}</div>
    {comparison && <SideChatComparisonDialog question={comparison.question} messages={messages} initial={comparison.perspective} onClose={() => setComparison(null)} onSource={onSource} onReflectionSave={(questionId, text) => onReflectionSave(request?.sessionId || sessionId || '', questionId, text)} />}
  </div>;
}
