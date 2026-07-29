'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Sparkles, Loader2, ChevronDown, X, CheckCircle2, AlertCircle, FileDown, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { DEFAULT_AI_PROVIDER } from '@/lib/ai-providers/config';
import { AUTO_MODEL_ID, getAutoModelLabel, normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import {
  AUTO_REASONING_EFFORT,
  getReasoningEffortLabel,
  normalizeReasoningEffort,
  readStoredReasoningEffort,
  writeStoredReasoningEffort,
} from '@/lib/ai-providers/reasoning-policy';
import { MarkdownPreviewDialog } from '@/components/common/MarkdownPreviewDialog';
import { buildSessionSummaryMarkdown, getSessionSummaryMarkdownFileName } from '@/lib/session-summary-markdown';
import { useWorkspace } from '@/lib/workspace-store';
import { AI_PROVIDER_EVENT, readStoredAIProvider } from '@/lib/provider-preferences';
import { AIProvider, ChatMessage, ReasoningEffort, Session, SessionKind, SessionTurnSummary } from '@/types';
import {
  CHAT_FONT_SIZE_EVENT,
  DEFAULT_CHAT_FONT_SIZE,
  readStoredChatFontSize,
} from '@/lib/chat-preferences';

const MAX_INPUT_HEIGHT = 180;
const FALLBACK_CODEX_REASONING_LEVELS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

interface AvailableModel {
  id: string;
  owned_by: string;
  created: number;
  display_name?: string;
  default_reasoning_level?: ReasoningEffort;
  supported_reasoning_levels?: Array<{
    effort: ReasoningEffort;
    description?: string;
  }>;
}

interface ToolUseEvent {
  type: 'tool_use';
  name?: string;
  input?: string;
}

interface ToolResultEvent {
  type: 'tool_result';
  name?: string;
  input?: string;
  output?: string;
  exitCode?: number | null;
}

interface StatusEvent {
  type: 'status';
  message?: string;
}

interface AssistantDeltaEvent {
  type: 'assistant_delta';
  text?: string;
}

interface FinalEvent {
  type: 'final';
  content?: string;
  model?: string;
  provider?: AIProvider;
  session?: Session;
}

interface ErrorEvent {
  type: 'error';
  message?: string;
}

type ChatStreamEvent =
  | ToolUseEvent
  | ToolResultEvent
  | StatusEvent
  | AssistantDeltaEvent
  | FinalEvent
  | ErrorEvent;

type SummaryStatus = 'idle' | 'generating' | 'saved' | 'error';

interface SessionUiState {
  isLoading: boolean;
  sessionLoading: boolean;
  thinkingOpen: boolean;
  thinkingDraft: string;
  messages: ChatMessage[];
  turnSummaries: SessionTurnSummary[];
  summaryStatus: SummaryStatus;
  summaryStatusMessage: string;
  provider: AIProvider;
  selectedModel?: string;
  selectedReasoningEffort: ReasoningEffort;
  title?: string;
}

function normalizeMathMarkdown(content: string): string {
  return content
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, expression: string) => `$${expression.trim()}$`);
}

function createDefaultSessionUiState(): SessionUiState {
  return {
    isLoading: false,
    sessionLoading: false,
    thinkingOpen: false,
    thinkingDraft: '',
    messages: [],
    turnSummaries: [],
    summaryStatus: 'idle',
    summaryStatusMessage: '',
    provider: DEFAULT_AI_PROVIDER,
    selectedModel: AUTO_MODEL_ID,
    selectedReasoningEffort: AUTO_REASONING_EFFORT,
  };
}

