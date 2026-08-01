import { describe, expect, test } from 'vitest';

import { GENERAL_HELP, SCREEN_HELP, TROUBLESHOOTING_HELP } from '@/lib/help-content';

describe('static PageDock help content', () => {
  test('covers every app section with screen-specific guidance', () => {
    expect(Object.keys(SCREEN_HELP).sort()).toEqual(['knowledge', 'library', 'research', 'settings']);
    for (const content of Object.values(SCREEN_HELP)) {
      expect(content.title.length).toBeGreaterThan(0);
      expect(content.groups.length).toBeGreaterThanOrEqual(2);
      expect(content.groups.flatMap((group) => group.items).length).toBeGreaterThanOrEqual(5);
    }
  });

  test('includes global guide and recovery guidance', () => {
    expect(GENERAL_HELP.map((group) => group.title)).toContain('AI 사용 원칙');
    expect(TROUBLESHOOTING_HELP.map((group) => group.title)).toContain('백업·복원');
  });
});
