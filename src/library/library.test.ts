import { beforeEach, describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type { ChallengePlan, ChallengeRecord, LibraryItem } from '@/core/types';
import { db, exportBackup, parseBackup } from '@/data';
import {
  avoidNotesFor,
  deleteLibraryItem,
  findReusable,
  fingerprintOf,
  libraryStats,
  listLibrary,
  markSeen,
  markServed,
  rateLibraryItem,
  recordLibraryOutcome,
  saveToLibrary,
  setRetired,
} from './index';

const T0 = 1_800_000_000_000;

function content(question = 'How many stars can you see?', answer = 3, title = 'Count the stars'): Challenge {
  return ChallengeSchema.parse({
    title,
    intro: 'Stars twinkle over the hill.',
    question,
    readAloud: `Stars twinkle over the hill. ${question}`,
    interaction: { kind: 'number', answer },
    hints: ['Count slowly.', 'Point at each one as you count.'],
    walkthrough: ['Point at the first one.', 'Count on to the last one.'],
    explanation: 'Counting each one once gives the total.',
    scene: { theme: 'space', objects: [{ id: 'star-1', type: 'emoji', emoji: '⭐', x: 20, y: 20 }] },
  });
}

function plan(patch: Partial<ChallengePlan> = {}): ChallengePlan {
  return {
    childId: 'kid-a',
    skillId: 'math-counting-cardinality',
    strand: 'math',
    stage: makeStage('K', 'growing'),
    interaction: 'number',
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
    ...patch,
  };
}

const kid = (patch: Partial<{ id: string; ageGroup: LibraryItem['ageGroup']; interests: string[] }> = {}) => ({
  id: 'kid-b',
  ageGroup: '3-5' as LibraryItem['ageGroup'],
  interests: ['space'],
  ...patch,
});

let counter = 0;
/** Stores a distinct canvas and returns it. */
async function seed(patch: Partial<LibraryItem> = {}, planPatch: Partial<ChallengePlan> = {}): Promise<LibraryItem> {
  counter += 1;
  const item = await saveToLibrary(
    { content: content(`How many moons, version ${counter}?`, counter), plan: plan(planPatch), ageGroup: '3-5', locale: 'en', origin: 'ai' },
    T0 + counter,
  );
  if (Object.keys(patch).length > 0) await db.library.update(item.id, patch);
  return (await db.library.get(item.id)) as LibraryItem;
}

function challengeRow(id: string, libraryId: string | null, childId = 'kid-a'): ChallengeRecord {
  return {
    id,
    childId,
    skillId: 'math-counting-cardinality',
    strand: 'math',
    stage: makeStage('K', 'growing'),
    interaction: 'number',
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
    content: content(),
    source: libraryId ? 'reused' : 'offline',
    status: 'completed',
    storyId: null,
    chapterIndex: null,
    libraryId,
    parentRating: null,
    parentNote: '',
    createdAt: T0,
    startedAt: T0,
    completedAt: T0 + 1000,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  counter = 0;
});

describe('saveToLibrary', () => {
  it('stores a new item with the plan fields and clean counters', async () => {
    const item = await saveToLibrary({ content: content(), plan: plan({ theme: ' dinosaurs ' }), ageGroup: '6-8', locale: 'es', origin: 'ai' }, T0);
    expect(item).toMatchObject({
      fingerprint: fingerprintOf(content()),
      skillId: 'math-counting-cardinality',
      strand: 'math',
      stage: makeStage('K', 'growing'),
      grade: 'K',
      interaction: 'number',
      mode: 'quest',
      theme: 'dinosaurs',
      ageGroup: '6-8',
      locale: 'es',
      origin: 'ai',
      remixOf: null,
      rating: null,
      ratingNote: '',
      retired: false,
      seenBy: [],
      uses: 0,
      independentSolves: 0,
      assistedSolves: 0,
      createdAt: T0,
      lastUsedAt: null,
    });
    expect(item.id).toMatch(/^lib_/);
    expect(await db.library.get(item.id)).toEqual(item);
  });

  it('returns the existing item when the same canvas is saved again', async () => {
    const first = await saveToLibrary({ content: content(), plan: plan(), ageGroup: '3-5', locale: 'en', origin: 'ai' }, T0);
    const redecorated: Challenge = { ...content(), title: 'Night Sky', scene: { theme: 'sky', objects: [] } };
    const again = await saveToLibrary({ content: redecorated, plan: plan({ theme: 'animals' }), ageGroup: '6-8', locale: 'en', origin: 'ai' }, T0 + 5);
    expect(again.id).toBe(first.id);
    expect(again.content.title).toBe('Count the stars');
    expect(await db.library.count()).toBe(1);
  });

  it('stores only one item when the same canvas is saved twice at once', async () => {
    const input = { content: content(), plan: plan(), ageGroup: '3-5', locale: 'en', origin: 'ai' } as const;
    const [a, b] = await Promise.all([saveToLibrary(input, T0), saveToLibrary(input, T0)]);
    expect(a.id).toBe(b.id);
    expect(await db.library.count()).toBe(1);
  });

  it('keeps the link to the original for a remix, and only for a remix', async () => {
    const original = await seed();
    const remix = await saveToLibrary({ content: content('How many rockets?', 5), plan: plan(), ageGroup: '3-5', locale: 'en', origin: 'remix', remixOf: original.id });
    expect(remix.origin).toBe('remix');
    expect(remix.remixOf).toBe(original.id);
    const plain = await saveToLibrary({ content: content('How many comets?', 6), plan: plan(), ageGroup: '3-5', locale: 'en', origin: 'ai', remixOf: original.id });
    expect(plain.remixOf).toBeNull();
  });

  it('refuses content that does not pass the challenge schema', async () => {
    const broken = { ...content(), hints: ['only one hint'] } as unknown as Challenge;
    await expect(saveToLibrary({ content: broken, plan: plan(), ageGroup: '3-5', locale: 'en', origin: 'ai' })).rejects.toThrow();
    expect(await db.library.count()).toBe(0);
  });

  it('writes rows that a backup of the device accepts', async () => {
    const item = await seed();
    await markServed(item.id, 'kid-a', T0 + 50);
    await rateLibraryItem(item.id, 4, 'Lovely');
    const backup = await exportBackup();
    expect(() => parseBackup(JSON.parse(JSON.stringify(backup)))).not.toThrow();
    expect(backup.tables.library).toHaveLength(1);
  });
});

describe('findReusable', () => {
  it('returns null for an empty library', async () => {
    expect(await findReusable(plan(), kid(), 'en')).toBeNull();
  });

  it('finds an item with the same skill, grade, interaction and locale', async () => {
    const item = await seed();
    const found = await findReusable(plan(), kid(), 'en');
    expect(found?.item.id).toBe(item.id);
    expect(found?.themeFits).toBe(true);
  });

  it('needs the same skill, interaction, locale and grade', async () => {
    await seed();
    expect(await findReusable(plan({ skillId: 'math-addition-subtraction' }), kid(), 'en')).toBeNull();
    expect(await findReusable(plan({ interaction: 'choice' }), kid(), 'en')).toBeNull();
    expect(await findReusable(plan(), kid(), 'es')).toBeNull();
    expect(await findReusable(plan({ stage: makeStage('1', 'starting') }), kid(), 'en')).toBeNull();
  });

  it('accepts a stage one step away inside the grade, but not two', async () => {
    await seed({}, { stage: makeStage('K', 'starting') });
    expect(await findReusable(plan({ stage: makeStage('K', 'growing') }), kid(), 'en')).not.toBeNull();
    expect(await findReusable(plan({ stage: makeStage('K', 'strong') }), kid(), 'en')).toBeNull();
  });

  it('does not cross a grade boundary even when the stage is one step away', async () => {
    await seed({}, { stage: makeStage('K', 'ready') });
    expect(await findReusable(plan({ stage: makeStage('1', 'starting') }), kid(), 'en')).toBeNull();
  });

  it('accepts the same or a neighbouring age group only', async () => {
    await seed(); // saved for ages 3-5
    expect(await findReusable(plan(), kid({ ageGroup: '3-5' }), 'en')).not.toBeNull();
    expect(await findReusable(plan(), kid({ ageGroup: '6-8' }), 'en')).not.toBeNull();
    expect(await findReusable(plan(), kid({ ageGroup: '9-11' }), 'en')).toBeNull();
    expect(await findReusable(plan(), kid({ ageGroup: '12-14' }), 'en')).toBeNull();
  });

  it('skips retired items, items rated 1 or 2 and items the child has seen', async () => {
    const retired = await seed({ retired: true });
    const low = await seed({ rating: 2 });
    const seen = await seed({ seenBy: ['kid-b'] });
    expect(await findReusable(plan(), kid(), 'en')).toBeNull();
    // Another child may still get the one that only kid-b has seen.
    expect((await findReusable(plan(), kid({ id: 'kid-c' }), 'en'))?.item.id).toBe(seen.id);
    expect([retired.id, low.id]).not.toContain((await findReusable(plan(), kid({ id: 'kid-c' }), 'en'))?.item.id);
  });

  it('orders by rating 5, 4, unrated, 3', async () => {
    const three = await seed({ rating: 3 });
    const unrated = await seed();
    const four = await seed({ rating: 4 });
    const five = await seed({ rating: 5 });
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const found = await findReusable(plan(), kid(), 'en');
      if (!found) break;
      order.push(found.item.id);
      await markSeen(found.item.id, 'kid-b');
    }
    expect(order).toEqual([five.id, four.id, unrated.id, three.id]);
  });

  it('prefers fewer uses, then the newest', async () => {
    const oldUnused = await seed();
    const used = await seed({ uses: 3 });
    const newUnused = await seed();
    expect((await findReusable(plan(), kid(), 'en'))?.item.id).toBe(newUnused.id);
    await markSeen(newUnused.id, 'kid-b');
    expect((await findReusable(plan(), kid(), 'en'))?.item.id).toBe(oldUnused.id);
    await markSeen(oldUnused.id, 'kid-b');
    expect((await findReusable(plan(), kid(), 'en'))?.item.id).toBe(used.id);
  });

  it('wants the same mode for a creative plan', async () => {
    const lab = await seed({}, { mode: 'experiment' });
    await seed({}, { mode: 'detective' });
    const found = await findReusable(plan({ mode: 'experiment' }), kid(), 'en');
    expect(found?.item.id).toBe(lab.id);
    expect(await findReusable(plan({ mode: 'wonder' }), kid(), 'en')).toBeNull();
  });

  it('lets a quest take any mode except story, studio and mission canvases', async () => {
    await seed({}, { mode: 'story' });
    await seed({}, { mode: 'studio' });
    const mission = await seed({}, { mode: 'mission' });
    expect(await findReusable(plan({ mode: 'quest' }), kid(), 'en')).toBeNull();
    expect((await findReusable(plan({ mode: 'mission' }), kid(), 'en'))?.item.id).toBe(mission.id);
    const lab = await seed({}, { mode: 'experiment' });
    expect((await findReusable(plan({ mode: 'quest' }), kid(), 'en'))?.item.id).toBe(lab.id);
  });

  it('reports whether the theme fits the plan or one of the interests', async () => {
    await seed({}, { theme: 'Dinosaurs' });
    expect((await findReusable(plan({ theme: 'space' }), kid({ interests: ['space', 'robots'] }), 'en'))?.themeFits).toBe(false);
    expect((await findReusable(plan({ theme: 'dinosaurs' }), kid({ interests: [] }), 'en'))?.themeFits).toBe(true);
    expect((await findReusable(plan({ theme: 'space' }), kid({ interests: ['robots', ' DINOSAURS '] }), 'en'))?.themeFits).toBe(true);
  });
});

