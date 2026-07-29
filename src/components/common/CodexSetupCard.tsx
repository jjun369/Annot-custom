'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Loader2, LogIn, RefreshCw } from 'lucide-react';

interface CodexSetupStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  authMethod?: string;
  error?: string;
}

interface CodexSetupCardProps {
  compact?: boolean;
  onStatusChange?: (status: CodexSetupStatus) => void;
}

export function CodexSetupCard({ compact = false, onStatusChange }: CodexSetupCardProps) {
  const [status, setStatus] = useState<CodexSetupStatus | null>(null);
  const [busy, setBusy] = useState<'checking' | 'install' | 'update' | 'login' | null>('checking');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setBusy('checking');
    setMessage('');
    try {
      const response = await fetch('/api/runtime/codex', { cache: 'no-store' });
      const next = await response.json() as CodexSetupStatus;
      setStatus(next);
      onStatusChange?.(next);
    } catch {
      setStatus({ installed: false, authenticated: false, error: 'Codex 상태를 확인하지 못했습니다.' });
    } finally {
      setBusy(null);
    }
  }, [onStatusChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const runAction = async (action: 'install' | 'update' | 'login') => {
    setBusy(action);
    setMessage(action === 'login'
      ? '브라우저에서 로그인을 완료해 주세요.'
      : '공식 Codex를 준비하는 중입니다. 잠시만 기다려 주세요.');
    try {
      const response = await fetch('/api/runtime/codex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || 'Codex 작업에 실패했습니다.');
      const next = data as CodexSetupStatus;
      setStatus(next);
      onStatusChange?.(next);
      setMessage(action === 'login' ? 'Codex 로그인이 완료되었습니다.' : 'Codex 준비가 완료되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Codex 작업에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`rounded-xl border border-outline-variant/25 bg-surface ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {busy === 'checking' ? (
              <Loader2 size={15} className="animate-spin text-outline" />
            ) : status?.installed && status.authenticated ? (
              <CheckCircle2 size={16} className="text-emerald-600" />
            ) : (
              <Download size={16} className="text-on-surface-variant" />
            )}
            <span className="text-sm font-semibold text-on-surface">
              {!status ? 'Codex 확인 중'
                : !status.installed ? 'AI 연결 프로그램이 필요합니다'
                : status.authenticated ? 'Codex 연결 완료'
                : 'Codex 로그인 필요'}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-on-surface-variant">
            {!status ? '설치 상태를 확인하고 있습니다.'
              : !status.installed
                ? '버튼 한 번으로 OpenAI 공식 Codex를 설치합니다. 터미널을 열 필요가 없습니다.'
                : status.authenticated
                  ? `버전 ${status.version || '확인됨'} · 브라우저 로그인 연결됨`
                  : `버전 ${status.version || '확인됨'} · 브라우저에서 ChatGPT 로그인을 완료해 주세요.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!status?.installed && (
            <button
              type="button"
              onClick={() => void runAction('install')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50"
            >
              {busy === 'install' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              자동 설치
            </button>
          )}
          {status?.installed && !status.authenticated && (
            <button
              type="button"
              onClick={() => void runAction('login')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50"
            >
              {busy === 'login' ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
              브라우저 로그인
            </button>
          )}
          {status?.installed && (
            <button
              type="button"
              onClick={() => void runAction('update')}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/40 px-3 py-2 text-xs text-on-surface-variant disabled:opacity-50"
            >
              {busy === 'update' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              업데이트
            </button>
          )}
        </div>
      </div>
      {message && (
        <p className={`mt-3 text-xs ${/실패|못|오류/.test(message) ? 'text-rose-700' : 'text-on-surface-variant'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
