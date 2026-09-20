import { describe, expect, test } from 'vitest';

import {
  getResearchSearchEmptyHint,
  matchesResearchSearch,
  PUBLIC_PDF_IMPORT_CONFIRMATION,
  RESEARCH_DISCOVERY_GUIDANCE,
} from '@/lib/research-discovery';

describe('lawful Research paper discovery guidance', () => {
  test('points readers to metadata discovery and lawful open-copy routes', () => {
    expect(RESEARCH_DISCOVERY_GUIDANCE.body).toContain('Crossref');
    expect(RESEARCH_DISCOVERY_GUIDANCE.body).toContain('OpenAlex');
    expect(RESEARCH_DISCOVERY_GUIDANCE.body).toContain('Unpaywall');
    expect(RESEARCH_DISCOVERY_GUIDANCE.body).toContain('저자 저장소');
    expect(RESEARCH_DISCOVERY_GUIDANCE.body).toContain('기관 도서관');
    expect(RESEARCH_DISCOVERY_GUIDANCE.approval).toContain('승인');
    expect(RESEARCH_DISCOVERY_GUIDANCE.unofficial).toContain('Sci-Hub');
    expect(RESEARCH_DISCOVERY_GUIDANCE.unofficial).toContain('유료 접근 우회');
    expect(RESEARCH_DISCOVERY_GUIDANCE.unofficial).toContain('지원하거나 추천하지 않습니다');
    expect(PUBLIC_PDF_IMPORT_CONFIRMATION.title).toBe('공개 PDF 가져오기');
    expect(PUBLIC_PDF_IMPORT_CONFIRMATION.message).toContain('이용 조건');
  });

  test('gives a source-aware next action when online search is empty', () => {
    expect(getResearchSearchEmptyHint('unpaywall')).toContain('DOI');
    expect(getResearchSearchEmptyHint('crossref')).toContain('Unpaywall');
    expect(getResearchSearchEmptyHint('local')).toContain('내 자료');
  });

  test('matches results only to the exact submitted provider and trimmed query', () => {
    const submitted = { source: 'local', query: 'image sensor' };
    expect(matchesResearchSearch(submitted, 'local', '  image sensor  ')).toBe(true);
    expect(matchesResearchSearch(submitted, 'local', 'image sensors')).toBe(false);
    expect(matchesResearchSearch(submitted, 'crossref', 'image sensor')).toBe(false);
    expect(matchesResearchSearch(null, 'local', 'image sensor')).toBe(false);
  });
});
