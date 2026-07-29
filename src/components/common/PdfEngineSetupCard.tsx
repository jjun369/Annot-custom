'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, FileCog, Loader2, RefreshCw } from 'lucide-react';

interface PdfEngineStatus {
  ready: boolean;
  pythonInstalled?: boolean;
  pymupdfVersion?: string;
  error?: string;
}

export function PdfEngineSetupCard() {
  const [status, setStatus] = useState<PdfEngineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    const response = await fetch('/api/runtime/pdf-engine', { cache: 'no-store' });
    setStatus(await response.json());
  };

  useEffect(() => { void refresh().catch(() => undefined); }, []);

  const install = async () => {
    setBusy(true);
    setMessage('PDF 도구를 자동으로 준비하는 중입니다.');
    try {
      const response = await fetch('/api/runtime/pdf-engine', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data?.ready) throw new Error(data?.error || 'PDF 도구를 준비하지 못했습니다.');
      setStatus(data);
      setMessage('PDF 도구 준비가 완료되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PDF 도구를 준비하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-outline-variant/25 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {status?.ready ? <CheckCircle2 size={16} className="text-emerald-600" /> : <FileCog size={16} className="text-on-surface-variant" />}
            <span className="text-sm font-semibold text-on-surface">PDF 하이라이트 도구</span>
          </div>
          <p className="mt-1 text-xs text-on-surface-variant">
            {status?.ready
              ? `준비됨${status.pymupdfVersion ? ` · PyMuPDF ${status.pymupdfVersion}` : ''}`
              : '원본 PDF에 하이라이트와 메모를 반영하려면 자동 준비가 필요합니다.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/40 px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {status?.ready ? '업데이트/복구' : '자동 준비'}
        </button>
      </div>
      {message && <p className="mt-3 text-xs text-on-surface-variant">{message}</p>}
    </div>
  );
}
