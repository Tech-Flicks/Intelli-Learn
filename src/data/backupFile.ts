/**
 * Browser glue for backups: saving a backup to disk and reading one a parent
 * picked. Kept apart from `backup.ts` so the backup logic stays free of DOM
 * APIs. Nothing here touches the network: the file is built and read locally.
 */
import { dayKey } from '@/core/grades';
import type { BackupFile } from './backup';

/** Largest file `readBackupFile` will read. Story pictures make backups big, but not this big. */
export const MAX_BACKUP_FILE_BYTES = 200 * 1024 * 1024;

export function backupFileName(file: Pick<BackupFile, 'exportedAt'>): string {
  return `intelli-learn-backup-${dayKey(file.exportedAt)}.json`;
}

/** Offers the backup as a JSON download. */
export function downloadBackup(file: BackupFile, filename: string = backupFileName(file)): void {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser a moment to start the download before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/**
 * Reads a picked file and parses it as JSON. The result is still untrusted:
 * pass it to `importBackup`, which validates it.
 * Throws an Error with a readable message when the file cannot be used.
 */
export async function readBackupFile(file: File): Promise<unknown> {
  if (file.size === 0) throw new Error('This file is empty.');
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('This file is too large to be a backup.');
  let text: string;
  try {
    text = await readText(file);
  } catch {
    throw new Error('This file could not be read.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('This is not an Intelli-Learn backup file.');
  }
}
