'use client';

import {
  BookOpen,
  Database,
  ExternalLink,
  FileDown,
  FileSearch,
  FileText,
  FolderKanban,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppHeader } from '@/components/layout/AppHeader';
import { useFeedback } from '@/components/common/FeedbackProvider';
import type { OnlineResearchResult } from '@/lib/research-sources';
import type {
  AnalysisProfile,
  PatentMetadata,
  ResearchAnalysisReport,
  ResearchDocument,
  ResearchProject,
  ResearchSearchResult,
} from '@/types';

interface BootstrapData {
  documents: ResearchDocument[];
  projects: ResearchProject[];
  profiles: AnalysisProfile[];
  conflicts: number;
  conflictItems: Array<{ id: string; documentId?: string; path: string; kind: string; details: string; createdAt: string }>;
  sources: {
    unpaywallEmail?: string;
    openAlexConfigured: boolean;
    kiprisConfigured: boolean;
    epoConfigured: boolean;
  };
}

interface DocumentDetail {
  document: ResearchDocument;
  projectIds: string[];
  patent: PatentMetadata | null;
  analyses: ResearchAnalysisReport[];
  filenameSuggestion: { fileName: string; confident: boolean };
}

const REPORT_LABELS: Record<string, string> = {
  oneSentenceIdea: '한 문장 핵심 아이디어',
  existingProblem: '해결하려는 기존 문제',
  structureAndDevices: '구조와 소자',
  implementationOrProcess: '구현·공정 순서',
  additionalSteps: '추가 가능 단계',
  performanceImpact: '성능 영향',
  tradeoffs: 'Trade-off',
  independentClaimScope: '독립항 핵심 범위',
  embodimentDifferences: '실시예 차이',
  similarWork: '유사 기술·경쟁사',
  uncertainty: '불확실성과 주의점',
  relatedDocuments: '관련 논문·특허',
  conclusion: '종합 결론',
};

const EVIDENCE_LABELS: Record<string, string> = {
  explicit: '원문 명시',
  figure_inference: '도면 해석',
  technical_inference: '기술적 추정',
  uncertain: '불확실',
};

