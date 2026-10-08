import { describe, expect, test } from 'vitest';

import { recordOriginForDisplay, recordProvenanceForDisplay, sourceOriginForDisplay } from '@/lib/record-display';

describe('record display labels', () => {
  test('keeps draft review status readable without exposing its internal identity', () => {
    const draft = { id: 'studio-draft:synthetic-id', originLabel: 'Studio 저장 초안 · 로컬 작업물', provenanceLabel: 'Studio 초안 · Knowledge 미게시 · 미검증 · 문헌 근거 아님' };
    expect(recordOriginForDisplay(draft)).toBe('개인 초안 · 이 기기');
    expect(recordProvenanceForDisplay(draft)).toBe('검토 전 · 문헌 근거 아님');
    expect(recordOriginForDisplay(draft)).not.toContain('synthetic-id');
  });

  test('translates internal repository names in ordinary source labels', () => {
    expect(sourceOriginForDisplay('Knowledge 수집 메모')).toBe('지식 보관함 수집 메모');
    expect(sourceOriginForDisplay('Sources 개인 메모')).toBe('자료함 메모');
  });
});
