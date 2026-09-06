import { describe, expect, test } from 'vitest';

import {
  applyStudyKind,
  inferStudyKind,
  isUnresolvedHighlight,
  legacyTypeForStudyKind,
} from '@/lib/highlight-study';
import { mergeHighlights } from '@/lib/highlight-utils';
import {
  applyWorkDoneAt,
  applyWorkKind,
  getWorkStatusLabel,
  isWorkDone,
} from '@/lib/highlight-work';
import { buildPdfEvidenceBriefMarkdown } from '@/lib/pdf-annotations';
import { selectWorkEvidenceGroups } from '@/lib/work-evidence';
import { deriveReaderSummary } from '@/lib/reader-summary';
import { Highlight } from '@/types';

const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.04 };

function highlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: 'local-highlight',
    pdfPath: 'papers/study.pdf',
    page: 12,
    type: 'important',
    text: 'A stable selected sentence.',
    rects: [rect],
    position: rect,
    ...overrides,
  };
}

describe('study highlight compatibility', () => {
  test('maps old native highlight types without requiring a data migration', () => {
    expect(inferStudyKind(highlight({ type: 'important' }))).toBe('important');
    expect(inferStudyKind(highlight({ type: 'unknown' }))).toBe('unclear');
    expect(isUnresolvedHighlight(highlight({ type: 'unknown' }))).toBe(true);
  });

  test('preserves legacy native colors while semantic kinds vary', () => {
    expect(legacyTypeForStudyKind('concept')).toBe('important');
    expect(legacyTypeForStudyKind('memorize')).toBe('important');
    expect(legacyTypeForStudyKind('question')).toBe('unknown');
    expect(legacyTypeForStudyKind('unclear')).toBe('unknown');
  });

  test('clears resolved state when changing to a non-unresolved kind', () => {
    const resolvedAt = '2026-08-31T12:00:00.000Z';
    expect(applyStudyKind(highlight({ type: 'unknown', studyKind: 'unclear', resolvedAt }), 'question').resolvedAt)
      .toBe(resolvedAt);
    expect(applyStudyKind(highlight({ type: 'unknown', studyKind: 'unclear', resolvedAt }), 'important').resolvedAt)
      .toBeUndefined();
  });

  test('merges native and sidecar records without dropping study metadata', () => {
    const native = highlight({
      id: 'pdf:24',
      annotationId: '24',
      note: 'native note',
      studyKind: undefined,
      resolvedAt: undefined,
    });
    const sidecar = highlight({
      id: 'local-highlight',
      annotationId: undefined,
      documentId: 'document-1',
      studyKind: 'unclear',
      resolvedAt: '2026-08-31T12:00:00.000Z',
      createdAt: '2026-08-30T12:00:00.000Z',
      updatedAt: '2026-08-31T12:00:00.000Z',
    });

    const merged = mergeHighlights([native, sidecar]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      annotationId: '24',
      documentId: 'document-1',
      studyKind: 'unclear',
      resolvedAt: '2026-08-31T12:00:00.000Z',
      note: 'native note',
    });
  });

  test('semantic updates keep one highlight instead of duplicating geometry', () => {
    const original = highlight({ studyKind: 'important' });
    const concept = highlight({ studyKind: 'concept', updatedAt: '2026-08-31T12:00:00.000Z' });
    const memorize = highlight({ studyKind: 'memorize', updatedAt: '2026-08-31T12:01:00.000Z' });
    const merged = mergeHighlights([original, concept, memorize]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.studyKind).toBe('memorize');
  });

  test('keeps work completion independent from study resolved state', () => {
    const work = highlight({
      studyKind: 'unclear',
      resolvedAt: '2026-08-31T12:00:00.000Z',
      workKind: 'verify',
    });
    expect(getWorkStatusLabel(work)).toBe('OPEN');

    const done = applyWorkDoneAt(work, '2026-08-31T13:00:00.000Z');
    expect(isWorkDone(done)).toBe(true);
    expect(done.resolvedAt).toBe('2026-08-31T12:00:00.000Z');

    const reopened = applyWorkDoneAt(done, undefined);
    expect(getWorkStatusLabel(reopened)).toBe('OPEN');
    expect(reopened.resolvedAt).toBe('2026-08-31T12:00:00.000Z');
  });

  test('clears completed state when changing or removing a work kind', () => {
    const doneVerify = highlight({
      workKind: 'verify',
      workDoneAt: '2026-08-31T12:00:00.000Z',
    });
    const discuss = applyWorkKind(doneVerify, 'discuss');
    expect(discuss).toMatchObject({ workKind: 'discuss', workDoneAt: undefined });

    const finding = applyWorkKind(doneVerify, 'finding');
    expect(finding).toMatchObject({ workKind: 'finding', workDoneAt: undefined });

    const ordinary = applyWorkKind(doneVerify, undefined);
    expect(ordinary.workKind).toBeUndefined();
    expect(ordinary.workDoneAt).toBeUndefined();
  });

  test('merges native and sidecar records without dropping work metadata', () => {
    const native = highlight({ id: 'pdf:24', annotationId: '24', note: 'native note' });
    const sidecar = highlight({
      id: 'local-highlight',
      documentId: 'document-1',
      workKind: 'try',
      workDoneAt: '2026-08-31T12:00:00.000Z',
    });

    const [merged] = mergeHighlights([native, sidecar]);
    expect(merged).toMatchObject({
      annotationId: '24',
      documentId: 'document-1',
      note: 'native note',
      workKind: 'try',
      workDoneAt: '2026-08-31T12:00:00.000Z',
    });
  });

  test('exports only promoted work highlights as a source-linked evidence brief', () => {
    const markdown = buildPdfEvidenceBriefMarkdown('papers/thermal-study.pdf', [
      highlight({ page: 7, text: 'Ordinary highlight must not be exported.' }),
      highlight({ id: 'finding', page: 12, text: 'The process window narrows at 80 C.', note: '우리 공정 조건도 점검', workKind: 'finding' }),
      highlight({ id: 'verify', page: 18, text: 'Verification source text.', workKind: 'verify' }),
      highlight({ id: 'done', page: 23, text: 'Completed discussion source.', note: '회의에서 확인 완료', workKind: 'discuss', workDoneAt: '2026-08-31T12:00:00.000Z' }),
    ]);

    expect(markdown).toContain('## Findings');
    expect(markdown).toContain('FINDING — 우리 공정 조건도 점검');
    expect(markdown).toContain('## Open Follow-ups');
    expect(markdown).toContain('VERIFY — Verification source text.');
    expect(markdown).toContain('## Completed Follow-ups');
    expect(markdown).toContain('✓ DISCUSS — 회의에서 확인 완료');
    expect(markdown).toContain('[p. 12](/?pdf=papers%2Fthermal-study.pdf&page=12)');
    expect(markdown).not.toContain('Ordinary highlight must not be exported.');
  });

  test('shares the Finding/open/completed selector without turning Finding into a task', () => {
    const groups = selectWorkEvidenceGroups([
      highlight({ id: 'ordinary' }),
      highlight({ id: 'finding', workKind: 'finding' }),
      highlight({ id: 'verify', workKind: 'verify' }),
      highlight({ id: 'done', workKind: 'try', workDoneAt: '2026-09-01T09:00:00.000Z' }),
    ]);

    expect(groups.findings.map((item) => item.id)).toEqual(['finding']);
    expect(groups.openFollowUps.map((item) => item.id)).toEqual(['verify']);
    expect(groups.completedFollowUps.map((item) => item.id)).toEqual(['done']);
  });

  test('derives the compact Library follow-through cue from existing metadata and highlights', () => {
    const summary = deriveReaderSummary({
      page: 37,
      pageOffsetRatio: 0.43,
      viewMode: 'scroll',
      updatedAt: '2026-09-01T09:00:00.000Z',
    }, [
      highlight({ id: 'unclear', type: 'unknown' }),
      highlight({ id: 'resolved', studyKind: 'question', type: 'unknown', resolvedAt: '2026-09-01T09:00:00.000Z' }),
      highlight({ id: 'open', workKind: 'verify' }),
      highlight({ id: 'finding', workKind: 'finding' }),
      highlight({ id: 'done', workKind: 'try', workDoneAt: '2026-09-01T09:00:00.000Z' }),
    ]);

    expect(summary).toEqual({ page: 37, unresolvedCount: 1, openWorkCount: 1 });
  });

  test('keeps last activity as a transient Library cue without altering study counts', () => {
    const summary = deriveReaderSummary(undefined, [], '2026-09-05T09:00:00.000Z');

    expect(summary).toEqual({ unresolvedCount: 0, openWorkCount: 0, lastOpenedAt: '2026-09-05T09:00:00.000Z' });
  });
});
