'use client';

import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Database, Download, FolderOpen, FolderSync, Loader2, LogIn, Palette, RefreshCw, RotateCcw, Server, Smartphone, Trash2, Upload } from 'lucide-react';
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
import { DEEPSEEK_WEB_URL } from '@/lib/deepseek-web-bridge';

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

interface MobileBridgeInfo {
  bridgeRoot?: string;
  shelf: Array<{
    documentId: string;
    title: string;
    path?: string;
    missing: boolean;
  }>;
  artifact?: {
    generatedAt: string;
    exportId: string;
    fileName: string;
  };
  conflict: boolean;
  autoPublishEnabled: boolean;
  dirty: boolean;
  status: 'up-to-date' | 'manual-required' | 'automatic-pending' | 'publishing' | 'retry-pending' | 'failed' | 'conflict';
  scheduledAt?: string;
  lastFailureAt?: string;
}

function maskAccountIdentifier(value: string): string {
  const trimmed = value.trim();
  const [local, domain] = trimmed.split('@');
  if (domain) {
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${local.length > 2 ? '***' : '*'}@${domain}`;
  }
  if (trimmed.length <= 3) return `${trimmed.slice(0, 1)}**`;
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-1)}`;
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
  const [mobileBridge, setMobileBridge] = useState<MobileBridgeInfo | null>(null);
  const [bridgeRootDraft, setBridgeRootDraft] = useState('');
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState('');
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
    void loadMobileBridge();
  }, []);

  useEffect(() => {
    if (!candidateProvider) return;
    void checkProvider(candidateProvider);
    setValidationResult(null);
  }, [candidateProvider]);

  const getProviderLabel = (provider: AIProvider) => (
    provider === 'claude' ? 'Claude Code' : 'Codex'
  );

  const chooseLibraryRoot = async () => {
    if (!window.pageDockDesktop) {
      notify('폴더 선택은 설치형 PageDock에서 사용할 수 있습니다.', 'info');
      return;
    }
    const selected = await window.pageDockDesktop.selectDirectory();
    if (selected) setRootDraft(selected);
  };

  const loadMobileBridge = async () => {
    try {
      const response = await fetch('/api/mobile-bridge', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || '모바일 연결 정보를 불러오지 못했습니다.');
      setMobileBridge(data as MobileBridgeInfo);
      setBridgeRootDraft(typeof data?.bridgeRoot === 'string' ? data.bridgeRoot : '');
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : '모바일 연결 정보를 불러오지 못했습니다.');
    }
  };

  const chooseBridgeRoot = async () => {
    if (!window.pageDockDesktop) {
      notify('폴더 선택은 설치형 PageDock에서 사용할 수 있습니다.', 'info');
      return;
    }
    const selected = await window.pageDockDesktop.selectDirectory();
    if (selected) setBridgeRootDraft(selected);
  };

  const saveBridgeRoot = async () => {
    setBridgeBusy(true);
    setBridgeMessage('');
    try {
      const response = await fetch('/api/mobile-bridge', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeRoot: bridgeRootDraft.trim() || null }),
      });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || '연결 폴더를 저장하지 못했습니다.');
      setMobileBridge(data as MobileBridgeInfo);
      setBridgeRootDraft(typeof data?.bridgeRoot === 'string' ? data.bridgeRoot : '');
      setBridgeMessage(data?.bridgeRoot ? '연결 폴더를 준비했습니다. 이 폴더에만 모바일 사본과 백업을 만듭니다.' : '모바일 연결 폴더를 해제했습니다. 기존 연결 폴더의 파일은 삭제하지 않았습니다.');
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : '연결 폴더를 저장하지 못했습니다.');
    } finally {
      setBridgeBusy(false);
    }
  };

  const setMobileAutoPublishEnabled = async (autoPublishEnabled: boolean) => {
    setBridgeBusy(true);
    setBridgeMessage('');
    try {
      const response = await fetch('/api/mobile-bridge', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoPublishEnabled }),
      });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || '자동 발행 설정을 저장하지 못했습니다.');
      setMobileBridge(data as MobileBridgeInfo);
      setBridgeMessage(autoPublishEnabled
        ? '자동 발행을 켰습니다. 관련 기록을 저장한 뒤 90초 동안 변경이 없으면 모바일 사본을 갱신합니다.'
        : '자동 발행을 껐습니다. 원본 기록은 계속 저장되며, 모바일 사본은 필요할 때 직접 발행할 수 있습니다.');
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : '자동 발행 설정을 저장하지 못했습니다.');
    } finally {
      setBridgeBusy(false);
    }
  };

  const publishMobileBridge = async (preserveConflict = false) => {
    setBridgeBusy(true);
    setBridgeMessage('');
    try {
      const response = await fetch('/api/mobile-bridge/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preserveConflict }),
      });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || '모바일 사본을 만들지 못했습니다.');
      setBridgeMessage(`모바일 사본을 만들었습니다. ${data.documentCount}개 문서의 기록을 연결 폴더에 저장했습니다.`);
      await loadMobileBridge();
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : '모바일 사본을 만들지 못했습니다.');
      await loadMobileBridge();
    } finally {
      setBridgeBusy(false);
    }
  };

  const createManualBridgeBackup = async () => {
    setBridgeBusy(true);
    setBridgeMessage('');
    try {
      const response = await fetch('/api/library/backup?target=bridge-manual', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || '전체 백업을 만들지 못했습니다.');
      setBridgeMessage(`PDF를 포함한 수동 전체 백업을 만들었습니다: ${data.fileName}`);
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : '전체 백업을 만들지 못했습니다.');
    } finally {
      setBridgeBusy(false);
    }
  };

  const removeMobileShelfItem = async (documentId: string) => {
    setBridgeBusy(true);
    setBridgeMessage('');
    try {
      const response = await fetch(`/api/mobile-bridge/shelf?documentId=${encodeURIComponent(documentId)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || '모바일 보관함에서 제거하지 못했습니다.');
      setMobileBridge(data as MobileBridgeInfo);
      setBridgeMessage('모바일 보관함에서 제거했습니다. 다음 갱신 사본에는 이 문서가 포함되지 않습니다.');
    } catch (error) {
      setBridgeMessage(error instanceof Error ? error.message : '모바일 보관함에서 제거하지 못했습니다.');
    } finally {
      setBridgeBusy(false);
    }
  };

  const mobileBridgeStatusMessage = () => {
    if (!mobileBridge) return '';
    if (mobileBridge.status === 'conflict') return '외부 수정 또는 삭제 감지 · 자동 발행 중지됨';
    if (mobileBridge.status === 'publishing') return '모바일 사본 만드는 중…';
    if (mobileBridge.status === 'retry-pending') return mobileBridge.scheduledAt
      ? `발행 실패 · ${new Date(mobileBridge.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 한 번 다시 시도`
      : '발행 실패 · 한 번 다시 시도 예정';
    if (mobileBridge.status === 'failed') return '발행 실패 · Windows 원본에는 정상 저장되었습니다.';
    if (mobileBridge.status === 'automatic-pending') return mobileBridge.scheduledAt
      ? `새 변경 있음 · 자동 발행 대기 (${new Date(mobileBridge.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})`
      : '새 변경 있음 · 자동 발행 대기';
    if (mobileBridge.status === 'manual-required') return '새 변경 있음 · 수동 발행 필요';
    return mobileBridge.artifact ? `최신 상태 · ${new Date(mobileBridge.artifact.generatedAt).toLocaleString('ko-KR')} 발행` : '아직 모바일 사본을 만들지 않았습니다.';
  };

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

  const openDeepSeekWeb = async () => {
    try {
      if (window.pageDockDesktop?.deepseekWeb) {
        const result = await window.pageDockDesktop.deepseekWeb.open();
        notify(
          result.mode === 'external-fallback'
            ? '앱 창을 열지 못해 기본 브라우저에서 DeepSeek를 열었습니다.'
            : 'DeepSeek 웹 창을 열었습니다. 로그인과 질문 전송은 그 창에서 직접 진행하세요.',
          'info',
        );
        return;
      }

      window.open(DEEPSEEK_WEB_URL, '_blank', 'noopener,noreferrer');
      notify('기본 브라우저에서 DeepSeek를 열었습니다.', 'info');
    } catch {
      notify('DeepSeek 웹을 열지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  };

  const clearDeepSeekWebSession = async () => {
    if (!window.pageDockDesktop?.deepseekWeb) {
      notify('웹 로그인 세션 삭제는 설치형 PageDock에서 사용할 수 있습니다.', 'info');
      return;
    }

    const approved = await confirm({
      title: '저장된 DeepSeek 웹 로그인 세션 삭제',
      message: '이 PC의 DeepSeek 전용 웹 쿠키와 사이트 데이터를 삭제합니다. PDF, 공부 기록, 가져온 DeepSeek 답변은 삭제되지 않습니다.',
      confirmLabel: '웹 로그인 세션 삭제',
      destructive: true,
    });
    if (!approved) return;

    try {
      await window.pageDockDesktop.deepseekWeb.clearStoredSession();
      notify('저장된 DeepSeek 웹 로그인 세션을 삭제했습니다.', 'success');
    } catch {
      notify('DeepSeek 웹 로그인 세션을 삭제하지 못했습니다.', 'error');
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
                    {providerStatus.email && <>로그인 계정: {maskAccountIdentifier(providerStatus.email)}. </>}
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

          <div className="mt-4 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold text-on-surface">DeepSeek 웹 보조</p>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">논문을 읽다가 다른 관점이 필요할 때 DeepSeek 웹에서 같은 질문을 한 번 더 확인합니다. PageDock은 질문을 자동 전송하거나 DeepSeek 답변을 자동으로 읽지 않습니다.</p>
              </div>
              <button
                type="button"
                onClick={() => void openDeepSeekWeb()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                <Server size={14} /> DeepSeek 웹 열기
              </button>
            </div>
            <p className="mt-3 rounded-lg bg-surface-container px-3 py-2 text-[11px] leading-5 text-on-surface-variant">로그인은 DeepSeek 웹 화면에서 직접 합니다. 로그인 상태 유지를 위해 DeepSeek 전용 웹 세션이 이 PC에 저장될 수 있으며, PageDock은 비밀번호·쿠키·인증 토큰을 읽거나 저장하지 않습니다.</p>
            <button
              type="button"
              onClick={() => void clearDeepSeekWebSession()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
            >
              <Trash2 size={13} /> 저장된 웹 로그인 세션 삭제
            </button>
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
                  aria-label="PageDock Library 경로"
                  className="min-w-0 flex-1 rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 font-mono text-xs text-on-surface-variant outline-none focus:border-outline"
                />
                <button type="button" onClick={() => void chooseLibraryRoot()} disabled={backupBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50">
                  <FolderOpen size={14} /> 폴더 선택
                </button>
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
            <div className="mt-5 rounded-xl border border-outline-variant/25 bg-surface-container-low p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-on-surface"><Smartphone size={15} /> 휴대폰에서 읽기</p>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-on-surface-variant">선택한 문서의 밑줄, 메모, AI 답변, 복습 카드와 그림·표 기록을 휴대폰용 읽기 전용 PDF로 만듭니다. PageDock Library가 원본이며, 휴대폰 사본에서 한 수정은 PageDock으로 돌아오지 않습니다.</p>
                </div>
                {mobileBridge?.conflict && <span className="rounded-full bg-study-unclear-container px-2 py-1 text-[10px] font-semibold text-study-unclear">외부 수정 확인 필요</span>}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={bridgeRootDraft}
                  onChange={(event) => setBridgeRootDraft(event.target.value)}
                  aria-label="모바일 읽기 사본 연결 폴더 경로"
                  placeholder="Google Drive 등의 별도 연결 폴더"
                  className="min-w-0 flex-1 rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 font-mono text-xs text-on-surface-variant outline-none focus:border-outline"
                />
                <button type="button" onClick={() => void chooseBridgeRoot()} disabled={bridgeBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50">
                  <FolderOpen size={14} /> 폴더 선택
                </button>
                <button type="button" onClick={() => void saveBridgeRoot()} disabled={bridgeBusy} className="rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50">
                  연결 저장
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-outline">Google Drive Desktop, OneDrive, Dropbox 등의 일반 동기화 폴더를 선택할 수 있습니다. 연결 폴더는 PageDock Library와 분리되어야 하며, PageDock은 해당 서비스에 직접 로그인하거나 동기화하지 않습니다.</p>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-surface-container px-3 py-2.5 text-xs text-on-surface-variant">
                <input
                  type="checkbox"
                  checked={mobileBridge?.autoPublishEnabled ?? false}
                  disabled={bridgeBusy || !mobileBridge?.bridgeRoot}
                  onChange={(event) => void setMobileAutoPublishEnabled(event.target.checked)}
                  className="mt-0.5 size-3.5 accent-primary"
                />
                <span>
                  <span className="block font-semibold text-on-surface">변경 후 자동 발행</span>
                  <span className="mt-0.5 block leading-4">기본은 꺼져 있습니다. 앱이 실행 중일 때 관련 기록을 저장한 뒤 90초 동안 변경이 없으면 갱신하며, 잦은 재생성을 막기 위해 자동 발행은 최소 10분 간격으로 실행됩니다.</span>
                </span>
              </label>

              <p className={`mt-3 text-xs font-medium ${mobileBridge?.status === 'conflict' || mobileBridge?.status === 'failed' ? 'text-study-unclear' : 'text-on-surface-variant'}`}>
                {mobileBridgeStatusMessage()}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void publishMobileBridge(false)}
                  disabled={bridgeBusy || !mobileBridge?.bridgeRoot}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary disabled:opacity-50"
                >
                  {bridgeBusy ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
                  휴대폰용 읽기 PDF 만들기
                </button>
                {mobileBridge?.conflict && (
                  <button
                    type="button"
                    onClick={() => void publishMobileBridge(true)}
                    disabled={bridgeBusy || !mobileBridge?.bridgeRoot}
                    className="inline-flex items-center gap-2 rounded-lg bg-study-unclear-container px-3 py-2 text-xs font-semibold text-study-unclear disabled:opacity-50"
                  >
                    수정본 보존 후 새로 만들기
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] font-medium text-outline">모바일 사본은 백업이 아닙니다. 원본 PDF와 공부 기록을 복구하려면 아래의 PageDock 복구 백업을 사용하세요.</p>
              {mobileBridge?.artifact && (
                <p className="mt-2 text-[11px] text-on-surface-variant">마지막 모바일 사본: {new Date(mobileBridge.artifact.generatedAt).toLocaleString('ko-KR')} · {mobileBridge.artifact.fileName}</p>
              )}

              <div className="mt-4 rounded-xl bg-surface-container p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-on-surface">모바일 보관함</p>
                  <span className="text-[10px] text-outline">PDF 리더의 더보기 메뉴에서 현재 문서를 추가합니다.</span>
                </div>
                {!mobileBridge?.shelf.length ? (
                  <p className="mt-2 text-xs text-on-surface-variant">아직 넣은 문서가 없습니다. 중요한 문서만 직접 추가하면 예상치 못한 자료가 연결 폴더로 나가지 않습니다.</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {mobileBridge.shelf.map((item) => (
                      <div key={item.documentId} className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-2.5 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-on-surface" title={item.path || item.title}>{item.title}</span>
                        {item.missing && <span className="text-[10px] text-study-unclear">원본 찾기 필요</span>}
                        <button type="button" onClick={() => void removeMobileShelfItem(item.documentId)} disabled={bridgeBusy} className="rounded px-1.5 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">제거</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {bridgeMessage && <p className="mt-3 rounded-lg bg-surface-container px-3 py-2 text-xs text-on-surface">{bridgeMessage}</p>}
            </div>
            <div className="mt-5 rounded-xl border border-outline-variant/25 bg-surface-container-low p-4">
              <p className="text-sm font-medium text-on-surface">PageDock 복구 백업</p>
              <p className="mt-1 text-xs leading-5 text-on-surface-variant">PageDock의 원본 PDF와 공부 기록을 복구하기 위한 ZIP입니다. 모바일 읽기 사본과는 별개입니다. 수동 백업은 자동 삭제하지 않고, 자동 백업은 최신 3개만 유지합니다.</p>
              <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/api/library/backup?includePdfs=true"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary"
              >
                <Download size={14} /> 복구 ZIP 내보내기
              </a>
              <button
                type="button"
                onClick={() => void createManualBridgeBackup()}
                disabled={bridgeBusy || !mobileBridge?.bridgeRoot}
                className="inline-flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50"
              >
                <Download size={14} /> 연결 폴더에 수동 복구 백업
              </button>
              <button
                onClick={() => void createAutomaticBackup()}
                disabled={backupBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50"
              >
                {backupBusy ? <Loader2 size={14} className="animate-spin" /> : <FolderSync size={14} />}
                지금 자동 백업 만들기
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={backupBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50"
              >
                <Upload size={14} /> 복구 ZIP 가져오기
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
            </div>
            <p className="text-[11px] text-outline">자동 백업은 PDF를 제외한 연구 데이터 최근 {libraryInfo?.backupRetention || 3}개를 유지합니다. 연결 폴더가 있으면 검증된 같은 ZIP을 그곳에도 복사하고, 두 위치의 자동 백업은 각각 최근 3개만 남깁니다. 수동 전체 ZIP은 자동으로 지우지 않으며 PDF가 포함되고, 로그인 토큰은 포함하지 않습니다.</p>
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
              <p><span className="font-semibold text-on-surface">PageDock {APP_VERSION}</span> · Windows 10/11 x64 데스크톱</p>
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
                aria-label="대화 글자 크기"
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
