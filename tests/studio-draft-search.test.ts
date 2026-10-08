import { describe, expect, test } from 'vitest';

import { filterStudioDrafts, resolveStudioDraft, studioDraftHrefFromRecordId, studioDraftIdFromRecordId } from '@/lib/studio-draft-search';
import type { StudioDraft } from '@/lib/sources-studio';

const drafts: StudioDraft[] = [
  { id: 'synthesis', title: 'Gain comparison', text: 'Dual conversion gain transition notes', revision: 1,
    createdAt: '2026-10-01', updatedAt: '2026-10-01', references: [{ sourceId: 'reader:doc:h1', title: 'Paper page 4',
      kind: 'memo', originLabel: 'Reader', sourceUpdatedAt: '2026-10-01', excerpt: 'A bounded synthetic excerpt',
      includeInRequest: false, evidenceSnapshot: { provenanceLabel: 'AI synthesis proposal · literature claim' } }] },
  { id: 'manual', title: 'Reading plan', text: 'Continue paper tomorrow', revision: 1,
    createdAt: '2026-10-02', updatedAt: '2026-10-02', references: [] },
];

describe('local Studio draft discovery', () => {
  test('finds unreviewed drafts by body text and retains their source snapshots', () => {
    const results = filterStudioDrafts(drafts, 'CONVERSION GAIN');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'synthesis', references: [{ sourceId: 'reader:doc:h1', excerpt: 'A bounded synthetic excerpt' }] });
  });

  test('finds by source identity and provenance, not only the draft title', () => {
    expect(filterStudioDrafts(drafts, 'reader:doc:h1').map((draft) => draft.id)).toEqual(['synthesis']);
    expect(filterStudioDrafts(drafts, 'literature claim').map((draft) => draft.id)).toEqual(['synthesis']);
  });

  test('normalizes Korean/compatibility search and returns all drafts for an empty query', () => {
    expect(filterStudioDrafts(drafts, '　')).toEqual(drafts);
    expect(filterStudioDrafts(drafts, 'Tomorrow')).toEqual([drafts[1]]);
  });

  test('reopens the exact requested draft after restart instead of replacing a missing deep link silently', () => {
    expect(resolveStudioDraft(drafts, 'synthesis')).toBe(drafts[0]);
    expect(resolveStudioDraft(drafts, 'missing')).toBeNull();
    expect(resolveStudioDraft(drafts, null)).toBe(drafts[0]);
  });

  test('maps reusable draft record IDs back to the exact Studio draft, never a PDF source URL', () => {
    expect(studioDraftIdFromRecordId('studio-draft:synthesis')).toBe('synthesis');
    expect(studioDraftHrefFromRecordId('studio-draft:synthesis')).toBe('/studio?draft=synthesis');
    expect(studioDraftHrefFromRecordId('reader:doc:h1')).toBeNull();
  });
});
