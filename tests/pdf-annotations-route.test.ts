import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixtures = vi.hoisted(() => ({
  listPdfAnnotations: vi.fn(),
  savePdfAnnotations: vi.fn(),
  listSidecarHighlights: vi.fn(),
  replaceSidecarHighlights: vi.fn(),
  upsertSidecarHighlights: vi.fn(),
}));

vi.mock('@/lib/pdf-annotations', () => ({
  deletePdfAnnotations: vi.fn(),
  listPdfAnnotations: fixtures.listPdfAnnotations,
  savePdfAnnotations: fixtures.savePdfAnnotations,
  updatePdfAnnotations: vi.fn(),
}));
vi.mock('@/lib/highlight-sidecar', () => ({
  deleteSidecarHighlights: vi.fn(),
  listSidecarHighlights: fixtures.listSidecarHighlights,
  replaceSidecarHighlights: fixtures.replaceSidecarHighlights,
  updateSidecarHighlights: vi.fn(),
  upsertSidecarHighlights: fixtures.upsertSidecarHighlights,
}));
vi.mock('@/lib/mobile-bridge', () => ({ markMobileBridgeExportDirtyForPdfPath: vi.fn(async () => undefined) }));

import { GET, POST } from '@/app/api/workspace/annotations/route';

const rect = { x: 0.1, y: 0.2, width: 0.4, height: 0.04 };
const highlight = {
  id: 'synthetic-highlight',
  page: 1,
  type: 'important' as const,
  text: 'Synthetic evidence line',
  note: '',
  position: rect,
  rects: [rect],
};
let sidecarStore: typeof highlight[] = [];

describe('PDF annotation fallback when the optional Python engine is unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidecarStore = [];
    fixtures.listSidecarHighlights.mockImplementation(async () => sidecarStore);
    fixtures.listPdfAnnotations.mockRejectedValue(new Error('Python was not found; run without arguments to install from the Microsoft Store.'));
    fixtures.savePdfAnnotations.mockRejectedValue(new Error('Native PDF annotation write failed: permission denied.'));
    fixtures.upsertSidecarHighlights.mockImplementation(async (_pdfPath, highlights) => {
      sidecarStore = highlights;
      return sidecarStore;
    });
  });

  test('returns a successful empty sidecar-only result instead of a GET 500', async () => {
    const response = await GET(new NextRequest('http://localhost/api/workspace/annotations?path=synthetic-study.pdf'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ highlights: [], embedded: false, partial: true, nativeAnnotationsRead: false });
    expect(body.warning).toEqual(expect.any(String));
  });

  test('returns existing PageDock sidecar highlights without attempting to rewrite them', async () => {
    sidecarStore = [highlight];

    const response = await GET(new NextRequest('http://localhost/api/workspace/annotations?path=synthetic-study.pdf'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ highlights: [expect.objectContaining({ id: 'synthetic-highlight' })], embedded: false, partial: true, nativeAnnotationsRead: false });
    expect(fixtures.listPdfAnnotations).toHaveBeenCalledOnce();
  });

  test('does not turn an ordinary native PDF parse failure into a sidecar-only success', async () => {
    sidecarStore = [highlight];
    fixtures.listPdfAnnotations.mockRejectedValueOnce(new Error('FileDataError: Failed to open file'));

    const response = await GET(new NextRequest('http://localhost/api/workspace/annotations?path=synthetic-study.pdf'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/PDF 원본을 읽지 못했습니다/);
    expect(fixtures.replaceSidecarHighlights).not.toHaveBeenCalled();
  });

  test('does not treat a missing PDF source file as a missing Python executable', async () => {
    fixtures.listPdfAnnotations.mockRejectedValueOnce(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT', path: 'papers/missing.pdf', syscall: 'open' }));

    const response = await GET(new NextRequest('http://localhost/api/workspace/annotations?path=papers/missing.pdf'));

    expect(response.status).toBe(500);
  });

  test('does not hide a sidecar read failure behind native fallback', async () => {
    fixtures.listSidecarHighlights.mockRejectedValueOnce(new Error('EACCES: permission denied'));

    const response = await GET(new NextRequest('http://localhost/api/workspace/annotations?path=synthetic-study.pdf'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/EACCES/);
    expect(fixtures.listPdfAnnotations).not.toHaveBeenCalled();
  });

  test('round-trips a sidecar when native PDF embedding cannot run', async () => {
    const postResponse = await POST(new NextRequest('http://localhost/api/workspace/annotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pdfPath: 'synthetic-study.pdf', highlights: [highlight] }),
    }));
    const postBody = await postResponse.json();

    expect(postResponse.status).toBe(200);
    expect(postBody).toMatchObject({ highlights: [expect.objectContaining({ id: 'synthetic-highlight' })], embedded: false });
    expect(postBody.warning).toContain('permission denied');
    expect(fixtures.upsertSidecarHighlights).toHaveBeenCalledWith('synthetic-study.pdf', [expect.objectContaining({ id: 'synthetic-highlight' })]);

    const getResponse = await GET(new NextRequest('http://localhost/api/workspace/annotations?path=synthetic-study.pdf'));
    const getBody = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getBody).toMatchObject({ highlights: [expect.objectContaining({ id: 'synthetic-highlight' })], partial: true, nativeAnnotationsRead: false });
  });
});
