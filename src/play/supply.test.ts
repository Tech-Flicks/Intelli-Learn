import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStage, stageStep } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { expectationAt, getSkill } from '@/core/skills';
import type {
  ChallengePlan,
  ChallengeRecord,
  ChildProfile,
  LibraryItem,
  ParentalControls,
  SkillState,
  StoryRecord,
} from '@/core/types';
import { createChild, db, exportBackup, getSettings, parseBackup, recordUsage, updateSettings } from '@/data';
import { generateChallenge, generateImage, generateStoryOutline, remixChallenge } from '@/ai';
import { rateLibraryItem, saveToLibrary } from '@/library';
import { pickOfflineChallenge, pickOfflineStory } from '@/offline';
import { planNext, placementStatus, recordAttempt, seededRng } from '@/progression';
import {
  advanceStory,
  buildContext,
  ensureQueue,
  makeSibling,
  prepareConceptCheck,
  resetSupply,
  setSupplyDeps,
  startStory,
  supplyIdle,
  takeNext,
} from './supply';

vi.mock('@/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/ai')>();
  return {
    ...real,
    generateChallenge: vi.fn(),
    remixChallenge: vi.fn(),
    generateStoryOutline: vi.fn(),
    generateImage: vi.fn(),
  };
});

vi.mock('@/progression', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/progression')>();
  return { ...real, planNext: vi.fn(real.planNext) };
});

const realProgression = await vi.importActual<typeof import('@/progression')>('@/progression');
const realAi = await vi.importActual<typeof import('@/ai')>('@/ai');

const generate = vi.mocked(generateChallenge);
const remix = vi.mocked(remixChallenge);
const outline = vi.mocked(generateStoryOutline);
const image = vi.mocked(generateImage);
const plan$ = vi.mocked(planNext);

/** Monday 9 November 2026, 10:00 local time. */
const T0 = new Date(2026, 10, 9, 10, 0, 0).getTime();
let clock = T0;
const tick = (): number => (clock += 1000);

/** What the mocked AI answers with. */
let aiSource: 'ai' | 'offline' = 'ai';
let cannedCount = 0;

const ADDITION = 'math-addition-subtraction';
const COUNTING = 'math-counting-cardinality';
const WEATHER = 'science-weather-water';

/** A valid challenge for the plan that is different from every other canned one. */
function canned(plan: ChallengePlan, label = 'AI'): Challenge {
  cannedCount += 1;
  const base = pickOfflineChallenge(plan, { seed: cannedCount });
  return ChallengeSchema.parse({
    ...base,
    title: `${label} ${cannedCount} ${base.title}`.slice(0, 60),
    question: `${base.question.slice(0, 260)} (${label} ${cannedCount})`,
  });
}

function fixedPlan(childId: string, patch: Partial<ChallengePlan> = {}): ChallengePlan {
  return {
    childId,
    skillId: ADDITION,
    strand: 'math',
    stage: makeStage('2', 'growing'),
    interaction: 'number',
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
    ...patch,
  };
}

/** Makes the planner answer with this plan (for the right child) from now on. */
function alwaysPlan(patch: Partial<ChallengePlan> = {}): void {
  plan$.mockImplementation(async (childId, count = 1) =>
    Array.from({ length: count }, () => fixedPlan(childId, patch)),
  );
}

async function addChild(patch: Partial<ChildProfile> = {}): Promise<ChildProfile> {
  const child = await createChild({ nickname: 'Zuzu', avatar: '🦊', ageGroup: '6-8', grade: '2', interests: ['space', 'robots'] }, T0 - 86_400_000);
  await db.children.update(child.id, { placementDone: true, ...patch });
  return (await db.children.get(child.id)) as ChildProfile;
}

async function setControls(patch: Partial<ParentalControls>): Promise<void> {
  await updateSettings((current) => ({ ...current, controls: { ...current.controls, ...patch } }));
}

async function putState(childId: string, skillId: string, patch: Partial<SkillState> = {}): Promise<SkillState> {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`unknown skill ${skillId}`);
  const state: SkillState = {
    id: `${childId}:${skillId}`,
    childId,
    skillId,
    strand: skill.strand,
    stage: makeStage('2', 'growing'),
    mastery: 40,
    assistedStreak: 0,
    independentStreak: 1,
    attempts: 5,
    checkPending: false,
    checksPassed: 0,
    recentInteractions: ['number'],
    lastPracticedAt: T0 - 3_600_000,
    reviewDueAt: null,
    reviewIntervalDays: 2,
    ...patch,
  };
  await db.skillStates.put(state);
  return state;
}

let rowCount = 0;
/** Stores a challenge row directly, as if it had been built earlier. */
async function putRow(childId: string, patch: Partial<ChallengeRecord> = {}): Promise<ChallengeRecord> {
  rowCount += 1;
  const plan = fixedPlan(childId, {
    skillId: patch.skillId ?? ADDITION,
    strand: patch.strand ?? 'math',
    stage: patch.stage ?? makeStage('2', 'growing'),
    interaction: patch.interaction ?? 'number',
    mode: patch.mode ?? 'quest',
    purpose: patch.purpose ?? 'core',
  });
  const row: ChallengeRecord = {
    id: `row-${rowCount}`,
    ...plan,
    content: canned(plan, 'Row'),
    source: 'offline',
    status: 'queued',
    storyId: null,
    chapterIndex: null,
    libraryId: null,
    parentRating: null,
    parentNote: '',
    createdAt: tick(),
    startedAt: null,
    completedAt: null,
    ...patch,
  };
  await db.challenges.put(row);
  return row;
}

async function complete(record: ChallengeRecord): Promise<void> {
  await db.challenges.update(record.id, { status: 'completed', completedAt: tick() });
}

async function rowsOf(childId: string, status?: ChallengeRecord['status']): Promise<ChallengeRecord[]> {
  const rows = await db.challenges.where('childId').equals(childId).toArray();
  return rows.filter((row) => status === undefined || row.status === status).sort((a, b) => a.createdAt - b.createdAt);
}

/** A library canvas that fits `fixedPlan`, saved as if for another child. */
async function libraryItem(patch: Partial<ChallengePlan> = {}, itemPatch: Partial<LibraryItem> = {}): Promise<LibraryItem> {
  const plan = fixedPlan('someone-else', patch);
  const item = await saveToLibrary({ content: canned(plan, 'Lib'), plan, ageGroup: '6-8', locale: 'en', origin: 'ai' }, tick());
  if (Object.keys(itemPatch).length > 0) await db.library.update(item.id, itemPatch);
  return (await db.library.get(item.id)) as LibraryItem;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  clock = T0;
  aiSource = 'ai';
  cannedCount = 0;
  rowCount = 0;
  resetSupply();
  setSupplyDeps({ now: tick, rng: seededRng(11) });

  generate.mockReset();
  generate.mockImplementation(async (req) =>
    aiSource === 'ai'
      ? { content: canned(req.plan), source: 'ai' }
      : { content: pickOfflineChallenge(req.plan, { avoidTitles: req.avoidTitles, seed: (cannedCount += 1) }), source: 'offline' },
  );
  remix.mockReset();
  remix.mockResolvedValue(null);
  outline.mockReset();
  outline.mockImplementation(async (req) => pickOfflineStory(req.theme, req.chapters));
  image.mockReset();
  image.mockResolvedValue(null);
  plan$.mockReset();
  plan$.mockImplementation(realProgression.planNext);
});

