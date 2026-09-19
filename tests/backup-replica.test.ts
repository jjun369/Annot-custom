import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let libraryRoot: string;
let configRoot: string;
let replicaRoot: string;
let secondReplicaRoot: string;
let replica: typeof import('@/lib/backup-replica');

beforeAll(async () => {
  libraryRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-replica-library-'));
  configRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-replica-config-'));
  replicaRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-replica-target-'));
  secondReplicaRoot = await mkdtemp(path.join(tmpdir(), 'pagedock-replica-target-second-'));
  process.env.PAGEDOCK_ROOT = libraryRoot;
  process.env.ANNOT_ROOT = libraryRoot;
  process.env.PAGEDOCK_CONFIG_DIR = configRoot;
  replica = await import('@/lib/backup-replica');
});

afterAll(async () => {
  await Promise.all([
    rm(libraryRoot, { recursive: true, force: true }),
    rm(configRoot, { recursive: true, force: true }),
    rm(replicaRoot, { recursive: true, force: true }),
    rm(secondReplicaRoot, { recursive: true, force: true }),
  ]);
});

describe('NAS safety snapshot replica', () => {
  test('defaults to an unconfigured, opt-in target and rejects the live Library', async () => {
    expect(await replica.getBackupReplicaInfo()).toMatchObject({
      targetRoot: undefined,
      automaticEnabled: false,
      automaticRetention: 14,
      status: 'not-configured',
    });
    await expect(replica.updateBackupReplicaSettings({ targetRoot: libraryRoot })).rejects.toThrow(/Library와 분리/);
  });

  test('copies a local archive only after a byte-for-byte check and records a device-local receipt', async () => {
    const source = path.join(libraryRoot, 'fixture-auto.zip');
    const fileName = 'pagedock-auto-20260913-120000-000.zip';
    const bytes = Buffer.from('locally verified PageDock portable backup fixture');
    await writeFile(source, bytes);
    await replica.updateBackupReplicaSettings({ targetRoot: replicaRoot, automaticEnabled: true });

    const copied = await replica.copyAutomaticBackupToReplica(source, fileName);
    expect(copied.copied).toBe(true);
    expect(copied.destination).toBe(path.join(replicaRoot, 'PageDock-Backups', 'Auto', fileName));
    expect(await readFile(copied.destination!)).toEqual(bytes);
    expect((await replica.getBackupReplicaInfo()).lastAutomaticArtifact).toMatchObject({
      fileName,
      size: bytes.byteLength,
    });
    expect((await readdir(path.join(replicaRoot, 'PageDock-Backups', 'Auto'))).some((name) => name.endsWith('.partial'))).toBe(false);
  });

  test('does not overwrite a different same-name archive and permits an explicit one-time copy while automatic mode is off', async () => {
    const source = path.join(libraryRoot, 'fixture-second-auto.zip');
    const fileName = 'pagedock-auto-20260913-120001-000.zip';
    const originalDestination = path.join(replicaRoot, 'PageDock-Backups', 'Auto', fileName);
    await mkdir(path.dirname(originalDestination), { recursive: true });
    await writeFile(originalDestination, Buffer.from('an older archive with the same name'));
    await writeFile(source, Buffer.from('a new locally verified archive'));
    await replica.updateBackupReplicaSettings({ automaticEnabled: false });

    const skipped = await replica.copyAutomaticBackupToReplica(source, fileName);
    expect(skipped.copied).toBe(false);
    const copied = await replica.copyAutomaticBackupToReplica(source, fileName, { force: true });
    expect(copied.copied).toBe(true);
    expect(copied.destination).not.toBe(originalDestination);
    expect(await readFile(originalDestination, 'utf8')).toBe('an older archive with the same name');
    expect(await readFile(copied.destination!, 'utf8')).toBe('a new locally verified archive');
  });

  test('clears target-specific status when the normalized replica target changes', async () => {
    expect((await replica.getBackupReplicaInfo()).lastAutomaticArtifact).toBeTruthy();
    const updated = await replica.updateBackupReplicaSettings({ targetRoot: secondReplicaRoot });
    expect(updated.lastAutomaticArtifact).toBeUndefined();
    expect(updated.lastFailureAt).toBeUndefined();
    expect((await replica.getBackupReplicaInfo()).status).toBe('manual-only');
    await replica.updateBackupReplicaSettings({ targetRoot: replicaRoot });
  });

  test('prunes only old automatic ZIPs in the replica folder', async () => {
    const autoDirectory = path.join(replicaRoot, 'PageDock-Backups', 'Auto');
    for (const suffix of ['010101', '010102', '010103', '010104']) {
      await writeFile(path.join(autoDirectory, `pagedock-auto-20260914-${suffix}.zip`), suffix);
    }
    await replica.pruneReplicaAutomaticBackups(3);
    const backups = (await readdir(autoDirectory)).filter((name) => name.endsWith('.zip')).sort();
    expect(backups).toEqual(expect.arrayContaining([
      'pagedock-auto-20260914-010102.zip',
      'pagedock-auto-20260914-010103.zip',
      'pagedock-auto-20260914-010104.zip',
    ]));
    expect(backups).not.toContain('pagedock-auto-20260914-010101.zip');
  });
});
