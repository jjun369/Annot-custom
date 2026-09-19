import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';

let postKnowledge: typeof import('@/app/api/knowledge/route').POST;

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pagedock-knowledge-route-test-'));
  vi.stubEnv('PAGEDOCK_ROOT', root);
  vi.stubEnv('ANNOT_ROOT', root);
  vi.stubEnv('PAGEDOCK_CONFIG_DIR', path.join(root, 'config'));
  ({ POST: postKnowledge } = await import('@/app/api/knowledge/route'));
});

function request(body: unknown): import('next/server').NextRequest {
  return new Request('http://localhost/api/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as import('next/server').NextRequest;
}

describe('Knowledge JSON capture bounds', () => {
  test('accepts a bounded batch and caps source names at the persistence edge', async () => {
    const response = await postKnowledge(request({ notes: [{ text: 'bounded note', sourceName: 'x'.repeat(500) }] }));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.captured[0].sourceName).toHaveLength(300);
  });

  test('rejects too many notes and excessive aggregate text', async () => {
    const tooMany = await postKnowledge(request({ notes: Array.from({ length: 101 }, (_, index) => ({ text: `note-${index}` })) }));
    expect(tooMany.status).toBe(413);
    const aggregate = await postKnowledge(request({ notes: Array.from({ length: 11 }, () => ({ text: 'x'.repeat(100_000) })) }));
    expect(aggregate.status).toBe(413);
  });

  test('rejects a declared oversized body before reading JSON', async () => {
    const response = await postKnowledge(new Request('http://localhost/api/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) },
      body: '{}',
    }) as import('next/server').NextRequest);
    expect(response.status).toBe(413);
  });
});
