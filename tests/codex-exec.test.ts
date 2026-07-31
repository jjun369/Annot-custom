import { describe, expect, test } from 'vitest';

import { runCodexStructured } from '@/lib/codex-exec';

describe('structured Codex cancellation', () => {
  test('rejects an already-cancelled request before resolving or spawning Codex', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runCodexStructured({
      prompt: 'unused',
      schema: { type: 'object' },
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
