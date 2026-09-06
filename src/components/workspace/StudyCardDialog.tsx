'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';

import { ClozeRangePicker } from '@/components/workspace/ClozeRangePicker';
import { renderStudyCardCloze } from '@/lib/study-cards';
import { useWorkspace } from '@/lib/workspace-store';
import { StudyCardCloze } from '@/types';

export function StudyCardDialog() {
  const {
    pendingStudyCardRequest,
    consumeStudyCardRequest,
    notifyStudyCardsChanged,
  } = useWorkspace();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [cloze, setCloze] = useState<StudyCardCloze | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingStudyCardRequest) return;
    setFront(pendingStudyCardRequest.front || '');
    setBack(pendingStudyCardRequest.back || '');
    setCloze(null);
    setSaving(false);
    setError(null);
  }, [pendingStudyCardRequest]);

  useEffect(() => {
    if (!pendingStudyCardRequest) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) consumeStudyCardRequest(pendingStudyCardRequest.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [consumeStudyCardRequest, pendingStudyCardRequest, saving]);

  if (!pendingStudyCardRequest) return null;

  const sourceText = pendingStudyCardRequest.sourceContext.text || '';
  const isCloze = pendingStudyCardRequest.kind === 'cloze';
  const clozePreview = cloze && sourceText ? renderStudyCardCloze(sourceText, cloze) : '';
  const canSave = !saving && (isCloze ? Boolean(sourceText && cloze) : Boolean(front.trim() && back.trim()));
  const close = () => {
    if (!saving) consumeStudyCardRequest(pendingStudyCardRequest.id);
  };
  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/workspace/study-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath: pendingStudyCardRequest.pdfPath,
          sourceContext: pendingStudyCardRequest.sourceContext,
          front: isCloze ? clozePreview : front,
          back: isCloze ? cloze?.text : back,
          origin: pendingStudyCardRequest.origin,
          kind: isCloze ? 'cloze' : 'basic',
          cloze: isCloze ? cloze : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : '복습 카드를 저장하지 못했습니다.');
      }
      notifyStudyCardsChanged();
      consumeStudyCardRequest(pendingStudyCardRequest.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '복습 카드를 저장하지 못했습니다. 직접 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 py-6" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="study-card-dialog-title" className="w-full max-w-2xl rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-ambient">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="study-card-dialog-title" className="text-sm font-semibold text-on-surface">{isCloze ? '빈칸 카드 만들기' : '복습 카드 만들기'}</h2>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">{isCloze ? '원문 일부를 직접 가려 같은 Today 복습 흐름에 저장합니다.' : '질문과 답을 직접 다듬어 저장하세요. AI 없이도 그대로 사용할 수 있습니다.'}</p>
          </div>
          <button type="button" onClick={close} disabled={saving} className="shrink-0 rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label="복습 카드 만들기 닫기">
            <X size={14} />
          </button>
        </div>

        {sourceText && !isCloze && (
          <div className="mt-4 rounded-xl bg-surface-container px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-widest text-on-surface-variant">원문 · {pendingStudyCardRequest.sourceContext.page}페이지</div>
            <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-on-surface">{sourceText}</p>
          </div>
        )}

        {isCloze ? (
          <div className="mt-4 space-y-3">
            {sourceText ? <ClozeRangePicker sourceText={sourceText} value={cloze} onChange={setCloze} disabled={saving} /> : <p className="rounded-xl bg-error-container px-4 py-3 text-xs leading-5 text-on-error-container">선택 원문을 찾지 못해 빈칸 카드를 만들 수 없습니다. PDF에서 문장을 다시 선택해 주세요.</p>}
            {clozePreview && <div className="rounded-xl border border-outline-variant/20 bg-surface px-4 py-3"><div className="text-[11px] font-medium uppercase tracking-widest text-on-surface-variant">미리 보기</div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-on-surface">{clozePreview}</p></div>}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-on-surface-variant">질문 앞면</span>
              <textarea value={front} onChange={(event) => setFront(event.target.value)} disabled={saving} placeholder="무엇을 떠올려 볼까요?" className="min-h-36 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2.5 text-sm leading-6 text-on-surface outline-none focus:border-outline disabled:opacity-60" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-on-surface-variant">답 뒷면</span>
              <textarea value={back} onChange={(event) => setBack(event.target.value)} disabled={saving} placeholder="내 말로 답을 적으세요." className="min-h-36 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2.5 text-sm leading-6 text-on-surface outline-none focus:border-outline disabled:opacity-60" />
            </label>
          </div>
        )}

        {error && <p className="mt-3 text-xs leading-5 text-error" role="alert">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={close} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-50">취소</button>
          <button type="button" onClick={() => void handleSave()} disabled={!canSave} className="inline-flex items-center gap-2 rounded-xl bg-on-surface px-3 py-2 text-xs font-semibold text-surface-container-lowest hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? '저장 중...' : '카드 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
