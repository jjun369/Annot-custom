import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

let root = '';
let original = '';
let store: typeof import('@/lib/knowledge-store');

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pagedock-knowledge-migration-'));
  process.env.PAGEDOCK_ROOT = root;
  process.env.ANNOT_ROOT = root;
  const annot = path.join(root, '.annot');
  await mkdir(annot, { recursive: true });
  original = JSON.stringify({
    version: 1,
    notes: [{
      id: 'legacy-note',
      rawText: '원본 v1 메모',
      title: '원본',
      summary: '',
      status: 'inbox',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }],
    topics: [],
    reviews: [],
  }, null, 2);
  await writeFile(path.join(annot, 'knowledge-store.json'), original, 'utf8');
  store = await import('@/lib/knowledge-store');
});

describe('knowledge v1 migration rollback', () => {
  test('keeps v1 unchanged on read and makes a verified backup before the first v2 write', async () => {
    const beforeMutation = await store.getKnowledgeSnapshot();
    expect(beforeMutation.version).toBe(2);
    expect(await readFile(path.join(root, '.annot', 'knowledge-store.json'), 'utf8')).toBe(original);

    await store.captureKnowledgeNote('v2 전환을 일으키는 새 메모');

    const names = await readdir(path.join(root, '.annot'));
    const backupName = names.find((name) => /^knowledge-store\.v1-backup-[a-f0-9]{12}\.json$/.test(name));
    expect(backupName).toBeTruthy();
    expect(await readFile(path.join(root, '.annot', backupName!), 'utf8')).toBe(original);
    const migrated = JSON.parse(await readFile(path.join(root, '.annot', 'knowledge-store.json'), 'utf8')) as { version: number };
    expect(migrated.version).toBe(2);
  });
});
