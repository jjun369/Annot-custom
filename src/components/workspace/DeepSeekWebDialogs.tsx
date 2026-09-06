import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Clipboard, ClipboardPaste, ExternalLink, Loader2, MapPin, X } from 'lucide-react';
import { ChatMarkdown } from '@/components/workspace/ChatMarkdown';
import { DEEPSEEK_WEB_URL, isDeepSeekWebManualPerspective, MAX_DEEPSEEK_WEB_RESPONSE_CHARS } from '@/lib/deepseek-web-bridge';
import { DeepSeekPerspectiveTarget } from '@/components/workspace/useDeepSeekBridge';
import { ChatMessage, ChatSecondaryPerspective, ChatSourceContext } from '@/types';

interface DialogShellProps {
  children: React.ReactNode;
  onClose: () => void;
  labelledBy: string;
}

function DialogShell({ children, onClose, labelledBy }: DialogShellProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const getFocusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []);

    const focusFirst = () => getFocusable()[0]?.focus();
    const frame = window.requestAnimationFrame(focusFirst);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      if (currentIndex === -1 || currentIndex === focusable.length - 1 || currentIndex === 0 || event.shiftKey) {
        event.preventDefault();
        focusable[nextIndex]?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 py-6"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}
    >
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-ambient">
        {children}
      </section>
    </div>
  );
}

function ContextPreview({ question, sourceText, page, rects }: { question: string; sourceText: string; page?: number; rects?: ChatSourceContext['rects'] }) {
  return (
    <div className="mb-4 rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-3 text-xs leading-5 text-on-surface-variant">
      <p className="font-semibold text-on-surface">대상 질문</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{question}</p>
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold text-on-surface">선택 원문{page ? ` · p.${page}` : ''}{rects?.length ? ` · 선택 영역 ${rects.length}개` : ''}</summary>
        <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-outline-variant pl-3">{sourceText}</p>
      </details>
    </div>
  );
}

interface DeepSeekPromptDialogProps {
  prompt: string;
  question: string;
  sourceText: string;
  page?: number;
  rects?: ChatSourceContext['rects'];
  opening: boolean;
  onClose: () => void;
  onCopy: () => Promise<void>;
  onOpen: () => Promise<void>;
  onImport: () => void;
}

