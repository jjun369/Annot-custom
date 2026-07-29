'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpenText,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Save,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';

import { useFeedback } from '@/components/common/FeedbackProvider';
import { normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { readStoredReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import { PaperMetadata, PaperTranslation, TreeNode } from '@/types';

interface PaperInspectorProps {
  pdf: TreeNode;
  relativePath: string;
  metadata: PaperMetadata;
  onOpen: () => void;
  onMetadataChange: (metadata: PaperMetadata) => void;
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export function PaperInspector({
  pdf,
  relativePath,
  metadata,
  onOpen,
  onMetadataChange,
}: PaperInspectorProps) {
  const { confirm, notify } = useFeedback();
  const [summary, setSummary] = useState(metadata.summaryKo);
  const [note, setNote] = useState(metadata.noteMarkdown);
  const [personalTags, setPersonalTags] = useState(metadata.personalTags);
  const [tagInput, setTagInput] = useState('');
  const [noteMode, setNoteMode] = useState<'edit' | 'preview'>('edit');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [analyzing, setAnalyzing] = useState(false);
  const [previewTranslation, setPreviewTranslation] = useState<PaperTranslation | null>(null);
  const pendingUpdatesRef = useRef<Record<string, unknown>>({});
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const flushPendingRef = useRef<() => Promise<void>>(async () => undefined);
  const previousPdfPathRef = useRef(pdf.path);

  const flushPending = useCallback(async () => {
    if (savingRef.current) return;

    const updates = pendingUpdatesRef.current;
    if (Object.keys(updates).length === 0) {
      setSaveState((current) => current === 'pending' ? 'saved' : current);
      return;
    }

    pendingUpdatesRef.current = {};
    savingRef.current = true;
    setSaveState('saving');
    let shouldFlushAgain = false;

    try {
      const res = await fetch('/api/papers/metadata', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPath: pdf.path, ...updates }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '저장하지 못했습니다.');
      }
      onMetadataChange(data as PaperMetadata);
      setSaveState('saved');
      shouldFlushAgain = Object.keys(pendingUpdatesRef.current).length > 0;
    } catch (error) {
      const newerUpdates = pendingUpdatesRef.current;
      pendingUpdatesRef.current = { ...updates, ...newerUpdates };
      setSaveState('error');
      notify(error instanceof Error ? error.message : '저장하지 못했습니다.', 'error');
      shouldFlushAgain = Object.keys(newerUpdates).length > 0;
    } finally {
      savingRef.current = false;
      if (shouldFlushAgain) {
        setSaveState('pending');
        window.setTimeout(() => void flushPendingRef.current(), 120);
      }
    }
  }, [notify, onMetadataChange, pdf.path]);

  flushPendingRef.current = flushPending;

  const queueUpdate = useCallback((updates: Record<string, unknown>, immediate = false) => {
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    setSaveState('pending');
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    if (immediate) {
      void flushPending();
      return;
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushPending();
    }, 700);
  }, [flushPending]);

  useEffect(() => {
    const changedPaper = previousPdfPathRef.current !== pdf.path;
    previousPdfPathRef.current = pdf.path;
    if (!changedPaper && (Object.keys(pendingUpdatesRef.current).length > 0 || savingRef.current)) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSummary(metadata.summaryKo);
    setNote(metadata.noteMarkdown);
    setPersonalTags(metadata.personalTags);
    setTagInput('');
    setNoteMode('edit');
    setPreviewTranslation(null);
    pendingUpdatesRef.current = {};
    setSaveState('saved');
  }, [metadata, pdf.path]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const updateReadingStatus = (readingStatus: string) => {
    if (readingStatus !== 'unread' && readingStatus !== 'reading' && readingStatus !== 'completed') return;
    queueUpdate({ readingStatus }, true);
  };

  const addTags = (value: string) => {
    const additions = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (additions.length === 0) return;
    const nextTags = [...new Set([...personalTags, ...additions])];
    setPersonalTags(nextTags);
    setTagInput('');
    queueUpdate({ personalTags: nextTags }, true);
  };

  const removeTag = (tagToRemove: string) => {
    const nextTags = personalTags.filter((tag) => tag !== tagToRemove);
    setPersonalTags(nextTags);
    queueUpdate({ personalTags: nextTags }, true);
  };

  const analyze = async () => {
    if (metadata.summaryKo) {
      const shouldOverwrite = await confirm({
        title: '요약 다시 분석',
        message: '현재 개인이 수정한 3줄 요약이 새 AI 분석 결과로 덮어써집니다. 계속할까요?',
        confirmLabel: '새 결과로 덮어쓰기',
      });
      if (!shouldOverwrite) return;
    }

    await flushPending();
    setAnalyzing(true);
    try {
      const res = await fetch('/api/papers/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath: pdf.path,
          model: normalizeModelPreference(window.localStorage.getItem('annot-last-model')),
          reasoningEffort: readStoredReasoningEffort(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '분석하지 못했습니다.');
      }
      const nextMetadata = data as PaperMetadata;
      setSummary(nextMetadata.summaryKo);
      setPersonalTags(nextMetadata.personalTags);
      onMetadataChange(nextMetadata);
      notify('AI 분석을 저장했습니다.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '분석하지 못했습니다.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const deleteTranslation = async (translationId: string) => {
    const shouldDelete = await confirm({
      title: '번역 삭제',
      message: '저장된 번역을 삭제할까요? 이 작업은 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      destructive: true,
    });
    if (!shouldDelete) return;

    try {
      const params = new URLSearchParams({ path: pdf.path, id: translationId });
      const res = await fetch(`/api/papers/translations?${params.toString()}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '번역을 삭제하지 못했습니다.');
      }
      setPreviewTranslation(null);
      onMetadataChange(data as PaperMetadata);
      notify('번역을 삭제했습니다.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : '번역을 삭제하지 못했습니다.', 'error');
    }
  };

  const downloadTranslation = (translation: PaperTranslation) => {
    const blob = new Blob([translation.bilingualMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${pdf.name.replace(/\.pdf$/i, '')}-${translation.title}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const saveLabel = saveState === 'saving'
    ? '저장 중...'
    : saveState === 'pending'
      ? '변경 대기 중'
      : saveState === 'error'
        ? '저장 실패'
        : '저장됨';

  return (
    <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-ambient">
      <div className="border-b border-outline-variant/15 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container text-primary">
            <FileText size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">논문 상세</div>
            <h2 className="mt-1 break-words text-sm font-semibold leading-5 text-on-surface">{pdf.name}</h2>
            {relativePath !== pdf.name && (
              <p className="mt-1 break-all text-[10px] leading-4 text-outline">{relativePath}</p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90"
          >
            <BookOpenText size={13} />
            PDF 열기
          </button>
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={analyzing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/35 px-3 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50"
          >
            {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {analyzing ? '분석 중...' : 'AI 분석'}
          </button>
        </div>
      </div>

      <div className="space-y-5 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <ScaleInput
            label="논문 품질 별점"
            value={metadata.rating}
            variant="rating"
            onChange={(value) => queueUpdate({ rating: value }, true)}
          />
          <ScaleInput
            label="다시 볼 필요성"
            value={metadata.importance}
            variant="importance"
            onChange={(value) => queueUpdate({ importance: value }, true)}
          />
        </div>

        <label className="block text-xs font-semibold text-on-surface">
          읽음 상태
          <select
            value={metadata.readingStatus}
            onChange={(event) => updateReadingStatus(event.target.value)}
            className="mt-1.5 h-9 w-full rounded-lg border border-outline-variant/30 bg-surface px-3 text-xs font-normal text-on-surface outline-none focus:border-outline"
          >
            <option value="unread">읽지 않음</option>
            <option value="reading">읽는 중</option>
            <option value="completed">완료</option>
          </select>
        </label>

        <div>
          <div className="text-xs font-semibold text-on-surface">개인 태그</div>
          <div className="mt-1.5 flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface px-2 py-1.5 focus-within:border-outline">
            {personalTags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-primary-container px-2 py-1 text-[11px] text-on-surface">
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="rounded p-0.5 text-on-surface-variant hover:bg-surface-container-high"
                  aria-label={`${tag} 태그 삭제`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addTags(tagInput);
                }
              }}
              onBlur={() => addTags(tagInput)}
              placeholder={personalTags.length ? '태그 추가' : '태그를 입력하고 Enter'}
              className="min-w-24 flex-1 bg-transparent px-1 py-1 text-xs text-on-surface outline-none placeholder:text-outline"
            />
          </div>
        </div>

        <label className="block text-xs font-semibold text-on-surface">
          한글 3줄 요약
          <textarea
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
              queueUpdate({ summaryKo: event.target.value });
            }}
            placeholder="AI 분석 후에도 직접 고쳐 쓸 수 있습니다."
            className="mt-1.5 min-h-28 w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-sm font-normal leading-6 text-on-surface outline-none transition-colors focus:border-outline"
          />
        </label>

        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-on-surface">개인 Markdown 노트</div>
            <div className="flex items-center gap-1 rounded-lg bg-surface-container p-0.5">
              <button
                type="button"
                onClick={() => setNoteMode('edit')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] ${noteMode === 'edit' ? 'bg-surface-container-lowest font-semibold text-on-surface shadow-sm' : 'text-outline'}`}
              >
                <Pencil size={10} /> 편집
              </button>
              <button
                type="button"
                onClick={() => setNoteMode('preview')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] ${noteMode === 'preview' ? 'bg-surface-container-lowest font-semibold text-on-surface shadow-sm' : 'text-outline'}`}
              >
                <Eye size={10} /> 미리보기
              </button>
            </div>
          </div>
          {noteMode === 'edit' ? (
            <textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                queueUpdate({ noteMarkdown: event.target.value });
              }}
              placeholder="# 개인 노트\n\n읽으면서 떠오른 생각을 적어 보세요."
              className="mt-1.5 min-h-44 w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 font-mono text-sm font-normal leading-6 text-on-surface outline-none transition-colors focus:border-outline"
            />
          ) : (
            <div className="mt-1.5 min-h-44 whitespace-pre-wrap rounded-lg border border-outline-variant/20 bg-surface px-3 py-2 font-mono text-xs leading-6 text-on-surface-variant">
              {note.trim() || '아직 개인 노트가 없습니다.'}
            </div>
          )}
        </div>

        {metadata.translations.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-on-surface">저장된 번역</h3>
              <span className="text-[10px] text-outline">{metadata.translations.length}개</span>
            </div>
            <div className="space-y-2">
              {metadata.translations.map((translation) => (
                <div key={translation.id} className="rounded-lg border border-outline-variant/20 bg-surface px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{translation.title}</span>
                    <span className="shrink-0 text-[10px] text-outline">
                      {new Date(translation.createdAt).toLocaleDateString('ko-KR')}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewTranslation((current) => current?.id === translation.id ? null : translation)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high"
                    >
                      <Eye size={11} /> 미리보기
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadTranslation(translation)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high"
                    >
                      <Download size={11} /> 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTranslation(translation.id)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-error hover:bg-error-container/20"
                    >
                      <Trash2 size={11} /> 삭제
                    </button>
                  </div>
                  {previewTranslation?.id === translation.id && (
                    <div className="mt-2 max-h-56 overflow-auto rounded-md bg-surface-container px-3 py-2">
                      <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-on-surface">
                        {translation.bilingualMarkdown}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/15 pt-3 text-[10px] text-outline">
          <span>{metadata.analysisModel ? `분석 모델: ${metadata.analysisModel}` : '아직 AI 분석하지 않음'}</span>
          <span className={`inline-flex items-center gap-1 ${saveState === 'error' ? 'text-error' : 'text-on-surface-variant'}`}>
            {saveState === 'saving' && <Loader2 size={10} className="animate-spin" />}
            {saveState === 'saved' && <Save size={10} />}
            {saveLabel}
            {saveState === 'error' && (
              <button type="button" onClick={() => void flushPending()} className="ml-1 underline underline-offset-2">
                재시도
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function ScaleInput({
  label,
  value,
  variant,
  onChange,
}: {
  label: string;
  value: number;
  variant: 'rating' | 'importance';
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-on-surface">{label}</div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            type="button"
            key={score}
            onClick={() => onChange(score === value ? 0 : score)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-container ${
              score <= value
                ? variant === 'rating' ? 'text-tertiary-fixed' : 'text-primary'
                : 'text-outline-variant'
            }`}
            title={`${score}점`}
            aria-label={`${label} ${score}점`}
          >
            {variant === 'rating' ? (
              <Star size={17} fill={score <= value ? 'currentColor' : 'none'} />
            ) : (
              <span className={`h-3 w-3 rounded-sm ${score <= value ? 'bg-current' : 'border border-current'}`} />
            )}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-outline">{value ? `${value}/5` : '미지정'}</span>
      </div>
    </div>
  );
}
