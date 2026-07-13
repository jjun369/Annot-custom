'use client';

import { useState } from 'react';
import { BookOpen, FileText, Star } from 'lucide-react';

import { useFeedback } from '@/components/common/FeedbackProvider';
import { PaperMetadata, TreeNode } from '@/types';

interface PaperListItemProps {
  pdf: TreeNode;
  relativePath: string;
  metadata: PaperMetadata;
  selected?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMetadataChange: (metadata: PaperMetadata) => void;
}

const STATUS_LABELS = {
  unread: '읽지 않음',
  reading: '읽는 중',
  completed: '완료',
} as const;

const STATUS_STYLES = {
  unread: 'bg-outline',
  reading: 'bg-primary',
  completed: 'bg-tertiary-fixed',
} as const;

export function PaperListItem({
  pdf,
  relativePath,
  metadata,
  selected = false,
  onSelect,
  onOpen,
  onMetadataChange,
}: PaperListItemProps) {
  const { notify } = useFeedback();
  const [statusSaving, setStatusSaving] = useState(false);

  const updateStatus = async (readingStatus: string) => {
    if (readingStatus !== 'unread' && readingStatus !== 'reading' && readingStatus !== 'completed') return;
    setStatusSaving(true);
    try {
      const res = await fetch('/api/papers/metadata', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPath: pdf.path, readingStatus }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '읽음 상태를 저장하지 못했습니다.');
      }
      onMetadataChange(data as PaperMetadata);
    } catch (error) {
      notify(error instanceof Error ? error.message : '읽음 상태를 저장하지 못했습니다.', 'error');
    } finally {
      setStatusSaving(false);
    }
  };

  return (
    <article
      className={`rounded-xl border transition-colors ${
        selected
          ? 'border-primary/35 bg-primary-container/25 shadow-sm'
          : 'border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/45'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_STYLES[metadata.readingStatus]}`} title={STATUS_LABELS[metadata.readingStatus]} />
          <FileText size={16} strokeWidth={1.8} className="shrink-0 text-outline" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-on-surface">{pdf.name}</span>
            {relativePath !== pdf.name && (
              <span className="mt-0.5 block truncate text-[10px] text-outline">{relativePath}</span>
            )}
            <span className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">
              {metadata.aiKeywords.length > 0 ? metadata.aiKeywords.slice(0, 3).map((keyword) => (
                <span key={keyword} className="shrink-0 rounded bg-surface-container px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                  {keyword}
                </span>
              )) : (
                <span className="text-[10px] text-outline">아직 AI 키워드가 없습니다</span>
              )}
              {metadata.aiKeywords.length > 3 && <span className="text-[10px] text-outline">+{metadata.aiKeywords.length - 3}</span>}
            </span>
            {metadata.summaryKo && (
              <span className="mt-1 block truncate text-[11px] leading-5 text-on-surface-variant">
                {metadata.summaryKo.split('\n')[0]}
              </span>
            )}
          </span>
        </button>

        <div className="hidden shrink-0 items-center gap-3 text-[10px] text-outline sm:flex">
          <div className="flex items-center gap-0.5" title={`논문 품질 ${metadata.rating ? `${metadata.rating}/5` : '미지정'}`}>
            {[1, 2, 3, 4, 5].map((score) => (
              <Star key={score} size={11} fill={score <= metadata.rating ? 'currentColor' : 'none'} className={score <= metadata.rating ? 'text-tertiary-fixed' : 'text-outline-variant'} />
            ))}
          </div>
          <div className="flex items-end gap-0.5" title={`다시 볼 필요성 ${metadata.importance ? `${metadata.importance}/5` : '미지정'}`}>
            {[1, 2, 3, 4, 5].map((score) => (
              <span key={score} className={`h-2.5 w-1 rounded-sm ${score <= metadata.importance ? 'bg-primary' : 'bg-outline-variant/40'}`} />
            ))}
          </div>
        </div>

        <select
          value={metadata.readingStatus}
          onChange={(event) => void updateStatus(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          disabled={statusSaving}
          aria-label={`${pdf.name} 읽음 상태`}
          className="h-8 w-[76px] shrink-0 rounded-lg border border-outline-variant/30 bg-surface px-1.5 text-[10px] text-on-surface outline-none focus:border-outline disabled:opacity-50"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-outline-variant/35 px-2.5 text-[11px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          title="PDF 열기"
        >
          <BookOpen size={12} />
          <span className="hidden md:inline">열기</span>
        </button>
      </div>
    </article>
  );
}
