import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  AUTOMATIC_BACKUP_RETENTION,
  AUTOMATIC_BACKUP_INTERVAL_MS,
  isAutomaticBackupDue,
} from '@/lib/automatic-backup';

describe('automatic backup scheduling policy', () => {
  test('retains exactly the three most recent automatic snapshots', () => {
    expect(AUTOMATIC_BACKUP_RETENTION).toBe(3);
  });

  test('is due only when no valid timestamp exists or a full day has elapsed', () => {
    const now = 1_800_000_000_000;

    expect(isAutomaticBackupDue(null, now)).toBe(true);
    expect(isAutomaticBackupDue('not-a-time', now)).toBe(true);
    expect(isAutomaticBackupDue(String(now - AUTOMATIC_BACKUP_INTERVAL_MS + 1), now)).toBe(false);
    expect(isAutomaticBackupDue(String(now - AUTOMATIC_BACKUP_INTERVAL_MS), now)).toBe(true);
  });
});

describe('trust lifecycle ownership', () => {
  const readSource = (...segments: string[]) => fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8');

  test('mounts automatic backup once in the application layout, not the library page', () => {
    const layout = readSource('src', 'app', 'layout.tsx');
    const libraryPage = readSource('src', 'app', 'page.tsx');

    expect(layout).toContain('<AutomaticBackupScheduler />');
    expect(libraryPage).not.toContain('LAST_AUTO_BACKUP_KEY');
    expect(libraryPage).not.toContain("fetch('/api/library/backup'");
  });

  test('removes detached-chat popup entry and moving BroadcastChannel context', () => {
    const topbar = readSource('src', 'components', 'layout', 'Topbar.tsx');
    const libraryPage = readSource('src', 'app', 'page.tsx');
    const detachedChat = readSource('src', 'app', 'chat-window', 'page.tsx');

    expect(topbar).not.toContain('/chat-window');
    expect(libraryPage).not.toContain('BroadcastChannel');
    expect(detachedChat).not.toContain('BroadcastChannel');
    expect(detachedChat).toContain('이전 대화의 문맥을 불러오지 못했습니다.');
  });
});
