'use client';

import { useState } from 'react';
import { AlertTriangle, BookOpenText, Check, X } from 'lucide-react';

import type { KnowledgeConflict, KnowledgeNote, KnowledgeTopic } from '@/lib/knowledge-store';

interface KnowledgeConflictCardProps {
  conflict: KnowledgeConflict;
  note?: KnowledgeNote;
  topic?: KnowledgeTopic;
  onOpenTopic: (topicId: string) => void;
  onResolve: (conflictId: string, status: 'resolved' | 'dismissed', resolutionNote: string) => Promise<void>;
}

export function KnowledgeConflictCard({
  conflict,
  note,
  topic,
  onOpenTopic,
  onResolve,
}: KnowledgeConflictCardProps) {
  const [resolutionNote, setResolutionNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function resolve(status: 'resolved' | 'dismissed'): Promise<void> {
    setBusy(true);
    try {
      await onResolve(conflict.id, status, resolutionNote);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-amber-300 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-800">{topic?.title ?? '연결 문서 없음'}</span>
          <h3 className="mt-2 text-base font-bold">{conflict.title}</h3>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">{conflict.summary}</p>
        </div>
        {topic && <button onClick={() => onOpenTopic(topic.id)} className="flex items-center gap-1 rounded-lg bg-surface-container px-3 py-2 text-[10px] font-bold text-on-surface-variant"><BookOpenText size={12} />위키 열기</button>}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl bg-amber-50 p-4"><div className="flex items-center gap-1 text-[10px] font-bold text-amber-800"><AlertTriangle size={12} />충돌 주장</div><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">{conflict.sourceClaims.map((claim) => <li key={claim}>{claim}</li>)}</ul></div>
        <div className="rounded-xl bg-surface-container-low p-4"><div className="text-[10px] font-bold text-outline">원본 · {note?.sourceName}</div><p className="mt-2 whitespace-pre-wrap text-xs leading-5">{note?.rawText}</p></div>
      </div>
      <label className="mt-4 block text-[10px] font-bold text-on-surface-variant">해결 메모<textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="예: Node 20과 Node 24의 조건 차이로 판단함" className="mt-1 h-20 w-full resize-y rounded-xl border border-outline-variant/30 px-3 py-2 text-xs leading-5 outline-none focus:border-primary" /></label>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button onClick={() => void resolve('dismissed')} disabled={busy} className="flex items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-40"><X size={12} />관련 없음</button>
        <button onClick={() => void resolve('resolved')} disabled={busy || !resolutionNote.trim()} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-on-primary disabled:opacity-40"><Check size={12} />메모와 함께 해결</button>
      </div>
    </article>
  );
}
