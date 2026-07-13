'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type FeedbackTone = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  tone: FeedbackTone;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface FeedbackContextValue {
  notify: (message: string, tone?: FeedbackTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TONE_STYLES: Record<FeedbackTone, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-primary/20 bg-surface-container-lowest text-on-surface' },
  error: { icon: AlertCircle, className: 'border-error/25 bg-surface-container-lowest text-error' },
  info: { icon: Info, className: 'border-outline-variant/30 bg-surface-container-lowest text-on-surface' },
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeConfirm, setActiveConfirm] = useState<ConfirmRequest | null>(null);
  const activeConfirmRef = useRef<ConfirmRequest | null>(null);
  const confirmQueueRef = useRef<ConfirmRequest[]>([]);

  const notify = useCallback((message: string, tone: FeedbackTone = 'info') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, tone === 'error' ? 6000 : 3600);
  }, []);

  const showConfirm = useCallback((request: ConfirmRequest) => {
    activeConfirmRef.current = request;
    setActiveConfirm(request);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = { ...options, resolve };
    if (activeConfirmRef.current) {
      confirmQueueRef.current.push(request);
      return;
    }
    showConfirm(request);
  }), [showConfirm]);

  const finishConfirm = (value: boolean) => {
    const current = activeConfirmRef.current;
    activeConfirmRef.current = null;
    setActiveConfirm(null);
    current?.resolve(value);

    const next = confirmQueueRef.current.shift();
    if (next) {
      window.setTimeout(() => showConfirm(next), 0);
    }
  };

  return (
    <FeedbackContext.Provider value={{ notify, confirm }}>
      {children}

      <div className="pointer-events-none fixed right-4 top-14 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => {
          const style = TONE_STYLES[toast.tone];
          const Icon = style.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-5 shadow-ambient ${style.className}`}
              role={toast.tone === 'error' ? 'alert' : 'status'}
            >
              <Icon size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{toast.message}</span>
              <button
                type="button"
                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                className="-mr-1 rounded p-0.5 text-outline transition-colors hover:bg-surface-container"
                aria-label="알림 닫기"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {activeConfirm && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4 py-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) finishConfirm(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-outline-variant/25 bg-surface-container-lowest p-5 shadow-ambient"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="annot-confirm-title"
          >
            <h2 id="annot-confirm-title" className="text-sm font-semibold text-on-surface">
              {activeConfirm.title || '확인'}
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-on-surface-variant">
              {activeConfirm.message}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => finishConfirm(false)}
                className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                {activeConfirm.cancelLabel || '취소'}
              </button>
              <button
                type="button"
                onClick={() => finishConfirm(true)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 ${activeConfirm.destructive ? 'bg-error' : 'bg-primary'}`}
              >
                {activeConfirm.confirmLabel || '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback는 FeedbackProvider 안에서 사용해야 합니다.');
  }
  return context;
}
