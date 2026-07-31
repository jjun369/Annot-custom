'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, FolderHeart, ShieldCheck } from 'lucide-react';

import { CodexSetupCard } from '@/components/common/CodexSetupCard';
import { PageDockMark } from '@/components/common/PageDockMark';

export function OnboardingDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [libraryRoot, setLibraryRoot] = useState('PageDock Library');
  const [pdfEngineBusy, setPdfEngineBusy] = useState(false);
  const [pdfEngineMessage, setPdfEngineMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch('/api/library/preferences', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/library/info', { cache: 'no-store' }).then((response) => response.json()),
    ]).then(([preferences, libraryInfo]) => {
      if (cancelled) return;
      setLibraryRoot((current) => typeof libraryInfo?.root === 'string' ? libraryInfo.root : current);
      setOpen(preferences?.onboardingCompleted !== true);
    }).catch(() => {
      if (!cancelled) setOpen(true);
    });
    return () => { cancelled = true; };
  }, []);

  const finish = async () => {
    await fetch('/api/library/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboardingCompleted: true, libraryImportExplained: true }),
    }).catch(() => undefined);
    setOpen(false);
  };

  const preparePdfEngine = async () => {
    setPdfEngineBusy(true);
    setPdfEngineMessage('PDF 하이라이트와 번역 도구를 확인하는 중입니다.');
    try {
      const statusResponse = await fetch('/api/runtime/pdf-engine', { cache: 'no-store' });
      const status = await statusResponse.json();
      if (!status?.ready) {
        if (!status?.canAutoInstall) {
          throw new Error(status?.error || 'Python 3 설치 후 설정에서 PDF 도구를 준비할 수 있습니다.');
        }
        const installResponse = await fetch('/api/runtime/pdf-engine', { method: 'POST' });
        const installed = await installResponse.json();
        if (!installResponse.ok || !installed?.ready) {
          throw new Error(installed?.error || 'PDF 도구를 자동으로 준비하지 못했습니다.');
        }
      }
      setPdfEngineMessage('PDF 도구 준비가 완료되었습니다.');
    } catch (error) {
      setPdfEngineMessage(
        `${error instanceof Error ? error.message : 'PDF 도구를 준비하지 못했습니다.'} 기본 PDF 읽기와 메모는 계속 사용할 수 있습니다.`,
      );
    } finally {
      setPdfEngineBusy(false);
      setStep(2);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#182326]/45 p-4 backdrop-blur-sm">
      <section className="w-full max-w-xl overflow-hidden rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-2xl">
        <div className="h-1 bg-surface-container-high">
          <div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / 3) * 100}%` }} />
        </div>
        <div className="p-7 sm:p-9">
          {step === 0 && (
            <div className="text-center">
              <PageDockMark size={68} className="mx-auto rounded-2xl" />
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-on-surface">PageDock에 오신 것을 환영합니다</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-on-surface-variant">
                흩어진 PDF를 한곳에 모아 읽고, 표시하고, 필요할 때 AI와 함께 공부하는 로컬 작업 공간입니다.
              </p>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary"
              >
                시작하기 <ArrowRight size={15} />
              </button>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-on-surface">
                <FolderHeart size={22} />
              </div>
              <h1 className="mt-4 text-xl font-bold text-on-surface">PDF는 안전하게 복사해서 관리합니다</h1>
              <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                PDF를 추가하면 원본은 그대로 두고 아래 PageDock Library에 복사합니다. 원본 폴더를 정리하거나 외장 드라이브를 분리해도 공부 기록이 유지됩니다.
              </p>
              <div className="mt-4 rounded-xl border border-outline-variant/25 bg-surface px-4 py-3 text-xs text-on-surface-variant">
                <span className="mb-1 block font-semibold text-on-surface">현재 라이브러리</span>
                <span className="break-all">{libraryRoot}</span>
              </div>
              <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-on-surface-variant">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                앱을 삭제해도 라이브러리와 공부 기록은 자동으로 삭제하지 않습니다.
              </div>
              {pdfEngineMessage && <p className="mt-3 text-xs leading-5 text-on-surface-variant">{pdfEngineMessage}</p>}
              <div className="mt-7 flex justify-between">
                <button type="button" onClick={() => setStep(0)} className="px-3 py-2 text-sm text-on-surface-variant">이전</button>
                <button type="button" disabled={pdfEngineBusy} onClick={() => void preparePdfEngine()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary disabled:opacity-60">
                  {pdfEngineBusy ? 'PDF 도구 준비 중...' : '확인했어요'} {!pdfEngineBusy && <ArrowRight size={15} />}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="text-xl font-bold text-on-surface">AI 연결은 선택 사항입니다</h1>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                연결하지 않아도 PDF 읽기, 검색, 하이라이트와 메모를 사용할 수 있습니다. 필요하면 지금 공식 Codex를 자동으로 준비하세요.
              </p>
              <div className="mt-5"><CodexSetupCard compact /></div>
              <div className="mt-7 flex justify-between">
                <button type="button" onClick={() => setStep(1)} className="px-3 py-2 text-sm text-on-surface-variant">이전</button>
                <button type="button" onClick={() => void finish()} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary">
                  PageDock 열기
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
