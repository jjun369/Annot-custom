'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useWorkspace } from '@/lib/workspace-store';
import { Highlight } from '@/types';
import { getHighlightRects, mergeHighlights, normalizeHighlightRects, type HighlightRect } from '@/lib/highlight-utils';
import { normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { readStoredReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import { MarkdownPreviewDialog } from '@/components/common/MarkdownPreviewDialog';
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
  Search as SearchIcon,
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const HIGHLIGHTS_STORAGE_KEY = 'annot-pdf-highlights';
const LAST_PAGE_STORAGE_KEY = 'annot-last-page';

type HighlightMode = Highlight['type'] | null;
type PdfViewMode = 'paged' | 'scroll';
type TranslationDraft = {
  kind: 'selection' | 'full';
  title: string;
  sourceMarkdown: string;
  translatedMarkdown: string;
  bilingualMarkdown: string;
  model?: string;
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
  const { activePdf, closePdf, activeSessionFolder, chatOpen, toggleChat } = useWorkspace();
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
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
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
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationDraft, setTranslationDraft] = useState<TranslationDraft | null>(null);
  const [annotationListOpen, setAnnotationListOpen] = useState(false);
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState('');
  const [textSearchPages, setTextSearchPages] = useState<number[]>([]);
  const [textSearchLoading, setTextSearchLoading] = useState(false);
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

  const fileUrl = useMemo(
    () => `/api/workspace/file?path=${encodeURIComponent(activePdfPath)}`,
    [activePdfPath],
  );
  const exportUrl = useMemo(
    () => `/api/workspace/export?path=${encodeURIComponent(activePdfPath)}&format=markdown`,
    [activePdfPath],
  );
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
  const exportFileName = `${(activePdf?.name || 'document').replace(/\.pdf$/i, '')}.highlights.md`;

  const rememberPage = useCallback((nextPage: number) => {
    const safePage = Math.max(1, numPages ? Math.min(numPages, nextPage) : nextPage);
    pageNumberRef.current = safePage;
    setPageNumber(safePage);
    if (activePdfPath) {
      window.localStorage.setItem(`${LAST_PAGE_STORAGE_KEY}:${activePdfPath}`, String(safePage));
    }
  }, [activePdfPath, numPages]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setRenderZoom(effectiveZoom), 180);
    return () => window.clearTimeout(timeout);
  }, [effectiveZoom]);

  useEffect(() => {
    const storedPage = Number(window.localStorage.getItem(`${LAST_PAGE_STORAGE_KEY}:${activePdfPath}`) || 1);
    const initialPage = Number.isFinite(storedPage) && storedPage > 0 ? Math.floor(storedPage) : 1;
    setVisiblePages(new Set([1, 2]));
    setPageRatios({});
    setNumPages(null);
    setFitMode('manual');
    setRenderZoom(125);
    setZoom(125);
    setPageNumber(initialPage);
    pageNumberRef.current = initialPage;
    pageShellRefs.current = {};
    pdfDocumentRef.current = null;
    textCacheRef.current = {};
    setTextSearchPages([]);
    setTextSearchQuery('');
    setTextSearchOpen(false);
  }, [activePdfPath]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  const handlePageChange = useCallback((nextPage: number) => {
    setSelectionNotice(null);

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
    const handleKeyDown = (event: KeyboardEvent) => {
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
  }, [handlePageChange, numPages]);

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
      return;
    }

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
              const message = error instanceof Error
                ? error.message
                : '기존 하이라이트를 아직 이전하지 못했습니다.';
              setSelectionNotice(message);
            }
          }
        }

        if (!cancelled) {
          setHighlights(nextHighlights);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'PDF 주석을 불러오지 못했습니다.';
          const fallbackHighlights = legacyHighlights.length > 0 ? legacyHighlights : [];
          setHighlights(mergeHighlights(fallbackHighlights));
          setSelectionNotice(message);
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
    const initialPage = Number.isFinite(storedPage) && storedPage > 0
      ? Math.min(nextNumPages, Math.floor(storedPage))
      : 1;
    rememberPage(initialPage);
  };

  const canGoPrev = pageNumber > 1;
  const canGoNext = numPages !== null && pageNumber < numPages;
  const highlightsByPage = useMemo(() => {
    return highlights.reduce<Record<number, Highlight[]>>((accumulator, highlight) => {
      accumulator[highlight.page] ??= [];
      accumulator[highlight.page].push(highlight);
      return accumulator;
    }, {});
  }, [highlights]);
  const sortedHighlights = useMemo(() => [...highlights].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return (a.rects?.[0]?.y ?? a.position.y) - (b.rects?.[0]?.y ?? b.position.y);
  }), [highlights]);
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

  const handleHighlightSelection = async (targetPage: number, pageShell: HTMLDivElement | null) => {
    if (!highlightMode || eraseMode || !activePdfPath || annotationSyncing) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? '';
    const rects = getSelectionRects(pageShell);

    if (!selection || !selectedText || rects.length === 0) {
      setSelectionNotice('선택한 영역에서 텍스트를 찾지 못했습니다.');
      return;
    }

    if (rects.length === 0) {
      setSelectionNotice('선택 영역을 하이라이트로 변환하지 못했습니다.');
      return;
    }

    const nextHighlight: Highlight = {
      id: crypto.randomUUID(),
      pdfPath: activePdfPath,
      page: targetPage,
      type: highlightMode,
      text: selectedText,
      rects,
      position: rects[0],
      note: '',
    };
    selection.removeAllRanges();

    // The API stores the highlight in the portable .annot sidecar as well as
    // attempting to embed it in the PDF. Keep localStorage only as a last
    // resort for a temporary network failure.
    setHighlights((current) => mergeHighlights([...current, nextHighlight]));
    setSelectionNotice('하이라이트를 표시했습니다. 저장하는 중...');

    try {
      setAnnotationSyncing(true);

      const res = await fetch('/api/workspace/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath: activePdfPath,
          highlights: [nextHighlight],
        }),
      });
      const data = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '하이라이트를 저장하지 못했습니다.');
      }

      const nextHighlights = Array.isArray(data.highlights)
        ? mergeHighlights(data.highlights as Highlight[])
        : mergeHighlights([...highlights, nextHighlight]);
      setHighlights(nextHighlights);
      setSelectedHighlightKey(null);
      setSelectionNotice(data.warning
        ? `${highlightMode === 'important' ? '중요' : '확인 필요'} 하이라이트를 PageDock에 저장했습니다. PDF 원본 반영은 보류되었습니다.`
        : `${highlightMode === 'important' ? '중요' : '확인 필요'} 하이라이트를 저장했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '하이라이트를 저장하지 못했습니다.';
      setStoredHighlights(activePdfPath, mergeHighlights([...getStoredHighlights(activePdfPath), nextHighlight]));
      setSelectionNotice(`임시 보관했습니다. 다시 열 때 저장을 재시도합니다. ${message}`);
    } finally {
      setAnnotationSyncing(false);
    }
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
      if (selectedHighlightKey && removableHighlights.some((highlight) => (
        (highlight.annotationId || highlight.id) === selectedHighlightKey
      ))) {
        setSelectedHighlightKey(null);
      }

      setSelectionNotice(`하이라이트 ${removableIds.size}개를 지웠습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '하이라이트를 지우지 못했습니다.';
      setSelectionNotice(message);
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
      setSelectionNotice(draftNote.trim() ? '하이라이트 메모를 저장했습니다.' : '메모를 비웠습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '메모를 저장하지 못했습니다.';
      setSelectionNotice(message);
    } finally {
      setNoteSaving(false);
    }
  };

  const handleOpenExportPreview = async () => {
    setExportDialogOpen(true);
    setExportLoading(true);

    try {
      const res = await fetch(exportUrl, { cache: 'no-store' });
      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || 'Markdown 미리보기를 준비하지 못했습니다.');
      }

      setExportMarkdown(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Markdown 미리보기를 준비하지 못했습니다.';
      setExportMarkdown(`오류: ${message}`);
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
  ) => {
    if (highlightMode || eraseMode) return;

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
      const message = error instanceof Error ? error.message : '번역하지 못했습니다.';
      setTranslationDraft({
        kind,
        title: '번역 오류',
        sourceMarkdown: sourceText,
        translatedMarkdown: '',
        bilingualMarkdown: `오류: ${message}`,
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
      setSelectionNotice(error instanceof Error ? error.message : '번역을 저장하지 못했습니다.');
    } finally {
      setTranslationLoading(false);
    }
  };

  const renderPageShell = (targetPage: number) => {
    const pageHighlights = highlightsByPage[targetPage] ?? [];
    const shouldRenderPage = viewMode === 'paged' || visiblePages.has(targetPage);
    const pageHeight = Math.round(pageWidth * (pageRatios[targetPage] || 1.414));

    return (
      <div
        key={targetPage}
        ref={(node) => {
          pageShellRefs.current[targetPage] = node;
        }}
        data-page-number={targetPage}
        className="pdf-page-shell overflow-hidden rounded-xl shadow-ambient"
        style={{ minHeight: `${pageHeight}px`, width: `${pageWidth}px` }}
        onClick={(event) => handlePageClick(event, pageHighlights)}
        onMouseUp={() => {
          const pageShell = pageShellRefs.current[targetPage];

          if (eraseMode) {
            void handleEraseSelection(targetPage, pageShell);
            return;
          }

          void handleHighlightSelection(targetPage, pageShell);
        }}
      >
        {shouldRenderPage ? (
          <Page
            pageNumber={targetPage}
            width={pageWidth}
            devicePixelRatio={renderPixelRatio}
            renderAnnotationLayer={false}
            renderTextLayer
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
        </div>}
      </div>
    );
  };

  if (!activePdf) return null;

  return (
    <div className="h-full flex flex-col">
      {/* PDF Toolbar */}
      <div className="min-h-12 px-4 py-1 flex items-center justify-between gap-3 bg-surface shrink-0">
        {/* Left: file name */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={closePdf}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors shrink-0"
            aria-label="PDF 닫기"
          >
            <X size={13} strokeWidth={2} />
          </button>
          <span className="text-xs font-medium text-on-surface truncate">
            {activePdf.name}
          </span>
        </div>

        {/* Center: controls */}
        <div className="flex max-w-full items-center gap-1 glass rounded-lg px-2 py-1 overflow-x-auto">
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

          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('paged')}
              className={`h-8 rounded-lg px-2.5 text-[11px] font-medium transition-colors ${
                viewMode === 'paged'
                  ? 'bg-on-surface text-surface-container-lowest'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
              title="한 페이지 모드"
            >
              한 페이지
            </button>
            <button
              onClick={() => {
                setViewMode('scroll');
                window.requestAnimationFrame(() => {
                  const pageShell = pageShellRefs.current[pageNumber];
                  pageShell?.scrollIntoView({
                    block: 'start',
                    behavior: 'smooth',
                  });
                });
              }}
              className={`h-8 rounded-lg px-2.5 text-[11px] font-medium transition-colors ${
                viewMode === 'scroll'
                  ? 'bg-on-surface text-surface-container-lowest'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
              title="세로 스크롤 모드"
            >
              스크롤
            </button>
          </div>

          <div className="w-px h-4 bg-outline-variant/30 mx-0.5" />

          <button
            onClick={() => setFitMode('width')}
            className={`h-8 rounded-lg px-2 text-[11px] font-medium transition-colors ${
              fitMode === 'width'
                ? 'bg-on-surface text-surface-container-lowest'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="폭에 맞춤 (0)"
          >
            폭
          </button>
          <button
            onClick={() => setFitMode('page')}
            className={`h-8 rounded-lg px-2 text-[11px] font-medium transition-colors ${
              fitMode === 'page'
                ? 'bg-on-surface text-surface-container-lowest'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="페이지에 맞춤"
          >
            쪽
          </button>

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

          <div className="w-px h-4 bg-outline-variant/30 mx-0.5" />

          <button
            onClick={() => {
              setEraseMode(false);
              setHighlightMode((current) => current === 'unknown' ? null : 'unknown');
            }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              highlightMode === 'unknown'
                ? 'bg-error text-on-error'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="확인 필요 하이라이트"
            aria-label="확인 필요 하이라이트"
          >
            <Pen size={15} strokeWidth={2} />
          </button>
          <button
            onClick={() => {
              setEraseMode(false);
              setHighlightMode((current) => current === 'important' ? null : 'important');
            }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              highlightMode === 'important'
                ? 'bg-tertiary-fixed text-on-tertiary-fixed'
                : 'text-tertiary-fixed hover:bg-surface-container-high'
            }`}
            title="중요 하이라이트"
            aria-label="중요 하이라이트"
          >
            <Highlighter size={15} strokeWidth={2} />
          </button>
          <button
            onClick={() => {
              setHighlightMode(null);
              setEraseMode((current) => !current);
            }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              eraseMode
                ? 'bg-on-surface text-surface-container-lowest'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="하이라이트 지우개"
            aria-label="하이라이트 지우개"
          >
            <Eraser size={15} strokeWidth={2} />
          </button>
          <button
            onClick={() => setAnnotationListOpen((current) => !current)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              annotationListOpen
                ? 'bg-on-surface text-surface-container-lowest'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
            title="하이라이트 목록"
            aria-label="하이라이트 목록"
          >
            <List size={15} strokeWidth={2} />
          </button>
          <button
            onClick={() => void handleOpenExportPreview()}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="하이라이트를 Markdown으로 내보내기"
            aria-label="하이라이트 Markdown 내보내기"
          >
            <FileDown size={12} strokeWidth={2} />
          </button>
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void handleTranslate('selection')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="선택 영역 번역"
            aria-label="선택 영역 번역"
          >
            <Languages size={12} strokeWidth={2} />
          </button>
          <button
            onClick={() => void handleTranslate('full')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="전체 논문 한영 대조 번역"
            aria-label="전체 논문 한영 대조 번역"
          >
            <BookOpenText size={12} strokeWidth={2} />
          </button>
          <a
            href={fileUrl}
            download={activePdf.name}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="PDF 내려받기"
            aria-label="PDF 내려받기"
          >
            <Download size={12} strokeWidth={2} />
          </a>
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
            <span className="w-full pl-5 text-[10px] text-on-surface-variant">검색 결과가 없습니다.</span>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {annotationListOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-outline-variant/20 bg-surface-container-lowest">
            <div className="flex items-center justify-between border-b border-outline-variant/15 px-3 py-3">
              <div>
                <div className="text-xs font-semibold text-on-surface">하이라이트</div>
                <div className="mt-0.5 text-[10px] text-outline">{sortedHighlights.length}개 · 페이지를 눌러 이동</div>
              </div>
              <button
                onClick={() => setAnnotationListOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container"
                aria-label="하이라이트 목록 닫기"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {sortedHighlights.length === 0 ? (
                <div className="rounded-lg bg-surface-container px-3 py-4 text-[11px] leading-5 text-on-surface-variant">
                  PDF에서 문장을 선택한 뒤 중요 또는 확인 필요 하이라이트를 눌러 추가하세요.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {sortedHighlights.map((highlight) => {
                    const highlightKey = highlight.annotationId || highlight.id;
                    return (
                      <button
                        key={highlightKey}
                        onClick={() => {
                          handlePageChange(highlight.page);
                          setSelectedHighlightKey(highlightKey);
                          setNoteDialogOpen(true);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          highlightKey === selectedHighlightKey
                            ? 'border-outline bg-surface-container'
                            : 'border-transparent hover:bg-surface-container-low'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-on-surface-variant">
                          <span>페이지 {highlight.page}</span>
                          <span className={highlight.type === 'important' ? 'text-tertiary-fixed' : 'text-error'}>
                            {highlight.type === 'important' ? '중요' : '확인 필요'}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-on-surface">{highlight.text || '텍스트 없음'}</p>
                        {highlight.note?.trim() && (
                          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-on-surface-variant">메모: {highlight.note}</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        )}

        <div ref={containerRef} className="min-w-0 flex-1 overflow-auto bg-surface-dim">
        <div className="mx-auto min-w-full w-max py-8 px-6">
          <div className="mb-4 px-2">
            <div className="text-[11px] uppercase tracking-widest text-on-surface-variant font-medium mb-1">
              {activePdf.path}
            </div>
            <h1 className="text-lg font-semibold text-on-surface truncate">
              {activePdf.name}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-on-surface-variant">
              {eraseMode ? (
                <span>지우개 모드입니다. 지울 하이라이트에 걸치도록 텍스트를 선택하세요.</span>
              ) : highlightMode ? (
                <span>
                  {highlightMode === 'important' ? '중요' : '확인 필요'} 하이라이트 모드입니다. 저장할 텍스트를 선택하세요.
                </span>
              ) : selectedHighlight ? (
                <span>하이라이트를 선택했습니다. 팝업에서 메모를 작성하거나 수정하세요.</span>
              ) : (
                <span>텍스트를 드래그해 선택할 수 있습니다. 하이라이트를 누르면 메모를 추가할 수 있습니다.</span>
              )}
              {annotationSyncing && (
                <span className="text-outline">주석 저장 중...</span>
              )}
              {selectionNotice && (
                <span className="text-outline">{selectionNotice}</span>
              )}
            </div>
          </div>

          <div className="flex justify-center">
            <Document
              file={fileUrl}
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
      </div>

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

      {selectedHighlight && noteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
          <div className="w-full max-w-2xl rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-ambient">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-on-surface">하이라이트 메모</div>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                  {selectedHighlight.type === 'important' ? '중요' : '확인 필요'} · {selectedHighlight.page}페이지
                </p>
              </div>
              <button
                onClick={() => setNoteDialogOpen(false)}
                className="shrink-0 rounded-lg p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-surface-container px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-widest text-on-surface-variant">
                하이라이트 원문
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-on-surface">
                {selectedHighlight.text}
              </p>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-[11px] font-medium text-on-surface-variant">
                메모
              </label>
              <textarea
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                disabled={noteSaving}
                placeholder="이 하이라이트에 메모를 추가하세요..."
                className="min-h-32 w-full rounded-lg border border-outline-variant/30 bg-surface px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-outline disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[11px] text-on-surface-variant">
                {selectedHighlight.annotationId
                  ? '메모는 PDF 주석과 PageDock 기록에 함께 저장됩니다.'
                  : 'PDF 원본에 아직 반영되지 않아 PageDock 기록에 저장합니다.'}
              </p>
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
    </div>
  );
}
