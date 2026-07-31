'use client';

import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Database, Download, FolderSync, Loader2, LogIn, Palette, RefreshCw, RotateCcw, Server, Trash2, Upload } from 'lucide-react';
import { DEFAULT_AI_PROVIDER } from '@/lib/ai-providers/config';
import { AUTO_MODEL_ID, getAutoModelLabel } from '@/lib/ai-providers/model-policy';
import {
  DEFAULT_CHAT_FONT_SIZE,
  MAX_CHAT_FONT_SIZE,
  MIN_CHAT_FONT_SIZE,
  readStoredChatFontSize,
  writeStoredChatFontSize,
} from '@/lib/chat-preferences';
import { readStoredAIProvider, writeStoredAIProvider } from '@/lib/provider-preferences';
import { AIProvider } from '@/types';
import { useFeedback } from '@/components/common/FeedbackProvider';
import { CodexSetupCard } from '@/components/common/CodexSetupCard';
import { PdfEngineSetupCard } from '@/components/common/PdfEngineSetupCard';
import { ResearchSourcesCard } from '@/components/common/ResearchSourcesCard';
import { APP_VERSION } from '@/lib/app-info';
import { AppHeader } from '@/components/layout/AppHeader';

interface ProviderStatus {
  provider: AIProvider;
  authenticated: boolean;
  error?: string;
  hasRefreshToken?: boolean;
  expiresAt?: number;
  planType?: string;
  email?: string;
  authMethod?: string;
}

interface ProviderValidationResult {
  provider: AIProvider;
  ok: boolean;
  message: string;
  model?: string;
  response?: string;
}

interface TrashRecord {
  id: string;
  kind: 'pdf' | 'folder';
  name: string;
  deletedAt: string;
  expiresAt: string;
}

