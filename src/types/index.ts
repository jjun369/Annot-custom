// ── Tree Structure ──────────────────────────────────────────────

export type TreeNodeType = 'folder' | 'pdf';

export interface TreeNode {
  id: string;
  documentId?: string;
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
  documentId?: string;
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
  documentId?: string;
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
  documentId?: string;
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

// ── Technology research ────────────────────────────────────────

export type ResearchDocumentKind = 'paper' | 'patent' | 'conference' | 'product' | 'technical';
export type EvidenceLevel = 'explicit' | 'figure_inference' | 'technical_inference' | 'uncertain';
export type ResearchJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ResearchDocument {
  id: string;
  sha256?: string;
  currentPath?: string;
  fileName?: string;
  displayTitle: string;
  kind: ResearchDocumentKind;
  doi?: string;
  sourceUrl?: string;
  sourceProvider?: string;
  abstractText: string;
  authors: string[];
  publicationYear?: number;
  tags: string[];
  fileSize?: number;
  fileMtimeMs?: number;
  missing: boolean;
  indexedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchProject {
  id: string;
  name: string;
  description: string;
  profileId: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisProfile {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  focusAreas: string[];
  questions: string[];
  metrics: string[];
  terminology: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
}

export interface PatentMetadata {
  documentId: string;
  publicationNumber?: string;
  applicationNumber?: string;
  registrationNumber?: string;
  priorityDate?: string;
  filingDate?: string;
  publicationDate?: string;
  jurisdiction?: string;
  legalStatus?: string;
  assignees: string[];
  inventors: string[];
  familyId?: string;
  citations: string[];
  claimsText: string;
  updatedAt: string;
}

export interface EvidenceAnchor {
  id: string;
  documentId: string;
  reportId: string;
  level: EvidenceLevel;
  page?: number;
  section?: string;
  claim?: string;
  figure?: string;
  quote: string;
  note: string;
}

export interface ResearchAnalysisReport {
  id: string;
  documentId: string;
  projectId?: string;
  profileId: string;
  status: ResearchJobStatus;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  report: Record<string, unknown>;
  evidence: EvidenceAnchor[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSearchResult {
  document: ResearchDocument;
  score: number;
  snippet: string;
  matches: string[];
  projectIds: string[];
}
