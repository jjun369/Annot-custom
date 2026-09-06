'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, BookOpenText, CircleHelp, MoreHorizontal, Search, Settings, Telescope } from 'lucide-react';

import { HelpDialog } from '@/components/common/HelpDialog';
import { PageDockMark } from '@/components/common/PageDockMark';

type AppSection = 'library' | 'research' | 'knowledge' | 'settings';

interface AppHeaderProps {
  active: AppSection;
  actions?: React.ReactNode;
  onSearch?: () => void;
}

const PRIMARY_NAV_ITEMS = [
  { id: 'library' as const, href: '/', label: '라이브러리', icon: BookOpen },
];

const SECONDARY_NAV_ITEMS = [
  { id: 'research' as const, href: '/research', label: '리서치', icon: Telescope },
  { id: 'knowledge' as const, href: '/knowledge', label: '지식', icon: BookOpenText },
];

export function AppHeader({ active, actions, onSearch }: AppHeaderProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      if (event.key === 'F1' && !isEditing) {
        event.preventDefault();
        setHelpOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const hasSecondaryActive = active === 'research' || active === 'knowledge';

  return (
    <>
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant/20 bg-surface-container-lowest px-3 shadow-[0_1px_0_rgba(40,52,57,0.02)]">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1" aria-label="PageDock 홈">
          <PageDockMark size={30} className="rounded-lg shadow-sm" />
          <span className="text-sm font-bold tracking-tight text-on-surface">PageDock</span>
        </Link>

        <div className="h-5 w-px bg-outline-variant/45" />

        <nav className="flex items-center gap-1 rounded-xl bg-surface-container-low p-1" aria-label="주 메뉴">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const selected = active === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={selected ? 'page' : undefined}
                className={`flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-all ${
                  selected
                    ? 'bg-surface-container-lowest text-primary shadow-sm ring-1 ring-outline-variant/15'
                    : 'text-on-surface-variant hover:bg-surface-container-lowest/70 hover:text-on-surface'
                }`}
              >
                <Icon size={14} strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
          <div ref={moreRef} className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((current) => !current)}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all ${
                hasSecondaryActive
                  ? 'bg-surface-container-lowest text-primary shadow-sm ring-1 ring-outline-variant/15'
                  : 'text-on-surface-variant hover:bg-surface-container-lowest/70 hover:text-on-surface'
              }`}
              aria-label="리서치와 지식 도구 더보기"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-controls="app-secondary-navigation"
              title="리서치와 지식 도구"
            >
              <MoreHorizontal size={15} strokeWidth={2} aria-hidden="true" />
              <span className="hidden lg:inline">더보기</span>
            </button>
            {moreOpen && (
              <div id="app-secondary-navigation" role="menu" className="absolute left-0 top-full z-50 mt-1 w-36 rounded-xl border border-outline-variant/25 bg-surface-container-lowest p-1 shadow-ambient" aria-label="리서치와 지식 도구">
                {SECONDARY_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const selected = active === item.id;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      role="menuitem"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold ${
                        selected
                          ? 'bg-primary-container text-primary'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <Icon size={14} strokeWidth={2} aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </div>

      <div className="flex items-center gap-1.5">
        {actions}
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
            title="통합 검색 (Ctrl+K)"
          >
            <Search size={15} strokeWidth={2} />
            <span className="hidden sm:inline">검색</span>
            <kbd className="hidden rounded bg-surface-container px-1.5 py-0.5 text-[9px] font-medium text-outline lg:inline">Ctrl K</kbd>
          </button>
        )}
        <button type="button" onClick={() => setHelpOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface" aria-label="사용 도움말 열기" title="사용 도움말 (F1)">
          <CircleHelp size={16} strokeWidth={2} />
        </button>
        <Link
          href="/settings"
          aria-label="설정"
          aria-current={active === 'settings' ? 'page' : undefined}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            active === 'settings'
              ? 'bg-primary-container text-primary'
              : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
          }`}
          title="설정"
        >
          <Settings size={15} strokeWidth={2} />
        </Link>
      </div>
    </header>
    {helpOpen && <HelpDialog active={active} onClose={() => setHelpOpen(false)} />}
    </>
  );
}
