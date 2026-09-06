'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Clipboard,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  MapPin,
  MessageSquarePlus,
  PanelRightClose,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

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
import {
  buildSideChatOutboundPrompt,
  canUseSideChatSource,
  getSideChatModeLabel,
  SIDE_CHAT_MAX_RESPONSE_CHARS,
  SIDE_CHAT_OUTBOUND_MODES,
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
  question: ChatMessage;
  answer?: ChatMessage;
  perspective: SideChatWebPerspective;
}

const DRAFT_STORAGE_KEY = 'pagedock:sidechat:draft:v1';
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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
  const [webResponseDraft, setWebResponseDraft] = useState('');
  const [webModelLabel, setWebModelLabel] = useState('');
  const [webSaving, setWebSaving] = useState(false);
  const [webEmbedded, setWebEmbedded] = useState<boolean | null>(null);
  const [webFailure, setWebFailure] = useState('');
  const [comparison, setComparison] = useState<WebComparisonState | null>(null);
  const webHostRef = useRef<HTMLDivElement>(null);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const requestFingerprintRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const forceNewSessionRef = useRef(false);

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const selectedAnswer = selectedAnswerId
    ? messages.find((message) => message.id === selectedAnswerId && message.role === 'assistant')
    : undefined;
  const selectedQuestion = selectedAnswer?.replyToMessageId
    ? messages.find((message) => message.id === selectedAnswer.replyToMessageId && message.role === 'user')
    : undefined;
  const persistedWebQuestion = selectedQuestion || latestUserMessage(messages);
  const webQuestionText = selectedQuestion?.content || persistedWebQuestion?.content || input.trim();
  const webSource = selectedQuestion?.sourceContext || persistedWebQuestion?.sourceContext || sourceContext;
  const webPrompt = useMemo(() => (
    webQuestionText
      ? buildSideChatOutboundPrompt({
        mode: promptMode,
        question: webQuestionText,
        sourceText: webSource?.text,
        answerText: selectedAnswer?.content,
      })
      : ''
  ), [promptMode, selectedAnswer?.content, webQuestionText, webSource?.text]);
  const activeWebDefinition = SIDE_CHAT_WEB_PROVIDERS.find((provider) => provider.id === activeWebProvider) || SIDE_CHAT_WEB_PROVIDERS[0];

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
    if (!activeSessionId) {
      setMessages([]);
      return () => { cancelled = true; };
    }
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
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SideChatDraft>;
        setInput(typeof saved.input === 'string' ? saved.input : '');
        setSourceContext(normalizeChatSourceContext(saved.sourceContext));
        setSourcePdfPath(typeof saved.sourcePdfPath === 'string' ? saved.sourcePdfPath : undefined);
        if (saved.promptMode === 'question' || saved.promptMode === 'source-question' || saved.promptMode === 'source-question-answer') setPromptMode(saved.promptMode);
        if (saved.webProvider && SIDE_CHAT_WEB_PROVIDERS.some((provider) => provider.id === saved.webProvider)) setActiveWebProvider(saved.webProvider);
      }
      const handoffValue = new URLSearchParams(window.location.search).get('handoff');
      if (handoffValue) {
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
      // A draft is a convenience. The persisted sidechat remains authoritative.
    } finally {
      setDraftHydrated(true);
    }
  }, []);

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
    const unsubscribeFailure = desktop.onWebFailed((failure) => {
      if (failure.providerId === activeWebProvider) setWebFailure('웹 AI 페이지를 불러오지 못했습니다. 기본 브라우저로 열 수 있습니다.');
    });
    return () => { unsubscribeHandoff(); unsubscribeFailure(); };
  }, [activeWebProvider]);

  useEffect(() => {
    if (!draftHydrated) return;
    if (!input.trim() && !sourceContext) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    const draft: SideChatDraft = { input, sourceContext, sourcePdfPath, promptMode, webProvider: activeWebProvider };
    try { window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); } catch { /* local draft is best effort */ }
  }, [activeWebProvider, draftHydrated, input, promptMode, sourceContext, sourcePdfPath]);

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

  useEffect(() => {
    const desktop = window.pageDockDesktop?.sideChat;
    if (!desktop) {
      setWebEmbedded(false);
      return;
    }
    if (activeTab !== 'web') {
      setWebEmbedded(false);
      void desktop.hideWebProvider();
      return;
    }
    let cancelled = false;
    setWebEmbedded(null);
    setWebFailure('');
    void desktop.showWebProvider(activeWebProvider).then((result) => {
      if (!cancelled) {
        setWebEmbedded(result.mode === 'embedded');
        if (result.mode === 'external-fallback') setWebFailure('이 웹 AI는 기본 브라우저로 열었습니다. PageDock는 로그인 상태를 추정하지 않습니다.');
      }
    }).catch((error) => {
      if (!cancelled) setWebFailure(error instanceof Error ? error.message : '웹 AI 탭을 열지 못했습니다.');
    });
    return () => { cancelled = true; };
  }, [activeTab, activeWebProvider]);

  useEffect(() => {
    if (activeTab !== 'web' || webEmbedded !== true) return;
    const desktop = window.pageDockDesktop?.sideChat;
    if (!desktop || !webHostRef.current) return;
    const updateBounds = () => {
      const rect = webHostRef.current?.getBoundingClientRect();
      if (!rect) return;
      desktop.setWebViewBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(webHostRef.current);
    window.addEventListener('resize', updateBounds);
    return () => { observer.disconnect(); window.removeEventListener('resize', updateBounds); };
  }, [activeTab, webEmbedded]);

  useEffect(() => {
    if (!comparison) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(comparisonRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])') || []);
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setComparison(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index === items.length - 1 ? 0 : index + 1);
      event.preventDefault();
      items[next]?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [comparison]);

  const ensureSideSession = useCallback(async (): Promise<Session> => {
    if (activeSession) return activeSession;
    const availableSessions = sessionsLoaded ? sessions : await refreshSessions();
    const existing = forceNewSessionRef.current ? undefined : availableSessions[0];
    if (existing) {
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
    setActiveSessionId(created.id);
    setMessages([]);
    return created;
  }, [activeSession, refreshSessions, selectedModel, selectedProvider, selectedReasoningEffort, sessions, sessionsLoaded]);

  const refreshActiveSession = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/sessions?folderPath=.&sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data?.id) throw new Error('사이드채팅을 새로 고치지 못했습니다.');
    setMessages(Array.isArray(data.messages) ? data.messages : []);
    setSessions((current) => current.map((session) => session.id === sessionId ? data as Session : session));
    return data as Session;
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
    setMessages(Array.isArray(data.session.messages) ? data.session.messages : []);
    setSessions((current) => current.map((item) => item.id === session.id ? data.session as Session : item));
    setInput('');
    setSourceContext(undefined);
    setSourcePdfPath(undefined);
    return { session: data.session as Session, question: data.questionMessage as ChatMessage };
  }, [ensureSideSession, input, sourceContext, sourcePdfPath]);

  const getWebTarget = useCallback((questionOverride?: ChatMessage) => {
    const question = questionOverride || selectedQuestion || persistedWebQuestion;
    const answer = selectedAnswer;
    return {
      question,
      answer,
      source: question?.sourceContext || sourceContext,
      sourcePath: question?.sourcePdfPath || sourcePdfPath,
    };
  }, [persistedWebQuestion, selectedAnswer, selectedQuestion, sourceContext, sourcePdfPath]);

  const ensureWebTarget = useCallback(async () => {
    const current = getWebTarget();
    if (current.question) return current;
    if (!input.trim()) throw new Error('웹 AI에 보낼 질문을 먼저 입력해 주세요.');
    const saved = await saveLocalQuestionForWeb();
    if (!saved) throw new Error('질문을 로컬에 저장하지 못했습니다.');
    return getWebTarget(saved.question);
  }, [getWebTarget, input, saveLocalQuestionForWeb]);

  const copyText = async (text: string) => {
    if (!text.trim()) throw new Error('복사할 내용이 없습니다.');
    if (window.pageDockDesktop?.sideChat) {
      await window.pageDockDesktop.sideChat.copyText(text);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('클립보드를 사용할 수 없습니다. 화면의 미리보기에서 직접 선택해 복사해 주세요.');
    }
  };

  const handleCopyPrompt = async () => {
    try {
      const target = await ensureWebTarget();
      const prompt = buildSideChatOutboundPrompt({ mode: promptMode, question: target.question?.content || '', sourceText: target.source?.text, answerText: target.answer?.content });
      if (promptMode !== 'question' && !canUseSideChatSource(target.source)) throw new Error('이 모드는 한 페이지의 선택 원문이 필요합니다.');
      if (promptMode === 'source-question-answer' && !target.answer) throw new Error('원문·질문·답변 모드는 PageDock 답변을 먼저 선택해 주세요.');
      await copyText(prompt);
      setStatusMessage('전송 내용을 복사했습니다. 웹 AI에서 직접 붙여넣고 전송하세요.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '전송 내용을 복사하지 못했습니다.');
    }
  };

  const handleOpenWeb = async () => {
    try {
      await ensureWebTarget();
      setActiveTab('web');
      const desktop = window.pageDockDesktop?.sideChat;
      if (desktop) {
        const result = await desktop.showWebProvider(activeWebProvider);
        setWebEmbedded(result.mode === 'embedded');
        if (result.mode === 'external-fallback') setWebFailure('기본 브라우저로 열었습니다. 질문은 복사 버튼으로 직접 전달하세요.');
      } else {
        void window.open(activeWebDefinition.url, '_blank');
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '웹 AI를 열지 못했습니다.');
    }
  };

  const handleSaveWebAnswer = async () => {
    const responseText = webResponseDraft.replace(/\r\n?/g, '\n').trim();
    if (!responseText) {
      setStatusMessage('웹 AI 답변을 붙여넣어 주세요.');
      return;
    }
    if (responseText.length > SIDE_CHAT_MAX_RESPONSE_CHARS) {
      setStatusMessage(`웹 AI 답변이 너무 깁니다. ${SIDE_CHAT_MAX_RESPONSE_CHARS.toLocaleString('ko-KR')}자 이하로 줄여 주세요.`);
      return;
    }
    try {
      const target = await ensureWebTarget();
      if (!target.question) throw new Error('연결할 질문이 없습니다.');
      if (promptMode !== 'question' && !canUseSideChatSource(target.source)) throw new Error('이 모드는 한 페이지의 선택 원문이 필요합니다.');
      if (promptMode === 'source-question-answer' && !target.answer) throw new Error('원문·질문·답변 모드는 PageDock 답변을 먼저 선택해 주세요.');
      const promptSnapshot = buildSideChatOutboundPrompt({ mode: promptMode, question: target.question.content, sourceText: target.source?.text, answerText: target.answer?.content });
      setWebSaving(true);
      const response = await fetch('/api/side-chat/perspectives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: '.',
          sessionId: activeSessionId,
          questionMessageId: target.question.id,
          ...(target.answer ? { answerMessageId: target.answer.id } : {}),
          provider: activeWebProvider,
          promptMode,
          promptSnapshot,
          responseText,
          model: webModelLabel.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.perspective || !data?.session) throw new Error(data?.error || '웹 답변을 저장하지 못했습니다.');
      const savedSession = data.session as Session;
      setMessages(savedSession.messages);
      setSessions((current) => current.map((item) => item.id === savedSession.id ? savedSession : item));
      setWebResponseDraft('');
      setWebModelLabel('');
      setStatusMessage('웹 답변을 사이드채팅 질문에 저장했습니다.');
      setComparison({ question: target.question, answer: target.answer, perspective: data.perspective as SideChatWebPerspective });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '웹 답변을 저장하지 못했습니다.');
    } finally {
      setWebSaving(false);
    }
  };

  const jumpToSource = async (question: ChatMessage) => {
    const source = question.sourceContext;
    const pdfPath = question.sourcePdfPath || sourcePdfPath;
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
    setSending(true);
    setStreamingText('');
    setStatusMessage('');
    let session: Session | null = null;
    try {
      session = await ensureSideSession();
      const userMessageId = makeId('side-user');
      const optimisticUser: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        ...(originalSource ? { sourceContext: originalSource } : {}),
        ...(originalSourcePdfPath ? { sourcePdfPath: originalSourcePdfPath } : {}),
      };
      setMessages((current) => [...current, optimisticUser]);
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
          if (event.type === 'assistant_delta' && event.text) setStreamingText((current) => `${current}${event.text}`);
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
            const nextMessages: ChatMessage[] = Array.isArray(event.session?.messages)
              ? event.session!.messages
              : [...messages, optimisticUser, fallbackAssistant];
            setMessages(nextMessages);
            if (event.session) setSessions((current) => current.map((item) => item.id === event.session!.id ? event.session! : item));
            completed = true;
          }
        }
      }
      if (!completed) throw new Error('AI 응답이 끝나기 전에 연결이 종료되었습니다. 질문은 로컬에 남아 있습니다.');
      setInput('');
      setSourceContext(undefined);
      setSourcePdfPath(undefined);
      setStreamingText('');
    } catch (error) {
      if (session) await refreshActiveSession(session.id).catch(() => undefined);
      setInput((current) => current || prompt);
      setStatusMessage(error instanceof Error ? error.message : 'PageDock AI에 연결하지 못했습니다.');
      setStreamingText('');
    } finally {
      setSending(false);
    }
  };

  const chooseAnswerForWeb = (message: ChatMessage) => {
    if (message.role !== 'assistant') return;
    setSelectedAnswerId(message.id);
    setPromptMode(message.sourceContext?.scope === 'selection' ? 'source-question-answer' : 'question');
    setActiveWebProvider('deepseek');
    setActiveTab('web');
  };

  const newChat = () => {
    forceNewSessionRef.current = true;
    setActiveSessionId(null);
    setMessages([]);
    setSelectedAnswerId(null);
    setStatusMessage('새 사이드 대화를 준비했습니다. 기존 기록은 보존됩니다.');
  };

  const renderPerspective = (question: ChatMessage, perspective: SideChatWebPerspective) => (
    <div key={perspective.id} className="mt-2 rounded-xl border border-ai-reference/20 bg-ai-reference-container/35 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-ai-reference">{providerLabel(perspective.provider)} · 직접 붙여넣은 설명</span>
        <button type="button" onClick={() => setComparison({ question, answer: messages.find((message) => message.replyToMessageId === question.id && message.role === 'assistant'), perspective })} className="rounded-md px-1.5 py-1 text-[10px] font-semibold text-ai-reference hover:bg-ai-reference-container" aria-label="웹 답변 비교 보기">
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
        {[...new Set<SideChatWebProviderId>(['deepseek', activeWebProvider])].map((providerId) => (
          <button key={providerId} type="button" role="tab" onClick={() => { setActiveWebProvider(providerId); setActiveTab('web'); }} className={`rounded-lg px-3 py-2 text-xs font-semibold ${activeTab === 'web' && activeWebProvider === providerId ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container'}`} aria-selected={activeTab === 'web' && activeWebProvider === providerId}>{providerLabel(providerId)}</button>
        ))}
        <div className="relative ml-auto">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"><Plus size={13} /> 웹 AI 추가/열기 <ChevronDown size={12} /></summary>
            <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-1 shadow-ambient">
              {SIDE_CHAT_WEB_PROVIDERS.map((provider) => <button key={provider.id} type="button" onClick={() => { setActiveWebProvider(provider.id); setActiveTab('web'); }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-on-surface hover:bg-surface-container"><span>{provider.label}</span><ExternalLink size={11} /></button>)}
            </div>
          </details>
        </div>
      </nav>

      {activeTab === 'pagedock' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-outline-variant/15 bg-surface-container-lowest px-3 py-2">
            <select aria-label="사이드채팅 기록 선택" value={activeSessionId || ''} onChange={(event) => { forceNewSessionRef.current = false; setActiveSessionId(event.target.value || null); }} className="min-w-0 flex-1 rounded-lg border border-outline-variant/25 bg-surface px-2.5 py-2 text-xs text-on-surface outline-none focus:border-primary">
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
            <div className="flex items-end gap-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} placeholder="사이드채팅에 질문을 입력하세요" className="min-h-11 max-h-36 min-w-0 flex-1 resize-y rounded-xl border border-outline-variant/30 bg-surface px-3 py-2.5 text-sm leading-6 text-on-surface outline-none focus:border-primary" aria-label="사이드채팅 질문" /><button type="button" onClick={() => void handleSend()} disabled={!input.trim() || sending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary disabled:cursor-not-allowed disabled:opacity-40" aria-label="PageDock AI에 질문 보내기"><Send size={16} /></button></div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] text-on-surface-variant">일반 질문은 원문 없이도 가능합니다. 웹 AI로 보낼 때는 아래에서 범위를 확인하세요.</p><button type="button" onClick={() => void handleOpenWeb()} disabled={!input.trim() && !persistedWebQuestion} className="inline-flex items-center gap-1 rounded-lg border border-ai-reference/25 px-2.5 py-1.5 text-[11px] font-semibold text-ai-reference hover:bg-ai-reference-container/50 disabled:opacity-40"><ExternalLink size={12} /> 웹 AI로 검토</button></div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 border-b border-outline-variant/15 bg-surface-container-lowest px-3 py-3">
            <div className="flex items-center justify-between gap-2"><div className="min-w-0"><div className="text-xs font-bold text-on-surface">{activeWebDefinition.label}</div><p className="mt-0.5 text-[10px] text-on-surface-variant">PageDock는 이 웹페이지를 읽거나 자동 전송하지 않습니다. 로그인·붙여넣기·전송은 직접 수행하세요.</p></div><button type="button" onClick={() => void handleCopyPrompt()} disabled={!webQuestionText || (promptMode !== 'question' && !canUseSideChatSource(webSource))} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-2 text-[11px] font-semibold text-on-primary disabled:opacity-40"><Clipboard size={12} /> 내용 복사</button></div>
            <div className="flex flex-wrap items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-on-surface-variant"><span className="shrink-0">전송 범위</span><select value={promptMode} onChange={(event) => setPromptMode(event.target.value as SideChatOutboundMode)} className="min-w-0 flex-1 rounded-lg border border-outline-variant/25 bg-surface px-2 py-1.5 text-[11px] text-on-surface" aria-label="웹 AI 전송 범위">{SIDE_CHAT_OUTBOUND_MODES.map((mode) => <option key={mode.id} value={mode.id} disabled={mode.id !== 'question' && !canUseSideChatSource(webSource)}>{mode.label}</option>)}</select></label><button type="button" onClick={() => void handleOpenWeb()} className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/25 px-2.5 py-1.5 text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container"><ExternalLink size={12} /> 웹 AI 열기</button></div>
            <details className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2"><summary className="cursor-pointer text-[11px] font-semibold text-on-surface-variant">실제 전송 내용 미리보기 {webQuestionText ? `· ${getSideChatModeLabel(promptMode)}` : ''}</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-on-surface-variant">{webPrompt || '질문을 입력하거나 저장된 사이드채팅 질문을 선택하면 미리보기가 표시됩니다.'}</pre></details>
            {promptMode === 'source-question-answer' && !selectedAnswer && <p className="text-[10px] text-study-unclear">비교할 PageDock AI 답변을 먼저 선택하세요. 자동으로 대화 전체를 보내지 않습니다.</p>}
            <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-[10px] text-on-surface-variant">웹 답변 붙여넣기<textarea value={webResponseDraft} onChange={(event) => setWebResponseDraft(event.target.value)} placeholder="웹 AI에서 직접 복사한 답변을 붙여넣으세요" className="mt-1 h-16 w-full resize-y rounded-lg border border-outline-variant/25 bg-surface px-2.5 py-2 text-xs leading-5 text-on-surface outline-none focus:border-primary" aria-label="웹 AI 답변 붙여넣기" /></label><div className="flex w-40 flex-col gap-2"><label className="text-[10px] text-on-surface-variant">모델 표기 (확인 안 됨)<input value={webModelLabel} onChange={(event) => setWebModelLabel(event.target.value)} placeholder="선택 사항" className="mt-1 w-full rounded-lg border border-outline-variant/25 bg-surface px-2 py-1.5 text-[11px] text-on-surface outline-none focus:border-primary" /></label><button type="button" onClick={() => void handleSaveWebAnswer()} disabled={webSaving || !webResponseDraft.trim() || webResponseDraft.trim().length > SIDE_CHAT_MAX_RESPONSE_CHARS || !activeSessionId} className="inline-flex items-center justify-center gap-1 rounded-lg bg-ai-reference px-2.5 py-2 text-[11px] font-semibold text-white disabled:opacity-40">{webSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 질문에 답변 저장</button></div></div><p className={`text-right text-[10px] ${webResponseDraft.length > SIDE_CHAT_MAX_RESPONSE_CHARS ? 'text-error' : 'text-outline'}`}>{webResponseDraft.length.toLocaleString('ko-KR')} / {SIDE_CHAT_MAX_RESPONSE_CHARS.toLocaleString('ko-KR')}자</p>
          </div>
          <div ref={webHostRef} className="relative min-h-0 flex-1 overflow-hidden bg-white">
            {webEmbedded !== true && <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface px-8 text-center"><div className="max-w-md space-y-3"><FileText size={28} className="mx-auto text-outline" /><p className="text-sm font-semibold text-on-surface">{webEmbedded === null ? '웹 AI 탭을 준비하는 중...' : '기본 브라우저에서 열어 사용할 수 있습니다.'}</p><p className="text-xs leading-5 text-on-surface-variant">{webFailure || 'PageDock는 외부 사이트를 iframe으로 끼워 넣지 않습니다. 복사한 내용을 직접 붙여넣고 전송하세요.'}</p><button type="button" onClick={() => void window.open(activeWebDefinition.url, '_blank')} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary"><ExternalLink size={13} /> 기본 브라우저로 열기</button></div></div>}
          </div>
        </div>
      )}

      {statusMessage && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-outline-variant/25 bg-surface-container-lowest px-4 py-2.5 text-xs text-on-surface shadow-ambient">{statusMessage}</div>}

      {comparison && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 py-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setComparison(null); }}>
          <section ref={comparisonRef} role="dialog" aria-modal="true" aria-labelledby="sidechat-comparison-title" className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-ambient">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/20 px-5 py-4"><div><h2 id="sidechat-comparison-title" className="text-sm font-bold text-on-surface">별도 설명 비교</h2><p className="mt-1 text-[11px] text-on-surface-variant">우열·정답·합의를 자동 판정하지 않습니다. 두 설명은 서로 다른 맥락의 참고 자료입니다.</p></div><button type="button" onClick={() => setComparison(null)} className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container" aria-label="비교 닫기"><X size={15} /></button></header>
            <div className="min-h-0 overflow-y-auto px-5 py-4"><p className="text-xs font-semibold text-on-surface">원래 질문</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-on-surface-variant">{comparison.question.content}</p>{comparison.question.sourceContext && <details className="mt-3 rounded-xl bg-surface-container px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-on-surface-variant">선택 원문 · p.{comparison.question.sourceContext.page}</summary><p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap border-l-2 border-outline-variant pl-3 text-xs leading-5 text-on-surface-variant">{comparison.question.sourceContext.text}</p></details>}<div className="mt-4 grid gap-4 md:grid-cols-2"><section className="rounded-xl border border-outline-variant/20 bg-surface p-4"><h3 className="text-[11px] font-bold text-on-surface-variant">{comparison.answer ? '첫 PageDock 설명' : 'PageDock 설명 없음'}</h3>{comparison.answer ? <div className="mt-3 text-sm leading-6 text-on-surface"><ChatMarkdown content={comparison.answer.content} fontSize={14} className="chat-markdown" /></div> : <p className="mt-3 text-xs leading-5 text-on-surface-variant">이 질문에는 아직 PageDock AI 답변이 없습니다. 웹 설명만 저장된 상태입니다.</p>}</section><section className="rounded-xl border border-ai-reference/25 bg-ai-reference-container/30 p-4"><h3 className="text-[11px] font-bold text-ai-reference">{providerLabel(comparison.perspective.provider)} · 직접 붙여넣은 설명</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-on-surface">{comparison.perspective.responseText}</p><p className="mt-3 text-[10px] text-on-surface-variant">전송 범위: {getSideChatModeLabel(comparison.perspective.promptMode)}{comparison.perspective.model ? ` · 모델 표기 ${comparison.perspective.model} (확인 안 됨)` : ''}</p></section></div></div>
            <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-outline-variant/20 px-5 py-3"><button type="button" onClick={() => void jumpToSource(comparison.question)} disabled={!comparison.question.sourceContext} className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/25 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-40"><MapPin size={13} /> 원문으로 돌아가기</button><button type="button" onClick={() => setComparison(null)} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary">닫기</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}
