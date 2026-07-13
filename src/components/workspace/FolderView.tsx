'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, FileText, Loader2, MessageSquare, Search, SlidersHorizontal } from 'lucide-react';

import { useFeedback } from '@/components/common/FeedbackProvider';
import { PaperInspector } from '@/components/workspace/PaperInspector';
import { PaperListItem } from '@/components/workspace/PaperListItem';
import { useWorkspace } from '@/lib/workspace-store';
import { collectPdfs } from '@/lib/tree-utils';
import { PaperMetadata, Session, TreeNode } from '@/types';

interface LibraryInfoSummary {
  oneDriveLikely: boolean;
  latestBackup?: { modifiedAt: string } | null;
}

export function FolderView() {
  const { selectedNode, openPdf, openSession } = useWorkspace();
  const { notify } = useFeedback();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [paperMetadata, setPaperMetadata] = useState<Record<string, PaperMetadata>>({});
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [libraryInfo, setLibraryInfo] = useState<LibraryInfoSummary | null>(null);
  const [selectedPaperPath, setSelectedPaperPath] = useState<string | null>(null);
  const [paperQuery, setPaperQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'reading' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'opened' | 'importance'>('name');
  const isFolderSelected = selectedNode?.type === 'folder';
  const folderPath = isFolderSelected ? selectedNode.path : null;
  const pdfs = useMemo(
    () => selectedNode?.type === 'folder' ? collectPdfs(selectedNode) : [],
    [selectedNode],
  );

  useEffect(() => {
    let cancelled = false;
    const loadLibraryInfo = async () => {
      try {
        const res = await fetch('/api/library/info', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && res.ok) setLibraryInfo(data as LibraryInfoSummary);
      } catch {
        if (!cancelled) setLibraryInfo(null);
      }
    };
    void loadLibraryInfo();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSelectedPaperPath(null);
  }, [folderPath]);

  useEffect(() => {
    if (!selectedNode || selectedNode.type !== 'folder') {
      setPaperMetadata({});
      setMetadataLoading(false);
      return;
    }
    const metadataPdfs = collectPdfs(selectedNode);
    if (metadataPdfs.length === 0) {
      setPaperMetadata({});
      setMetadataLoading(false);
      return;
    }
    let cancelled = false;
    const loadMetadata = async () => {
      setMetadataLoading(true);
      try {
        const res = await fetch('/api/papers/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: metadataPdfs.map((pdf) => pdf.path) }),
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data?.error) {
          throw new Error(typeof data?.error === 'string' ? data.error : '논문 정보를 불러오지 못했습니다.');
        }
        setPaperMetadata(data as Record<string, PaperMetadata>);
      } catch (error) {
        if (!cancelled) {
          setPaperMetadata({});
          notify(error instanceof Error ? error.message : '논문 정보를 불러오지 못했습니다.', 'error');
        }
      } finally {
        if (!cancelled) setMetadataLoading(false);
      }
    };
    void loadMetadata();
    return () => { cancelled = true; };
  }, [notify, selectedNode]);

  const visiblePdfs = useMemo(() => {
    const query = paperQuery.trim().toLocaleLowerCase('ko-KR');
    return pdfs
      .filter((pdf) => {
        const metadata = paperMetadata[pdf.path];
        if (statusFilter !== 'all' && metadata && metadata.readingStatus !== statusFilter) return false;
        if (!query) return true;
        if (!metadata) return pdf.name.toLocaleLowerCase('ko-KR').includes(query);
        return [
          pdf.name,
          pdf.path,
          ...metadata.aiKeywords,
          ...metadata.personalTags,
          metadata.summaryKo,
          metadata.noteMarkdown,
        ].some((value) => value.toLocaleLowerCase('ko-KR').includes(query));
      })
      .sort((a, b) => {
        if (sortBy === 'importance') {
          return (paperMetadata[b.path]?.importance || 0) - (paperMetadata[a.path]?.importance || 0);
        }
        if (sortBy === 'opened') {
          return (paperMetadata[b.path]?.lastOpenedAt || '').localeCompare(paperMetadata[a.path]?.lastOpenedAt || '');
        }
        return a.name.localeCompare(b.name, 'ko-KR');
      });
  }, [paperMetadata, paperQuery, pdfs, sortBy, statusFilter]);

  useEffect(() => {
    setSelectedPaperPath((current) => {
      if (current && visiblePdfs.some((pdf) => pdf.path === current)) return current;
      return visiblePdfs[0]?.path ?? null;
    });
  }, [visiblePdfs]);

  const selectedPaper = useMemo(
    () => pdfs.find((pdf) => pdf.path === selectedPaperPath) ?? null,
    [pdfs, selectedPaperPath],
  );
  const selectedMetadata = selectedPaper ? paperMetadata[selectedPaper.path] : undefined;

  useEffect(() => {
    if (!folderPath) {
      setSessions([]);
      return;
    }

    let cancelled = false;
    const loadSessions = async () => {
      setSessionsLoading(true);
      try {
        const params = new URLSearchParams({ folderPath, sessionKind: 'folder' });
        const res = await fetch(`/api/sessions?${params.toString()}`);
        const data = await res.json();
        if (!cancelled) {
          setSessions(
            Array.isArray(data)
              ? data.filter((session): session is Session => (
                typeof session === 'object' &&
                session !== null &&
                session.sessionKind === 'folder' &&
                !session.pdfPath
              ))
              : [],
          );
        }
      } catch (error) {
        if (!cancelled) {
          setSessions([]);
          notify(error instanceof Error ? error.message : '대화를 불러오지 못했습니다.', 'error');
        }
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    };
    void loadSessions();
    return () => { cancelled = true; };
  }, [folderPath, notify]);

  if (!isFolderSelected) return null;

  const getRelativePath = (pdf: TreeNode) => {
    const relativePath = pdf.path.startsWith(selectedNode.path + '/')
      ? pdf.path.slice(selectedNode.path.length + 1)
      : pdf.name;
    return relativePath;
  };

  const handleCreateSession = async () => {
    if (!folderPath) return;

    setCreatingSession(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath,
          title: `${selectedNode.name} 연구 대화`,
          sessionKind: 'folder',
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '연구 대화를 만들지 못했습니다.');
      }
      if (data?.id) {
        setSessions((current) => [data, ...current]);
        openSession(data);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '연구 대화를 만들지 못했습니다.', 'error');
    } finally {
      setCreatingSession(false);
    }
  };

  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto flex h-full max-w-[1480px] flex-col px-5 py-5 lg:px-7 lg:py-6">
        <header className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">연구 폴더</div>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-on-surface">{selectedNode.name}</h1>
            <p className="mt-1 text-xs text-on-surface-variant">
              PDF {pdfs.length}개 · 표시 {visiblePdfs.length}개 · 이전 대화 {sessions.length}개
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-outline">
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-container px-2 py-1">
                <span className={`h-1.5 w-1.5 rounded-full ${libraryInfo?.oneDriveLikely ? 'bg-primary' : 'bg-outline'}`} />
                {libraryInfo?.oneDriveLikely ? 'OneDrive 라이브러리' : '로컬 라이브러리'}
              </span>
              <span>
                마지막 백업 {libraryInfo?.latestBackup
                  ? new Date(libraryInfo.latestBackup.modifiedAt).toLocaleDateString('ko-KR')
                  : '없음'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCreateSession()}
            disabled={creatingSession}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-primary px-3.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creatingSession ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
            {creatingSession ? '대화 시작 중...' : '폴더 연구 대화'}
          </button>
        </header>

        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2.5">
            <Search size={14} className="shrink-0 text-outline" />
            <input
              value={paperQuery}
              onChange={(event) => setPaperQuery(event.target.value)}
              placeholder="파일명, 키워드, 태그, 요약, 노트 검색"
              className="h-8 min-w-0 flex-1 bg-transparent text-xs text-on-surface outline-none placeholder:text-outline"
              aria-label="폴더 안의 논문 검색"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-8 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2 text-xs text-on-surface outline-none"
            aria-label="읽음 상태 필터"
          >
            <option value="all">모든 상태</option>
            <option value="unread">읽지 않음</option>
            <option value="reading">읽는 중</option>
            <option value="completed">완료</option>
          </select>
          <label className="flex h-8 items-center gap-1 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2 text-xs text-on-surface">
            <SlidersHorizontal size={12} className="text-outline" />
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
              className="bg-transparent text-xs outline-none"
              aria-label="논문 정렬"
            >
              <option value="name">이름순</option>
              <option value="opened">최근 읽은 순</option>
              <option value="importance">중요도순</option>
            </select>
          </label>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(330px,390px)]">
          <section className="min-h-0 overflow-y-auto pr-1">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">논문 목록</h2>
              {metadataLoading && (
                <span className="inline-flex items-center gap-1 text-[10px] text-outline">
                  <Loader2 size={11} className="animate-spin" /> 정보 불러오는 중
                </span>
              )}
            </div>

            {pdfs.length === 0 ? (
              <div className="rounded-xl bg-surface-dim p-8 text-center">
                <p className="text-sm text-on-surface-variant">이 폴더에 PDF가 없습니다.</p>
                <p className="mt-1 text-xs text-outline">탐색기의 PDF 추가 버튼으로 논문을 넣어 주세요.</p>
              </div>
            ) : visiblePdfs.length === 0 ? (
              <div className="rounded-xl bg-surface-dim px-4 py-8 text-center text-xs text-on-surface-variant">
                현재 검색·필터와 일치하는 논문이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {visiblePdfs.map((pdf) => {
                  const metadata = paperMetadata[pdf.path];
                  const relativePath = getRelativePath(pdf);
                  return metadata ? (
                    <PaperListItem
                      key={pdf.id}
                      pdf={pdf}
                      relativePath={relativePath}
                      metadata={metadata}
                      selected={selectedPaperPath === pdf.path}
                      onSelect={() => setSelectedPaperPath(pdf.path)}
                      onOpen={() => openPdf(pdf)}
                      onMetadataChange={(nextMetadata) => setPaperMetadata((current) => ({
                        ...current,
                        [pdf.path]: nextMetadata,
                      }))}
                    />
                  ) : (
                    <button
                      key={pdf.id}
                      type="button"
                      onClick={() => {
                        setSelectedPaperPath(pdf.path);
                        openPdf(pdf);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 py-3 text-left text-sm text-on-surface"
                    >
                      <Loader2 size={15} className="animate-spin text-outline" />
                      <span className="truncate">{pdf.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {(sessionsLoading || sessions.length > 0) && (
              <section className="mt-7 border-t border-outline-variant/15 pt-5">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">이전 대화</h2>
                {sessionsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <Loader2 size={12} className="animate-spin" /> 대화를 불러오는 중...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => openSession(session)}
                        className="group w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 text-left transition-colors hover:border-outline-variant/45"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="truncate text-sm font-semibold text-on-surface group-hover:text-primary">{session.title}</h3>
                          <span className="flex shrink-0 items-center gap-1 text-[10px] text-outline">
                            <Clock size={11} /> {new Date(session.updatedAt).toLocaleDateString('ko-KR')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-on-surface-variant">메시지 {session.messages.length}개</p>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>

          <aside className="min-h-[360px] max-h-[48vh] overflow-y-auto lg:min-h-0 lg:max-h-none">
            {selectedPaper && selectedMetadata ? (
              <PaperInspector
                pdf={selectedPaper}
                relativePath={getRelativePath(selectedPaper)}
                metadata={selectedMetadata}
                onOpen={() => openPdf(selectedPaper)}
                onMetadataChange={(nextMetadata) => setPaperMetadata((current) => ({
                  ...current,
                  [selectedPaper.path]: nextMetadata,
                }))}
              />
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-outline-variant/35 bg-surface-container-low px-6 text-center">
                <div>
                  <FileText size={24} className="mx-auto text-outline-variant" />
                  <p className="mt-3 text-sm font-medium text-on-surface">논문을 선택하세요</p>
                  <p className="mt-1 text-xs leading-5 text-on-surface-variant">목록에서 논문을 선택하면 요약, 태그, 노트와 번역을 이곳에서 관리할 수 있습니다.</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
