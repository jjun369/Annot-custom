import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { shouldSubmitChatOnEnter } from '@/lib/chat-keyboard';

const enter = (overrides: Record<string, unknown> = {}) => ({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  ...overrides,
});

describe('chat keyboard handling', () => {
  test('submits only on a plain initial Enter', () => {
    expect(shouldSubmitChatOnEnter(enter())).toBe(true);
    expect(shouldSubmitChatOnEnter(enter({ key: 'a' }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ repeat: true }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ shiftKey: true }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ ctrlKey: true }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ altKey: true }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ metaKey: true }))).toBe(false);
  });

  test('does not submit while a Korean IME owns the Enter keydown', () => {
    expect(shouldSubmitChatOnEnter(enter({ isComposing: true }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ nativeEvent: { isComposing: true } }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ keyCode: 229 }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ which: 229 }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ nativeEvent: { keyCode: 229 } }))).toBe(false);
    expect(shouldSubmitChatOnEnter(enter({ nativeEvent: { which: 229 } }))).toBe(false);
  });

  test('keeps the shared policy wired into both chat composers', () => {
    for (const path of [
      new URL('../src/components/workspace/ChatPanel.tsx', import.meta.url),
      new URL('../src/components/sidechat/SideChatWindow.tsx', import.meta.url),
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain("import { shouldSubmitChatOnEnter } from '@/lib/chat-keyboard';");
      expect(source).toContain('shouldSubmitChatOnEnter(');
    }
  });
});
