'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';

import { getVisualRegionKindLabel, VISUAL_REGION_KINDS } from '@/lib/visual-regions';
import { HighlightRect, VisualRegion, VisualRegionKind } from '@/types';

export interface VisualRegionDraftLocation {
  page: number;
  rect: HighlightRect;
}

interface VisualRegionDialogProps {
  draft: VisualRegionDraftLocation | null;
  region: VisualRegion | null;
  saving: boolean;
  onClose: () => void;
  onSave: (kind: VisualRegionKind, memo: string) => void;
}

export function VisualRegionDialog({
  draft,
  region,
  saving,
  onClose,
  onSave,
}: VisualRegionDialogProps) {
  const initial = region ?? draft;
  const [kind, setKind] = useState<VisualRegionKind>(region?.kind ?? 'figure');
  const [memo, setMemo] = useState(region?.memo ?? '');
  const kindRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initial) return;
    window.setTimeout(() => kindRef.current?.focus(), 0);
  }, [initial]);

  useEffect(() => {
    if (!initial) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) ?? []);
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [initial, onClose, saving]);

  if (!initial) return null;
  const verb = region ? '기록 편집' : '영역 기록';

  return (
    <div className="fixed inset-0 z-[80] bg-black/10" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="visual-region-dialog-title" aria-describedby="visual-region-dialog-description" className="absolute inset-y-0 right-0 flex w-[min(18rem,calc(100vw-1rem))] flex-col border-l border-outline-variant/25 bg-surface-container-lowest p-4 shadow-ambient min-[1440px]:w-80">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="visual-region-dialog-title" className="text-sm font-semibold text-on-surface">{verb}</h2>
            <p id="visual-region-dialog-description" className="mt-1 text-[11px] leading-5 text-on-surface-variant">p.{initial.page} 원문 위치에 메모를 연결합니다. 왼쪽 PDF를 보면서 기록할 수 있고, 이미지 파일은 따로 저장하지 않습니다.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="shrink-0 rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label={`${verb} 닫기`}>
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 grid flex-1 content-start gap-3 overflow-y-auto">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-on-surface-variant">영역 종류</span>
            <select ref={kindRef} value={kind} onChange={(event) => setKind(event.target.value as VisualRegionKind)} disabled={saving} className="h-8 w-full rounded-lg border border-outline-variant/30 bg-surface px-2.5 text-[12px] text-on-surface outline-none focus:border-outline disabled:opacity-60">
              {VISUAL_REGION_KINDS.map((candidate) => <option key={candidate} value={candidate}>{getVisualRegionKindLabel(candidate)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-on-surface-variant">메모 <span className="text-outline">(선택)</span></span>
            <textarea value={memo} onChange={(event) => setMemo(event.target.value)} disabled={saving} maxLength={6000} placeholder="이 그림이나 표에서 다시 확인할 점을 내 말로 남기세요." className="min-h-24 w-full rounded-lg border border-outline-variant/30 bg-surface px-2.5 py-2 text-[12px] leading-5 text-on-surface outline-none focus:border-outline disabled:opacity-60" />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-outline-variant/15 pt-3">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-[12px] font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-50">취소</button>
          <button type="button" onClick={() => onSave(kind, memo)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-on-surface px-3 py-2 text-[12px] font-semibold text-surface-container-lowest hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? '저장 중...' : region ? '변경 저장' : '영역 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
