'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Session, TreeNode } from '@/types';
import { WorkspaceContext, WorkspaceState } from '@/lib/workspace-store';
import { REQUEST_PDF_UPLOAD_EVENT, TreeExplorer } from '@/components/tree/TreeExplorer';
import { FolderView } from '@/components/workspace/FolderView';
import { ChatPanel } from '@/components/workspace/ChatPanel';
import { Topbar } from '@/components/layout/Topbar';
import { findNode, getParentFolderPath } from '@/lib/tree-utils';
import { PageDockMark } from '@/components/common/PageDockMark';
import { OnboardingDialog } from '@/components/common/OnboardingDialog';
import { FilePlus } from 'lucide-react';

const PdfViewer = dynamic(
  () => import('@/components/workspace/PdfViewer').then((mod) => mod.PdfViewer),
  { ssr: false },
);

const DEFAULT_CHAT_PANEL_WIDTH = 420;
const MIN_CHAT_PANEL_WIDTH = 320;
const MAX_CHAT_PANEL_WIDTH = 720;
const MIN_MAIN_CONTENT_WIDTH = 360;
const CHAT_PANEL_WIDTH_STORAGE_KEY = 'annot-chat-panel-width';
const WORKSPACE_SYNC_CHANNEL = 'annot-workspace-sync';
const LAST_AUTO_BACKUP_KEY = 'annot-last-auto-backup';

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
  });
  const [chatPanelWidth, setChatPanelWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const openPdfInContext = useCallback((currentState: WorkspaceState, pdf: TreeNode) => {
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
    }));
  }, []);

  const openPdf = useCallback((pdf: TreeNode) => {
    setState((s) => openPdfInContext(s, pdf));
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
    setState((s) => ({ ...s, activePdf: null }));
  }, []);

  const toggleExplorer = useCallback(() => {
    setState((s) => ({ ...s, explorerOpen: !s.explorerOpen }));
  }, []);

  const toggleChat = useCallback(() => {
    setState((s) => ({ ...s, chatOpen: !s.chatOpen }));
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
    const lastBackup = Number(window.localStorage.getItem(LAST_AUTO_BACKUP_KEY) || 0);
    if (Date.now() - lastBackup < 24 * 60 * 60 * 1000) return;
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/library/backup', { method: 'POST' });
        if (res.ok) window.localStorage.setItem(LAST_AUTO_BACKUP_KEY, String(Date.now()));
      } catch {
        // A failed background backup is retried on the next launch.
      }
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(WORKSPACE_SYNC_CHANNEL);
    const contextMessage = {
      type: 'context',
      activeSessionFolder: state.activeSessionFolder,
      activeSessionKind: state.activeSessionKind,
      activeSessionPdfPath: state.activeSessionPdfPath,
      activeSessionId: state.activeSessionId,
      activePdf: state.activePdf,
    };
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'detached-chat-hello') {
        channel.postMessage(contextMessage);
      }
    };
    channel.postMessage(contextMessage);
    return () => channel.close();
  }, [
    state.activePdf,
    state.activeSessionFolder,
    state.activeSessionId,
    state.activeSessionKind,
    state.activeSessionPdfPath,
  ]);

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
          setState((current) => requestedPdf?.type === 'pdf'
            ? openPdfInContext({ ...current, treeRoot: nextTree, treeLoading: false }, requestedPdf)
            : { ...current, treeRoot: nextTree, treeLoading: false });
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

  const ctx = {
    ...state,
    selectNode,
    clearSelection,
    openPdf,
    openSession,
    closePdf,
    toggleExplorer,
    toggleChat,
  };
  const contextValue = { ...ctx, refreshTree };

  return (
    <WorkspaceContext value={contextValue}>
      <div className="flex h-full flex-col bg-surface">
        <OnboardingDialog />
        <Topbar />
        <div className="flex-1 flex overflow-hidden">
          {/* Tree Explorer */}
          <TreeExplorer />

          {/* Main Content Area */}
          <div ref={mainContentRef} className="flex min-w-0 flex-1 bg-surface">
            {state.activePdf ? (
              // PDF is open — show viewer
              <div className={`flex-1 min-w-0 ${state.chatOpen ? '' : ''}`}>
                <PdfViewer key={state.activePdf.path} />
              </div>
            ) : state.selectedNode?.type === 'folder' ? (
              // Folder selected — show folder overview
              <div className="flex-1 min-w-0">
                <FolderView />
              </div>
            ) : (
              // Nothing selected — empty state
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="w-full max-w-sm rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-8 py-9 text-center shadow-sm">
                  <PageDockMark size={48} className="mx-auto mb-4 rounded-xl opacity-90 shadow-sm" />
                  <h2 className="text-base font-semibold text-on-surface">라이브러리에서 시작하세요</h2>
                  <p className="mt-2 text-xs leading-5 text-on-surface-variant">
                    PDF를 PageDock Library에 복사하면 파일명이 바뀌어도 메모와 리서치 연결을 유지합니다.
                  </p>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event(REQUEST_PDF_UPLOAD_EVENT))}
                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary"
                  >
                    <FilePlus size={15} /> 첫 PDF 추가
                  </button>
                </div>
              </div>
            )}

            {/* Chat Panel */}
            {state.chatOpen && state.activeSessionFolder && (
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
            )}
          </div>
        </div>
      </div>
    </WorkspaceContext>
  );
}
