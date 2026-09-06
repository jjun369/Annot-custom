import { describe, expect, test } from 'vitest';
import {
  PDF_HIGHLIGHT_SAVE_DEFERRED,
  PDF_TEXT_ANALYSIS_UNAVAILABLE,
  PDF_TRANSLATION_FAILED,
} from '@/lib/pdf-user-messages';
import { hasPdfDescendant } from '@/lib/tree-utils';

describe('reader trust messages', () => {
  test('keeps raw dependency diagnostics out of user-facing reader copy', () => {
    const rawDependencyFailure = 'Python was not found; run without arguments to install from the Microsoft Store at C:\\Users\\admin\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe';

    for (const message of [
      PDF_TEXT_ANALYSIS_UNAVAILABLE,
      PDF_HIGHLIGHT_SAVE_DEFERRED,
      PDF_TRANSLATION_FAILED,
    ]) {
      expect(message).not.toContain('Python was not found');
      expect(message).not.toContain('Microsoft Store');
      expect(message).not.toContain('C:\\Users\\admin');
      expect(message).not.toContain(rawDependencyFailure);
    }
  });
});

describe('library landing state', () => {
  test('recognizes a PDF nested inside a library folder', () => {
    expect(hasPdfDescendant({
      id: 'root',
      name: 'Library',
      type: 'folder',
      path: '',
      children: [{
        id: 'folder',
        name: 'Papers',
        type: 'folder',
        path: 'Papers',
        children: [{ id: 'pdf', name: 'study.pdf', type: 'pdf', path: 'Papers/study.pdf' }],
      }],
    })).toBe(true);
  });

  test('does not treat an empty folder tree as a populated library', () => {
    expect(hasPdfDescendant({ id: 'root', name: 'Library', type: 'folder', path: '', children: [] })).toBe(false);
  });
});
