import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  snapshot: { drafts: [] as unknown[], sources: [] as unknown[], warnings: [] as string[] },
  baseCurrent: true,
  runTurn: vi.fn(async (input: { prompt: string }) => ({ content: `Mock response for ${input.prompt.length} prompt characters.` })),
}));

vi.mock('@/lib/sources-studio', () => ({
  getStudioSnapshot: async () => mocks.snapshot,
  isStudioProposalBaseCurrent: () => mocks.baseCurrent,
  validateStudioProposalBase: async () => mocks.baseCurrent,
}));

vi.mock('@/lib/ai-providers', () => ({
  getProviderRuntime: () => ({ runTurn: mocks.runTurn }),
}));
vi.mock('@/lib/annot-sessions', () => ({ getWorkspaceRoot: () => '' }));
vi.mock('@/lib/research-db', () => ({ listDocuments: async () => [] }));
vi.mock('@/lib/knowledge-store', () => ({
  getKnowledgeSnapshot: async () => ({ notes: [], topics: [], reviews: [], conflicts: [] }),
  captureKnowledgeNotes: async () => ({ captured: [], duplicates: [] }),
}));

import { POST } from '@/app/api/sources-studio/proposal/route';
import { shouldCloseStudioEscape } from '@/lib/sources-studio-shared';

describe('Sources/Studio IME-safe Escape', () => {
  test('does not treat composition Escape as a close command', () => {
    expect(shouldCloseStudioEscape({ key: 'Escape', isComposing: true, keyCode: 27 })).toBe(false);
    expect(shouldCloseStudioEscape({ key: 'Escape', isComposing: false, keyCode: 229 })).toBe(false);
    expect(shouldCloseStudioEscape({ key: 'Escape', isComposing: false, keyCode: 27 })).toBe(true);
  });
});

function reference(sourceId: string, title: string, excerpt: string) {
  return {
    sourceId, title, kind: 'memo' as const, originLabel: 'Synthetic memo',
    sourceUpdatedAt: '2026-10-01T00:00:00.000Z', excerpt, includeInRequest: true,
  };
}

function source(id: string, title: string, text: string) {
  return {
    id, origin: 'knowledge' as const, recordId: id.slice('knowledge:'.length), kind: 'memo' as const,
    title, originalText: text, text, tags: [], originLabel: 'Synthetic memo',
    sourceUpdatedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ownsText: true,
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/sources-studio/proposal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  mocks.snapshot = { drafts: [], sources: [], warnings: [] };
  mocks.baseCurrent = true;
  mocks.runTurn.mockReset().mockResolvedValue({ content: 'Mock replacement body.' });
});

afterEach(() => vi.clearAllMocks());

describe('Sources/Studio proposal boundary', () => {
  test('accepts only an unchanged draft and selected source snapshot', async () => {
    const store = await vi.importActual<typeof import('@/lib/sources-studio')>('@/lib/sources-studio');
    const selected = reference('knowledge:first', 'First synthetic memo', 'original text');
    const draft = {
      id: 'draft-1', revision: 2, title: 'Draft', text: 'Draft body', references: [selected],
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const currentSource = source(selected.sourceId, selected.title, selected.excerpt);
    const base = {
      draft, sources: [currentSource], expectedRevision: 2, expectedTitle: 'Draft',
      expectedText: 'Draft body', expectedReferences: [selected], selectedSourceIds: [selected.sourceId],
    };

    expect(store.isStudioProposalBaseCurrent(base)).toBe(true);
    expect(store.isStudioProposalBaseCurrent({ ...base, sources: [source(selected.sourceId, selected.title, 'changed text')] })).toBe(false);
    expect(store.isStudioProposalBaseCurrent({ ...base, draft: { ...draft, revision: 3 } })).toBe(false);
  });

  test('sends only saved references explicitly selected for this request', async () => {
    const first = reference('knowledge:first', 'First synthetic memo', 'first-only source text');
    const second = reference('knowledge:second', 'Second synthetic memo', 'must not be sent');
    mocks.snapshot = {
      drafts: [{ id: 'draft-1', revision: 2, title: 'Draft', text: 'Draft body', references: [first, second] }],
      sources: [source(first.sourceId, first.title, first.excerpt), source(second.sourceId, second.title, second.excerpt)],
      warnings: [],
    };

    const response = await POST(request({
      draftId: 'draft-1', expectedRevision: 2, instruction: 'Revise briefly.',
      referenceIds: [first.sourceId], provider: 'codex',
    }));

    expect(response.status).toBe(200);
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    const prompt = mocks.runTurn.mock.calls[0][0].prompt;
    expect(prompt).toContain('first-only source text');
    expect(prompt).not.toContain('must not be sent');
  });

  test('discards a provider response when the persisted proposal base changed in flight', async () => {
    mocks.snapshot = {
      drafts: [{ id: 'draft-1', revision: 2, title: 'Draft', text: 'Draft body', references: [] }],
      sources: [], warnings: [],
    };
    mocks.baseCurrent = false;

    const response = await POST(request({
      draftId: 'draft-1', expectedRevision: 2, instruction: 'Revise briefly.',
      referenceIds: [], provider: 'codex',
    }));
    const body = await response.json() as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain('바뀌었습니다');
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
  });

  test('refuses stale selected-source validation before applying a proposal', async () => {
    const selected = reference('knowledge:first', 'First synthetic memo', 'original text');
    mocks.snapshot = {
      drafts: [{ id: 'draft-1', revision: 2, title: 'Draft', text: 'Draft body', references: [selected] }],
      sources: [source(selected.sourceId, selected.title, 'changed source text')], warnings: [],
    };
    mocks.baseCurrent = false;

    const response = await POST(request({
      validateOnly: true, draftId: 'draft-1', expectedRevision: 2,
      expectedTitle: 'Draft', expectedText: 'Draft body', expectedReferences: [selected],
      referenceIds: [selected.sourceId],
    }));

    expect(response.status).toBe(409);
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });
});
