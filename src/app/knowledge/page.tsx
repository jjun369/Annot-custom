'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpenText,
  Check,
  FileInput,
  Inbox,
  Loader2,
  Merge,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Upload,
  X,
} from 'lucide-react';

import { KnowledgeConflictCard } from '@/components/knowledge/KnowledgeConflictCard';
import { KnowledgeReviewCard } from '@/components/knowledge/KnowledgeReviewCard';
import { KnowledgeWikiPanel } from '@/components/knowledge/KnowledgeWikiPanel';
import { AppHeader } from '@/components/layout/AppHeader';
import type { CodexSetupStatus } from '@/lib/codex-setup';
import { isKnowledgeChatGptOAuth } from '@/lib/knowledge-auth';
import type {
  CaptureKnowledgeResult,
  KnowledgeConflict,
  KnowledgeRevisionTrashItem,
  KnowledgeSnapshot,
  KnowledgeStoreInfo,
  KnowledgeTopic,
} from '@/lib/knowledge-store';

type View = 'inbox' | 'review' | 'conflicts' | 'wiki';
type KnowledgePagePayload = KnowledgeSnapshot & { storeInfo: KnowledgeStoreInfo };

const EMPTY: KnowledgeSnapshot = { version: 2, notes: [], topics: [], reviews: [], conflicts: [] };
const EMPTY_STORE_INFO: KnowledgeStoreInfo = { activeBytes: 0, revisionTrashBytes: 0, revisionTrashCount: 0 };
const DRAFT_KEY = 'pagedock-knowledge-draft';
const PAGE_SIZE = 20;

class KnowledgeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'KnowledgeApiError';
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new KnowledgeApiError(body.error || '요청을 처리하지 못했습니다.', response.status);
  return body;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function KnowledgePage() {
  const [data, setData] = useState<KnowledgeSnapshot>(EMPTY);
  const [view, setView] = useState<View>('inbox');
  const [noteText, setNoteText] = useState('');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexSetupStatus | null>(null);
  const [authCheckError, setAuthCheckError] = useState('');
  const [storeInfo, setStoreInfo] = useState<KnowledgeStoreInfo>(EMPTY_STORE_INFO);
  const [revisionTrash, setRevisionTrash] = useState<KnowledgeRevisionTrashItem[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [topicSearch, setTopicSearch] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [inboxVisible, setInboxVisible] = useState(PAGE_SIZE);
  const [reviewVisible, setReviewVisible] = useState(PAGE_SIZE);
  const [topicVisible, setTopicVisible] = useState(50);
  const stopBatch = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const draftLoaded = useRef(false);

  const refresh = useCallback(async () => {
    const snapshot = await responseJson<KnowledgePagePayload>(await fetch('/api/knowledge', { cache: 'no-store' }));
    setData(snapshot);
    setStoreInfo(snapshot.storeInfo);
    setSelectedTopicId((current) => current && snapshot.topics.some((topic) => topic.id === current)
      ? current
      : snapshot.topics[0]?.id ?? null);
  }, []);

  const refreshCodex = useCallback(async () => {
    try {
      const status = await responseJson<CodexSetupStatus>(await fetch('/api/knowledge/auth', { cache: 'no-store' }));
      setCodexStatus(status);
      setAuthCheckError('');
    } catch (error) {
      setAuthCheckError(error instanceof Error ? error.message : '로그인 상태를 확인하지 못했습니다.');
    }
  }, []);

  const refreshRevisionTrash = useCallback(async () => {
    const result = await responseJson<{ items: KnowledgeRevisionTrashItem[] }>(await fetch('/api/knowledge/revision-trash', { cache: 'no-store' }));
    setRevisionTrash(result.items);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setMessage({ text: error.message, error: true }));
    void refreshCodex();
    const draft = window.localStorage.getItem(DRAFT_KEY);
    if (draft) setNoteText(draft);
    draftLoaded.current = true;
  }, [refresh, refreshCodex]);

  useEffect(() => {
    if (!draftLoaded.current) return;
    const timer = window.setTimeout(() => {
      if (noteText) window.localStorage.setItem(DRAFT_KEY, noteText);
      else window.localStorage.removeItem(DRAFT_KEY);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [noteText]);

  useEffect(() => {
    if (view === 'wiki') void refreshRevisionTrash().catch(() => undefined);
  }, [refreshRevisionTrash, view]);

  const oauthReady = isKnowledgeChatGptOAuth(codexStatus);
  const authNeedsAttention = Boolean(authCheckError);
  const inboxNotes = useMemo(() => data.notes.filter((note) => note.status === 'inbox' || note.status === 'error'), [data.notes]);
  const pendingReviews = useMemo(() => data.reviews.filter((review) => review.status === 'pending'), [data.reviews]);
  const openConflicts = useMemo(() => data.conflicts.filter((conflict) => conflict.status === 'open'), [data.conflicts]);
  const selectedTopic = data.topics.find((topic) => topic.id === selectedTopicId) ?? null;
  const filteredTopics = useMemo(() => {
    const query = topicSearch.trim().toLocaleLowerCase('ko');
    if (!query) return data.topics;
    return data.topics.filter((topic) => `${topic.title}\n${topic.summary}\n${topic.bodyMarkdown}`.toLocaleLowerCase('ko').includes(query));
  }, [data.topics, topicSearch]);
  const visibleInboxNotes = inboxNotes.slice(0, inboxVisible);
  const visibleReviews = pendingReviews.slice(0, reviewVisible);
  const visibleTopics = filteredTopics.slice(0, topicVisible);

  async function captureInputs(notes: Array<{ text: string; sourceName: string }>): Promise<boolean> {
    setCaptureBusy(true);
    setMessage(null);
    try {
      const result = await responseJson<CaptureKnowledgeResult>(await fetch('/api/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }),
      }));
      await refresh();
      setMessage({
        text: `${result.captured.length}개 메모를 수집했습니다.${result.duplicates.length ? ` 중복 ${result.duplicates.length}개는 건너뛰었습니다.` : ''}`,
      });
      return true;
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : '메모를 저장하지 못했습니다.', error: true });
      return false;
    } finally {
      setCaptureBusy(false);
    }
  }

  async function captureText(): Promise<void> {
    if (!noteText.trim()) return;
    const captured = await captureInputs([{ text: noteText, sourceName: '직접 입력' }]);
    if (captured) {
      setNoteText('');
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }

  async function captureFiles(files: FileList | File[]): Promise<void> {
    const candidates = Array.from(files).filter((file) => /\.(?:txt|md|markdown)$/i.test(file.name));
    if (!candidates.length) {
      setMessage({ text: '현재는 .txt, .md, .markdown 파일을 가져올 수 있습니다.', error: true });
      return;
    }
    const tooLarge = candidates.find((file) => file.size > 500_000);
    if (tooLarge) {
      setMessage({ text: `${tooLarge.name} 파일이 너무 큽니다. 파일 하나는 500KB 이하로 나눠 주세요.`, error: true });
      return;
    }
    const notes = await Promise.all(candidates.map(async (file) => ({ text: await file.text(), sourceName: file.name })));
    const oversizedText = notes.find((note) => note.text.length > 100_000);
    if (oversizedText) {
      setMessage({ text: `${oversizedText.sourceName} 내용이 100,000자를 넘습니다. 여러 파일로 나눠 주세요.`, error: true });
      return;
    }
    await captureInputs(notes);
  }

  async function loginCodex(): Promise<void> {
    setLoginBusy(true);
    setMessage({ text: '브라우저에서 ChatGPT OAuth 로그인을 완료해 주세요.' });
    try {
      const status = await responseJson<CodexSetupStatus>(await fetch('/api/runtime/codex', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login' }),
      }));
      setCodexStatus(status);
      setAuthCheckError('');
      setMessage(status.authMethod === 'ChatGPT'
        ? { text: 'ChatGPT OAuth가 연결됐습니다.' }
        : { text: '로그인은 됐지만 ChatGPT OAuth가 아닙니다. API key 인증은 지식 정리에 사용할 수 없습니다.', error: true });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Codex 로그인에 실패했습니다.', error: true });
    } finally {
      setLoginBusy(false);
    }
  }

  async function processOne(noteId: string, navigate = true): Promise<boolean> {
    if (!oauthReady) {
      setMessage({ text: 'ChatGPT OAuth 로그인이 필요합니다. API key 인증은 사용할 수 없습니다.', error: true });
      return false;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    setProcessingId(noteId);
    try {
      await responseJson(await fetch('/api/knowledge/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
        signal: controller.signal,
      }));
      setAuthCheckError('');
      await refresh();
      if (navigate) {
        setView('review');
        setMessage({ text: '변경안이 준비됐습니다. 차이를 확인한 뒤 반영하세요.' });
      }
      return true;
    } catch (error) {
      await refresh();
      if (error instanceof KnowledgeApiError && error.status === 401) {
        setAuthCheckError('AI 실행 전에 ChatGPT OAuth 연결을 다시 확인해 주세요. 자동으로 로그아웃하지는 않았습니다.');
      }
      setMessage(error instanceof Error && error.name === 'AbortError'
        ? { text: '현재 AI 정리를 취소했습니다. 원본 메모는 수집함에 그대로 남습니다.' }
        : { text: error instanceof Error ? error.message : '분석하지 못했습니다.', error: true });
      return false;
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setProcessingId(null);
    }
  }

  function cancelCurrent(): void {
    stopBatch.current = true;
    activeRequest.current?.abort();
  }

  async function processBatch(notes: typeof inboxNotes): Promise<void> {
    if (!oauthReady || !notes.length) return;
    stopBatch.current = false;
    setBatchProgress({ done: 0, total: notes.length });
    let completed = 0;
    let failed = false;
    for (const note of notes) {
      if (stopBatch.current) break;
      const success = await processOne(note.id, false);
      if (!success) {
        failed = true;
        break;
      }
      completed += 1;
      setBatchProgress({ done: completed, total: notes.length });
    }
    setBatchProgress(null);
    await refresh();
    setView('review');
    setMessage(failed && !stopBatch.current
      ? { text: `${completed}개 처리 후 오류가 발생해 안전하게 중지했습니다. 실패한 메모를 확인한 뒤 다시 시작해 주세요.`, error: true }
      : { text: stopBatch.current ? `${completed}개 처리 후 중지했습니다.` : `${completed}개 메모의 변경안 생성을 마쳤습니다.` });
  }

  async function processEverything(): Promise<void> {
    if (inboxNotes.length > 20 && !window.confirm(`${inboxNotes.length}개 메모를 모두 순서대로 정리할까요? 오류가 발생하면 그 자리에서 중지합니다.`)) return;
    await processBatch(inboxNotes);
  }

  async function saveReview(reviewId: string, update: { title: string; proposedSummary: string; proposedBodyMarkdown: string }): Promise<void> {
    setReviewBusyId(reviewId);
    try {
      await responseJson(await fetch('/api/knowledge/reviews', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId, update }),
      }));
      await refresh();
      setMessage({ text: '수정한 변경안을 저장했습니다.' });
    } finally {
      setReviewBusyId(null);
    }
  }

  async function resolveReview(reviewId: string, decision: 'accept' | 'reject'): Promise<void> {
    setReviewBusyId(reviewId);
    try {
      const result = await responseJson<{ topic?: KnowledgeTopic; conflict?: KnowledgeConflict }>(await fetch('/api/knowledge/reviews', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId, decision }),
      }));
      await refresh();
      if (result.topic) setSelectedTopicId(result.topic.id);
      if (result.conflict) setView('conflicts');
      setMessage({ text: result.conflict ? '현재 위키는 바꾸지 않고 충돌함에 등록했습니다.' : decision === 'accept' ? '변경안을 위키에 반영했습니다.' : '변경안을 보류했습니다.' });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : '변경안을 처리하지 못했습니다.', error: true });
    } finally {
      setReviewBusyId(null);
    }
  }

  async function closeConflict(
    conflictId: string,
    status: 'resolved' | 'dismissed',
    resolutionNote: string,
  ): Promise<void> {
    await responseJson(await fetch('/api/knowledge/conflicts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conflictId, status, resolutionNote }),
    }));
    await refresh();
    setMessage({ text: status === 'resolved' ? '충돌을 해결됨으로 표시했습니다.' : '관련 없는 충돌로 보관했습니다.' });
  }

  async function restoreRevision(topic: KnowledgeTopic, revision: number): Promise<void> {
    if (!window.confirm(`'${topic.title}' 문서를 revision ${revision} 내용으로 복원할까요? 현재 상태도 이력에 남습니다.`)) return;
    const result = await responseJson<{ topic: KnowledgeTopic }>(await fetch('/api/knowledge/topics', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId: topic.id, revision }),
    }));
    await refresh();
    setSelectedTopicId(result.topic.id);
    setMessage({ text: `revision ${revision}의 내용으로 새 revision ${result.topic.revision}을 만들었습니다.` });
  }

  async function editTopic(
    topic: KnowledgeTopic,
    update: { title: string; summary: string; bodyMarkdown: string; changeNote: string },
  ): Promise<void> {
    const result = await responseJson<{ topic: KnowledgeTopic }>(await fetch('/api/knowledge/topics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', topicId: topic.id, update }),
    }));
    await refresh();
    setSelectedTopicId(result.topic.id);
    setMessage({ text: `직접 수정 내용을 revision ${result.topic.revision}로 저장했습니다.` });
  }

  async function trashRevision(topic: KnowledgeTopic, revision: number): Promise<void> {
    if (!window.confirm(`'${topic.title}'의 revision ${revision}을 휴지통으로 옮길까요? 휴지통에서 다시 복원할 수 있습니다.`)) return;
    await responseJson(await fetch('/api/knowledge/revision-trash', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId: topic.id, revision }),
    }));
    await Promise.all([refresh(), refreshRevisionTrash()]);
    setMessage({ text: `revision ${revision}을 휴지통으로 옮겼습니다.` });
  }

  async function restoreTrashRevision(trashId: string): Promise<void> {
    await responseJson(await fetch('/api/knowledge/revision-trash', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashId }),
    }));
    await Promise.all([refresh(), refreshRevisionTrash()]);
    setMessage({ text: 'revision을 휴지통에서 되돌렸습니다.' });
  }

  async function deleteTrashRevision(trashId: string): Promise<void> {
    if (!window.confirm('이 revision을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    await responseJson(await fetch('/api/knowledge/revision-trash', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashId }),
    }));
    await Promise.all([refresh(), refreshRevisionTrash()]);
    setMessage({ text: 'revision을 영구 삭제했습니다.' });
  }

  function formatBytes(value: number): string {
    if (value < 1024) return `${value}B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${(value / 1024 / 1024).toFixed(1)}MB`;
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-on-surface">
      <AppHeader active="knowledge" />
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-outline-variant/25 bg-surface-container-lowest p-3">
          <div className="px-2 pb-3 pt-2"><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Personal knowledge</div><h1 className="mt-1 text-lg font-bold">지식 정리</h1><p className="mt-1 text-[11px] leading-5 text-on-surface-variant">메모는 던지고, 중요한 변경만 확인하세요.</p></div>
          <nav className="space-y-1">{([
            ['inbox', '수집함', Inbox, inboxNotes.length],
            ['review', '검토함', Merge, pendingReviews.length],
            ['conflicts', '충돌함', AlertTriangle, openConflicts.length],
            ['wiki', '위키', BookOpenText, data.topics.length],
          ] as const).map(([id, label, Icon, count]) => <button key={id} onClick={() => setView(id)} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${view === id ? 'bg-primary-container text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}><Icon size={15} /><span className="flex-1 text-left">{label}</span><span className="rounded-full bg-white px-2 py-0.5 text-[10px]">{count}</span></button>)}</nav>
          <div className={`mt-6 rounded-xl border p-3 text-[10px] leading-5 ${oauthReady && !authNeedsAttention ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            <div className="flex items-center gap-1.5 font-bold"><ShieldCheck size={13} />{authNeedsAttention ? '연결 확인 필요' : oauthReady ? 'ChatGPT OAuth 연결됨' : codexStatus?.authMethod === 'API key' ? 'API key 인증은 사용 불가' : 'ChatGPT OAuth 필요'}</div>
            <p className="mt-1">{authNeedsAttention ? authCheckError : 'API 키 과금은 사용하지 않습니다. 정리할 원문과 관련 후보 문서는 OpenAI 모델에 전달됩니다.'}</p>
            <div className="mt-2 grid gap-1.5"><button onClick={() => void refreshCodex()} className="w-full rounded-lg bg-white/70 px-3 py-2 font-bold">로그인 상태 확인</button>{!oauthReady && codexStatus?.installed && <button onClick={() => void loginCodex()} disabled={loginBusy} className="w-full rounded-lg bg-primary px-3 py-2 font-bold text-on-primary disabled:opacity-40">{loginBusy ? '로그인 기다리는 중…' : 'ChatGPT 다시 연결'}</button>}</div>
          </div>
          <div className="mt-3 rounded-xl bg-surface-container-low p-3 text-[10px] leading-5 text-on-surface-variant"><div className="font-bold">지식 저장소</div><div className="mt-1">활성 {formatBytes(storeInfo.activeBytes)} · revision 휴지통 {storeInfo.revisionTrashCount}개 ({formatBytes(storeInfo.revisionTrashBytes)})</div></div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-6xl p-6 lg:p-8">
          {message && <div className={`mb-5 flex items-center gap-2 rounded-xl px-4 py-3 text-xs ${message.error ? 'bg-red-50 text-error' : 'bg-primary-container text-primary'}`}>{message.error ? <AlertTriangle size={14} /> : <Check size={14} />}{message.text}<button onClick={() => setMessage(null)} className="ml-auto"><X size={13} /></button></div>}

          {view === 'inbox' && <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.75fr)]">
            <section><h2 className="text-xl font-bold">아무렇게나 적거나 파일을 던지세요</h2><p className="mt-1 text-xs text-on-surface-variant">원문은 그대로 보관하며 같은 내용은 두 번 수집하지 않습니다.</p>
              <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void captureFiles(event.dataTransfer.files); }} className="mt-4 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest p-4 shadow-sm">
                <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="기술 메모, 관찰, 질문, 실험 결과, 나중에 확인할 것…" className="h-48 w-full resize-y bg-transparent text-sm leading-7 outline-none placeholder:text-outline" maxLength={100_000} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/20 pt-3"><span className="text-[10px] text-outline">{noteText.length.toLocaleString()}자 · 입력 중인 초안은 이 PC에 자동 저장됩니다</span><div className="flex gap-2"><label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-surface-container px-3 py-2.5 text-xs font-bold"><Upload size={14} />파일 여러 개<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple className="hidden" onChange={(event) => { if (event.target.files) void captureFiles(event.target.files); event.target.value = ''; }} /></label><button onClick={() => void captureText()} disabled={!noteText.trim() || captureBusy} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-on-primary disabled:opacity-40">{captureBusy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}수집함에 넣기</button></div></div>
              </div>
            </section>
            <section><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-bold">정리 대기 {inboxNotes.length}개</h2>{batchProgress && <p className="mt-1 text-[10px] text-primary">{batchProgress.done}/{batchProgress.total} 처리 중 · 오류가 나면 자동 중지</p>}</div>{batchProgress ? <div className="flex gap-2"><button onClick={() => { stopBatch.current = true; }} className="rounded-lg bg-surface-container px-3 py-2 text-[10px] font-bold text-on-surface-variant">현재 작업 후 중지</button><button onClick={cancelCurrent} className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-[10px] font-bold text-error"><StopCircle size={13} />즉시 취소</button></div> : <div className="flex gap-2"><button onClick={() => void processBatch(inboxNotes.slice(0, 10))} disabled={!oauthReady || !inboxNotes.length || !!processingId} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[10px] font-bold text-on-primary disabled:opacity-40"><Sparkles size={13} />다음 10개</button>{inboxNotes.length > 10 && <button onClick={() => void processEverything()} disabled={!oauthReady || !!processingId} className="rounded-lg bg-surface-container px-3 py-2 text-[10px] font-bold text-on-surface-variant disabled:opacity-40">전체</button>}</div>}</div>
              <div className="mt-3 space-y-3">{visibleInboxNotes.map((note) => <article key={note.id} className="rounded-2xl border border-outline-variant/25 bg-surface-container-lowest p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-xs font-bold">{note.title}</h3><span className="mt-1 block text-[10px] text-outline">{note.sourceName} · {dateLabel(note.createdAt)} · {note.rawText.length.toLocaleString()}자{note.rawText.length > 20_000 ? ' · 큰 작업' : ''}</span></div>{processingId === note.id && !batchProgress ? <button onClick={cancelCurrent} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-[10px] font-bold text-error"><StopCircle size={12} />즉시 취소</button> : <button onClick={() => void processOne(note.id)} disabled={!oauthReady || !!processingId || !!batchProgress} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-container px-3 py-2 text-[10px] font-bold text-primary disabled:opacity-40">{note.status === 'error' ? <RotateCcw size={12} /> : <Sparkles size={12} />}{note.status === 'error' ? '다시 정리' : '정리'}</button>}</div><p className="mt-3 line-clamp-4 whitespace-pre-wrap text-[11px] leading-5 text-on-surface-variant">{note.rawText}</p>{note.error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[10px] leading-5 text-error">{note.error}</p>}</article>)}{inboxNotes.length > inboxVisible && <button onClick={() => setInboxVisible((value) => value + PAGE_SIZE)} className="w-full rounded-xl bg-surface-container py-3 text-xs font-bold text-on-surface-variant">메모 {Math.min(PAGE_SIZE, inboxNotes.length - inboxVisible)}개 더 보기</button>}{!inboxNotes.length && <div className="rounded-2xl border border-dashed border-outline-variant/40 p-8 text-center text-xs text-on-surface-variant"><FileInput className="mx-auto mb-2" size={22} />정리를 기다리는 메모가 없습니다.</div>}</div>
            </section>
          </div>}

          {view === 'review' && <section><h2 className="text-xl font-bold">변경안 검토</h2><p className="mt-1 text-xs text-on-surface-variant">초록색은 추가, 빨간색은 삭제입니다. 승인 전에 제목과 본문을 직접 고칠 수 있습니다.</p><div className="mt-5 space-y-4">{visibleReviews.map((review) => <KnowledgeReviewCard key={review.id} review={review} note={data.notes.find((item) => item.id === review.noteId)} topic={data.topics.find((item) => item.id === review.topicId)} busy={reviewBusyId === review.id} onSave={saveReview} onResolve={resolveReview} />)}{pendingReviews.length > reviewVisible && <button onClick={() => setReviewVisible((value) => value + PAGE_SIZE)} className="w-full rounded-xl bg-surface-container py-3 text-xs font-bold text-on-surface-variant">변경안 {Math.min(PAGE_SIZE, pendingReviews.length - reviewVisible)}개 더 보기</button>}{!pendingReviews.length && <div className="rounded-2xl border border-dashed border-outline-variant/40 p-12 text-center text-xs text-on-surface-variant"><Check className="mx-auto mb-2 text-primary" size={24} />확인할 변경안이 없습니다.</div>}</div></section>}

          {view === 'conflicts' && <section><h2 className="text-xl font-bold">미해결 충돌</h2><p className="mt-1 text-xs text-on-surface-variant">충돌을 등록해도 현재 위키 본문은 바뀌지 않습니다. 위키를 직접 수정한 뒤 해결 이유를 남길 수 있습니다.</p><div className="mt-5 space-y-4">{openConflicts.map((conflict) => <KnowledgeConflictCard key={conflict.id} conflict={conflict} topic={data.topics.find((item) => item.id === conflict.topicId)} note={data.notes.find((item) => item.id === conflict.noteId)} onOpenTopic={(topicId) => { setSelectedTopicId(topicId); setView('wiki'); }} onResolve={closeConflict} />)}{!openConflicts.length && <div className="rounded-2xl border border-dashed border-outline-variant/40 p-12 text-center text-xs text-on-surface-variant"><Check className="mx-auto mb-2 text-primary" size={24} />미해결 충돌이 없습니다.</div>}</div></section>}

          {view === 'wiki' && <div className="grid min-h-[calc(100vh-7.5rem)] gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"><aside className="rounded-2xl border border-outline-variant/25 bg-white p-3"><div className="relative"><Search size={13} className="absolute left-3 top-2.5 text-outline" /><input value={topicSearch} onChange={(event) => { setTopicSearch(event.target.value); setTopicVisible(50); }} placeholder="위키 검색" className="w-full rounded-lg bg-surface-container-low py-2 pl-8 pr-3 text-xs outline-none" /></div><div className="mt-2 space-y-1">{visibleTopics.map((topic) => <button key={topic.id} onClick={() => setSelectedTopicId(topic.id)} className={`w-full rounded-xl px-3 py-2.5 text-left ${selectedTopicId === topic.id ? 'bg-primary-container text-primary' : 'hover:bg-surface-container'}`}><span className="block truncate text-xs font-bold">{topic.title}</span><span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-on-surface-variant">{topic.summary}</span></button>)}{filteredTopics.length > topicVisible && <button onClick={() => setTopicVisible((value) => value + 50)} className="w-full rounded-lg bg-surface-container py-2 text-[10px] font-bold text-on-surface-variant">위키 50개 더 보기</button>}</div></aside>{selectedTopic ? <KnowledgeWikiPanel key={`${selectedTopic.id}-${selectedTopic.revision}`} topic={selectedTopic} notes={data.notes} openConflictCount={openConflicts.filter((item) => item.topicId === selectedTopic.id).length} trashItems={revisionTrash.filter((item) => item.topicId === selectedTopic.id)} dateLabel={dateLabel} onOpenConflicts={() => setView('conflicts')} onEdit={(update) => editTopic(selectedTopic, update)} onRestore={(revision) => restoreRevision(selectedTopic, revision)} onTrash={(revision) => trashRevision(selectedTopic, revision)} onRestoreTrash={restoreTrashRevision} onDeleteTrash={deleteTrashRevision} /> : <article className="flex min-h-80 items-center justify-center rounded-2xl border border-outline-variant/25 bg-white p-6 text-xs text-on-surface-variant"><BookOpenText className="mr-2" size={18} />위키 문서를 선택하세요.</article>}</div>}
        </div></section>
      </div>
    </main>
  );
}
