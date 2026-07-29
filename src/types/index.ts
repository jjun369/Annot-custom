// ── Tree Structure ──────────────────────────────────────────────

export type TreeNodeType = 'folder' | 'pdf';

export interface TreeNode {
  id: string;
  name: string;
  type: TreeNodeType;
  path: string;            // filesystem path relative to root
  children?: TreeNode[];   // only for folders
}

// ── Sessions ────────────────────────────────────────────────────

export type SessionKind = 'folder' | 'pdf';
export type AIProvider = 'codex' | 'claude';
export type ReasoningEffort = 'auto' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface Session {
  id: string;
  folderPath: string;      // which folder this session belongs to
  sessionKind: SessionKind;
  pdfPath?: string;
  provider: AIProvider;
  providerSessionId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  turnSummaries?: SessionTurnSummary[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
}

export interface SessionTurnSummary {
  id: string;
  questionMessageId: string;
  assistantMessageId: string;
  question: string;
  answerSummary: string;
  createdAt: string;
  model?: string;
}

// ── Highlights ──────────────────────────────────────────────────

export interface Highlight {
  id: string;
  annotationId?: string;
  pdfPath: string;
  page: number;
  type: 'important' | 'unknown';
  text: string;
  note?: string;
  rects?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type ReadingStatus = 'unread' | 'reading' | 'completed';

export interface PaperTranslation {
  id: string;
  kind: 'selection' | 'full';
  title: string;
  sourceMarkdown: string;
  translatedMarkdown: string;
  bilingualMarkdown: string;
  createdAt: string;
  model?: string;
}

export interface PaperMetadata {
  pdfPath: string;
  aiKeywords: string[];
  personalTags: string[];
  summaryKo: string;
  noteMarkdown: string;
  readingStatus: ReadingStatus;
  rating: number;
  importance: number;
  analyzedAt?: string;
  analysisModel?: string;
  lastOpenedAt?: string;
  updatedAt: string;
  translations: PaperTranslation[];
}
