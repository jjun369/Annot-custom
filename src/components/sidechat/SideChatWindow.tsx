'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  MessageSquarePlus,
  PanelRightClose,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

import { WebAiHandoffPanel } from './WebAiHandoffPanel';
import { SideChatComparisonDialog } from './SideChatComparisonDialog';
import { ChatMarkdown } from '@/components/workspace/ChatMarkdown';
import { readStoredAIProvider } from '@/lib/provider-preferences';
import {
  AUTO_MODEL_ID,
  getAutoModelLabel,
  normalizeModelPreference,
} from '@/lib/ai-providers/model-policy';
import {
  AUTO_REASONING_EFFORT,
  getReasoningEffortLabel,
  normalizeReasoningEffort,
  readStoredReasoningEffort,
} from '@/lib/ai-providers/reasoning-policy';
import { normalizeChatSourceContext } from '@/lib/ai-providers/source-context';
import { shouldSubmitChatOnEnter } from '@/lib/chat-keyboard';
import {
  resolveSideChatTarget,
  canUseSideChatSource,
  getSideChatModeLabel,
  SIDE_CHAT_WEB_PROVIDERS,
} from '@/lib/side-chat';
import { AIProvider, ChatMessage, ChatSourceContext, ReasoningEffort, Session, SideChatOutboundMode, SideChatWebPerspective, SideChatWebProviderId } from '@/types';

type SideChatTab = 'pagedock' | 'web';
type ChatStreamEvent = {
  type: 'assistant_delta' | 'final' | 'error' | string;
  text?: string;
  content?: string;
  message?: string;
  model?: string;
  provider?: AIProvider;
  session?: Session;
};

interface SideChatDraft {
  input: string;
  sourceContext?: ChatSourceContext;
  sourcePdfPath?: string;
  promptMode: SideChatOutboundMode;
  webProvider: SideChatWebProviderId;
}

interface WebComparisonState {
  sessionId: string;
  question: ChatMessage;
  answer?: ChatMessage;
  perspective: SideChatWebPerspective;
}

const SIDE_CHAT_REASONING_LEVELS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function providerLabel(provider: SideChatWebProviderId): string {
  return SIDE_CHAT_WEB_PROVIDERS.find((item) => item.id === provider)?.label || provider;
}

function latestUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'user' && message.content.trim());
}

function sourceLabel(sourceContext: ChatSourceContext | undefined): string {
  if (!sourceContext) return '';
  return `원문 연결${sourceContext.page ? ` · p.${sourceContext.page}` : ''}`;
}

export function SideChatWindow() {
  const [namespace, setNamespace] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { void fetch('/api/side-chat/requests').then(async (r) => { if (!r.ok) throw new Error(); const data = await r.json(); setNamespace(data.namespace); }).catch(() => setFailed(true)); }, []);
  if (!namespace) return <p className="p-4">{failed ? 'Library를 확인하지 못했습니다. 창을 다시 열어 주세요.' : 'Library 확인 중…'}</p>;
  return <SideChatContent key={namespace} namespace={namespace} />;
}

