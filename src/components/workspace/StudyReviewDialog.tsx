'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, Loader2, MapPin, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react';

import { ClozeRangePicker } from '@/components/workspace/ClozeRangePicker';
import {
  formatStudyReviewDate,
  getDueStudyCards,
  getLocalStudyDate,
  getNextStudyReviewDate,
  getStudyCardCloze,
  getStudyCardKind,
  renderStudyCardCloze,
  sortStudyCardsForReview,
} from '@/lib/study-cards';
import { useWorkspace } from '@/lib/workspace-store';
import { StudyCard, StudyCardCloze } from '@/types';

export function StudyReviewDialog() {
  const {
    activePdf,
    closeStudyReview,
    navigateToPdfSource,
    notifyStudyCardsChanged,
    studyCardsRevision,
    studyReviewOpen,
  } = useWorkspace();
  const activePdfPath = activePdf?.path || '';
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [editCloze, setEditCloze] = useState<StudyCardCloze | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<'due' | 'all'>('due');
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const reviewInFlight = useRef(false);

  const loadCards = useCallback(async () => {
    if (!activePdfPath) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/study-cards?path=${encodeURIComponent(activePdfPath)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload?.error || !Array.isArray(payload?.cards)) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : '복습 카드를 불러오지 못했습니다.');
      }
      setCards(payload.cards as StudyCard[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '복습 카드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [activePdfPath]);

  useEffect(() => {
    if (studyReviewOpen) void loadCards();
  }, [loadCards, studyCardsRevision, studyReviewOpen]);

  const today = getLocalStudyDate();
  const sortedCards = useMemo(() => sortStudyCardsForReview(cards), [cards]);
  const dueCards = useMemo(() => getDueStudyCards(cards, today), [cards, today]);
  const reviewCards = reviewMode === 'due' ? dueCards : sortedCards;
  const nextReviewDate = useMemo(() => getNextStudyReviewDate(cards, today), [cards, today]);
  const activeCard = reviewCards.find((card) => card.id === activeCardId) || reviewCards[0] || null;
  const activeCardKind = activeCard ? getStudyCardKind(activeCard) : 'basic';
  const activeCloze = activeCard ? getStudyCardCloze(activeCard) : null;
  const activeClozeSourceText = activeCard?.sourceContext.text || '';

  useEffect(() => {
    if (activeCard?.id !== activeCardId) setActiveCardId(activeCard?.id || null);
  }, [activeCard?.id, activeCardId]);

  useEffect(() => {
    setAnswerVisible(false);
    setEditing(false);
    setEditCloze(null);
    setError(null);
  }, [activeCardId]);

  useEffect(() => {
    if (studyReviewOpen) {
      setReviewMode('due');
      setScheduleNotice(null);
    }
  }, [activePdfPath, studyReviewOpen]);

  useEffect(() => {
    if (!studyReviewOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !actionLoading) closeStudyReview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionLoading, closeStudyReview, studyReviewOpen]);

  if (!studyReviewOpen || !activePdfPath) return null;

  const currentIndex = activeCard ? reviewCards.findIndex((card) => card.id === activeCard.id) + 1 : 0;
  const getCardsForMode = (source: StudyCard[]) => reviewMode === 'due'
    ? getDueStudyCards(source, today)
    : sortStudyCardsForReview(source);
  const updateLocalCard = (updated: StudyCard, moveToNext = false) => {
    const nextCards = cards.map((card) => card.id === updated.id ? updated : card);
    setCards(nextCards);
    if (moveToNext) {
      const nextReviewCards = getCardsForMode(nextCards);
      const next = reviewMode === 'due'
        ? nextReviewCards[currentIndex - 1] || nextReviewCards[0]
        : nextReviewCards.filter((card) => card.id !== updated.id)[currentIndex - 1]
          || nextReviewCards.find((card) => card.id !== updated.id);
      setActiveCardId(next?.id || null);
    }
  };
  const patchCard = async (body: Record<string, unknown>) => {
    if (!activeCard) return null;
    const response = await fetch('/api/workspace/study-cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfPath: activePdfPath, cardId: activeCard.id, ...body }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.error || !payload?.card) {
      throw new Error(typeof payload?.error === 'string' ? payload.error : '복습 카드를 저장하지 못했습니다.');
    }
    return payload.card as StudyCard;
  };
  const handleReview = async (reviewResult: 'again' | 'remembered') => {
    if (actionLoading || reviewInFlight.current) return;
    reviewInFlight.current = true;
    try {
      setActionLoading(true);
      setError(null);
      const updated = await patchCard({ reviewResult });
      if (!updated) return;
      updateLocalCard(updated, true);
      setScheduleNotice(`다음 복습: ${formatStudyReviewDate(updated.review.nextReviewDate) || '날짜를 확인해 주세요.'}`);
      notifyStudyCardsChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : '복습 결과를 저장하지 못했습니다.');
    } finally {
      reviewInFlight.current = false;
      setActionLoading(false);
    }
  };
  const handleSaveEdit = async () => {
    try {
      setActionLoading(true);
      setError(null);
      if (activeCardKind === 'cloze' && !editCloze) {
        throw new Error('원문에서 새로 숨길 구를 선택해 주세요.');
      }
      const updated = await patchCard(activeCardKind === 'cloze'
        ? { cloze: editCloze }
        : { front: editFront, back: editBack });
      if (!updated) return;
      updateLocalCard(updated);
      setEditing(false);
      notifyStudyCardsChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '카드를 수정하지 못했습니다.');
    } finally {
      setActionLoading(false);
    }
  };
  const handleDelete = async () => {
    if (!activeCard || !window.confirm('이 복습 카드만 삭제할까요? 원문 하이라이트와 AI 대화는 남아 있습니다.')) return;
    try {
      setActionLoading(true);
      setError(null);
      const response = await fetch('/api/workspace/study-cards', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPath: activePdfPath, cardId: activeCard.id }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.error || !Array.isArray(payload?.cards)) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : '복습 카드를 삭제하지 못했습니다.');
      }
      setCards(payload.cards as StudyCard[]);
      setActiveCardId(null);
      notifyStudyCardsChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '복습 카드를 삭제하지 못했습니다.');
    } finally {
      setActionLoading(false);
    }
  };
  const showSource = () => {
    if (!activeCard?.sourceContext.page) return;
    navigateToPdfSource({
      id: crypto.randomUUID(),
      pdfPath: activePdfPath,
      page: activeCard.sourceContext.page,
      rects: activeCard.sourceContext.rects,
    });
    closeStudyReview();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 py-6" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="study-review-title" className="flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-ambient">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-5 py-4">
          <div>
            <h2 id="study-review-title" className="text-sm font-semibold text-on-surface">복습 · {activePdf?.name}</h2>
            <p className="mt-1 text-xs text-on-surface-variant">답을 떠올린 뒤 원문으로 돌아가 확인하세요.</p>
            <div className="mt-3 inline-flex rounded-lg bg-surface-container p-0.5 text-[11px]">
              <button type="button" onClick={() => setReviewMode('due')} aria-pressed={reviewMode === 'due'} className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${reviewMode === 'due' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>오늘 복습 {dueCards.length}</button>
              <button type="button" onClick={() => setReviewMode('all')} aria-pressed={reviewMode === 'all'} className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${reviewMode === 'all' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>전체 카드 {sortedCards.length}</button>
            </div>
          </div>
          <button type="button" onClick={closeStudyReview} disabled={actionLoading} className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label="복습 닫기"><X size={14} /></button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-on-surface-variant"><Loader2 size={15} className="animate-spin" /> 복습 카드를 불러오는 중...</div>
          ) : !activeCard ? (
            sortedCards.length === 0 ? (
              <div className="rounded-xl bg-surface-container px-4 py-6 text-center text-sm leading-6 text-on-surface-variant">아직 이 PDF의 복습 카드가 없습니다. 문장을 선택하거나 AI 답변에서 카드를 만들어 보세요.</div>
            ) : (
              <div className="rounded-xl bg-surface-container px-4 py-6 text-center text-sm leading-6 text-on-surface-variant"><strong className="block font-semibold text-on-surface">오늘 복습할 카드가 없습니다.</strong>{scheduleNotice && <span className="mt-1 block">{scheduleNotice}</span>}{nextReviewDate && <span className="mt-1 block">다음 예정 카드: {formatStudyReviewDate(nextReviewDate)}</span>}</div>
            )
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 text-[11px] text-on-surface-variant">
                <span>{currentIndex} / {reviewCards.length}</span>
                <span className="inline-flex items-center gap-1"><MapPin size={11} /> {activeCard.sourceContext.page}페이지 · {activeCard.origin === 'chat' ? 'AI 대화' : '선택 문장'}</span>
              </div>

              {editing ? (
                activeCardKind === 'cloze' && activeClozeSourceText ? (
                  <div className="mt-4"><ClozeRangePicker sourceText={activeClozeSourceText} value={editCloze} onChange={setEditCloze} disabled={actionLoading} /></div>
                ) : (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-on-surface-variant">질문 앞면</span><textarea value={editFront} onChange={(event) => setEditFront(event.target.value)} disabled={actionLoading} className="min-h-36 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2.5 text-sm leading-6 text-on-surface outline-none focus:border-outline disabled:opacity-60" /></label>
                    <label className="block"><span className="mb-1.5 block text-[11px] font-medium text-on-surface-variant">답 뒷면</span><textarea value={editBack} onChange={(event) => setEditBack(event.target.value)} disabled={actionLoading} className="min-h-36 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2.5 text-sm leading-6 text-on-surface outline-none focus:border-outline disabled:opacity-60" /></label>
                  </div>
                )
              ) : (
                <div className="mt-4 rounded-2xl border border-outline-variant/20 bg-surface px-5 py-5">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant">{activeCardKind === 'cloze' ? '빈칸' : '질문'}</div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-base leading-7 text-on-surface">{activeCloze && activeClozeSourceText ? renderStudyCardCloze(activeClozeSourceText, activeCloze) : activeCard.front}</p>
                  {answerVisible && (
                    <div className="mt-5 border-t border-outline-variant/15 pt-5">
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant">답</div>
                      {activeCloze && activeClozeSourceText ? (
                        <p className="mt-3 whitespace-pre-wrap break-words text-base leading-7 text-on-surface">{activeClozeSourceText.slice(0, activeCloze.start)}<mark className="rounded bg-primary-container px-0.5 text-on-primary-container">{activeCloze.text}</mark>{activeClozeSourceText.slice(activeCloze.end)}</p>
                      ) : (
                        <p className="mt-3 whitespace-pre-wrap break-words text-base leading-7 text-on-surface">{activeCard.back}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {scheduleNotice && <p className="mt-3 text-xs leading-5 text-on-surface-variant" role="status">{scheduleNotice}</p>}
              {error && <p className="mt-3 text-xs leading-5 text-error" role="alert">{error}</p>}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={showSource} disabled={actionLoading} className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant/30 px-3 py-2 text-xs font-medium text-on-surface hover:bg-surface-container disabled:opacity-50"><MapPin size={12} /> 원문 보기</button>
                  {!editing && <button type="button" onClick={() => { if (activeCardKind === 'cloze') setEditCloze(activeCloze); else { setEditFront(activeCard.front); setEditBack(activeCard.back); } setEditing(true); }} disabled={actionLoading} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-50"><Pencil size={12} /> {activeCardKind === 'cloze' ? '빈칸 수정' : '수정'}</button>}
                  <button type="button" onClick={() => void handleDelete()} disabled={actionLoading} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-50"><Trash2 size={12} /> 삭제</button>
                </div>
                {editing ? (
                  <div className="flex items-center gap-1.5"><button type="button" onClick={() => setEditing(false)} disabled={actionLoading} className="rounded-xl px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container disabled:opacity-50">취소</button><button type="button" onClick={() => void handleSaveEdit()} disabled={actionLoading || (activeCardKind === 'cloze' ? !editCloze : !editFront.trim() || !editBack.trim())} className="inline-flex items-center gap-1.5 rounded-xl bg-on-surface px-3 py-2 text-xs font-semibold text-surface-container-lowest disabled:opacity-50">{actionLoading ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} 저장</button></div>
                ) : answerVisible ? (
                  <div className="flex items-center gap-1.5"><button type="button" onClick={() => void handleReview('again')} disabled={actionLoading} className="inline-flex flex-col items-start gap-0 rounded-xl border border-outline-variant/30 px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"><span className="inline-flex items-center gap-1.5"><RotateCcw size={12} /> 다시</span><span className="pl-[18px] text-[10px] font-medium text-on-surface-variant">내일 복습</span></button><button type="button" onClick={() => void handleReview('remembered')} disabled={actionLoading} className="inline-flex flex-col items-start gap-0 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-50"><span className="inline-flex items-center gap-1.5"><Check size={12} /> 기억함</span><span className="pl-[18px] text-[10px] font-medium text-on-primary/75">3일 뒤 복습</span></button></div>
                ) : (
                  <button type="button" onClick={() => setAnswerVisible(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-on-primary"><Eye size={12} /> 답 보기</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