afterEach(async () => {
  await supplyIdle();
});

// ---------------------------------------------------------------------------

describe('buildContext', () => {
  it('carries age group, grade, interests, content language and strictness, and nothing that names the child', async () => {
    const child = await addChild({ interests: ['  space ', 'Space', '', 'robots   and  rockets'], controlsOverride: { strictness: 'standard' } });
    const settings = await updateSettings({ contentLocale: 'es', locale: 'en' });
    const context = buildContext(child, settings);
    expect(context).toEqual({
      ageGroup: '6-8',
      grade: '2',
      interests: ['space', 'robots and rockets'],
      locale: 'es',
      strictness: 'standard',
    });
    expect(JSON.stringify(context)).not.toContain('Zuzu');
    expect(JSON.stringify(context)).not.toContain(child.id);
  });

  it('uses the device-wide strictness without an override and survives odd interests', async () => {
    const child = await addChild();
    const settings = await getSettings();
    const odd = { ...child, interests: [42, 'x'.repeat(80), ...Array.from({ length: 12 }, (_, i) => `topic ${i}`)] as unknown as string[] };
    const context = buildContext(odd, settings);
    expect(context.strictness).toBe('strict');
    expect(context.interests).toHaveLength(8);
    expect(context.interests[0]).toHaveLength(30);
  });
});

describe('ensureQueue', () => {
  it('fills an empty queue to five challenges, each stored with its plan and kept in the library', async () => {
    const child = await addChild();
    await ensureQueue(child.id);

    const queued = await rowsOf(child.id, 'queued');
    expect(queued).toHaveLength(5);
    expect(generate).toHaveBeenCalledTimes(5);
    for (const row of queued) {
      expect(row).toMatchObject({ childId: child.id, source: 'ai', status: 'queued', startedAt: null, completedAt: null, storyId: null, chapterIndex: null });
      expect(row.interaction).toBe(row.content.interaction.kind);
      expect(getSkill(row.skillId)?.strand).toBe(row.strand);
      const item = await db.library.get(row.libraryId ?? '');
      expect(item).toMatchObject({ origin: 'ai', skillId: row.skillId, interaction: row.interaction, seenBy: [child.id], uses: 1, ageGroup: '6-8', locale: 'en' });
      expect(item?.content).toEqual(row.content);
    }
    expect(await db.library.count()).toBe(5);
  });

  it('builds one after the other, never two at once', async () => {
    const child = await addChild();
    let running = 0;
    let most = 0;
    generate.mockImplementation(async (req) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 2));
      running -= 1;
      return { content: canned(req.plan), source: 'ai' };
    });
    await ensureQueue(child.id);
    expect(generate).toHaveBeenCalledTimes(5);
    expect(most).toBe(1);
  });

  it('leaves a queue of three or more alone and tops a shorter one up to the target', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION);
    for (let i = 0; i < 3; i += 1) await putRow(child.id);
    await ensureQueue(child.id);
    expect(generate).not.toHaveBeenCalled();
    expect(await rowsOf(child.id, 'queued')).toHaveLength(3);

    const [first] = await rowsOf(child.id, 'queued');
    await db.challenges.update(first?.id ?? '', { status: 'completed', completedAt: tick() });
    await ensureQueue(child.id);
    expect(await rowsOf(child.id, 'queued')).toHaveLength(5);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('honours min and target', async () => {
    const child = await addChild();
    await ensureQueue(child.id, { min: 1, target: 2 });
    expect(await rowsOf(child.id, 'queued')).toHaveLength(2);
    await ensureQueue(child.id, { min: 2, target: 4 });
    expect(await rowsOf(child.id, 'queued')).toHaveLength(2);
    await ensureQueue(child.id, { min: 3, target: 4 });
    expect(await rowsOf(child.id, 'queued')).toHaveLength(4);
  });

  it('shares one run between concurrent calls', async () => {
    const child = await addChild();
    const first = ensureQueue(child.id);
    const second = ensureQueue(child.id);
    const third = ensureQueue(child.id, { min: 9, target: 10 });
    expect(second).toBe(first);
    expect(third).toBe(first);
    await Promise.all([first, second, third]);
    expect(await rowsOf(child.id, 'queued')).toHaveLength(5);
    expect(generate).toHaveBeenCalledTimes(5);
  });

  it('runs separately for two children', async () => {
    const one = await addChild();
    const two = await addChild();
    const a = ensureQueue(one.id);
    const b = ensureQueue(two.id);
    expect(a).not.toBe(b);
    await Promise.all([a, b]);
    expect(await rowsOf(one.id, 'queued')).toHaveLength(5);
    expect(await rowsOf(two.id, 'queued')).toHaveLength(5);
  });

  it('never rejects: a failing AI ends in offline challenges', async () => {
    const child = await addChild();
    generate.mockRejectedValue(new Error('the model is on fire'));
    remix.mockRejectedValue(new Error('so is the remixer'));
    await expect(ensureQueue(child.id)).resolves.toBeUndefined();
    const queued = await rowsOf(child.id, 'queued');
    expect(queued).toHaveLength(5);
    expect(queued.every((row) => row.source === 'offline' && row.libraryId === null)).toBe(true);
    expect(await db.library.count()).toBe(0);
  });

  it('never rejects for a child that does not exist or when the planner fails', async () => {
    await expect(ensureQueue('nobody')).resolves.toBeUndefined();
    const child = await addChild();
    plan$.mockRejectedValue(new Error('no plan today'));
    await expect(ensureQueue(child.id)).resolves.toBeUndefined();
    expect(await rowsOf(child.id)).toHaveLength(0);
  });

  it('does not store offline results in the library', async () => {
    const child = await addChild();
    aiSource = 'offline';
    await ensureQueue(child.id);
    const queued = await rowsOf(child.id, 'queued');
    expect(queued).toHaveLength(5);
    expect(queued.every((row) => row.source === 'offline' && row.libraryId === null)).toBe(true);
    expect(await db.library.count()).toBe(0);
  });

  it('stops asking the AI once the budget check fails twice in a row, and fills the rest offline', async () => {
    const child = await addChild();
    await updateSettings((current) => ({ ...current, ai: { ...current.ai, dailyRequestBudget: 1 } }));
    await recordUsage({ requests: 1 }, T0);
    aiSource = 'offline'; // what the real generateChallenge answers with when the budget is spent
    await ensureQueue(child.id);
    const queued = await rowsOf(child.id, 'queued');
    expect(queued).toHaveLength(5);
    expect(queued.every((row) => row.source === 'offline')).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(remix).not.toHaveBeenCalled();
  });

  it('keeps asking the AI while the budget holds', async () => {
    const child = await addChild();
    await updateSettings((current) => ({ ...current, ai: { ...current.ai, dailyRequestBudget: 50 } }));
    await recordUsage({ requests: 10 }, T0);
    await ensureQueue(child.id);
    expect(generate).toHaveBeenCalledTimes(5);
  });

  it('keeps exactly one challenge ahead while placement is running', async () => {
    const child = await addChild({ placementDone: false });
    await ensureQueue(child.id);
    await ensureQueue(child.id);
    const queued = await rowsOf(child.id, 'queued');
    expect(queued).toHaveLength(1);
    expect(queued[0]?.purpose).toBe('placement');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('writes rows the device backup accepts', async () => {
    const child = await addChild();
    await libraryItem();
    await ensureQueue(child.id);
    await takeNext(child.id, { mode: 'story' });
    await supplyIdle();
    const backup = await exportBackup();
    expect(() => parseBackup(JSON.parse(JSON.stringify(backup)))).not.toThrow();
  });
});

