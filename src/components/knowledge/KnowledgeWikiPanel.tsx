'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Edit3,
  History,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  KnowledgeNote,
  KnowledgeProvenanceKind,
  KnowledgeRevisionTrashItem,
  KnowledgeTopic,
} from '@/lib/knowledge-store';

interface KnowledgeWikiPanelProps {
  topic: KnowledgeTopic;
  notes: KnowledgeNote[];
  openConflictCount: number;
  trashItems: KnowledgeRevisionTrashItem[];
  dateLabel: (value: string) => string;
  onOpenConflicts: () => void;
  onEdit: (update: { title: string; summary: string; bodyMarkdown: string; changeNote: string }) => Promise<void>;
  onRestore: (revision: number) => Promise<void>;
  onTrash: (revision: number) => Promise<void>;
  onRestoreTrash: (trashId: string) => Promise<void>;
  onDeleteTrash: (trashId: string) => Promise<void>;
  onRequestReview: () => Promise<void>;
  onCompleteReview: () => Promise<void>;
}

const PROVENANCE_LABELS: Record<KnowledgeProvenanceKind, string> = {
  literature_claim: '문헌 주장',
  work_observation: '업무 관찰',
  personal_hypothesis: '개인 가설',
  ai_inference: 'AI 추론',
};

function provenanceLabel(kind: KnowledgeProvenanceKind | undefined): string {
  return kind ? PROVENANCE_LABELS[kind] : '유형 미지정 · 기존 지식';
}

function anchorLabel(note: KnowledgeNote): string | null {
  const anchor = note.sourceAnchors?.[0];
  if (!anchor?.page) return null;
  return `p.${anchor.page} · ${anchor.scope === 'selection' ? '선택 영역' : anchor.scope === 'page' ? '현재 페이지' : '현재 PDF'}`;
}

