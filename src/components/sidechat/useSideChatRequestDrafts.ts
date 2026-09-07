'use client';
import { useRef, useState } from 'react';
export interface RequestDraft { response: string; model: string }
const empty: RequestDraft = { response: '', model: '' };
export function useSideChatRequestDrafts(namespace: string, onError: (message: string) => void) {
  const cache = useRef(new Map<string, RequestDraft>());
  const [, redraw] = useState(0);
  const key = (id: string) => `pagedock:sidechat:response:v2:${namespace}:${id}`;
  const read = (id: string): RequestDraft => {
    const storageKey = key(id);
    if (cache.current.has(storageKey)) return cache.current.get(storageKey)!;
    let value = empty;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) { const parsed = JSON.parse(raw); if (typeof parsed.response === 'string' && typeof parsed.model === 'string') value = parsed; }
    } catch { /* In-memory input remains usable; write failures are shown on edit. */ }
    cache.current.set(storageKey, value); return value;
  };
  const write = (id: string, value: RequestDraft) => {
    cache.current.set(key(id), value);
    try { if (value.response || value.model) localStorage.setItem(key(id), JSON.stringify(value)); else localStorage.removeItem(key(id)); }
    catch { onError('기기 초안 저장 공간이 부족합니다. 이 창의 입력은 유지되지만 닫기 전 복사하거나 답변을 저장해 주세요.'); }
    redraw((v) => v + 1);
  };
  const clearSaved = (id: string, saved: RequestDraft) => {
    const current = read(id);
    if (current.response === saved.response && current.model === saved.model) write(id, empty);
  };
  return { read, write, clearSaved };
}
