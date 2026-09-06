import { useEffect, useRef, useState } from 'react';
import { buildDeepSeekWebPrompt, DEEPSEEK_WEB_URL } from '@/lib/deepseek-web-bridge';
import { ChatMessage, ChatSecondaryPerspective, ChatSourceContext, Session } from '@/types';

export interface DeepSeekPerspectiveTarget {
  sessionId: string;
  folderPath: string;
  assistantMessageId?: string;
  questionMessageId: string;
  sourceText: string;
  question: string;
  sourceContext: ChatSourceContext;
  page?: number;
  prompt: string;
}

export interface DeepSeekComparisonState {
  primaryAnswer: string;
  perspective: ChatSecondaryPerspective;
  question: string;
  sourceContext: ChatSourceContext;
}

interface UseDeepSeekBridgeOptions {
  activeSessionId: string | null;
  activeSessionFolder: string | null;
  messages: ChatMessage[];
  isCurrentSession: (sessionId: string) => boolean;
  commitSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
  notify: (message: string, tone?: 'info' | 'success' | 'error') => void;
  notifyChatSaved: () => void;
  ensureSessionId: () => Promise<string>;
}

export function useDeepSeekBridge({
  activeSessionId,
  activeSessionFolder,
  messages,
  isCurrentSession,
  commitSessionMessages,
  notify,
  notifyChatSaved,
  ensureSessionId,
}: UseDeepSeekBridgeOptions) {
  const [promptTarget, setPromptTarget] = useState<DeepSeekPerspectiveTarget | null>(null);
  const [importTarget, setImportTarget] = useState<DeepSeekPerspectiveTarget | null>(null);
  const [importDrafts, setImportDrafts] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [comparison, setComparison] = useState<DeepSeekComparisonState | null>(null);
  const importOperationRef = useRef(0);
  const directRequestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  useEffect(() => {
    setPromptTarget(null);
    setImportTarget(null);
    setComparison(null);
  }, [activeSessionId]);

  const buildTarget = (message: ChatMessage): DeepSeekPerspectiveTarget | null => {
    if (!activeSessionId || !activeSessionFolder || message.sourceContext?.scope !== 'selection' || !message.sourceContext.text?.trim()) {
      return null;
    }
    const question = message.role === 'user'
      ? message
      : message.replyToMessageId
        ? messages.find((candidate) => candidate.id === message.replyToMessageId)
        : undefined;
    if (!question || question.role !== 'user') return null;
    const sourceText = message.sourceContext.text;
    return {
      sessionId: activeSessionId,
      folderPath: activeSessionFolder,
      ...(message.role === 'assistant' ? { assistantMessageId: message.id } : {}),
      questionMessageId: question.id,
      sourceText,
      question: question.content,
      sourceContext: message.sourceContext,
      page: message.sourceContext.page,
      prompt: buildDeepSeekWebPrompt({ sourceText, question: question.content }),
    };
  };

  const requestPerspective = (message: ChatMessage) => {
    const target = buildTarget(message);
    if (!target) {
      notify('연결된 원래 질문을 찾지 못했습니다.', 'error');
      return;
    }
    setPromptTarget(target);
  };

  const openImport = (message: ChatMessage) => {
    const target = buildTarget(message);
    if (target) setImportTarget(target);
    else notify('연결된 원래 질문을 찾지 못했습니다.', 'error');
  };

  const openImportTarget = (target: DeepSeekPerspectiveTarget) => {
    setPromptTarget(null);
    setImportTarget(target);
  };

  const getImportDraftKey = (target: DeepSeekPerspectiveTarget) => (
    `${target.sessionId}:${target.assistantMessageId ?? target.questionMessageId}`
  );

  const copyPrompt = async () => {
    if (!promptTarget) return;
    setOpening(true);
    try {
      if (window.pageDockDesktop?.deepseekWeb) {
        await window.pageDockDesktop.deepseekWeb.copyPrompt(promptTarget.prompt);
      } else {
        if (!navigator.clipboard?.writeText) throw new Error('질문을 복사하지 못했습니다. 아래 내용을 직접 선택해 복사해 주세요.');
        await navigator.clipboard.writeText(promptTarget.prompt);
      }
      notify('질문을 복사했습니다. DeepSeek에서 붙여넣고 직접 전송하세요.', 'info');
    } finally {
      setOpening(false);
    }
  };

  const openWeb = async () => {
    setOpening(true);
    try {
      if (window.pageDockDesktop?.deepseekWeb) {
        const result = await window.pageDockDesktop.deepseekWeb.open();
        notify(
          result.mode === 'external-fallback'
            ? '기본 브라우저에 DeepSeek 열기 요청을 보냈습니다. 질문을 붙여넣고 직접 전송하세요.'
            : 'DeepSeek 웹 창 열기 요청을 보냈습니다. 질문을 붙여넣고 직접 전송하세요.',
          'info',
        );
        return;
      }
      window.open(DEEPSEEK_WEB_URL, '_blank', 'noopener,noreferrer');
      notify('DeepSeek 웹 열기 요청을 보냈습니다. 팝업이 보이지 않으면 아래 링크를 다시 눌러 주세요.', 'info');
    } finally {
      setOpening(false);
    }
  };

  const setImportDraft = (value: string) => {
    if (!importTarget) return;
    const key = getImportDraftKey(importTarget);
    setImportDrafts((current) => ({ ...current, [key]: value }));
  };

  const readClipboard = async () => {
    if (!importTarget) return;
    let responseText: string;
    if (window.pageDockDesktop?.deepseekWeb) {
      responseText = await window.pageDockDesktop.deepseekWeb.readClipboardOnUserAction();
    } else {
      if (!navigator.clipboard?.readText) throw new Error('클립보드를 읽을 수 없습니다. 아래에 직접 붙여넣어 주세요.');
      responseText = await navigator.clipboard.readText();
    }
    if (!responseText.trim()) throw new Error('클립보드에 가져올 텍스트가 없습니다. DeepSeek 답변을 먼저 복사해 주세요.');
    const key = getImportDraftKey(importTarget);
    setImportDrafts((current) => ({ ...current, [key]: responseText }));
  };

  const saveImport = async () => {
    if (!importTarget) return;
    const target = importTarget;
    const operationId = importOperationRef.current + 1;
    importOperationRef.current = operationId;
    const draftKey = getImportDraftKey(target);
    const responseText = importDrafts[draftKey] ?? '';
    if (!responseText.trim()) {
      notify('DeepSeek 답변을 붙여넣어 주세요.', 'error');
      return;
    }
    setImportingKey(draftKey);
    try {
      const response = await fetch('/api/sessions/deepseek-perspectives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: target.folderPath,
          sessionId: target.sessionId,
          ...(target.assistantMessageId
            ? { assistantMessageId: target.assistantMessageId }
            : { questionMessageId: target.questionMessageId }),
          promptSnapshot: target.prompt,
          responseText,
        }),
      });
      const data = await response.json().catch(() => null) as { session?: Session; perspective?: ChatSecondaryPerspective; error?: string } | null;
      if (!response.ok || !data?.session) {
        throw new Error(data?.error || 'DeepSeek 답변을 저장하지 못했습니다.');
      }

      const savedMessages = Array.isArray(data.session.messages) ? data.session.messages : [];
      commitSessionMessages(target.sessionId, savedMessages);
      setImportDrafts((current) => {
        if (current[draftKey] !== responseText) return current;
        const next = { ...current };
        delete next[draftKey];
        return next;
      });
      setImportTarget((current) => {
        const currentKey = current ? getImportDraftKey(current) : null;
        return currentKey === draftKey ? null : current;
      });
      notifyChatSaved();
      notify('DeepSeek 답변을 원문과 질문에 연결해 저장했습니다.', 'success');
      if (isCurrentSession(target.sessionId) && data.perspective) {
        const savedSourceMessage = savedMessages.find((message) => message.id === (target.assistantMessageId ?? target.questionMessageId));
        const savedQuestionMessage = savedSourceMessage?.replyToMessageId
          ? savedMessages.find((message) => message.id === savedSourceMessage.replyToMessageId)
          : undefined;
        setComparison({
          primaryAnswer: savedSourceMessage?.role === 'assistant' ? savedSourceMessage.content
            ?? messages.find((message) => message.id === target.assistantMessageId)?.content
            ?? '' : '',
          perspective: data.perspective,
          question: savedQuestionMessage?.role === 'user' ? savedQuestionMessage.content : target.question,
          sourceContext: savedSourceMessage?.sourceContext ?? target.sourceContext,
        });
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'DeepSeek 답변을 저장하지 못했습니다.', 'error');
    } finally {
      if (importOperationRef.current === operationId) {
        setImportingKey((current) => current === draftKey ? null : current);
      }
    }
  };

  const compare = (message: ChatMessage, perspective: ChatSecondaryPerspective) => {
    const target = buildTarget(message);
    if (!target) return;
    setComparison({
      primaryAnswer: message.role === 'assistant' ? message.content : '',
      perspective,
      question: target.question,
      sourceContext: target.sourceContext,
    });
  };

  const saveDirectQuestion = async (question: string, sourceContext: ChatSourceContext): Promise<boolean> => {
    if (!activeSessionFolder || sourceContext.scope !== 'selection' || !sourceContext.text?.trim()) {
      notify('한 페이지의 선택 원문이 있는 질문에서만 DeepSeek를 사용할 수 있습니다.', 'error');
      return false;
    }
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      notify('질문을 입력해 주세요.', 'error');
      return false;
    }
    const fingerprint = JSON.stringify({ folderPath: activeSessionFolder, question: trimmedQuestion, sourceContext });
    const requestId = directRequestRef.current?.fingerprint === fingerprint
      ? directRequestRef.current.requestId
      : crypto.randomUUID();
    directRequestRef.current = { fingerprint, requestId };

    try {
      const sessionId = await ensureSessionId();
      const response = await fetch('/api/sessions/deepseek-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: activeSessionFolder,
          sessionId,
          requestId,
          prompt: trimmedQuestion,
          sourceContext,
        }),
      });
      const data = await response.json().catch(() => null) as {
        session?: Session;
        questionMessage?: ChatMessage;
        error?: string;
      } | null;
      if (!response.ok || !data?.session || !data.questionMessage) {
        throw new Error(data?.error || '질문을 로컬에 저장하지 못했습니다.');
      }
      commitSessionMessages(sessionId, Array.isArray(data.session.messages) ? data.session.messages : []);
      const savedSourceContext = data.questionMessage.sourceContext ?? sourceContext;
      const target: DeepSeekPerspectiveTarget = {
        sessionId,
        folderPath: activeSessionFolder,
        questionMessageId: data.questionMessage.id,
        sourceText: savedSourceContext.text ?? sourceContext.text ?? '',
        question: data.questionMessage.content,
        sourceContext: savedSourceContext,
        page: savedSourceContext.page,
        prompt: buildDeepSeekWebPrompt({
          sourceText: savedSourceContext.text ?? sourceContext.text ?? '',
          question: data.questionMessage.content,
        }),
      };
      setPromptTarget(target);
      notify('질문을 먼저 로컬 세션에 저장했습니다. 전송 내용을 확인하세요.', 'success');
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : '질문을 로컬에 저장하지 못했습니다.', 'error');
      return false;
    }
  };

  return {
    promptTarget,
    importTarget,
    importDrafts,
    opening,
    importing: Boolean(importTarget && importingKey === getImportDraftKey(importTarget)),
    comparison,
    buildTarget,
    requestPerspective,
    openImport,
    copyPrompt,
    openWeb,
    setImportDraft,
    readClipboard,
    saveImport,
    saveDirectQuestion,
    compare,
    openImportTarget,
    closePrompt: () => setPromptTarget(null),
    closeImport: () => setImportTarget(null),
    closeComparison: () => setComparison(null),
  };
}