describe('takeNext: resume and the queue', () => {
  it('takes the oldest queued challenge and makes it active', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION);
    const oldest = await putRow(child.id);
    await putRow(child.id);
    await putRow(child.id);
    await putRow(child.id);
    const taken = await takeNext(child.id);
    expect(taken.id).toBe(oldest.id);
    expect(taken.status).toBe('active');
    expect(taken.startedAt).toBeGreaterThan(oldest.createdAt);
    expect(await db.challenges.get(oldest.id)).toEqual(taken);
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns the active challenge again until it is completed: no skipping', async () => {
    const child = await addChild();
    const first = await takeNext(child.id);
    await supplyIdle();
    const again = await takeNext(child.id);
    const andAgain = await takeNext(child.id, {});
    expect(again.id).toBe(first.id);
    expect(andAgain.id).toBe(first.id);
    expect(await rowsOf(child.id, 'active')).toHaveLength(1);

    await complete(first);
    const next = await takeNext(child.id);
    expect(next.id).not.toBe(first.id);
    expect(next.status).toBe('active');
  });

  it('builds one on the spot when the queue is empty, then tops the queue up in the background', async () => {
    const child = await addChild();
    const taken = await takeNext(child.id);
    expect(taken.status).toBe('active');
    expect(taken.startedAt).toBe(taken.createdAt);
    expect(taken.source).toBe('ai');
    await supplyIdle();
    expect(await rowsOf(child.id, 'active')).toHaveLength(1);
    expect(await rowsOf(child.id, 'queued')).toHaveLength(5);
  });

  it('gives two callers at the same moment the same challenge', async () => {
    const child = await addChild();
    const [a, b] = await Promise.all([takeNext(child.id), takeNext(child.id)]);
    expect(a.id).toBe(b.id);
    await supplyIdle();
    expect(await rowsOf(child.id, 'active')).toHaveLength(1);
  });

  it('waits for a challenge that a top-up is already making instead of making another', async () => {
    const child = await addChild();
    const gate = deferred<void>();
    generate.mockImplementationOnce(async (req) => {
      await gate.promise;
      return { content: canned(req.plan, 'First'), source: 'ai' };
    });
    const filling = ensureQueue(child.id);
    const taking = takeNext(child.id);
    await new Promise((done) => setTimeout(done, 20));
    expect(generate).toHaveBeenCalledTimes(1);
    gate.resolve();
    const taken = await taking;
    expect(taken.content.title.startsWith('First')).toBe(true);
    expect(taken.status).toBe('active');
    await filling;
    await supplyIdle();
    expect(await rowsOf(child.id, 'active')).toHaveLength(1);
  });

  it('serves concept checks first, then siblings, then the oldest', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION);
    await putState(child.id, COUNTING);
    await putState(child.id, WEATHER, { checkPending: true });
    const oldCore = await putRow(child.id, { skillId: ADDITION });
    const newCore = await putRow(child.id, { skillId: COUNTING });
    const sibling = await putRow(child.id, { skillId: ADDITION, purpose: 'sibling', stage: makeStage('2', 'starting') });
    const check = await putRow(child.id, { skillId: WEATHER, strand: 'science', purpose: 'check' });

    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const taken = await takeNext(child.id);
      order.push(taken.id);
      await supplyIdle();
      if (taken.id === check.id) await db.skillStates.update(`${child.id}:${WEATHER}`, { checkPending: false });
      await complete(taken);
    }
    expect(order).toEqual([check.id, sibling.id, oldCore.id, newCore.id]);
  });

  it('only takes queued challenges of the mode or strand that was asked for', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION);
    await putState(child.id, WEATHER);
    await putState(child.id, 'technology-sequencing');
    const math = await putRow(child.id, { skillId: ADDITION });
    const science = await putRow(child.id, { skillId: WEATHER, strand: 'science', interaction: 'choice' });
    const robot = await putRow(child.id, { skillId: 'technology-sequencing', strand: 'technology', interaction: 'robot', mode: 'robot' });

    expect((await takeNext(child.id, { mode: 'robot' })).id).toBe(robot.id);
    await complete(robot);
    expect((await takeNext(child.id, { strand: 'science' })).id).toBe(science.id);
    await complete(science);
    expect((await takeNext(child.id)).id).toBe(math.id);
  });

  it('leaves an active challenge of another mode active and returns it on the next plain request', async () => {
    const child = await addChild();
    const quest = await takeNext(child.id);
    await supplyIdle();
    expect(quest.mode).not.toBe('robot');

    const robot = await takeNext(child.id, { mode: 'robot' });
    await supplyIdle();
    expect(robot.id).not.toBe(quest.id);
    expect(robot.mode).toBe('robot');
    expect(robot.interaction).toBe('robot');
    expect((await db.challenges.get(quest.id))?.status).toBe('active');

    expect((await takeNext(child.id, { mode: 'robot' })).id).toBe(robot.id);
    // No mode: the one that was started first comes back.
    expect((await takeNext(child.id)).id).toBe(quest.id);
    await complete(quest);
    expect((await takeNext(child.id)).id).toBe(robot.id);
  });

  it('treats "quest" as ordinary play, and a mission as ordinary play while missions are off', async () => {
    const child = await addChild();
    await setControls({ realWorldMissions: false });
    const first = await takeNext(child.id);
    await supplyIdle();
    expect((await takeNext(child.id, { mode: 'quest' })).id).toBe(first.id);
    expect((await takeNext(child.id, { mode: 'mission' })).id).toBe(first.id);
    expect((await takeNext(child.id, { mode: 'nonsense' as never, strand: 'cooking' as never })).id).toBe(first.id);
    expect((await rowsOf(child.id)).every((row) => row.mode !== 'mission')).toBe(true);
  });

  it('builds a mission when missions are allowed', async () => {
    const child = await addChild();
    const mission = await takeNext(child.id, { mode: 'mission' });
    expect(mission.mode).toBe('mission');
    expect(['choice', 'number']).toContain(mission.interaction);
  });

  it('stays inside the strand that was asked for when it builds', async () => {
    const child = await addChild();
    const taken = await takeNext(child.id, { strand: 'science' });
    expect(taken.strand).toBe('science');
  });

  it('rejects for a child that does not exist', async () => {
    await expect(takeNext('nobody')).rejects.toThrow(/not found/);
  });

  it('still hands over a challenge when the AI throws', async () => {
    const child = await addChild();
    generate.mockRejectedValue(new Error('boom'));
    const taken = await takeNext(child.id);
    expect(taken.source).toBe('offline');
    expect(taken.status).toBe('active');
    expect(ChallengeSchema.safeParse(taken.content).success).toBe(true);
  });

  it('serves placement challenges first for a new child', async () => {
    const child = await addChild({ placementDone: false });
    const taken = await takeNext(child.id);
    expect(taken.purpose).toBe('placement');
    await supplyIdle();
    expect(await rowsOf(child.id, 'queued')).toHaveLength(1);
  });
});

