'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Session, TreeNode } from '@/types';
import {
  type PdfSourceNavigation,
  type PendingChatRequest,
  type PendingReaderReviewRequest,
  type PendingStudyCardRequest,
  WorkspaceContext,
  WorkspaceState,
} from '@/lib/workspace-store';
import { REQUEST_PDF_UPLOAD_EVENT, TreeExplorer } from '@/components/tree/TreeExplorer';
import { FolderView } from '@/components/workspace/FolderView';
import { ChatPanel } from '@/components/workspace/ChatPanel';
import { Topbar } from '@/components/layout/Topbar';
import { findNode, getParentFolderPath, hasPdfDescendant } from '@/lib/tree-utils';
import { PageDockMark } from '@/components/common/PageDockMark';
import { OnboardingDialog } from '@/components/common/OnboardingDialog';
import { StudyCardDialog } from '@/components/workspace/StudyCardDialog';
import { StudyReviewDialog } from '@/components/workspace/StudyReviewDialog';
import { FilePlus } from 'lucide-react';

const PdfViewer = dynamic(
  () => import('@/components/workspace/PdfViewer').then((mod) => mod.PdfViewer),
  { ssr: false },
);

const DEFAULT_CHAT_PANEL_WIDTH = 320;
const MIN_CHAT_PANEL_WIDTH = 320;
const MAX_CHAT_PANEL_WIDTH = 720;
const MIN_MAIN_CONTENT_WIDTH = 640;
const CHAT_RESIZE_HANDLE_WIDTH = 8;
const COMPACT_EXPLORER_BREAKPOINT = 1200;
const AUXILIARY_OVERLAY_BREAKPOINT = 1040;
const CHAT_PANEL_WIDTH_STORAGE_KEY = 'annot-chat-panel-width';
const READER_CONTEXT_STORAGE_KEY = 'pagedock:last-reader-pdf';

function readLastReaderPath(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(READER_CONTEXT_STORAGE_KEY);
    return value?.toLowerCase().endsWith('.pdf') ? value : null;
  } catch {
    return null;
  }
}

function writeLastReaderPath(pdfPath: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (pdfPath) {
      window.sessionStorage.setItem(READER_CONTEXT_STORAGE_KEY, pdfPath);
    } else {
      window.sessionStorage.removeItem(READER_CONTEXT_STORAGE_KEY);
    }
  } catch {
    // Route continuity is a convenience. The portable reading position remains authoritative.
  }
}