export default function SettingsPage() {
  const { confirm, notify } = useFeedback();
  const [savedProvider, setSavedProvider] = useState<AIProvider>(DEFAULT_AI_PROVIDER);
  const [candidateProvider, setCandidateProvider] = useState<AIProvider>(DEFAULT_AI_PROVIDER);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [validationResult, setValidationResult] = useState<ProviderValidationResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(DEFAULT_CHAT_FONT_SIZE);
  const [libraryInfo, setLibraryInfo] = useState<{
    root: string;
    oneDriveLikely: boolean;
    backupRetention: number;
    latestBackup?: { fileName: string; size: number; modifiedAt: string } | null;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [rootDraft, setRootDraft] = useState('');
  const [trashItems, setTrashItems] = useState<TrashRecord[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const storedProvider = readStoredAIProvider();
    setSavedProvider(storedProvider);
    setCandidateProvider(storedProvider);
    void checkProvider(storedProvider);
    setChatFontSize(readStoredChatFontSize());
    void fetch('/api/library/info').then((res) => res.json()).then((data) => {
      setLibraryInfo(data);
      setRootDraft(data.root || '');
    }).catch(() => undefined);
    void loadTrash();
  }, []);

  useEffect(() => {
    if (!candidateProvider) return;
    void checkProvider(candidateProvider);
    setValidationResult(null);
  }, [candidateProvider]);

  const getProviderLabel = (provider: AIProvider) => (
    provider === 'claude' ? 'Claude Code' : 'Codex'
  );

  const checkProvider = async (provider: AIProvider) => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/providers/status?provider=${provider}`);
      const data = await res.json();
      setProviderStatus(data);
    } catch {
      setProviderStatus({
        provider,
        authenticated: false,
        error: 'AI 연결 상태를 확인하지 못했습니다.',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleValidateAndSave = async () => {
    setIsValidating(true);
    setValidationResult(null);

    try {
      const res = await fetch('/api/providers/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: candidateProvider }),
      });
      const data = await res.json();
      const result = {
        provider: candidateProvider,
        ok: Boolean(data?.ok),
        message: typeof data?.message === 'string' ? data.message : 'AI 연결 확인에 실패했습니다.',
        model: typeof data?.model === 'string' ? data.model : undefined,
        response: typeof data?.response === 'string' ? data.response : undefined,
      } satisfies ProviderValidationResult;

      setValidationResult(result);

      if (res.ok && result.ok) {
        writeStoredAIProvider(candidateProvider);
        void fetch('/api/library/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiProvider: candidateProvider }),
        });
        setSavedProvider(candidateProvider);
        await checkProvider(candidateProvider);
      }
    } catch {
      setValidationResult({
        provider: candidateProvider,
        ok: false,
        message: 'AI 연결 확인에 실패했습니다.',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleChatFontSizeChange = (value: number) => {
    const nextValue = writeStoredChatFontSize(value);
    setChatFontSize(nextValue);
    void fetch('/api/library/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatFontSize: nextValue }),
    });
  };

  const createAutomaticBackup = async () => {
    setBackupBusy(true);
    setBackupMessage('');
    try {
      const res = await fetch('/api/library/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || '자동 백업을 만들지 못했습니다.');
      setBackupMessage(`자동 백업을 만들었습니다: ${data.fileName}`);
      const infoRes = await fetch('/api/library/info', { cache: 'no-store' });
      if (infoRes.ok) setLibraryInfo(await infoRes.json());
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '자동 백업을 만들지 못했습니다.');
    } finally {
      setBackupBusy(false);
    }
  };

  const importBackup = async (file: File) => {
    setBackupBusy(true);
    setBackupMessage('');
    try {
      const formData = new FormData();
      formData.set('file', file);
      const res = await fetch('/api/library/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || '백업을 가져오지 못했습니다.');
      const skippedDetail = Array.isArray(data.skippedPaths) && data.skippedPaths.length > 0
        ? ` 건너뛴 항목: ${data.skippedPaths.slice(0, 3).join(', ')}`
        : '';
      setBackupMessage(`${data.imported}개 파일을 가져왔습니다. 이름 충돌 ${data.renamed}개는 둘 다 보관했습니다.${skippedDetail}`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '백업을 가져오지 못했습니다.');
    } finally {
      setBackupBusy(false);
    }
  };

  const loadTrash = async () => {
    try {
      const res = await fetch('/api/library/trash', { cache: 'no-store' });
      const data = await res.json();
      setTrashItems(Array.isArray(data) ? data : []);
    } catch {
      setTrashItems([]);
    }
  };

  const saveLibraryRoot = async () => {
    setBackupBusy(true);
    try {
      const res = await fetch('/api/library/info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: rootDraft }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || '경로를 저장하지 못했습니다.');
      setBackupMessage('라이브러리 경로를 저장했습니다. PageDock을 다시 시작하면 적용됩니다.');
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : '경로를 저장하지 못했습니다.');
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreTrash = async (id: string) => {
    const res = await fetch('/api/library/trash', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok || data?.error) notify(data?.error || '복원하지 못했습니다.', 'error');
    await loadTrash();
  };

  const purgeTrash = async (id: string) => {
    const shouldPurge = await confirm({
      title: '휴지통에서 완전히 삭제',
      message: '이 항목을 완전히 삭제할까요? 복원할 수 없습니다.',
      confirmLabel: '완전히 삭제',
      destructive: true,
    });
    if (!shouldPurge) return;
    const res = await fetch(`/api/library/trash?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data?.error) notify(data?.error || '완전히 삭제하지 못했습니다.', 'error');
    await loadTrash();
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <AppHeader active="settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 lg:px-8 lg:py-10">
        <div className="mb-8">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">환경 설정</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-on-surface">PageDock 설정</h1>
          <p className="mt-2 text-sm text-on-surface-variant">AI 연결, 리서치 자료 공급자, 라이브러리와 화면 환경을 관리합니다.</p>
        </div>

        {/* AI Provider */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2 px-1">
            <LogIn size={16} strokeWidth={2} className="text-on-surface-variant" />
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">AI 연결</h2>
          </div>

          <div className="space-y-5 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
            {candidateProvider === 'codex' && <CodexSetupCard />}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-on-surface">기본 AI</p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  새 대화는 이 AI를 사용하며, 기존 대화는 저장된 AI와 모델을 유지합니다.
                </p>
              </div>
              <span className="rounded bg-surface-container px-3 py-1 text-xs font-semibold text-on-surface-variant">
                {getProviderLabel(savedProvider)}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-2">
                  AI 제공자
                </label>
                <select
                  value={candidateProvider}
                  onChange={(event) => setCandidateProvider(event.target.value as AIProvider)}
                  className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none"
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                </select>
              </div>

              <button
                onClick={() => void checkProvider(candidateProvider)}
                disabled={isRefreshing}
                className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} strokeWidth={2} className={isRefreshing ? 'animate-spin' : ''} />
                상태 새로고침
              </button>
            </div>

            <div className="rounded-xl bg-surface-container px-4 py-4">
              {providerStatus === null ? (
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">연결 상태를 확인하는 중...</span>
                </div>
              ) : providerStatus.authenticated ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-emerald-600" />
                    <span className="text-sm font-semibold text-on-surface">
                      이 컴퓨터에서 {getProviderLabel(providerStatus.provider)}를 사용할 수 있습니다
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    {providerStatus.email && <>로그인 계정: {providerStatus.email}. </>}
                    {providerStatus.planType && <>구독: {providerStatus.planType}. </>}
                    {providerStatus.authMethod && <>인증: {providerStatus.authMethod}. </>}
                    {providerStatus.expiresAt && (
                      <>인증 만료일: {new Date(providerStatus.expiresAt).toLocaleDateString('ko-KR')}.
                      {providerStatus.hasRefreshToken && ' 자동 갱신 사용 중.'}</>
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-on-surface-variant">
                    {candidateProvider === 'claude'
                      ? '이 컴퓨터에서 사용할 수 있는 Claude Code 로그인을 확인하지 못했습니다.'
                      : '이 컴퓨터에서 사용할 수 있는 Codex 구독 로그인을 확인하지 못했습니다.'}
                  </p>
                  {providerStatus.error && (
                    <p className="text-xs text-rose-700">{providerStatus.error}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void handleValidateAndSave()}
                disabled={isValidating || isRefreshing}
                className="btn-gradient flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isValidating ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {getProviderLabel(candidateProvider)} 연결 확인 중...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} strokeWidth={2} />
                    연결 확인 후 기본값으로 설정
                  </>
                )}
              </button>

              {candidateProvider !== savedProvider && (
                <span className="text-xs text-on-surface-variant">
                  연결 확인이 끝날 때까지 기존 기본값 {getProviderLabel(savedProvider)}을 유지합니다.
                </span>
              )}
            </div>

            {validationResult && (
              <div className={`rounded-lg px-4 py-3 text-sm ${
                validationResult.ok
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-rose-50 text-rose-800'
              }`}>
                <p className="font-medium">{validationResult.message}</p>
                {(validationResult.model || validationResult.response) && (
                  <p className="mt-1 text-xs opacity-80">
                    {validationResult.model && <>
                      사용 모델: {validationResult.model === AUTO_MODEL_ID
                        ? getAutoModelLabel(validationResult.provider)
                        : validationResult.model}.{' '}
                    </>}
                    {validationResult.response && <>확인 응답: {validationResult.response}</>}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2 px-1">
            <Database size={16} strokeWidth={2} className="text-on-surface-variant" />
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">리서치 자료 공급자</h2>
          </div>
          <ResearchSourcesCard />
        </section>

        {/* Library and backup */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2 px-1">
            <FolderSync size={16} strokeWidth={2} className="text-on-surface-variant" />
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">라이브러리와 백업</h2>
          </div>
          <div className="space-y-5 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
            <div>
              <p className="text-sm font-medium text-on-surface">현재 라이브러리</p>
              <div className="mt-1 flex gap-2">
                <input
                  value={rootDraft}
                  onChange={(event) => setRootDraft(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 font-mono text-xs text-on-surface-variant outline-none focus:border-outline"
                />
                <button onClick={() => void saveLibraryRoot()} disabled={backupBusy || !rootDraft.trim()} className="rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50">
                  경로 저장
                </button>
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">
                {libraryInfo?.oneDriveLikely
                  ? 'OneDrive 경로를 사용 중입니다. 이 폴더를 “이 장치에 항상 유지”로 설정해 주세요.'
                  : '여러 컴퓨터에서 사용하려면 PageDock Library를 개인 OneDrive 또는 iCloud Drive 안의 폴더로 지정할 수 있습니다.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/library/backup?includePdfs=true"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary"
              >
                <Download size={14} /> 전체 ZIP 내보내기
              </a>
              <button
                onClick={() => void createAutomaticBackup()}
                disabled={backupBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50"
              >
                {backupBusy ? <Loader2 size={14} className="animate-spin" /> : <FolderSync size={14} />}
                자동 백업 만들기
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={backupBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50"
              >
                <Upload size={14} /> ZIP 가져오기
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importBackup(file);
                }}
              />
            </div>
            <p className="text-[11px] text-outline">자동 백업은 PDF를 제외한 연구 데이터 최근 {libraryInfo?.backupRetention || 7}개를 유지합니다. 전체 ZIP에는 PDF가 포함되며 로그인 토큰은 포함하지 않습니다.</p>
            {libraryInfo?.latestBackup && (
              <p className="text-[11px] text-on-surface-variant">
                마지막 자동 백업: {new Date(libraryInfo.latestBackup.modifiedAt).toLocaleString('ko-KR')} · {(libraryInfo.latestBackup.size / 1024).toFixed(1)}KB
              </p>
            )}
            {backupMessage && <p className="rounded-lg bg-surface-container px-3 py-2 text-xs text-on-surface">{backupMessage}</p>}

            <div className="border-t border-outline-variant/20 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-on-surface">휴지통</p>
                <span className="text-[11px] text-outline">30일 뒤 자동 삭제</span>
              </div>
              {trashItems.length === 0 ? (
                <p className="text-xs text-on-surface-variant">휴지통이 비어 있습니다.</p>
              ) : (
                <div className="space-y-2">
                  {trashItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{item.name}</span>
                      <span className="text-[10px] text-outline">{new Date(item.expiresAt).toLocaleDateString('ko-KR')} 삭제</span>
                      <button onClick={() => void restoreTrash(item.id)} className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high" title="복원"><RotateCcw size={13} /></button>
                      <button onClick={() => void purgeTrash(item.id)} className="rounded p-1 text-error hover:bg-error-container/20" title="완전히 삭제"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Server */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2 px-1">
            <Server size={16} strokeWidth={2} className="text-on-surface-variant" />
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">실행 환경</h2>
          </div>
          <div className="space-y-4 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-on-surface">로컬 실행 모드</p>
                <p className="text-xs text-on-surface-variant mt-0.5">논문과 연구 데이터는 사용자의 컴퓨터에 저장됩니다.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-emerald-700">정상</span>
              </div>
            </div>
            <PdfEngineSetupCard />
            <div className="border-t border-outline-variant/20 pt-4 text-xs leading-5 text-on-surface-variant">
              <p><span className="font-semibold text-on-surface">PageDock {APP_VERSION}</span> · Windows 및 Apple Silicon macOS 데스크톱</p>
              <p className="mt-1">Annot 프로젝트를 기반으로 수정했으며 Apache License 2.0을 따릅니다.</p>
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section>
          <div className="mb-3 flex items-center gap-2 px-1">
            <Palette size={16} strokeWidth={2} className="text-on-surface-variant" />
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-on-surface-variant">화면</h2>
          </div>
          <div className="space-y-6 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-on-surface">테마</p>
                <p className="text-xs text-on-surface-variant mt-0.5">논문 읽기에 집중한 밝고 간결한 화면</p>
              </div>
              <span className="px-3 py-1 rounded text-xs font-medium bg-surface-container text-on-surface-variant">
                기본
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <p className="text-sm font-medium text-on-surface">대화 글자 크기</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    AI 대화창에 표시되는 글자 크기를 조절합니다.
                  </p>
                </div>
                <span className="min-w-11 rounded bg-surface-container px-2 py-1 text-center text-xs font-semibold text-on-surface-variant">
                  {chatFontSize}px
                </span>
              </div>

              <input
                type="range"
                min={MIN_CHAT_FONT_SIZE}
                max={MAX_CHAT_FONT_SIZE}
                step={1}
                value={chatFontSize}
                onChange={(event) => handleChatFontSizeChange(Number(event.target.value))}
                className="w-full accent-primary"
              />

              <div className="mt-3 rounded-xl bg-surface-container px-3 py-3">
                <div className="text-[10px] uppercase tracking-wider text-outline mb-1">미리보기</div>
                <p
                  className="font-editorial text-on-surface leading-relaxed"
                  style={{ fontSize: `${chatFontSize}px` }}
                >
                  AI 답변은 대화창에서 이 크기로 표시됩니다.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}
