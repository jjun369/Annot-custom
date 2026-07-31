'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Database, Loader2, ShieldCheck } from 'lucide-react';

interface SourceStatus {
  unpaywallEmail?: string;
  openAlexConfigured: boolean;
  kiprisConfigured: boolean;
  epoConfigured: boolean;
}

export function ResearchSourcesCard() {
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [form, setForm] = useState({ unpaywallEmail: '', openAlexKey: '', kiprisKey: '', epoClientId: '', epoClientSecret: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await fetch('/api/research/sources', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '자료 공급자 설정을 불러오지 못했습니다.');
    setStatus(data);
    setForm((current) => ({ ...current, unpaywallEmail: data.unpaywallEmail || '' }));
  };

  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, []);

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      const body: Record<string, string> = { unpaywallEmail: form.unpaywallEmail };
      for (const key of ['openAlexKey', 'kiprisKey', 'epoClientId', 'epoClientSecret'] as const) {
        if (form[key].trim()) body[key] = form[key].trim();
      }
      const response = await fetch('/api/research/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '설정을 저장하지 못했습니다.');
      setStatus(data);
      setForm((current) => ({ ...current, openAlexKey: '', kiprisKey: '', epoClientId: '', epoClientSecret: '' }));
      setMessage('이 PC에 안전하게 저장했습니다. 빈 비밀키 입력란은 기존 값을 유지합니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '설정을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, placeholder: string, secret = false) => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-on-surface-variant">{label}</span>
      <input
        type={secret ? 'password' : 'text'}
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
      />
    </label>
  );

  return (
    <div className="bg-surface-container-lowest rounded-lg p-5 space-y-5">
      <div className="flex items-start gap-3 rounded-xl bg-surface-container px-4 py-3">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-700" />
        <p className="text-xs leading-5 text-on-surface-variant">
          비밀키는 운영체제의 보호 저장소(Windows DPAPI 또는 macOS Keychain)에 보관하며 백업·설치 파일·로그에 넣지 않습니다. Unpaywall 이메일만 일반 설정으로 저장됩니다.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {field('unpaywallEmail', 'Unpaywall 이메일', '공개 원문 검색에 사용할 이메일')}
        {field('openAlexKey', `OpenAlex 키${status?.openAlexConfigured ? ' · 설정됨' : ' · 선택'}`, status?.openAlexConfigured ? '새 값 입력 시 교체' : '선택 사항', true)}
        {field('kiprisKey', `KIPRIS Plus 키${status?.kiprisConfigured ? ' · 설정됨' : ' · 선택'}`, status?.kiprisConfigured ? '새 값 입력 시 교체' : '선택 사항', true)}
        {field('epoClientId', `EPO OPS Client ID${status?.epoConfigured ? ' · 설정됨' : ' · 선택'}`, status?.epoConfigured ? '새 값 입력 시 교체' : '선택 사항', true)}
        {field('epoClientSecret', 'EPO OPS Client Secret', status?.epoConfigured ? '새 값 입력 시 교체' : '선택 사항', true)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
          자료 공급자 설정 저장
        </button>
        {status && <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant"><CheckCircle2 size={13} className="text-emerald-600" /> Crossref는 키 없이 사용 가능</span>}
      </div>
      {message && <p className="rounded-lg bg-surface-container px-3 py-2 text-xs text-on-surface">{message}</p>}
    </div>
  );
}
