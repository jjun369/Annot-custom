'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, CircleHelp, Lightbulb, Wrench, X } from 'lucide-react';

import {
  GENERAL_HELP,
  SCREEN_HELP,
  TROUBLESHOOTING_HELP,
  type HelpSectionId,
  type HelpTabId,
} from '@/lib/help-content';

interface HelpDialogProps {
  active: HelpSectionId;
  onClose: () => void;
}

const TABS: Array<{ id: HelpTabId; label: string; icon: typeof CircleHelp }> = [
  { id: 'screen', label: '이 화면', icon: CircleHelp },
  { id: 'guide', label: '전체 사용법', icon: BookOpen },
  { id: 'troubleshooting', label: '문제 해결', icon: Wrench },
];

function ContentGroups({ groups }: { groups: typeof GENERAL_HELP }) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="text-xs font-bold text-on-surface">{group.title}</h3>
          <ul className="mt-2 space-y-2">
            {group.items.map((item) => (
              <li key={item} className="flex gap-2 text-xs leading-5 text-on-surface-variant">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function HelpDialog({ active, onClose }: HelpDialogProps) {
  const [tab, setTab] = useState<HelpTabId>('screen');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const screen = SCREEN_HELP[active];

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/25 px-4 py-[8vh]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pagedock-help-title"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-ambient"
      >
        <div className="flex items-start gap-3 border-b border-outline-variant/20 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-container text-primary"><Lightbulb size={18} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-[0.14em] text-primary">PAGEDOCK 도움말</p>
            <h2 id="pagedock-help-title" className="mt-1 text-lg font-bold text-on-surface">사용 방법과 팁</h2>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">필요할 때만 열어보는 짧은 안내입니다. 다시 닫아도 작업 내용에는 영향이 없습니다.</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface" aria-label="도움말 닫기">
            <X size={17} />
          </button>
        </div>
        <div className="flex gap-1 border-b border-outline-variant/20 bg-surface-container-low p-2" role="tablist" aria-label="도움말 종류">
          {TABS.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button key={item.id} type="button" role="tab" aria-selected={selected} onClick={() => setTab(item.id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${selected ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-lowest/70'}`}>
                <Icon size={14} />{item.label}
              </button>
            );
          })}
        </div>
        <div className="max-h-[62vh] overflow-y-auto px-5 py-5">
          {tab === 'screen' && <>
            <p className="text-[10px] font-bold tracking-[0.12em] text-primary">{screen.eyebrow}</p>
            <h3 className="mt-1 text-base font-bold text-on-surface">{screen.title}</h3>
            <p className="mt-2 text-xs leading-5 text-on-surface-variant">{screen.summary}</p>
            <div className="mt-5"><ContentGroups groups={screen.groups} /></div>
          </>}
          {tab === 'guide' && <ContentGroups groups={GENERAL_HELP} />}
          {tab === 'troubleshooting' && <ContentGroups groups={TROUBLESHOOTING_HELP} />}
        </div>
        <div className="border-t border-outline-variant/20 px-5 py-3 text-[10px] text-outline">단축키: F1 열기 · Esc 닫기</div>
      </div>
    </div>
  );
}
