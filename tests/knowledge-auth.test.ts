import { describe, expect, test } from 'vitest';

import { isKnowledgeChatGptOAuth } from '@/lib/knowledge-auth';

describe('knowledge OAuth requirement', () => {
  test('accepts only authenticated ChatGPT sessions', () => {
    expect(isKnowledgeChatGptOAuth({ authenticated: true, authMethod: 'ChatGPT' })).toBe(true);
    expect(isKnowledgeChatGptOAuth({ authenticated: true, authMethod: 'API key' })).toBe(false);
    expect(isKnowledgeChatGptOAuth({ authenticated: true, authMethod: 'Codex CLI' })).toBe(false);
    expect(isKnowledgeChatGptOAuth({ authenticated: false, authMethod: 'ChatGPT' })).toBe(false);
  });
});