export function DeepSeekPromptDialog({ prompt, question, sourceText, page, rects, opening, onClose, onCopy, onOpen, onImport }: DeepSeekPromptDialogProps) {
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '작업을 완료하지 못했습니다. 아래 내용을 직접 선택해 주세요.');
    }
  };

  return (
    <DialogShell onClose={opening ? () => undefined : onClose} labelledBy="deepseek-prompt-title">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
        <div>
          <h2 id="deepseek-prompt-title" className="text-sm font-semibold text-on-surface">DeepSeek에 보낼 내용 확인</h2>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">질문 복사와 웹 열기는 따로 다시 할 수 있습니다. 실제 전송은 DeepSeek 웹 화면에서 직접 결정합니다.</p>
        </div>
        <button type="button" onClick={onClose} disabled={opening} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label="닫기"><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <ContextPreview question={question} sourceText={sourceText} page={page} rects={rects} />
        <textarea readOnly value={prompt} aria-label="DeepSeek에 복사할 질문" className="min-h-72 w-full resize-y rounded-xl border border-outline-variant/25 bg-surface-container px-3 py-3 font-functional text-xs leading-5 text-on-surface outline-none" />
        <p className="mt-3 text-[11px] leading-5 text-on-surface-variant">파일명·경로·다른 메모·전체 PDF·기존 AI 답변은 포함하지 않습니다. 복사가 막히면 위 내용을 직접 선택해 복사할 수 있습니다.</p>
        {copied && <p className="mt-3 rounded-lg bg-surface-container px-3 py-2 text-xs text-on-surface" role="status">질문을 클립보드에 복사했습니다. DeepSeek에서 붙여넣고 내용을 확인한 뒤 직접 전송하세요.</p>}
        {error && <p className="mt-3 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container" role="alert">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/15 px-5 py-4">
        <a href={DEEPSEEK_WEB_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high"><ExternalLink size={14} />DeepSeek 웹 다시 열기</a>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={opening} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">닫기</button>
          <button type="button" onClick={() => void run(async () => { await onCopy(); setCopied(true); })} disabled={opening} className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant/25 px-3 py-2 text-xs font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"><Clipboard size={14} />질문 복사</button>
          <button type="button" onClick={() => void run(onOpen)} disabled={opening} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">{opening ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}웹 열기</button>
          <button type="button" onClick={onImport} disabled={opening} className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant/25 px-3 py-2 text-xs font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"><ClipboardPaste size={14} />답변 붙여넣기</button>
        </div>
      </div>
    </DialogShell>
  );
}

interface DeepSeekImportDialogProps {
  saving: boolean;
  responseText: string;
  question: string;
  sourceText: string;
  page?: number;
  rects?: ChatSourceContext['rects'];
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onReadClipboard: () => Promise<void>;
}

export function DeepSeekImportDialog({ saving, responseText, question, sourceText, page, rects, onChange, onClose, onSave, onReadClipboard }: DeepSeekImportDialogProps) {
  const [clipboardError, setClipboardError] = useState('');
  const tooLong = responseText.length > MAX_DEEPSEEK_WEB_RESPONSE_CHARS;
  const pasteClipboard = async () => {
    setClipboardError('');
    try {
      await onReadClipboard();
    } catch (reason) {
      setClipboardError(reason instanceof Error ? reason.message : '클립보드를 읽지 못했습니다. 아래에 직접 붙여넣어 주세요.');
    }
  };

  return (
    <DialogShell onClose={saving ? () => undefined : onClose} labelledBy="deepseek-import-title">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
        <div>
          <h2 id="deepseek-import-title" className="text-sm font-semibold text-on-surface">DeepSeek 답변 가져오기</h2>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">이 작업의 원문과 질문을 확인한 뒤, DeepSeek 웹에서 직접 복사한 답변을 붙여넣으세요.</p>
        </div>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label="닫기"><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <ContextPreview question={question} sourceText={sourceText} page={page} rects={rects} />
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-on-surface-variant">DeepSeek 직접 붙여넣은 설명</span>
          <button type="button" onClick={() => void pasteClipboard()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-2.5 py-1.5 text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"><ClipboardPaste size={13} />클립보드에서 붙여넣기</button>
        </div>
        <textarea value={responseText} onChange={(event) => onChange(event.target.value)} disabled={saving} aria-invalid={tooLong} aria-label="DeepSeek에서 복사한 답변" placeholder="DeepSeek 웹에서 복사한 답변을 붙여넣으세요." className={`min-h-72 w-full resize-y rounded-xl border bg-surface-container-lowest px-3 py-3 font-editorial text-sm leading-6 text-on-surface outline-none focus:border-outline disabled:opacity-70 ${tooLong ? 'border-error' : 'border-outline-variant/25'}`} />
        <p className={`mt-2 text-right text-[10px] ${tooLong ? 'text-error' : 'text-on-surface-variant'}`}>
          {responseText.length.toLocaleString('ko-KR')} / {MAX_DEEPSEEK_WEB_RESPONSE_CHARS.toLocaleString('ko-KR')}자
        </p>
        {tooLong && <p className="mt-2 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container" role="alert">답변이 너무 깁니다. {MAX_DEEPSEEK_WEB_RESPONSE_CHARS.toLocaleString('ko-KR')}자 이하로 줄여 주세요. 전체 입력은 보존되어 있습니다.</p>}
        {clipboardError && <p className="mt-3 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container" role="alert">{clipboardError}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/15 px-5 py-4">
        <button type="button" onClick={onClose} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">닫기</button>
        <button type="button" onClick={() => void onSave()} disabled={saving || !responseText.trim() || tooLong} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Clipboard size={14} />}저장하고 비교</button>
      </div>
    </DialogShell>
  );
}

interface DeepSeekComparisonDialogProps {
  open: boolean;
  primaryAnswer: string;
  perspective: ChatSecondaryPerspective | null;
  question: string;
  sourceContext: ChatSourceContext;
  onClose: () => void;
  onReturnToSource: () => void;
}

export function DeepSeekComparisonDialog({ open, primaryAnswer, perspective, question, sourceContext, onClose, onReturnToSource }: DeepSeekComparisonDialogProps) {
  if (!open || !perspective) return null;

  return (
    <DialogShell onClose={onClose} labelledBy="deepseek-comparison-title">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
        <div>
          <h2 id="deepseek-comparison-title" className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface"><ArrowLeftRight size={15} />{primaryAnswer ? '두 설명 비교' : 'DeepSeek 설명'}</h2>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">{primaryAnswer ? '같은 선택 원문과 질문에 연결된 별도 설명입니다. 전체 맥락이 다를 수 있으며, PageDock은 우열이나 합의 여부를 판단하지 않습니다.' : '선택 원문과 질문에 연결된 수동 설명입니다. 원문으로 돌아가 다시 확인할 수 있습니다.'}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container" aria-label="닫기"><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <ContextPreview question={question} sourceText={sourceContext.text ?? ''} page={sourceContext.page} rects={sourceContext.rects} />
        <div className={`grid gap-4 ${primaryAnswer ? 'lg:grid-cols-2' : ''}`}>
          {primaryAnswer && <article className="min-w-0 rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">첫 AI 설명</p>
            <ChatMarkdown content={primaryAnswer} className="chat-markdown break-words font-editorial text-sm leading-6 text-on-surface" />
          </article>}
          <article className="min-w-0 rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">DeepSeek · 직접 붙여넣은 설명</p>
            <ChatMarkdown content={perspective.responseText} className="chat-markdown break-words font-editorial text-sm leading-6 text-on-surface" />
            <p className="mt-4 border-t border-outline-variant/15 pt-3 text-[10px] text-on-surface-variant">가져온 시각 · {new Date(perspective.importedAt).toLocaleString('ko-KR')} · 모델 · 웹 UI에서 확인되지 않음</p>
          </article>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/15 px-5 py-4">
        <button type="button" onClick={onReturnToSource} className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant/25 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"><MapPin size={14} />원문으로 돌아가기</button>
        <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high">닫기</button>
      </div>
    </DialogShell>
  );
}

interface DeepSeekActionsProps {
  message: ChatMessage;
  target: DeepSeekPerspectiveTarget | null;
  onRequest: (message: ChatMessage) => void;
  onImport: (message: ChatMessage) => void;
  onCompare: (message: ChatMessage, perspective: ChatSecondaryPerspective) => void;
}

export function DeepSeekActions({ message, target, onRequest, onImport, onCompare }: DeepSeekActionsProps) {
  const perspectives = (message.secondaryPerspectives ?? []).filter(isDeepSeekWebManualPerspective);
  const latest = perspectives.at(-1);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {target && (
        <button type="button" onClick={() => onRequest(message)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-medium text-on-surface-variant hover:bg-surface-container" aria-label={latest ? 'DeepSeek 질문을 다시 복사하거나 웹에서 열기' : 'DeepSeek에 다른 관점 질문하기'}>
          <ExternalLink size={11} aria-hidden="true" />{latest ? '다시 질문 복사·웹 열기' : '다른 관점 보기'}
        </button>
      )}
      {latest && (
        <button type="button" onClick={() => onCompare(message, latest)} className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/25 px-2 py-1 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container">
          <ArrowLeftRight size={11} aria-hidden="true" />{message.role === 'assistant' ? `두 설명 비교${perspectives.length > 1 ? ' · 최신' : ''}` : 'DeepSeek 설명 보기'}
        </button>
      )}
      {target && (
        <button type="button" onClick={() => onImport(message)} className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/25 px-2 py-1 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container">
          <ClipboardPaste size={11} aria-hidden="true" />답변 붙여넣기
        </button>
      )}
      {perspectives.length > 1 && (
        <select
          aria-label="저장된 DeepSeek 설명 선택"
          defaultValue=""
          onChange={(event) => {
            const selected = perspectives.find((candidate) => candidate.id === event.target.value);
            if (selected) onCompare(message, selected);
            event.currentTarget.value = '';
          }}
          className="h-7 rounded-lg border border-outline-variant/25 bg-surface-container-lowest px-2 text-[10px] text-on-surface-variant"
        >
          <option value="">저장된 설명 {perspectives.length}개</option>
          {perspectives.slice().reverse().map((candidate, index) => (
            <option key={candidate.id} value={candidate.id}>DeepSeek 설명 {perspectives.length - index}{index === 0 ? ' · 최신' : ''}</option>
          ))}
        </select>
      )}
    </div>
  );
}
