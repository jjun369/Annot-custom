'use client';

import { createContext, useContext } from 'react';
import { ChatSourceContext, HighlightRect, Session, SessionKind, StudyCardKind, StudyCardOrigin, TreeNode } from '@/types';

export interface PendingChatRequest {
  id: string;
  prompt: string;
  displayContent?: string;
  sourceContext?: ChatSourceContext;
  autoSend: boolean;
}

export interface PdfSourceNavigation {
  id: string;
  pdfPath: string;
  page: number;
  rects?: HighlightRect[];
}

export interface PendingStudyCardRequest {
  id: string;
  pdfPath: string;
  sourceContext: ChatSourceContext;
  front?: string;
  back?: string;
  origin: StudyCardOrigin;
  kind?: StudyCardKind;
}

/**
 * A one-shot Library → Reader request. It intentionally carries no study
 * data: the Reader reloads the authoritative highlights for the PDF and
 * applies only this presentation filter.
 */
export interface PendingReaderReviewRequest {
  id: string;
  pdfPath: string;
}

export interface WorkspaceState {
  // Current workspace tree rooted at the user's home Annot folder
  treeRoot: TreeNode | null;
  // Whether the tree is being loaded from disk
  treeLoading: boolean;
  // Currently selected node in the tree
  selectedNode: TreeNode | null;
  // Currently viewed PDF (subset of selection — clicking a pdf sets this)
  activePdf: TreeNode | null;
  // Currently active session folder path (where chat lives)
  activeSessionFolder: string | null;
  // Whether the active session is folder-wide or PDF-specific
  activeSessionKind: SessionKind | null;
  // PDF path for PDF-specific sessions
  activeSessionPdfPath: string | null;
  // Currently active Annot session id
  activeSessionId: string | null;
  // Whether the explorer sidebar is expanded
  explorerOpen: boolean;
  // Whether the chat panel is visible
  chatOpen: boolean;
  // Current PDF page is deliberately tiny shared state for page-scope chat.
  activePdfPage: number;
  // One-shot selection request consumed by ChatPanel.
  pendingChatRequest: PendingChatRequest | null;
  // One-shot source navigation consumed by PdfViewer.
  pendingPdfSourceNavigation: PdfSourceNavigation | null;
  // One-shot message focus consumed by ChatPanel.
  focusChatMessageId: string | null;
  // Event-style revision, used to refresh PDF anchors after a final save.
  chatRevision: number;
  // One-shot request consumed by the shared manual study-card editor.
  pendingStudyCardRequest: PendingStudyCardRequest | null;
  // One-shot request for the Reader's existing unresolved-record view.
  pendingReaderReviewRequest: PendingReaderReviewRequest | null;
  // P1 review is scoped to the currently opened PDF.
  studyReviewOpen: boolean;
  // Event-style revision for card create/update/review/delete operations.
  studyCardsRevision: number;
}

export interface WorkspaceActions {
  selectNode: (node: TreeNode) => void;
  clearSelection: () => void;
  openPdf: (pdf: TreeNode) => void;
  openSession: (session: Pick<Session, 'id' | 'folderPath' | 'sessionKind' | 'pdfPath'>) => void;
  closePdf: () => void;
  toggleExplorer: () => void;
  toggleChat: () => void;
  openChat: () => void;
  setActivePdfPage: (page: number) => void;
  queueChatRequest: (request: PendingChatRequest) => void;
  consumeChatRequest: (requestId: string) => void;
  navigateToPdfSource: (request: PdfSourceNavigation) => void;
  consumePdfSourceNavigation: (requestId: string) => void;
  focusChatMessage: (messageId: string) => void;
  consumeFocusChatMessage: (messageId: string) => void;
  notifyChatSaved: () => void;
  queueStudyCardRequest: (request: PendingStudyCardRequest) => void;
  consumeStudyCardRequest: (requestId: string) => void;
  openPdfReview: (pdf: TreeNode) => void;
  consumeReaderReviewRequest: (requestId: string) => void;
  openStudyReview: () => void;
  closeStudyReview: () => void;
  notifyStudyCardsChanged: () => void;
  refreshTree: () => Promise<TreeNode | null>;
}

export type WorkspaceContextType = WorkspaceState & WorkspaceActions;

export const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspace(): WorkspaceContextType {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
