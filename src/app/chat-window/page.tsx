'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ChatPanel } from '@/components/workspace/ChatPanel';
import { WorkspaceContext, WorkspaceState } from '@/lib/workspace-store';
import { Session, SessionKind, TreeNode } from '@/types';

const WORKSPACE_SYNC_CHANNEL = 'annot-workspace-sync';

export default function ChatWindowPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-on-surface-variant">대화창을 준비하는 중...</div>}>
      <ChatWindowContent />
    </Suspense>
  );
}

function ChatWindowContent() {
  const params = useSearchParams();
  const initialFolder = params.get('folderPath') || '';
  const initialKind: SessionKind = params.get('sessionKind') === 'folder' ? 'folder' : 'pdf';
  const initialPdfPath = params.get('pdfPath');
  const initialSessionId = params.get('sessionId');
  const [state, setState] = useState<WorkspaceState>({
    treeRoot: null,
    treeLoading: false,
    selectedNode: null,
    activePdf: initialPdfPath ? pdfNode(initialPdfPath) : null,
    activeSessionFolder: initialFolder,
    activeSessionKind: initialKind,
    activeSessionPdfPath: initialPdfPath,
    activeSessionId: initialSessionId,
    explorerOpen: false,
    chatOpen: true,
  });
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    const channel = new BroadcastChannel(WORKSPACE_SYNC_CHANNEL);
    const timeout = window.setTimeout(() => setConnectionState('disconnected'), 1800);
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type !== 'context') return;
      window.clearTimeout(timeout);
      setConnectionState('connected');
      setState((current) => ({
        ...current,
        activeSessionFolder: event.data.activeSessionFolder,
        activeSessionKind: event.data.activeSessionKind,
        activeSessionPdfPath: event.data.activeSessionPdfPath,
        activeSessionId: event.data.activeSessionId,
        activePdf: event.data.activePdf,
      }));
    };
    channel.postMessage({ type: 'detached-chat-hello' });
    return () => {
      window.clearTimeout(timeout);
      channel.close();
    };
  }, []);

  const openSession = useCallback((session: Pick<Session, 'id' | 'folderPath' | 'sessionKind' | 'pdfPath'>) => {
    setState((current) => ({
      ...current,
      activeSessionFolder: session.folderPath,
      activeSessionKind: session.sessionKind,
      activeSessionPdfPath: session.pdfPath || null,
      activeSessionId: session.id,
    }));
  }, []);

  const value = useMemo(() => ({
    ...state,
    selectNode: () => undefined,
    clearSelection: () => undefined,
    openPdf: () => undefined,
    openSession,
    closePdf: () => undefined,
    toggleExplorer: () => undefined,
    toggleChat: () => window.close(),
    refreshTree: async () => null,
  }), [openSession, state]);

  return (
    <WorkspaceContext value={value}>
      <main className="h-screen bg-surface-container-lowest">
        {state.activeSessionFolder ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/15 bg-surface px-4 py-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">분리된 AI 대화창</div>
                <div className="mt-0.5 truncate text-xs font-medium text-on-surface">
                  {state.activePdf?.name || state.activeSessionFolder}
                </div>
              </div>
              <div className={`flex shrink-0 items-center gap-1.5 text-[10px] ${connectionState === 'connected' ? 'text-primary' : connectionState === 'disconnected' ? 'text-error' : 'text-outline'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connectionState === 'connected' ? 'bg-primary' : connectionState === 'disconnected' ? 'bg-error' : 'bg-outline'}`} />
                {connectionState === 'connected' ? '메인 창 연결됨' : connectionState === 'disconnected' ? '메인 창 연결 끊김' : '연결 확인 중'}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-on-surface-variant">
            원래 PageDock 창에서 폴더나 PDF를 선택해 주세요.
          </div>
        )}
      </main>
    </WorkspaceContext>
  );
}

function pdfNode(pdfPath: string): TreeNode {
  const name = pdfPath.split('/').at(-1) || 'PDF';
  return { id: `pdf:${pdfPath}`, name, type: 'pdf', path: pdfPath };
}
