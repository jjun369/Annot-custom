'use client';

import { useEffect, useMemo } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { Highlight } from '@/types';
import { getStudyKindLabel, inferStudyKind, isUnresolvedHighlight } from '@/lib/highlight-study';
import { getWorkKindLabel, isWorkDone } from '@/lib/highlight-work';
import { selectWorkEvidenceGroups } from '@/lib/work-evidence';

interface EvidenceBriefDialogProps {
  open: boolean;
  documentName: string;
  fileName: string;
  highlights: Highlight[];
  markdownReady: boolean;
  loading?: boolean;
  onCancel: () => void;
  onNavigate: (highlight: Highlight) => void;
  onDownload: () => void | Promise<void>;
}

function EvidenceCard({
  highlight,
  kind,
  onNavigate,
}: {
  highlight: Highlight;
  kind: 'work' | 'learning';
  onNavigate: () => void;
}) {
  const label = kind === 'work'
    ? getWorkKindLabel(highlight.workKind!)
    : getStudyKindLabel(inferStudyKind(highlight));
  const status = kind === 'work'
    ? highlight.workKind === 'finding'
      ? '기록'
      : isWorkDone(highlight) ? '완료' : '열림'
    : '이해 필요';

  return (
    <article className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-3">
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold">
        <span className="text-on-surface-variant">p. {highlight.page}</span>
        <span className="text-primary">{label} · {status}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-on-surface">
        {highlight.text || '텍스트 없음'}
      </p>
      {highlight.note?.trim() && (
        <p className="mt-2 whitespace-pre-wrap break-words border-t border-outline-variant/15 pt-2 text-[11px] leading-5 text-on-surface-variant">
          {highlight.note}
        </p>
      )}
      <button
        type="button"
        onClick={onNavigate}
        className="mt-2 text-[11px] font-semibold text-primary hover:underline"
      >
        p.{highlight.page} · 원문으로
      </button>
    </article>
  );
}

function BriefSection({
  title,
  description,
  highlights,
  kind,
  onNavigate,
  emptyMessage,
}: {
  title: string;
  description: string;
  highlights: Highlight[];
  kind: 'work' | 'learning';
  onNavigate: (highlight: Highlight) => void;
  emptyMessage: string;
}) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold text-on-surface">{title}</h3>
        <span className="text-[10px] font-medium text-on-surface-variant">{highlights.length}</span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-on-surface-variant">{description}</p>
      {highlights.length === 0 ? (
        <p className="mt-2 rounded-lg bg-surface-container px-3 py-2 text-[11px] text-on-surface-variant">{emptyMessage}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {highlights.map((highlight) => (
            <EvidenceCard
              key={highlight.annotationId || highlight.id}
              highlight={highlight}
              kind={kind}
              onNavigate={() => onNavigate(highlight)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function EvidenceBriefDialog({
  open,
  documentName,
  fileName,
  highlights,
  markdownReady,
  loading = false,
  onCancel,
  onNavigate,
  onDownload,
}: EvidenceBriefDialogProps) {
  const groups = useMemo(() => selectWorkEvidenceGroups(highlights), [highlights]);
  const unresolved = useMemo(
    () => highlights.filter((highlight) => isUnresolvedHighlight(highlight)),
    [highlights],
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
      <div className="flex h-full max-h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-ambient">
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-on-surface">Evidence Brief</h2>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">{documentName}의 업무 근거와 아직 이해가 필요한 원문을 분리해 봅니다. 다운로드는 업무 Brief Markdown만 포함합니다.</p>
            <p className="mt-2 truncate text-[11px] text-outline">{fileName}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="shrink-0 rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            aria-label="Evidence Brief 닫기"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
              <Loader2 size={14} className="animate-spin" />
              내보낼 Markdown을 준비하는 중입니다.
            </div>
          )}
          <div className="space-y-6">
            <BriefSection
              title="Finding · 기록"
              description="완료 처리하지 않는 해석·관찰 기록입니다."
              highlights={groups.findings}
              kind="work"
              onNavigate={onNavigate}
              emptyMessage="기록된 Finding이 없습니다."
            />
            <BriefSection
              title="열린 업무 후속"
              description="Verify, Discuss, Try로 남긴 아직 끝나지 않은 후속입니다."
              highlights={groups.openFollowUps}
              kind="work"
              onNavigate={onNavigate}
              emptyMessage="열린 업무 후속이 없습니다."
            />
            <BriefSection
              title="학습 기록 · 이해 필요"
              description="이 섹션은 Reader에서 다시 읽기 위한 보조 맥락이며, 업무 Evidence Brief Markdown에는 포함되지 않습니다."
              highlights={unresolved}
              kind="learning"
              onNavigate={onNavigate}
              emptyMessage="현재 이해가 필요한 기록이 없습니다."
            />
            <details className="rounded-xl border border-outline-variant/20 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-on-surface">완료된 업무 후속 · {groups.completedFollowUps.length}</summary>
              <div className="mt-3">
                <BriefSection
                  title="완료된 업무 후속"
                  description="원문과 기록은 남기되, 현재 열린 후속 목록에서는 제외됩니다."
                  highlights={groups.completedFollowUps}
                  kind="work"
                  onNavigate={onNavigate}
                  emptyMessage="완료된 업무 후속이 없습니다."
                />
              </div>
            </details>
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/15 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={loading || !markdownReady}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            <Download size={13} /> 업무 Brief Markdown 내려받기
          </button>
        </footer>
      </div>
    </div>
  );
}