describe('takeNext: stale queue items', () => {
  it('discards what went stale and serves the rest', async () => {
    const child = await addChild();
    await setControls({ realWorldMissions: false, strands: { math: true, science: true, technology: true, engineering: false, logic: true } });
    await putState(child.id, ADDITION, { stage: makeStage('2', 'growing') });
    await putState(child.id, COUNTING, { stage: makeStage('2', 'ready'), checkPending: true });
    await putState(child.id, WEATHER, { stage: makeStage('2', 'growing') });

    const tooEasy = await putRow(child.id, { skillId: ADDITION, stage: makeStage('1', 'ready') - 1 });
    const practiceWhileCheckPending = await putRow(child.id, { skillId: COUNTING, stage: makeStage('2', 'ready') });
    const disabledStrand = await putRow(child.id, { skillId: 'engineering-structures', strand: 'engineering', interaction: 'choice' });
    const mission = await putRow(child.id, { skillId: WEATHER, strand: 'science', mode: 'mission', interaction: 'choice' });
    const placement = await putRow(child.id, { skillId: 'logic-patterns', strand: 'logic', purpose: 'placement', interaction: 'choice' });
    const checkNotPending = await putRow(child.id, { skillId: WEATHER, strand: 'science', purpose: 'check', interaction: 'choice' });
    const oneStepOff = await putRow(child.id, { skillId: ADDITION, stage: makeStage('2', 'starting') });
    const easySibling = await putRow(child.id, { skillId: ADDITION, purpose: 'sibling', stage: makeStage('1', 'strong') });
    const noStateYet = await putRow(child.id, { skillId: 'logic-patterns', strand: 'logic', interaction: 'choice' });
    const pendingCheck = await putRow(child.id, { skillId: COUNTING, purpose: 'check', stage: makeStage('2', 'ready') });

    const taken = await takeNext(child.id);
    expect(taken.id).toBe(pendingCheck.id);

    const status = async (row: ChallengeRecord) => (await db.challenges.get(row.id))?.status;
    for (const row of [tooEasy, practiceWhileCheckPending, disabledStrand, mission, placement, checkNotPending]) {
      expect(await status(row), row.id).toBe('discarded');
    }
    for (const row of [oneStepOff, easySibling, noStateYet]) {
      expect(await status(row), row.id).toBe('queued');
    }
  });

  it('does not count stale items as queued when topping up', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION, { stage: makeStage('3', 'growing') });
    for (let i = 0; i < 4; i += 1) await putRow(child.id, { skillId: ADDITION, stage: makeStage('2', 'starting') });
    await ensureQueue(child.id);
    expect(await rowsOf(child.id, 'discarded')).toHaveLength(4);
    expect(await rowsOf(child.id, 'queued')).toHaveLength(5);
  });

  it('never discards the active challenge', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION, { stage: makeStage('4', 'growing') });
    const active = await putRow(child.id, { skillId: ADDITION, status: 'active', startedAt: T0 });
    expect((await takeNext(child.id)).id).toBe(active.id);
    await supplyIdle();
    expect((await db.challenges.get(active.id))?.status).toBe('active');
  });
});

