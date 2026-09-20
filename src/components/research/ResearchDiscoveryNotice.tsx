import { Info } from 'lucide-react';

import { RESEARCH_DISCOVERY_GUIDANCE } from '@/lib/research-discovery';

export function ResearchDiscoveryNotice() {
  return (
    <details className="mt-3 rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-[10px] leading-5 text-on-surface-variant">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-on-surface marker:hidden">
        <Info aria-hidden="true" className="shrink-0 text-primary" size={14} />
        <span>{RESEARCH_DISCOVERY_GUIDANCE.title}</span>
      </summary>
      <div className="mt-2 border-t border-outline-variant/15 pt-2">
        <p>{RESEARCH_DISCOVERY_GUIDANCE.body}</p>
        <p className="mt-1 text-outline">{RESEARCH_DISCOVERY_GUIDANCE.approval}</p>
        <p className="mt-1 text-outline">{RESEARCH_DISCOVERY_GUIDANCE.unofficial}</p>
      </div>
    </details>
  );
}