export default function ResearchPage() {
  const { confirm, notify } = useFeedback();
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [query, setQuery] = useState('');
  const [searchSource, setSearchSource] = useState<'local' | 'crossref' | 'openalex' | 'kipris' | 'epo' | 'patent-links'>('local');
  const [localResults, setLocalResults] = useState<ResearchSearchResult[]>([]);
  const [onlineResults, setOnlineResults] = useState<OnlineResearchResult[]>([]);
  const [patentLinks, setPatentLinks] = useState<Array<{ provider: string; url: string }>>([]);
  const [projectDialog, setProjectDialog] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectProfileId, setProjectProfileId] = useState('profile-general');
  const [profileDialog, setProfileDialog] = useState(false);
  const [profileDraft, setProfileDraft] = useState<AnalysisProfile | null>(null);
  const [conflictDialog, setConflictDialog] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [kindDraft, setKindDraft] = useState<ResearchDocument['kind']>('paper');
  const [patentDraft, setPatentDraft] = useState<PatentMetadata | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedProject = useMemo(
    () => data?.projects.find((project) => project.id === selectedProjectId) || null,
    [data?.projects, selectedProjectId],
  );
  const visibleDocuments = useMemo(() => {
    if (!data) return [];
    if (!selectedProjectId) return data.documents;
    if (detail && detail.projectIds.includes(selectedProjectId)) {
      // The selected detail stays visible while the project list refreshes.
    }
    const resultIds = new Set(localResults.map((result) => result.document.id));
    if (query.trim() && searchSource === 'local') {
      return data.documents.filter((document) => resultIds.has(document.id));
    }
    return data.documents.filter((document) => {
      const cached = (document as ResearchDocument & { projectIds?: string[] }).projectIds;
      return cached?.includes(selectedProjectId) || document.id === selectedDocumentId;
    });
  }, [data, detail, localResults, query, searchSource, selectedDocumentId, selectedProjectId]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/research/bootstrap', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '리서치 데이터를 불러오지 못했습니다.');
      const next = payload as BootstrapData;
      // Add membership information with one bounded request per selected project.
      if (selectedProjectId) {
        const projectResponse = await fetch(`/api/research/documents?projectId=${encodeURIComponent(selectedProjectId)}`, { cache: 'no-store' });
        const projectPayload = await projectResponse.json();
        const projectIds = new Set((projectPayload.documents || []).map((item: ResearchDocument) => item.id));
        next.documents = next.documents.map((item) => ({ ...item, projectIds: projectIds.has(item.id) ? [selectedProjectId] : [] }));
      }
      setData(next);
      if (!selectedProjectId && next.projects[0]) setSelectedProjectId(next.projects[0].id);
    } catch (error) {
      notify(error instanceof Error ? error.message : '리서치 데이터를 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, selectedProjectId]);

  const loadDetail = useCallback(async (documentId: string) => {
    setSelectedDocumentId(documentId);
    try {
      const response = await fetch(`/api/research/documents?id=${encodeURIComponent(documentId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '문서를 불러오지 못했습니다.');
      const next = payload as DocumentDetail;
      setDetail(next);
      setTitleDraft(next.document.displayTitle);
      setKindDraft(next.document.kind);
      setPatentDraft(next.patent || {
        documentId,
        assignees: [], inventors: [], citations: [], claimsText: '', updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : '문서를 불러오지 못했습니다.', 'error');
    }
  }, [notify]);

  useEffect(() => { void loadBootstrap(); }, [loadBootstrap]);
  useEffect(() => {
    if (!selectedDocumentId) return;
    const hasRunning = detail?.analyses.some((analysis) => analysis.status === 'queued' || analysis.status === 'running');
    if (!hasRunning) return;
    const timer = window.setInterval(() => void loadDetail(selectedDocumentId), 2500);
    return () => window.clearInterval(timer);
  }, [detail?.analyses, loadDetail, selectedDocumentId]);

  const runSearch = async () => {
    if (query.trim().length < 2) return;
    setBusy('search');
    setLocalResults([]);
    setOnlineResults([]);
    setPatentLinks([]);
    try {
      const params = new URLSearchParams({ q: query.trim(), source: searchSource });
      if (selectedProjectId && searchSource === 'local') params.set('projectId', selectedProjectId);
      const response = await fetch(`/api/research/search?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '검색에 실패했습니다.');
      if (searchSource === 'local') setLocalResults(payload.results || []);
      else if (searchSource === 'patent-links') setPatentLinks(payload.links || []);
      else setOnlineResults(payload.results || []);
    } catch (error) {
      notify(error instanceof Error ? error.message : '검색에 실패했습니다.', 'error');
    } finally {
      setBusy('');
    }
  };

  const createNewProject = async () => {
    if (!projectName.trim()) return;
    setBusy('project');
    try {
      const response = await fetch('/api/research/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, description: projectDescription, profileId: projectProfileId }),
      });
      const project = await response.json();
      if (!response.ok || project.error) throw new Error(project.error || '프로젝트를 만들지 못했습니다.');
      setProjectDialog(false);
      setProjectName('');
      setProjectDescription('');
      setSelectedProjectId(project.id);
      await loadBootstrap();
    } catch (error) {
      notify(error instanceof Error ? error.message : '프로젝트를 만들지 못했습니다.', 'error');
    } finally { setBusy(''); }
  };

  const acknowledgeConflict = async (id: string) => {
    const response = await fetch('/api/research/conflicts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      notify(payload.error || '복구 확인을 완료하지 못했습니다.', 'error');
      return;
    }
    await loadBootstrap();
  };

  const linkDocument = async (documentId: string, linked = true) => {
    if (!selectedProjectId) return;
    const response = await fetch('/api/research/projects', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedProjectId, documentId, linked }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || '프로젝트 연결을 변경하지 못했습니다.');
    await Promise.all([loadBootstrap(), loadDetail(documentId)]);
  };

  const saveOnlineResult = async (result: OnlineResearchResult, download = false) => {
    setBusy(`online:${result.externalId}`);
    try {
      const response = await fetch('/api/research/imports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: download ? 'download-pdf' : 'save-metadata',
          result,
          projectId: selectedProjectId || undefined,
          url: result.pdfUrl,
          preferredName: `${result.publicationYear || ''} - ${result.authors[0] || ''} - ${result.title}.pdf`,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '자료를 저장하지 못했습니다.');
      notify(download ? '공개 PDF를 라이브러리에 복사했습니다.' : '논문 메타데이터를 저장했습니다.', 'success');
      await loadBootstrap();
      if (payload.document?.id) await loadDetail(payload.document.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : '자료를 저장하지 못했습니다.', 'error');
    } finally { setBusy(''); }
  };

  const uploadPdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('upload');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('folderPath', '');
      const response = await fetch('/api/papers', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || 'PDF를 추가하지 못했습니다.');
      if (selectedProjectId && payload.documentId) await linkDocument(payload.documentId, true);
      await loadBootstrap();
      if (payload.documentId) await loadDetail(payload.documentId);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'PDF를 추가하지 못했습니다.', 'error');
    } finally { setBusy(''); }
  };

  const saveDocument = async () => {
    if (!detail) return;
    setBusy('save-document');
    try {
      const response = await fetch('/api/research/documents', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: detail.document.id,
          updates: { displayTitle: titleDraft, kind: kindDraft },
          patent: kindDraft === 'patent' ? patentDraft : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '문서를 저장하지 못했습니다.');
      notify('문서 정보를 저장했습니다.', 'success');
      await Promise.all([loadBootstrap(), loadDetail(detail.document.id)]);
    } catch (error) {
      notify(error instanceof Error ? error.message : '문서를 저장하지 못했습니다.', 'error');
    } finally { setBusy(''); }
  };

  const indexDocument = async () => {
    if (!detail) return;
    setBusy('index');
    try {
      const response = await fetch('/api/research/documents/index', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: detail.document.id }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '색인에 실패했습니다.');
      notify(`${payload.pages}페이지를 ${payload.chunks}개 검색 단위로 색인했습니다.`, 'success');
      await loadDetail(detail.document.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : '색인에 실패했습니다.', 'error');
    } finally { setBusy(''); }
  };

  const applySuggestedFilename = async () => {
    if (!detail?.document.currentPath) return;
    const suggestion = detail.filenameSuggestion.fileName;
    const approved = await confirm({
      title: 'PDF 파일명 변경',
      message: `실제 PDF 파일명을 다음과 같이 바꿀까요?\n\n${suggestion}`,
      confirmLabel: '파일명 변경',
    });
    if (!approved) return;
    setBusy('rename');
    try {
      const response = await fetch('/api/papers', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: detail.document.currentPath, name: suggestion, action: 'rename' }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '파일명을 바꾸지 못했습니다.');
      notify('PDF 파일명과 연결 정보를 함께 변경했습니다.', 'success');
      await Promise.all([loadBootstrap(), loadDetail(detail.document.id)]);
    } catch (error) {
      notify(error instanceof Error ? error.message : '파일명을 바꾸지 못했습니다.', 'error');
    } finally { setBusy(''); }
  };

  const startAnalysis = async () => {
    if (!detail) return;
    const profileId = selectedProject?.profileId || 'profile-general';
    setBusy('analysis');
    try {
      const response = await fetch('/api/research/analyses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: detail.document.id, projectId: selectedProjectId || undefined, profileId, model: 'auto', reasoningEffort: 'auto' }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || '분석을 시작하지 못했습니다.');
      notify('근거 기반 분석을 시작했습니다.', 'success');
      await loadDetail(detail.document.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : '분석을 시작하지 못했습니다.', 'error');
    } finally { setBusy(''); }
  };

  const openProfileEditor = () => {
    const profile = data?.profiles.find((item) => item.id === (selectedProject?.profileId || 'profile-general'));
    if (!profile) return;
    setProfileDraft({ ...profile, id: profile.builtIn ? '' : profile.id, name: profile.builtIn ? `${profile.name} 사본` : profile.name, builtIn: false });
    setProfileDialog(true);
  };

  const saveProfile = async () => {
    if (!profileDraft?.name.trim()) return;
    setBusy('profile');
    try {
      const response = await fetch('/api/research/profiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileDraft),
      });
      const profile = await response.json();
      if (!response.ok || profile.error) throw new Error(profile.error || '프로필을 저장하지 못했습니다.');
      if (selectedProjectId) {
        await fetch('/api/research/projects', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedProjectId, profileId: profile.id }),
        });
      }
      setProfileDialog(false);
      await loadBootstrap();
    } catch (error) {
      notify(error instanceof Error ? error.message : '프로필을 저장하지 못했습니다.', 'error');
    } finally { setBusy(''); }
  };

  if (loading && !data) {
    return <div className="flex h-full items-center justify-center bg-surface text-sm text-on-surface-variant"><Loader2 className="mr-2 animate-spin" size={18} />리서치 공간을 준비하는 중...</div>;
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <AppHeader
        active="research"
        actions={data?.conflicts ? (
          <button onClick={() => setConflictDialog(true)} className="mr-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[10px] font-semibold text-amber-900 transition-colors hover:bg-amber-200">
            파일 연결 확인 {data.conflicts}건
          </button>
        ) : undefined}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(340px,430px)_minmax(440px,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-outline-variant/15 bg-surface-container">
          <div className="flex h-11 shrink-0 items-center justify-between px-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface-variant">프로젝트</div>
            <button onClick={() => setProjectDialog(true)} className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface" title="프로젝트 만들기"><Plus size={14} /></button>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <button onClick={() => setSelectedProjectId('')} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${!selectedProjectId ? 'bg-surface-container-lowest font-semibold text-on-surface shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`}><Database size={14} />전체 자료</button>
            {data?.projects.map((project) => (
              <button key={project.id} onClick={() => { setSelectedProjectId(project.id); setLocalResults([]); void loadBootstrap(); }} className={`mb-1 w-full rounded-lg px-2.5 py-2 text-left transition-colors ${selectedProjectId === project.id ? 'bg-surface-container-lowest shadow-sm' : 'hover:bg-surface-container-high'}`}>
                <span className={`flex items-center gap-2 text-xs font-semibold ${selectedProjectId === project.id ? 'text-on-surface' : 'text-on-surface-variant'}`}><FolderKanban size={14} />{project.name}</span>
                <span className="mt-1 block pl-[22px] text-[10px] text-outline">자료 {project.documentCount}개</span>
              </button>
            ))}
          </nav>
          {selectedProject && (
            <div className="shrink-0 border-t border-outline-variant/15 p-3">
              <div className="rounded-xl bg-surface-container-low p-3">
                <div className="text-[9px] font-bold uppercase tracking-wider text-outline">분석 프로필</div>
                <div className="mt-1 truncate text-xs font-semibold text-on-surface">{data?.profiles.find((item) => item.id === selectedProject.profileId)?.name}</div>
                <button onClick={openProfileEditor} className="mt-2 text-[10px] font-semibold text-primary hover:underline">프로필 편집·복사</button>
              </div>
            </div>
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto border-r border-outline-variant/15 bg-surface px-4 py-4">
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 shadow-sm">
              <Search size={15} className="text-outline" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }} placeholder="논문·특허·기술어 검색" className="h-10 min-w-0 flex-1 bg-transparent text-xs outline-none" />
            </div>
            <button onClick={() => void runSearch()} disabled={busy === 'search'} className="flex h-10 min-w-16 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50">{busy === 'search' ? <Loader2 size={14} className="animate-spin" /> : '검색'}</button>
          </div>
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {([
              ['local', '내 자료'], ['crossref', '논문'], ['openalex', 'OpenAlex'],
              ...(data?.sources.kiprisConfigured ? [['kipris', 'KIPRIS Plus'] as const] : []),
              ...(data?.sources.epoConfigured ? [['epo', 'EPO OPS'] as const] : []),
              ['patent-links', '특허 웹검색'],
            ] as const).map(([value, label]) => (
              <button key={value} onClick={() => setSearchSource(value)} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${searchSource === value ? 'bg-primary-container text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>{label}</button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <h1 className="text-sm font-bold text-on-surface">{selectedProject?.name || '전체 자료'}</h1>
            <div className="flex gap-1">
              <button onClick={() => fileInputRef.current?.click()} disabled={busy === 'upload'} className="flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-2.5 text-[10px] font-semibold text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container"><FileDown size={12} />PDF 추가</button>
              <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => void uploadPdf(event)} />
              <button onClick={() => void loadBootstrap()} className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant shadow-sm transition-colors hover:bg-surface-container" aria-label="새로고침"><RefreshCw size={12} /></button>
            </div>
          </div>

          {onlineResults.length > 0 && (
            <section className="mt-3 space-y-2">
              {onlineResults.map((result) => (
                <article key={`${result.source}:${result.externalId}`} className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3">
                  <div className="text-xs font-semibold leading-5">{result.title}</div>
                  <div className="mt-1 text-[10px] text-outline">{result.authors.join(', ')} {result.publicationYear ? `· ${result.publicationYear}` : ''} · {result.source}</div>
                  {result.abstractText && <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-on-surface-variant">{result.abstractText}</p>}
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => void saveOnlineResult(result, false)} className="rounded-lg bg-surface-container px-2.5 py-1.5 text-[10px] font-semibold">메타데이터 저장</button>
                    {result.pdfUrl && <button onClick={() => void saveOnlineResult(result, true)} className="rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-on-primary">공개 PDF 가져오기</button>}
                    {result.url && <a href={result.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-primary">원문 페이지 <ExternalLink size={10} /></a>}
                  </div>
                </article>
              ))}
            </section>
          )}

          {patentLinks.length > 0 && <section className="mt-3 grid gap-2">{patentLinks.map((link) => <a key={link.provider} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 py-3 text-xs font-semibold">{link.provider}에서 “{query}” 검색 <ExternalLink size={13} /></a>)}</section>}

          <section className="mt-3 space-y-2">
            {(query.trim() && searchSource === 'local' ? localResults.map((item) => item.document) : visibleDocuments).map((document) => (
              <button key={document.id} onClick={() => void loadDetail(document.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedDocumentId === document.id ? 'border-primary bg-primary/5' : 'border-outline-variant/15 bg-surface-container-lowest hover:border-outline-variant/40'}`}>
                <div className="flex items-start gap-2">
                  {document.kind === 'patent' ? <FileSearch size={16} className="mt-0.5 shrink-0 text-violet-600" /> : <FileText size={16} className="mt-0.5 shrink-0 text-primary" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold leading-5">{document.displayTitle}</span>
                    <span className="mt-1 block truncate text-[10px] text-outline">{document.currentPath || document.sourceUrl || '원문 미연결'} · {document.kind}</span>
                  </span>
                </div>
              </button>
            ))}
            {!onlineResults.length && !patentLinks.length && visibleDocuments.length === 0 && <div className="rounded-xl bg-surface-container p-5 text-center text-xs text-on-surface-variant">프로젝트에 연결된 자료가 없습니다.</div>}
          </section>
        </main>

        <section className="min-h-0 overflow-y-auto bg-surface-container-lowest p-6">
          {!detail ? (
            <div className="flex h-full items-center justify-center text-center"><div><BookOpen size={28} className="mx-auto text-outline" /><h2 className="mt-3 text-sm font-semibold">자료를 선택하세요</h2><p className="mt-1 text-xs text-on-surface-variant">메타데이터, 파일명, 색인과 분석을 관리합니다.</p></div></div>
          ) : (
            <div className="mx-auto max-w-3xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} className="w-full border-b border-transparent bg-transparent text-lg font-bold outline-none focus:border-primary" />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-outline">
                    <select value={kindDraft} onChange={(event) => setKindDraft(event.target.value as ResearchDocument['kind'])} className="rounded-lg bg-surface-container px-2 py-1.5 outline-none">
                      <option value="paper">논문</option><option value="patent">특허</option><option value="conference">학회</option><option value="product">제품자료</option><option value="technical">기술자료</option>
                    </select>
                    {detail.document.doi && <span>DOI {detail.document.doi}</span>}
                    {detail.document.indexedAt && <span>색인 완료</span>}
                    {detail.document.missing && <span className="font-semibold text-error">원문 경로 확인 필요</span>}
                  </div>
                </div>
                <button onClick={() => void saveDocument()} disabled={busy === 'save-document'} className="rounded-lg bg-primary px-3 py-2 text-[10px] font-semibold text-on-primary">저장</button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {detail.document.currentPath && <Link href={`/?pdf=${encodeURIComponent(detail.document.currentPath)}`} className="flex items-center gap-1 rounded-lg bg-surface-container px-3 py-2 text-[10px] font-semibold"><BookOpen size={12} />PDF 열기</Link>}
                <button onClick={() => void indexDocument()} disabled={!detail.document.currentPath || busy === 'index'} className="flex items-center gap-1 rounded-lg bg-surface-container px-3 py-2 text-[10px] font-semibold disabled:opacity-50">{busy === 'index' ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}본문 색인</button>
                <button onClick={() => void applySuggestedFilename()} disabled={!detail.document.currentPath || busy === 'rename'} className="flex items-center gap-1 rounded-lg bg-surface-container px-3 py-2 text-[10px] font-semibold disabled:opacity-50"><FileText size={12} />추천 파일명 확인</button>
                {selectedProjectId && <button onClick={() => void linkDocument(detail.document.id, !detail.projectIds.includes(selectedProjectId)).catch((error) => notify(error.message, 'error'))} className="flex items-center gap-1 rounded-lg bg-surface-container px-3 py-2 text-[10px] font-semibold"><Tags size={12} />{detail.projectIds.includes(selectedProjectId) ? '프로젝트에서 빼기' : '프로젝트에 연결'}</button>}
                <button onClick={() => void startAnalysis()} disabled={!detail.document.indexedAt || busy === 'analysis'} className="flex items-center gap-1 rounded-lg bg-violet-100 px-3 py-2 text-[10px] font-semibold text-violet-800 disabled:opacity-50"><Sparkles size={12} />Codex 정밀분석</button>
              </div>

              <div className="mt-4 rounded-xl bg-surface-container p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">추천 파일명</div>
                <div className="mt-1 break-all text-xs">{detail.filenameSuggestion.fileName}</div>
                {!detail.filenameSuggestion.confident && <div className="mt-1 text-[10px] text-amber-700">저자·연도 또는 특허번호가 부족합니다. 적용 전에 확인하세요.</div>}
              </div>

              {kindDraft === 'patent' && patentDraft && (
                <div className="mt-5 rounded-xl border border-outline-variant/20 p-4">
                  <h3 className="text-xs font-bold">특허 메타데이터</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[['공개번호', 'publicationNumber'], ['출원번호', 'applicationNumber'], ['등록번호', 'registrationNumber'], ['최초 우선일', 'priorityDate'], ['관할', 'jurisdiction'], ['법적 상태(참고)', 'legalStatus']] .map(([label, key]) => (
                      <label key={key} className="text-[10px] text-on-surface-variant">{label}<input value={String(patentDraft[key as keyof PatentMetadata] || '')} onChange={(event) => setPatentDraft({ ...patentDraft, [key]: event.target.value })} className="mt-1 w-full rounded-lg bg-surface-container px-2 py-2 text-xs text-on-surface outline-none" /></label>
                    ))}
                  </div>
                  <label className="mt-3 block text-[10px] text-on-surface-variant">출원인 (쉼표 구분)<input value={patentDraft.assignees.join(', ')} onChange={(event) => setPatentDraft({ ...patentDraft, assignees: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg bg-surface-container px-2 py-2 text-xs outline-none" /></label>
                  <label className="mt-3 block text-[10px] text-on-surface-variant">청구항<textarea value={patentDraft.claimsText} onChange={(event) => setPatentDraft({ ...patentDraft, claimsText: event.target.value })} className="mt-1 h-32 w-full resize-y rounded-lg bg-surface-container px-3 py-2 text-xs leading-5 outline-none" /></label>
                  <p className="mt-2 text-[10px] text-outline">법적 상태는 참고 정보이며 자유실시 가능 여부를 판단하지 않습니다.</p>
                </div>
              )}

              <div className="mt-6">
                <h3 className="text-xs font-bold">분석 기록</h3>
                <div className="mt-2 space-y-3">
                  {detail.analyses.map((analysis) => (
                    <article key={analysis.id} className="rounded-xl border border-outline-variant/20 p-4">
                      <div className="flex items-center justify-between"><span className="text-[10px] font-semibold">{analysis.status === 'succeeded' ? '분석 완료' : analysis.status === 'failed' ? '분석 실패' : '분석 중'}</span><span className="text-[10px] text-outline">{new Date(analysis.createdAt).toLocaleString('ko-KR')}</span></div>
                      {(analysis.status === 'queued' || analysis.status === 'running') && <div className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant"><Loader2 size={13} className="animate-spin" />Codex가 원문 근거를 확인하고 있습니다.</div>}
                      {analysis.error && <p className="mt-2 text-xs text-error">{analysis.error}</p>}
                      {analysis.status === 'succeeded' && <div className="mt-3 space-y-4">{Object.entries(analysis.report).filter(([key]) => key !== 'evidence').map(([key, value]) => <section key={key}><div className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">{REPORT_LABELS[key] || key}</div><p className="selectable-text mt-1 whitespace-pre-wrap text-xs leading-6 text-on-surface">{String(value || '')}</p></section>)}
                        {analysis.evidence.length > 0 && <section><div className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">원문 근거</div><div className="mt-2 space-y-2">{analysis.evidence.map((anchor) => <a key={anchor.id} href={detail.document.currentPath && anchor.page ? `/?pdf=${encodeURIComponent(detail.document.currentPath)}&page=${anchor.page}` : '#'} className="block rounded-lg bg-surface-container px-3 py-2 text-[11px] leading-5"><span className="font-semibold text-primary">{EVIDENCE_LABELS[anchor.level]} {anchor.page ? `· ${anchor.page}쪽` : ''}</span><span className="selectable-text mt-1 block">“{anchor.quote}”</span>{anchor.note && <span className="mt-1 block text-on-surface-variant">{anchor.note}</span>}</a>)}</div></section>}
                      </div>}
                    </article>
                  ))}
                  {detail.analyses.length === 0 && <div className="rounded-xl bg-surface-container p-4 text-xs text-on-surface-variant">본문을 색인한 뒤 Codex 정밀분석을 실행할 수 있습니다.</div>}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {conflictDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6" onMouseDown={() => setConflictDialog(false)}>
          <section className="max-h-[75vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">PDF 연결 복구 확인</h2>
                <p className="mt-1 text-xs text-on-surface-variant">같은 해시가 여러 경로에 있거나 파일 내용이 달라진 항목입니다. PageDock이 임의로 원본을 바꾸지 않았습니다.</p>
              </div>
              <button onClick={() => setConflictDialog(false)} className="rounded-lg p-2 hover:bg-surface-container"><X size={16} /></button>
            </div>
            <div className="mt-4 space-y-2">
              {data?.conflictItems.map((item) => (
                <article key={item.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
                  <div className="break-all text-xs font-semibold">{item.path}</div>
                  <p className="mt-1 text-[11px] leading-5">{item.details || item.kind}</p>
                  {item.documentId && <button onClick={() => { setConflictDialog(false); void loadDetail(item.documentId!); }} className="mr-3 mt-2 text-[11px] font-semibold underline">문서 확인</button>}
                  <button onClick={() => void acknowledgeConflict(item.id)} className="mt-2 text-[11px] font-semibold underline">확인 완료로 표시</button>
                </article>
              ))}
              {!data?.conflictItems.length && <p className="text-xs text-on-surface-variant">확인이 필요한 항목이 없습니다.</p>}
            </div>
          </section>
        </div>
      )}

      {projectDialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-ambient"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">리서치 프로젝트 만들기</h2><button onClick={() => setProjectDialog(false)} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container" aria-label="닫기"><X size={16} /></button></div><label className="mt-4 block text-xs">프로젝트 이름<input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="예: 삼성 CIS" className="mt-1 w-full rounded-lg border border-outline-variant/25 bg-surface-container-low px-3 py-2.5 outline-none focus:border-primary" /></label><label className="mt-3 block text-xs">설명<textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} className="mt-1 h-20 w-full rounded-lg border border-outline-variant/25 bg-surface-container-low px-3 py-2 outline-none focus:border-primary" /></label><label className="mt-3 block text-xs">분석 프로필<select value={projectProfileId} onChange={(event) => setProjectProfileId(event.target.value)} className="mt-1 w-full rounded-lg border border-outline-variant/25 bg-surface-container-low px-3 py-2.5 outline-none focus:border-primary">{data?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button onClick={() => void createNewProject()} disabled={!projectName.trim() || busy === 'project'} className="mt-5 w-full rounded-lg bg-primary py-2.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50">프로젝트 만들기</button></div></div>}

      {profileDialog && profileDraft && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-xl rounded-2xl bg-surface-container-lowest p-5 shadow-ambient"><div className="flex items-center justify-between"><h2 className="text-sm font-bold">분석 프로필 편집</h2><button onClick={() => setProfileDialog(false)}><X size={16} /></button></div><label className="mt-4 block text-xs">이름<input value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} className="mt-1 w-full rounded-xl bg-surface-container px-3 py-2" /></label><label className="mt-3 block text-xs">설명<textarea value={profileDraft.description} onChange={(event) => setProfileDraft({ ...profileDraft, description: event.target.value })} className="mt-1 h-16 w-full rounded-xl bg-surface-container px-3 py-2" /></label>{([['focusAreas', '관심 영역'], ['questions', '핵심 질문'], ['metrics', '성능 지표']] as const).map(([key, label]) => <label key={key} className="mt-3 block text-xs">{label} (줄바꿈 구분)<textarea value={profileDraft[key].join('\n')} onChange={(event) => setProfileDraft({ ...profileDraft, [key]: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} className="mt-1 h-20 w-full rounded-xl bg-surface-container px-3 py-2" /></label>)}<button onClick={() => void saveProfile()} className="mt-5 w-full rounded-xl bg-primary py-2.5 text-xs font-semibold text-on-primary">프로필 저장 및 적용</button></div></div>}
    </div>
  );
}