describe('where a challenge comes from: library, remix, fresh', () => {
  it('serves a fitting library item as it is when its theme suits the child', async () => {
    const child = await addChild();
    alwaysPlan();
    const item = await libraryItem({ theme: 'robots' }); // one of the child's interests
    const taken = await takeNext(child.id);
    expect(taken).toMatchObject({ source: 'reused', libraryId: item.id, skillId: ADDITION, mode: 'quest', purpose: 'core', theme: 'space' });
    expect(taken.content).toEqual(item.content);
    expect(generate).not.toHaveBeenCalled();
    expect(remix).not.toHaveBeenCalled();
    expect(await db.library.get(item.id)).toMatchObject({ seenBy: [child.id], uses: 1 });
  });

  it('carries the parent rating of a reused item onto the challenge', async () => {
    const child = await addChild();
    alwaysPlan();
    const item = await libraryItem({ theme: 'dinosaurs' });
    await rateLibraryItem(item.id, 5, 'A favourite');
    const taken = await takeNext(child.id);
    // Rated 4 or more: served as it is although the theme is not one of the child's.
    expect(taken).toMatchObject({ source: 'reused', libraryId: item.id, parentRating: 5, parentNote: 'A favourite' });
    expect(remix).not.toHaveBeenCalled();
  });

  it('remixes an item whose theme does not fit, keeps the remix and serves it', async () => {
    const child = await addChild();
    alwaysPlan();
    const item = await libraryItem({ theme: 'dinosaurs' });
    let remixed: Challenge | undefined;
    remix.mockImplementation(async (req) => (remixed = canned(req.plan, 'Remix')));

    const taken = await takeNext(child.id);

    expect(remix).toHaveBeenCalledTimes(1);
    const request = remix.mock.calls[0]?.[0];
    expect(request?.original).toEqual(item.content);
    expect(request?.plan).toEqual(fixedPlan(child.id));
    expect(request?.skillName).toBe(getSkill(ADDITION)?.name);
    expect(request?.expectation).toEqual(expectationAt(getSkill(ADDITION)!, makeStage('2', 'growing')));
    expect(JSON.stringify(request)).not.toContain('Zuzu');

    expect(taken.source).toBe('ai');
    expect(taken.content).toEqual(remixed);
    expect(taken.libraryId).not.toBe(item.id);
    expect(await db.library.get(taken.libraryId ?? '')).toMatchObject({ origin: 'remix', remixOf: item.id, seenBy: [child.id], uses: 1, theme: 'space' });
    // The original was not served, but this child will not be offered it later.
    expect(await db.library.get(item.id)).toMatchObject({ seenBy: [child.id], uses: 0 });
    expect(generate).not.toHaveBeenCalled();
  });

  it('serves the original as it is when the remix fails', async () => {
    const child = await addChild();
    alwaysPlan();
    const item = await libraryItem({ theme: 'dinosaurs' });
    remix.mockResolvedValue(null);
    const taken = await takeNext(child.id);
    expect(remix).toHaveBeenCalledTimes(1);
    expect(taken).toMatchObject({ source: 'reused', libraryId: item.id });
    expect(await db.library.count()).toBe(1);
  });

  it('asks the AI when nothing in the library fits, with everything the prompt needs', async () => {
    const child = await addChild();
    alwaysPlan();
    await db.learnerNotes.put({ childId: child.id, summary: ' Quick with doubles. ', strengths: [], struggles: [], nextFocus: [], attemptsAtUpdate: 3, updatedAt: T0 });
    const disliked = await libraryItem({}, { seenBy: [child.id] });
    await rateLibraryItem(disliked.id, 1, 'Far too wordy');
    await libraryItem({ interaction: 'number', skillId: COUNTING }); // another skill: does not fit
    const earlier = await putRow(child.id, { status: 'completed', completedAt: T0 });

    const taken = await takeNext(child.id);

    expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      plan: fixedPlan(child.id),
      child: { ageGroup: '6-8', grade: '2', interests: ['space', 'robots'], locale: 'en', strictness: 'strict' },
      expectation: expectationAt(getSkill(ADDITION)!, makeStage('2', 'growing')),
      skillName: getSkill(ADDITION)?.name,
      avoidTitles: [earlier.content.title],
      avoidNotes: ['Far too wordy'],
      learnerSummary: 'Quick with doubles.',
    });
    expect(request).not.toHaveProperty('conceptCheck');
    expect(request).not.toHaveProperty('previousSibling');
    expect(request).not.toHaveProperty('story');
    expect(request).not.toHaveProperty('studioIdea');
    const sent = JSON.stringify(request);
    expect(sent).not.toContain('Zuzu');
    expect(sent).not.toContain('🦊');

    expect(taken.source).toBe('ai');
    expect(await db.library.get(taken.libraryId ?? '')).toMatchObject({ origin: 'ai', remixOf: null, seenBy: [child.id], uses: 1, stage: makeStage('2', 'growing'), grade: '2' });
  });

  it('avoids the titles of the latest fifteen challenges', async () => {
    const child = await addChild();
    alwaysPlan();
    const rows: ChallengeRecord[] = [];
    for (let i = 0; i < 18; i += 1) rows.push(await putRow(child.id, { status: 'completed', completedAt: T0 + i }));
    await takeNext(child.id);
    const titles = generate.mock.calls[0]?.[0].avoidTitles ?? [];
    expect(titles).toHaveLength(15);
    expect(titles).toEqual(rows.slice(3).reverse().map((row) => row.content.title));
  });

  it('never reuses an item the child has seen, or a retired one', async () => {
    const child = await addChild();
    alwaysPlan();
    await libraryItem({ theme: 'space' }, { seenBy: [child.id] });
    await libraryItem({ theme: 'space' }, { retired: true });
    const taken = await takeNext(child.id);
    expect(taken.source).toBe('ai');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('falls back to an offline challenge when the AI repeats a canvas that was retired', async () => {
    const child = await addChild();
    alwaysPlan();
    const retired = await libraryItem({ theme: 'space' }, { retired: true, rating: 1 });
    generate.mockResolvedValue({ content: retired.content, source: 'ai' });
    const taken = await takeNext(child.id);
    expect(taken.source).toBe('offline');
    expect(taken.libraryId).toBeNull();
    expect(taken.content).not.toEqual(retired.content);
    expect(await db.library.get(retired.id)).toMatchObject({ uses: 0, seenBy: [] });
  });

  it('takes at most half of a child\'s challenges from the library', async () => {
    const child = await addChild();
    alwaysPlan();
    for (let i = 0; i < 12; i += 1) await libraryItem({ theme: 'space' });
    await ensureQueue(child.id, { min: 10, target: 10 });
    const queued = await rowsOf(child.id, 'queued');
    expect(queued.map((row) => row.source)).toEqual(['reused', 'ai', 'reused', 'ai', 'reused', 'ai', 'reused', 'ai', 'reused', 'ai']);

    // With ten behind them, exactly half from the library: the next one must be new.
    const next = await takeNext(child.id, { mode: 'experiment' });
    expect(next.source).toBe('ai');
  });

  it('counts remixes towards the library half', async () => {
    const child = await addChild();
    alwaysPlan();
    for (let i = 0; i < 12; i += 1) await libraryItem({ theme: 'dinosaurs' });
    remix.mockImplementation(async (req) => canned(req.plan, 'Remix'));
    await ensureQueue(child.id, { min: 10, target: 10 });
    expect(remix).toHaveBeenCalledTimes(5);
    expect(generate).toHaveBeenCalledTimes(5);
    const queued = await rowsOf(child.id, 'queued');
    expect(queued.every((row) => row.source === 'ai')).toBe(true);
    const origins = await Promise.all(queued.map(async (row) => (await db.library.get(row.libraryId ?? ''))?.origin));
    expect(origins).toEqual(['remix', 'ai', 'remix', 'ai', 'remix', 'ai', 'remix', 'ai', 'remix', 'ai']);
  });

  it('uses the library as it is, without remixing, once the AI budget is spent', async () => {
    const child = await addChild();
    alwaysPlan();
    await updateSettings((current) => ({ ...current, ai: { ...current.ai, dailyRequestBudget: 1 } }));
    await recordUsage({ requests: 1 }, T0);
    aiSource = 'offline';
    for (let i = 0; i < 6; i += 1) await libraryItem({ theme: 'dinosaurs' });
    remix.mockImplementation(async (req) => canned(req.plan, 'Remix'));
    await ensureQueue(child.id);
    const sources = (await rowsOf(child.id, 'queued')).map((row) => row.source);
    // The first is built before the budget has failed twice in a row; after that nothing asks the AI.
    expect(sources.slice(1)).toEqual(['offline', 'reused', 'offline', 'reused']);
    expect(remix.mock.calls.length + generate.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('concept checks', () => {
  async function readyForCheck(): Promise<{ child: ChildProfile; questions: string[]; titles: string[]; unseen: LibraryItem }> {
    const child = await addChild();
    await putState(child.id, ADDITION, { checkPending: true, mastery: 90, recentInteractions: ['number', 'number'] });
    const done: ChallengeRecord[] = [];
    for (let i = 0; i < 6; i += 1) done.push(await putRow(child.id, { status: 'completed', completedAt: T0 + i * 10 }));
    await putRow(child.id, { skillId: COUNTING, status: 'completed', completedAt: T0 + 500 });
    // A perfectly fitting canvas the child has never seen: a check must still be made new.
    const unseen = await libraryItem({ theme: 'space', interaction: 'choice' });
    await libraryItem({ theme: 'space', interaction: 'number' });
    await libraryItem({ theme: 'space', interaction: 'order' });
    const latest = done.slice(2).reverse();
    return { child, questions: latest.map((row) => row.content.question), titles: latest.map((row) => row.content.title), unseen };
  }

  it('is planned first, made new, and told the last four questions on the skill', async () => {
    const { child, questions, titles } = await readyForCheck();
    const taken = await takeNext(child.id);

    expect(taken).toMatchObject({ purpose: 'check', skillId: ADDITION, source: 'ai', status: 'active' });
    expect(taken.interaction).not.toBe('number');
    const request = generate.mock.calls[0]?.[0];
    expect(request?.plan.purpose).toBe('check');
    expect(request?.conceptCheck).toEqual({ previousQuestions: questions });
    expect(request?.avoidTitles?.slice(0, 4)).toEqual(titles);
    expect(remix).not.toHaveBeenCalled();
    // Nothing was taken from the library, although fitting items were there.
    const reusedRows = (await rowsOf(child.id)).filter((row) => row.purpose === 'check' && row.source === 'reused');
    expect(reusedRows).toHaveLength(0);
    const untouched = await db.library.filter((item) => item.skillId === ADDITION && item.seenBy.length === 0 && item.uses === 0).count();
    expect(untouched).toBe(3);
  });

  it('prepareConceptCheck builds the check ahead, once', async () => {
    const { child, questions } = await readyForCheck();
    await putState(child.id, COUNTING);
    const olderItem = await putRow(child.id, { skillId: COUNTING });

    await prepareConceptCheck(child.id, ADDITION);
    await prepareConceptCheck(child.id, ADDITION);
    await Promise.all([prepareConceptCheck(child.id, ADDITION), prepareConceptCheck(child.id, ADDITION)]);

    const checks = (await rowsOf(child.id, 'queued')).filter((row) => row.purpose === 'check');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ skillId: ADDITION, source: 'ai' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0].conceptCheck).toEqual({ previousQuestions: questions });

    // It jumps the queue.
    const taken = await takeNext(child.id);
    expect(taken.id).toBe(checks[0]?.id);
    expect(taken.id).not.toBe(olderItem.id);
  });

  it('prepareConceptCheck does nothing when the skill is not waiting for a check', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION, { checkPending: false });
    await prepareConceptCheck(child.id, ADDITION);
    await prepareConceptCheck(child.id, 'not-a-skill');
    await prepareConceptCheck('nobody', ADDITION);
    expect(generate).not.toHaveBeenCalled();
    expect(await db.challenges.count()).toBe(0);
  });

  it('prepareConceptCheck does nothing while a check for the skill is active', async () => {
    const { child } = await readyForCheck();
    const active = await takeNext(child.id);
    await supplyIdle();
    generate.mockClear();
    await prepareConceptCheck(child.id, ADDITION);
    expect(active.purpose).toBe('check');
    const checks = (await rowsOf(child.id)).filter((row) => row.purpose === 'check');
    expect(checks).toHaveLength(1);
  });

  it('prepareConceptCheck does not build when the planner answers with something else, and never rejects', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION, { checkPending: true });
    alwaysPlan({ purpose: 'core' });
    await prepareConceptCheck(child.id, ADDITION);
    expect(await db.challenges.count()).toBe(0);
    plan$.mockRejectedValue(new Error('planner down'));
    await expect(prepareConceptCheck(child.id, ADDITION)).resolves.toBeUndefined();
  });

  it('finds the wanted check behind another skill\'s check', async () => {
    const child = await addChild();
    await putState(child.id, COUNTING, { checkPending: true, lastPracticedAt: T0 - 10_000 });
    await putState(child.id, ADDITION, { checkPending: true, lastPracticedAt: T0 - 5_000 });
    await prepareConceptCheck(child.id, ADDITION);
    const queued = await rowsOf(child.id, 'queued');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ purpose: 'check', skillId: ADDITION });
  });
});

