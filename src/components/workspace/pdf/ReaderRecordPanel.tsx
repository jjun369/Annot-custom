'use client';

import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Image as ImageIcon, Pencil, Trash2, X } from 'lucide-react';
import { Highlight, HighlightWorkKind, VisualRegion } from '@/types';
import { getStudyKindLabel, inferStudyKind, isUnresolvedHighlight } from '@/lib/highlight-study';
import { compareVisualRegionsBySource, getVisualRegionKindLabel } from '@/lib/visual-regions';
import {
  getWorkKindLabel,
  isWorkActionKind,
  isWorkDone,
} from '@/lib/highlight-work';
import { selectWorkEvidenceGroups } from '@/lib/work-evidence';

export type ReaderLearningFilter = 'all' | 'needs-understanding' | 'understood';
type WorkFilter = 'open' | 'completed';
type WorkKindFilter = 'all' | HighlightWorkKind;
export type ReaderRecordTab = 'learning' | 'work' | 'visual';

export interface ReaderRecordPanelProps {
  highlights: Highlight[];
  visualRegions?: VisualRegion[];
  selectedHighlightKey: string | null;
  selectedVisualRegionId?: string | null;
  /** Reader actions can point directly at the place where a record was saved. */
  requestedTab?: ReaderRecordTab;
  /** A save action can open the unresolved view without adding a second queue. */
  requestedLearningFilter?: ReaderLearningFilter;
  onClose: () => void;
  onNavigate: (highlight: Highlight) => void;
  onEdit: (highlight: Highlight) => void;
  /** Explicit user resolution only; it never creates a card or invokes AI. */
  onToggleResolved?: (highlight: Highlight) => void;
  resolvingHighlightKey?: string | null;
  onNavigateVisualRegion?: (region: VisualRegion) => void;
  onEditVisualRegion?: (region: VisualRegion) => void;
  onDeleteVisualRegion?: (region: VisualRegion) => void;
}

function highlightKey(highlight: Highlight): string {
  return highlight.annotationId || highlight.id;
}

function compareBySource(a: Highlight, b: Highlight): number {
  if (a.page !== b.page) return a.page - b.page;
  const aRect = a.rects?.[0] ?? a.position;
  const bRect = b.rects?.[0] ?? b.position;
  if (Math.abs(aRect.y - bRect.y) > 0.0005) return aRect.y - bRect.y;
  return aRect.x - bRect.x;
}

function studyStatus(highlight: Highlight): string | undefined {
  const kind = inferStudyKind(highlight);
  if (kind !== 'unclear' && kind !== 'question') return undefined;
  return highlight.resolvedAt ? '이해 완료' : '다시 볼 것';
}

function workStatus(highlight: Highlight): string | undefined {
  if (!isWorkActionKind(highlight.workKind)) return undefined;
  return isWorkDone(highlight) ? '완료' : '열림';
}

function RecordCard({
  highlight,
  selected,
  mode,
  onNavigate,
  onEdit,
  onToggleResolved,
  resolving,
}: {
  highlight: Highlight;
  selected: boolean;
  mode: 'learning' | 'work';
  onNavigate: () => void;
  onEdit: () => void;
  onToggleResolved?: () => void;
  resolving?: boolean;
}) {
  const studyKind = inferStudyKind(highlight);
  const secondaryStatus = mode === 'learning' ? studyStatus(highlight) : workStatus(highlight);

  return (
    <div className={`rounded-lg border px-3 py-2 transition-colors ${
      selected
        ? 'border-outline bg-surface-container'
        : 'border-transparent hover:bg-surface-container-low'
    }`}>
    <button
      type="button"
      onClick={onNavigate}
      className="w-full text-left"
      aria-label={`${highlight.page}페이지 원문으로 이동`}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold">
        <span className="text-on-surface-variant">페이지 {highlight.page}</span>
        <span className={mode === 'learning'
          ? (highlight.type === 'important' ? 'text-tertiary-fixed' : 'text-study-unclear')
          : 'text-primary'}
        >
          {mode === 'learning' ? getStudyKindLabel(studyKind) : getWorkKindLabel(highlight.workKind!)}
        </span>
      </div>
      <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-on-surface">{highlight.text || '텍스트 없음'}</p>
      {secondaryStatus && (
        <p className={`mt-1 text-[10px] font-semibold ${
          secondaryStatus === '다시 볼 것' ? 'text-study-unclear' : secondaryStatus === '이해 완료' ? 'text-study-resolved' : 'text-on-surface-variant'
        }`}
        >
          {secondaryStatus === '이해 완료' ? '✓ 이해 완료' : secondaryStatus}
        </p>
      )}
      {highlight.note?.trim() && (
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-on-surface-variant">메모: {highlight.note}</p>
      )}
      <p className="mt-1.5 text-[10px] font-semibold text-primary">p.{highlight.page} · 원문으로</p>
    </button>
    <button
      type="button"
      onClick={onEdit}
      className="mt-1.5 rounded-md px-1 py-0.5 text-[10px] font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
    >
      기록 편집
    </button>
    {mode === 'learning' && isUnresolvedHighlight(highlight) && onToggleResolved && (
      <button
        type="button"
        onClick={onToggleResolved}
        disabled={resolving}
        className="ml-1.5 rounded-md bg-study-resolved-container px-1.5 py-0.5 text-[10px] font-semibold text-study-resolved hover:opacity-85 disabled:opacity-50"
      >
        {resolving ? '저장 중…' : '이해 완료'}
      </button>
    )}
    </div>
  );
}

