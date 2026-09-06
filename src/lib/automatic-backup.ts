export const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTOMATIC_BACKUP_RETENTION = 3;
export const LAST_AUTOMATIC_BACKUP_KEY = 'annot-last-auto-backup';

export function isAutomaticBackupDue(lastBackupValue: string | null, now = Date.now()): boolean {
  const lastBackup = Number(lastBackupValue || 0);
  return !Number.isFinite(lastBackup) || lastBackup <= 0 || now - lastBackup >= AUTOMATIC_BACKUP_INTERVAL_MS;
}