export function KnowledgeWikiPanel({
  topic,
  notes,
  openConflictCount,
  trashItems,
  dateLabel,
  onOpenConflicts,
  onEdit,
  onRestore,
  onTrash,
  onRestoreTrash,
  onDeleteTrash,
  onRequestReview,
  onCompleteReview,
}: KnowledgeWikiPanelProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [summary, setSummary] = useState(topic.summary);
  const [bodyMarkdown, setBodyMarkdown] = useState(topic.bodyMarkdown);
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewRequested = Boolean(topic.trust?.reviewRequestedAt);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await onEdit({ title, summary, bodyMarkdown, changeNote });
      setEditing(false);
      setChangeNote('');
    } finally {
      setBusy(false);
    }
  }

  async function requestReview(): Promise<void> {
    setReviewBusy(true);
    try {
      await onRequestReview();
    } finally {
      setReviewBusy(false);
    }
  }

  async function completeReview(): Promise<void> {
    setReviewBusy(true);
    try {
      await onCompleteReview();
    } finally {
      setReviewBusy(false);
    }
  }

  if (editing) {
    return (
      <article className="rounded-2xl border border-outline-variant/25 bg-white p-6 lg:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">위키 직접 수정</h2>
          <button onClick={() => setEditing(false)} disabled={busy} aria-label="위키 편집 닫기" className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container"><X size={15} /></button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-[10px] font-bold text-on-surface-variant">제목<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm font-bold outline-none focus:border-primary" /></label>
          <label className="block text-[10px] font-bold text-on-surface-variant">요약<textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="mt-1 h-20 w-full resize-y rounded-lg border border-outline-variant/40 px-3 py-2 text-xs leading-5 outline-none focus:border-primary" /></label>
          <label className="block text-[10px] font-bold text-on-surface-variant">Markdown 본문<textarea value={bodyMarkdown} onChange={(event) => setBodyMarkdown(event.target.value)} className="mt-1 h-[28rem] w-full resize-y rounded-lg border border-outline-variant/40 px-3 py-2 font-mono text-xs leading-6 outline-none focus:border-primary" /></label>
          <label className="block text-[10px] font-bold text-on-surface-variant">변경 메모 (선택)<input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="예: 오타 수정, Node 24 조건 추가" className="mt-1 w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-xs outline-none focus:border-primary" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setEditing(false)} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-bold text-on-surface-variant">취소</button>
          <button onClick={() => void save()} disabled={busy || !title.trim() || !bodyMarkdown.trim()} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-40"><Save size={13} />새 revision으로 저장</button>
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-outline-variant/25 bg-white p-6 lg:p-8">
      <header className="border-b border-outline-variant/20 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-outline"><BookOpenText size={12} />정리된 노트 · Rev.{topic.revision} · {dateLabel(topic.updatedAt)}<span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${reviewRequested ? 'bg-study-unclear-container text-study-unclear' : 'bg-study-resolved-container text-study-resolved'}`}>{reviewRequested ? <AlertTriangle size={10} aria-hidden="true" /> : <CheckCircle2 size={10} aria-hidden="true" />}{reviewRequested ? '다시 볼 때' : '내가 확인함'}</span></div>
            <h2 className="mt-2 text-2xl font-bold">{topic.title}</h2>
          </div>
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg bg-primary-container px-3 py-2 text-[10px] font-bold text-primary"><Edit3 size={12} />직접 수정</button>
        </div>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">{topic.summary}</p>
        {openConflictCount > 0 && <button onClick={onOpenConflicts} className="mt-3 flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800"><AlertTriangle size={12} />미해결 충돌 {openConflictCount}개</button>}
      </header>

      <section className="mt-4 rounded-xl bg-surface-container-low p-3" aria-label="지식 출처와 내가 확인한 상태">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full border border-outline-variant/25 bg-white px-2 py-1 text-[10px] font-bold text-on-surface-variant">{provenanceLabel(topic.provenance?.kind)}</span>
          {reviewRequested ? (
            <button type="button" onClick={() => void completeReview()} disabled={reviewBusy} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-bold text-on-primary disabled:opacity-50"><CheckCircle2 size={11} />다시 확인함</button>
          ) : (
            <button type="button" onClick={() => void requestReview()} disabled={reviewBusy} className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/30 bg-white px-2.5 py-1.5 text-[10px] font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"><Clock3 size={11} />다시 볼 표시</button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-on-surface-variant">
          {topic.provenance?.originDate && <span>원본 날짜 {topic.provenance.originDate}</span>}
          <span>수집일 {dateLabel(topic.createdAt)}</span>
          {topic.trust?.lastReviewedAt && <span>내가 검토함 · {dateLabel(topic.trust.lastReviewedAt)}</span>}
        </div>
        {reviewRequested && <p className="mt-2 text-[10px] leading-4 text-on-surface-variant">나중에 다시 볼 표시입니다. 본문과 revision은 바뀌지 않으며, 다시 확인한 시점만 기록합니다.</p>}
      </section>

      <div className="chat-markdown selectable-text mt-6 text-sm leading-7"><ReactMarkdown remarkPlugins={[remarkGfm]}>{topic.bodyMarkdown}</ReactMarkdown></div>

      <details className="mt-8 rounded-xl bg-surface-container-low p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-bold"><History size={13} />Revision 이력 {topic.revisions.length}개</summary>
        <div className="mt-3 space-y-2">
          {[...topic.revisions].reverse().map((revision) => (
            <div key={revision.revision} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-[10px]">
              <span>r{revision.revision} · {dateLabel(revision.createdAt)}{revision.editedBy === 'user' ? ' · 직접 수정' : ''}{revision.restoredFromRevision ? ` · r${revision.restoredFromRevision} 복원` : ''}{revision.changeNote ? ` · ${revision.changeNote}` : ''}</span>
              {revision.revision !== topic.revision && <span className="flex gap-2"><button onClick={() => void onRestore(revision.revision)} className="flex items-center gap-1 font-bold text-primary"><RotateCcw size={11} />복원</button><button onClick={() => void onTrash(revision.revision)} className="flex items-center gap-1 font-bold text-error"><Trash2 size={11} />휴지통</button></span>}
            </div>
          ))}
        </div>
      </details>

      {trashItems.length > 0 && <details className="mt-3 rounded-xl border border-outline-variant/25 p-4"><summary className="flex cursor-pointer items-center gap-2 text-xs font-bold"><Trash2 size={13} />Revision 휴지통 {trashItems.length}개</summary><div className="mt-3 space-y-2">{trashItems.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-[10px]"><span>r{item.revision.revision} · {dateLabel(item.deletedAt)} · {(item.sizeBytes / 1024).toFixed(1)}KB</span><span className="flex gap-2"><button onClick={() => void onRestoreTrash(item.id)} className="font-bold text-primary">되돌리기</button><button onClick={() => void onDeleteTrash(item.id)} className="font-bold text-error">영구 삭제</button></span></div>)}</div></details>}

      <details className="mt-3 rounded-xl bg-surface-container-low p-4">
        <summary className="cursor-pointer text-xs font-bold">근거 원본 {topic.sourceNoteIds.length}개</summary>
        <div className="mt-3 space-y-3">
          {topic.sourceNoteIds.map((id) => {
            const note = notes.find((item) => item.id === id);
            if (!note) return null;
            const anchor = anchorLabel(note);
            return <div key={id} className="rounded-lg bg-white p-3"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-outline"><span>{note.sourceName} · {dateLabel(note.createdAt)}</span><span className="font-semibold text-on-surface-variant">{provenanceLabel(note.provenance?.kind)}</span>{note.provenance?.originDate && <span>원본 날짜 {note.provenance.originDate}</span>}{anchor && <span>{anchor}</span>}</div><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5">{note.rawText}</p></div>;
          })}
        </div>
      </details>
    </article>
  );
}