function VisualRegionCard({
  region,
  selected,
  onNavigate,
  onEdit,
  onDelete,
}: {
  region: VisualRegion;
  selected: boolean;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const label = getVisualRegionKindLabel(region.kind);
  const accessibleLabel = region.memo
    ? `${label} 영역, ${region.page}페이지, ${region.memo}`
    : `${label} 영역, ${region.page}페이지`;
  return (
    <div className={`rounded-lg border px-3 py-2 transition-colors ${selected ? 'border-primary/60 bg-primary-container/40' : 'border-transparent hover:bg-surface-container-low'}`}>
      <button type="button" onClick={onNavigate} className="w-full text-left" aria-label={`${accessibleLabel} 원문으로 이동`}>
        <div className="flex items-center justify-between gap-2 text-[10px] font-semibold">
          <span className="inline-flex items-center gap-1 text-on-surface-variant"><ImageIcon size={11} aria-hidden="true" /> 페이지 {region.page}</span>
          <span className="text-primary">{label}</span>
        </div>
        {region.memo && <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-on-surface">{region.memo}</p>}
        <p className="mt-1.5 text-[10px] font-semibold text-primary">p.{region.page} · 원문으로</p>
      </button>
      <div className="mt-1.5 flex items-center gap-1">
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface" aria-label={`${accessibleLabel} 편집`}><Pencil size={10} aria-hidden="true" /> 편집</button>
        <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium text-error hover:bg-error-container/40" aria-label={`${accessibleLabel} 삭제`}><Trash2 size={10} aria-hidden="true" /> 삭제</button>
      </div>
    </div>
  );
}

export function ReaderRecordPanel({
  highlights,
  visualRegions = [],
  selectedHighlightKey,
  selectedVisualRegionId,
  requestedTab,
  requestedLearningFilter,
  onClose,
  onNavigate,
  onEdit,
  onToggleResolved,
  resolvingHighlightKey,
  onNavigateVisualRegion,
  onEditVisualRegion,
  onDeleteVisualRegion,
}: ReaderRecordPanelProps) {
  const [activeTab, setActiveTab] = useState<ReaderRecordTab>(
    requestedTab ?? (selectedVisualRegionId ? 'visual' : 'learning'),
  );
  const [learningFilter, setLearningFilter] = useState<ReaderLearningFilter>(requestedLearningFilter ?? 'all');
  const [workFilter, setWorkFilter] = useState<WorkFilter>('open');
  const [workKindFilter, setWorkKindFilter] = useState<WorkKindFilter>('all');
  const tabRefs = useRef<Record<ReaderRecordTab, HTMLButtonElement | null>>({
    learning: null,
    work: null,
    visual: null,
  });

  const orderedHighlights = useMemo(() => [...highlights].sort(compareBySource), [highlights]);
  const unresolvedCount = useMemo(
    () => highlights.filter((highlight) => isUnresolvedHighlight(highlight)).length,
    [highlights],
  );
  const understoodCount = useMemo(
    () => highlights.filter((highlight) => {
      const kind = inferStudyKind(highlight);
      return (kind === 'unclear' || kind === 'question') && Boolean(highlight.resolvedAt);
    }).length,
    [highlights],
  );
  const workEvidence = useMemo(
    () => selectWorkEvidenceGroups(orderedHighlights),
    [orderedHighlights],
  );
  const openWorkCount = useMemo(
    () => workEvidence.openFollowUps.length,
    [workEvidence.openFollowUps],
  );
  const completedWorkCount = useMemo(
    () => workEvidence.completedFollowUps.length,
    [workEvidence.completedFollowUps],
  );
  const learningItems = useMemo(() => orderedHighlights.filter((highlight) => {
    if (learningFilter === 'needs-understanding') return isUnresolvedHighlight(highlight);
    if (learningFilter === 'understood') {
      const kind = inferStudyKind(highlight);
      return (kind === 'unclear' || kind === 'question') && Boolean(highlight.resolvedAt);
    }
    return true;
  }), [learningFilter, orderedHighlights]);
  const findingItems = useMemo(() => workEvidence.findings.filter((highlight) => (
    highlight.workKind === 'finding'
    && workFilter === 'open'
    && (workKindFilter === 'all' || workKindFilter === 'finding')
  )), [workEvidence.findings, workFilter, workKindFilter]);
  const workItems = useMemo(() => {
    const candidates = workFilter === 'completed'
      ? workEvidence.completedFollowUps
      : workEvidence.openFollowUps;
    return candidates.filter((highlight) => (
      workKindFilter === 'all' || highlight.workKind === workKindFilter
    ));
  }, [workEvidence.completedFollowUps, workEvidence.openFollowUps, workFilter, workKindFilter]);
  const visibleWorkItems = workKindFilter === 'finding' ? findingItems : workItems;
  const showFindingSection = activeTab === 'work' && workFilter === 'open' && workKindFilter === 'all' && findingItems.length > 0;
  const orderedVisualRegions = useMemo(
    () => [...visualRegions].sort(compareVisualRegionsBySource),
    [visualRegions],
  );
  const items = activeTab === 'learning' ? learningItems : visibleWorkItems;
  const emptyMessage = activeTab === 'learning'
    ? learningFilter === 'needs-understanding'
      ? '현재 다시 볼 기록이 없습니다.'
      : learningFilter === 'understood'
        ? '아직 이해 완료로 표시한 기록이 없습니다.'
        : 'PDF에서 문장을 선택해 학습 기록을 남겨 보세요.'
    : activeTab === 'visual'
      ? '아직 기록한 그림·표·수식 영역이 없습니다.'
    : workFilter === 'completed'
      ? '완료된 업무 후속이 없습니다.'
      : '원문을 선택한 뒤 업무 후속으로 남겨 보세요.';
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tabOrder: ReaderRecordTab[] = ['learning', 'work', 'visual'];
    const currentIndex = tabOrder.indexOf(activeTab);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabOrder[(currentIndex + offset + tabOrder.length) % tabOrder.length];
    setActiveTab(next);
    window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-outline-variant/20 bg-surface-container-lowest min-[1440px]:w-[20.5rem]" aria-label="PDF 읽기 기록">
      <div className="flex items-center justify-between border-b border-outline-variant/15 px-3 py-3">
        <div>
          <div className="text-xs font-semibold text-on-surface">기록</div>
          <div className="mt-0.5 text-[10px] text-outline">원문에 연결된 기록입니다. 필요한 항목만 골라 다시 보세요.</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container"
          aria-label="읽기 기록 패널 닫기"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 border-b border-outline-variant/15 px-2 py-2" role="tablist" aria-label="읽기 기록 종류">
        <button
          type="button"
          role="tab"
          id="reader-record-learning-tab"
          aria-controls="reader-record-learning-panel"
          aria-selected={activeTab === 'learning'}
          tabIndex={activeTab === 'learning' ? 0 : -1}
          ref={(element) => { tabRefs.current.learning = element; }}
          onClick={() => setActiveTab('learning')}
          onKeyDown={handleTabKeyDown}
          className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${activeTab === 'learning' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container'}`}
        >
          읽기 {unresolvedCount ? `· ${unresolvedCount}` : ''}
        </button>
        <button
          type="button"
          role="tab"
          id="reader-record-work-tab"
          aria-controls="reader-record-work-panel"
          aria-selected={activeTab === 'work'}
          tabIndex={activeTab === 'work' ? 0 : -1}
          ref={(element) => { tabRefs.current.work = element; }}
          onClick={() => setActiveTab('work')}
          onKeyDown={handleTabKeyDown}
          className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${activeTab === 'work' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container'}`}
        >
          업무 {openWorkCount ? `· ${openWorkCount}` : ''}
        </button>
        <button
          type="button"
          role="tab"
          id="reader-record-visual-tab"
          aria-controls="reader-record-visual-panel"
          aria-selected={activeTab === 'visual'}
          tabIndex={activeTab === 'visual' ? 0 : -1}
          ref={(element) => { tabRefs.current.visual = element; }}
          onClick={() => setActiveTab('visual')}
          onKeyDown={handleTabKeyDown}
          className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${activeTab === 'visual' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container'}`}
        >
          영역 {visualRegions.length ? `· ${visualRegions.length}` : ''}
        </button>
      </div>

      {activeTab === 'learning' ? (
        <div className="flex gap-1 border-b border-outline-variant/15 px-2 py-2" role="group" aria-label="학습 기록 필터">
          {([
            ['all', `전체 ${orderedHighlights.length}`],
            ['needs-understanding', `다시 볼 것 ${unresolvedCount}`],
            ['understood', `이해 완료 ${understoodCount}`],
          ] as const).map(([filter, label]) => (
            <button
              type="button"
              key={filter}
              onClick={() => setLearningFilter(filter)}
              className={`rounded-md px-2 py-1 text-[10px] font-medium ${learningFilter === filter ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container'}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : activeTab === 'work' ? (
        <div className="space-y-1.5 border-b border-outline-variant/15 px-2 py-2">
          <div className="flex gap-1" role="group" aria-label="업무 후속 상태 필터">
            <button
              type="button"
              onClick={() => setWorkFilter('open')}
              className={`rounded-md px-2 py-1 text-[10px] font-medium ${workFilter === 'open' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container'}`}
            >
              열림 {openWorkCount}
            </button>
            <button
              type="button"
              onClick={() => setWorkFilter('completed')}
              className={`rounded-md px-2 py-1 text-[10px] font-medium ${workFilter === 'completed' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container'}`}
            >
              완료 {completedWorkCount}
            </button>
          </div>
          <label className="sr-only" htmlFor="reader-work-kind-filter">업무 후속 유형</label>
          <select
            id="reader-work-kind-filter"
            value={workKindFilter}
            onChange={(event) => setWorkKindFilter(event.target.value as WorkKindFilter)}
            className="h-7 w-full rounded-md border border-outline-variant/30 bg-surface px-2 text-[10px] text-on-surface outline-none focus:border-outline"
          >
            <option value="all">전체 유형</option>
            <option value="finding">Finding</option>
            <option value="verify">Verify</option>
            <option value="discuss">Discuss</option>
            <option value="try">Try</option>
          </select>
        </div>
      ) : null}

      <div
        id={activeTab === 'learning' ? 'reader-record-learning-panel' : activeTab === 'work' ? 'reader-record-work-panel' : 'reader-record-visual-panel'}
        role="tabpanel"
        aria-labelledby={activeTab === 'learning' ? 'reader-record-learning-tab' : activeTab === 'work' ? 'reader-record-work-tab' : 'reader-record-visual-tab'}
        className="flex-1 overflow-y-auto p-2"
      >
        {activeTab === 'visual' ? (
          orderedVisualRegions.length === 0 ? (
            <div className="rounded-lg bg-surface-container px-3 py-4 text-[11px] leading-5 text-on-surface-variant">{emptyMessage}</div>
          ) : (
            <div className="space-y-2">
              {orderedVisualRegions.map((region) => (
                <VisualRegionCard
                  key={region.id}
                  region={region}
                  selected={selectedVisualRegionId === region.id}
                  onNavigate={() => onNavigateVisualRegion?.(region)}
                  onEdit={() => onEditVisualRegion?.(region)}
                  onDelete={() => onDeleteVisualRegion?.(region)}
                />
              ))}
            </div>
          )
        ) : items.length === 0 && !showFindingSection ? (
          <div className="rounded-lg bg-surface-container px-3 py-4 text-[11px] leading-5 text-on-surface-variant">{emptyMessage}</div>
        ) : (
          <div className="space-y-1.5">
            {showFindingSection && (
              <section aria-label="기록된 Finding">
                <div className="mb-1 px-1 text-[10px] font-semibold text-on-surface-variant">Finding · 기록</div>
                <p className="mb-1.5 px-1 text-[10px] leading-4 text-on-surface-variant">Finding은 완료 처리하지 않는 해석 기록입니다.</p>
                <div className="space-y-1.5">
                  {findingItems.map((highlight) => (
                    <RecordCard
                      key={`finding:${highlightKey(highlight)}`}
                      highlight={highlight}
                      mode="work"
                      selected={highlightKey(highlight) === selectedHighlightKey}
                      onNavigate={() => onNavigate(highlight)}
                      onEdit={() => onEdit(highlight)}
                    />
                  ))}
                </div>
              </section>
            )}
            {showFindingSection && items.length > 0 && (
              <div className="mt-3 px-1 text-[10px] font-semibold text-on-surface-variant">열린 후속</div>
            )}
            {items.map((highlight) => (
              <RecordCard
                key={`${activeTab}:${highlightKey(highlight)}`}
                highlight={highlight}
                mode={activeTab}
                selected={highlightKey(highlight) === selectedHighlightKey}
                onNavigate={() => onNavigate(highlight)}
                onEdit={() => onEdit(highlight)}
                onToggleResolved={activeTab === 'learning' ? () => onToggleResolved?.(highlight) : undefined}
                resolving={resolvingHighlightKey === highlightKey(highlight)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
