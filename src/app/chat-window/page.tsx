'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { ChatPanel } from '@/components/workspace/ChatPanel';
import { WorkspaceContext, WorkspaceState } from '@/lib/workspace-store';
import { Session, SessionKind, TreeNode } from '@/types';

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
    openChat: () => undefined,
    setActivePdfPage: () => undefined,
    queueChatRequest: () => undefined,
    consumeChatRequest: () => undefined,
    navigateToPdfSource: () => undefined,
    consumePdfSourceNavigation: () => undefined,
    focusChatMessage: () => undefined,
    consumeFocusChatMessage: () => undefined,
    notifyChatSaved: () => undefined,
    queueStudyCardRequest: () => undefined,
    consumeStudyCardRequest: () => undefined,
    openPdfReview: () => undefined,
    consumeReaderReviewRequest: () => undefined,
    openStudyReview: () => undefined,
    closeStudyReview: () => undefined,
    notifyStudyCardsChanged: () => undefined,
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
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-sm font-semibold text-on-surface">이전 대화의 문맥을 불러오지 못했습니다.</p>
              <p className="text-sm leading-6 text-on-surface-variant">기존 대화는 PageDock에 보존됩니다. 이 창에서는 새 대화를 시작하지 않습니다.</p>
              <Link href="/" className="inline-flex rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary">
                PageDock 열기
              </Link>
            </div>
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
