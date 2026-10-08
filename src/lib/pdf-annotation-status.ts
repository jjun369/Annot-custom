export function getPdfAnnotationReadNotice(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;

  const response = result as { nativeAnnotationsRead?: unknown };
  if (response.nativeAnnotationsRead !== false) return null;

  return '앱에 저장한 기록을 표시하고 있어요. PDF 안의 표시는 PDF 도구를 준비한 뒤 확인할 수 있어요.';
}