describe('makeSibling', () => {
  it('builds an easier follow-up from the previous question and queues it', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION);
    const previous = await putRow(child.id, { status: 'completed', completedAt: T0, theme: 'robots' });
    await libraryItem({ theme: 'robots', stage: makeStage('2', 'starting') }); // a sibling is never a library item

    const sibling = await makeSibling(previous);

    expect(sibling).toMatchObject({
      childId: child.id,
      skillId: ADDITION,
      purpose: 'sibling',
      status: 'queued',
      interaction: previous.interaction,
      theme: 'robots',
      stage: previous.stage - 1,
      source: 'ai',
    });
    expect(stageStep(sibling.stage)).toBe('starting');
    const request = generate.mock.calls[0]?.[0];
    expect(request?.previousSibling).toEqual({ question: previous.content.question });
    expect(request?.plan.purpose).toBe('sibling');
    expect(remix).not.toHaveBeenCalled();
  });

  it('gives the same sibling when asked twice, also at the same moment', async () => {
    const child = await addChild();
    const previous = await putRow(child.id, { status: 'completed', completedAt: T0 });
    const [a, b] = await Promise.all([makeSibling(previous), makeSibling(previous)]);
    const c = await makeSibling(previous);
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await rowsOf(child.id)).filter((row) => row.purpose === 'sibling')).toHaveLength(1);
  });

  it('is served before older practice, and comes back fresh from the database', async () => {
    const child = await addChild();
    await putState(child.id, ADDITION);
    await putState(child.id, COUNTING);
    await putRow(child.id, { skillId: COUNTING });
    const previous = await putRow(child.id, { status: 'completed', completedAt: T0 });
    const sibling = await makeSibling(previous);
    const taken = await takeNext(child.id);
    expect(taken.id).toBe(sibling.id);
    expect((await makeSibling(previous)).status).toBe('active');
  });

  it('turns the sibling of a story chapter into a plain quest', async () => {
    const child = await addChild();
    const previous = await putRow(child.id, { status: 'completed', completedAt: T0, mode: 'story', storyId: 'story-1', chapterIndex: 0 });
    const sibling = await makeSibling(previous);
    expect(sibling).toMatchObject({ mode: 'quest', storyId: null, chapterIndex: null });
  });

  it('rejects for a child that is gone, and can be asked again', async () => {
    const child = await addChild();
    const previous = await putRow(child.id, { status: 'completed', completedAt: T0 });
    await db.children.delete(child.id);
    await expect(makeSibling(previous)).rejects.toThrow(/not found/);
    await expect(makeSibling(previous)).rejects.toThrow(/not found/);
  });
});

