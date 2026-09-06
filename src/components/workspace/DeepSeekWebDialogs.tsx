'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Clipboard, ClipboardPaste, ExternalLink, Loader2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatSecondaryPerspective } from '@/types';

interface DialogShellProps {
  children: React.ReactNode;
  onClose: () => void;
  labelledBy: string;
}

function DialogShell({ children, onClose, labelledBy }: DialogShellProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 py-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-ambient">
        {children}
      </section>
    </div>
  );
}

interface DeepSeekPromptDialogProps {
  prompt: string;
  opening: boolean;
  onClose: () => void;
  onCopyAndOpen: () => Promise<void>;
}

export function DeepSeekPromptDialog({
  prompt,
  opening,
  onClose,
  onCopyAndOpen,
}: DeepSeekPromptDialogProps) {
  const [error, setError] = useState('');

  const handleCopyAndOpen = async () => {
    setError('');
    try {
      await onCopyAndOpen();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '질문을 복사하지 못했습니다. 직접 선택해 복사해 주세요.');
    }
  };

  return (
    <DialogShell onClose={opening ? () => undefined : onClose} labelledBy="deepseek-prompt-title">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
        <div>
          <h2 id="deepseek-prompt-title" className="text-sm font-semibold text-on-surface">DeepSeek에 보낼 내용 확인</h2>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">아래 내용만 클립보드에 복사합니다. 실제 전송은 DeepSeek 웹 화면에서 직접 결정합니다.</p>
        </div>
        <button type="button" onClick={onClose} disabled={opening} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label="닫기"><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <textarea readOnly value={prompt} aria-label="DeepSeek에 복사할 질문" className="min-h-72 w-full resize-y rounded-xl border border-outline-variant/25 bg-surface-container px-3 py-3 font-functional text-xs leading-5 text-on-surface outline-none" />
        <p className="mt-3 text-[11px] leading-5 text-on-surface-variant">파일명·경로·다른 메모·전체 PDF·기존 AI 답변은 포함하지 않습니다. DeepSeek 웹에서 붙여넣은 뒤 내용을 확인하고 직접 전송하세요.</p>
        {error && <p className="mt-3 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container" role="alert">{error}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/15 px-5 py-4">
        <button type="button" onClick={onClose} disabled={opening} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">취소</button>
        <button type="button" onClick={() => void handleCopyAndOpen()} disabled={opening} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">
          {opening ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
          복사하고 DeepSeek 웹 열기
        </button>
      </div>
    </DialogShell>
  );
}

interface DeepSeekImportDialogProps {
  saving: boolean;
  onClose: () => void;
  onSave: (responseText: string) => Promise<void>;
  onReadClipboard: () => Promise<string>;
}

export function DeepSeekImportDialog({
  saving,
  onClose,
  onSave,
  onReadClipboard,
}: DeepSeekImportDialogProps) {
  const [responseText, setResponseText] = useState('');
  const [clipboardError, setClipboardError] = useState('');

  const pasteClipboard = async () => {
    setClipboardError('');
    try {
      const text = await onReadClipboard();
      if (!text.trim()) {
        setClipboardError('클립보드에 가져올 텍스트가 없습니다. DeepSeek 답변을 먼저 복사해 주세요.');
        return;
      }
      setResponseText(text);
    } catch {
      setClipboardError('클립보드를 읽지 못했습니다. 아래에 직접 붙여넣어 주세요.');
    }
  };

  return (
    <DialogShell onClose={saving ? () => undefined : onClose} labelledBy="deepseek-import-title">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
        <div>
          <h2 id="deepseek-import-title" className="text-sm font-semibold text-on-surface">DeepSeek 답변 가져오기</h2>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">DeepSeek 웹에서 직접 복사한 답변을 붙여넣으세요. 가져온 내용은 현재 원문과 질문에 연결해 저장합니다.</p>
        </div>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label="닫기"><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => void pasteClipboard()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-2.5 py-1.5 text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"><ClipboardPaste size={13} />클립보드에서 붙여넣기</button>
        </div>
        <textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} aria-label="DeepSeek에서 복사한 답변" placeholder="DeepSeek 웹에서 복사한 답변을 붙여넣으세요." className="min-h-72 w-full resize-y rounded-xl border border-outline-variant/25 bg-surface-container-lowest px-3 py-3 font-editorial text-sm leading-6 text-on-surface outline-none focus:border-outline" />
        {clipboardError && <p className="mt-3 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container" role="alert">{clipboardError}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-outline-variant/15 px-5 py-4">
        <button type="button" onClick={onClose} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">취소</button>
        <button type="button" onClick={() => void onSave(responseText)} disabled={saving || !responseText.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Clipboard size={14} />}
          저장하고 비교
        </button>
      </div>
    </DialogShell>
  );
}

interface DeepSeekComparisonDialogProps {
  open: boolean;
  primaryAnswer: string;
  perspective: ChatSecondaryPerspective | null;
  onClose: () => void;
}

export function DeepSeekComparisonDialog({ open, primaryAnswer, perspective, onClose }: DeepSeekComparisonDialogProps) {
  if (!open || !perspective) return null;

  return (
    <DialogShell onClose={onClose} labelledBy="deepseek-comparison-title">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
        <div>
          <h2 id="deepseek-comparison-title" className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface"><ArrowLeftRight size={15} />DeepSeek와 비교</h2>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">같은 원문 발췌와 질문에 연결된 두 답변입니다. PageDock은 우열이나 합의 여부를 판단하지 않습니다.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container" aria-label="닫기"><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">PageDock AI</p>
            <div className="chat-markdown font-editorial text-sm leading-6 text-on-surface"><ReactMarkdown remarkPlugins={[remarkGfm]}>{primaryAnswer}</ReactMarkdown></div>
          </article>
          <article className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">DeepSeek · 웹 · 수동 가져오기</p>
            <div className="chat-markdown font-editorial text-sm leading-6 text-on-surface"><ReactMarkdown remarkPlugins={[remarkGfm]}>{perspective.responseText}</ReactMarkdown></div>
            <p className="mt-4 border-t border-outline-variant/15 pt-3 text-[10px] text-on-surface-variant">가져온 시각 · {new Date(perspective.importedAt).toLocaleString('ko-KR')} · 모델 · 웹 UI에서 확인되지 않음</p>
          </article>
        </div>
      </div>
      <div className="flex justify-end border-t border-outline-variant/15 px-5 py-4"><button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high">닫기</button></div>
    </DialogShell>
  );
}
