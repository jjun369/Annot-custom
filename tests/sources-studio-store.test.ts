import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  root: '',
  nextNoteId: 0,
  captureFailures: 0,
  notes: [] as Array<Record<string, unknown>>,
  capture: vi.fn(async (inputs: Array<{ text: string; sourceName: string }>) => {
    if (mocks.captureFailures > 0) {
      mocks.captureFailures -= 1;
      throw new Error('synthetic capture interruption');
    }
    const captured: Array<Record<string, unknown>> = [];
    const duplicates: Array<{ existingNoteId: string }> = [];
    for (const input of inputs) {
      const existing = mocks.notes.find((note) => note.rawText === input.text);
      if (existing) {
        duplicates.push({ existingNoteId: String(existing.id) });
        continue;
      }
      const note = {
        id: `synthetic-note-${++mocks.nextNoteId}`,
        rawText: input.text,
        sourceName: input.sourceName,
        title: input.text.split(/\r?\n/, 1)[0],
        updatedAt: '2026-10-01T00:00:00.000Z',
      };
      mocks.notes.push(note);
      captured.push(note);
    }
    return { captured, duplicates };
  }),
}));

vi.mock('@/lib/annot-sessions', () => ({ getWorkspaceRoot: () => mocks.root }));
vi.mock('@/lib/research-db', () => ({ listDocuments: vi.fn(async () => []) }));
vi.mock('@/lib/knowledge-store', () => ({
  captureKnowledgeNotes: (...args: Parameters<typeof mocks.capture>) => mocks.capture(...args),
  getKnowledgeSnapshot: vi.fn(async () => ({ version: 2, notes: mocks.notes, topics: [], reviews: [], conflicts: [] })),
}));

let studio: typeof import('@/lib/sources-studio');
let fixtureRoot = '';

beforeEach(async () => {
  vi.resetModules();
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-studio-store-test-'));
  mocks.root = fixtureRoot;
  mocks.nextNoteId = 0;
  mocks.captureFailures = 0;
  mocks.notes.length = 0;
  mocks.capture.mockClear();
  studio = await import('@/lib/sources-studio');
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('Sources/Studio persistence', () => {
  test('persists a memo and reloads its Studio metadata from a fresh module instance', async () => {
    const created = await studio.createStudioMemo({ title: 'Synthetic memo', text: 'Only synthetic fixture text.', tags: ['test'] });
    expect(created).toMatchObject({ origin: 'knowledge', kind: 'memo', title: 'Synthetic memo', tags: ['test'], ownsText: true });

    vi.resetModules();
    studio = await import('@/lib/sources-studio');
    const reloaded = await studio.getStudioSnapshot();
    expect(reloaded.sources).toContainEqual(expect.objectContaining({
      id: created.id,
      title: 'Synthetic memo',
      text: 'Only synthetic fixture text.',
      tags: ['test'],
    }));
  });

  test('saves capture-time classifications while keeping memo and clip defaults', async () => {
    const defaultMemo = await studio.createStudioMemo({ title: 'Default memo', text: 'Default memo fixture.' });
    const classifiedMemo = await studio.createStudioMemo({ title: 'Patent note', kind: 'patent', text: 'Classified memo fixture.' });
    const defaultClip = await studio.createStudioClip({ title: 'Default clip', text: 'Default clip fixture.' });
    const classifiedClip = await studio.createStudioClip({ title: 'Paper clip', kind: 'paper', text: 'Classified clip fixture.' });
    expect([defaultMemo.kind, classifiedMemo.kind, defaultClip.kind, classifiedClip.kind]).toEqual(['memo', 'patent', 'web_clip', 'paper']);
  });

  test('rejects a concurrently stale metadata edit instead of letting the later stale write win', async () => {
    const created = await studio.createStudioMemo({ title: 'Concurrent memo', text: 'Synthetic concurrency fixture.' });
    const results = await Promise.allSettled([
      studio.updateStudioSource({ id: created.id, expectedUpdatedAt: created.updatedAt, title: 'First edit' }),
      studio.updateStudioSource({ id: created.id, expectedUpdatedAt: created.updatedAt, title: 'Stale edit' }),
    ]);
    const saved = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof studio.updateStudioSource>>> => result.status === 'fulfilled');
    expect(saved).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(studio.getStudioSnapshot()).resolves.toMatchObject({
      sources: [expect.objectContaining({ id: created.id, title: saved[0].value.title })],
    });
  });

  test('persists draft edits and rejects a stale revision without overwriting the current draft', async () => {
    const draft = await studio.createStudioDraft();
    const saved = await studio.saveStudioDraft({
      id: draft.id, expectedRevision: draft.revision, title: 'Synthetic draft', text: 'Saved synthetic body.', references: [],
    });
    expect(saved.revision).toBe(draft.revision + 1);
    await expect(studio.saveStudioDraft({
      id: draft.id, expectedRevision: draft.revision, title: 'Stale edit', text: 'Must not win.', references: [],
    })).rejects.toThrow(/갱신/);

    vi.resetModules();
    studio = await import('@/lib/sources-studio');
    await expect(studio.getStudioSnapshot()).resolves.toMatchObject({
      drafts: [expect.objectContaining({ id: draft.id, revision: saved.revision, title: 'Synthetic draft', text: 'Saved synthetic body.' })],
    });
  });

  test('preserves malformed store bytes and rejects a mutation instead of replacing them', async () => {
    const storeFile = path.join(fixtureRoot, '.annot', 'sources-studio.json');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(storeFile), { recursive: true }));
    const original = '{"version":1,"sources":[{"id":"broken","tags":"not-an-array"}],"drafts":[]}';
    await writeFile(storeFile, original, 'utf8');

    await expect(studio.createStudioDraft()).rejects.toThrow(/원본 파일은 보존/);
    expect(await readFile(storeFile, 'utf8')).toBe(original);
  });

  test('keeps an interrupted memo capture recoverable and reconciles it on the next load', async () => {
    mocks.captureFailures = 1;
    const pending = await studio.createStudioMemo({ title: 'Recoverable synthetic memo', text: 'Durable pending fixture.' });
    expect(pending.metadataWarning).toContain('복구');
    expect(pending.text).toBe('Durable pending fixture.');

    const reloaded = await studio.getStudioSnapshot();
    expect(reloaded.warnings).toEqual([]);
    expect(reloaded.sources).toContainEqual(expect.objectContaining({
      title: 'Recoverable synthetic memo',
      text: 'Durable pending fixture.',
      originLabel: expect.not.stringContaining('복구 대기'),
    }));
  });
});