export default function AppPage() {
  const [state, setState] = useState<WorkspaceState>({
    treeRoot: null,
    treeLoading: true,
    selectedNode: null,
    activePdf: null,
    activeSessionFolder: null,
    activeSessionKind: null,
    activeSessionPdfPath: null,
    activeSessionId: null,
    explorerOpen: true,
    chatOpen: false,
    activePdfPage: 1,
    pendingChatRequest: null,
    pendingPdfSourceNavigation: null,
    focusChatMessageId: null,
    chatRevision: 0,
    pendingStudyCardRequest: null,
    pendingReaderReviewRequest: null,
    studyReviewOpen: false,
    studyCardsRevision: 0,
  });
  const [chatPanelWidth, setChatPanelWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const chatOverlayRef = useRef<HTMLDivElement>(null);
  const chatFocusReturnRef = useRef<HTMLElement | null>(null);
  const wasChatOpenRef = useRef(false);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  const openPdfInContext = useCallback((currentState: WorkspaceState, pdf: TreeNode) => {
    writeLastReaderPath(pdf.path);
    const parentFolderPath = getParentFolderPath(pdf);
    const keepCurrentSession = (
      currentState.activeSessionKind === 'pdf' &&
      currentState.activeSessionPdfPath === pdf.path
    );

    return {
      ...currentState,
      selectedNode: pdf,
      activePdf: pdf,
      activeSessionFolder: parentFolderPath,
      activeSessionKind: 'pdf' as const,
      activeSessionPdfPath: pdf.path,
      activeSessionId: keepCurrentSession ? currentState.activeSessionId : null,
      chatOpen: keepCurrentSession ? currentState.chatOpen : false,
      activePdfPage: 1,
      pendingChatRequest: null,
      pendingPdfSourceNavigation: null,
      focusChatMessageId: null,
      pendingStudyCardRequest: null,
      pendingReaderReviewRequest: null,
      studyReviewOpen: false,
    };
  }, []);

  const selectNode = useCallback((node: TreeNode) => {
    if (node.type === 'folder') {
      setState((s) => ({
        ...s,
        selectedNode: node,
        activePdf: null,
        activeSessionFolder: node.path,
        activeSessionKind: 'folder',
        activeSessionPdfPath: null,
        activeSessionId: null,
        chatOpen: false,
        activePdfPage: 1,
        pendingChatRequest: null,
        pendingPdfSourceNavigation: null,
        focusChatMessageId: null,
        pendingStudyCardRequest: null,
        pendingReaderReviewRequest: null,
        studyReviewOpen: false,
      }));
    } else {
      setState((s) => openPdfInContext(s, node));
    }
  }, [openPdfInContext]);

  const clearSelection = useCallback(() => {
    setState((s) => ({
      ...s,
      selectedNode: null,
      activePdf: null,
      activeSessionFolder: null,
      activeSessionKind: null,
      activeSessionPdfPath: null,
      activeSessionId: null,
      chatOpen: false,
      activePdfPage: 1,
      pendingChatRequest: null,
      pendingPdfSourceNavigation: null,
      focusChatMessageId: null,
      pendingStudyCardRequest: null,
      pendingReaderReviewRequest: null,
      studyReviewOpen: false,
    }));
  }, []);

  const openPdf = useCallback((pdf: TreeNode) => {
    setState((s) => openPdfInContext(s, pdf));
  }, [openPdfInContext]);

  const openPdfReview = useCallback((pdf: TreeNode) => {
    const request: PendingReaderReviewRequest = {
      id: crypto.randomUUID(),
      pdfPath: pdf.path,
    };
    setState((s) => ({
      ...openPdfInContext(s, pdf),
      pendingReaderReviewRequest: request,
    }));
  }, [openPdfInContext]);

  const openSession = useCallback((session: Pick<Session, 'id' | 'folderPath' | 'sessionKind' | 'pdfPath'>) => {
    setState((s) => ({
      ...s,
      activeSessionFolder: session.folderPath,
      activeSessionKind: session.sessionKind,
      activeSessionPdfPath: session.pdfPath || null,
      activeSessionId: session.id,
      chatOpen: true,
    }));
  }, []);

  const closePdf = useCallback(() => {
    writeLastReaderPath(null);
    setState((s) => {
      const parentFolder = s.treeRoot && s.activePdf
        ? findNode(s.treeRoot, getParentFolderPath(s.activePdf))
        : null;
      const selectedNode = parentFolder?.type === 'folder'
        ? parentFolder
        : s.treeRoot?.type === 'folder'
          ? s.treeRoot
          : null;
      return { ...s, activePdf: null, selectedNode };
    });
  }, []);

  const toggleExplorer = useCallback(() => {
    setState((s) => ({ ...s, explorerOpen: !s.explorerOpen }));
  }, []);

  const toggleChat = useCallback(() => {
    setState((s) => ({ ...s, chatOpen: !s.chatOpen }));
  }, []);

  const openChat = useCallback(() => {
    setState((s) => ({ ...s, chatOpen: true }));
  }, []);

  const setActivePdfPage = useCallback((page: number) => {
    if (!Number.isFinite(page) || page < 1) return;
    setState((s) => ({ ...s, activePdfPage: Math.floor(page) }));
  }, []);

  const queueChatRequest = useCallback((request: PendingChatRequest) => {
    setState((s) => ({
      ...s,
      chatOpen: true,
      pendingChatRequest: request,
    }));
  }, []);

  const consumeChatRequest = useCallback((requestId: string) => {
    setState((s) => s.pendingChatRequest?.id === requestId
      ? { ...s, pendingChatRequest: null }
      : s);
  }, []);

  const navigateToPdfSource = useCallback((request: PdfSourceNavigation) => {
    setState((s) => {
      const target = s.treeRoot ? findNode(s.treeRoot, request.pdfPath) : null;
      const next = target?.type === 'pdf' ? openPdfInContext(s, target) : s;
      return {
        ...next,
        chatOpen: true,
        activePdfPage: request.page,
        pendingPdfSourceNavigation: request,
      };
    });
  }, [openPdfInContext]);

  const consumePdfSourceNavigation = useCallback((requestId: string) => {
    setState((s) => s.pendingPdfSourceNavigation?.id === requestId
      ? { ...s, pendingPdfSourceNavigation: null }
      : s);
  }, []);

  const focusChatMessage = useCallback((messageId: string) => {
    setState((s) => ({ ...s, chatOpen: true, focusChatMessageId: messageId }));
  }, []);

  const consumeFocusChatMessage = useCallback((messageId: string) => {
    setState((s) => s.focusChatMessageId === messageId
      ? { ...s, focusChatMessageId: null }
      : s);
  }, []);

  const notifyChatSaved = useCallback(() => {
    setState((s) => ({ ...s, chatRevision: s.chatRevision + 1 }));
  }, []);

  const queueStudyCardRequest = useCallback((request: PendingStudyCardRequest) => {
    setState((s) => ({ ...s, pendingStudyCardRequest: request }));
  }, []);

  const consumeStudyCardRequest = useCallback((requestId: string) => {
    setState((s) => s.pendingStudyCardRequest?.id === requestId
      ? { ...s, pendingStudyCardRequest: null }
      : s);
  }, []);

  const consumeReaderReviewRequest = useCallback((requestId: string) => {
    setState((s) => s.pendingReaderReviewRequest?.id === requestId
      ? { ...s, pendingReaderReviewRequest: null }
      : s);
  }, []);

  const openStudyReview = useCallback(() => {
    setState((s) => s.activePdf ? { ...s, studyReviewOpen: true } : s);
  }, []);

  const closeStudyReview = useCallback(() => {
    setState((s) => ({ ...s, studyReviewOpen: false }));
  }, []);

  const notifyStudyCardsChanged = useCallback(() => {
    setState((s) => ({ ...s, studyCardsRevision: s.studyCardsRevision + 1 }));
  }, []);

  const refreshTree = useCallback(async () => {
    const res = await fetch('/api/workspace/tree', { cache: 'no-store' });
    const data = await res.json();

    if (!res.ok || data?.error) {
      throw new Error(typeof data?.error === 'string' ? data.error : '라이브러리를 불러오지 못했습니다.');
    }

    const nextTree = data as TreeNode;

    setState((current) => {
      const nextSelectedNode = current.selectedNode
        ? findNode(nextTree, current.selectedNode.path)
        : null;
      const nextActivePdf = current.activePdf
        ? findNode(nextTree, current.activePdf.path)
        : null;
      const nextActiveSessionFolder = current.activeSessionFolder
        ? findNode(nextTree, current.activeSessionFolder)
        : null;
      const isCurrentPdfSessionInvalid = current.activeSessionKind === 'pdf' && (
        !current.activeSessionPdfPath ||
        !findNode(nextTree, current.activeSessionPdfPath)
      );
      const isCurrentFolderSessionInvalid = current.activeSessionKind === 'folder' && !nextActiveSessionFolder;
      const shouldClearSession = isCurrentPdfSessionInvalid || isCurrentFolderSessionInvalid;

      return {
        ...current,
        treeRoot: nextTree,
        treeLoading: false,
        selectedNode: nextSelectedNode,
        activePdf: nextActivePdf?.type === 'pdf' ? nextActivePdf : null,
        activeSessionFolder: nextActiveSessionFolder?.type === 'folder'
          ? nextActiveSessionFolder.path
          : (shouldClearSession ? null : current.activeSessionFolder),
        activeSessionKind: shouldClearSession ? null : current.activeSessionKind,
        activeSessionPdfPath: nextActivePdf?.type === 'pdf'
          ? nextActivePdf.path
          : (shouldClearSession ? null : current.activeSessionPdfPath),
        activeSessionId: shouldClearSession ? null : current.activeSessionId,
        chatOpen: shouldClearSession ? false : current.chatOpen,
      };
    });

    return nextTree;
  }, []);

  useEffect(() => {
    if (!state.activePdf?.path) return;
    void fetch('/api/papers/metadata', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfPath: state.activePdf.path, lastOpenedAt: new Date().toISOString() }),
    });
  }, [state.activePdf?.path]);

  useEffect(() => {
    const hydratePreferences = async () => {
      try {
        const res = await fetch('/api/library/preferences', { cache: 'no-store' });
        const preferences = await res.json();
        if (preferences.aiProvider) {
          window.localStorage.setItem('annot-ai-provider', preferences.aiProvider);
          window.dispatchEvent(new CustomEvent('annot-ai-provider-change', { detail: preferences.aiProvider }));
        }
        if (preferences.chatFontSize) {
          window.localStorage.setItem('annot-chat-font-size', String(preferences.chatFontSize));
          window.dispatchEvent(new CustomEvent('annot-chat-font-size-change', { detail: preferences.chatFontSize }));
        }
        if (preferences.chatPanelWidth) {
          window.localStorage.setItem(CHAT_PANEL_WIDTH_STORAGE_KEY, String(preferences.chatPanelWidth));
          setChatPanelWidth(Math.max(MIN_CHAT_PANEL_WIDTH, Math.min(MAX_CHAT_PANEL_WIDTH, preferences.chatPanelWidth)));
          setPreferencesHydrated(true);
          return;
        }
      } catch {
        // Local browser preferences remain a fallback when the portable file is unavailable.
      }
      const storedWidth = window.localStorage.getItem(CHAT_PANEL_WIDTH_STORAGE_KEY);
      const parsedWidth = Number(storedWidth);
      if (Number.isFinite(parsedWidth)) {
        setChatPanelWidth(Math.max(MIN_CHAT_PANEL_WIDTH, Math.min(MAX_CHAT_PANEL_WIDTH, parsedWidth)));
      }
      setPreferencesHydrated(true);
    };
    void hydratePreferences();
  }, []);

  useEffect(() => {
    if (!preferencesHydrated) return;
    window.localStorage.setItem(CHAT_PANEL_WIDTH_STORAGE_KEY, String(chatPanelWidth));
    const timeout = window.setTimeout(() => {
      void fetch('/api/library/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatPanelWidth }),
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [chatPanelWidth, preferencesHydrated]);

  useEffect(() => {
    let cancelled = false;

    const loadTree = async () => {
      try {
        const res = await fetch('/api/workspace/tree', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled) {
          if (!res.ok || data?.error) {
            throw new Error(typeof data?.error === 'string' ? data.error : '라이브러리를 불러오지 못했습니다.');
          }
          const nextTree = data as TreeNode;
          const requestedPdfPath = new URLSearchParams(window.location.search).get('pdf');
          const requestedPdf = requestedPdfPath ? findNode(nextTree, requestedPdfPath) : null;
          const rememberedPdfPath = requestedPdfPath ? null : readLastReaderPath();
          const rememberedPdf = rememberedPdfPath ? findNode(nextTree, rememberedPdfPath) : null;
          const readerTarget = requestedPdf?.type === 'pdf'
            ? requestedPdf
            : rememberedPdf?.type === 'pdf'
              ? rememberedPdf
              : null;
          if (rememberedPdfPath && !rememberedPdf) writeLastReaderPath(null);
          setState((current) => {
            if (readerTarget) {
              return openPdfInContext({ ...current, treeRoot: nextTree, treeLoading: false }, readerTarget);
            }

            // Reopening the library should expose the calm "continue reading" landing
            // state immediately. This chooses the library folder only; it never opens a
            // PDF automatically or changes any persisted navigation preference.
            const preservedSelection = current.selectedNode
              ? findNode(nextTree, current.selectedNode.path)
              : null;
            const selectedNode = preservedSelection?.type === 'folder'
              ? preservedSelection
              : hasPdfDescendant(nextTree)
                ? nextTree
                : null;
            return { ...current, treeRoot: nextTree, treeLoading: false, selectedNode };
          });
        }
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            treeRoot: {
              id: 'root',
              name: 'PageDock Library',
              type: 'folder',
              path: '',
              children: [],
            },
            treeLoading: false,
          }));
        }
      }
    };

    void loadTree();

    return () => {
      cancelled = true;
    };
  }, [openPdfInContext]);

  useEffect(() => {
    if (!isResizingChat) {
      return;
    }

    const handlePointerMove = (event: MouseEvent) => {
      const mainContent = mainContentRef.current;
      if (!mainContent) {
        return;
      }

      const rect = mainContent.getBoundingClientRect();
      const maxAllowedWidth = Math.max(
        MIN_CHAT_PANEL_WIDTH,
        Math.min(MAX_CHAT_PANEL_WIDTH, rect.width - MIN_MAIN_CONTENT_WIDTH),
      );
      const nextWidth = rect.right - event.clientX;
      const clampedWidth = Math.min(Math.max(nextWidth, MIN_CHAT_PANEL_WIDTH), maxAllowedWidth);

      setChatPanelWidth(clampedWidth);
    };

    const handlePointerUp = () => {
      setIsResizingChat(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [isResizingChat]);

  useEffect(() => {
    if (!state.chatOpen) return;

    const mainContent = mainContentRef.current;
    if (!mainContent) return;

    const clampChatWidth = () => {
      const maxAllowedWidth = Math.max(
        MIN_CHAT_PANEL_WIDTH,
        Math.min(MAX_CHAT_PANEL_WIDTH, mainContent.clientWidth - MIN_MAIN_CONTENT_WIDTH - CHAT_RESIZE_HANDLE_WIDTH),
      );
      setChatPanelWidth((current) => Math.min(current, maxAllowedWidth));
    };

    clampChatWidth();
    const observer = new ResizeObserver(clampChatWidth);
    observer.observe(mainContent);
    return () => observer.disconnect();
  }, [state.chatOpen]);

  const ctx = {
    ...state,
    selectNode,
    clearSelection,
    openPdf,
    openSession,
    closePdf,
    toggleExplorer,
    toggleChat,
    openChat,
    setActivePdfPage,
    queueChatRequest,
    consumeChatRequest,
    navigateToPdfSource,
    consumePdfSourceNavigation,
    focusChatMessage,
    consumeFocusChatMessage,
    notifyChatSaved,
    queueStudyCardRequest,
    consumeStudyCardRequest,
    openPdfReview,
    consumeReaderReviewRequest,
    openStudyReview,
    closeStudyReview,
    notifyStudyCardsChanged,
  };
  const contextValue = { ...ctx, refreshTree };
  const libraryHasPdfs = hasPdfDescendant(state.treeRoot);
  const forceCompactExplorer = Boolean(
    state.activePdf
    && state.chatOpen
    && state.explorerOpen
    && viewportWidth > 0
    && viewportWidth < COMPACT_EXPLORER_BREAKPOINT,
  );
  const useAuxiliaryOverlay = Boolean(
    state.chatOpen
    && state.activeSessionFolder
    && viewportWidth > 0
    && viewportWidth < AUXILIARY_OVERLAY_BREAKPOINT,
  );

  useEffect(() => {
    if (state.chatOpen && !wasChatOpenRef.current) {
      chatFocusReturnRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    if (!state.chatOpen && wasChatOpenRef.current) {
      const previous = chatFocusReturnRef.current;
      if (previous?.isConnected) previous.focus();
      chatFocusReturnRef.current = null;
    }
    wasChatOpenRef.current = state.chatOpen;
  }, [state.chatOpen]);

  useEffect(() => {
    if (!useAuxiliaryOverlay) return;

    const animationFrame = window.requestAnimationFrame(() => chatOverlayRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      toggleChat();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleChat, useAuxiliaryOverlay]);

  return (
    <WorkspaceContext value={contextValue}>
      <div className="flex h-full flex-col bg-surface">
        <OnboardingDialog />
        <StudyCardDialog />
        <StudyReviewDialog />
        <Topbar />
        <div className="flex-1 flex overflow-hidden">
          {/* Tree Explorer */}
          <TreeExplorer forceCompact={forceCompactExplorer} />

          {/* Main Content Area */}
          <div ref={mainContentRef} className="relative flex min-w-0 flex-1 bg-surface">
            {state.activePdf ? (
              // PDF is open — show viewer
              <div className="flex min-w-0 flex-1 overflow-hidden">
                <PdfViewer key={state.activePdf.path} />
              </div>
            ) : state.selectedNode?.type === 'folder' ? (
              // Folder selected — show folder overview
              <div className="flex-1 min-w-0">
                <FolderView />
              </div>
            ) : (
              // Nothing selected — distinguish an empty library from an unselected document.
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="w-full max-w-sm rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-8 py-9 text-center shadow-sm">
                  <PageDockMark size={48} className="mx-auto mb-4 rounded-xl opacity-90 shadow-sm" />
                  <h2 className="text-base font-semibold text-on-surface">
                    {libraryHasPdfs ? '읽을 문서를 골라 주세요' : '라이브러리가 비어 있습니다'}
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-on-surface-variant">
                    {libraryHasPdfs
                      ? '왼쪽 라이브러리에서 PDF를 선택하면 바로 열립니다. 최근 읽은 문서는 다음에 열어도 마지막 위치에서 이어집니다.'
                      : 'PDF를 추가하면 읽기, 검색, 하이라이트와 메모를 로컬에서 사용할 수 있습니다.'}
                  </p>
                  {!libraryHasPdfs && (
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new Event(REQUEST_PDF_UPLOAD_EVENT))}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary"
                    >
                      <FilePlus size={15} /> PDF 추가
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Chat Panel */}
            {state.chatOpen && state.activeSessionFolder && (
              useAuxiliaryOverlay ? (
                <div
                  ref={chatOverlayRef}
                  role="region"
                  aria-label="AI 대화 오버레이"
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 z-40 w-80 max-w-full border-l border-outline-variant/10 bg-surface-container-lowest shadow-ambient outline-none"
                >
                  <ChatPanel />
                </div>
              ) : (
                <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize chat panel"
                  onMouseDown={() => setIsResizingChat(true)}
                  className="group relative w-2 shrink-0 cursor-col-resize bg-transparent"
                >
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-outline-variant/20 transition-colors group-hover:bg-outline-variant/70" />
                </div>
                <div
                  className="shrink-0 bg-surface-container-lowest border-l border-outline-variant/10"
                  style={{ width: `${chatPanelWidth}px` }}
                >
                  <ChatPanel />
                </div>
                </>
              )
            )}
          </div>
        </div>
      </div>
    </WorkspaceContext>
  );
}