describe('Story Quest', () => {
  it('startStory stores a three-chapter story for a young child and four chapters for an older one', async () => {
    const young = await addChild();
    const story = await startStory(young.id, 'ocean');
    expect(outline).toHaveBeenCalledWith(expect.objectContaining({ theme: 'ocean', chapters: 3 }));
    expect(story).toMatchObject({ childId: young.id, theme: 'ocean', currentChapter: 0, status: 'active' });
    expect(story.chapters).toHaveLength(3);
    expect(story.chapters.every((chapter) => chapter.imageDataUrl === null && chapter.heading !== '' && chapter.narrative !== '')).toBe(true);
    expect(await db.stories.get(story.id)).toEqual(story);

    const older = await addChild({ ageGroup: '9-11', grade: '5' });
    const longer = await startStory(older.id);
    expect(outline).toHaveBeenLastCalledWith(expect.objectContaining({ chapters: 4 }));
    expect(longer.chapters).toHaveLength(4);
    expect(longer.theme).toBe('space'); // the first interest
    const sent = JSON.stringify(outline.mock.calls);
    expect(sent).not.toContain('Zuzu');
  });

  it('startStory replaces an unsuitable theme and closes the story before', async () => {
    const child = await addChild();
    const first = await startStory(child.id, 'a zombie that kills everyone');
    expect(first.theme).toBe('space');
    const second = await startStory(child.id, '   ');
    expect(second.theme).toBe('robots'); // interests take turns
    expect((await db.stories.get(first.id))?.status).toBe('finished');
    expect(await db.stories.where('[childId+status]').equals([child.id, 'active']).count()).toBe(1);
  });

  it('startStory falls back to a built-in story when the outline call throws', async () => {
    const child = await addChild();
    outline.mockRejectedValue(new Error('no story'));
    const story = await startStory(child.id, 'ocean');
    expect(story.chapters).toHaveLength(3);
    expect(story.title).toBe(pickOfflineStory('ocean', 3).title);
  });

  it('serves the chapters in order, each made with its story context', async () => {
    const child = await addChild();
    const expected = pickOfflineStory('space', 3);

    const first = await takeNext(child.id, { mode: 'story' });
    const story = (await db.stories.get(first.storyId ?? '')) as StoryRecord;
    expect(story.title).toBe(expected.title);
    expect(first).toMatchObject({ mode: 'story', storyId: story.id, chapterIndex: 0, status: 'active', source: 'ai' });
    expect(generate.mock.calls[0]?.[0].story).toEqual({
      title: expected.title,
      heading: expected.chapters[0]?.heading,
      narrative: expected.chapters[0]?.narrative,
      illustration: expected.chapters[0]?.illustration,
    });
    expect(generate.mock.calls[0]?.[0].plan.mode).toBe('story');

    // Not solved yet: the same chapter comes back, whatever strand is asked for.
    await supplyIdle();
    expect((await takeNext(child.id, { mode: 'story' })).id).toBe(first.id);
    expect((await takeNext(child.id, { mode: 'story', strand: 'logic' })).id).toBe(first.id);

    const seen = [first];
    for (let chapter = 1; chapter < 3; chapter += 1) {
      await complete(seen[seen.length - 1] as ChallengeRecord);
      const next = await takeNext(child.id, { mode: 'story' });
      await supplyIdle();
      expect(next).toMatchObject({ storyId: story.id, chapterIndex: chapter, mode: 'story' });
      const sent = generate.mock.calls.map((call) => call[0]).find((req) => req.story?.heading === expected.chapters[chapter]?.heading);
      expect(sent?.story?.illustration).toBe(expected.chapters[chapter]?.illustration);
      expect((await db.stories.get(story.id))?.currentChapter).toBe(chapter);
      seen.push(next);
    }
    expect(new Set(seen.map((row) => row.id)).size).toBe(3);

    // The last chapter is solved: the story is finished and the next request opens a new one.
    await complete(seen[2] as ChallengeRecord);
    expect(await advanceStory(story.id)).toMatchObject({ status: 'finished', currentChapter: 2 });
    const fresh = await takeNext(child.id, { mode: 'story' });
    expect(fresh.chapterIndex).toBe(0);
    expect(fresh.storyId).not.toBe(story.id);
    expect((await db.stories.get(fresh.storyId ?? ''))?.status).toBe('active');
  });

  it('never takes a story chapter from the library', async () => {
    const child = await addChild();
    alwaysPlan({ mode: 'story' });
    await libraryItem({ mode: 'story', theme: 'space' });
    const chapter = await takeNext(child.id, { mode: 'story' });
    expect(chapter.source).toBe('ai');
    expect(generate).toHaveBeenCalled();
  });

  it('continues a story that startStory began', async () => {
    const child = await addChild();
    const story = await startStory(child.id, 'ocean');
    const chapter = await takeNext(child.id, { mode: 'story' });
    expect(chapter.storyId).toBe(story.id);
    expect(outline).toHaveBeenCalledTimes(1);
  });

  it('describes the picture from the chapter text when the stored description is gone', async () => {
    const child = await addChild();
    const story = await startStory(child.id, 'ocean');
    await db.kv.clear();
    await takeNext(child.id, { mode: 'story' });
    const sent = generate.mock.calls[0]?.[0].story;
    expect(sent?.illustration.startsWith(`${story.chapters[0]?.heading}. `)).toBe(true);
    expect(sent?.illustration.length).toBeLessThanOrEqual(200);
  });

  it('fetches the chapter picture in the background when AI images are allowed for the child', async () => {
    const child = await addChild({ controlsOverride: { aiImages: true } });
    image.mockResolvedValue('data:image/png;base64,AAAA');
    const chapter = await takeNext(child.id, { mode: 'story' });
    await supplyIdle();
    const expected = pickOfflineStory('space', 3);
    expect(image).toHaveBeenCalledTimes(1);
    expect(image).toHaveBeenCalledWith(expected.chapters[0]?.illustration);
    const story = await db.stories.get(chapter.storyId ?? '');
    expect(story?.chapters[0]?.imageDataUrl).toBe('data:image/png;base64,AAAA');
    expect(story?.chapters[1]?.imageDataUrl).toBeNull();
  });

  it('asks for no picture when AI images are off, and ignores a remote address or a failure', async () => {
    const off = await addChild();
    await takeNext(off.id, { mode: 'story' });
    await supplyIdle();
    expect(image).not.toHaveBeenCalled();

    const remote = await addChild({ controlsOverride: { aiImages: true } });
    image.mockResolvedValue('https://example.com/picture.png');
    const chapter = await takeNext(remote.id, { mode: 'story' });
    await supplyIdle();
    expect((await db.stories.get(chapter.storyId ?? ''))?.chapters[0]?.imageDataUrl).toBeNull();

    const failing = await addChild({ controlsOverride: { aiImages: true } });
    image.mockRejectedValue(new Error('no pictures today'));
    const other = await takeNext(failing.id, { mode: 'story' });
    await supplyIdle();
    expect((await db.stories.get(other.storyId ?? ''))?.chapters[0]?.imageDataUrl).toBeNull();
  });

  it('advanceStory returns undefined for a story that is gone', async () => {
    expect(await advanceStory('nope')).toBeUndefined();
  });
});

