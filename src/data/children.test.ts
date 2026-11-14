import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACCESSIBILITY, INTEREST_SUGGESTIONS } from '@/core/defaults';
import {
  COMPANION_SPECIES,
  cleanInterests,
  cleanNickname,
  createChild,
  defaultVoiceRate,
  deleteChild,
  getChild,
  listChildren,
  pickCompanionSpecies,
  updateChild,
  type NewChildInput,
} from './children';
import { CHILD_TABLES, db } from './db';
import { resetDb, sampleLibraryItem, seedChildData } from './testSupport';

const input = (patch: Partial<NewChildInput> = {}): NewChildInput => ({
  nickname: 'Mira',
  avatar: '🐼',
  ageGroup: '6-8',
  grade: '2',
  interests: ['space', 'animals'],
  ...patch,
});

beforeEach(resetDb);

describe('createChild', () => {
  it('fills every default and stores the profile', async () => {
    const child = await createChild(input(), 1234);

    expect(child.id).toMatch(/^child_/);
    expect(child).toMatchObject({
      nickname: 'Mira',
      avatar: '🐼',
      ageGroup: '6-8',
      grade: '2',
      interests: ['space', 'animals'],
      accessibility: DEFAULT_ACCESSIBILITY,
      controlsOverride: {},
      placementDone: false,
      stars: 0,
      totalStars: 0,
      collectibles: [],
      voiceRate: 0.9,
      streakDays: 0,
      lastPlayedDay: null,
      createdAt: 1234,
    });
    expect(child.companion).toEqual({ species: 'owl', name: '', growth: 0, xp: 0 });
    expect(await db.children.get(child.id)).toEqual(child);
  });

  it('does not share the default accessibility object between profiles', async () => {
    const child = await createChild(input());
    expect(child.accessibility).not.toBe(DEFAULT_ACCESSIBILITY);
  });

  it('gives each child a different id', async () => {
    const a = await createChild(input());
    const b = await createChild(input({ nickname: 'Leo' }));
    expect(a.id).not.toBe(b.id);
    expect(await db.children.count()).toBe(2);
  });

  it('trims the nickname and tidies interests', async () => {
    const child = await createChild(
      input({ nickname: '  Mira   Rose ', interests: [' space ', '', 'Space', 'robots  and  gears'] }),
    );
    expect(child.nickname).toBe('Mira Rose');
    expect(child.interests).toEqual(['space', 'robots and gears']);
  });

  it.each([
    ['empty nickname', { nickname: '   ' }],
    ['nickname over 20 characters', { nickname: 'x'.repeat(21) }],
    ['more than 8 interests', { interests: Array.from({ length: 9 }, (_, i) => `thing ${i}`) }],
    ['interest over 30 characters', { interests: ['y'.repeat(31)] }],
    ['missing avatar', { avatar: '' }],
    ['unknown age group', { ageGroup: '15-18' as NewChildInput['ageGroup'] }],
    ['unknown grade', { grade: '9' as NewChildInput['grade'] }],
  ])('rejects %s and stores nothing', async (_name, patch) => {
    await expect(createChild(input(patch))).rejects.toThrow();
    expect(await db.children.count()).toBe(0);
  });

  it('accepts the limits exactly', async () => {
    const child = await createChild(
      input({
        nickname: 'n'.repeat(20),
        interests: Array.from({ length: 8 }, (_, i) => `${i}`.padEnd(30, 'z')),
      }),
    );
    expect(child.nickname).toHaveLength(20);
    expect(child.interests).toHaveLength(8);
  });

  it('counts an emoji in a nickname as one character', () => {
    expect(cleanNickname('🦄'.repeat(20))).toBe('🦄'.repeat(20));
    expect(() => cleanNickname('🦄'.repeat(21))).toThrow();
  });

  it('sets the voice rate by age group', () => {
    expect(defaultVoiceRate('3-5')).toBe(0.85);
    expect(defaultVoiceRate('6-8')).toBe(0.9);
    expect(defaultVoiceRate('9-11')).toBe(1);
    expect(defaultVoiceRate('12-14')).toBe(1);
  });
});

