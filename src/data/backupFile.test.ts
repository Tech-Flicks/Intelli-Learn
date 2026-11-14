import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupFile } from './backup';
import { backupFileName, downloadBackup, MAX_BACKUP_FILE_BYTES, readBackupFile } from './backupFile';

const FILE: BackupFile = {
  app: 'intelli-learn',
  version: 1,
  exportedAt: new Date(2026, 10, 14, 12).getTime(),
  tables: { children: [{ id: 'child_1', nickname: 'Mira ⭐' }] },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('backupFileName', () => {
  it('names the file after the export day', () => {
    expect(backupFileName(FILE)).toBe('intelli-learn-backup-2026-11-14.json');
  });
});

describe('downloadBackup', () => {
  it('offers the JSON as a local download and cleans up', async () => {
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:local/backup';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clicked = this;
      expect(this.isConnected).toBe(true);
    });
    vi.useFakeTimers();
    try {
      downloadBackup(FILE);

      expect(clicked?.getAttribute('href')).toBe('blob:local/backup');
      expect(clicked?.download).toBe('intelli-learn-backup-2026-11-14.json');
      expect(document.querySelector('a[download]')).toBeNull();
      expect(blob?.type).toBe('application/json');
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:local/backup');
    } finally {
      vi.useRealTimers();
    }
    expect(JSON.parse(await (blob as Blob).text())).toEqual(FILE);
  });

  it('uses a custom file name when given', () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      name = this.download;
    });
    downloadBackup(FILE, 'mira.json');
    expect(name).toBe('mira.json');
  });
});

describe('readBackupFile', () => {
  it('parses a JSON file', async () => {
    const file = new File([JSON.stringify(FILE)], 'backup.json', { type: 'application/json' });
    expect(await readBackupFile(file)).toEqual(FILE);
  });

  it('rejects a file that is not JSON', async () => {
    const file = new File(['<html>not a backup</html>'], 'backup.json');
    await expect(readBackupFile(file)).rejects.toThrow(/not an Intelli-Learn backup/);
  });

  it('rejects an empty file', async () => {
    await expect(readBackupFile(new File([], 'empty.json'))).rejects.toThrow(/empty/);
  });

  it('rejects a file that is far too large without reading it', async () => {
    const file = new File(['{}'], 'huge.json');
    Object.defineProperty(file, 'size', { value: MAX_BACKUP_FILE_BYTES + 1 });
    const text = vi.spyOn(file, 'text');
    await expect(readBackupFile(file)).rejects.toThrow(/too large/);
    expect(text).not.toHaveBeenCalled();
  });

  it('reports a file that cannot be read', async () => {
    const file = new File(['{}'], 'broken.json');
    vi.spyOn(file, 'text').mockRejectedValue(new Error('disk error'));
    await expect(readBackupFile(file)).rejects.toThrow(/could not be read/);
  });
});
