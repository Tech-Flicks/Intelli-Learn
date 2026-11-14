import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS } from '@/core/defaults';
import type { AdminAuth, ChallengeRecord, ChildProfile, EncryptedBlob, LibraryItem, Settings } from '@/core/types';
import { exportBackup, importBackup, parseBackup, wipeEverything, type BackupFile } from './backup';
import { createChild } from './children';
import { CHILD_TABLES, db, getSettings, updateSettings } from './db';
import { resetDb, sampleLibraryItem, seedChildData } from './testSupport';
import { recordUsage } from './usage';

const AUTH: AdminAuth = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 210_000, failedAttempts: 2, lockedUntil: null };
const CIPHER: EncryptedBlob = { iv: 'aXZpdml2aXZpdml2', data: 'c2VjcmV0LWNpcGhlcg==' };

async function seedDevice(): Promise<{ mira: ChildProfile; leo: ChildProfile }> {
  await updateSettings((s) => ({
    ...s,
    setupComplete: true,
    auth: AUTH,
    ai: { ...s.ai, provider: 'direct', apiKeyCipher: CIPHER },
    controls: { ...s.controls, dailyMinutes: 45, openChat: true },
  }));
  await db.kv.put({ key: 'device-key', value: 'not-for-export' });
  await recordUsage({ requests: 4 });
  const mira = await createChild({ nickname: 'Mira', avatar: '🐼', ageGroup: '6-8', grade: '2', interests: ['space'] }, 100);
  const leo = await createChild({ nickname: 'Leo', avatar: '🦁', ageGroup: '3-5', grade: 'K', interests: [] }, 200);
  await db.library.bulkPut([
    sampleLibraryItem('lib-mira', { seenBy: [mira.id], rating: 5 }),
    sampleLibraryItem('lib-both', { seenBy: [mira.id, leo.id] }),
    sampleLibraryItem('lib-unseen'),
  ]);
  await seedChildData(mira.id, 'lib-mira');
  await seedChildData(leo.id);
  return { mira, leo };
}

async function snapshot(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of ['children', 'library', ...CHILD_TABLES]) {
    out[name] = await db.table(name).toArray();
  }
  return out;
}

/** What a file looks like after being saved to disk and read back. */
function throughJson(file: BackupFile): unknown {
  return JSON.parse(JSON.stringify(file));
}

function minimalFile(tables: Record<string, unknown[]> = {}): BackupFile {
  return { app: 'intelli-learn', version: 1, exportedAt: 1, tables };
}

beforeEach(resetDb);

describe('exportBackup', () => {
  it('exports children, all child tables, the library and settings', async () => {
    const { mira, leo } = await seedDevice();
    const file = await exportBackup({ now: 5000 });

    expect(file.app).toBe('intelli-learn');
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe(5000);
    expect(Object.keys(file.tables).sort()).toEqual(['children', 'library', 'settings', ...CHILD_TABLES].sort());
    expect((file.tables.children as ChildProfile[]).map((c) => c.id)).toEqual([mira.id, leo.id]);
    for (const name of CHILD_TABLES) expect(file.tables[name], name).toHaveLength(2);
    expect(file.tables.library).toHaveLength(3);
  });

  it('never exports the password hash, the API key, the device key or usage counters', async () => {
    await seedDevice();
    const file = await exportBackup();
    const settings = (file.tables.settings as Settings[])[0];

    expect(settings?.auth).toBeNull();
    expect(settings?.ai.apiKeyCipher).toBeNull();
    expect(settings?.controls.dailyMinutes).toBe(45);
    expect(file.tables).not.toHaveProperty('kv');
    expect(file.tables).not.toHaveProperty('usage');

    const json = JSON.stringify(file);
    for (const secret of [AUTH.hash, AUTH.salt, CIPHER.data, CIPHER.iv, 'not-for-export']) {
      expect(json).not.toContain(secret);
    }
    // Exporting must not change what is stored.
    expect((await getSettings()).auth).toEqual(AUTH);
    expect((await getSettings()).ai.apiKeyCipher).toEqual(CIPHER);
  });

  it('exports one child when asked', async () => {
    const { mira, leo } = await seedDevice();
    const file = await exportBackup({ childId: mira.id });

    expect((file.tables.children as ChildProfile[]).map((c) => c.id)).toEqual([mira.id]);
    for (const name of CHILD_TABLES) {
      const rows = file.tables[name] as { childId: string }[];
      expect(rows, name).toHaveLength(1);
      expect(rows[0]?.childId).toBe(mira.id);
    }
    const library = file.tables.library as LibraryItem[];
    expect(library.map((item) => item.id).sort()).toEqual(['lib-both', 'lib-mira']);
    expect(JSON.stringify(file)).not.toContain(leo.id);
  });

  it('throws for an unknown child', async () => {
    await seedDevice();
    await expect(exportBackup({ childId: 'nope' })).rejects.toThrow(/not found/);
  });

  it('leaves out rows that belong to no child', async () => {
    const { mira } = await seedDevice();
    await seedChildData('ghost');
    await db.library.put(sampleLibraryItem('lib-ghost', { seenBy: ['ghost', mira.id] }));

    const file = await exportBackup();

    expect(JSON.stringify(file)).not.toContain('"childId":"ghost"');
    for (const name of CHILD_TABLES) expect(file.tables[name], name).toHaveLength(2);
    const ghostItem = (file.tables.library as LibraryItem[]).find((item) => item.id === 'lib-ghost');
    expect(ghostItem?.seenBy).toEqual([mira.id]);
  });

  it('works on an empty device', async () => {
    const file = await exportBackup();
    expect(file.tables.children).toEqual([]);
    expect(file.tables.settings).toEqual([]);
    expect(() => parseBackup(throughJson(file))).not.toThrow();
  });
});