describe('pickCompanionSpecies', () => {
  it('is deterministic', () => {
    expect(pickCompanionSpecies('🐼', ['chess'])).toBe(pickCompanionSpecies('🐼', ['chess']));
  });

  it('always returns a known species', () => {
    for (const interest of [...INTEREST_SUGGESTIONS, 'chess', 'zzz', '']) {
      for (const avatar of ['🐼', '🦁', '🐯', '🐧', 'x']) {
        expect(COMPANION_SPECIES).toContain(pickCompanionSpecies(avatar, [interest]));
      }
    }
    expect(COMPANION_SPECIES).toContain(pickCompanionSpecies('🐼', []));
  });

  it('follows the first interest with a known theme', () => {
    expect(pickCompanionSpecies('🐼', ['robots'])).toBe('robot');
    expect(pickCompanionSpecies('🐼', ['Dinosaurs'])).toBe('dragon');
    expect(pickCompanionSpecies('🐼', ['ocean'])).toBe('turtle');
    expect(pickCompanionSpecies('🐼', ['fairy tales'])).toBe('unicorn');
    expect(pickCompanionSpecies('🐼', ['animals'])).toBe('fox');
    expect(pickCompanionSpecies('🐼', ['space'])).toBe('owl');
    expect(pickCompanionSpecies('🐼', ['chess', 'ocean', 'robots'])).toBe('turtle');
  });

  it('falls back to the avatar, then to a stable hash', () => {
    expect(pickCompanionSpecies('🦊', [])).toBe('fox');
    expect(pickCompanionSpecies('🤖', ['chess'])).toBe('robot');
    const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((a) => pickCompanionSpecies(a, [])));
    expect(spread.size).toBeGreaterThan(1);
  });
});

describe('cleanInterests', () => {
  it('rejects values that are not a list of text', () => {
    expect(() => cleanInterests('space')).toThrow();
    expect(() => cleanInterests([1, 2])).toThrow();
  });

  it('ignores blanks when counting towards the limit', () => {
    expect(cleanInterests(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', '', '  '])).toHaveLength(8);
  });
});

describe('updateChild', () => {
  it('applies a patch and returns the saved profile', async () => {
    const child = await createChild(input());
    const updated = await updateChild(child.id, { grade: '3', stars: 5, placementDone: true });

    expect(updated).toEqual({ ...child, grade: '3', stars: 5, placementDone: true });
    expect(await getChild(child.id)).toEqual(updated);
  });

  it('never changes id or createdAt, and ignores undefined fields', async () => {
    const child = await createChild(input(), 1000);
    const updated = await updateChild(child.id, { id: 'other', createdAt: 5, nickname: undefined });

    expect(updated.id).toBe(child.id);
    expect(updated.createdAt).toBe(1000);
    expect(updated.nickname).toBe('Mira');
    expect(await db.children.count()).toBe(1);
  });

  it('validates the fields it changes', async () => {
    const child = await createChild(input());
    await expect(updateChild(child.id, { nickname: '' })).rejects.toThrow();
    await expect(updateChild(child.id, { interests: Array.from({ length: 9 }, (_, i) => `i${i}`) })).rejects.toThrow();
    await expect(updateChild(child.id, { grade: '12' as never })).rejects.toThrow();
    expect(await getChild(child.id)).toEqual(child);

    const renamed = await updateChild(child.id, { nickname: '  Mimi ' });
    expect(renamed.nickname).toBe('Mimi');
  });

  it('throws for an unknown child', async () => {
    await expect(updateChild('nope', { stars: 1 })).rejects.toThrow(/not found/);
  });

  it('does not lose a change when two updates overlap', async () => {
    const child = await createChild(input());
    await Promise.all([updateChild(child.id, { stars: 7 }), updateChild(child.id, { streakDays: 3 })]);
    expect(await getChild(child.id)).toMatchObject({ stars: 7, streakDays: 3 });
  });
});

describe('deleteChild', () => {
  it('removes the profile and every row about the child, and nothing else', async () => {
    const mira = await createChild(input());
    const leo = await createChild(input({ nickname: 'Leo' }));
    await seedChildData(mira.id);
    await seedChildData(leo.id);

    await deleteChild(mira.id);

    expect(await getChild(mira.id)).toBeUndefined();
    expect(await getChild(leo.id)).toBeDefined();
    for (const name of CHILD_TABLES) {
      expect(await db.table(name).where('childId').equals(mira.id).count(), name).toBe(0);
      expect(await db.table(name).where('childId').equals(leo.id).count(), name).toBe(1);
    }
  });

  it("removes the child's id from the shared canvas library but keeps the canvases", async () => {
    const mira = await createChild(input());
    await db.library.bulkPut([
      sampleLibraryItem('lib-1', { seenBy: [mira.id, 'someone-else'] }),
      sampleLibraryItem('lib-2', { seenBy: ['someone-else'] }),
    ]);

    await deleteChild(mira.id);

    expect((await db.library.get('lib-1'))?.seenBy).toEqual(['someone-else']);
    expect((await db.library.get('lib-2'))?.seenBy).toEqual(['someone-else']);
  });

  it('is a no-op for an unknown child', async () => {
    const mira = await createChild(input());
    await deleteChild('nope');
    expect(await getChild(mira.id)).toBeDefined();
  });
});

describe('listChildren', () => {
  it('returns profiles oldest first', async () => {
    await createChild(input({ nickname: 'Second' }), 200);
    await createChild(input({ nickname: 'First' }), 100);
    expect((await listChildren()).map((c) => c.nickname)).toEqual(['First', 'Second']);
  });
});