export function ChatPanel() {
  const {
    activeSessionFolder,
    activeSessionKind,
    activeSessionPdfPath,
    activeSessionId,
    activePdf,
    openSession,
    toggleChat,
  } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [, setSessionUiMap] = useState<Record<string, SessionUiState>>({});
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(AUTO_MODEL_ID);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort>(readStoredReasoningEffort());
  const [customModel, setCustomModel] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(readStoredAIProvider());
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [thinkingDraft, setThinkingDraft] = useState('');
  const [turnSummaries, setTurnSummaries] = useState<SessionTurnSummary[]>([]);
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>('idle');
  const [summaryStatusMessage, setSummaryStatusMessage] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [summaryExportOpen, setSummaryExportOpen] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(DEFAULT_CHAT_FONT_SIZE);
  const pickerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const skipSessionHydrationRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionUiMapRef = useRef<Record<string, SessionUiState>>({});

  const sessionLabel = activeSessionKind === 'pdf' ? 'PDF 대화' : '폴더 대화';
  const exportSession = useMemo<Session>(() => ({
    id: activeSessionId || 'preview-session',
    folderPath: activeSessionFolder || '',
    sessionKind: activeSessionKind || 'folder',
    pdfPath: activeSessionKind === 'pdf' ? (activeSessionPdfPath || activePdf?.path || undefined) : undefined,
    provider: selectedProvider,
    title: sessionTitle || (
      activeSessionKind === 'pdf'
        ? `${(activePdf?.name || activeSessionPdfPath?.split('/').at(-1) || 'PDF').replace(/\.pdf$/i, '')} 대화`
        : `${activeSessionFolder?.split('/').filter(Boolean).at(-1) || '라이브러리'} 연구 대화`
    ),
    createdAt: '',
    updatedAt: '',
    messages,
    turnSummaries,
    model: selectedModel || undefined,
    reasoningEffort: selectedReasoningEffort,
  }), [
    activePdf,
    activeSessionFolder,
    activeSessionId,
    activeSessionKind,
    activeSessionPdfPath,
    messages,
    selectedModel,
    selectedReasoningEffort,
    selectedProvider,
    sessionTitle,
    turnSummaries,
  ]);
  const summaryMarkdown = useMemo(
    () => buildSessionSummaryMarkdown(exportSession),
    [exportSession],
  );
  const summaryMarkdownFileName = useMemo(
    () => getSessionSummaryMarkdownFileName(exportSession),
    [exportSession],
  );
  const exportableTurnCount = useMemo(() => {
    let count = 0;

    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index]?.role !== 'user') {
        continue;
      }

      const hasAssistantReply = messages.slice(index + 1).some((message) => message.role === 'assistant');
      if (hasAssistantReply) {
        count += 1;
      }
    }

    return count;
  }, [messages]);
  const selectedModelConfig = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel],
  );
  const reasoningLevels = useMemo(() => {
    if (selectedProvider !== 'codex') return [];
    const catalogLevels = selectedModelConfig?.supported_reasoning_levels
      ?.map((level) => level.effort)
      .filter((effort) => effort !== AUTO_REASONING_EFFORT) ?? [];
    return catalogLevels.length > 0 ? catalogLevels : FALLBACK_CODEX_REASONING_LEVELS;
  }, [selectedModelConfig, selectedProvider]);
  const defaultReasoningLabel = selectedModelConfig?.default_reasoning_level
    ? getReasoningEffortLabel(selectedModelConfig.default_reasoning_level)
    : null;
  const buildSessionQuery = (
    folderPath: string,
    sessionKind: SessionKind,
    provider: AIProvider,
    pdfPath?: string | null,
  ) => {
    const params = new URLSearchParams({
      folderPath,
      sessionKind,
      provider,
    });

    if (sessionKind === 'pdf' && pdfPath) {
      params.set('pdfPath', pdfPath);
    }

    return params;
  };

  const pickLatestSession = (sessionList: unknown): Session | null => {
    if (!Array.isArray(sessionList)) return null;

    const sessions = sessionList.filter((item): item is Session => (
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      'updatedAt' in item &&
      'folderPath' in item &&
      typeof item.id === 'string' &&
      typeof item.updatedAt === 'string' &&
      typeof item.folderPath === 'string'
    ));

    return sessions.sort((a, b) => (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ))[0] ?? null;
  };

  const applyVisibleSessionState = useCallback((state: SessionUiState) => {
    setMessages(state.messages);
    setIsLoading(state.isLoading);
    setSessionLoading(state.sessionLoading);
    setThinkingOpen(state.thinkingOpen);
    setThinkingDraft(state.thinkingDraft);
    setTurnSummaries(state.turnSummaries);
    setSummaryStatus(state.summaryStatus);
    setSummaryStatusMessage(state.summaryStatusMessage);
    setSelectedProvider(state.provider);
    setSessionTitle(state.title || '');
    if (state.selectedModel) {
      setSelectedModel(state.selectedModel);
    }
    setSelectedReasoningEffort(state.selectedReasoningEffort);
  }, []);

  const resetVisibleSessionState = useCallback(() => {
    setMessages([]);
    setIsLoading(false);
    setSessionLoading(false);
    setThinkingOpen(false);
    setThinkingDraft('');
    setTurnSummaries([]);
    setSummaryStatus('idle');
    setSummaryStatusMessage('');
    setSessionTitle('');
    setSelectedProvider(readStoredAIProvider());
    setSelectedReasoningEffort(readStoredReasoningEffort());
  }, []);

  const commitSessionUiState = useCallback((
    sessionId: string,
    updater: (current: SessionUiState) => SessionUiState,
  ): SessionUiState => {
    const current = sessionUiMapRef.current[sessionId] ?? createDefaultSessionUiState();
    const nextState = updater(current);
    const nextMap = {
      ...sessionUiMapRef.current,
      [sessionId]: nextState,
    };

    sessionUiMapRef.current = nextMap;
    setSessionUiMap(nextMap);

    if (activeSessionIdRef.current === sessionId) {
      applyVisibleSessionState(nextState);
    }

    return nextState;
  }, [applyVisibleSessionState]);

  useEffect(() => {
    void fetchModels(selectedProvider);
  }, [selectedProvider]);
  useEffect(() => {
    const syncChatFontSize = () => {
      setChatFontSize(readStoredChatFontSize());
    };

    syncChatFontSize();

    const handleStorage = (event: StorageEvent) => {
      if (event.key) {
        syncChatFontSize();
      }
    };
    const handleFontSizeEvent = () => {
      syncChatFontSize();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(CHAT_FONT_SIZE_EVENT, handleFontSizeEvent);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(CHAT_FONT_SIZE_EVENT, handleFontSizeEvent);
    };
  }, []);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    if (selectedModel) window.localStorage.setItem('annot-last-model', normalizeModelPreference(selectedModel));
  }, [selectedModel]);
  useEffect(() => {
    writeStoredReasoningEffort(selectedReasoningEffort);
  }, [selectedReasoningEffort]);
  useEffect(() => {
    if (
      selectedProvider === 'codex' &&
      selectedReasoningEffort !== AUTO_REASONING_EFFORT &&
      !reasoningLevels.includes(selectedReasoningEffort)
    ) {
      setSelectedReasoningEffort(AUTO_REASONING_EFFORT);
    }
  }, [reasoningLevels, selectedProvider, selectedReasoningEffort]);
  useEffect(() => {
    const syncProvider = () => {
      if (!activeSessionIdRef.current) {
        setSelectedProvider(readStoredAIProvider());
      }
    };

    syncProvider();
    window.addEventListener('storage', syncProvider);
    window.addEventListener(AI_PROVIDER_EVENT, syncProvider);

    return () => {
      window.removeEventListener('storage', syncProvider);
      window.removeEventListener(AI_PROVIDER_EVENT, syncProvider);
    };
  }, []);

  useEffect(() => {
    if (!activeSessionFolder || !activeSessionKind || activeSessionId) return;

    let cancelled = false;

    const attachLatestSession = async () => {
      try {
        const params = buildSessionQuery(activeSessionFolder, activeSessionKind, selectedProvider, activeSessionPdfPath);
        const res = await fetch(`/api/sessions?${params.toString()}`);
        const data = await res.json();
        const latestSession = pickLatestSession(data);

        if (!cancelled && latestSession) {
          setSelectedProvider(latestSession.provider || readStoredAIProvider() || DEFAULT_AI_PROVIDER);
          openSession(latestSession);
        }
      } catch {
        // Fall back to starting a new session on first send.
      }
    };

    void attachLatestSession();

    return () => {
      cancelled = true;
    };
  }, [activeSessionFolder, activeSessionId, activeSessionKind, activeSessionPdfPath, openSession, selectedProvider]);

  useEffect(() => {
    if (!activeSessionFolder || !activeSessionId) {
      resetVisibleSessionState();
      return;
    }

    const cachedSessionUi = sessionUiMapRef.current[activeSessionId];
    if (cachedSessionUi) {
      if (skipSessionHydrationRef.current === activeSessionId) {
        skipSessionHydrationRef.current = null;
      }
      applyVisibleSessionState(cachedSessionUi);
      return;
    }

    let cancelled = false;

    const loadSession = async () => {
      commitSessionUiState(activeSessionId, (current) => ({
        ...current,
        sessionLoading: true,
      }));
      try {
        const params = new URLSearchParams({
          folderPath: activeSessionFolder,
          sessionId: activeSessionId,
        });
        const res = await fetch(`/api/sessions?${params.toString()}`);
        const data = await res.json();
        if (!cancelled) {
          if (skipSessionHydrationRef.current === activeSessionId) {
            skipSessionHydrationRef.current = null;
            return;
          }
          commitSessionUiState(activeSessionId, (current) => ({
            ...current,
            messages: Array.isArray(data.messages) ? data.messages : [],
            turnSummaries: Array.isArray(data.turnSummaries) ? data.turnSummaries : [],
            summaryStatus: 'idle',
            summaryStatusMessage: '',
            provider: data.provider || current.provider || readStoredAIProvider() || DEFAULT_AI_PROVIDER,
            sessionLoading: false,
            selectedModel: typeof data.model === 'string' && data.model ? data.model : current.selectedModel,
            selectedReasoningEffort: normalizeReasoningEffort(data.reasoningEffort),
            title: typeof data.title === 'string' ? data.title : current.title,
          }));
        }
      } catch {
        if (!cancelled) {
          commitSessionUiState(activeSessionId, (current) => ({
            ...current,
            messages: [],
            turnSummaries: [],
            summaryStatus: 'idle',
            summaryStatusMessage: '',
            sessionLoading: false,
          }));
        }
      }
    };

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [
    activeSessionFolder,
    activeSessionId,
    applyVisibleSessionState,
    commitSessionUiState,
    resetVisibleSessionState,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    const nextHeight = Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
  }, [chatFontSize, input]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchModels = async (provider: AIProvider) => {
    setModelsLoading(true);
    try {
      const params = new URLSearchParams({ provider });
      const res = await fetch(`/api/models?${params.toString()}`);
      const data = await res.json();
      if (data.models?.length > 0) {
        setModels(data.models);
        setSelectedModel((currentSelectedModel) => {
          if (data.models.some((model: AvailableModel) => model.id === currentSelectedModel)) {
            return currentSelectedModel;
          }
          return data.models[0].id;
        });
      } else {
        setModels([]);
        setSelectedModel('');
      }
    } catch { /* fallback */ }
    finally { setModelsLoading(false); }
  };

  const ensureSessionId = async (): Promise<string> => {
    if (activeSessionId) {
      return activeSessionId;
    }

    if (!activeSessionFolder || !activeSessionKind) {
      throw new Error('선택된 폴더가 없습니다.');
    }

    const params = buildSessionQuery(activeSessionFolder, activeSessionKind, selectedProvider, activeSessionPdfPath);
    const existingSessionsRes = await fetch(`/api/sessions?${params.toString()}`);
    const existingSessions = await existingSessionsRes.json();
    const latestSession = pickLatestSession(existingSessions);

    if (latestSession) {
      setSelectedProvider(latestSession.provider || readStoredAIProvider() || DEFAULT_AI_PROVIDER);
      skipSessionHydrationRef.current = latestSession.id;
      openSession(latestSession);
      return latestSession.id;
    }

    const pdfSessionName = (activePdf?.name
      || activeSessionPdfPath?.split('/').at(-1)
      || 'PDF').replace(/\.pdf$/i, '');
    const fallbackTitle = activeSessionKind === 'pdf' && activeSessionPdfPath
      ? `${pdfSessionName} 대화`
      : `${activeSessionFolder.split('/').filter(Boolean).at(-1) || '라이브러리'} 연구 대화`;

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: activeSessionFolder,
        title: fallbackTitle,
        model: selectedModel || undefined,
        reasoningEffort: selectedReasoningEffort,
        provider: selectedProvider,
        sessionKind: activeSessionKind,
        pdfPath: activeSessionKind === 'pdf' ? activeSessionPdfPath : null,
      }),
    });
    const data = await res.json();

    if (!res.ok || !data?.id) {
      throw new Error(typeof data?.error === 'string' ? data.error : '대화를 시작하지 못했습니다.');
    }

    skipSessionHydrationRef.current = data.id as string;
    setSelectedProvider((data.provider as AIProvider) || selectedProvider);
    openSession(data as Session);
    return data.id as string;
  };

  const normalizeComparableText = (value: string): string => (
    value
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .toLowerCase()
  );

  const stripThinkingOverlap = (finalContent: string, liveDraft: string): string => {
    const finalTrimmed = finalContent.trim();
    const draftTrimmed = liveDraft.trim();

    if (!draftTrimmed || !finalTrimmed) {
      return finalContent;
    }

    const normalizedDraft = normalizeComparableText(draftTrimmed);
    const normalizedFinal = normalizeComparableText(finalTrimmed);

    if (normalizedFinal === normalizedDraft) {
      return finalContent;
    }

    const draftBlocks = draftTrimmed
      .split(/\n\s*\n+/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => normalizeComparableText(block));
    const finalBlocks = finalTrimmed
      .split(/\n\s*\n+/)
      .map((block) => block.trim())
      .filter(Boolean);

    if (draftBlocks.length > 0 && finalBlocks.length > 1) {
      let matchedBlockCount = 0;
      for (const block of finalBlocks) {
        const normalizedBlock = normalizeComparableText(block);
        if (normalizedBlock.length < 40 || !draftBlocks.includes(normalizedBlock)) {
          break;
        }
        matchedBlockCount += 1;
      }

      if (matchedBlockCount > 0 && matchedBlockCount < finalBlocks.length) {
        return finalBlocks.slice(matchedBlockCount).join('\n\n').trim();
      }
    }

    const draftLines = draftTrimmed
      .split('\n')
      .map((line) => normalizeComparableText(line))
      .filter((line) => line.length >= 20);
    const finalLines = finalTrimmed.split('\n');

    if (draftLines.length > 0 && finalLines.length > 1) {
      let matchedLineCount = 0;
      for (const line of finalLines) {
        const normalizedLine = normalizeComparableText(line);
        if (normalizedLine.length < 20 || !draftLines.includes(normalizedLine)) {
          break;
        }
        matchedLineCount += 1;
      }

      if (matchedLineCount > 0 && matchedLineCount < finalLines.length) {
        return finalLines.slice(matchedLineCount).join('\n').trim();
      }
    }

    if (finalTrimmed.startsWith(draftTrimmed) && finalTrimmed.length > draftTrimmed.length) {
      const stripped = finalTrimmed.slice(draftTrimmed.length).trimStart();
      return stripped || finalContent;
    }

    const normalizedFinalWords = finalTrimmed.split(/\s+/);
    const normalizedDraftWords = draftTrimmed.split(/\s+/);

    const draftWordString = normalizedDraftWords.join(' ');
    const finalWordString = normalizedFinalWords.join(' ');

    if (finalWordString.startsWith(draftWordString) && normalizedFinalWords.length > normalizedDraftWords.length) {
      return normalizedFinalWords.slice(normalizedDraftWords.length).join(' ');
    }

    return finalContent;
  };

  const handleStreamEvent = (
    sessionId: string,
    event: ChatStreamEvent,
    updatedMessages: ChatMessage[],
    fallbackModel: string,
  ) => {
    if (event.type === 'status' || event.type === 'tool_use' || event.type === 'tool_result') {
      return;
    }

    if (event.type === 'assistant_delta' && event.text) {
      commitSessionUiState(sessionId, (current) => ({
        ...current,
        isLoading: true,
        thinkingDraft: `${current.thinkingDraft}${event.text}`,
      }));
      return;
    }

    if (event.type === 'final') {
      const currentUiState = sessionUiMapRef.current[sessionId] ?? createDefaultSessionUiState();
      const finalContent = stripThinkingOverlap(event.content || '', currentUiState.thinkingDraft);
      const sessionMessages = Array.isArray(event.session?.messages)
        ? event.session!.messages
        : [
          ...updatedMessages,
          {
            id: `c${Date.now()}`,
            role: 'assistant' as const,
            content: finalContent,
            timestamp: new Date().toISOString(),
            model: event.model || fallbackModel,
          },
        ];

      commitSessionUiState(sessionId, (current) => ({
        ...current,
        messages: sessionMessages,
        turnSummaries: current.turnSummaries,
        isLoading: false,
        sessionLoading: false,
        thinkingDraft: '',
        thinkingOpen: false,
        summaryStatus: 'idle',
        summaryStatusMessage: '',
        selectedModel: event.model || fallbackModel,
        selectedReasoningEffort: normalizeReasoningEffort(
          event.session?.reasoningEffort ?? current.selectedReasoningEffort,
        ),
        provider: event.provider || current.provider,
        title: event.session?.title || current.title,
      }));
      return;
    }

    if (event.type === 'error') {
      commitSessionUiState(sessionId, (current) => ({
        ...current,
        messages: [
          ...updatedMessages,
            {
              id: `c${Date.now()}`,
              role: 'assistant',
              content: `**오류:** ${event.message || 'AI에 연결하지 못했습니다. 설정에서 연결 상태를 확인해 주세요.'}`,
              timestamp: new Date().toISOString(),
            },
        ],
        isLoading: false,
        sessionLoading: false,
        thinkingDraft: '',
        thinkingOpen: false,
      }));
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !activeSessionFolder || !activeSessionKind) return;
    const prompt = input.trim();
    setInput('');
    let targetSessionId: string | null = null;

    const userMessage = {
      id: `c${Date.now()}`,
      role: 'user' as const,
      content: prompt,
      timestamp: new Date().toISOString(),
    };

    try {
      const sessionId = await ensureSessionId();
      targetSessionId = sessionId;
      const updated = [...messages, userMessage];
      commitSessionUiState(sessionId, (current) => ({
        ...current,
        messages: updated,
        turnSummaries: [],
        isLoading: true,
        sessionLoading: false,
        thinkingDraft: '',
        thinkingOpen: false,
        summaryStatus: 'idle',
        summaryStatusMessage: '',
        selectedModel: selectedModel || current.selectedModel,
        selectedReasoningEffort,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: activeSessionFolder,
          sessionId,
          prompt: userMessage.content,
          model: selectedModel,
          reasoningEffort: selectedReasoningEffort,
          currentPdfPath: activeSessionKind === 'pdf'
            ? (activeSessionPdfPath || activePdf?.path || null)
            : (activePdf?.path || null),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === 'string' ? data.error : 'AI에 연결하지 못했습니다.');
      }

      if (!res.body) {
        throw new Error('Streaming response is not available.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');

        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            const event = JSON.parse(line) as ChatStreamEvent;
            handleStreamEvent(sessionId, event, updated, selectedModel);
          }

          newlineIndex = buffer.indexOf('\n');
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        const event = JSON.parse(trailing) as ChatStreamEvent;
        handleStreamEvent(sessionId, event, updated, selectedModel);
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'AI에 연결하지 못했습니다. 설정에서 연결 상태를 확인해 주세요.';
      if (targetSessionId) {
        commitSessionUiState(targetSessionId, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: `c${Date.now()}`,
              role: 'assistant' as const,
              content: `**Error:** ${message}`,
              timestamp: new Date().toISOString(),
            },
          ],
          isLoading: false,
          sessionLoading: false,
          thinkingDraft: '',
          thinkingOpen: false,
        }));
      } else {
        setMessages((current) => [...current, {
          id: `c${Date.now()}`,
          role: 'assistant' as const,
          content: `**Error:** ${message}`,
          timestamp: new Date().toISOString(),
        }]);
        setIsLoading(false);
        setThinkingDraft('');
        setThinkingOpen(false);
      }
    }
  };

  const displayName = (modelId: string) => {
    if (modelId === AUTO_MODEL_ID) return getAutoModelLabel(selectedProvider);
    const model = models.find((m) => m.id === modelId);
    if (model?.display_name) return model.display_name;
    return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  };

  const handleThinkingToggle = () => {
    if (!activeSessionId) {
      setThinkingOpen((current) => !current);
      return;
    }

    commitSessionUiState(activeSessionId, (current) => ({
      ...current,
      thinkingOpen: !current.thinkingOpen,
    }));
  };

  const handleSummaryExport = async () => {
    const blob = new Blob([summaryMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = summaryMarkdownFileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setSummaryExportOpen(false);
  };

  const handleOpenSummaryExport = async () => {
    if (!activeSessionId || !activeSessionFolder || exportableTurnCount === 0) {
      return;
    }

    setSummaryExportOpen(true);
    setSummaryStatus('generating');
    setSummaryStatusMessage('전체 대화에서 요약을 생성하는 중...');

    try {
      const res = await fetch('/api/sessions/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: activeSessionFolder,
          sessionId: activeSessionId,
          model: selectedModel || undefined,
          reasoningEffort: selectedReasoningEffort,
        }),
      });
      const data = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '대화 요약을 생성하지 못했습니다.');
      }

      const nextSession = data.session as Session | undefined;
      const nextSummaries = Array.isArray(nextSession?.turnSummaries) ? nextSession.turnSummaries : [];

      setTurnSummaries(nextSummaries);
      setSessionTitle(typeof nextSession?.title === 'string' ? nextSession.title : sessionTitle);

      if (activeSessionId) {
        commitSessionUiState(activeSessionId, (current) => ({
          ...current,
          turnSummaries: nextSummaries,
          summaryStatus: 'saved',
          summaryStatusMessage: '요약 내보내기가 준비되었습니다.',
          title: typeof nextSession?.title === 'string' ? nextSession.title : current.title,
        }));
      } else {
        setSummaryStatus('saved');
        setSummaryStatusMessage('요약 내보내기가 준비되었습니다.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '대화 요약을 생성하지 못했습니다.';
      setSummaryStatus('error');
      setSummaryStatusMessage(message);
      setSummaryExportOpen(false);
    }
  };

  const renderSummaryStatus = () => {
    if (summaryStatus === 'generating') {
      return (
        <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
          <Loader2 size={10} className="animate-spin" />
          <span>{summaryStatusMessage || '요약 생성 중'}</span>
        </div>
      );
    }

    if (summaryStatus === 'saved') {
      return (
        <div className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
          <CheckCircle2 size={10} />
          <span>{summaryStatusMessage || '요약 저장됨'}</span>
        </div>
      );
    }

    if (summaryStatus === 'error') {
      return (
        <div className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">
          <AlertCircle size={10} />
          <span>{summaryStatusMessage || '요약 실패'}</span>
        </div>
      );
    }

    return null;
  };

  const assistantFontStyle = { fontSize: `${chatFontSize}px`, lineHeight: 1.7 };
  const userFontStyle = { fontSize: `${chatFontSize}px`, lineHeight: 1.7 };
  const inputFontStyle = { fontSize: `${chatFontSize}px`, lineHeight: 1.7 };
  const codeFontSize = Math.max(11, chatFontSize - 2);
  const codeFontStyle = { fontSize: `${codeFontSize}px` };
  const quickPrompts = [
    '이 논문의 핵심 주장을 쉽게 설명해줘.',
    '연구 방법과 결과를 짧게 정리해줘.',
    '이 논문의 한계와 주의할 점을 알려줘.',
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">{sessionLabel}</h2>
          {renderSummaryStatus()}
        </div>
        <div className="flex w-full min-w-0 items-center gap-1">
          <button
            onClick={() => void handleOpenSummaryExport()}
            disabled={!activeSessionId || exportableTurnCount === 0 || summaryStatus === 'generating'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-container text-[11px] font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
            title="대화 요약 Markdown 미리보기"
          >
            <FileDown size={11} strokeWidth={2} />
            <span className="sr-only">내보내기</span>
          </button>
          {/* Model selector */}
          <div className="relative min-w-0 flex-1" ref={pickerRef}>
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md bg-emerald-100 px-2 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-200"
            >
              {modelsLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <>
                  <span className="truncate">{selectedModel ? displayName(selectedModel) : '모델'}</span>
                  <ChevronDown size={10} strokeWidth={2.5} className="shrink-0" />
                </>
              )}
            </button>
            {showModelPicker && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-surface-container-lowest rounded-lg shadow-ambient z-50 py-1 max-h-60 overflow-y-auto">
                {models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => { setSelectedModel(model.id); setShowModelPicker(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                      model.id === selectedModel
                        ? 'bg-emerald-50 text-emerald-700 font-semibold'
                        : 'text-on-surface hover:bg-surface-container-low'
                    }`}
                  >
                    {model.display_name || model.id}
                  </button>
                ))}
                <div className="mt-1 border-t border-outline-variant/20 p-2">
                  <label className="block text-[10px] text-outline mb-1">목록에 없는 모델 ID 직접 입력</label>
                  <input
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || !customModel.trim()) return;
                      setSelectedModel(customModel.trim());
                      setShowModelPicker(false);
                    }}
                    placeholder="예: 공급자가 지원하는 모델 ID"
                    className="w-full rounded border border-outline-variant/30 bg-surface px-2 py-1.5 text-[11px] text-on-surface outline-none focus:border-outline"
                  />
                  <button
                    onClick={() => {
                      if (!customModel.trim()) return;
                      setSelectedModel(customModel.trim());
                      setShowModelPicker(false);
                    }}
                    disabled={!customModel.trim()}
                    className="mt-1.5 w-full rounded bg-primary px-2 py-1.5 text-[10px] font-semibold text-on-primary disabled:opacity-50"
                  >
                    이 모델 사용
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedProvider === 'codex' && (
            <select
              data-testid="reasoning-effort-select"
              value={selectedReasoningEffort}
              onChange={(event) => setSelectedReasoningEffort(normalizeReasoningEffort(event.target.value))}
              className="h-7 min-w-0 flex-1 rounded-md border-0 bg-violet-100 px-2 text-[11px] font-semibold text-violet-700 outline-none hover:bg-violet-200 focus:ring-2 focus:ring-violet-300"
              aria-label="추론 수준"
              title="추론 수준이 높을수록 더 오래 생각하며 사용량이 늘어날 수 있습니다."
            >
              <option value={AUTO_REASONING_EFFORT}>
                추론 자동{defaultReasoningLabel ? ` (기본 ${defaultReasoningLabel})` : ''}
              </option>
              {reasoningLevels.map((effort) => (
                <option key={effort} value={effort}>
                  추론 {getReasoningEffortLabel(effort)}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => void fetchModels(selectedProvider)}
            disabled={modelsLoading}
            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
            title="사용 가능한 모델 새로고침"
          >
            <RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={toggleChat}
            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3">
        {!activeSessionId && !sessionLoading && (
          <div className="rounded-xl bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
            {activeSessionKind === 'pdf'
              ? '첫 메시지를 보내면 이 PDF의 대화를 시작하거나 최근 대화를 다시 엽니다.'
              : '첫 메시지를 보내면 이 폴더의 연구 대화를 시작하거나 최근 대화를 다시 엽니다.'}
          </div>
        )}

        {sessionLoading && messages.length === 0 && (
          <div className="flex gap-2.5">
            <div className="w-6 h-6 rounded-full bg-surface-container flex items-center justify-center shrink-0">
              <Loader2 size={11} strokeWidth={2} className="text-on-surface-variant animate-spin" />
            </div>
            <span className="text-xs text-on-surface-variant mt-1">대화를 불러오는 중...</span>
          </div>
        )}

        {(exportableTurnCount > 0 || summaryStatus !== 'idle') && (
          <section className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-3 shadow-ambient">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  대화별 요약
                </div>
                <p className="mt-1 text-[11px] text-on-surface-variant">
                  내보낼 때 전체 대화 기록을 바탕으로 요약을 생성합니다.
                </p>
              </div>
              <button
                onClick={() => void handleOpenSummaryExport()}
                disabled={!activeSessionId || exportableTurnCount === 0 || summaryStatus === 'generating'}
                className="rounded-md bg-surface-container px-2 py-1 text-[10px] font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
              >
                Markdown 미리보기
              </button>
            </div>

            {turnSummaries.length > 0 ? (
              <div className="mt-3 space-y-2">
                {[...turnSummaries].reverse().map((summary, index) => (
                  <div
                    key={summary.id}
                    className="rounded-xl bg-surface-container px-3 py-3"
                  >
                    <div className="mb-2 text-[10px] uppercase tracking-widest text-outline">
                      대화 {turnSummaries.length - index}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                          질문
                        </div>
                        <p className="selectable-text mt-1 text-xs text-on-surface whitespace-pre-wrap break-words">
                          {summary.question}
                        </p>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                          답변 요약
                        </div>
                        <p className="selectable-text mt-1 text-xs text-on-surface whitespace-pre-wrap break-words">
                          {summary.answerSummary}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
                {summaryStatus === 'generating'
                  ? '최근 대화의 요약을 생성하는 중입니다.'
                  : summaryStatus === 'error'
                    ? (summaryStatusMessage || '요약 생성에 실패했습니다.')
                    : '저장된 요약이 없습니다. 내보내기를 누르면 전체 대화에서 요약을 생성합니다.'}
              </div>
            )}
          </section>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[90%] bg-primary text-on-primary px-3.5 py-2.5 rounded-2xl rounded-tr-sm">
                  <p className="selectable-text whitespace-pre-wrap break-words" style={userFontStyle}>{msg.content}</p>
                </div>
              </div>
            ) : (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-full bg-surface-container flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={11} strokeWidth={2} className="text-on-surface-variant" />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="chat-markdown selectable-text font-editorial text-on-surface"
                    style={assistantFontStyle}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        code: ({ children, className }) => {
                          const isBlock = Boolean(className);
                          if (isBlock) {
                            return (
                              <code
                                className="block overflow-x-auto rounded-lg bg-surface-container px-3 py-2 font-functional"
                                style={codeFontStyle}
                              >
                                {children}
                              </code>
                            );
                          }

                          return (
                            <code
                              className="rounded bg-surface-container px-1.5 py-0.5 font-functional"
                              style={codeFontStyle}
                            >
                              {children}
                            </code>
                          );
                        },
                        pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,
                        blockquote: ({ children }) => (
                          <blockquote className="mb-3 border-l-2 border-outline-variant pl-3 text-on-surface-variant last:mb-0">
                            {children}
                          </blockquote>
                        ),
                      }}
                    >
                      {normalizeMathMarkdown(msg.content)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="rounded-xl bg-surface-container px-3 py-2.5">
            <button
              onClick={handleThinkingToggle}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-2">
                <Loader2 size={12} strokeWidth={2} className="text-on-surface-variant animate-spin" />
                <span className="text-xs font-medium text-on-surface-variant">생각하는 중</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-outline">
                {thinkingDraft ? '자세히 보기' : '출력 기다리는 중'}
                <ChevronDown
                  size={12}
                  strokeWidth={2.5}
                  className={`transition-transform ${thinkingOpen ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {thinkingOpen && (
              <div className="mt-3 border-t border-outline-variant/20 pt-3">
                <div className="rounded-lg bg-surface-container-low px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-outline mb-1">
                    실시간 출력
                  </div>
                  {thinkingDraft ? (
                    <pre className="selectable-text whitespace-pre-wrap break-words text-[11px] text-on-surface-variant font-functional">
                      {thinkingDraft}
                    </pre>
                  ) : (
                    <div className="text-[11px] text-outline">아직 실시간 출력이 없습니다.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 shrink-0">
        <div className="mb-2 flex gap-1.5 overflow-x-auto">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => {
                setInput(prompt);
                inputRef.current?.focus();
              }}
              disabled={isLoading}
              className="h-8 shrink-0 rounded-lg bg-surface-container px-2.5 text-[11px] font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
            >
              {prompt.replace('이 논문의 ', '').replace(' 알려줘.', '').replace(' 정리해줘.', '').replace(' 설명해줘.', '')}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 bg-surface-container-low rounded-xl px-3 py-2.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="논문에 관해 질문하세요..."
            rows={1}
            className="flex-1 bg-transparent text-on-surface outline-none resize-none placeholder:text-outline font-editorial"
            style={inputFontStyle}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !selectedModel || !activeSessionFolder || !activeSessionKind}
            className="w-7 h-7 rounded-lg bg-primary text-on-primary flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          >
            <Send size={13} strokeWidth={2} />
          </button>
        </div>
      </div>

      <MarkdownPreviewDialog
        open={summaryExportOpen}
        title="대화 요약 Markdown 미리보기"
        description="다운로드 전에 전체 대화에서 만든 Markdown을 확인하세요."
        fileName={summaryMarkdownFileName}
        markdown={summaryMarkdown}
        loading={summaryStatus === 'generating'}
        confirmLabel="Markdown 내려받기"
        onCancel={() => setSummaryExportOpen(false)}
        onConfirm={handleSummaryExport}
      />
    </div>
  );
}
