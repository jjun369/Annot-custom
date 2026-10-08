'use client';

import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function InfoHint({ label = '자세히 보기', text }: { label?: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerInside = useRef(false);
  const pinnedOpen = useRef(false);
  const suppressFocusOpen = useRef(false);
  const id = useId();

  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeAfterPointerLeaves = () => {
    keepOpen();
    closeTimer.current = setTimeout(() => {
      if (!pinnedOpen.current && document.activeElement !== buttonRef.current) setOpen(false);
    }, 180);
  };

  useEffect(() => {
    if (!open) return;
    const placePanel = () => {
      const button = buttonRef.current;
      const panel = panelRef.current;
      if (!button || !panel) return;
      const anchor = button.getBoundingClientRect();
      const size = panel.getBoundingClientRect();
      const edge = 8;
      const left = Math.max(edge, Math.min(anchor.right - size.width, window.innerWidth - size.width - edge));
      const below = anchor.bottom + 8;
      const top = below + size.height <= window.innerHeight - edge
        ? below
        : Math.max(edge, anchor.top - size.height - 8);
      setPosition({ left, top });
    };
    placePanel();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        pinnedOpen.current = false;
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        pinnedOpen.current = false;
        setOpen(false);
        if (document.activeElement !== buttonRef.current) {
          suppressFocusOpen.current = true;
          buttonRef.current?.focus();
          queueMicrotask(() => { suppressFocusOpen.current = false; });
        }
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open]);

  return <>
    <button ref={buttonRef} type="button" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
      aria-describedby={open ? id : undefined} onClick={() => {
        const nextOpen = !pinnedOpen.current;
        pinnedOpen.current = nextOpen;
        setOpen(nextOpen);
      }}
      onFocus={(event) => { if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; } if (event.currentTarget.matches(':focus-visible')) setOpen(true); }} onBlur={(event) => {
        if (event.relatedTarget === panelRef.current) return;
        if (!pointerInside.current) { pinnedOpen.current = false; setOpen(false); }
      }}
      onMouseEnter={() => { pointerInside.current = true; keepOpen(); setOpen(true); }} onMouseLeave={() => { pointerInside.current = false; closeAfterPointerLeaves(); }}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    ><Info size={14} aria-hidden="true" /></button>
    {open && typeof document !== 'undefined' && createPortal(
      <div ref={panelRef} id={id} role="tooltip" onMouseEnter={() => { pointerInside.current = true; keepOpen(); }} onMouseLeave={() => { pointerInside.current = false; closeAfterPointerLeaves(); }} style={{ left: position?.left ?? 8, top: position?.top ?? 8, visibility: position ? 'visible' : 'hidden' }}
        className="fixed z-[120] max-h-[calc(100dvh-1rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-3 text-left text-[12px] leading-5 text-on-surface shadow-ambient"
      >{text}</div>, document.body,
    )}
  </>;
}
