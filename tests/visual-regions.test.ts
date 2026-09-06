import { describe, expect, test } from 'vitest';

import {
  compareVisualRegionsBySource,
  createVisualRegion,
  getVisualRegionKindLabel,
  normalizeVisualRegion,
  normalizeVisualRegionRect,
  updateVisualRegion,
} from '@/lib/visual-regions';

const rect = { x: 0.14, y: 0.318, width: 0.521, height: 0.207 };

describe('durable visual regions', () => {
  test('creates a minimal page-relative visual anchor without a crop or path', () => {
    const region = createVisualRegion('region-1', {
      page: 12,
      rect,
      kind: 'table',
      memo: '온도 조건별 dark current 비교',
    }, 'document-1', '2026-09-01T12:00:00.000Z');

    expect(region).toEqual({
      id: 'region-1',
      documentId: 'document-1',
      page: 12,
      rect,
      kind: 'table',
      memo: '온도 조건별 dark current 비교',
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
    });
    expect(JSON.stringify(region)).not.toContain('pdfPath');
    expect(JSON.stringify(region)).not.toContain('thumbnail');
  });

  test('rejects malformed page rectangles instead of pointing at a different visual', () => {
    expect(normalizeVisualRegionRect({ x: 0, y: 0, width: 0.2, height: 0.2 })).toEqual({ x: 0, y: 0, width: 0.2, height: 0.2 });
    expect(normalizeVisualRegionRect({ x: -0.1, y: 0, width: 0.2, height: 0.2 })).toBeNull();
    expect(normalizeVisualRegionRect({ x: 0, y: -0.1, width: 0.2, height: 0.2 })).toBeNull();
    expect(normalizeVisualRegionRect({ x: 0, y: 0, width: 0, height: 0.2 })).toBeNull();
    expect(normalizeVisualRegionRect({ x: 0, y: 0, width: 0.2, height: 0 })).toBeNull();
    expect(normalizeVisualRegionRect({ x: 0.9, y: 0, width: 0.2, height: 0.1 })).toBeNull();
    expect(normalizeVisualRegionRect({ x: Number.NaN, y: 0, width: 0.2, height: 0.1 })).toBeNull();
    expect(normalizeVisualRegionRect({ x: 0, y: Infinity, width: 0.2, height: 0.1 })).toBeNull();
  });

  test('keeps only a tiny floating point edge correction', () => {
    expect(normalizeVisualRegionRect({ x: 0.8, y: 0.7, width: 0.2000000005, height: 0.3000000005 }))
      .toEqual({ x: 0.8, y: 0.7, width: 0.19999999999999996, height: 0.30000000000000004 });
  });

  test('ignores malformed persisted records and preserves valid Korean memos', () => {
    expect(normalizeVisualRegion({
      id: 'region-1', documentId: 'wrong-document', page: 4, rect, kind: 'figure', memo: '공정 흐름을 다시 확인',
      createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:01:00.000Z',
    }, 'document-1')).toMatchObject({ documentId: 'document-1', memo: '공정 흐름을 다시 확인' });
    expect(normalizeVisualRegion({ id: 'bad', page: 4, rect, kind: 'not-a-kind', memo: '' })).toBeNull();
  });

  test('updates only editable metadata and keeps source identity stable', () => {
    const region = createVisualRegion('region-1', { page: 8, rect, kind: 'equation', memo: '' }, 'document-1', '2026-09-01T12:00:00.000Z')!;
    const updated = updateVisualRegion(region, { kind: 'process_condition', memo: '전류 밀도 조건' }, '2026-09-01T13:00:00.000Z');
    expect(updated).toMatchObject({
      documentId: 'document-1', page: 8, rect, kind: 'process_condition', memo: '전류 밀도 조건',
      createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T13:00:00.000Z',
    });
  });

  test('orders visual records by page and source position', () => {
    const make = (id: string, page: number, x: number, y: number) => createVisualRegion(id, {
      page, rect: { x, y, width: 0.1, height: 0.1 }, kind: 'custom', memo: '',
    }, 'document-1')!;
    expect([make('later', 3, 0.1, 0.1), make('right', 2, 0.6, 0.2), make('left', 2, 0.1, 0.2)]
      .sort(compareVisualRegionsBySource).map((region) => region.id))
      .toEqual(['left', 'right', 'later']);
    expect(getVisualRegionKindLabel('process_condition')).toBe('공정 조건');
  });
});
