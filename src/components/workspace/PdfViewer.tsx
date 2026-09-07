'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useWorkspace } from '@/lib/workspace-store';
import { ChatSourceContext, Highlight, HighlightRect, HighlightStudyKind, HighlightWorkKind, ReadingPosition, Session, StudyCardKind, VisualRegion, VisualRegionKind } from '@/types';
import { getHighlightRects, mergeHighlights, normalizeHighlightRects } from '@/lib/highlight-utils';
import { applyStudyKind, getStudyKindLabel, inferStudyKind, isUnresolvedHighlight, legacyTypeForStudyKind } from '@/lib/highlight-study';
import { applyWorkKind, getWorkKindLabel, getWorkNotePlaceholder, isWorkActionKind, isWorkDone } from '@/lib/highlight-work';
import { normalizeVisualRegionRect } from '@/lib/visual-regions';
import { MAX_SELECTION_CONTEXT_CHARS } from '@/lib/ai-providers/source-context';
import { normalizeReadingPosition } from '@/lib/reading-position';
import { notifyReaderSummaryChanged } from '@/lib/reader-summary-events';
import { normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { readStoredReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import {
  PDF_EXPORT_PREVIEW_FAILED,
  PDF_HIGHLIGHT_DELETE_FAILED,
  PDF_HIGHLIGHT_MIGRATION_DEFERRED,
  PDF_HIGHLIGHT_SAVE_DEFERRED,
  PDF_NOTE_SAVE_FAILED,
  PDF_TEXT_ANALYSIS_UNAVAILABLE,
  PDF_TRANSLATION_FAILED,
  PDF_TRANSLATION_SAVE_FAILED,
} from '@/lib/pdf-user-messages';
import { MarkdownPreviewDialog } from '@/components/common/MarkdownPreviewDialog';
import { KnowledgePromotionDialog, type KnowledgePromotionCandidate } from '@/components/knowledge/KnowledgePromotionDialog';
import { SelectionActionBar } from '@/components/workspace/pdf/SelectionActionBar';
import { AiAnchorMarker } from '@/components/workspace/pdf/AiAnchorMarker';
import { EvidenceBriefDialog } from '@/components/workspace/pdf/EvidenceBriefDialog';
import {
  ReaderRecordPanel,
  type ReaderLearningFilter,
  type ReaderRecordTab,
} from '@/components/workspace/pdf/ReaderRecordPanel';
import { VisualRegionDialog, type VisualRegionDraftLocation } from '@/components/workspace/pdf/VisualRegionDialog';
import {
  Minus,
  Plus,
  ChevronLeft,
  ChevronRight,
  Pen,
  Highlighter,
  Eraser,
  Download,
  FileDown,
  X,
  MessageSquare,
  Loader2,
  Save,
  Languages,
  BookOpenText,
  List,
  ScanLine,
  Search as SearchIcon,
  ChevronDown,
  MoreHorizontal,
  Smartphone,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const HIGHLIGHTS_STORAGE_KEY = 'annot-pdf-highlights';
const LAST_PAGE_STORAGE_KEY = 'annot-last-page';

type HighlightMode = Highlight['type'] | null;
type PdfViewMode = 'paged' | 'scroll';
type PdfExportKind = 'highlights' | 'evidence-brief';
type TranslationDraft = {
  kind: 'selection' | 'full';
  title: string;
  sourceMarkdown: string;
  translatedMarkdown: string;
  bilingualMarkdown: string;
  model?: string;
};

interface PdfSelectionSnapshot {
  page: number;
  text: string;
  rects: HighlightRect[];
  viewportRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

interface VisualRegionPointer {
  page: number;
  x: number;
  y: number;
}

interface AnchoredConversation {
  sourceContext: ChatSourceContext;
  session: Session;
  questionMessageId: string;
}

type SelectionNotice = string | {
  message: string;
  recordTab?: ReaderRecordTab;
  recordActionLabel?: string;
  recordLearningFilter?: ReaderLearningFilter;
};

function loadHighlights(): Record<string, Highlight[]> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(HIGHLIGHTS_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, Highlight[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveHighlights(nextHighlights: Record<string, Highlight[]>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HIGHLIGHTS_STORAGE_KEY, JSON.stringify(nextHighlights));
}

function getStoredHighlights(pdfPath: string): Highlight[] {
  const highlightStore = loadHighlights();
  return highlightStore[pdfPath] ?? [];
}

function setStoredHighlights(pdfPath: string, nextHighlights: Highlight[]): void {
  const highlightStore = loadHighlights();
  if (nextHighlights.length === 0) {
    delete highlightStore[pdfPath];
  } else {
    highlightStore[pdfPath] = nextHighlights;
  }
  saveHighlights(highlightStore);
}

export function PdfViewer() {
  const {
    activePdf,
    closePdf,
    activeSessionFolder,
    chatOpen,
    toggleChat,
    setActivePdfPage,
    queueChatRequest,
    queueStudyCardRequest,
    openStudyReview,
    pendingPdfSourceNavigation,
    consumePdfSourceNavigation,
    pendingReaderReviewRequest,
    consumeReaderReviewRequest,
    openSession,
    focusChatMessage,
    chatRevision,
  } = useWorkspace();
  const activePdfPath = activePdf?.path ?? '';
  const [zoom, setZoom] = useState(125);
  const [renderZoom, setRenderZoom] = useState(125);
  const [fitMode, setFitMode] = useState<'manual' | 'width' | 'page'>('manual');
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<PdfViewMode>('scroll');
  const [containerWidth, setContainerWidth] = useState(720);
  const [containerHeight, setContainerHeight] = useState(640);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>(null);
  const [eraseMode, setEraseMode] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [visualRegions, setVisualRegions] = useState<VisualRegion[]>([]);
  const [visualCaptureMode, setVisualCaptureMode] = useState(false);
  const [visualRegionPointer, setVisualRegionPointer] = useState<VisualRegionPointer | null>(null);
  const [visualRegionPreview, setVisualRegionPreview] = useState<VisualRegionDraftLocation | null>(null);
  const [visualRegionDraft, setVisualRegionDraft] = useState<VisualRegionDraftLocation | null>(null);
  const [selectedVisualRegionId, setSelectedVisualRegionId] = useState<string | null>(null);
  const [visualRegionEditing, setVisualRegionEditing] = useState<VisualRegion | null>(null);
  const [visualRegionSaving, setVisualRegionSaving] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<SelectionNotice | null>(null);
  const [recordTabRequest, setRecordTabRequest] = useState<{
    tab: ReaderRecordTab;
    id: string;
    learningFilter?: ReaderLearningFilter;
  } | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] = useState<PdfSelectionSnapshot | null>(null);
  const [annotationSyncing, setAnnotationSyncing] = useState(false);
  const [selectedHighlightKey, setSelectedHighlightKey] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([1, 2, 3]));
  const [pageRatios, setPageRatios] = useState<Record<number, number>>({});
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMarkdown, setExportMarkdown] = useState('');
  const [exportKind, setExportKind] = useState<PdfExportKind>('highlights');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [markMenuOpen, setMarkMenuOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationDraft, setTranslationDraft] = useState<TranslationDraft | null>(null);
  const [annotationListOpen, setAnnotationListOpen] = useState(false);
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState('');
  const [textSearchPages, setTextSearchPages] = useState<number[]>([]);
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [anchoredConversations, setAnchoredConversations] = useState<AnchoredConversation[]>([]);
  const [focusRects, setFocusRects] = useState<HighlightRect[]>([]);
  const [resolvingHighlightKey, setResolvingHighlightKey] = useState<string | null>(null);
  const [storedReadingPosition, setStoredReadingPosition] = useState<ReadingPosition | undefined>();
  const [knowledgePromotionCandidate, setKnowledgePromotionCandidate] = useState<KnowledgePromotionCandidate | null>(null);
  const [mobileShelfSaving, setMobileShelfSaving] = useState(false);
  const [pdfRendererRetry, setPdfRendererRetry] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageShellRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pageNumberRef = useRef(1);
  const textSearchInputRef = useRef<HTMLInputElement>(null);
  const pdfDocumentRef = useRef<{
    numPages: number;
    getPage: (pageNumber: number) => Promise<{
      getTextContent: () => Promise<{ items: unknown[] }>;
    }>;
  } | null>(null);
  const textCacheRef = useRef<Record<number, string>>({});
  const explicitRequestedPageRef = useRef<number | null>(null);
  const resumeRestoreKeyRef = useRef<string | null>(null);
  const readingSaveTimeoutRef = useRef<number | null>(null);
  const lastPublishedReadingPageRef = useRef<number | null>(null);
  const visualCaptureClickIgnoreRef = useRef(false);

  const fileUrl = useMemo(
    () => `/api/workspace/file?path=${encodeURIComponent(activePdfPath)}`,
    [activePdfPath],
  );
  // Electron's worker-side OffscreenCanvas path has produced blank pages for
  // otherwise valid PDFs with some embedded image/font combinations. Keep the
  // stable main-thread canvas path for the desktop reader; it is slower only
  // for the page currently being shown and preserves text selection.
  const pdfDocumentOptions = useMemo(() => ({
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    useWasm: false,
  }), []);
  const fitPageRatio = pageRatios[pageNumber] || 1.414;
  const fitPageZoom = Math.min(
    200,
    Math.max(50, Math.round(((containerHeight - 64) / fitPageRatio / Math.max(320, containerWidth)) * 100)),
  );
  const effectiveZoom = fitMode === 'width' ? 100 : fitMode === 'page' ? fitPageZoom : zoom;
  const pageWidth = Math.max(320, Math.floor((containerWidth * renderZoom) / 100));
  const renderPixelRatio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 1.25);
  const selectedHighlight = useMemo(
    () => highlights.find((highlight) => (highlight.annotationId || highlight.id) === selectedHighlightKey) ?? null,
    [highlights, selectedHighlightKey],
  );
  const exportFileName = `${(activePdf?.name || 'document').replace(/\.pdf$/i, '')}.${exportKind === 'evidence-brief' ? 'evidence-brief' : 'highlights'}.md`;

  const showRecordNotice = useCallback((
    message: string,
    recordTab: ReaderRecordTab,
    options?: { actionLabel?: string; learningFilter?: ReaderLearningFilter },
  ) => {
    setSelectionNotice({
      message,
      recordTab,
      recordActionLabel: options?.actionLabel,
      recordLearningFilter: options?.learningFilter,
    });
  }, []);

  const openReaderRecords = useCallback((recordTab: ReaderRecordTab, learningFilter?: ReaderLearningFilter) => {
    setRecordTabRequest({ tab: recordTab, learningFilter, id: crypto.randomUUID() });
    setAnnotationListOpen(true);
    setSelectionNotice(null);
  }, []);

  const rememberPage = useCallback((nextPage: number) => {
    const safePage = Math.max(1, numPages ? Math.min(numPages, nextPage) : nextPage);
    pageNumberRef.current = safePage;
    setPageNumber(safePage);
    setActivePdfPage(safePage);
    if (activePdfPath) {
      window.localStorage.setItem(`${LAST_PAGE_STORAGE_KEY}:${activePdfPath}`, String(safePage));
    }
  }, [activePdfPath, numPages, setActivePdfPage]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setRenderZoom(effectiveZoom), 180);
    return () => window.clearTimeout(timeout);
  }, [effectiveZoom]);

  useEffect(() => {
    const storedPage = Number(window.localStorage.getItem(`${LAST_PAGE_STORAGE_KEY}:${activePdfPath}`) || 1);
    const requestedPage = Number(new URLSearchParams(window.location.search).get('page') || 0);
    const explicitPage = Number.isFinite(requestedPage) && requestedPage > 0
      ? Math.floor(requestedPage)
      : null;
    const initialPage = explicitPage ?? (Number.isFinite(storedPage) && storedPage > 0 ? Math.floor(storedPage) : 1);
    explicitRequestedPageRef.current = explicitPage;
    resumeRestoreKeyRef.current = null;
    setVisiblePages(new Set([1, 2]));
    setPageRatios({});
    setNumPages(null);
    setFitMode('manual');
    setRenderZoom(125);
    setZoom(125);
    setPdfRendererRetry(0);
    setPageNumber(initialPage);
    pageNumberRef.current = initialPage;
    pageShellRefs.current = {};
    pdfDocumentRef.current = null;
    textCacheRef.current = {};
    setTextSearchPages([]);
    setTextSearchQuery('');
    setTextSearchOpen(false);
    setSelectionSnapshot(null);
    setVisualRegions([]);
    setVisualCaptureMode(false);
    setVisualRegionPointer(null);
    setVisualRegionPreview(null);
    setVisualRegionDraft(null);
    setSelectedVisualRegionId(null);
    setVisualRegionEditing(null);
    setAnchoredConversations([]);
    setFocusRects([]);
    setStoredReadingPosition(undefined);
    lastPublishedReadingPageRef.current = null;

    if (!activePdfPath) return;
    let cancelled = false;
    const loadReadingPosition = async () => {
      try {
        const res = await fetch(`/api/papers/metadata?path=${encodeURIComponent(activePdfPath)}`, { cache: 'no-store' });
        const metadata = await res.json();
        const readingPosition = normalizeReadingPosition(metadata?.readingPosition);
        if (!cancelled) {
          setStoredReadingPosition(readingPosition);
          if (readingPosition) setViewMode(readingPosition.viewMode);
        }
      } catch {
        // Legacy localStorage remains the fallback when portable metadata is unavailable.
      }
    };
    void loadReadingPosition();
    return () => { cancelled = true; };
  }, [activePdfPath]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  const handlePageChange = useCallback((nextPage: number) => {
    setSelectionNotice(null);
    setSelectionSnapshot(null);
    setVisualCaptureMode(false);
    setVisualRegionPointer(null);
    setVisualRegionPreview(null);

    if (viewMode === 'scroll') {
      const pageShell = pageShellRefs.current[nextPage];
      if (pageShell) {
        pageShell.scrollIntoView({
          block: 'start',
          behavior: 'smooth',
        });
      }
    }

    rememberPage(nextPage);
  }, [rememberPage, viewMode]);

  const persistReadingPosition = useCallback((page: number, pageOffsetRatio: number, mode: PdfViewMode) => {
    if (!activePdfPath) return;
    void fetch('/api/papers/metadata', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdfPath: activePdfPath,
        readingPosition: {
          page: Math.max(1, Math.floor(page)),
          pageOffsetRatio: Math.min(1, Math.max(0, pageOffsetRatio)),
          viewMode: mode,
          updatedAt: new Date().toISOString(),
        },
      }),
    }).then((res) => {
      if (!res.ok || lastPublishedReadingPageRef.current === page) return;
      lastPublishedReadingPageRef.current = page;
      notifyReaderSummaryChanged();
    }).catch(() => {
      // Resume persistence must never interrupt reading.
    });
  }, [activePdfPath]);

  const scheduleReadingPositionSave = useCallback((page: number, pageOffsetRatio: number, mode: PdfViewMode) => {
    if (readingSaveTimeoutRef.current !== null) window.clearTimeout(readingSaveTimeoutRef.current);
    readingSaveTimeoutRef.current = window.setTimeout(() => {
      readingSaveTimeoutRef.current = null;
      persistReadingPosition(page, pageOffsetRatio, mode);
    }, 900);
  }, [persistReadingPosition]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const resize = () => {
      setContainerWidth(Math.max(320, element.clientWidth - 48));
      setContainerHeight(Math.max(320, element.clientHeight));
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewMode !== 'scroll') return;
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      setSelectionSnapshot(null);
      if (visualCaptureMode) {
        setVisualCaptureMode(false);
        setVisualRegionPointer(null);
        setVisualRegionPreview(null);
      }
      const page = pageNumberRef.current;
      const pageShell = pageShellRefs.current[page];
      const containerRect = container.getBoundingClientRect();
      const pageRect = pageShell?.getBoundingClientRect();
      const pageOffsetRatio = pageRect && pageRect.height > 0
        ? Math.min(1, Math.max(0, (containerRect.top - pageRect.top) / pageRect.height))
        : 0;
      scheduleReadingPositionSave(page, pageOffsetRatio, 'scroll');
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [scheduleReadingPositionSave, viewMode, visualCaptureMode]);

  useEffect(() => {
    setSelectionSnapshot(null);
    setVisualCaptureMode(false);
    setVisualRegionPointer(null);
    setVisualRegionPreview(null);
  }, [effectiveZoom, viewMode]);

  useEffect(() => {
    if (!activePdfPath || viewMode !== 'paged') return;
    scheduleReadingPositionSave(pageNumber, 0, 'paged');
  }, [activePdfPath, pageNumber, scheduleReadingPositionSave, viewMode]);

  useEffect(() => () => {
    if (readingSaveTimeoutRef.current !== null) {
      window.clearTimeout(readingSaveTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (visualCaptureMode || visualRegionDraft || visualRegionEditing)) {
        event.preventDefault();
        setVisualCaptureMode(false);
        setVisualRegionPointer(null);
        setVisualRegionPreview(null);
        setVisualRegionDraft(null);
        setVisualRegionEditing(null);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setTextSearchOpen(true);
        window.setTimeout(() => textSearchInputRef.current?.focus(), 0);
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setFitMode('manual');
        setZoom((current) => Math.min(200, current + 10));
      } else if (event.key === '-') {
        event.preventDefault();
        setFitMode('manual');
        setZoom((current) => Math.max(50, current - 10));
      } else if (event.key === '0') {
        event.preventDefault();
        setFitMode('width');
      } else if (event.key === 'ArrowLeft' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        handlePageChange(Math.max(1, pageNumberRef.current - 1));
      } else if (event.key === 'ArrowRight' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        handlePageChange(numPages ? Math.min(numPages, pageNumberRef.current + 1) : pageNumberRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePageChange, numPages, visualCaptureMode, visualRegionDraft, visualRegionEditing]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setFitMode('manual');
      setZoom((current) => Math.min(200, Math.max(50, current - Math.sign(event.deltaY) * 5)));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (!selectionNotice) return;

    const timeout = window.setTimeout(() => {
      setSelectionNotice(null);
    }, 2200);

    return () => window.clearTimeout(timeout);
  }, [selectionNotice]);

  useEffect(() => {
    if (!activePdfPath) {
      setHighlights([]);
      setSelectedHighlightKey(null);
      setDraftNote('');
      setRecordTabRequest(null);
      return;
    }

    setRecordTabRequest(null);

    let cancelled = false;

    const loadPdfHighlights = async () => {
      setAnnotationSyncing(true);

      const legacyHighlights = getStoredHighlights(activePdfPath);

      try {
        const res = await fetch(`/api/workspace/annotations?path=${encodeURIComponent(activePdfPath)}`, {
          cache: 'no-store',
        });
        const data = await res.json();

        if (!res.ok || data?.error) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'PDF 주석을 불러오지 못했습니다.');
        }

        let nextHighlights = Array.isArray(data.highlights) ? mergeHighlights(data.highlights as Highlight[]) : [];

        if (legacyHighlights.length > 0) {
          try {
            const migrateRes = await fetch('/api/workspace/annotations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pdfPath: activePdfPath,
                highlights: legacyHighlights,
              }),
            });
            const migrateData = await migrateRes.json();

            if (!migrateRes.ok || migrateData?.error) {
              throw new Error(typeof migrateData?.error === 'string' ? migrateData.error : '기존 하이라이트를 이전하지 못했습니다.');
            }

            nextHighlights = Array.isArray(migrateData.highlights)
              ? mergeHighlights(migrateData.highlights as Highlight[])
              : nextHighlights;
            setStoredHighlights(activePdfPath, []);

            if (!cancelled && typeof migrateData.migrated === 'number' && migrateData.migrated > 0) {
              setSelectionNotice(`기존 하이라이트 ${migrateData.migrated}개를 PDF에 이전했습니다.`);
            }
          } catch (error) {
            nextHighlights = mergeHighlights([...nextHighlights, ...legacyHighlights]);

            if (!cancelled) {
              console.warn('Failed to migrate legacy PDF highlights.', error);
              setSelectionNotice(PDF_HIGHLIGHT_MIGRATION_DEFERRED);
            }
          }
        }

        if (!cancelled) {
          setHighlights(nextHighlights);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load PDF annotations.', error);
          const fallbackHighlights = legacyHighlights.length > 0 ? legacyHighlights : [];
          setHighlights(mergeHighlights(fallbackHighlights));
          setSelectionNotice(PDF_TEXT_ANALYSIS_UNAVAILABLE);
        }
      } finally {
        if (!cancelled) {
          setAnnotationSyncing(false);
        }
      }
    };

    void loadPdfHighlights();

    return () => {
      cancelled = true;
    };
  }, [activePdfPath]);

  useEffect(() => {
    if (!pendingReaderReviewRequest || pendingReaderReviewRequest.pdfPath !== activePdfPath) return;
    openReaderRecords('learning', 'needs-understanding');
    consumeReaderReviewRequest(pendingReaderReviewRequest.id);
  }, [
    activePdfPath,
    consumeReaderReviewRequest,
    openReaderRecords,
    pendingReaderReviewRequest,
  ]);

  useEffect(() => {
    if (!selectedHighlightKey) {
      setDraftNote('');
      setNoteDialogOpen(false);
      return;
    }

    if (!selectedHighlight) {
      setSelectedHighlightKey(null);
      setDraftNote('');
      setNoteDialogOpen(false);
      return;
    }

    setDraftNote(selectedHighlight.note ?? '');
  }, [selectedHighlight, selectedHighlightKey]);

  useEffect(() => {
    if (!activePdfPath) {
      setVisualRegions([]);
      return;
    }
    let cancelled = false;
    const loadVisualRegions = async () => {
      try {
        const response = await fetch(`/api/workspace/visual-regions?path=${encodeURIComponent(activePdfPath)}`, {
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok || payload?.error) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : '기록을 불러오지 못했습니다.');
        }
        if (!cancelled) setVisualRegions(Array.isArray(payload.regions) ? payload.regions as VisualRegion[] : []);
      } catch {
        if (!cancelled) {
          setVisualRegions([]);
          setSelectionNotice('그림·표 기록을 불러오지 못했습니다. PDF 읽기는 계속할 수 있습니다.');
        }
      }
    };
    void loadVisualRegions();
    return () => { cancelled = true; };
  }, [activePdfPath]);

  useEffect(() => {
    if (!activePdfPath || !activeSessionFolder) {
      setAnchoredConversations([]);
      return;
    }
    let cancelled = false;
    const loadAnchoredConversations = async () => {
      try {
        const params = new URLSearchParams({
          folderPath: activeSessionFolder,
          sessionKind: 'pdf',
          pdfPath: activePdfPath,
        });
        const res = await fetch(`/api/sessions?${params.toString()}`, { cache: 'no-store' });
        const sessions = await res.json();
        if (!res.ok || !Array.isArray(sessions) || cancelled) return;
        const anchors: AnchoredConversation[] = [];
        for (const session of sessions as Session[]) {
          const assistantReplies = new Set(session.messages
            .filter((message) => message.role === 'assistant' && typeof message.replyToMessageId === 'string')
            .map((message) => message.replyToMessageId));
          for (const message of session.messages) {
            const sourceContext = message.sourceContext;
            if (
              message.role !== 'user'
              || sourceContext?.scope !== 'selection'
              || !sourceContext.page
              || !Array.isArray(sourceContext.rects)
              || sourceContext.rects.length === 0
              || !assistantReplies.has(message.id)
            ) continue;
            anchors.push({ sourceContext, session, questionMessageId: message.id });
          }
        }
        if (!cancelled) setAnchoredConversations(anchors);
      } catch {
        if (!cancelled) setAnchoredConversations([]);
      }
    };
    void loadAnchoredConversations();
    return () => { cancelled = true; };
  }, [activePdfPath, activeSessionFolder, chatRevision]);

  useEffect(() => {
    if (!pendingPdfSourceNavigation || pendingPdfSourceNavigation.pdfPath !== activePdfPath) return;
    const request = pendingPdfSourceNavigation;
    setVisiblePages((current) => new Set([...current, request.page]));
    rememberPage(request.page);
    const scrollToSource = () => {
      const pageShell = pageShellRefs.current[request.page];
      pageShell?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFocusRects(request.rects ?? []);
      consumePdfSourceNavigation(request.id);
    };
    const animationFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToSource);
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activePdfPath, consumePdfSourceNavigation, pendingPdfSourceNavigation, rememberPage]);

  useEffect(() => {
    if (focusRects.length === 0) return;
    const timeout = window.setTimeout(() => setFocusRects([]), 2_000);
    return () => window.clearTimeout(timeout);
  }, [focusRects]);

  useEffect(() => {
    if (!selectedVisualRegionId) return;
    const timeout = window.setTimeout(() => setSelectedVisualRegionId(null), 2_000);
    return () => window.clearTimeout(timeout);
  }, [selectedVisualRegionId]);

  useEffect(() => {
    if (viewMode !== 'scroll' || !numPages) return;

    const root = containerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const targetPage = Number((entry.target as HTMLDivElement).dataset.pageNumber);
            if (Number.isNaN(targetPage)) continue;
            if (entry.isIntersecting) {
              next.add(targetPage);
              next.add(Math.max(1, targetPage - 1));
              if (numPages) next.add(Math.min(numPages, targetPage + 1));
            } else if (Math.abs(targetPage - pageNumberRef.current) > 2) {
              next.delete(targetPage);
            }
          }
          return next;
        });
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        const mostVisibleEntry = visibleEntries[0];
        if (!mostVisibleEntry) return;

        const nextPage = Number((mostVisibleEntry.target as HTMLDivElement).dataset.pageNumber);
        if (!Number.isNaN(nextPage)) {
          rememberPage(nextPage);
        }
      },
      {
        root,
        rootMargin: '600px 0px',
        threshold: [0, 0.25, 0.5, 0.75],
      },
    );

    Object.values(pageShellRefs.current).forEach((pageShell) => {
      if (pageShell) {
        observer.observe(pageShell);
      }
    });

    return () => observer.disconnect();
  }, [rememberPage, viewMode, numPages, pageWidth, activePdfPath]);

  const ensurePdfTextCache = useCallback(async () => {
    const pdf = pdfDocumentRef.current;
    if (!pdf || !numPages) return;

    setTextSearchLoading(true);
    const nextCache = { ...textCacheRef.current };
    try {
      for (let page = 1; page <= numPages; page += 1) {
        if (pdfDocumentRef.current !== pdf) return;
        if (typeof nextCache[page] === 'string') continue;
        const pageProxy = await pdf.getPage(page);
        const textContent = await pageProxy.getTextContent();
        nextCache[page] = textContent.items
          .map((item) => {
            const value = item as { str?: unknown };
            return typeof value.str === 'string' ? value.str : '';
          })
          .join(' ');
        textCacheRef.current = nextCache;
      }
    } finally {
      setTextSearchLoading(false);
    }
  }, [numPages]);

  useEffect(() => {
    const query = textSearchQuery.trim().toLocaleLowerCase('ko-KR');
    if (!textSearchOpen || !query) {
      setTextSearchPages([]);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      await ensurePdfTextCache();
      if (cancelled) return;
      setTextSearchPages(Object.entries(textCacheRef.current)
        .filter(([, text]) => text.toLocaleLowerCase('ko-KR').includes(query))
        .map(([page]) => Number(page))
        .sort((a, b) => a - b));
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [ensurePdfTextCache, numPages, textSearchOpen, textSearchQuery]);

  const handleDocumentLoadSuccess = (pdf: {
    numPages: number;
    getPage: (pageNumber: number) => Promise<{
      getTextContent: () => Promise<{ items: unknown[] }>;
    }>;
  }) => {
    pdfDocumentRef.current = pdf;
    const nextNumPages = pdf.numPages;
    setNumPages(nextNumPages);
    const storedPage = Number(window.localStorage.getItem(`${LAST_PAGE_STORAGE_KEY}:${activePdfPath}`) || pageNumberRef.current);
    const initialPage = explicitRequestedPageRef.current
      ?? storedReadingPosition?.page
      ?? (Number.isFinite(storedPage) && storedPage > 0
      ? Math.min(nextNumPages, Math.floor(storedPage))
      : 1);
    setVisiblePages((current) => new Set([
      ...current,
      Math.max(1, initialPage - 1),
      initialPage,
      Math.min(nextNumPages, initialPage + 1),
    ]));
    rememberPage(initialPage);
    if (viewMode === 'scroll') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          pageShellRefs.current[initialPage]?.scrollIntoView({ block: 'start', behavior: 'auto' });
        });
      });
    }
  };

  const handlePageRenderError = useCallback(() => {
    // A fresh Document instance clears a transient canvas/worker render task
    // without discarding the selected PDF, annotations, or reading position.
    if (pdfRendererRetry === 0) {
      setPdfRendererRetry(1);
      return;
    }

    setSelectionNotice('이 페이지를 다시 그리지 못했습니다. 다른 페이지를 열었다가 돌아오면 재시도합니다.');
  }, [pdfRendererRetry]);

  useEffect(() => {
    if (!activePdfPath || !storedReadingPosition || !numPages || explicitRequestedPageRef.current) return;
    const restoreKey = `${activePdfPath}:${storedReadingPosition.updatedAt}`;
    if (resumeRestoreKeyRef.current === restoreKey) return;
    resumeRestoreKeyRef.current = restoreKey;
    const targetPage = Math.max(1, Math.min(numPages, storedReadingPosition.page));
    setVisiblePages((current) => new Set([...current, targetPage]));
    rememberPage(targetPage);
    if (viewMode !== 'scroll') return;

    let attempts = 0;
    let animationFrame = 0;
    const restoreOffset = () => {
      const pageShell = pageShellRefs.current[targetPage];
      const container = containerRef.current;
      if (!pageShell || !container) {
        if (attempts < 3) {
          attempts += 1;
          animationFrame = window.requestAnimationFrame(restoreOffset);
        }
        return;
      }
      pageShell.scrollIntoView({ block: 'start', behavior: 'auto' });
      container.scrollTop += pageShell.clientHeight * storedReadingPosition.pageOffsetRatio;
    };
    animationFrame = window.requestAnimationFrame(restoreOffset);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activePdfPath, numPages, rememberPage, storedReadingPosition, viewMode]);

  const canGoPrev = pageNumber > 1;
  const canGoNext = numPages !== null && pageNumber < numPages;
  const highlightsByPage = useMemo(() => {
    return highlights.reduce<Record<number, Highlight[]>>((accumulator, highlight) => {
      accumulator[highlight.page] ??= [];
      accumulator[highlight.page].push(highlight);
      return accumulator;
    }, {});
  }, [highlights]);
  const anchorsByPage = useMemo(() => anchoredConversations.reduce<Record<number, AnchoredConversation[]>>((groups, anchor) => {
    const page = anchor.sourceContext.page;
    if (!page) return groups;
    groups[page] ??= [];
    groups[page].push(anchor);
    return groups;
  }, {}), [anchoredConversations]);
  const visualRegionsByPage = useMemo(() => visualRegions.reduce<Record<number, VisualRegion[]>>((groups, region) => {
    groups[region.page] ??= [];
    groups[region.page].push(region);
    return groups;
  }, {}), [visualRegions]);
  const getSelectionRects = (pageShell: HTMLDivElement | null): HighlightRect[] => {
    const selection = window.getSelection();

    if (!selection || !pageShell || selection.rangeCount === 0) {
      return [];
    }

    const pageRect = pageShell.getBoundingClientRect();
    const range = selection.getRangeAt(0);
    return normalizeHighlightRects(Array.from(range.getClientRects())
      .map((rect) => {
        const x = Math.max(0, rect.left - pageRect.left);
        const y = Math.max(0, rect.top - pageRect.top);
        const width = Math.min(pageRect.width - x, rect.width);
        const height = Math.min(pageRect.height - y, rect.height);

        if (width <= 1 || height <= 1) {
          return null;
        }

        return {
          x: x / pageRect.width,
          y: y / pageRect.height,
          width: width / pageRect.width,
          height: height / pageRect.height,
        };
      })
      .filter((rect): rect is HighlightRect => rect !== null));
  };

  const getSelectionSnapshot = (
    targetPage: number,
    pageShell: HTMLDivElement | null,
  ): PdfSelectionSnapshot | null => {
    const selection = window.getSelection();
    if (!selection || !pageShell || selection.rangeCount === 0) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const range = selection.getRangeAt(0);
    if (!pageShell.contains(range.startContainer) || !pageShell.contains(range.endContainer)) {
      setSelectionNotice('한 페이지 안에서 텍스트를 선택해 주세요.');
      return null;
    }
    const rects = getSelectionRects(pageShell);
    if (rects.length === 0) {
      setSelectionNotice('선택한 영역에서 텍스트 위치를 찾지 못했습니다.');
      return null;
    }
    const clientRects = Array.from(range.getClientRects());
    const selectionRect = clientRects.reduce<DOMRect | null>((combined, rect) => {
      if (!combined) return rect;
      const left = Math.min(combined.left, rect.left);
      const top = Math.min(combined.top, rect.top);
      const right = Math.max(combined.right, rect.right);
      const bottom = Math.max(combined.bottom, rect.bottom);
      return new DOMRect(left, top, right - left, bottom - top);
    }, null) ?? range.getBoundingClientRect();
    if (selectionRect.width <= 0 || selectionRect.height <= 0) return null;
    return {
      page: targetPage,
      text,
      rects,
      viewportRect: {
        left: selectionRect.left,
        top: selectionRect.top,
        right: selectionRect.right,
        bottom: selectionRect.bottom,
      },
    };
  };

  const getVisualRegionPoint = (
    event: ReactMouseEvent<HTMLDivElement>,
    pageShell: HTMLDivElement | null,
  ): { x: number; y: number } | null => {
    if (!pageShell) return null;
    const pageRect = pageShell.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return null;
    const x = (event.clientX - pageRect.left) / pageRect.width;
    const y = (event.clientY - pageRect.top) / pageRect.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };

  const getVisualRegionRect = (
    event: ReactMouseEvent<HTMLDivElement>,
    pageShell: HTMLDivElement | null,
  ): HighlightRect | null => {
    if (!visualRegionPointer || !pageShell) return null;
    const point = getVisualRegionPoint(event, pageShell);
    if (!point) return null;
    const x = Math.min(visualRegionPointer.x, point.x);
    const y = Math.min(visualRegionPointer.y, point.y);
    return normalizeVisualRegionRect({
      x,
      y,
      width: Math.abs(point.x - visualRegionPointer.x),
      height: Math.abs(point.y - visualRegionPointer.y),
    });
  };

  const handleVisualRegionMouseDown = (
    event: ReactMouseEvent<HTMLDivElement>,
    targetPage: number,
    pageShell: HTMLDivElement | null,
  ) => {
    if (!visualCaptureMode) return;
    const point = getVisualRegionPoint(event, pageShell);
    if (!point) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    visualCaptureClickIgnoreRef.current = true;
    setSelectionSnapshot(null);
    setVisualRegionPointer({ page: targetPage, ...point });
    setVisualRegionPreview(null);
  };

  const handleVisualRegionMouseMove = (
    event: ReactMouseEvent<HTMLDivElement>,
    targetPage: number,
    pageShell: HTMLDivElement | null,
  ) => {
    if (!visualCaptureMode || visualRegionPointer?.page !== targetPage) return;
    const rect = getVisualRegionRect(event, pageShell);
    setVisualRegionPreview(rect ? { page: targetPage, rect } : null);
  };

  const handleVisualRegionMouseUp = (
    event: ReactMouseEvent<HTMLDivElement>,
    targetPage: number,
    pageShell: HTMLDivElement | null,
  ): boolean => {
    if (!visualCaptureMode) return false;
    event.preventDefault();
    const rect = visualRegionPointer?.page === targetPage
      ? getVisualRegionRect(event, pageShell)
      : null;
    setVisualRegionPointer(null);
    setVisualRegionPreview(null);
    setVisualCaptureMode(false);
    if (!rect) {
      setSelectionNotice('그림·표 영역을 조금 더 크게 드래그해 주세요.');
      return true;
    }
    setVisualRegionDraft({
      page: targetPage,
      rect,
    });
    return true;
  };

  const clearSelectionAction = useCallback(() => {
    setSelectionSnapshot(null);
  }, []);

  const createStudyHighlight = async (
    snapshot: PdfSelectionSnapshot,
    studyKind: HighlightStudyKind,
    workKind?: HighlightWorkKind,
    options?: { openNote?: boolean },
  ) => {
    if (!activePdfPath || annotationSyncing) return;
    const now = new Date().toISOString();
    const studyFields = applyStudyKind({
      type: legacyTypeForStudyKind(studyKind),
      studyKind,
      resolvedAt: undefined,
    }, studyKind);
    const nextHighlight: Highlight = {
      id: crypto.randomUUID(),
      documentId: activePdf?.documentId,
      pdfPath: activePdfPath,
      page: snapshot.page,
      type: studyFields.type,
      studyKind,
      text: snapshot.text,
      rects: snapshot.rects,
      position: snapshot.rects[0],
      note: '',
      ...(workKind ? { workKind } : {}),
      createdAt: now,
      updatedAt: now,
    };
    window.getSelection()?.removeAllRanges();
    setSelectionSnapshot(null);
    setHighlights((current) => mergeHighlights([...current, nextHighlight]));
    if (options?.openNote) {
      setSelectedHighlightKey(nextHighlight.id);
      setDraftNote('');
      setNoteDialogOpen(true);
    }
    const savedLabel = workKind ? `${getWorkKindLabel(workKind)} 업무 근거` : getStudyKindLabel(studyKind);
    setSelectionNotice(`${savedLabel} 표시를 저장하는 중...`);

    try {
      setAnnotationSyncing(true);
      const res = await fetch('/api/workspace/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPath: activePdfPath, highlights: [nextHighlight] }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '하이라이트를 저장하지 못했습니다.');
      }
      setHighlights(Array.isArray(data.highlights)
        ? mergeHighlights(data.highlights as Highlight[])
        : mergeHighlights([...highlights, nextHighlight]));
      notifyReaderSummaryChanged();
      const isUnresolvedStudy = studyKind === 'unclear' || studyKind === 'question';
      showRecordNotice(
        data.warning
          ? `${savedLabel} 표시를 PageDock에 저장했습니다. PDF 원본 반영은 보류되었습니다.`
          : isUnresolvedStudy && !workKind
            ? '이해 필요를 남겼습니다. 나중에 다시 볼 수 있어요.'
            : `${savedLabel} 표시를 저장했습니다.`,
        workKind ? 'work' : 'learning',
        isUnresolvedStudy && !workKind
          ? { actionLabel: '다시 볼 것 보기', learningFilter: 'needs-understanding' }
          : undefined,
      );
    } catch (error) {
      console.warn('Failed to save PDF highlight.', error);
      setStoredHighlights(activePdfPath, mergeHighlights([...getStoredHighlights(activePdfPath), nextHighlight]));
      setSelectionNotice(PDF_HIGHLIGHT_SAVE_DEFERRED);
    } finally {
      setAnnotationSyncing(false);
    }
  };

  const handleHighlightSelection = async (targetPage: number, pageShell: HTMLDivElement | null) => {
    if (!highlightMode || eraseMode || !activePdfPath || annotationSyncing) return;
    const snapshot = getSelectionSnapshot(targetPage, pageShell);
    if (!snapshot) return;
    await createStudyHighlight(snapshot, highlightMode === 'unknown' ? 'unclear' : 'important');
  };

  const selectionContainsHighlightRect = (
    selectionRect: HighlightRect,
    highlightRect: HighlightRect,
  ): boolean => {
    const centerX = highlightRect.x + highlightRect.width / 2;
    const centerY = highlightRect.y + highlightRect.height / 2;

    return (
      centerX >= selectionRect.x &&
      centerX <= selectionRect.x + selectionRect.width &&
      centerY >= selectionRect.y &&
      centerY <= selectionRect.y + selectionRect.height
    );
  };

  const handleEraseSelection = async (targetPage: number, pageShell: HTMLDivElement | null) => {
    if (!eraseMode || annotationSyncing || !activePdfPath) return;

    const selection = window.getSelection();
    const rects = getSelectionRects(pageShell);
    const pageHighlights = highlightsByPage[targetPage] ?? [];

    if (!selection || rects.length === 0) {
      setSelectionNotice('지울 하이라이트가 걸치도록 텍스트를 선택해 주세요.');
      return;
    }

    const removableIds = new Set(
      pageHighlights
        .filter((highlight) => {
          const highlightRects = getHighlightRects(highlight);
          return highlightRects.some((highlightRect) => (
            rects.some((selectionRect) => selectionContainsHighlightRect(selectionRect, highlightRect))
          ));
        })
        .map((highlight) => highlight.id),
    );

    if (removableIds.size === 0) {
      selection.removeAllRanges();
      setSelectionNotice('선택 영역 안에 삭제할 하이라이트가 없습니다.');
      return;
    }

    selection.removeAllRanges();

    const removableHighlights = highlights.filter((highlight) => removableIds.has(highlight.id));
    const nativeAnnotationIds = removableHighlights
      .map((highlight) => highlight.annotationId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const localHighlightIds = removableHighlights
      .filter((highlight) => !highlight.annotationId)
      .map((highlight) => highlight.id);

    try {
      setAnnotationSyncing(true);

      const res = await fetch('/api/workspace/annotations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath: activePdfPath,
          annotationIds: nativeAnnotationIds,
          highlightIds: localHighlightIds,
        }),
      });
      const data = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '하이라이트를 지우지 못했습니다.');
      }

      const nextHighlights = Array.isArray(data.highlights)
        ? mergeHighlights(data.highlights as Highlight[])
        : highlights.filter((highlight) => !removableIds.has(highlight.id));
      setHighlights(nextHighlights);
      notifyReaderSummaryChanged();
      if (selectedHighlightKey && removableHighlights.some((highlight) => (
        (highlight.annotationId || highlight.id) === selectedHighlightKey
      ))) {
        setSelectedHighlightKey(null);
      }

      setSelectionNotice(`하이라이트 ${removableIds.size}개를 지웠습니다.`);
    } catch (error) {
      console.warn('Failed to delete PDF highlight.', error);
      setSelectionNotice(PDF_HIGHLIGHT_DELETE_FAILED);
    } finally {
      setAnnotationSyncing(false);
    }
  };

  const handleHighlightClick = (highlight: Highlight) => {
    if (highlightMode || eraseMode) {
      return;
    }

    setSelectedHighlightKey(highlight.annotationId || highlight.id);
    setNoteDialogOpen(true);
    setSelectionNotice(null);
  };

  const handleSaveNote = async () => {
    if (!selectedHighlight || !activePdfPath) {
      return;
    }

    setNoteSaving(true);

    try {
      const res = await fetch('/api/workspace/annotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath: activePdfPath,
          updates: [{
            annotationId: selectedHighlight.annotationId || selectedHighlight.id,
            note: draftNote,
          }],
        }),
      });
      const data = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '메모를 저장하지 못했습니다.');
      }

      setHighlights(Array.isArray(data.highlights) ? mergeHighlights(data.highlights as Highlight[]) : []);
      notifyReaderSummaryChanged();
      setSelectionNotice(draftNote.trim() ? '하이라이트 메모를 저장했습니다.' : '메모를 비웠습니다.');
    } catch (error) {
      console.warn('Failed to save PDF highlight note.', error);
      setSelectionNotice(PDF_NOTE_SAVE_FAILED);
    } finally {
      setNoteSaving(false);
    }
  };

  const handleOpenExportPreview = async (kind: PdfExportKind) => {
    setExportKind(kind);
    setExportMenuOpen(false);
    setExportDialogOpen(true);
    setExportLoading(true);

    try {
      const format = kind === 'evidence-brief' ? 'evidence-brief' : 'markdown';
      const res = await fetch(`/api/workspace/export?path=${encodeURIComponent(activePdfPath)}&format=${format}`, { cache: 'no-store' });
      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || 'Markdown 미리보기를 준비하지 못했습니다.');
      }

      setExportMarkdown(text);
    } catch (error) {
      console.warn('Failed to prepare PDF annotation markdown preview.', error);
      setExportMarkdown(`오류: ${PDF_EXPORT_PREVIEW_FAILED}`);
    } finally {
      setExportLoading(false);
    }
  };

  const handleConfirmExport = async () => {
    const blob = new Blob([exportMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportDialogOpen(false);
  };

  const handlePageClick = (
    event: ReactMouseEvent<HTMLDivElement>,
    pageHighlights: Highlight[],
    pageVisualRegions: VisualRegion[],
  ) => {
    if (visualCaptureClickIgnoreRef.current) {
      visualCaptureClickIgnoreRef.current = false;
      return;
    }
    if (highlightMode || eraseMode || visualCaptureMode) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      return;
    }

    const pageRect = event.currentTarget.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return;
    const point = {
      x: (event.clientX - pageRect.left) / pageRect.width,
      y: (event.clientY - pageRect.top) / pageRect.height,
    };
    const matchedVisualRegion = [...pageVisualRegions].reverse().find((region) => (
      point.x >= region.rect.x
      && point.x <= region.rect.x + region.rect.width
      && point.y >= region.rect.y
      && point.y <= region.rect.y + region.rect.height
    ));
    if (matchedVisualRegion) {
      setSelectedVisualRegionId(matchedVisualRegion.id);
      setFocusRects([matchedVisualRegion.rect]);
      setAnnotationListOpen(true);
      setSelectionNotice(null);
      return;
    }
    const matchedHighlight = [...pageHighlights].reverse().find((highlight) => (
      getHighlightRects(highlight).some((rect) => (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
      ))
    ));

    if (matchedHighlight) {
      handleHighlightClick(matchedHighlight);
    }
  };

  const handleAddToMobileShelf = async () => {
    if (!activePdfPath || mobileShelfSaving) return;
    setMobileShelfSaving(true);
    try {
      const response = await fetch('/api/mobile-bridge/shelf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPath: activePdfPath }),
      });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || '모바일 보관함에 넣지 못했습니다.');
      setSelectionNotice(data.added
        ? '모바일 보관함에 넣었습니다. 설정에서 연결 폴더와 모바일 읽기 사본을 확인할 수 있습니다.'
        : '이 문서는 이미 모바일 보관함에 있습니다.');
    } catch (error) {
      setSelectionNotice(error instanceof Error ? error.message : '모바일 보관함에 넣지 못했습니다.');
    } finally {
      setMobileShelfSaving(false);
    }
  };

  const closeVisualRegionDialog = () => {
    if (visualRegionSaving) return;
    setVisualRegionDraft(null);
    setVisualRegionEditing(null);
  };

  const handleSaveVisualRegion = async (kind: VisualRegionKind, memo: string) => {
    if (!activePdfPath || visualRegionSaving) return;
    const editing = visualRegionEditing;
    const draft = visualRegionDraft;
    if (!editing && !draft) return;
    setVisualRegionSaving(true);
    try {
      const response = await fetch('/api/workspace/visual-regions', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing
          ? { pdfPath: activePdfPath, regionId: editing.id, kind, memo }
          : { pdfPath: activePdfPath, page: draft!.page, rect: draft!.rect, kind, memo }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error || !payload?.region) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : '그림·표 기록을 저장하지 못했습니다.');
      }
      const next = payload.region as VisualRegion;
      setVisualRegions((current) => editing
        ? current.map((region) => region.id === next.id ? next : region)
        : [...current, next]);
      setSelectedVisualRegionId(next.id);
      setFocusRects([next.rect]);
      setAnnotationListOpen(true);
      setVisualRegionDraft(null);
      setVisualRegionEditing(null);
      showRecordNotice(editing ? '그림·표 기록을 변경했습니다.' : '그림·표 영역을 기록했습니다.', 'visual');
    } catch {
      setSelectionNotice('그림·표 기록을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setVisualRegionSaving(false);
    }
  };

  const navigateToVisualRegion = (region: VisualRegion) => {
    setVisiblePages((current) => new Set([...current, region.page]));
    rememberPage(region.page);
    setSelectedVisualRegionId(region.id);
    setFocusRects([region.rect]);
    window.requestAnimationFrame(() => {
      pageShellRefs.current[region.page]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const handleDeleteVisualRegion = async (region: VisualRegion) => {
    if (!activePdfPath || visualRegionSaving) return;
    if (!window.confirm(`p.${region.page}의 그림·표 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    setVisualRegionSaving(true);
    try {
      const response = await fetch('/api/workspace/visual-regions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPath: activePdfPath, regionId: region.id }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : '그림·표 기록을 삭제하지 못했습니다.');
      }
      if (Array.isArray(payload.regions)) {
        setVisualRegions(payload.regions as VisualRegion[]);
      } else {
        setVisualRegions((current) => current.filter((item) => item.id !== region.id));
      }
      if (selectedVisualRegionId === region.id) setSelectedVisualRegionId(null);
      if (visualRegionEditing?.id === region.id) setVisualRegionEditing(null);
      setSelectionNotice('그림·표 기록을 삭제했습니다.');
    } catch {
      setSelectionNotice('그림·표 기록을 삭제하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setVisualRegionSaving(false);
    }
  };

  const toggleVisualCaptureMode = () => {
    const next = !visualCaptureMode;
    setVisualCaptureMode(next);
    if (next) {
      setHighlightMode(null);
      setEraseMode(false);
      setSelectionSnapshot(null);
      setVisualRegionDraft(null);
      setVisualRegionEditing(null);
      setSelectionNotice('PDF 위에서 그림·표·수식 영역을 드래그해 주세요. Esc를 누르면 취소합니다.');
    } else {
      setVisualRegionPointer(null);
      setVisualRegionPreview(null);
    }
  };

  const patchHighlight = async (
    targetHighlight: Highlight,
    update: {
      type?: Highlight['type'];
      studyKind?: HighlightStudyKind;
      resolvedAt?: string | null;
      workKind?: HighlightWorkKind | null;
      workDoneAt?: string | null;
    },
    successMessage: string,
    recordTab: ReaderRecordTab = 'learning',
  ) => {
    if (!activePdfPath) return;
    setNoteSaving(true);
    try {
      const res = await fetch('/api/workspace/annotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath: activePdfPath,
          updates: [{ annotationId: targetHighlight.annotationId || targetHighlight.id, ...update }],
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '하이라이트 상태를 저장하지 못했습니다.');
      }
      setHighlights(Array.isArray(data.highlights) ? mergeHighlights(data.highlights as Highlight[]) : []);
      notifyReaderSummaryChanged();
      showRecordNotice(successMessage, recordTab);
    } catch (error) {
      console.warn('Failed to save PDF highlight state.', error);
      setSelectionNotice('하이라이트 상태를 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setNoteSaving(false);
    }
  };

  const patchSelectedHighlight = async (
    update: {
      type?: Highlight['type'];
      studyKind?: HighlightStudyKind;
      resolvedAt?: string | null;
      workKind?: HighlightWorkKind | null;
      workDoneAt?: string | null;
    },
    successMessage: string,
    recordTab: ReaderRecordTab = 'learning',
  ) => {
    if (!selectedHighlight) return;
    await patchHighlight(selectedHighlight, update, successMessage, recordTab);
  };

  const handleStudyKindChange = (studyKind: HighlightStudyKind) => {
    if (!selectedHighlight) return;
    const next = applyStudyKind(selectedHighlight, studyKind);
    void patchSelectedHighlight({
      type: next.type === selectedHighlight.type ? undefined : next.type,
      studyKind,
      resolvedAt: next.resolvedAt ?? null,
    }, `${getStudyKindLabel(studyKind)} 표시로 바꿨습니다.`);
  };

  const handleResolvedToggle = () => {
    if (!selectedHighlight || !isUnresolvedHighlight({ ...selectedHighlight, resolvedAt: undefined })) return;
    void handleResolvedToggleForHighlight(selectedHighlight);
  };

  const handleResolvedToggleForHighlight = async (highlight: Highlight) => {
    if (!isUnresolvedHighlight({ ...highlight, resolvedAt: undefined })) return;
    const key = highlight.annotationId || highlight.id;
    const resolved = Boolean(highlight.resolvedAt);
    setResolvingHighlightKey(key);
    try {
      await patchHighlight(
        highlight,
      { resolvedAt: resolved ? null : new Date().toISOString() },
      resolved ? '다시 볼 것으로 되돌렸습니다.' : '이해 완료로 표시했습니다.',
      );
    } finally {
      setResolvingHighlightKey(null);
    }
  };

  const handleWorkKindChange = (workKind: HighlightWorkKind | undefined) => {
    if (!selectedHighlight) return;
    const next = applyWorkKind(selectedHighlight, workKind);
    void patchSelectedHighlight({
      workKind: workKind ?? null,
      workDoneAt: next.workDoneAt ?? null,
    }, workKind ? `${getWorkKindLabel(workKind)} 업무 근거로 표시했습니다.` : '업무 표시를 해제했습니다.', workKind ? 'work' : 'learning');
  };

  const handleWorkDoneToggle = () => {
    if (!selectedHighlight || !isWorkActionKind(selectedHighlight.workKind)) return;
    const done = isWorkDone(selectedHighlight);
    void patchSelectedHighlight(
      { workDoneAt: done ? null : new Date().toISOString() },
      done ? '업무를 다시 열었습니다.' : '업무 완료로 표시했습니다.',
      'work',
    );
  };

  const handleSelectionAsk = () => {
    if (!selectionSnapshot || !activePdfPath) return;
    if (selectionSnapshot.text.length > MAX_SELECTION_CONTEXT_CHARS) {
      setSelectionNotice('선택 영역이 너무 깁니다. 더 작은 범위를 선택해 주세요.');
      setSelectionSnapshot(null);
      return;
    }
    const sourceContext: ChatSourceContext = {
      id: crypto.randomUUID(),
      scope: 'selection',
      documentId: activePdf?.documentId,
      page: selectionSnapshot.page,
      text: selectionSnapshot.text,
      rects: selectionSnapshot.rects,
    };
    queueChatRequest({
      id: crypto.randomUUID(),
      prompt: '선택한 내용을 현재 PDF의 문맥에 맞춰 설명해줘. 핵심 의미부터 설명하고, 원문에 명시되지 않은 추론은 추론이라고 구분해줘.',
      displayContent: '선택 영역 설명',
      sourceContext,
      autoSend: true,
    });
    window.getSelection()?.removeAllRanges();
    setSelectionSnapshot(null);
  };

  const openSideChatWithSource = (sourceContext: ChatSourceContext) => {
    if (window.pageDockDesktop?.sideChat) {
      void window.pageDockDesktop.sideChat.open({ sourceContext, pdfPath: activePdfPath });
      setSelectionNotice('선택 원문을 사이드채팅 초안으로 전달했습니다. 직접 전송해 주세요.');
      return;
    }
    const handoff = encodeURIComponent(JSON.stringify({ sourceContext }));
    void window.open(`/side-chat?handoff=${handoff}`, '_blank', 'popup,width=1260,height=860');
  };

  const handleAskFromHighlight = () => {
    if (!selectedHighlight || !activePdfPath) return;
    if (selectedHighlight.text.length > MAX_SELECTION_CONTEXT_CHARS) {
      setSelectionNotice('선택 영역이 너무 깁니다. 더 작은 범위를 선택해 주세요.');
      return;
    }

    queueChatRequest({
      id: crypto.randomUUID(),
      prompt: '선택한 내용을 현재 PDF의 문맥에 맞춰 설명해줘. 핵심 의미부터 설명하고, 원문에 명시되지 않은 추론은 추론이라고 구분해줘.',
      displayContent: '하이라이트 설명',
      sourceContext: {
        id: crypto.randomUUID(),
        scope: 'selection',
        documentId: selectedHighlight.documentId || activePdf?.documentId,
        page: selectedHighlight.page,
        text: selectedHighlight.text,
        rects: getHighlightRects(selectedHighlight),
        highlightId: selectedHighlight.annotationId || selectedHighlight.id,
      },
      autoSend: true,
    });
    setNoteDialogOpen(false);
  };

  const handlePromoteHighlightToKnowledge = () => {
    if (!selectedHighlight) return;
    const highlightId = selectedHighlight.annotationId || selectedHighlight.id;
    setKnowledgePromotionCandidate({
      text: selectedHighlight.text,
      sourceName: `${activePdf?.name || 'PDF'} · p.${selectedHighlight.page}`,
      defaultKind: 'literature_claim',
      sourceAnchors: [{
        id: `knowledge-highlight:${highlightId}`,
        scope: 'selection',
        documentId: selectedHighlight.documentId || activePdf?.documentId,
        page: selectedHighlight.page,
        text: selectedHighlight.text,
        rects: getHighlightRects(selectedHighlight),
        highlightId,
      }],
      initialMemo: draftNote.trim() || selectedHighlight.note || '',
    });
  };

  const queueSelectionStudyCard = (kind: StudyCardKind) => {
    if (!selectionSnapshot || !activePdfPath) return;
    if (selectionSnapshot.text.length > MAX_SELECTION_CONTEXT_CHARS) {
      setSelectionNotice('선택 영역이 너무 깁니다. 더 작은 범위를 선택해 주세요.');
      setSelectionSnapshot(null);
      return;
    }
    queueStudyCardRequest({
      id: crypto.randomUUID(),
      pdfPath: activePdfPath,
      sourceContext: {
        id: crypto.randomUUID(),
        scope: 'selection',
        documentId: activePdf?.documentId,
        page: selectionSnapshot.page,
        text: selectionSnapshot.text,
        rects: selectionSnapshot.rects,
      },
      origin: 'selection',
      kind,
    });
    window.getSelection()?.removeAllRanges();
    setSelectionSnapshot(null);
  };

  const handleSelectionStudyCard = () => queueSelectionStudyCard('basic');
  const handleSelectionClozeCard = () => queueSelectionStudyCard('cloze');

  const handlePageMouseUp = (
    event: ReactMouseEvent<HTMLDivElement>,
    targetPage: number,
    pageShell: HTMLDivElement | null,
  ) => {
    if (handleVisualRegionMouseUp(event, targetPage, pageShell)) return;
    if (eraseMode) {
      void handleEraseSelection(targetPage, pageShell);
      return;
    }
    if (highlightMode) {
      void handleHighlightSelection(targetPage, pageShell);
      return;
    }
    const snapshot = getSelectionSnapshot(targetPage, pageShell);
    setSelectionSnapshot(snapshot);
  };

  const selectionActionPosition = useMemo(() => {
    if (!selectionSnapshot || typeof window === 'undefined') return null;
    // Keep the action bar next to the text that caused it. Aligning its trailing
    // edge with the selection end makes a short selection feel just as local as a
    // long one, while the flip prevents it from disappearing below the viewport.
    const actionWidth = 350;
    const actionHeight = 36;
    const gutter = 8;
    const desiredLeft = selectionSnapshot.viewportRect.right - actionWidth;
    const left = Math.min(
      Math.max(gutter, desiredLeft),
      window.innerWidth - actionWidth - gutter,
    );
    const below = selectionSnapshot.viewportRect.bottom + 4;
    const above = selectionSnapshot.viewportRect.top - actionHeight - 4;
    const top = below <= window.innerHeight - gutter
      ? below
      : Math.max(gutter, above);
    return { left, top };
  }, [selectionSnapshot]);

  const handleTranslate = async (kind: 'selection' | 'full') => {
    const sourceText = kind === 'selection' ? window.getSelection()?.toString().trim() || '' : '';
    if (kind === 'selection' && !sourceText) {
      setSelectionNotice('먼저 번역할 문장이나 단락을 선택해 주세요.');
      return;
    }
    setTranslationOpen(true);
    setTranslationLoading(true);
    setTranslationDraft(null);
    try {
      const res = await fetch('/api/papers/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath: activePdfPath,
          kind,
          sourceText,
          model: normalizeModelPreference(window.localStorage.getItem('annot-last-model')),
          reasoningEffort: readStoredReasoningEffort(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '번역하지 못했습니다.');
      }
      setTranslationDraft(data as TranslationDraft);
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      console.warn('Failed to translate PDF content.', error);
      setTranslationDraft({
        kind,
        title: '번역 오류',
        sourceMarkdown: sourceText,
        translatedMarkdown: '',
        bilingualMarkdown: `오류: ${PDF_TRANSLATION_FAILED}`,
      });
    } finally {
      setTranslationLoading(false);
    }
  };

  const handleSaveTranslation = async () => {
    if (!translationDraft || translationDraft.title === '번역 오류') return;
    setTranslationLoading(true);
    try {
      const res = await fetch('/api/papers/translations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPath: activePdfPath, translation: translationDraft }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '번역을 저장하지 못했습니다.');
      }
      setTranslationOpen(false);
      setSelectionNotice('번역을 논문 정보에 저장했습니다.');
    } catch (error) {
      console.warn('Failed to save PDF translation.', error);
      setSelectionNotice(PDF_TRANSLATION_SAVE_FAILED);
    } finally {
      setTranslationLoading(false);
    }
  };

  const renderPageShell = (targetPage: number) => {
    const pageHighlights = highlightsByPage[targetPage] ?? [];
    const pageVisualRegions = visualRegionsByPage[targetPage] ?? [];
    const pageAnchors = anchorsByPage[targetPage] ?? [];
    const shouldRenderPage = viewMode === 'paged' || visiblePages.has(targetPage);
    const pageHeight = Math.round(pageWidth * (pageRatios[targetPage] || 1.414));

    return (
      <div
        key={targetPage}
        ref={(node) => {
          pageShellRefs.current[targetPage] = node;
        }}
        data-page-number={targetPage}
        className={`pdf-page-shell overflow-hidden rounded-xl shadow-ambient ${visualCaptureMode ? 'cursor-crosshair select-none' : ''}`}
        style={{ minHeight: `${pageHeight}px`, width: `${pageWidth}px` }}
        onClick={(event) => handlePageClick(event, pageHighlights, pageVisualRegions)}
        onMouseDown={(event) => handleVisualRegionMouseDown(event, targetPage, pageShellRefs.current[targetPage])}
        onMouseMove={(event) => handleVisualRegionMouseMove(event, targetPage, pageShellRefs.current[targetPage])}
        onMouseUp={(event) => handlePageMouseUp(event, targetPage, pageShellRefs.current[targetPage])}
      >
        {shouldRenderPage ? (
          <Page
            pageNumber={targetPage}
            width={pageWidth}
            devicePixelRatio={renderPixelRatio}
            renderAnnotationLayer={false}
            renderTextLayer
            onRenderError={handlePageRenderError}
            onLoadSuccess={(page) => {
              const [x1, y1, x2, y2] = page.view;
              const width = Math.abs(x2 - x1);
              const height = Math.abs(y2 - y1);
              if (width > 0 && height > 0) {
                const ratio = height / width;
                setPageRatios((current) => current[targetPage] === ratio
                  ? current
                  : { ...current, [targetPage]: ratio });
              }
            }}
            loading={
              <div className="bg-surface-container-lowest rounded-xl w-full flex items-center justify-center gap-2 text-sm text-on-surface-variant" style={{ minHeight: `${pageHeight}px` }}>
                <Loader2 size={16} className="animate-spin" />
                페이지 렌더링 중...
              </div>
            }
            error={
              <div className="bg-surface-container-lowest rounded-xl w-full flex items-center justify-center px-6 text-sm text-error text-center" style={{ minHeight: `${pageHeight}px` }}>
                이 페이지를 표시하지 못했습니다.
              </div>
            }
          />
        ) : (
          <div className="bg-surface-container-lowest" style={{ minHeight: `${pageHeight}px` }} />
        )}
        {shouldRenderPage && <div className="pdf-highlight-layer" aria-hidden="true">
          {pageHighlights.map((highlight) => {
            const rects = getHighlightRects(highlight);
            const highlightKey = highlight.annotationId || highlight.id;
            const isSelected = highlightKey === selectedHighlightKey;

            return rects.map((rect, index) => (
              <span
                key={`${highlight.id}-${index}`}
                className={`pdf-highlight-box pdf-highlight-box--${highlight.type} ${
                  !highlightMode && !eraseMode ? 'pdf-highlight-box--interactive' : ''
                } ${isSelected ? 'pdf-highlight-box--selected' : ''}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
                title={highlight.note?.trim() ? `${highlight.text}\n\n메모: ${highlight.note}` : highlight.text}
              />
            ));
          })}
          {pageVisualRegions.map((region) => (
            <span
              key={region.id}
              className={`pdf-visual-region-box ${region.id === selectedVisualRegionId ? 'pdf-visual-region-box--selected' : ''}`}
              style={{
                left: `${region.rect.x * 100}%`,
                top: `${region.rect.y * 100}%`,
                width: `${region.rect.width * 100}%`,
                height: `${region.rect.height * 100}%`,
              }}
              title={region.memo || undefined}
            />
          ))}
          {visualRegionPreview?.page === targetPage && (
            <span
              className="pdf-visual-region-box pdf-visual-region-box--preview"
              style={{
                left: `${visualRegionPreview.rect.x * 100}%`,
                top: `${visualRegionPreview.rect.y * 100}%`,
                width: `${visualRegionPreview.rect.width * 100}%`,
                height: `${visualRegionPreview.rect.height * 100}%`,
              }}
            />
          )}
        </div>}
        {shouldRenderPage && targetPage === pageNumber && focusRects.map((rect, index) => (
          <span
            key={`source-focus-${index}`}
            className="pdf-source-focus"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          />
        ))}
        {shouldRenderPage && pageAnchors.map((anchor, index) => {
          const firstRect = anchor.sourceContext.rects?.[0];
          if (!firstRect) return null;
          return (
            <AiAnchorMarker
              key={`${anchor.session.id}:${anchor.questionMessageId}`}
              topPercent={firstRect.y * 100 + index * 3}
              count={1}
              onClick={() => {
                openSession(anchor.session);
                focusChatMessage(anchor.questionMessageId);
              }}
            />
          );
        })}
      </div>
    );
  };

  if (!activePdf) return null;

  const useOverlayRecordPanel = annotationListOpen && !chatOpen;
  const readerRecordPanel = annotationListOpen && !chatOpen ? (
    <ReaderRecordPanel
      key={selectedVisualRegionId
        ? `visual:${selectedVisualRegionId}`
        : `records:${recordTabRequest?.id ?? 'default'}`}
      highlights={highlights}
      visualRegions={visualRegions}
      selectedHighlightKey={selectedHighlightKey}
      selectedVisualRegionId={selectedVisualRegionId}
      requestedTab={recordTabRequest?.tab}
      requestedLearningFilter={recordTabRequest?.learningFilter}
      onClose={() => setAnnotationListOpen(false)}
      onNavigate={(highlight) => {
        handlePageChange(highlight.page);
        setSelectedHighlightKey(highlight.annotationId || highlight.id);
        setFocusRects(getHighlightRects(highlight));
      }}
      onEdit={(highlight) => {
        handlePageChange(highlight.page);
        setSelectedHighlightKey(highlight.annotationId || highlight.id);
        setNoteDialogOpen(true);
      }}
      onToggleResolved={(highlight) => void handleResolvedToggleForHighlight(highlight)}
      resolvingHighlightKey={resolvingHighlightKey}
      onNavigateVisualRegion={navigateToVisualRegion}
      onEditVisualRegion={(region) => {
        navigateToVisualRegion(region);
        setVisualRegionEditing(region);
      }}
      onDeleteVisualRegion={(region) => void handleDeleteVisualRegion(region)}
    />
  ) : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* PDF Toolbar */}
      <div className="relative z-40 flex min-h-12 shrink-0 items-center justify-between gap-3 bg-surface px-4 py-1">
        {/* Left: file name */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={closePdf}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors shrink-0"
            aria-label="PDF 닫기"
          >
            <X size={13} strokeWidth={2} />
          </button>
          <span className="text-xs font-medium text-on-surface truncate" title={activePdf.name}>
            {activePdf.name}
          </span>
          <span className="shrink-0 rounded-md bg-surface-container px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-on-surface-variant" aria-label={`현재 페이지 ${pageNumber}`}>
            p.{pageNumber}
          </span>
        </div>

        {/* Center: controls */}
        <div className="glass flex max-w-full min-w-0 items-center gap-1 rounded-lg px-2 py-1">
          <button
            onClick={() => handlePageChange(Math.max(1, pageNumber - 1))}
            disabled={!canGoPrev}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-40"
            aria-label="이전 페이지"
          >
            <ChevronLeft size={13} strokeWidth={2} />
          </button>
          <button
            onClick={() => handlePageChange(numPages ? Math.min(numPages, pageNumber + 1) : pageNumber)}
            disabled={!canGoNext}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-40"
            aria-label="다음 페이지"
          >
            <ChevronRight size={13} strokeWidth={2} />
          </button>

          <label className="ml-1 flex items-center gap-1 text-[11px] text-on-surface-variant font-medium tabular-nums">
            <input
              type="number"
              min={1}
              max={numPages || undefined}
              value={pageNumber}
              onChange={(event) => handlePageChange(Number(event.target.value) || 1)}
              className="h-8 w-12 rounded-lg border border-outline-variant/30 bg-surface px-1 text-center text-[11px] text-on-surface outline-none focus:border-outline"
              aria-label="페이지 번호"
            />
            <span>/{numPages || '-'}</span>
          </label>

          <button
            type="button"
            onClick={() => {
              setTextSearchOpen((current) => !current);
              window.setTimeout(() => textSearchInputRef.current?.focus(), 0);
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              textSearchOpen
                ? 'bg-on-surface text-surface-container-lowest'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="PDF 본문 검색 (Ctrl+F)"
            aria-label="PDF 본문 검색 (Ctrl+F)"
          >
            <SearchIcon size={14} strokeWidth={2} />
          </button>

          <div className="w-px h-4 bg-outline-variant/30 mx-0.5" />

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setViewMenuOpen((current) => !current);
                setMarkMenuOpen(false);
                setExportMenuOpen(false);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-on-surface-variant hover:bg-surface-container-high"
              aria-label="PDF 보기 방식과 맞춤 설정"
              aria-expanded={viewMenuOpen}
              aria-haspopup="menu"
              aria-controls="pdf-view-menu"
            >
              보기
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {viewMenuOpen && (
              <div id="pdf-view-menu" role="menu" className="absolute left-0 top-full z-30 mt-1 w-36 rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-1 shadow-ambient" aria-label="PDF 보기 방식">
                <button type="button" role="menuitemradio" aria-checked={viewMode === 'paged'} onClick={() => { setViewMode('paged'); setViewMenuOpen(false); }} className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container">한 페이지</button>
                <button type="button" role="menuitemradio" aria-checked={viewMode === 'scroll'} onClick={() => { setViewMode('scroll'); setViewMenuOpen(false); window.requestAnimationFrame(() => pageShellRefs.current[pageNumber]?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }} className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container">세로 스크롤</button>
                <div className="my-1 border-t border-outline-variant/20" />
                <button type="button" role="menuitemradio" aria-checked={fitMode === 'width'} onClick={() => { setFitMode('width'); setViewMenuOpen(false); }} className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container">폭에 맞춤</button>
                <button type="button" role="menuitemradio" aria-checked={fitMode === 'page'} onClick={() => { setFitMode('page'); setViewMenuOpen(false); }} className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container">페이지에 맞춤</button>
              </div>
            )}
          </div>

          <span className="text-[11px] text-on-surface-variant font-medium tabular-nums w-10 text-center">
            {effectiveZoom}%
          </span>
          <button
            onClick={() => { setFitMode('manual'); setZoom((current) => Math.max(50, current - 10)); }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="축소 (-)"
            aria-label="PDF 축소"
          >
            <Minus size={13} strokeWidth={2} />
          </button>
          <button
            onClick={() => { setFitMode('manual'); setZoom((current) => Math.min(200, current + 10)); }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="확대 (+)"
            aria-label="PDF 확대"
          >
            <Plus size={13} strokeWidth={2} />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMarkMenuOpen((current) => !current);
                setViewMenuOpen(false);
                setExportMenuOpen(false);
              }}
              className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors ${highlightMode || eraseMode ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
              aria-label="하이라이트 표시 도구"
              aria-expanded={markMenuOpen}
              aria-haspopup="menu"
              aria-controls="pdf-mark-menu"
            >
              표시
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {markMenuOpen && (
              <div id="pdf-mark-menu" role="menu" className="absolute left-0 top-full z-30 mt-1 w-36 rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-1 shadow-ambient" aria-label="하이라이트 표시 도구">
                <button type="button" role="menuitemradio" aria-checked={highlightMode === 'important'} onClick={() => { setVisualCaptureMode(false); setEraseMode(false); setHighlightMode((current) => current === 'important' ? null : 'important'); setMarkMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-tertiary-fixed hover:bg-surface-container"><Highlighter size={13} aria-hidden="true" />중요 표시</button>
                <button type="button" role="menuitemradio" aria-checked={highlightMode === 'unknown'} onClick={() => { setVisualCaptureMode(false); setEraseMode(false); setHighlightMode((current) => current === 'unknown' ? null : 'unknown'); setMarkMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-study-unclear hover:bg-study-unclear-container"><Pen size={13} aria-hidden="true" />이해 필요</button>
                <div className="my-1 border-t border-outline-variant/20" />
                <button type="button" role="menuitemcheckbox" aria-checked={eraseMode} onClick={() => { setVisualCaptureMode(false); setHighlightMode(null); setEraseMode((current) => !current); setMarkMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container"><Eraser size={13} aria-hidden="true" />표시 지우기</button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={toggleVisualCaptureMode}
            className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors ${
              visualCaptureMode
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="그림·표·수식 영역 기록"
            aria-label="그림·표·수식 영역 기록 모드"
            aria-pressed={visualCaptureMode}
          >
            <ScanLine size={14} strokeWidth={2} aria-hidden="true" />
            영역 기록
          </button>
          <div className="mx-0.5 h-4 w-px bg-outline-variant/30" aria-hidden="true" />
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setExportMenuOpen((current) => !current);
                setViewMenuOpen(false);
                setMarkMenuOpen(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="기록, 내보내기와 문서 도구 더보기"
              aria-label="기록, 내보내기와 문서 도구 더보기"
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              aria-controls="pdf-document-menu"
            >
              <MoreHorizontal size={16} strokeWidth={2} />
            </button>
            {exportMenuOpen && (
              <div id="pdf-document-menu" role="menu" className="absolute right-0 top-full z-30 mt-1 w-52 rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-1 shadow-ambient" aria-label="문서 도구">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { openReaderRecords('learning'); setExportMenuOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-on-surface hover:bg-surface-container"
                >
                  <List size={13} aria-hidden="true" />기록 보기
                </button>
                <div className="my-1 border-t border-outline-variant/20" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { openStudyReview(); setExportMenuOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container"
                >
                  <BookOpenText size={13} aria-hidden="true" />이 PDF의 복습 카드
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={mobileShelfSaving}
                  onClick={() => { void handleAddToMobileShelf(); setExportMenuOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container disabled:opacity-50"
                >
                  {mobileShelfSaving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Smartphone size={13} aria-hidden="true" />}
                  모바일 보관함에 추가
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { void handleTranslate('full'); setExportMenuOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container"
                >
                  <Languages size={13} aria-hidden="true" />전체 논문 번역
                </button>
                <a
                  href={fileUrl}
                  download={activePdf.name}
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container"
                >
                  <Download size={13} aria-hidden="true" />PDF 내려받기
                </a>
                <div className="my-1 border-t border-outline-variant/20" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleOpenExportPreview('highlights')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-on-surface hover:bg-surface-container"
                >
                  <FileDown size={13} aria-hidden="true" />하이라이트 Markdown
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleOpenExportPreview('evidence-brief')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-on-surface hover:bg-surface-container"
                >
                  <FileDown size={13} aria-hidden="true" />업무 Evidence Brief
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: chat toggle */}
        <div>
          {activeSessionFolder && (
            <button
              onClick={toggleChat}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                chatOpen
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
              aria-label="AI 대화창 열기 또는 닫기"
            >
              <MessageSquare size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {textSearchOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-outline-variant/15 bg-surface-container-low px-4 py-2">
          <SearchIcon size={14} className="shrink-0 text-outline" />
          <input
            ref={textSearchInputRef}
            value={textSearchQuery}
            onChange={(event) => setTextSearchQuery(event.target.value)}
            placeholder="이 PDF 안에서 검색"
            className="h-8 min-w-[180px] flex-1 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2.5 text-xs text-on-surface outline-none focus:border-outline"
            aria-label="PDF 본문 검색어"
          />
          <span className="text-[10px] text-on-surface-variant">
            {textSearchLoading ? '본문을 읽는 중...' : textSearchQuery.trim() ? `${textSearchPages.length}개 페이지` : 'Enter 없이 자동 검색'}
          </span>
          <button
            type="button"
            onClick={() => {
              setTextSearchOpen(false);
              setTextSearchQuery('');
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high"
            aria-label="PDF 본문 검색 닫기"
          >
            <X size={14} />
          </button>
          {textSearchQuery.trim() && !textSearchLoading && textSearchPages.length > 0 && (
            <div className="flex w-full flex-wrap gap-1.5 pl-5">
              {textSearchPages.map((page) => (
                <button
                  type="button"
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className="rounded-md bg-surface-container-high px-2 py-1 text-[10px] text-on-surface-variant hover:bg-surface-container-highest"
                >
                  {page}쪽
                </button>
              ))}
            </div>
          )}
          {textSearchQuery.trim() && !textSearchLoading && textSearchPages.length === 0 && (
            <span className="w-full pl-5 text-[10px] text-on-surface-variant">이 PDF에는 일치하는 문장이 없습니다. 다른 표현으로 다시 찾아보세요.</span>
          )}
        </div>
      )}

      <div className="relative z-0 flex min-h-0 min-w-0 flex-1">
        {readerRecordPanel && useOverlayRecordPanel && (
          <div className="absolute inset-y-0 right-0 z-30 shadow-ambient">
            {readerRecordPanel}
          </div>
        )}

        <div ref={containerRef} className="min-w-0 flex-1 overflow-auto bg-surface-dim">
        <div className="mx-auto min-w-full w-max px-6 py-5">
          <div className="mb-3 flex min-h-7 items-center gap-2 px-2 text-[12px] text-on-surface-variant" aria-live="polite">
              {eraseMode ? (
                <span>지우개 모드입니다. 지울 하이라이트에 걸치도록 텍스트를 선택하세요.</span>
              ) : visualCaptureMode ? (
                <span>영역 기록 모드 · 그림·표·수식 위를 드래그하세요 · Esc 취소</span>
              ) : highlightMode ? (
                <span>
                  {highlightMode === 'important' ? '중요' : '이해 필요'} 하이라이트 모드입니다. 저장할 텍스트를 선택하세요.
                </span>
              ) : selectedHighlight ? (
                <span>원문 기록을 선택했습니다. 학습·업무 후속·메모를 독립적으로 정리할 수 있습니다.</span>
              ) : (
                <span>문장을 드래그하면 중요 표시, 메모 또는 AI 질문을 바로 남길 수 있습니다.</span>
              )}
              {annotationSyncing && (
                <span className="text-outline">주석 저장 중...</span>
              )}
              {selectionNotice && (
                typeof selectionNotice === 'string' ? (
                  <span className="text-outline">{selectionNotice}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-outline">
                    <span>{selectionNotice.message}</span>
                    {selectionNotice.recordTab && (
                      <button
                        type="button"
                        onClick={() => openReaderRecords(selectionNotice.recordTab!, selectionNotice.recordLearningFilter)}
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary-container/50"
                      >
                        {selectionNotice.recordActionLabel ?? '기록에서 보기'}
                      </button>
                    )}
                  </span>
                )
              )}
            </div>

          <div className="flex justify-center">
            <Document
              key={`${activePdfPath}:${pdfRendererRetry}`}
              file={fileUrl}
              options={pdfDocumentOptions}
              loading={
                <div className="bg-surface-container-lowest rounded-xl shadow-ambient min-h-[560px] w-full max-w-[900px] flex items-center justify-center gap-2 text-sm text-on-surface-variant">
                  <Loader2 size={16} className="animate-spin" />
                  PDF 불러오는 중...
                </div>
              }
              error={
                <div className="bg-surface-container-lowest rounded-xl shadow-ambient min-h-[560px] w-full max-w-[900px] flex items-center justify-center px-6 text-sm text-error text-center">
                  PDF를 불러오지 못했습니다.
                </div>
              }
              onLoadSuccess={handleDocumentLoadSuccess}
            >
              {viewMode === 'scroll' ? (
                <div className="flex flex-col items-center gap-6">
                  {Array.from({ length: numPages ?? 0 }, (_, index) => renderPageShell(index + 1))}
                </div>
              ) : (
                renderPageShell(pageNumber)
              )}
            </Document>
          </div>
        </div>
        </div>
        {readerRecordPanel && !useOverlayRecordPanel && readerRecordPanel}
      </div>

      {exportKind === 'evidence-brief' ? (
        <EvidenceBriefDialog
          open={exportDialogOpen}
          documentName={activePdf.name.replace(/\.pdf$/i, '')}
          fileName={exportFileName}
          highlights={highlights}
          markdownReady={Boolean(exportMarkdown.trim())}
          loading={exportLoading}
          onCancel={() => setExportDialogOpen(false)}
          onNavigate={(highlight) => {
            setExportDialogOpen(false);
            handlePageChange(highlight.page);
            setSelectedHighlightKey(highlight.annotationId || highlight.id);
            setFocusRects(getHighlightRects(highlight));
          }}
          onDownload={handleConfirmExport}
        />
      ) : (
        <MarkdownPreviewDialog
          open={exportDialogOpen}
          title="하이라이트 Markdown 미리보기"
          description="내려받기 전에 생성된 Markdown을 확인하세요."
          fileName={exportFileName}
          markdown={exportMarkdown}
          loading={exportLoading}
          confirmLabel="Markdown 내려받기"
          onCancel={() => setExportDialogOpen(false)}
          onConfirm={handleConfirmExport}
        />
      )}
      <MarkdownPreviewDialog
        open={translationOpen}
        title={translationDraft?.title || '논문 번역'}
        description="번역을 확인한 뒤 저장하면 이 논문의 번역 목록에서 다시 열거나 삭제할 수 있습니다."
        fileName={`${activePdf.name.replace(/\.pdf$/i, '')}-번역.md`}
        markdown={translationDraft?.bilingualMarkdown || ''}
        loading={translationLoading}
        confirmLabel="번역 저장"
        onCancel={() => {
          if (!translationLoading) setTranslationOpen(false);
        }}
        onConfirm={handleSaveTranslation}
      />

      {selectionSnapshot && selectionActionPosition && (
        <SelectionActionBar
          left={selectionActionPosition.left}
          top={selectionActionPosition.top}
          onExplain={handleSelectionAsk}
          onDeepSeek={() => {
            if (!selectionSnapshot || !activePdfPath) return;
            if (selectionSnapshot.text.length > MAX_SELECTION_CONTEXT_CHARS) {
              setSelectionNotice('선택 영역이 너무 깁니다. 더 작은 범위를 선택해 주세요.');
              return;
            }
            queueChatRequest({
              id: crypto.randomUUID(),
              prompt: '이 선택 원문에서 이해하기 어려운 점을 질문해줘.',
              sourceContext: {
                id: crypto.randomUUID(),
                scope: 'selection',
                documentId: activePdf?.documentId,
                page: selectionSnapshot.page,
                text: selectionSnapshot.text,
                rects: selectionSnapshot.rects,
              },
              autoSend: false,
              deepSeekDirect: true,
            });
            window.getSelection()?.removeAllRanges();
            setSelectionSnapshot(null);
          }}
          onSideChat={() => {
            if (!selectionSnapshot || !activePdfPath) return;
            if (selectionSnapshot.text.length > MAX_SELECTION_CONTEXT_CHARS) {
              setSelectionNotice('선택 영역이 너무 깁니다. 더 작은 범위를 선택해 주세요.');
              return;
            }
            openSideChatWithSource({
              id: crypto.randomUUID(),
              scope: 'selection',
              documentId: activePdf?.documentId,
              page: selectionSnapshot.page,
              text: selectionSnapshot.text,
              rects: selectionSnapshot.rects,
            });
            window.getSelection()?.removeAllRanges();
            setSelectionSnapshot(null);
          }}
          onStudyCard={handleSelectionStudyCard}
          onClozeCard={handleSelectionClozeCard}
          onImportant={() => void createStudyHighlight(selectionSnapshot, 'important')}
          onUnclear={() => void createStudyHighlight(selectionSnapshot, 'unclear')}
          onConcept={() => void createStudyHighlight(selectionSnapshot, 'concept')}
          onMemorize={() => void createStudyHighlight(selectionSnapshot, 'memorize')}
          onQuestion={() => void createStudyHighlight(selectionSnapshot, 'question')}
          onNote={() => void createStudyHighlight(selectionSnapshot, 'important', undefined, { openNote: true })}
          onWorkKind={(workKind) => void createStudyHighlight(selectionSnapshot, 'important', workKind)}
          onTranslate={() => {
            void handleTranslate('selection');
            clearSelectionAction();
          }}
          onDismiss={clearSelectionAction}
        />
      )}

      {selectedHighlight && noteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
          <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-ambient">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-on-surface">하이라이트 기록</div>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                  {getStudyKindLabel(inferStudyKind(selectedHighlight))} · {selectedHighlight.page}페이지
                </p>
              </div>
              <button
                onClick={() => setNoteDialogOpen(false)}
                className="shrink-0 rounded-lg p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <section className="rounded-xl bg-surface-container px-3 py-3" aria-labelledby="highlight-study-record-title">
              <div id="highlight-study-record-title" className="text-[11px] font-semibold text-on-surface">학습 기록</div>
              <p className="mt-0.5 text-[10px] text-on-surface-variant">이 문장을 왜 표시했는지 남깁니다.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-[11px] font-medium text-on-surface-variant" htmlFor="highlight-study-kind">표시</label>
                <select
                  id="highlight-study-kind"
                  value={inferStudyKind(selectedHighlight)}
                  onChange={(event) => handleStudyKindChange(event.target.value as HighlightStudyKind)}
                  disabled={noteSaving || annotationSyncing}
                  className="h-8 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2 text-xs text-on-surface outline-none focus:border-outline disabled:opacity-60"
                >
                  <option value="important">중요</option>
                  <option value="concept">개념/정의</option>
                  <option value="memorize">외울 것</option>
                  <option value="question">질문</option>
                  <option value="unclear">이해 필요</option>
                </select>
                {(inferStudyKind(selectedHighlight) === 'unclear' || inferStudyKind(selectedHighlight) === 'question') && (
                  <>
                    <span className="ml-1 text-[10px] font-medium text-on-surface-variant">이해 상태</span>
                    <span className="text-[10px] font-semibold text-on-surface-variant">{selectedHighlight.resolvedAt ? '✓ 이해 완료' : '다시 볼 것'}</span>
                    <button
                      type="button"
                      onClick={handleResolvedToggle}
                      disabled={noteSaving || annotationSyncing}
                      className="rounded-lg border border-outline-variant/30 px-2.5 py-1.5 text-[11px] font-semibold text-on-surface disabled:opacity-50"
                    >
                      {selectedHighlight.resolvedAt ? '다시 볼 것으로' : '이해 완료'}
                    </button>
                  </>
                )}
              </div>
            </section>

            <section className="mt-3 rounded-xl border border-outline-variant/20 px-3 py-3" aria-labelledby="highlight-work-record-title">
              <div id="highlight-work-record-title" className="text-[11px] font-semibold text-on-surface">업무 후속</div>
              <p className="mt-0.5 text-[10px] text-on-surface-variant">이 근거로 업무에서 확인하거나 논의할 일이 있을 때만 추가합니다.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-[11px] font-medium text-on-surface-variant" htmlFor="highlight-work-kind">분류</label>
                <select
                  id="highlight-work-kind"
                  value={selectedHighlight.workKind ?? ''}
                  onChange={(event) => handleWorkKindChange((event.target.value || undefined) as HighlightWorkKind | undefined)}
                  disabled={noteSaving || annotationSyncing}
                  className="h-8 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-2 text-xs text-on-surface outline-none focus:border-outline disabled:opacity-60"
                >
                  <option value="">업무 후속 없음</option>
                  <option value="finding">Finding</option>
                  <option value="verify">Verify</option>
                  <option value="discuss">Discuss</option>
                  <option value="try">Try</option>
                </select>
                {isWorkActionKind(selectedHighlight.workKind) && (
                  <>
                    <span className="ml-1 text-[10px] font-semibold text-on-surface-variant">{isWorkDone(selectedHighlight) ? '완료' : '열림'}</span>
                    <button
                      type="button"
                      onClick={handleWorkDoneToggle}
                      disabled={noteSaving || annotationSyncing}
                      className="rounded-lg border border-outline-variant/30 px-2.5 py-1.5 text-[11px] font-semibold text-on-surface disabled:opacity-50"
                    >
                      {isWorkDone(selectedHighlight) ? '업무 다시 열기' : '업무 완료로 표시'}
                    </button>
                  </>
                )}
              </div>
            </section>

            <div className="mt-4 rounded-xl bg-surface-container px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-widest text-on-surface-variant">
                하이라이트 원문
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-on-surface">
                {selectedHighlight.text}
              </p>
            </div>

            <section className="mt-4" aria-labelledby="highlight-note-title">
              <label id="highlight-note-title" className="mb-1 block text-[11px] font-semibold text-on-surface">
                메모
              </label>
              <p className="mb-2 text-[10px] text-on-surface-variant">학습과 업무 후속이 공유하는 원문 근거 메모입니다.</p>
              <textarea
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                disabled={noteSaving}
                placeholder={getWorkNotePlaceholder(selectedHighlight.workKind)}
                className="min-h-32 w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-outline disabled:cursor-not-allowed disabled:opacity-60"
              />
            </section>

            </div>

            <div className="mt-4 flex shrink-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-on-surface-variant">
                  {selectedHighlight.annotationId
                    ? '메모는 PDF 주석과 PageDock 기록에 함께 저장됩니다.'
                    : 'PDF 원본에 아직 반영되지 않아 PageDock 기록에 저장합니다.'}
                </p>
                <button
                  type="button"
                  onClick={handleAskFromHighlight}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 px-2.5 py-1.5 text-[11px] font-semibold text-on-surface hover:bg-surface-container-high"
                >
                  <MessageSquare size={12} aria-hidden="true" />
                  AI에게 묻기
                </button>
                <button
                  type="button"
                  onClick={handlePromoteHighlightToKnowledge}
                  className="mt-2 ml-2 inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 px-2.5 py-1.5 text-[11px] font-semibold text-on-surface hover:bg-surface-container-high"
                >
                  <BookOpenText size={12} aria-hidden="true" />
                  지식 후보로 보내기
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNoteDialogOpen(false)}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  닫기
                </button>
                <button
                  onClick={() => void handleSaveNote()}
                  disabled={
                    noteSaving ||
                    annotationSyncing ||
                    draftNote === (selectedHighlight.note ?? '')
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-on-surface px-3 py-2 text-xs font-semibold text-surface-container-lowest transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {noteSaving ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Save size={12} strokeWidth={2} />
                  )}
                  {noteSaving ? '저장 중...' : '메모 저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <VisualRegionDialog
        key={visualRegionEditing?.id ?? (visualRegionDraft ? `${visualRegionDraft.page}:${visualRegionDraft.rect.x}:${visualRegionDraft.rect.y}:${visualRegionDraft.rect.width}:${visualRegionDraft.rect.height}` : 'closed')}
        draft={visualRegionDraft}
        region={visualRegionEditing}
        saving={visualRegionSaving}
        onClose={closeVisualRegionDialog}
        onSave={(kind, memo) => void handleSaveVisualRegion(kind, memo)}
      />
      <KnowledgePromotionDialog
        candidate={knowledgePromotionCandidate}
        onClose={() => setKnowledgePromotionCandidate(null)}
        onCaptured={() => setSelectionNotice('지식 후보를 수집함에 보냈습니다. Knowledge에서 검토하세요.')}
      />
    </div>
  );
}
