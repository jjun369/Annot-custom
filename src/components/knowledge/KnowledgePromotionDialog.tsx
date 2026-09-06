'use client';

import { useEffect, useState } from 'react';
import { BookOpenText, Loader2, X } from 'lucide-react';

import type {
  KnowledgeProvenance,
  KnowledgeProvenanceKind,
} from '@/lib/knowledge-store';
import type { ChatSourceContext } from '@/types';

export interface KnowledgePromotionCandidate {
  text: string;
  sourceName: string;
  defaultKind: KnowledgeProvenanceKind;
  sourceAnchors?: ChatSourceContext[];
  provenance?: Omit<KnowledgeProvenance, 'kind' | 'originDate'>;
  originDate?: string;
  initialMemo?: string;
}

interface KnowledgePromotionDialogProps {
  candidate: KnowledgePromotionCandidate | null;
  onClose: () => void;
  onCaptured?: () => void;
}

const KIND_OPTIONS: Array<{ value: KnowledgeProvenanceKind; label: string; description: string }> = [
  { value: 'literature_claim', label: '문헌 주장', description: '원문에 실제로 적힌 주장이나 결과' },
  { value: 'work_observation', label: '업무 관찰', description: '업무 과정에서 직접 관찰·기록한 내용' },
  { value: 'personal_hypothesis', label: '개인 가설', description: '나의 해석, 추정, 아이디어' },
  { value: 'ai_inference', label: 'AI 추론', description: 'AI가 자료를 바탕으로 만든 해석·종합' },
];

function dateLabel(kind: KnowledgeProvenanceKind): string {
  switch (kind) {
    case 'literature_claim': return '발행일 / 근거 날짜 (선택)';
    case 'work_observation': return '관찰일 (선택)';
    case 'personal_hypothesis': return '작성일 (선택)';
    case 'ai_inference': return '생성일 (선택)';
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function KnowledgePromotionDialog({ candidate, onClose, onCaptured }: KnowledgePromotionDialogProps) {
  const [kind, setKind] = useState<KnowledgeProvenanceKind>('literature_claim');
  const [originDate, setOriginDate] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!candidate) return;
    setKind(candidate.defaultKind);
    setOriginDate(candidate.originDate || (candidate.defaultKind === 'ai_inference' ? today() : ''));
    setMemo(candidate.initialMemo || '');
    setBusy(false);
    setError('');
  }, [candidate]);

  useEffect(() => {
    if (!candidate) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, candidate, onClose]);

  if (!candidate) return null;

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async () => {
    const source = candidate.text.trim();
    if (!source) {
      setError('수집할 원문 또는 답변이 없습니다.');
      return;
    }
    const normalizedOriginDate = originDate.trim();
    if (normalizedOriginDate && !/^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/.test(normalizedOriginDate)) {
      setError('날짜는 YYYY-MM 또는 YYYY-MM-DD 형식으로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const provenance: KnowledgeProvenance = {
        kind,
        ...(normalizedOriginDate ? { originDate: normalizedOriginDate } : {}),
        ...(kind === 'ai_inference' && candidate.provenance?.ai ? { ai: candidate.provenance.ai } : {}),
      };
      const text = memo.trim()
        ? `${source}\n\n---\n\n## 수집 메모\n\n${memo.trim()}`
        : source;
      const response = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: [{
            text,
            sourceName: candidate.sourceName,
            provenance,
            sourceAnchors: candidate.sourceAnchors,
          }],
        }),
      });
      const payload = await response.json() as { error?: string; captured?: unknown[]; duplicates?: unknown[] };
      if (!response.ok) throw new Error(payload.error || '지식 후보를 수집하지 못했습니다.');
      if (!payload.captured?.length && payload.duplicates?.length) {
        setError('같은 내용이 이미 수집함에 있습니다.');
        return;
      }
      onCaptured?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '지식 후보를 수집하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4 py-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="knowledge-promotion-title" className="flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-ambient">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-on-surface" id="knowledge-promotion-title"><BookOpenText size={16} aria-hidden="true" />지식 후보로 보내기</div>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">검토 전 수집함에 추가합니다. 원문과 유형을 확인한 뒤 기존 Knowledge 검토 흐름에서 반영할 수 있습니다.</p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="지식 후보 보내기 닫기" className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"><X size={15} /></button>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="rounded-xl bg-surface-container px-3 py-3">
            <div className="text-[11px] font-semibold text-on-surface">유형</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {KIND_OPTIONS.map((option) => (
                <label key={option.value} className={`cursor-pointer rounded-lg border px-3 py-2 ${kind === option.value ? 'border-primary bg-primary-container/50' : 'border-outline-variant/25 bg-surface-container-lowest'}`}>
                  <input type="radio" name="knowledge-provenance-kind" value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} className="sr-only" />
                  <span className="block text-[11px] font-semibold text-on-surface">{option.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-on-surface-variant">{option.description}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/20 px-3 py-3">
            <div className="text-[11px] font-semibold text-on-surface">근거</div>
            <p className="mt-1 text-[10px] text-on-surface-variant">{candidate.sourceName}</p>
            <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-container px-3 py-2 text-[11px] leading-5 text-on-surface">{candidate.text}</p>
            <label className="mt-3 block text-[11px] font-medium text-on-surface-variant">{dateLabel(kind)}
              <input value={originDate} onChange={(event) => setOriginDate(event.target.value)} placeholder="YYYY-MM 또는 YYYY-MM-DD" maxLength={10} className="mt-1 h-9 w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 text-xs text-on-surface outline-none focus:border-outline" />
            </label>
          </div>

          <label className="block text-[11px] font-semibold text-on-surface">수집 메모 (선택)
            <textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={10_000} placeholder="왜 이 내용을 다시 보고 싶은지, 내 해석은 무엇인지 남겨 두세요." className="mt-1 min-h-24 w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-outline" />
          </label>
          {error && <p className="rounded-lg bg-error-container px-3 py-2 text-[11px] leading-5 text-on-error-container">{error}</p>}
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="rounded-xl px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">취소</button>
          <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">{busy && <Loader2 size={13} className="animate-spin" />}{busy ? '수집 중...' : '수집함으로 보내기'}</button>
        </div>
      </section>
    </div>
  );
}
