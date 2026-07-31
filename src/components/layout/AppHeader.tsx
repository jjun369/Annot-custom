'use client';

import Link from 'next/link';
import { BookOpen, BookOpenText, Search, Settings, Telescope } from 'lucide-react';

import { PageDockMark } from '@/components/common/PageDockMark';

type AppSection = 'library' | 'research' | 'knowledge' | 'settings';

interface AppHeaderProps {
  active: AppSection;
  actions?: React.ReactNode;
  onSearch?: () => void;
}

const NAV_ITEMS = [
  { id: 'library' as const, href: '/', label: '라이브러리', icon: BookOpen },
  { id: 'research' as const, href: '/research', label: '리서치', icon: Telescope },
  { id: 'knowledge' as const, href: '/knowledge', label: '지식', icon: BookOpenText },
];

export function AppHeader({ active, actions, onSearch }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant/20 bg-surface-container-lowest px-3 shadow-[0_1px_0_rgba(40,52,57,0.02)]">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1" aria-label="PageDock 홈">
          <PageDockMark size={30} className="rounded-lg shadow-sm" />
          <span className="text-sm font-bold tracking-tight text-on-surface">PageDock</span>
        </Link>

        <div className="h-5 w-px bg-outline-variant/45" />

        <nav className="flex items-center gap-1 rounded-xl bg-surface-container-low p-1" aria-label="주 메뉴">
          {NAV_ITEMS.map((item) => {
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
  );
}
