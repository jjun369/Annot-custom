'use client';

import { useEffect } from 'react';

import {
  isAutomaticBackupDue,
  LAST_AUTOMATIC_BACKUP_KEY,
} from '@/lib/automatic-backup';

const STARTUP_BACKUP_DELAY_MS = 5000;

/**
 * Owns the daily local safety backup for the lifetime of the application shell.
 * It deliberately does not live in a page so navigation cannot schedule extra jobs.
 */
export function AutomaticBackupScheduler() {
  useEffect(() => {
    if (!isAutomaticBackupDue(window.localStorage.getItem(LAST_AUTOMATIC_BACKUP_KEY))) return;

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/library/backup', { method: 'POST' });
        if (response.ok) {
          window.localStorage.setItem(LAST_AUTOMATIC_BACKUP_KEY, String(Date.now()));
        }
      } catch {
        // A failed local safety backup is retried the next time the application shell starts.
      }
    }, STARTUP_BACKUP_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}
