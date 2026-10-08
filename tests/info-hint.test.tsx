import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { InfoHint } from '@/components/common/InfoHint';

describe('InfoHint', () => {
  test('renders a labelled, keyboard-focusable disclosure trigger without exposing detail by default', () => {
    const html = renderToStaticMarkup(createElement(InfoHint, { label: '선택 자료 안내', text: '선택 자료는 요청에만 사용됩니다.' }));
    expect(html).toContain('aria-label="선택 자료 안내"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-controls=');
    expect(html).not.toContain('aria-describedby=');
    expect(html).not.toContain('선택 자료는 요청에만 사용됩니다.');
    expect(html).toContain('type="button"');
  });
});