describe('Imagination Studio', () => {
  it('passes a harmless idea on, tidied and cut to 80 characters', async () => {
    const child = await addChild();
    const canvas = await takeNext(child.id, { mode: 'studio', idea: '  a purple   dragon\nwho bakes bread  ' });
    expect(canvas.mode).toBe('studio');
    expect(canvas.status).toBe('active');
    expect(generate.mock.calls[0]?.[0].studioIdea).toBe('a purple dragon who bakes bread');
    expect(generate.mock.calls[0]?.[0].plan.mode).toBe('studio');
    await complete(canvas);

    await takeNext(child.id, { mode: 'studio', idea: `a rainbow snail ${'that slides '.repeat(20)}` });
    const idea = generate.mock.calls.map((call) => call[0].studioIdea).find((text) => text?.startsWith('a rainbow snail'));
    expect(idea?.length).toBeLessThanOrEqual(80);
  });

  it('keeps the idea out of the plan, so it only travels as the child\'s own words', async () => {
    const child = await addChild();
    const canvas = await takeNext(child.id, { mode: 'studio', idea: 'a purple dragon' });
    expect(['space', 'robots']).toContain(canvas.theme);
    expect(JSON.stringify(generate.mock.calls[0]?.[0].plan)).not.toContain('dragon');
  });

  it('drops an unsuitable idea and draws the first interest instead', async () => {
    const child = await addChild();
    for (const idea of ['a monster that kills people', 'look at www.example.com now', '   ', undefined]) {
      generate.mockClear();
      const canvas = await takeNext(child.id, { mode: 'studio', ...(idea === undefined ? {} : { idea }) });
      const request = generate.mock.calls[0]?.[0];
      expect(request?.studioIdea, String(idea)).toBe('space');
      expect(request?.plan.theme).toBe('space');
      expect(canvas.theme).toBe('space');
      expect(JSON.stringify(request)).not.toContain('kills');
      expect(JSON.stringify(request)).not.toContain('example.com');
      await complete(canvas);
    }
  });

  it('also checks the part of a long idea that would be cut off', async () => {
    const child = await addChild();
    await takeNext(child.id, { mode: 'studio', idea: `${'a very long and friendly idea about clouds '.repeat(3)} and then it kills everyone` });
    expect(generate.mock.calls[0]?.[0].studioIdea).toBe('space');
  });

  it('never takes a studio canvas from the library and resumes an unfinished one', async () => {
    const child = await addChild();
    alwaysPlan({ mode: 'studio' });
    await libraryItem({ mode: 'studio', theme: 'space' });
    const canvas = await takeNext(child.id, { mode: 'studio', idea: 'a tiny whale' });
    expect(canvas.source).toBe('ai');
    await supplyIdle();
    generate.mockClear();
    const again = await takeNext(child.id, { mode: 'studio', idea: 'something else' });
    expect(again.id).toBe(canvas.id);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('a whole journey with the real AI module in demo mode', () => {
  beforeEach(() => {
    generate.mockImplementation(realAi.generateChallenge);
    remix.mockImplementation(realAi.remixChallenge);
    outline.mockImplementation(realAi.generateStoryOutline);
    image.mockImplementation(realAi.generateImage);
  });

  it('carries a new child through placement and on, one active challenge at a time', async () => {
    const child = await addChild({ placementDone: false });
    const played: ChallengeRecord[] = [];
    let expectSibling: string | null = null;
    let checksPlayed = 0;

    for (let turn = 0; turn < 45; turn += 1) {
      const record = await takeNext(child.id);
      expect(record.status).toBe('active');
      expect(record.childId).toBe(child.id);
      expect(record.source).toBe('offline');
      expect(record.libraryId).toBeNull();
      expect(ChallengeSchema.safeParse(record.content).success).toBe(true);
      expect(played.map((row) => row.id)).not.toContain(record.id);
      expect(await rowsOf(child.id, 'active')).toHaveLength(1);
      // Until the eight placement items are done, nothing else is served (bar the sibling after a walkthrough).
      if (!(await placementStatus(child.id)).done) expect(['placement', 'sibling']).toContain(record.purpose);
      if (record.purpose === 'check') checksPlayed += 1;
      if (expectSibling !== null && record.purpose !== 'check') expect(record.id).toBe(expectSibling);
      expectSibling = null;

      // Every seventh challenge needs the walkthrough; the rest are solved alone.
      const walkthrough = turn % 7 === 6;
      const result = await recordAttempt({
        challenge: record,
        answers: [{ at: tick(), answer: null, correct: true, misconception: null }],
        hintsUsed: walkthrough ? 2 : 0,
        walkthroughUsed: walkthrough,
        teachBackCorrect: null,
        timeMs: 20_000,
        now: tick(),
      });
      expect((await db.challenges.get(record.id))?.status).toBe('completed');
      played.push(record);
      if (walkthrough) {
        const sibling = await makeSibling(record);
        expect(sibling.purpose).toBe('sibling');
        if (sibling.status === 'queued') expectSibling = sibling.id;
      }
      if (result.skillState.checkPending) await prepareConceptCheck(child.id, record.skillId);
      // Half of the time the next request arrives while the top-up is still running.
      if (turn % 2 === 0) await supplyIdle();
    }
    await supplyIdle();

    expect((await placementStatus(child.id)).done).toBe(true);
    expect(checksPlayed).toBeGreaterThan(0);
    expect(await rowsOf(child.id, 'active')).toHaveLength(0);
    const queued = await rowsOf(child.id, 'queued');
    expect(queued.length).toBeGreaterThanOrEqual(3);
    expect(queued.length).toBeLessThanOrEqual(6);
    expect(queued.every((row) => row.purpose !== 'placement')).toBe(true);
    expect(await db.library.count()).toBe(0);
    const backup = await exportBackup();
    expect(() => parseBackup(JSON.parse(JSON.stringify(backup)))).not.toThrow();
  });

  it('plays a whole story with the built-in tales', async () => {
    const child = await addChild();
    const chapters: number[] = [];
    let storyId: string | null = null;
    for (let i = 0; i < 3; i += 1) {
      const record = await takeNext(child.id, { mode: 'story' });
      storyId ??= record.storyId;
      expect(record.storyId).toBe(storyId);
      chapters.push(record.chapterIndex ?? -1);
      await recordAttempt({
        challenge: record,
        answers: [{ at: tick(), answer: null, correct: true, misconception: null }],
        hintsUsed: 0,
        walkthroughUsed: false,
        teachBackCorrect: null,
        timeMs: 10_000,
        now: tick(),
      });
    }
    expect(chapters).toEqual([0, 1, 2]);
    expect((await advanceStory(storyId ?? ''))?.status).toBe('finished');
  });
});
