'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Edit3, Loader2, Save, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { diffKnowledgeLines } from '@/lib/knowledge-diff';
import type { KnowledgeNote, KnowledgeReview, KnowledgeTopic } from '@/lib/knowledge-store';

interface KnowledgeReviewCardProps {
  review: KnowledgeReview;
  note?: KnowledgeNote;
  topic?: KnowledgeTopic;
  busy: boolean;
  onSave: (reviewId: string, update: {
    title: string;
    proposedSummary: string;
    proposedBodyMarkdown: string;
  }) => Promise<void>;
  onResolve: (reviewId: string, decision: 'accept' | 'reject') => Promise<void>;
}

export function KnowledgeReviewCard({ review, note, topic, busy, onSave, onResolve }: KnowledgeReviewCardProps) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(review.title);
  const [summary, setSummary] = useState(review.proposedSummary);
  const [body, setBody] = useState(review.proposedBodyMarkdown);
  const [preview, setPreview] = useState(false);
  const diff = useMemo(
    () => expanded ? diffKnowledgeLines(topic?.bodyMarkdown ?? '', body) : [],
    [body, expanded, topic?.bodyMarkdown],
  );
  const conflict = review.kind === 'conflict';

  async function save(): Promise<void> {
    await onSave(review.id, { title, proposedSummary: summary, proposedBodyMarkdown: body });
    setEditing(false);
  }

  return (
    <article className={`rounded-2xl border bg-surface-container-lowest p-5 ${conflict ? 'border-amber-300' : 'border-outline-variant/25'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${review.kind === 'create' ? 'bg-blue-100 text-blue-800' : conflict ? 'bg-amber-100 text-amber-800' : 'bg-primary-container text-primary'}`}>
              {review.kind === 'create' ? '새 문서' : conflict ? '충돌 등록' : '문서 갱신'}
            </span>
            {topic && <span className="text-[10px] text-outline">기준 r{review.baseRevision} · 현재 r{topic.revision}</span>}
            {topic && review.baseRevision !== topic.revision && !conflict && <span className="rounded bg-red-50 px-2 py-1 text-[9px] font-bold text-error">재분석 필요</span>}
          </div>
          {editing ? (
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-3 w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm font-bold outline-none focus:border-primary" />
          ) : <h3 className="mt-2 text-base font-bold">{review.title}</h3>}
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">{review.rationale}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setExpanded(true); setEditing((value) => !value); }} disabled={busy} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-bold text-on-surface-variant hover:bg-surface-container"><Edit3 size={13} />{editing ? '닫기' : '수정'}</button>
          <button onClick={() => void onResolve(review.id, 'reject')} disabled={busy} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-bold text-on-surface-variant hover:bg-surface-container"><X size={13} />보류</button>
          <button onClick={() => void onResolve(review.id, 'accept')} disabled={busy || !expanded || (!!topic && !conflict && review.baseRevision !== topic.revision)} title={expanded ? undefined : '변경 내용을 먼저 확인해 주세요'} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-on-primary disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{conflict ? '충돌함에 등록' : '반영'}</button>
        </div>
      </div>

      {review.conflictSummary && <div className="mt-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-900"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{review.conflictSummary}</div>}
      {!!review.contextWarnings.length && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900"><div className="flex items-center gap-2 font-bold"><AlertTriangle size={14} />AI에 전달된 문맥 안내</div><ul className="mt-1 list-disc pl-5">{review.contextWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}

      {!editing && !expanded && <button onClick={() => setExpanded(true)} className="mt-4 w-full rounded-xl border border-outline-variant/30 bg-surface-container-low py-3 text-xs font-bold text-primary">원본과 변경 내용 확인</button>}

      {editing ? (
        <div className="mt-4 space-y-3 rounded-xl border border-primary/20 bg-primary-container/20 p-4">
          <label className="block text-[10px] font-bold text-on-surface-variant">요약<textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="mt-1 h-20 w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-primary" /></label>
          <label className="block text-[10px] font-bold text-on-surface-variant">Markdown 본문<textarea value={body} onChange={(event) => setBody(event.target.value)} className="mt-1 h-72 w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-primary" /></label>
          <button onClick={() => void save()} disabled={busy || !body.trim()} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-on-primary disabled:opacity-40"><Save size={13} />수정안 저장</button>
        </div>
      ) : expanded ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-xl bg-surface-container-low p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-outline">원본 · {note?.sourceName}</div><p className="mt-2 whitespace-pre-wrap text-xs leading-6">{note?.rawText}</p></div>
          <div className="rounded-xl border border-outline-variant/25 bg-[#fbfcfd] p-4"><div className="flex items-center justify-between gap-3"><div className="text-[10px] font-bold uppercase tracking-wider text-primary">{preview ? '결과 미리보기' : '변경 내용'}</div><div className="flex rounded-lg bg-surface-container p-0.5 text-[9px] font-bold"><button onClick={() => setPreview(false)} className={`rounded-md px-2 py-1 ${!preview ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}>변경 비교</button><button onClick={() => setPreview(true)} className={`rounded-md px-2 py-1 ${preview ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant'}`}>Markdown 미리보기</button></div></div>{preview ? <div className="prose prose-sm mt-3 max-h-[32rem] max-w-none overflow-y-auto text-xs leading-6"><ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown></div> : <pre className="mt-2 max-h-[32rem] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-5">{diff.map((line, index) => <span key={`${index}-${line.kind}`} className={`block px-1 ${line.kind === 'added' ? 'bg-emerald-50 text-emerald-800' : line.kind === 'removed' ? 'bg-red-50 text-red-700 line-through' : line.kind === 'omitted' ? 'my-1 rounded bg-surface-container px-2 py-1 text-center italic text-outline' : 'text-on-surface-variant'}`}>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : line.kind === 'omitted' ? '' : '  '}{line.text || ' '}</span>)}</pre>}</div>
        </div>
      ) : null}
    </article>
  );
}
