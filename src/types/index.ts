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

export type SessionKind = 'folder' | 'pdf' | 'sidechat';
export type AIProvider = 'codex' | 'claude';
export type ReasoningEffort = 'auto' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export type ChatSourceScope = 'selection' | 'page' | 'pdf';

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A durable, page-relative bookmark for a visual part of a PDF. The PDF is
 * always the source of truth: no crop, thumbnail, OCR, or AI interpretation
 * is persisted with this anchor.
 */
export type VisualRegionKind = 'figure' | 'table' | 'equation' | 'process_condition' | 'custom';

export interface VisualRegion {
  id: string;
  documentId?: string;
  page: number;
  rect: HighlightRect;
  kind: VisualRegionKind;
  memo: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderSummary {
  page?: number;
  unresolvedCount: number;
  openWorkCount: number;
  /** Existing metadata only; this is a transient Library cue, not new study state. */
  lastOpenedAt?: string;
}

export interface ChatSourceContext {
  id: string;
  scope: ChatSourceScope;
  documentId?: string;
  page?: number;
  text?: string;
  rects?: HighlightRect[];
  highlightId?: string;
}

export type StudyCardOrigin = 'selection' | 'chat';
export type StudyCardReviewResult = 'again' | 'remembered';
export type StudyCardKind = 'basic' | 'cloze';

/**
 * One continuous exact-text span inside a selection card's immutable source
 * excerpt. It is presentation state, not a second PDF locator.
 */
export interface StudyCardCloze {
  text: string;
  start: number;
  end: number;
}

export interface StudyCardReviewState {
  reviewCount: number;
  lastReviewedAt?: string;
  lastResult?: StudyCardReviewResult;
  /**
   * Local calendar day in YYYY-MM-DD form. It deliberately has no time or
   * timezone component: recall is a "today" workflow, not an alarm.
   */
  nextReviewDate?: string;
}

/**
 * A portable active-recall card. `sourceContext` deliberately reuses the
 * Reader/Chat anchor contract instead of introducing a second PDF locator.
 */
export interface StudyCard {
  id: string;
  documentId?: string;
  sourceContext: ChatSourceContext;
  /** Missing on 0.6/0.7 cards means the original basic recall renderer. */
  kind?: StudyCardKind;
  /** Additive only for kind === 'cloze'; offsets are into sourceContext.text. */
  clozeText?: string;
  clozeStart?: number;
  clozeEnd?: number;
  front: string;
  back: string;
  origin: StudyCardOrigin;
  createdAt: string;
  updatedAt: string;
  review: StudyCardReviewState;
}

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
  sourceContext?: ChatSourceContext;
  /** Mutable path hint for returning from a sidechat; documentId remains authoritative. */
  sourcePdfPath?: string;
  replyToMessageId?: string;
  /** Stable local request identity for a selection question saved before AI. */
  deepSeekRequestId?: string;
  /** Stable id for a sidechat question saved before optional provider use. */
  sideChatQuestionRequestId?: string;
  /**
   * Explicitly imported alternative answers. They never replace a primary
   * provider answer and may be anchored to either an assistant reply or a
   * pre-saved bounded user question.
   */
  secondaryPerspectives?: ChatSecondaryPerspective[];
  /** Explicitly pasted answers from the isolated web-AI tabs in a sidechat. */
  sideChatPerspectives?: SideChatWebPerspective[];
  sideChatWebRequests?: SideChatWebRequest[];
}

/**
 * A DeepSeek web answer that the user copied and deliberately imported after
 * reviewing the exact bounded prompt in PageDock. It contains no web session,
 * cookie, credential, DOM, or remote conversation-history data.
 */
export interface ChatSecondaryPerspective {
  id: string;
  provider: 'deepseek';
  transport: 'web-manual';
  acquisition: 'user-paste';
  sourceMessageId: string;
  questionMessageId: string;
  promptSnapshot: string;
  promptSha256: string;
  responseText: string;
  /** Omitted when an imported answer was recovered after the original request was no longer observable. */
  requestedAt?: string;
  importedAt: string;
  /** The DeepSeek web UI model is not reliably observable by PageDock. */
  model: null;
}

export type SideChatWebProviderId = 'deepseek' | 'chatgpt' | 'claude' | 'gemini';
export type SideChatOutboundMode = 'question' | 'source-question' | 'source-question-answer' | 'question-answer';

export interface SideChatWebRequest {
  id: string;
  sessionId: string;
  questionMessageId: string;
  provider: SideChatWebProviderId;
  intent: 'independent' | 'review';
  promptMode: SideChatOutboundMode;
  promptVersion: string;
  promptSnapshot: string;
  promptSha256: string;
  questionText: string;
  answerMessageId?: string;
  answerText?: string;
  sourceContext?: ChatSourceContext;
  sourcePdfPath?: string;
  preparedAt: string;
  copiedAt?: string;
}

/**
 * A web-AI answer explicitly pasted back into an independent sidechat. The
 * model label is optional and user-supplied; PageDock does not verify it.
 */
export interface SideChatWebPerspective {
  id: string;
  requestId?: string;
  provider: SideChatWebProviderId;
  acquisition: 'user-paste';
  promptMode: SideChatOutboundMode;
  promptSnapshot: string;
  promptSha256: string;
  responseText: string;
  importedAt: string;
  model?: string | null;
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

export type HighlightStudyKind = 'important' | 'concept' | 'memorize' | 'question' | 'unclear';
export type HighlightWorkKind = 'finding' | 'verify' | 'discuss' | 'try';

export interface Highlight {
  id: string;
  documentId?: string;
  annotationId?: string;
  pdfPath: string;
  page: number;
  type: 'important' | 'unknown';
  text: string;
  note?: string;
  rects?: HighlightRect[];
  position: HighlightRect;
  studyKind?: HighlightStudyKind;
  resolvedAt?: string;
  /**
   * Optional local-only work classification. The existing note remains the
   * interpretation or follow-up text; this is deliberately not a task model.
   */
  workKind?: HighlightWorkKind;
  /** Present only for completed Verify / Discuss / Try follow-ups. */
  workDoneAt?: string;
  createdAt?: string;
  updatedAt?: string;
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

export interface ReadingPosition {
  page: number;
  pageOffsetRatio: number;
  viewMode: 'paged' | 'scroll';
  updatedAt: string;
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
  readingPosition?: ReadingPosition;
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
