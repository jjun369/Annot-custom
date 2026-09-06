import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let fixtureRoot: string;
let sessions: typeof import('@/lib/annot-sessions');

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pagedock-session-move-fixture-'));
  process.env.PAGEDOCK_ROOT = fixtureRoot;
  sessions = await import('@/lib/annot-sessions');
});

afterAll(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe('session move and lock safety', () => {
  it('keeps the source when publishing the destination fails', async () => {
    await fs.mkdir(path.join(fixtureRoot, 'source'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'source', 'paper.pdf'), '%PDF-move-fixture');
    const session = await sessions.createSession('source', 'Move', {
      sessionKind: 'pdf',
      pdfPath: 'source/paper.pdf',
      documentId: 'doc-move',
    });
    const originalRename = fs.rename;
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith(path.join('destination', '.annot', 'sessions.json'))) {
        throw new Error('synthetic destination publish failure');
      }
      return originalRename(from, to);
    });

    await expect(sessions.movePdfSessions('source', 'destination', 'source/paper.pdf', 'destination/paper.pdf'))
      .rejects.toThrow('synthetic destination publish failure');
    renameSpy.mockRestore();

    expect((await sessions.getSession('source', session.id))?.pdfPath).toBe(path.normalize('source/paper.pdf'));
    expect(await sessions.listSessions('destination')).toEqual([]);
  });

  it('does not steal a stale-looking lock owned by a live process and times out', async () => {
    await fs.mkdir(path.join(fixtureRoot, 'locked'), { recursive: true });
    const lockPath = path.join(fixtureRoot, 'locked', '.annot', 'sessions.json.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({ ownerToken: 'live-owner', pid: process.pid, acquiredAt: new Date(0).toISOString() }));
    await fs.utimes(lockPath, new Date(0), new Date(0));

    await expect(sessions.listSessions('locked')).rejects.toThrow('Timed out waiting for session lock');
    expect(await fs.readFile(lockPath, 'utf8')).toContain('live-owner');
    await fs.rm(lockPath, { force: true });
  });
});
