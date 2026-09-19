import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const SYNTHETIC_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAAXNSR0IArs4c6QAAAARzQklUCAgICHwIZIgAAAARSURBVAiZY/zPwPCfgYGBAQANBQIA/up4ZwAAAABJRU5ErkJggg==',
  'base64',
);

let postImageNote: typeof import('@/app/api/knowledge/image-note/route').POST;

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pagedock-image-route-test-'));
  vi.stubEnv('PAGEDOCK_ROOT', root);
  vi.stubEnv('ANNOT_ROOT', root);
  vi.stubEnv('PAGEDOCK_CONFIG_DIR', path.join(root, 'config'));
  ({ POST: postImageNote } = await import('@/app/api/knowledge/image-note/route'));
});

describe('visual Knowledge multipart route', () => {
  test('accepts a bounded multipart image request without requiring Content-Length', async () => {
    const form = new FormData();
    form.set('text', '합성 이미지 설명');
    form.set('image', new File([SYNTHETIC_PNG], 'synthetic.png', { type: 'image/png' }));
    const encoded = new Request('http://localhost/api/knowledge/image-note', { method: 'POST', body: form });
    const response = await postImageNote(new (await import('next/server')).NextRequest(encoded));
    expect(response.status).toBe(201);
  });

  test('rejects a declared oversized body before parsing multipart data', async () => {
    const response = await postImageNote(new (await import('next/server')).NextRequest(
      'http://localhost/api/knowledge/image-note',
      {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=synthetic',
          'content-length': String(11 * 1024 * 1024),
        },
        body: '--synthetic--\r\n',
      },
    ));
    expect(response.status).toBe(413);
  });
});
