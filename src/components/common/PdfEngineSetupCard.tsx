'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileCog, Loader2, RefreshCw } from 'lucide-react';

interface PdfEngineStatus {
  ready: boolean;
  pythonInstalled?: boolean;
  platform?: NodeJS.Platform;
  canAutoInstall?: boolean;
  setupUrl?: string;
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
    setMessage(status?.platform === 'darwin'
      ? 'PageDock 전용 Python 환경에 PyMuPDF를 준비하는 중입니다.'
      : 'PDF 도구를 자동으로 준비하는 중입니다.');
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
              : status?.platform === 'darwin' && !status.pythonInstalled
                ? 'Python 3 설치 후 PageDock 전용 환경에 PDF 도구를 준비할 수 있습니다. 기본 PDF 읽기는 계속 사용할 수 있습니다.'
                : '원본 PDF에 하이라이트와 메모를 반영하려면 준비가 필요합니다.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status && !status.canAutoInstall && status.setupUrl && (
            <a
              href={status.setupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/40 px-3 py-2 text-xs font-semibold text-on-surface-variant"
            >
              <ExternalLink size={13} /> Python 설치 안내
            </a>
          )}
          {(!status || status.canAutoInstall) && (
            <button
              type="button"
              onClick={() => void install()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/40 px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {status?.ready ? '업데이트/복구' : '자동 준비'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/40 px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:opacity-50"
          >
            <RefreshCw size={13} /> 다시 확인
          </button>
        </div>
      </div>
      {message && <p className="mt-3 text-xs text-on-surface-variant">{message}</p>}
    </div>
  );
}
