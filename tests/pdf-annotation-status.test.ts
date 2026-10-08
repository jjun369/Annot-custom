import { describe, expect, test } from 'vitest';

import { getPdfAnnotationReadNotice } from '@/lib/pdf-annotation-status';

describe('Reader partial PDF annotation status', () => {
  test('projects a missing native-annotation read as a calm, actionable notice', () => {
    expect(getPdfAnnotationReadNotice({
      highlights: [],
      embedded: false,
      partial: true,
      nativeAnnotationsRead: false,
      warning: 'Python execution unavailable',
    })).toBe('앱에 저장한 기록을 표시하고 있어요. PDF 안의 표시는 PDF 도구를 준비한 뒤 확인할 수 있어요.');
  });

  test('does not show a partial-read notice when native annotations were read', () => {
    expect(getPdfAnnotationReadNotice({ partial: false, nativeAnnotationsRead: true })).toBeNull();
  });

  test('uses the explicit nativeAnnotationsRead flag without depending on warning text or other flags', () => {
    expect(getPdfAnnotationReadNotice({ nativeAnnotationsRead: false })).toContain('PDF 안의 표시는');
  });

  test('does not mislabel unrelated successful responses as partial annotation reads', () => {
    expect(getPdfAnnotationReadNotice({ partial: true, nativeAnnotationsRead: true })).toBeNull();
    expect(getPdfAnnotationReadNotice({ partial: true })).toBeNull();
    expect(getPdfAnnotationReadNotice(null)).toBeNull();
  });
});