function SideChatContent({ namespace }: { namespace: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const DRAFT_STORAGE_KEY = `pagedock:sidechat:draft:v2:${namespace}:${activeSessionId || 'new'}`;
  const draftCache = useRef(new Map<string, SideChatDraft>());
  const [hydratedKey, setHydratedKey] = useState('');
  const handoffRead = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sourceContext, setSourceContext] = useState<ChatSourceContext | undefined>();
  const [sourcePdfPath, setSourcePdfPath] = useState<string | undefined>();
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(() => readStoredAIProvider());
  const [selectedModel, setSelectedModel] = useState(AUTO_MODEL_ID);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(() => readStoredReasoningEffort());
  const [models, setModels] = useState<Array<{ id: string; display_name?: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [activeTab, setActiveTab] = useState<SideChatTab>('pagedock');
  const [activeWebProvider, setActiveWebProvider] = useState<SideChatWebProviderId>('deepseek');
  const [promptMode, setPromptMode] = useState<SideChatOutboundMode>('question');
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<WebComparisonState | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const composerFingerprintRef = useRef<string>('');
  const requestFingerprintRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const forceNewSessionRef = useRef(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>();
  const [savedTargetActive, setSavedTargetActive] = useState(false);
  const questionFlight = useRef<Promise<{ session: Session; question: ChatMessage } | null> | null>(null);
  const sessionFlight = useRef<Promise<Session> | null>(null);
  activeSessionIdRef.current = activeSessionId;
  composerFingerprintRef.current = JSON.stringify({
    questionText: input.trim(),
    sourceContext: sourceContext || null,
    sourcePdfPath: sourcePdfPath || null,
  });

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const selectedAnswer = selectedAnswerId
    ? messages.find((message) => message.id === selectedAnswerId && message.role === 'assistant')
    : undefined;
  const selectedQuestion = selectedAnswer?.replyToMessageId
    ? messages.find((message) => message.id === selectedAnswer.replyToMessageId && message.role === 'user')
    : undefined;
  const persistedWebQuestion = selectedQuestion || latestUserMessage(messages);
  const resolvedTarget = resolveSideChatTarget(savedTargetActive ? '' : input, sourceContext, sourcePdfPath, messages, selectedQuestionId || persistedWebQuestion?.id, selectedAnswerId || undefined);

  const refreshSessions = useCallback(async (): Promise<Session[]> => {
    try {
      const params = new URLSearchParams({ folderPath: '.', sessionKind: 'sidechat' });
      const response = await fetch(`/api/sessions?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error('사이드채팅 목록을 불러오지 못했습니다.');
      const nextSessions = data as Session[];
      setSessions(nextSessions);
      setActiveSessionId((current) => current && data.some((session: Session) => session.id === current)
        ? current
        : data[0]?.id || null);
      return nextSessions;
    } catch {
      setStatusMessage('사이드채팅 목록을 불러오지 못했습니다. 새 대화는 다시 시도할 수 있습니다.');
      return [];
    } finally {
      setSessionsLoaded(true);
    }
  }, []);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  useEffect(() => {
    let cancelled = false;
    setSavedTargetActive(false);
    setSelectedQuestionId(undefined);
    if (!activeSessionId) {
      setMessages([]);
      setStreamingText('');
      setSelectedAnswerId(null);
      setComparison(null);
      return () => { cancelled = true; };
    }
    setStreamingText('');
    setSelectedAnswerId(null);
    setComparison(null);
    setSessionLoading(true);
    void fetch(`/api/sessions?folderPath=.&sessionId=${encodeURIComponent(activeSessionId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data?.id) throw new Error('사이드채팅을 불러오지 못했습니다.');
        if (cancelled) return;
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setSelectedProvider(data.provider === 'claude' ? 'claude' : 'codex');
        setSelectedModel(typeof data.model === 'string' && data.model ? data.model : AUTO_MODEL_ID);
        setSelectedReasoningEffort(normalizeReasoningEffort(data.reasoningEffort));
      })
      .catch(() => {
        if (!cancelled) setStatusMessage('사이드채팅을 불러오지 못했습니다. 로컬 기록은 유지됩니다.');
      })
      .finally(() => { if (!cancelled) setSessionLoading(false); });
    return () => { cancelled = true; };
  }, [activeSessionId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      {
        const saved = draftCache.current.get(DRAFT_STORAGE_KEY) || (raw ? JSON.parse(raw) : {}) as Partial<SideChatDraft>;
        setInput(typeof saved.input === 'string' ? saved.input : '');
        setSourceContext(normalizeChatSourceContext(saved.sourceContext));
        setSourcePdfPath(typeof saved.sourcePdfPath === 'string' ? saved.sourcePdfPath : undefined);
        if (saved.promptMode === 'question' || saved.promptMode === 'source-question' || saved.promptMode === 'source-question-answer') setPromptMode(saved.promptMode);
        if (saved.webProvider && SIDE_CHAT_WEB_PROVIDERS.some((provider) => provider.id === saved.webProvider)) setActiveWebProvider(saved.webProvider);
      }
      const handoffValue = new URLSearchParams(window.location.search).get('handoff');
      if (handoffValue && !handoffRead.current) {
        handoffRead.current = true;
        const handoff = JSON.parse(handoffValue) as { sourceContext?: unknown; pdfPath?: unknown };
        const handoffSource = normalizeChatSourceContext(handoff.sourceContext);
        if (handoffSource && canUseSideChatSource(handoffSource)) {
          setSourceContext(handoffSource);
          setSourcePdfPath(typeof handoff.pdfPath === 'string' ? handoff.pdfPath : undefined);
          setPromptMode('source-question');
          setStatusMessage('선택 원문을 초안으로 받았습니다. 질문을 입력한 뒤 직접 전송하세요.');
        }
      }
    } catch {
      setStatusMessage('기기 초안을 읽지 못했습니다. 저장된 대화는 그대로 유지됩니다.');
    } finally {
      setDraftHydrated(true);
      setHydratedKey(DRAFT_STORAGE_KEY);
    }
  }, [DRAFT_STORAGE_KEY]);

  useEffect(() => {
    const desktop = window.pageDockDesktop?.sideChat;
    if (!desktop) return;
    const unsubscribeHandoff = desktop.onHandoff((handoff) => {
      const handoffSource = normalizeChatSourceContext(handoff.sourceContext);
      if (!handoffSource || !canUseSideChatSource(handoffSource)) return;
      setSourceContext(handoffSource);
      setSourcePdfPath(typeof handoff.pdfPath === 'string' ? handoff.pdfPath : undefined);
      setPromptMode('source-question');
      setActiveTab('pagedock');
      setStatusMessage('선택 원문을 초안으로 받았습니다. 질문을 입력한 뒤 직접 전송하세요.');
    });
    return () => { unsubscribeHandoff(); };
  }, []);

  useEffect(() => {
    if (!draftHydrated || hydratedKey !== DRAFT_STORAGE_KEY) return;
    const draft: SideChatDraft = { input, sourceContext, sourcePdfPath, promptMode, webProvider: activeWebProvider };
    draftCache.current.set(DRAFT_STORAGE_KEY, draft);
    try { window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); } catch { setStatusMessage('기기 초안 저장 실패 · 입력은 이 창에 유지됩니다. 닫기 전 복사하거나 질문을 저장해 주세요.'); }
  }, [DRAFT_STORAGE_KEY, hydratedKey, activeWebProvider, draftHydrated, input, promptMode, sourceContext, sourcePdfPath]);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    void fetch(`/api/models?provider=${encodeURIComponent(selectedProvider)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!cancelled && response.ok && Array.isArray(data.models)) {
          setModels(data.models);
          setSelectedModel((current) => data.models.some((model: { id: string }) => model.id === current) ? current : (data.models[0]?.id || AUTO_MODEL_ID));
        }
      })
      .catch(() => { if (!cancelled) setModels([]); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedProvider]);

  const createOrFindSideSession = useCallback(async (): Promise<Session> => {
    if (activeSession) return activeSession;
    const availableSessions = sessionsLoaded ? sessions : await refreshSessions();
    const existing = forceNewSessionRef.current ? undefined : availableSessions[0];
    if (existing) {
      activeSessionIdRef.current = existing.id;
      setActiveSessionId(existing.id);
      return existing;
    }
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: '.',
        title: 'PageDock 사이드채팅',
        provider: selectedProvider,
        model: selectedModel || undefined,
        reasoningEffort: selectedReasoningEffort,
        sessionKind: 'sidechat',
      }),
    });
    const data = await response.json();
    if (!response.ok || !data?.id) throw new Error(data?.error || '사이드채팅을 시작하지 못했습니다.');
    const created = data as Session;
    forceNewSessionRef.current = false;
    setSessions((current) => [created, ...current]);
    activeSessionIdRef.current = created.id;
    setActiveSessionId(created.id);
    setMessages([]);
    return created;
  }, [activeSession, refreshSessions, selectedModel, selectedProvider, selectedReasoningEffort, sessions, sessionsLoaded]);
  const ensureSideSession = useCallback(() => {
    if (!sessionFlight.current) sessionFlight.current = createOrFindSideSession().finally(() => { sessionFlight.current = null; });
    return sessionFlight.current;
  }, [createOrFindSideSession]);


  const refreshActiveSession = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/sessions?folderPath=.&sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data?.id) throw new Error('사이드채팅을 새로 고치지 못했습니다.');
    if (activeSessionIdRef.current === sessionId) {
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    }
    setSessions((current) => current.map((session) => session.id === sessionId ? data as Session : session));
    return data as Session;
  }, []);

  const saveReflection = useCallback(async (sessionId: string, questionId: string, text: string) => {
    const response = await fetch('/api/side-chat/reflections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: '.', sessionId, questionMessageId: questionId, text }),
    });
    const data = await response.json().catch(() => null) as { error?: string; reflection?: ChatMessage['sideChatReflection'] } | null;
    if (!response.ok) throw new Error(data?.error || '사이드채팅 메모를 저장하지 못했습니다.');
    const patch = (items: ChatMessage[]) => items.map((message) => {
      if (message.id !== questionId) return message;
      const next = { ...message };
      if (data?.reflection) next.sideChatReflection = data.reflection;
      else delete next.sideChatReflection;
      return next;
    });
    if (activeSessionIdRef.current === sessionId) setMessages(patch);
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, messages: patch(session.messages) } : session));
  }, []);

  const saveLocalQuestionForWeb = useCallback(async (): Promise<{ session: Session; question: ChatMessage } | null> => {
    const questionText = input.trim();
    if (!questionText) return null;
    const fingerprint = JSON.stringify({ questionText, sourceContext, sourcePdfPath });
    const requestId = requestFingerprintRef.current?.fingerprint === fingerprint
      ? requestFingerprintRef.current.requestId
      : crypto.randomUUID();
    requestFingerprintRef.current = { fingerprint, requestId };
    const session = await ensureSideSession();
    const response = await fetch('/api/side-chat/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: '.',
        sessionId: session.id,
        requestId,
        prompt: questionText,
        sourceContext,
        sourcePdfPath,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data?.questionMessage || !data?.session) throw new Error(data?.error || '질문을 로컬에 저장하지 못했습니다.');
    const savedQuestion = data.questionMessage as ChatMessage;
    const savedSession = data.session as Session;
    const isCurrentSession = activeSessionIdRef.current === session.id;
    const appendQuestion = (items: ChatMessage[]) => items.some((m) => m.id === savedQuestion.id) ? items : [...items, savedQuestion];
    if (isCurrentSession) setMessages(appendQuestion);
    setSessions((current) => current.map((item) => item.id === session.id ? { ...item, messages: appendQuestion(item.messages) } : item));
    requestFingerprintRef.current = null;
    if (isCurrentSession && composerFingerprintRef.current === JSON.stringify({ questionText, sourceContext: sourceContext || null, sourcePdfPath: sourcePdfPath || null })) {
      setInput('');
      setSourceContext(undefined);
      setSourcePdfPath(undefined);
      setSelectedQuestionId(savedQuestion.id);
    }
    return { session: savedSession, question: savedQuestion };
  }, [ensureSideSession, input, sourceContext, sourcePdfPath]);

  const ensureWebQuestion = async () => {
    if (resolvedTarget.question) return { sessionId: activeSessionId!, question: resolvedTarget.question };
    if (!questionFlight.current) questionFlight.current = saveLocalQuestionForWeb().finally(() => { questionFlight.current = null; });
    const saved = await questionFlight.current;
    if (!saved) throw new Error('질문을 입력해 주세요.');
    return { sessionId: saved.session.id, question: saved.question };
  };
  const handleOpenWeb = async () => {
    try { const saved = await ensureWebQuestion(); if (activeSessionIdRef.current === saved.sessionId) setActiveTab('web'); } catch (error) { setStatusMessage(error instanceof Error ? error.message : '질문 저장 실패'); }
  };

  const jumpToSource = async (question: ChatMessage) => {
    const source = question.sourceContext;
    const pdfPath = question.sourcePdfPath;
    if (!source?.page || !pdfPath) {
      setStatusMessage('원문 경로가 보존되지 않은 기록입니다. 현재 웹 상태는 유지됩니다.');
      return;
    }
    if (window.pageDockDesktop?.sideChat) {
      const result = await window.pageDockDesktop.sideChat.sourceJump({
        id: `sidechat-source-${question.id}`,
        pdfPath,
        documentId: source.documentId,
        page: source.page,
        rects: source.rects,
      });
      setStatusMessage(result.delivered ? 'PageDock Reader에 원문 위치를 열었습니다.' : 'PageDock Reader 창을 찾지 못했습니다. 사이드채팅은 유지됩니다.');
      return;
    }
    void window.open(`/?pdf=${encodeURIComponent(pdfPath)}&page=${source.page}`, '_blank');
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;
    const originalSource = sourceContext;
    const originalSourcePdfPath = sourcePdfPath;
    const draftFingerprint = composerFingerprintRef.current;
    setSending(true);
    setStreamingText('');
    setStatusMessage('');
    let session: Session | null = null;
    try {
      session = await ensureSideSession();
      const fingerprint = JSON.stringify({ sessionId: session.id, prompt, originalSource, originalSourcePdfPath });
      const userMessageId = requestFingerprintRef.current?.fingerprint === fingerprint ? requestFingerprintRef.current.requestId : makeId('side-user');
      requestFingerprintRef.current = { fingerprint, requestId: userMessageId };
      const optimisticUser: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        ...(originalSource ? { sourceContext: originalSource } : {}),
        ...(originalSourcePdfPath ? { sourcePdfPath: originalSourcePdfPath } : {}),
      };
      if (activeSessionIdRef.current === session.id) {
        setMessages((current) => current.some((m) => m.id === userMessageId) ? current : [...current, optimisticUser]);
      }
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: '.',
          sessionId: session.id,
          prompt,
          userMessageId,
          model: selectedModel,
          reasoningEffort: selectedReasoningEffort,
          currentPdfPath: null,
          sourceContext: originalSource,
          sourcePdfPath: originalSourcePdfPath,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'PageDock AI에 연결하지 못했습니다. 질문은 다시 시도할 수 있습니다.');
      }
      if (!response.body) throw new Error('AI streaming 응답을 사용할 수 없습니다.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line) continue;
          const event = JSON.parse(line) as ChatStreamEvent;
          if (event.type === 'assistant_delta' && event.text && activeSessionIdRef.current === session!.id) setStreamingText((current) => `${current}${event.text}`);
          if (event.type === 'error') throw new Error(event.message || 'PageDock AI가 답변하지 못했습니다. 질문은 로컬에 남아 있습니다.');
          if (event.type === 'final') {
            const fallbackAssistant: ChatMessage = {
              id: makeId('side-assistant'),
              role: 'assistant',
              content: event.content || '',
              timestamp: new Date().toISOString(),
              ...(event.model ? { model: event.model } : {}),
              replyToMessageId: userMessageId,
            };
            const assistant = event.session?.messages.find((m) => m.role === 'assistant' && m.replyToMessageId === userMessageId) || fallbackAssistant;
            const appendAnswer = (items: ChatMessage[]) => items.some((m) => m.id === assistant.id) ? items : [...items, assistant];
            if (activeSessionIdRef.current === session!.id) setMessages(appendAnswer);
            if (event.session) setSessions((current) => current.map((item) => item.id === event.session!.id ? { ...item, providerSessionId: event.session!.providerSessionId, messages: appendAnswer(item.messages) } : item));
            completed = true;
          }
        }
      }
      if (!completed) throw new Error('AI 응답이 끝나기 전에 연결이 종료되었습니다. 질문은 로컬에 남아 있습니다.');
      if (activeSessionIdRef.current === session.id) setStreamingText('');
      requestFingerprintRef.current = null;
      if (activeSessionIdRef.current === session.id && composerFingerprintRef.current === draftFingerprint) {
        setInput('');
        setSourceContext(undefined);
        setSourcePdfPath(undefined);
        setStreamingText('');
      }
    } catch (error) {
      if (session && activeSessionIdRef.current === session.id) {
        await refreshActiveSession(session.id).catch(() => undefined);
        if (composerFingerprintRef.current === draftFingerprint) setInput((current) => current || prompt);
      }
      setStatusMessage(error instanceof Error ? error.message : 'PageDock AI에 연결하지 못했습니다.');
      if (!session || activeSessionIdRef.current === session.id) setStreamingText('');
    } finally {
      setSending(false);
    }
  };

  const chooseAnswerForWeb = (message: ChatMessage) => {
    if (message.role !== 'assistant') return;
    setSelectedAnswerId(message.id);
    setSelectedQuestionId(message.replyToMessageId);
    setSavedTargetActive(true);
    setPromptMode(message.sourceContext?.scope === 'selection' ? 'source-question-answer' : 'question-answer');
    setActiveWebProvider('deepseek');
    setActiveTab('web');
  };

  const newChat = () => {
    forceNewSessionRef.current = true;
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages([]);
    setSelectedQuestionId(undefined);
    setSelectedAnswerId(null);
    setComparison(null);
    setStatusMessage('새 사이드 대화를 준비했습니다. 기존 기록은 보존됩니다.');
  };

  const renderPerspective = (question: ChatMessage, perspective: SideChatWebPerspective) => (
    <div key={perspective.id} className="mt-2 rounded-xl border border-ai-reference/20 bg-ai-reference-container/35 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-ai-reference">{providerLabel(perspective.provider)} · 직접 붙여넣은 설명</span>
        <button type="button" onClick={() => activeSessionIdRef.current && setComparison({ sessionId: activeSessionIdRef.current, question, answer: messages.find((message) => message.replyToMessageId === question.id && message.role === 'assistant'), perspective })} className="rounded-md px-1.5 py-1 text-[10px] font-semibold text-ai-reference hover:bg-ai-reference-container" aria-label="웹 답변 비교 보기">
          <ArrowLeftRight size={11} className="mr-1 inline" /> 비교
        </button>
      </div>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-5 text-on-surface-variant">{perspective.responseText}</p>
      <p className="mt-1 text-[10px] text-outline">전송 범위: {getSideChatModeLabel(perspective.promptMode)}{perspective.model ? ` · 모델 표기: ${perspective.model} (확인 안 됨)` : ''}</p>
    </div>
  );

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user';
    return (
      <article key={message.id} className={`flex gap-2.5 ${isUser ? 'justify-end' : ''}`}>
        {!isUser && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container text-primary"><Sparkles size={13} /></div>}
        <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${isUser ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}`}>
          {isUser && <button className="mb-2 block text-[11px] underline" onClick={() => { setSelectedQuestionId(message.id); setSelectedAnswerId(null); setSavedTargetActive(true); setActiveTab('web'); }}>이 질문 웹 요청 보기</button>}
          {isUser ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : <ChatMarkdown content={message.content} fontSize={14} className="chat-markdown break-words" />}
          {message.sourceContext && (
            <button type="button" onClick={() => void jumpToSource(message)} className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${isUser ? 'bg-white/15 text-white' : 'bg-surface-container-lowest text-on-surface-variant hover:bg-primary-container hover:text-primary'}`} title="Reader 원문으로 돌아가기">
              <MapPin size={10} /> {sourceLabel(message.sourceContext)}
            </button>
          )}
          {isUser && message.sideChatPerspectives?.map((perspective) => renderPerspective(message, perspective))}
          {!isUser && message.content.trim() && !message.content.trim().startsWith('**오류') && (
            <button type="button" onClick={() => chooseAnswerForWeb(message)} className="mt-2 inline-flex items-center gap-1 rounded-full border border-outline-variant/25 px-2 py-1 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container-lowest hover:text-primary" title="이 답변을 웹 AI에서 별도로 검토">
              <ExternalLink size={10} /> 웹 AI로 별도 검토
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <main className="flex h-screen min-h-0 flex-col bg-surface" data-testid="sidechat-window">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-on-surface"><PanelRightClose size={16} className="text-primary" /> PageDock 사이드채팅</div>
          <p className="mt-1 text-[11px] text-on-surface-variant">별도 대화 · PDF 대화에 저장되지 않음 · 원문은 선택한 범위만 전달</p>
        </div>
        <button type="button" onClick={() => window.close()} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container" aria-label="사이드채팅 창 닫기" title="닫기"><X size={16} /></button>
      </header>
      <nav className="flex shrink-0 items-center gap-1 border-b border-outline-variant/15 bg-surface-container-low px-3 py-2" aria-label="사이드채팅 탭" role="tablist">
        <button type="button" role="tab" onClick={() => setActiveTab('pagedock')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${activeTab === 'pagedock' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}`} aria-selected={activeTab === 'pagedock'}>PageDock AI</button>
        <button type="button" role="tab" aria-selected={activeTab === 'web'} onClick={() => setActiveTab('web')} className="rounded-lg px-3 py-2 text-xs font-semibold">웹 AI · 요청과 답변</button>
      </nav>

      {activeTab === 'pagedock' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-outline-variant/15 bg-surface-container-lowest px-3 py-2">
            <select aria-label="사이드채팅 기록 선택" value={activeSessionId || ''} onChange={(event) => { forceNewSessionRef.current = false; activeSessionIdRef.current = event.target.value || null; setActiveSessionId(event.target.value || null); }} className="min-w-0 flex-1 rounded-lg border border-outline-variant/25 bg-surface px-2.5 py-2 text-xs text-on-surface outline-none focus:border-primary">
              <option value="">새 사이드 대화</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
            </select>
            <button type="button" onClick={newChat} className="inline-flex items-center gap-1 rounded-lg bg-primary-container px-2.5 py-2 text-xs font-semibold text-primary hover:bg-primary-container/70"><MessageSquarePlus size={13} /> 새 대화</button>
            <select aria-label="PageDock AI 공급자" value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value === 'claude' ? 'claude' : 'codex')} disabled={Boolean(activeSessionId)} className="rounded-lg border border-outline-variant/25 bg-surface px-2 py-2 text-xs text-on-surface disabled:opacity-60"><option value="codex">Codex</option><option value="claude">Claude</option></select>
            <select aria-label="PageDock AI 모델" value={selectedModel} onChange={(event) => setSelectedModel(normalizeModelPreference(event.target.value))} disabled={Boolean(activeSessionId) || modelsLoading} className="max-w-40 rounded-lg border border-outline-variant/25 bg-surface px-2 py-2 text-xs text-on-surface disabled:opacity-60"><option value={AUTO_MODEL_ID}>{getAutoModelLabel(selectedProvider)}</option>{models.filter((model) => model.id !== AUTO_MODEL_ID).map((model) => <option key={model.id} value={model.id}>{model.display_name || model.id}</option>)}</select>
            {selectedProvider === 'codex' && <select aria-label="사이드채팅 추론 수준" value={selectedReasoningEffort} onChange={(event) => setSelectedReasoningEffort(normalizeReasoningEffort(event.target.value))} disabled={Boolean(activeSessionId)} className="rounded-lg border border-outline-variant/25 bg-surface px-2 py-2 text-xs text-on-surface disabled:opacity-60"><option value={AUTO_REASONING_EFFORT}>자동</option>{SIDE_CHAT_REASONING_LEVELS.map((effort) => <option key={effort} value={effort}>{getReasoningEffortLabel(effort)}</option>)}</select>}
            <button type="button" onClick={() => void refreshSessions()} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container" aria-label="사이드채팅 새로고침" title="새로고침"><RefreshCw size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {!activeSessionId && <div className="rounded-xl border border-primary/15 bg-primary-container/45 px-3 py-3 text-xs leading-5 text-on-surface-variant">질문을 보내면 이 창 전용 로컬 대화가 시작됩니다. PageDock PDF 대화와는 섞이지 않습니다.</div>}
            {sessionLoading && messages.length === 0 && <div className="flex items-center gap-2 text-xs text-on-surface-variant"><Loader2 size={13} className="animate-spin" /> 사이드 대화를 불러오는 중...</div>}
            {messages.map(renderMessage)}
            {streamingText && <article className="flex gap-2.5"><div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container text-primary"><Sparkles size={13} /></div><div className="max-w-[88%] rounded-2xl bg-surface-container px-3.5 py-2.5 text-sm leading-6"><ChatMarkdown content={streamingText} fontSize={14} className="chat-markdown" /></div></article>}
            {sending && !streamingText && <div className="flex items-center gap-2 text-xs text-on-surface-variant"><Loader2 size={13} className="animate-spin" /> PageDock AI가 답변을 준비하는 중...</div>}
          </div>
          <div className="shrink-0 border-t border-outline-variant/15 bg-surface-container-lowest px-3 py-3">
            {sourceContext && <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary-container/40 px-3 py-2 text-xs text-primary"><span className="flex min-w-0 items-center gap-1.5"><Link2 size={12} /> <span className="truncate">{sourceLabel(sourceContext)} · 선택 영역 {sourceContext.rects?.length || 0}개</span></span><button type="button" onClick={() => { setSourceContext(undefined); setSourcePdfPath(undefined); }} className="rounded p-1 hover:bg-primary-container" aria-label="원문 초안 연결 해제"><X size={12} /></button></div>}
            <div className="flex items-end gap-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (shouldSubmitChatOnEnter(event)) { event.preventDefault(); void handleSend(); } }} placeholder="사이드채팅에 질문을 입력하세요" className="min-h-11 max-h-36 min-w-0 flex-1 resize-y rounded-xl border border-outline-variant/30 bg-surface px-3 py-2.5 text-sm leading-6 text-on-surface outline-none focus:border-primary" aria-label="사이드채팅 질문" /><button type="button" onClick={() => void handleSend()} disabled={!input.trim() || sending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary disabled:cursor-not-allowed disabled:opacity-40" aria-label="PageDock AI에 질문 보내기"><Send size={16} /></button></div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-on-surface-variant">질문 초안은 이 창에 임시 보관되며 앱 재시작 후 복원은 보장되지 않습니다. 중요한 질문은 전송해 저장하세요. 웹 AI로 보낼 때는 아래에서 범위를 확인하세요.</p><button type="button" onClick={() => void handleOpenWeb()} disabled={!input.trim() && !persistedWebQuestion} className="inline-flex items-center gap-1 rounded-lg border border-ai-reference/25 px-2.5 py-1.5 text-[11px] font-semibold text-ai-reference hover:bg-ai-reference-container/50 disabled:opacity-40"><ExternalLink size={12} /> 웹 AI로 검토</button></div>
          </div>
        </div>
      )}
      <WebAiHandoffPanel namespace={namespace} sessionId={activeSessionId} messages={messages} target={resolvedTarget} ensureQuestion={ensureWebQuestion} initialMode={promptMode} initialProvider={activeWebProvider} visible={activeTab === 'web' && !comparison} onSource={(question) => void jumpToSource(question)}
        onReflectionSave={saveReflection}
        onRequest={(request) => {
          const patch = (items: ChatMessage[]) => items.map((m) => m.id === request.questionMessageId ? { ...m, sideChatWebRequests: [...(m.sideChatWebRequests || []).filter((r) => r.id !== request.id), request] } : m);
          if (activeSessionIdRef.current === request.sessionId) setMessages(patch);
          setSessions((items) => items.map((v) => v.id === request.sessionId ? { ...v, messages: patch(v.messages) } : v));
        }}
        onPerspective={(sessionId, questionId, perspective) => {
          const patch = (items: ChatMessage[]) => items.map((m) => m.id === questionId ? { ...m, sideChatPerspectives: [...(m.sideChatPerspectives || []).filter((p) => p.id !== perspective.id), perspective] } : m);
          if (activeSessionIdRef.current === sessionId) setMessages(patch);
          setSessions((items) => items.map((v) => v.id === sessionId ? { ...v, messages: patch(v.messages) } : v));
        }} />

      {statusMessage && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-outline-variant/25 bg-surface-container-lowest px-4 py-2.5 text-xs text-on-surface shadow-ambient">{statusMessage}</div>}

      {comparison && <SideChatComparisonDialog question={comparison.question} messages={messages} initial={comparison.perspective} onClose={() => setComparison(null)} onSource={(question) => void jumpToSource(question)} onReflectionSave={(questionId, text) => saveReflection(comparison.sessionId, questionId, text)} />}
    </main>
  );
}