describe('export -> wipe -> import', () => {
  it('restores every child, record and library item', async () => {
    await seedDevice();
    const before = await snapshot();
    const file = throughJson(await exportBackup());

    await wipeEverything();
    for (const table of db.tables) expect(await table.count(), table.name).toBe(0);

    const result = await importBackup(file, 'merge');

    expect(result).toEqual({ children: 2, records: 20, libraryItems: 3, skipped: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it('restores into a replaced device the same way', async () => {
    await seedDevice();
    const before = await snapshot();
    const file = throughJson(await exportBackup());
    await wipeEverything();

    await importBackup(file, 'replace');

    expect(await snapshot()).toEqual(before);
    expect((await getSettings()).controls).toMatchObject({ dailyMinutes: 45, openChat: true });
  });

  it('never brings back a password or an API key', async () => {
    await seedDevice();
    const file = throughJson(await exportBackup());
    await wipeEverything();

    await importBackup(file, 'replace');

    const settings = await getSettings();
    expect(settings.auth).toBeNull();
    expect(settings.ai.apiKeyCipher).toBeNull();
    expect(settings.setupComplete).toBe(false);
    expect(await db.kv.count()).toBe(0);
  });
});

describe('importBackup', () => {
  it('merge keeps what is only on the device and upserts by primary key', async () => {
    const { mira } = await seedDevice();
    const file = throughJson(await exportBackup({ childId: mira.id })) as BackupFile;
    const fileChild = (file.tables.children as ChildProfile[])[0] as ChildProfile;
    fileChild.stars = 99;

    const sara = await createChild({ nickname: 'Sara', avatar: '🦊', ageGroup: '9-11', grade: '4', interests: [] });
    await seedChildData(sara.id);
    const countsBefore = await db.attempts.count();

    const result = await importBackup(file, 'merge');

    expect(result).toMatchObject({ children: 1, records: 10, skipped: 0 });
    expect((await db.children.get(mira.id))?.stars).toBe(99);
    expect(await db.children.count()).toBe(3);
    expect(await db.attempts.count()).toBe(countsBefore);
  });

  it('merge does not touch settings', async () => {
    await seedDevice();
    const file = throughJson(await exportBackup()) as BackupFile;
    await updateSettings((s) => ({ ...s, controls: { ...s.controls, dailyMinutes: 10 } }));

    await importBackup(file, 'merge');

    const settings = await getSettings();
    expect(settings.controls.dailyMinutes).toBe(10);
    expect(settings.auth).toEqual(AUTH);
    expect(settings.ai.apiKeyCipher).toEqual(CIPHER);
  });

  it('replace clears child data first and imports the controls, keeping auth and the API key', async () => {
    const { mira, leo } = await seedDevice();
    const file = throughJson(await exportBackup({ childId: mira.id })) as BackupFile;
    await updateSettings((s) => ({ ...s, controls: { ...s.controls, dailyMinutes: 10, openChat: false } }));

    const result = await importBackup(file, 'replace');

    expect(result).toMatchObject({ children: 1, records: 10 });
    expect((await db.children.toArray()).map((c) => c.id)).toEqual([mira.id]);
    for (const name of CHILD_TABLES) {
      expect(await db.table(name).where('childId').equals(leo.id).count(), name).toBe(0);
      expect(await db.table(name).count(), name).toBe(1);
    }
    const settings = await getSettings();
    expect(settings.controls).toMatchObject({ dailyMinutes: 45, openChat: true });
    expect(settings.auth).toEqual(AUTH);
    expect(settings.ai.apiKeyCipher).toEqual(CIPHER);
    expect(settings.ai.provider).toBe('direct');
    expect(settings.setupComplete).toBe(true);
    // The library is shared: it stays, but no longer names the removed child.
    expect(await db.library.count()).toBe(3);
    expect((await db.library.get('lib-both'))?.seenBy).toEqual([mira.id]);
  });

  it('ignores an auth record and an API key smuggled into the file', async () => {
    await seedDevice();
    const file = throughJson(await exportBackup()) as BackupFile;
    const settings = (file.tables.settings as Settings[])[0] as Settings;
    settings.auth = { ...AUTH, hash: 'ZXZpbA==' };
    settings.ai.apiKeyCipher = { iv: 'ZXZpbA==', data: 'ZXZpbA==' };
    settings.ai.baseUrl = 'https://evil.example/v1';
    settings.setupComplete = false;

    await importBackup(file, 'replace');

    const after = await getSettings();
    expect(after.auth).toEqual(AUTH);
    expect(after.ai.apiKeyCipher).toEqual(CIPHER);
    expect(after.ai.baseUrl).not.toContain('evil');
    expect(after.setupComplete).toBe(true);
  });

  it('skips rows whose child is neither in the file nor on the device', async () => {
    const { mira } = await seedDevice();
    const file = throughJson(await exportBackup({ childId: mira.id })) as BackupFile;
    file.tables.children = [];
    await wipeEverything();

    const result = await importBackup(file, 'merge');

    expect(result).toMatchObject({ children: 0, records: 0, skipped: 10 });
    for (const name of CHILD_TABLES) expect(await db.table(name).count(), name).toBe(0);
    expect((await db.library.get('lib-mira'))?.seenBy).toEqual([]);
  });

  it('does not store a canvas twice when the device has it under another id', async () => {
    const { mira } = await seedDevice();
    const file = throughJson(await exportBackup({ childId: mira.id })) as BackupFile;
    await wipeEverything();
    const sara = await createChild({ nickname: 'Sara', avatar: '🦊', ageGroup: '9-11', grade: '4', interests: [] });
    await db.library.put(sampleLibraryItem('lib-local', { fingerprint: 'fp-lib-mira', seenBy: [sara.id], rating: 3 }));

    const result = await importBackup(file, 'merge');

    expect(result.libraryItems).toBe(2);
    expect(await db.library.get('lib-mira')).toBeUndefined();
    const local = await db.library.get('lib-local');
    expect(local?.rating).toBe(3);
    expect(local?.seenBy.sort()).toEqual([mira.id, sara.id].sort());
    const challenge = (await db.challenges.where('childId').equals(mira.id).first()) as ChallengeRecord;
    expect(challenge.libraryId).toBe('lib-local');
  });

  it('clears a library link that points at nothing', async () => {
    const { mira } = await seedDevice();
    const file = throughJson(await exportBackup({ childId: mira.id })) as BackupFile;
    file.tables.library = [];
    await wipeEverything();

    await importBackup(file, 'merge');

    const challenge = (await db.challenges.where('childId').equals(mira.id).first()) as ChallengeRecord;
    expect(challenge.libraryId).toBeNull();
  });

  it('strips unknown fields from rows', async () => {
    const { mira } = await seedDevice();
    const file = throughJson(await exportBackup({ childId: mira.id })) as BackupFile;
    (file.tables.children as Record<string, unknown>[])[0]!.isAdmin = true;
    await wipeEverything();

    await importBackup(file, 'merge');

    expect(await db.children.get(mira.id)).not.toHaveProperty('isAdmin');
  });

  describe('rejects', () => {
    async function validFile(): Promise<BackupFile> {
      await seedDevice();
      const file = throughJson(await exportBackup()) as BackupFile;
      await wipeEverything();
      return file;
    }

    async function expectRejected(file: unknown, message: RegExp): Promise<void> {
      await expect(importBackup(file, 'merge')).rejects.toThrow(message);
      await expect(importBackup(file, 'replace')).rejects.toThrow(message);
      for (const table of db.tables) expect(await table.count(), table.name).toBe(0);
    }

    it.each([
      ['null', null],
      ['a string', 'backup'],
      ['a number', 42],
      ['an array', []],
      ['an empty object', {}],
      ['another app', { app: 'other-app', version: 1, exportedAt: 1, tables: {} }],
    ])('%s', async (_name, file) => {
      await expectRejected(file, /not an Intelli-Learn backup/);
    });

    it('another version', async () => {
      await expectRejected({ ...minimalFile(), version: 2 }, /different version/);
    });

    it('a missing or malformed tables field', async () => {
      await expectRejected({ app: 'intelli-learn', version: 1, exportedAt: 1 }, /not valid.*tables/);
      await expectRejected({ ...minimalFile(), tables: [] }, /not valid.*tables/);
      await expectRejected(minimalFile({ children: 'all of them' as unknown as unknown[] }), /tables\.children/);
    });

    it('a missing exportedAt', async () => {
      await expectRejected({ app: 'intelli-learn', version: 1, tables: {} }, /exportedAt/);
    });

    it('unknown top-level fields', async () => {
      await expectRejected({ ...minimalFile(), extra: true }, /not valid/);
    });

    it('the kv table, the usage table and any unknown table', async () => {
      await expectRejected(minimalFile({ kv: [{ key: 'device-key', value: 'x' }] }), /kv/);
      await expectRejected(minimalFile({ usage: [] }), /usage/);
      await expectRejected(minimalFile({ surprises: [] }), /surprises/);
    });

    it('more than one settings record', async () => {
      const file = await validFile();
      file.tables.settings = [file.tables.settings?.[0], file.tables.settings?.[0]];
      await expectRejected(file, /settings/);
    });

    it('settings with invalid controls', async () => {
      const file = await validFile();
      file.tables.settings = [{ controls: { ...DEFAULT_CONTROLS, dailyMinutes: 'lots' } }];
      await expectRejected(file, /tables\.settings\[0\]\.controls\.dailyMinutes/);
    });

    it('a child row of the wrong shape, naming the row and field', async () => {
      const file = await validFile();
      (file.tables.children as Record<string, unknown>[])[1]!.grade = '12';
      await expectRejected(file, /tables\.children\[1\]\.grade/);
    });

    it('a row with a missing field', async () => {
      const file = await validFile();
      delete (file.tables.attempts as Record<string, unknown>[])[0]!.outcome;
      await expectRejected(file, /tables\.attempts\[0\]\.outcome/);
    });

    it('a row that is not an object', async () => {
      const file = await validFile();
      file.tables.rewards = ['free stars'];
      await expectRejected(file, /tables\.rewards\[0\]/);
    });

    it('a challenge whose content does not match the challenge schema', async () => {
      const file = await validFile();
      const challenge = (file.tables.challenges as ChallengeRecord[])[0] as ChallengeRecord;
      (challenge.content.interaction as { kind: string }).kind = 'run-script';
      await expectRejected(file, /tables\.challenges\[0\]\.content\.interaction/);
    });

    it('a library item whose content does not match the challenge schema', async () => {
      const file = await validFile();
      delete ((file.tables.library as LibraryItem[])[0] as unknown as { content: Record<string, unknown> }).content.question;
      await expectRejected(file, /tables\.library\[0\]\.content\.question/);
    });

    it('a story picture that is not an embedded image', async () => {
      const file = await validFile();
      const story = (file.tables.stories as { chapters: { imageDataUrl: string | null }[] }[])[0];
      story!.chapters[0]!.imageDataUrl = 'https://tracker.example/pixel.png';
      await expectRejected(file, /tables\.stories\[0\]\.chapters\[0\]\.imageDataUrl/);
    });

    it('duplicate primary keys', async () => {
      const file = await validFile();
      file.tables.children = [file.tables.children?.[0], file.tables.children?.[0]];
      await expectRejected(file, /duplicate record/);
    });

    it('an unknown mode', async () => {
      await expect(importBackup(minimalFile(), 'overwrite' as 'merge')).rejects.toThrow(/mode/);
    });
  });

  it('changes nothing on the device when the file is invalid', async () => {
    await seedDevice();
    const before = await snapshot();
    const file = throughJson(await exportBackup()) as BackupFile;
    (file.tables.weeklyReports as Record<string, unknown>[])[1]!.stats = null;

    await expect(importBackup(file, 'replace')).rejects.toThrow(/tables\.weeklyReports\[1\]\.stats/);

    expect(await snapshot()).toEqual(before);
  });

  it('accepts a file with no tables at all', async () => {
    expect(await importBackup(minimalFile(), 'merge')).toEqual({ children: 0, records: 0, libraryItems: 0, skipped: 0 });
  });
});

describe('wipeEverything', () => {
  it('clears every table, including settings, usage and kv', async () => {
    await seedDevice();
    await wipeEverything();
    for (const table of db.tables) expect(await table.count(), table.name).toBe(0);
  });

  it('leaves the app at first-run state', async () => {
    await seedDevice();
    await wipeEverything();

    const settings = await getSettings();
    expect(settings.setupComplete).toBe(false);
    expect(settings.auth).toBeNull();
    expect(settings.ai.apiKeyCipher).toBeNull();
    expect(settings.ai.provider).toBe('demo');
  });
});
