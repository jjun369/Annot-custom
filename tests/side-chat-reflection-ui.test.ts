import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { hasReflectionSaveConflict } from '@/components/sidechat/SideChatReflectionEditor';

const comparisonSource = readFileSync(new URL('../src/components/sidechat/SideChatComparisonDialog.tsx', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../src/components/sidechat/SideChatReflectionEditor.tsx', import.meta.url), 'utf8');

describe('side-chat reflection UI safeguards', () => {
  test('detects a dirty draft against newer canonical text', () => {
    expect(hasReflectionSaveConflict('old canonical', 'old canonical', 'local draft')).toBe(false);
    expect(hasReflectionSaveConflict('old canonical', 'old canonical', 'old canonical')).toBe(false);
    expect(hasReflectionSaveConflict('new canonical', 'old canonical', 'local draft')).toBe(true);
  });

  test('uses the live question record and routes every comparison exit through the close guard', () => {
    expect(comparisonSource).toContain('const canonicalQuestion = messages.find((message) => message.id === question.id) || question;');
    expect(comparisonSource).toContain('onStateChange={onReflectionStateChange}');
    expect(comparisonSource).toContain("window.confirm('저장하지 않은 내 이해가 있습니다. 저장하지 않고 닫을까요?')");
    expect(comparisonSource).toContain('if (e.key === \'Escape\') { e.preventDefault(); closeRef.current(); }');
    expect(comparisonSource).toContain('if (e.target === e.currentTarget) close();');
    expect(comparisonSource).toContain('<button onClick={close}>닫기</button>');
    expect(comparisonSource).toContain('onClick={() => handleSource(option.source)}');
    expect(comparisonSource).toContain('onClick={() => handleSource(canonicalQuestion)}');
  });

  test('reports local dirty and saving state without adding independent draft storage', () => {
    expect(editorSource).toContain('onStateChange?: (state: { dirty: boolean; saving: boolean }) => void;');
    expect(editorSource).toContain('{ dirty: draft !== savedText, saving }');
    expect(editorSource).toContain('const savingRef = useRef(false);');
    expect(editorSource).toContain('savingRef.current = true;');
    expect(editorSource).toContain('REFLECTION_CONFLICT_MESSAGE');
    expect(editorSource).not.toContain('localStorage');
  });
});