describe('markServed, markSeen and recordLibraryOutcome', () => {
  it('counts a serve and remembers the child once', async () => {
    const item = await seed();
    await markServed(item.id, 'kid-a', T0 + 100);
    await markServed(item.id, 'kid-b', T0 + 200);
    await markServed(item.id, 'kid-a', T0 + 300);
    expect(await db.library.get(item.id)).toMatchObject({ seenBy: ['kid-a', 'kid-b'], uses: 3, lastUsedAt: T0 + 300 });
  });

  it('does not lose a serve when two happen at once', async () => {
    const item = await seed();
    await Promise.all([markServed(item.id, 'kid-a', T0), markServed(item.id, 'kid-b', T0), markServed(item.id, 'kid-c', T0)]);
    const stored = await db.library.get(item.id);
    expect(stored?.uses).toBe(3);
    expect([...(stored?.seenBy ?? [])].sort()).toEqual(['kid-a', 'kid-b', 'kid-c']);
  });

  it('marks an item as seen without counting a serve', async () => {
    const item = await seed();
    await markSeen(item.id, 'kid-a');
    await markSeen(item.id, 'kid-a');
    expect(await db.library.get(item.id)).toMatchObject({ seenBy: ['kid-a'], uses: 0, lastUsedAt: null });
  });

  it('counts solves without help as independent and helped ones as assisted', async () => {
    const item = await seed();
    await recordLibraryOutcome(item.id, 'independent');
    await recordLibraryOutcome(item.id, 'second-try');
    await recordLibraryOutcome(item.id, 'nudge');
    await recordLibraryOutcome(item.id, 'hint');
    await recordLibraryOutcome(item.id, 'walkthrough');
    expect(await db.library.get(item.id)).toMatchObject({ independentSolves: 2, assistedSolves: 3 });
  });

  it('ignores an item that no longer exists', async () => {
    await expect(markServed('gone', 'kid-a')).resolves.toBeUndefined();
    await expect(markSeen('gone', 'kid-a')).resolves.toBeUndefined();
    await expect(recordLibraryOutcome('gone', 'hint')).resolves.toBeUndefined();
    await expect(setRetired('gone', true)).resolves.toBeUndefined();
    expect(await db.library.count()).toBe(0);
  });
});

