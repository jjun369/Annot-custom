'use client';

import { MessageSquare } from 'lucide-react';

export interface AiAnchorMarkerProps {
  topPercent: number;
  count: number;
  onClick: () => void;
}

export function AiAnchorMarker({ topPercent, count, onClick }: AiAnchorMarkerProps) {
  return (
    <button
      type="button"
      className="pdf-ai-anchor-marker"
      style={{ top: `${Math.max(1, Math.min(94, topPercent))}%` }}
      onClick={onClick}
      aria-label={`이 위치의 AI 대화 ${count}개 열기`}
      title={`이 위치의 AI 대화 ${count}개`}
    >
      <MessageSquare size={12} aria-hidden="true" />
      <span>{count}</span>
    </button>
  );
}
