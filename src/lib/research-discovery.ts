export const RESEARCH_DISCOVERY_GUIDANCE = {
  title: '논문 찾기 팁',
  body: '제목·DOI는 Crossref와 설정한 OpenAlex에서 확인하고, 합법적인 공개 원문은 Unpaywall·저자 저장소·기관 도서관에서 찾아보세요.',
  approval: 'PageDock은 공개 PDF를 사용자가 승인한 뒤에만 가져옵니다.',
  unofficial: '비공식 유료 접근 우회·미러 경로(예: Sci-Hub)는 PageDock이 지원하거나 추천하지 않습니다. 저작권과 파일 안전성을 확인하고 합법적 경로를 우선하세요.',
} as const;

export const PUBLIC_PDF_IMPORT_CONFIRMATION = {
  title: '공개 PDF 가져오기',
  message: '제공처가 공개 PDF로 표시했지만, 제공처와 이용 조건을 직접 확인한 뒤 라이브러리에 복사하세요. PageDock은 저작권이나 이용 가능 여부를 대신 판단하지 않습니다.',
  confirmLabel: '가져오기',
  cancelLabel: '취소',
} as const;

export function matchesResearchSearch(
  lastSearch: { source: string; query: string } | null,
  source: string,
  query: string,
): boolean {
  return lastSearch?.source === source && lastSearch.query === query.trim();
}

export function getResearchSearchEmptyHint(source: string): string {
  if (source === 'unpaywall') {
    return '정확한 DOI를 입력해 보세요. 공개 원문이 없으면 저자 저장소나 기관 도서관에서도 확인할 수 있습니다.';
  }
  if (source === 'crossref' || source === 'openalex') {
    return '제목 일부나 DOI로 다시 검색해 보세요. 결과를 찾은 뒤 Unpaywall에서 공개 원문 여부를 확인할 수 있습니다.';
  }
  return '다른 제목·DOI·기술어를 입력하거나 내 자료 검색으로 전환해 보세요.';
}