describe('rateLibraryItem and setRetired', () => {
  it('stores the rating and the note', async () => {
    const item = await seed();
    const rated = await rateLibraryItem(item.id, 5, '  Great picture  ');
    expect(rated).toMatchObject({ rating: 5, ratingNote: 'Great picture', retired: false });
    expect(await db.library.get(item.id)).toEqual(rated);
  });

  it('rejects anything that is not 1 to 5 whole stars or null', async () => {
    const item = await seed();
    for (const bad of [0, 6, 2.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(rateLibraryItem(item.id, bad)).rejects.toThrow(/1 to 5/);
    }
    await expect(rateLibraryItem(item.id, '4' as unknown as number)).rejects.toThrow();
    expect((await db.library.get(item.id))?.rating).toBeNull();
  });

  it('throws for an unknown item', async () => {
    await expect(rateLibraryItem('nope', 3)).rejects.toThrow(/not found/);
  });

  it('retires an item rated 1 or 2 and brings it back when rated 3 or more', async () => {
    const item = await seed();
    expect((await rateLibraryItem(item.id, 2, 'Too wordy')).retired).toBe(true);
    expect(await findReusable(plan(), kid(), 'en')).toBeNull();
    expect((await rateLibraryItem(item.id, 1)).retired).toBe(true);
    const back = await rateLibraryItem(item.id, 3);
    expect(back.retired).toBe(false);
    expect(back.ratingNote).toBe('Too wordy');
    expect((await findReusable(plan(), kid(), 'en'))?.item.id).toBe(item.id);
  });

  it('brings a rating-retired item back when the rating is cleared', async () => {
    const item = await seed();
    await rateLibraryItem(item.id, 1);
    const cleared = await rateLibraryItem(item.id, null);
    expect(cleared).toMatchObject({ rating: null, retired: false });
  });

  it('leaves an item that a parent retired by hand retired, whatever the rating', async () => {
    const item = await seed();
    await setRetired(item.id, true);
    expect((await rateLibraryItem(item.id, 5)).retired).toBe(true);
    expect((await rateLibraryItem(item.id, null)).retired).toBe(true);
    await setRetired(item.id, false);
    expect((await db.library.get(item.id))?.retired).toBe(false);
  });

  it('keeps the note when none is given and clears it with an empty one', async () => {
    const item = await seed();
    await rateLibraryItem(item.id, 4, 'Fun');
    expect((await rateLibraryItem(item.id, 5)).ratingNote).toBe('Fun');
    expect((await rateLibraryItem(item.id, 5, '   ')).ratingNote).toBe('');
  });

  it('cuts a very long note', async () => {
    const item = await seed();
    const rated = await rateLibraryItem(item.id, 3, 'x'.repeat(2000));
    expect(rated.ratingNote).toHaveLength(500);
  });

  it('mirrors the rating and note to every challenge that points at the item', async () => {
    const item = await seed();
    const other = await seed();
    await db.challenges.bulkPut([
      challengeRow('c1', item.id, 'kid-a'),
      challengeRow('c2', item.id, 'kid-b'),
      challengeRow('c3', other.id),
      challengeRow('c4', null),
    ]);
    await rateLibraryItem(item.id, 2, 'Confusing picture');
    expect(await db.challenges.get('c1')).toMatchObject({ parentRating: 2, parentNote: 'Confusing picture' });
    expect(await db.challenges.get('c2')).toMatchObject({ parentRating: 2, parentNote: 'Confusing picture' });
    expect(await db.challenges.get('c3')).toMatchObject({ parentRating: null, parentNote: '' });
    expect(await db.challenges.get('c4')).toMatchObject({ parentRating: null, parentNote: '' });
    await rateLibraryItem(item.id, null, '');
    expect(await db.challenges.get('c1')).toMatchObject({ parentRating: null, parentNote: '' });
  });
});

describe('avoidNotesFor', () => {
  it('returns the notes of low-rated items of that skill only', async () => {
    const low = await seed();
    const high = await seed();
    const otherSkill = await seed({}, { skillId: 'math-addition-subtraction' });
    const noNote = await seed();
    await rateLibraryItem(low.id, 1, 'Too much reading');
    await rateLibraryItem(high.id, 5, 'Loved it');
    await rateLibraryItem(otherSkill.id, 2, 'Numbers too big');
    await rateLibraryItem(noNote.id, 2, '   ');
    expect(await avoidNotesFor('math-counting-cardinality')).toEqual(['Too much reading']);
    expect(await avoidNotesFor('math-addition-subtraction')).toEqual(['Numbers too big']);
    expect(await avoidNotesFor('science-weather-water')).toEqual([]);
  });

  it('keeps the five most recent, newest first, without repeats', async () => {
    for (let i = 1; i <= 7; i += 1) {
      const item = await seed();
      await rateLibraryItem(item.id, i % 2 === 0 ? 2 : 1, i === 6 ? 'note 7' : `note ${i}`);
    }
    expect(await avoidNotesFor('math-counting-cardinality')).toEqual(['note 7', 'note 5', 'note 4', 'note 3', 'note 2']);
  });

  it('cuts each note to 200 characters on one line', async () => {
    const item = await seed();
    await rateLibraryItem(item.id, 1, `first line\nsecond   line ${'y'.repeat(400)}`);
    const [note] = await avoidNotesFor('math-counting-cardinality');
    expect(note).toHaveLength(200);
    expect(note?.startsWith('first line second line y')).toBe(true);
  });

  it('forgets a note once the rating is raised', async () => {
    const item = await seed();
    await rateLibraryItem(item.id, 2, 'Too hard');
    await rateLibraryItem(item.id, 4);
    expect(await avoidNotesFor('math-counting-cardinality')).toEqual([]);
  });
});

describe('libraryStats', () => {
  it('is all zero for an empty library', async () => {
    expect(await libraryStats()).toEqual({ total: 0, rated: 0, retired: 0, reusedServes: 0 });
  });

  it('counts items, ratings, retired items and serves after the first', async () => {
    const a = await seed();
    const b = await seed();
    const c = await seed();
    await seed();
    await markServed(a.id, 'kid-a');
    await markServed(a.id, 'kid-b');
    await markServed(a.id, 'kid-c');
    await markServed(b.id, 'kid-a');
    await rateLibraryItem(b.id, 5);
    await rateLibraryItem(c.id, 1);
    expect(await libraryStats()).toEqual({ total: 4, rated: 2, retired: 1, reusedServes: 2 });
  });
});

describe('listLibrary', () => {
  it('lists everything newest first', async () => {
    const first = await seed();
    const second = await seed();
    const third = await seed();
    expect((await listLibrary()).map((item) => item.id)).toEqual([third.id, second.id, first.id]);
  });

  it('filters by strand, grade, interaction and mode', async () => {
    const math = await seed();
    const science = await seed({}, { skillId: 'science-weather-water', strand: 'science', stage: makeStage('2', 'starting'), mode: 'experiment' });
    const choice = await saveToLibrary({
      content: ChallengeSchema.parse({
        ...content('Which is bigger?', 1, 'Bigger'),
        interaction: { kind: 'choice', options: [{ id: 'a', label: '2' }, { id: 'b', label: '9' }], correctIds: ['b'] },
      }),
      plan: plan({ interaction: 'choice' }),
      ageGroup: '3-5',
      locale: 'en',
      origin: 'ai',
    }, T0 + 99);
    const ids = async (filter: Parameters<typeof listLibrary>[0]) => (await listLibrary(filter)).map((item) => item.id);
    expect(await ids({ strand: 'science' })).toEqual([science.id]);
    expect(await ids({ grade: 'K' })).toEqual([choice.id, math.id]);
    expect(await ids({ strand: 'math', grade: 'K' })).toEqual([choice.id, math.id]);
    expect(await ids({ strand: 'math', grade: '2' })).toEqual([]);
    expect(await ids({ interaction: 'choice' })).toEqual([choice.id]);
    expect(await ids({ mode: 'experiment' })).toEqual([science.id]);
    expect(await ids({ strand: 'math', interaction: 'number', mode: 'quest' })).toEqual([math.id]);
  });

  it('filters by rating group, exact stars and retired state', async () => {
    const one = await seed();
    const three = await seed();
    const four = await seed();
    const five = await seed();
    const unrated = await seed();
    await rateLibraryItem(one.id, 1);
    await rateLibraryItem(three.id, 3);
    await rateLibraryItem(four.id, 4);
    await rateLibraryItem(five.id, 5);
    const ids = async (filter: Parameters<typeof listLibrary>[0]) => (await listLibrary(filter)).map((item) => item.id);
    expect(await ids({ rating: 'unrated' })).toEqual([unrated.id]);
    expect(await ids({ rating: 'low' })).toEqual([one.id]);
    expect(await ids({ rating: 'high' })).toEqual([five.id, four.id]);
    expect(await ids({ rating: 3 })).toEqual([three.id]);
    expect(await ids({ retired: true })).toEqual([one.id]);
    expect(await ids({ retired: false })).toEqual([unrated.id, five.id, four.id, three.id]);
  });

  it('searches the title, question, theme and skill name, every word, any case', async () => {
    const stars = await saveToLibrary({ content: content('How many stars are in the sky?', 4, 'Starry Night'), plan: plan({ theme: 'space' }), ageGroup: '3-5', locale: 'en', origin: 'ai' }, T0 + 1);
    const dinos = await saveToLibrary({ content: content('How many eggs did the dinosaur lay?', 6, 'Dino Nest'), plan: plan({ theme: 'dinosaurs' }), ageGroup: '3-5', locale: 'en', origin: 'ai' }, T0 + 2);
    const ids = async (search: string) => (await listLibrary({ search })).map((item) => item.id);
    expect(await ids('starry')).toEqual([stars.id]);
    expect(await ids('  DINO   eggs ')).toEqual([dinos.id]);
    expect(await ids('dinosaurs')).toEqual([dinos.id]);
    expect(await ids('how many')).toEqual([dinos.id, stars.id]);
    expect(await ids('starry eggs')).toEqual([]);
    expect(await ids('   ')).toEqual([dinos.id, stars.id]);
    // The skill's name from the skill map is searchable too.
    expect((await ids('cardinality')).length).toBe(2);
  });
});

describe('deleteLibraryItem', () => {
  it('removes the item, clears the link on challenges and on remixes', async () => {
    const item = await seed();
    const keep = await seed();
    const remix = await saveToLibrary({ content: content('How many rockets?', 9), plan: plan(), ageGroup: '3-5', locale: 'en', origin: 'remix', remixOf: item.id });
    await db.challenges.bulkPut([challengeRow('c1', item.id), challengeRow('c2', keep.id), challengeRow('c3', null)]);
    await rateLibraryItem(item.id, 4, 'Nice');

    await deleteLibraryItem(item.id);

    expect(await db.library.get(item.id)).toBeUndefined();
    expect(await db.library.count()).toBe(2);
    expect((await db.library.get(remix.id))?.remixOf).toBeNull();
    // The child's history keeps the challenge and the parent's rating of it.
    expect(await db.challenges.get('c1')).toMatchObject({ libraryId: null, parentRating: 4, parentNote: 'Nice' });
    expect((await db.challenges.get('c2'))?.libraryId).toBe(keep.id);
    expect((await db.challenges.get('c3'))?.libraryId).toBeNull();
  });

  it('ignores an unknown id', async () => {
    const item = await seed();
    await expect(deleteLibraryItem('nope')).resolves.toBeUndefined();
    expect(await db.library.get(item.id)).toBeDefined();
  });
});
