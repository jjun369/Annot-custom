import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+X1VdNwAAAABJRU5ErkJggg==',
  'base64',
);

let assets: typeof import('@/lib/knowledge-image-assets');
let store: typeof import('@/lib/knowledge-store');

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pagedock-knowledge-image-test-'));
  process.env.PAGEDOCK_ROOT = root;
  process.env.ANNOT_ROOT = root;
  process.env.PAGEDOCK_CONFIG_DIR = path.join(root, 'config');
  assets = await import('@/lib/knowledge-image-assets');
  store = await import('@/lib/knowledge-store');
});

describe('knowledge image assets', () => {
  test('deduplicates a locally verified PNG and keeps its note reference', async () => {
    const [first, second] = await Promise.all([
      assets.storeKnowledgeImageAsset(ONE_PIXEL_PNG, 'image/png'),
      assets.storeKnowledgeImageAsset(ONE_PIXEL_PNG, 'image/png'),
    ]);
    expect(second).toEqual(first);
    expect(await assets.readKnowledgeImageAsset(first)).toEqual(ONE_PIXEL_PNG);

    const result = await store.captureKnowledgeNotes([{
      text: '이 회로도에서 기준 전압의 연결을 다시 확인한다.',
      sourceName: '이미지 메모 · circuit.png',
      attachments: [first],
    }]);
    expect(result.captured).toHaveLength(1);
    expect(result.captured[0].attachments).toEqual([first]);
  });

  test('does not merge notes that share text but deliberately point to different images', async () => {
    const png = await assets.storeKnowledgeImageAsset(ONE_PIXEL_PNG, 'image/png');
    const alternatePng = await assets.storeKnowledgeImageAsset(Buffer.concat([ONE_PIXEL_PNG, Buffer.from([0])]), 'image/png');
    const first = await store.captureKnowledgeNotes([{
      text: '같은 설명이지만 서로 다른 그림이다.',
      sourceName: '첫 그림',
      attachments: [png],
    }]);
    const second = await store.captureKnowledgeNotes([{
      text: '같은 설명이지만 서로 다른 그림이다.',
      sourceName: '둘째 그림',
      attachments: [alternatePng],
    }]);
    expect(first.captured).toHaveLength(1);
    expect(second.captured).toHaveLength(1);
    expect(first.captured[0].contentHash).not.toBe(second.captured[0].contentHash);
  });

  test('rejects unsupported binary data and invalid image references', async () => {
    await expect(assets.storeKnowledgeImageAsset(Buffer.from('not an image'), 'image/png'))
      .rejects.toThrow(/PNG 또는 JPEG/);
    await expect(store.captureKnowledgeNotes([{
      text: '깨진 참조',
      attachments: [{ id: 'bad', sha256: 'bad', mime: 'image/png', byteLength: 1 }],
    }])).rejects.toThrow(/참조/);
  });
});
