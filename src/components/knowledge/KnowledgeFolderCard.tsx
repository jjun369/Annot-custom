'use client';

import { AlertTriangle, CheckCircle2, FolderOpen, FolderSync, Loader2, Unplug } from 'lucide-react';

import type { PendingKnowledgeFile } from '@/lib/knowledge-folder';

interface KnowledgeFolderCardProps {
  directory: string | null;
  available: boolean;
  lastScanAt?: string;
  pending: PendingKnowledgeFile[];
  busy: boolean;
  onChoose: () => void;
  onScan: () => void;
  onDisconnect: () => void;
  onPreview: (file: PendingKnowledgeFile) => void;
}

function folderLabel(directory: string | null): string {
  if (!directory) return '연결된 폴더가 없습니다.';
  if (directory.length <= 48) return directory;
  return `…${directory.slice(-45)}`;
}

export function KnowledgeFolderCard({ directory, available, lastScanAt, pending, busy, onChoose, onScan, onDisconnect, onPreview }: KnowledgeFolderCardProps) {
  return (
    <section className="mt-4 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex items-start gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-container text-primary"><FolderSync size={16} /></div><div className="min-w-0 flex-1"><h2 className="text-sm font-bold">메모 폴더</h2><p className="mt-1 break-all text-[11px] leading-5 text-on-surface-variant">{folderLabel(directory)}</p></div>{directory && <span className={`mt-1 flex shrink-0 items-center gap-1 text-[10px] font-bold ${available ? 'text-emerald-700' : 'text-amber-800'}`}>{available ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{available ? '연결됨' : '확인 필요'}</span>}</div>
      <p className="mt-3 text-[11px] leading-5 text-on-surface-variant">하위 폴더의 txt·md 파일을 확인합니다. 원본은 건드리지 않고, 작은 새 메모만 수집함에 넣습니다.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onChoose} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-on-primary disabled:opacity-40"><FolderOpen size={13} />{directory ? '폴더 변경' : '폴더 연결'}</button>{directory && <><button type="button" onClick={onScan} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-[10px] font-bold text-on-surface-variant disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin" /> : <FolderSync size={13} />}새 메모 확인</button><button type="button" onClick={onDisconnect} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold text-outline hover:bg-surface-container disabled:opacity-40"><Unplug size={13} />연결 해제</button></>}</div>
      {lastScanAt && <p className="mt-2 text-[10px] text-outline">마지막 확인: {new Date(lastScanAt).toLocaleString('ko-KR')}</p>}
      {pending.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900"><AlertTriangle size={13} />긴 메모 {pending.length}개를 확인해 주세요.</div><div className="mt-2 space-y-1.5">{pending.slice(0, 5).map((file) => <button key={file.relativePath} type="button" onClick={() => onPreview(file)} disabled={busy} className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-2 text-left text-[10px] text-amber-950 hover:bg-white disabled:opacity-50"><span className="min-w-0 truncate">{file.relativePath}</span><span className="shrink-0">{file.suggestedSegments}개로 보기</span></button>)}{pending.length > 5 && <p className="pt-1 text-[10px] text-amber-800">나머지 {pending.length - 5}개도 순서대로 확인할 수 있습니다.</p>}</div></div>}
    </section>
  );
}
