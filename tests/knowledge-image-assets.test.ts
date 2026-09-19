import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { beforeAll, describe, expect, test } from 'vitest';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAAXNSR0IArs4c6QAAAARzQklUCAgICHwIZIgAAAARSURBVAiZY/zPwPCfgYGBAQANBQIA/up4ZwAAAABJRU5ErkJggg==',
  'base64',
);

const jpegCanvas = createCanvas(2, 1);
const jpegContext = jpegCanvas.getContext('2d');
jpegContext.fillStyle = '#ff0000';
jpegContext.fillRect(0, 0, 2, 1);
const SYNTHETIC_JPEG = jpegCanvas.toBuffer('image/jpeg');

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

  test('does not merge notes that share text but deliberately point to different valid images', async () => {
    const png = await assets.storeKnowledgeImageAsset(ONE_PIXEL_PNG, 'image/png');
    const alternateBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAAXNSR0IArs4c6QAAAARzQklUCAgICHwIZIgAAAARSURBVAiZY2T4z/CfgYGBAQAMBgIAmhYY5QAAAABJRU5ErkJggg==',
      'base64',
    );
    const alternatePng = await assets.storeKnowledgeImageAsset(alternateBytes, 'image/png');
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

  test('rejects a signature-only or truncated image instead of publishing it', async () => {
    await expect(assets.storeKnowledgeImageAsset(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'))
      .rejects.toThrow(/PNG 또는 JPEG/);
    await expect(assets.storeKnowledgeImageAsset(ONE_PIXEL_PNG.subarray(0, ONE_PIXEL_PNG.length - 8), 'image/png'))
      .rejects.toThrow(/PNG 또는 JPEG/);
    expect((await assets.storeKnowledgeImageAsset(SYNTHETIC_JPEG, 'image/jpeg')).mime).toBe('image/jpeg');
    await expect(assets.storeKnowledgeImageAsset(SYNTHETIC_JPEG.subarray(0, SYNTHETIC_JPEG.length - 2), 'image/jpeg'))
      .rejects.toThrow(/PNG 또는 JPEG/);
  });

  test('publishes one complete file under concurrent same-hash capture', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => (
      assets.storeKnowledgeImageAsset(ONE_PIXEL_PNG, 'image/png')
    )));
    expect(new Set(results.map((item) => item.sha256))).toHaveLength(1);
    expect(await assets.readKnowledgeImageAsset(results[0])).toEqual(ONE_PIXEL_PNG);
    const stored = await readFile(path.join(
      process.env.PAGEDOCK_ROOT!, '.annot', 'knowledge-assets',
      results[0].sha256.slice(0, 2), `${results[0].sha256}.png`,
    ));
    expect(stored).toEqual(ONE_PIXEL_PNG);
  });
});
