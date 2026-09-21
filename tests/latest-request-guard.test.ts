import { describe, expect, test } from 'vitest';

import { createLatestRequestGuard } from '@/lib/latest-request-guard';

describe('latest async request guard', () => {
  test('drops a deferred project response that resolves after switching projects', async () => {
    const guard = createLatestRequestGuard<string>();
    const projectARequest = guard.begin('project-a');
    let resolveA!: (value: string) => void;
    const responseA = new Promise<string>((resolve) => { resolveA = resolve; });
    const projectBRequest = guard.begin('project-b');
    let resolveB!: (value: string) => void;
    const responseB = new Promise<string>((resolve) => { resolveB = resolve; });
    const committed: string[] = [];

    resolveB('project-b');
    resolveA('project-a');
    const [projectA, projectB] = await Promise.all([responseA, responseB]);
    if (guard.isCurrent(projectARequest, projectA)) committed.push(projectA);
    if (guard.isCurrent(projectBRequest, projectB)) committed.push(projectB);

    expect(committed).toEqual(['project-b']);
  });

  test('rejects an older detail response after selecting another document', () => {
    const guard = createLatestRequestGuard<string>();
    const documentARequest = guard.begin('document-a');
    const documentBRequest = guard.begin('document-b');

    expect(guard.isCurrent(documentARequest, 'document-a')).toBe(false);
    expect(guard.isCurrent(documentBRequest, 'document-b')).toBe(true);
  });

  test('does not accept a response with a mismatched key', () => {
    const guard = createLatestRequestGuard<string>();
    const request = guard.begin('document-a');

    expect(guard.isCurrent(request, 'document-b')).toBe(false);
  });
});
