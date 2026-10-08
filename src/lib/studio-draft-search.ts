import type { StudioDraft } from '@/lib/sources-studio';

export const STUDIO_DRAFT_RECORD_PREFIX = 'studio-draft:';

export function studioDraftIdFromRecordId(recordId: string): string | null {
  if (!recordId.startsWith(STUDIO_DRAFT_RECORD_PREFIX)) return null;
  const id = recordId.slice(STUDIO_DRAFT_RECORD_PREFIX.length);
  return id ? id : null;
}

export function studioDraftHrefFromRecordId(recordId: string): string | null {
  const id = studioDraftIdFromRecordId(recordId);
  return id ? `/studio?draft=${encodeURIComponent(id)}` : null;
}

export function filterStudioDrafts(drafts: StudioDraft[], query: string): StudioDraft[] {
  const needle = query.trim().normalize('NFKC').toLowerCase();
  if (!needle) return drafts;
  return drafts.filter((draft) => [draft.title, draft.text,
    ...draft.references.flatMap((reference) => [reference.sourceId, reference.title, reference.originLabel, reference.excerpt,
      reference.evidenceSnapshot?.provenanceLabel ?? '']),
  ].join('\n').normalize('NFKC').toLowerCase().includes(needle));
}

export function resolveStudioDraft(drafts: StudioDraft[], requestedId: string | null): StudioDraft | null {
  if (requestedId) return drafts.find((draft) => draft.id === requestedId) ?? null;
  return drafts[0] ?? null;
}
