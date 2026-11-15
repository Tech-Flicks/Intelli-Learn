import { beforeEach, describe, expect, it } from 'vitest';
import { dayKey, makeStage } from '@/core/grades';
import { clampStageToSkill, getSkill } from '@/core/skills';
import { ChallengeSchema } from '@/core/schemas';
import { MODES, STRANDS } from '@/core/types';
import type { AttemptOutcome, AttemptRecord, ChildProfile, RewardRecord, SkillDef, Strand } from '@/core/types';
import { db } from '@/data';
import { BADGES } from './catalog';
import { startSession } from './limits';
import { placementKey, placementStatus, readPlacement } from './placement';
import { planNext } from './plan';
import { recordAttempt } from './record';
import { countersKey } from './rewards';
import { seededRng } from './rng';
import { getStrandStages } from './stats';
import {
  addChild,
  attemptDetails,
  challengeFor,
  challengeFromPlan,
  DAY,
  MONDAY,
  resetDb,
  right,
  sampleContent,
  solve,
  stateFor,
  wrong,
} from './testing';
import { TUNING } from './tuning';

const SATURDAY = MONDAY + 5 * DAY;
const ADDITION = 'math-addition-subtraction';
const COUNTING = 'math-counting-cardinality';

const badgeKeys = (rewards: RewardRecord[]): string[] => rewards.filter((r) => r.kind === 'badge').map((r) => r.key);

async function allBadges(childId: string): Promise<string[]> {
  const rows = await db.rewards.where('[childId+kind]').equals([childId, 'badge']).toArray();
  return rows.map((row) => row.key);
}

function skillOrThrow(id: string | undefined): SkillDef {
  const skill = id ? getSkill(id) : undefined;
  if (!skill) throw new Error(`missing skill ${id}`);
  return skill;
}

async function childNow(id: string): Promise<ChildProfile> {
  const child = await db.children.get(id);
  if (!child) throw new Error('child missing');
  return child;
}

/** A skill in each strand that exists at every grade. */
const SKILL_IN: Record<Strand, string> = {
  math: 'math-geometry-shapes',
  science: 'science-matter',
  technology: 'technology-debugging',
  engineering: 'engineering-structures',
  logic: 'logic-patterns',
};

beforeEach(resetDb);

describe('recordAttempt: what is written', () => {
  it('stores the attempt, completes the challenge and returns the result', async () => {
    const child = await addChild({ grade: '2' });
    const challenge = challengeFor(child.id, { skillId: ADDITION });
    await db.challenges.put(challenge);
    const answers = [wrong(MONDAY - 20_000), right(MONDAY)];

    const result = await recordAttempt({
      challenge,
      answers,
      hintsUsed: 1,
      walkthroughUsed: false,
      teachBackCorrect: null,
      timeMs: 41_234.6,
      now: MONDAY,
    });

    expect(result.attempt).toMatchObject({
      challengeId: challenge.id,
      childId: child.id,
      skillId: ADDITION,
      strand: 'math',
      answers,
      hintsUsed: 1,
      walkthroughUsed: false,
      teachBackCorrect: null,
      outcome: 'nudge',
      timeMs: 41_235,
      starsEarned: 2,
      completedAt: MONDAY,
    });
    expect(await db.attempts.get(result.attempt.id)).toEqual(result.attempt);
    expect(await db.challenges.get(challenge.id)).toMatchObject({
      status: 'completed',
      completedAt: MONDAY,
      startedAt: MONDAY - 41_235,
    });
    expect(result.masteryDelta).toBe(10);
    expect(result.stageChanges).toEqual([]);
    expect(result.suggestBreak).toBe(false);
    expect(await db.skillStates.get(`${child.id}:${ADDITION}`)).toEqual(result.skillState);
  });

  it('keeps what a parent wrote on the stored challenge', async () => {
    const child = await addChild();
    const challenge = challengeFor(child.id, { status: 'active', startedAt: MONDAY - 90_000 });
    await db.challenges.put({ ...challenge, parentRating: 5, parentNote: 'Lovely' });
    await recordAttempt({ challenge, ...attemptDetails('independent', MONDAY), teachBackCorrect: null, timeMs: 1, now: MONDAY });
    expect(await db.challenges.get(challenge.id)).toMatchObject({
      status: 'completed',
      parentRating: 5,
      parentNote: 'Lovely',
      startedAt: MONDAY - 90_000,
    });
  });

  it('stores the challenge when the caller had not saved it', async () => {
    const child = await addChild();
    const challenge = challengeFor(child.id);
    await recordAttempt({ challenge, ...attemptDetails('independent', MONDAY), teachBackCorrect: null, timeMs: 1, now: MONDAY });
    expect((await db.challenges.get(challenge.id))?.status).toBe('completed');
  });

  it('starts a new skill at the enrolled grade when the strand has no stage', async () => {
    const child = await addChild({ grade: '2' });
    const result = await solve(child.id, { challenge: { skillId: ADDITION } });
    expect(result.skillState).toMatchObject({
      stage: makeStage('2', 'starting'),
      mastery: 25,
      attempts: 1,
      independentStreak: 1,
      recentInteractions: ['choice'],
      lastPracticedAt: MONDAY,
    });
  });

  it('starts a new skill at the strand stage, clamped to the skill', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.put(stateFor(child.id, 'math-geometry-shapes', 22));
    const added = await solve(child.id, { challenge: { skillId: 'math-place-value' } });
    expect(added.skillState.stage).toBe(22);
    const counting = await solve(child.id, { challenge: { skillId: 'math-counting-cardinality' }, now: MONDAY + 1 });
    expect(counting.skillState.stage).toBe(makeStage('2', 'ready'));
  });

  it('records an attempt on a skill that is no longer in the skill map', async () => {
    const child = await addChild({ grade: '2' });
    const result = await solve(child.id, { challenge: { skillId: 'retired-skill', strand: 'logic' } });
    expect(result.attempt.strand).toBe('logic');
    expect(result.skillState).toMatchObject({ skillId: 'retired-skill', strand: 'logic', stage: 12, mastery: 25 });
  });

  it('counts the item in the open play session', async () => {
    const child = await addChild();
    const old = await startSession(child.id, MONDAY - DAY);
    const session = await startSession(child.id, MONDAY - 60_000);
    await solve(child.id);
    await solve(child.id, { now: MONDAY + 1000 });
    expect((await db.sessions.get(session.id))?.itemsCompleted).toBe(2);
    expect((await db.sessions.get(old.id))?.itemsCompleted).toBe(0);
  });

  it('writes nothing when the child does not exist', async () => {
    const challenge = challengeFor('ghost');
    await db.challenges.put(challenge);
    await expect(
      recordAttempt({ challenge, ...attemptDetails('independent', MONDAY), teachBackCorrect: null, timeMs: 1, now: MONDAY }),
    ).rejects.toThrow(/not found/);
    expect(await db.attempts.count()).toBe(0);
    expect(await db.rewards.count()).toBe(0);
    expect(await db.skillStates.count()).toBe(0);
    expect((await db.challenges.get(challenge.id))?.status).toBe('queued');
  });
});

describe('recordAttempt: idempotency', () => {
  it('returns the stored attempt and awards nothing twice', async () => {
    const child = await addChild({ grade: '2' });
    const challenge = challengeFor(child.id, { skillId: ADDITION });
    await db.challenges.put(challenge);
    const input = {
      challenge,
      ...attemptDetails('independent', MONDAY),
      teachBackCorrect: true,
      timeMs: 20_000,
      now: MONDAY,
    };
    const first = await recordAttempt(input);
    const second = await recordAttempt({ ...input, now: MONDAY + 5000 });

    expect(second.attempt).toEqual(first.attempt);
    // The caller can tell that this call stored nothing, so it does not count the attempt twice elsewhere.
    expect(first.alreadyRecorded).toBe(false);
    expect(second.alreadyRecorded).toBe(true);
    expect(second.skillState).toEqual(first.skillState);
    expect(second.masteryDelta).toBe(0);
    expect(second.suggestBreak).toBe(false);
    expect(second.rewards.map((r) => r.id).sort()).toEqual(first.rewards.map((r) => r.id).sort());
    expect(await db.attempts.count()).toBe(1);
    expect(await db.rewards.count()).toBe(first.rewards.length);
    const saved = await childNow(child.id);
    expect(saved.stars).toBe(4);
    expect(saved.totalStars).toBe(4);
    expect(saved.companion.xp).toBe(4);
    expect((await db.skillStates.get(`${child.id}:${ADDITION}`))?.attempts).toBe(1);
  });

  it('awards once when the same challenge is recorded twice at the same moment', async () => {
    const child = await addChild();
    const challenge = challengeFor(child.id);
    await db.challenges.put(challenge);
    const input = { challenge, ...attemptDetails('independent', MONDAY), teachBackCorrect: null, timeMs: 1, now: MONDAY };
    const [a, b] = await Promise.all([recordAttempt(input), recordAttempt(input)]);
    expect(a.attempt.id).toBe(b.attempt.id);
    expect(await db.attempts.count()).toBe(1);
    expect((await childNow(child.id)).stars).toBe(3);
  });

  it('returns the stage changes of the original attempt', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.put(stateFor(child.id, ADDITION, 12, { mastery: 85, checkPending: true }));
    const challenge = challengeFor(child.id, { skillId: ADDITION, purpose: 'check' });
    const input = { challenge, ...attemptDetails('independent', MONDAY), teachBackCorrect: null, timeMs: 1, now: MONDAY };
    const first = await recordAttempt(input);
    const second = await recordAttempt(input);
    expect(first.stageChanges).toHaveLength(2);
    expect(second.stageChanges.map((c) => c.id).sort()).toEqual(first.stageChanges.map((c) => c.id).sort());
    expect(await db.stageChanges.count()).toBe(2);
    expect(second.skillState.stage).toBe(13);
  });
});

describe('recordAttempt: mastery and stages', () => {
  it('marks a concept check after three independent solves, without changing the stage', async () => {
    const child = await addChild({ grade: '2' });
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await solve(child.id, { challenge: { skillId: ADDITION }, now: MONDAY + i }));
    expect(results.map((r) => r.skillState.mastery)).toEqual([25, 50, 75]);
    expect(results.map((r) => r.masteryDelta)).toEqual([25, 25, 25]);
    expect(results.map((r) => r.skillState.checkPending)).toEqual([false, false, true]);
    expect(results.every((r) => r.stageChanges.length === 0)).toBe(true);
    expect(await db.stageChanges.count()).toBe(0);
  });

  it('moves the skill and the strand up when the concept check is passed', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.put(stateFor(child.id, ADDITION, 12, { mastery: 85, checkPending: true }));
    const result = await solve(child.id, { challenge: { skillId: ADDITION, purpose: 'check' } });

    expect(result.skillState).toMatchObject({
      stage: 13,
      mastery: TUNING.mastery.afterStepUp,
      checkPending: false,
      checksPassed: 1,
      reviewDueAt: MONDAY + 2 * DAY,
      reviewIntervalDays: 2,
    });
    expect(result.stageChanges).toHaveLength(2);
    expect(result.stageChanges[0]).toMatchObject({
      childId: child.id,
      skillId: ADDITION,
      strand: 'math',
      from: 12,
      to: 13,
      reason: 'mastery',
      at: MONDAY,
    });
    expect(result.stageChanges[1]).toMatchObject({ skillId: null, strand: 'math', from: 12, to: 13, reason: 'mastery' });
    expect(await db.stageChanges.count()).toBe(2);
    expect(badgeKeys(result.rewards)).toEqual(expect.arrayContaining(['level-up', 'double-checker']));
    expect(badgeKeys(result.rewards)).not.toContain('grade-climber');
  });

  it('keeps the stage when the check needed help, and asks for more practice', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.put(stateFor(child.id, ADDITION, 12, { mastery: 85, checkPending: true }));
    const hinted = await solve(child.id, { outcome: 'hint', challenge: { skillId: ADDITION, purpose: 'check' } });
    expect(hinted.skillState).toMatchObject({ stage: 12, mastery: 60, checkPending: false, checksPassed: 0 });
    expect(hinted.masteryDelta).toBe(-25);
    expect(hinted.stageChanges).toEqual([]);
    expect(hinted.attempt.starsEarned).toBe(1);
  });

  it('does not pass a concept check that was solved by trying the options one after the other', async () => {
    const child = await addChild({ grade: '3' });
    await db.skillStates.put(stateFor(child.id, 'science-matter', 17, { mastery: 85, checkPending: true }));
    const result = await solve(child.id, {
      outcome: 'second-try',
      wrongCount: 3,
      challenge: { skillId: 'science-matter', purpose: 'check', stage: 17 },
    });
    // What happened is still told as it was: no help was used.
    expect(result.attempt.outcome).toBe('second-try');
    expect(result.skillState).toMatchObject({
      stage: 17,
      mastery: TUNING.mastery.afterCheckWithHelp,
      checkPending: false,
      checksPassed: 0,
    });
    expect(result.stageChanges).toEqual([]);
    expect(badgeKeys(result.rewards)).not.toContain('level-up');
    expect(badgeKeys(result.rewards)).not.toContain('double-checker');
  });

  it('passes a concept check after one wrong try only when that try did not give the answer away', async () => {
    const child = await addChild({ grade: 'K' });
    const twoOptions = ChallengeSchema.parse({
      ...sampleContent('Which group has more?'),
      interaction: {
        kind: 'choice',
        options: [
          { id: 'a', label: 'The red group' },
          { id: 'b', label: 'The blue group' },
        ],
        correctIds: ['a'],
      },
    });
    await db.skillStates.put(stateFor(child.id, COUNTING, 4, { mastery: 85, checkPending: true }));
    const guessed = await solve(child.id, {
      outcome: 'second-try',
      challenge: { skillId: COUNTING, purpose: 'check', stage: 4, content: twoOptions },
    });
    expect(guessed.skillState).toMatchObject({ stage: 4, checkPending: false, checksPassed: 0 });
    expect(guessed.skillState.mastery).toBe(TUNING.mastery.afterCheckWithHelp);

    // On a typed number a second try gives nothing away: the check still counts.
    await db.skillStates.put(stateFor(child.id, COUNTING, 4, { mastery: 85, checkPending: true }));
    const retried = await solve(child.id, {
      outcome: 'second-try',
      now: MONDAY + 1000,
      challenge: { skillId: COUNTING, purpose: 'check', stage: 4 },
    });
    expect(retried.skillState).toMatchObject({ stage: 5, checksPassed: 1 });
  });

  it('gives an item solved after several wrong tries the mastery of a nudge, not of a second try', async () => {
    const child = await addChild({ grade: '2' });
    const once = await solve(child.id, { outcome: 'second-try', challenge: { skillId: ADDITION } });
    expect(once.masteryDelta).toBe(TUNING.mastery.gain['second-try']);
    const often = await solve(child.id, { outcome: 'second-try', wrongCount: 3, now: MONDAY + 1000, challenge: { skillId: ADDITION } });
    expect(often.attempt.outcome).toBe('second-try');
    expect(often.masteryDelta).toBe(TUNING.mastery.gain.nudge);
  });

  it('writes a strand-level change only when the strand aggregate moves', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.bulkPut([
      stateFor(child.id, ADDITION, 12, { mastery: 85, checkPending: true, attempts: 1 }),
      stateFor(child.id, 'math-geometry-shapes', 12, { attempts: 10 }),
      stateFor(child.id, 'math-place-value', 12, { attempts: 10 }),
    ]);
    const result = await solve(child.id, { challenge: { skillId: ADDITION, purpose: 'check' } });
    // (13 * 2 + 12 * 20) / 22 = 12.09, which still rounds to 12.
    expect(result.stageChanges).toHaveLength(1);
    expect(result.stageChanges[0]?.skillId).toBe(ADDITION);
    expect((await getStrandStages(child.id))[0]).toEqual({ strand: 'math', stage: 12, practisedSkills: 3 });
  });

  it('does not write a step back when the strand mean only dips because an easier skill was practised more', async () => {
    const child = await addChild({ grade: '3' });
    await db.skillStates.bulkPut([
      stateFor(child.id, ADDITION, 16, { attempts: 2, mastery: 0 }),
      stateFor(child.id, 'math-geometry-shapes', 19, { attempts: 2 }),
    ]);
    expect((await getStrandStages(child.id))[0]?.stage).toBe(18);
    const result = await solve(child.id, { challenge: { skillId: ADDITION } });
    // (16 * 3 + 19 * 2) / 5 = 17.2
    expect((await getStrandStages(child.id))[0]?.stage).toBe(17);
    expect(result.stageChanges).toEqual([]);
    expect(await db.stageChanges.count()).toBe(0);
  });

  it('continues the strand history from the last level that was written down', async () => {
    const child = await addChild({ grade: '3' });
    await db.stageChanges.put({
      id: 'earlier',
      childId: child.id,
      skillId: null,
      strand: 'math',
      from: 15,
      to: 16,
      reason: 'mastery',
      at: MONDAY - DAY,
    });
    await db.skillStates.bulkPut([
      stateFor(child.id, ADDITION, 16, { attempts: 5, mastery: 90, checkPending: true }),
      stateFor(child.id, 'math-geometry-shapes', 19, { attempts: 5 }),
    ]);
    // The mean has drifted up since the last entry; after the step up it is (17 * 6 + 19 * 5) / 11 = 17.9.
    const result = await solve(child.id, { challenge: { skillId: ADDITION, purpose: 'check' } });
    const strandRow = result.stageChanges.find((c) => c.skillId === null);
    expect(strandRow).toMatchObject({ strand: 'math', from: 16, to: 18, reason: 'mastery' });
  });

  it('does not count the same strand level twice', async () => {
    const child = await addChild({ grade: '3' });
    await db.stageChanges.put({
      id: 'earlier',
      childId: child.id,
      skillId: null,
      strand: 'math',
      from: 17,
      to: 18,
      reason: 'mastery',
      at: MONDAY - DAY,
    });
    await db.skillStates.bulkPut([
      stateFor(child.id, ADDITION, 16, { attempts: 3, mastery: 90, checkPending: true }),
      stateFor(child.id, 'math-geometry-shapes', 19, { attempts: 2 }),
    ]);
    // The mean had dipped to 17; the step up brings it back to 18, which is already on record.
    const result = await solve(child.id, { challenge: { skillId: ADDITION, purpose: 'check' } });
    expect((await getStrandStages(child.id))[0]?.stage).toBe(18);
    expect(result.stageChanges.map((c) => c.skillId)).toEqual([ADDITION]);
    expect(badgeKeys(result.rewards)).not.toContain('grade-climber');
  });

  it('grants Grade Climber when the strand crosses into a higher grade', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.put(stateFor(child.id, ADDITION, makeStage('2', 'ready'), { mastery: 90, checkPending: true }));
    const result = await solve(child.id, { challenge: { skillId: ADDITION, purpose: 'check' } });
    expect(result.skillState.stage).toBe(makeStage('3', 'starting'));
    expect(badgeKeys(result.rewards)).toContain('grade-climber');
  });

  it('moves the skill and the strand down after three walkthroughs, with reason support', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.put(stateFor(child.id, ADDITION, 12, { mastery: 30 }));
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await solve(child.id, { outcome: 'walkthrough', challenge: { skillId: ADDITION }, now: MONDAY + i }));
    }
    expect(results[1]?.stageChanges).toEqual([]);
    expect(results[2]?.skillState).toMatchObject({ stage: 11, mastery: 50, assistedStreak: 0 });
    expect(results[2]?.stageChanges.map((c) => [c.skillId, c.from, c.to, c.reason])).toEqual([
      [ADDITION, 12, 11, 'support'],
      [null, 12, 11, 'support'],
    ]);
    // Rewards are never taken away: every walkthrough still earned its star.
    expect((await childNow(child.id)).stars).toBe(3);
  });

  it('gives a review 10 mastery and moves the spaced-review schedule on', async () => {
    const child = await addChild({ grade: '2' });
    await db.skillStates.put(
      stateFor(child.id, ADDITION, 13, { mastery: 20, reviewDueAt: MONDAY - 1000, reviewIntervalDays: 2 }),
    );
    const first = await solve(child.id, { challenge: { skillId: ADDITION, purpose: 'review', stage: 12 } });
    expect(first.masteryDelta).toBe(10);
    expect(first.skillState).toMatchObject({ reviewIntervalDays: 7, reviewDueAt: MONDAY + 7 * DAY, stage: 13 });

    const later = MONDAY + 8 * DAY;
    const second = await solve(child.id, { challenge: { skillId: ADDITION, purpose: 'review' }, now: later });
    expect(second.skillState).toMatchObject({ reviewIntervalDays: 21, reviewDueAt: later + 21 * DAY });

    const muchLater = later + 22 * DAY;
    const third = await solve(child.id, {
      outcome: 'walkthrough',
      challenge: { skillId: ADDITION, purpose: 'review' },
      now: muchLater,
    });
    expect(third.skillState).toMatchObject({ reviewIntervalDays: 2, reviewDueAt: muchLater + 2 * DAY });
  });

  it('adds the teach-back bonus to mastery', async () => {
    const child = await addChild({ grade: '2' });
    const result = await solve(child.id, { outcome: 'second-try', teachBack: true });
    expect(result.masteryDelta).toBe(20);
  });
});

describe('recordAttempt: stars and companion', () => {
  it.each([
    ['independent', 3],
    ['second-try', 2],
    ['nudge', 2],
    ['hint', 1],
    ['walkthrough', 1],
  ] as const)('a %s solve earns %i stars, plus one for a correct teach-back', async (outcome, stars) => {
    const child = await addChild({ stars: 10, totalStars: 40 });
    const plain = await solve(child.id, { outcome });
    expect(plain.attempt.starsEarned).toBe(stars);
    const starReward = plain.rewards.find((r) => r.kind === 'star');
    expect(starReward).toMatchObject({ childId: child.id, key: '', amount: stars, at: MONDAY });
    expect(starReward?.reason.length).toBeGreaterThan(10);

    const taught = await solve(child.id, { outcome, teachBack: true, now: MONDAY + 1 });
    expect(taught.attempt.starsEarned).toBe(stars + 1);

    const saved = await childNow(child.id);
    expect(saved.stars).toBe(10 + 2 * stars + 1);
    expect(saved.totalStars).toBe(40 + 2 * stars + 1);
    expect(saved.companion.xp).toBe(2 * stars + 1);
  });

  it('hatches the companion at 15 xp and says why', async () => {
    const child = await addChild();
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await solve(child.id, { now: MONDAY + i }));
    expect(results.slice(0, 4).every((r) => r.rewards.every((reward) => reward.kind !== 'companion'))).toBe(true);
    const growth = results[4]?.rewards.find((r) => r.kind === 'companion');
    expect(growth).toMatchObject({ key: 'fox', amount: 0 });
    expect(growth?.reason).toMatch(/hatched/);
    expect((await childNow(child.id)).companion).toMatchObject({ xp: 15, growth: 1 });
  });

  it('grows the companion again at 60 xp', async () => {
    const child = await addChild({ companion: { species: 'owl', name: 'Hoot', growth: 1, xp: 58 } });
    const result = await solve(child.id);
    expect(result.rewards.some((r) => r.kind === 'companion' && r.key === 'owl')).toBe(true);
    expect((await childNow(child.id)).companion).toEqual({ species: 'owl', name: 'Hoot', growth: 2, xp: 61 });
  });

  it('keeps the star balance equal to the sum of the reward amounts', async () => {
    const child = await addChild();
    const outcomes: AttemptOutcome[] = ['independent', 'walkthrough', 'hint', 'second-try', 'nudge'];
    for (const [i, outcome] of outcomes.entries()) await solve(child.id, { outcome, now: MONDAY + i, teachBack: i % 2 === 0 });
    const rewards = await db.rewards.where('childId').equals(child.id).toArray();
    const sum = rewards.reduce((total, reward) => total + reward.amount, 0);
    expect((await childNow(child.id)).stars).toBe(sum);
  });
});

describe('recordAttempt: streak', () => {
  it('starts at 1, continues on the next day and stays put on the same day', async () => {
    const child = await addChild();
    await solve(child.id, { now: MONDAY });
    expect(await childNow(child.id)).toMatchObject({ streakDays: 1, lastPlayedDay: dayKey(MONDAY) });
    await solve(child.id, { now: MONDAY + 3600_000 });
    expect((await childNow(child.id)).streakDays).toBe(1);
    await solve(child.id, { now: MONDAY + DAY });
    expect(await childNow(child.id)).toMatchObject({ streakDays: 2, lastPlayedDay: dayKey(MONDAY + DAY) });
  });

  it('forgives one missed day and celebrates day three', async () => {
    const child = await addChild();
    await solve(child.id, { now: MONDAY });
    await solve(child.id, { now: MONDAY + DAY });
    const result = await solve(child.id, { now: MONDAY + 3 * DAY });
    expect((await childNow(child.id)).streakDays).toBe(3);
    const streak = result.rewards.find((r) => r.kind === 'streak');
    expect(streak).toMatchObject({ key: '3', amount: 0 });
    expect(streak?.reason).toContain('3 days');
  });

  it('starts again at 1 after two missed days', async () => {
    const child = await addChild({ streakDays: 9, lastPlayedDay: dayKey(MONDAY - 3 * DAY) });
    const result = await solve(child.id, { now: MONDAY });
    expect((await childNow(child.id)).streakDays).toBe(1);
    expect(result.rewards.some((r) => r.kind === 'streak')).toBe(false);
  });

  it.each([7, 14, 30])('celebrates day %i', async (days) => {
    const child = await addChild({ streakDays: days - 1, lastPlayedDay: dayKey(MONDAY - DAY) });
    const result = await solve(child.id, { now: MONDAY });
    expect(result.rewards.find((r) => r.kind === 'streak')?.key).toBe(String(days));
  });
});

describe('recordAttempt: badges', () => {
  it('grants First Spark on the first solve, once', async () => {
    const child = await addChild();
    const first = await solve(child.id, { outcome: 'walkthrough' });
    expect(badgeKeys(first.rewards)).toEqual(['first-spark']);
    const badge = first.rewards.find((r) => r.kind === 'badge');
    expect(badge).toMatchObject({ childId: child.id, amount: 0, at: MONDAY });
    expect(badge?.reason.length).toBeGreaterThan(15);
    const second = await solve(child.id, { outcome: 'walkthrough', now: MONDAY + 1 });
    expect(badgeKeys(second.rewards)).toEqual([]);
    expect(await allBadges(child.id)).toEqual(['first-spark']);
  });

  it('grants the ten-solves badge on the tenth solve', async () => {
    const child = await addChild();
    for (let i = 0; i < 9; i += 1) {
      const result = await solve(child.id, { outcome: 'walkthrough', now: MONDAY + i, challenge: { skillId: SKILL_IN.math } });
      expect(badgeKeys(result.rewards)).not.toContain('solver-10');
    }
    const tenth = await solve(child.id, { outcome: 'walkthrough', now: MONDAY + 10, challenge: { skillId: SKILL_IN.math } });
    expect(badgeKeys(tenth.rewards)).toContain('solver-10');
  });

  it('grants the 50, 100 and 250 solve badges from the stored attempts, even without cached counters', async () => {
    const child = await addChild();
    const rows: AttemptRecord[] = Array.from({ length: 249 }, (_, i) => ({
      id: `old-${i}`,
      challengeId: `old-ch-${i}`,
      childId: child.id,
      skillId: SKILL_IN.math,
      strand: 'math',
      answers: [right(MONDAY - DAY + i)],
      hintsUsed: 2,
      walkthroughUsed: true,
      teachBackCorrect: null,
      outcome: 'walkthrough',
      timeMs: 1000,
      starsEarned: 1,
      completedAt: MONDAY - DAY + i,
    }));
    await db.attempts.bulkAdd(rows);
    const result = await solve(child.id, { outcome: 'hint', challenge: { skillId: SKILL_IN.math } });
    expect(badgeKeys(result.rewards)).toEqual(
      expect.arrayContaining(['first-spark', 'solver-10', 'solver-50', 'solver-100', 'solver-250', 'explorer-math']),
    );
    const cached = (await db.kv.get(countersKey(child.id)))?.value as { solves: number };
    expect(cached.solves).toBe(250);
  });

  it('grants On a Roll after five independent solves in a row, across skills', async () => {
    const child = await addChild();
    const strands: Strand[] = ['math', 'science', 'logic', 'math', 'science'];
    await solve(child.id, { outcome: 'second-try', now: MONDAY - 1, challenge: { skillId: SKILL_IN.logic } });
    let last;
    for (const [i, strand] of strands.entries()) {
      last = await solve(child.id, { now: MONDAY + i, challenge: { skillId: SKILL_IN[strand] } });
      if (i < 4) expect(badgeKeys(last.rewards)).not.toContain('on-a-roll');
    }
    expect(badgeKeys(last?.rewards ?? [])).toContain('on-a-roll');
  });

  it('does not grant On a Roll when the run was broken', async () => {
    const child = await addChild();
    const outcomes: AttemptOutcome[] = ['independent', 'independent', 'nudge', 'independent', 'independent', 'independent'];
    for (const [i, outcome] of outcomes.entries()) await solve(child.id, { outcome, now: MONDAY + i });
    expect(await allBadges(child.id)).not.toContain('on-a-roll');
  });

  it('grants Never Gave Up for solving after three wrong tries', async () => {
    const child = await addChild();
    const two = await solve(child.id, { outcome: 'second-try', wrongCount: 2 });
    expect(badgeKeys(two.rewards)).not.toContain('never-gave-up');
    const three = await solve(child.id, { outcome: 'second-try', wrongCount: 3, now: MONDAY + DAY });
    expect(badgeKeys(three.rewards)).toContain('never-gave-up');
  });

  it.each(STRANDS)('grants the %s explorer badge on the fifth solve in the strand', async (strand) => {
    const child = await addChild();
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await solve(child.id, { outcome: 'walkthrough', now: MONDAY + i, challenge: { skillId: SKILL_IN[strand] } });
      if (i < 4) expect(badgeKeys(last.rewards)).not.toContain(`explorer-${strand}`);
    }
    expect(badgeKeys(last?.rewards ?? [])).toContain(`explorer-${strand}`);
  });

  it('grants STEM All-Rounder once every strand has a solve', async () => {
    const child = await addChild();
    let last;
    for (const [i, strand] of STRANDS.entries()) {
      last = await solve(child.id, { outcome: 'walkthrough', now: MONDAY + i, challenge: { skillId: SKILL_IN[strand] } });
      if (i < STRANDS.length - 1) expect(badgeKeys(last.rewards)).not.toContain('all-rounder');
    }
    expect(badgeKeys(last?.rewards ?? [])).toContain('all-rounder');
  });

  it('grants Star Teacher after five correct teach-backs', async () => {
    const child = await addChild();
    await solve(child.id, { outcome: 'walkthrough', teachBack: false, now: MONDAY - 1 });
    let last;
    for (let i = 0; i < 5; i += 1) last = await solve(child.id, { outcome: 'walkthrough', teachBack: true, now: MONDAY + i });
    expect(badgeKeys(last?.rewards ?? [])).toContain('star-teacher');
    expect((await allBadges(child.id)).filter((key) => key === 'star-teacher')).toHaveLength(1);
  });

  it('grants Mode Explorer after five different modes', async () => {
    const child = await addChild();
    await solve(child.id, { outcome: 'walkthrough', now: MONDAY - 1, challenge: { mode: 'quest' } });
    let last;
    for (const [i, mode] of MODES.slice(0, 5).entries()) {
      last = await solve(child.id, { outcome: 'walkthrough', now: MONDAY + i, challenge: { mode } });
      if (i < 4) expect(badgeKeys(last.rewards)).not.toContain('mode-explorer');
    }
    expect(badgeKeys(last?.rewards ?? [])).toContain('mode-explorer');
  });

  it('grants Robot Coder after five robot solves and Inventor after five builds', async () => {
    const child = await addChild();
    let robot;
    let build;
    for (let i = 0; i < 5; i += 1) {
      robot = await solve(child.id, {
        outcome: 'walkthrough',
        now: MONDAY + i,
        challenge: { skillId: 'technology-loops', interaction: 'robot', mode: 'robot' },
      });
      build = await solve(child.id, {
        outcome: 'walkthrough',
        now: MONDAY + 100 + i,
        challenge: { skillId: 'engineering-structures', interaction: 'build', mode: 'invention' },
      });
      if (i < 4) {
        expect(badgeKeys(robot.rewards)).not.toContain('robot-coder');
        expect(badgeKeys(build.rewards)).not.toContain('inventor');
      }
    }
    expect(badgeKeys(robot?.rewards ?? [])).toContain('robot-coder');
    expect(badgeKeys(build?.rewards ?? [])).toContain('inventor');
  });

  it('grants Weekend Scientist for a science challenge on a Saturday', async () => {
    const child = await addChild();
    const weekday = await solve(child.id, { outcome: 'walkthrough', challenge: { skillId: SKILL_IN.science } });
    expect(badgeKeys(weekday.rewards)).not.toContain('weekend-scientist');
    const mathOnSaturday = await solve(child.id, { outcome: 'walkthrough', now: SATURDAY, challenge: { skillId: SKILL_IN.math } });
    expect(badgeKeys(mathOnSaturday.rewards)).not.toContain('weekend-scientist');
    const weekend = await solve(child.id, { outcome: 'walkthrough', now: SATURDAY + 1, challenge: { skillId: SKILL_IN.science } });
    expect(badgeKeys(weekend.rewards)).toContain('weekend-scientist');
  });

  it('grants Brave Asker for solving after a clue', async () => {
    const child = await addChild();
    const result = await solve(child.id, { outcome: 'nudge' });
    expect(badgeKeys(result.rewards)).toContain('brave-asker');
  });

  it('grants Bounce Back for solving the easier follow-up without help', async () => {
    const child = await addChild();
    await solve(child.id, { outcome: 'walkthrough' });
    const sibling = await solve(child.id, { outcome: 'second-try', now: MONDAY + 1, challenge: { purpose: 'sibling' } });
    expect(badgeKeys(sibling.rewards)).toContain('bounce-back');
  });

  it('grants Memory Keeper after five reviews solved without a hint', async () => {
    const child = await addChild();
    await solve(child.id, { outcome: 'hint', now: MONDAY - 1, challenge: { purpose: 'review' } });
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await solve(child.id, { outcome: i % 2 ? 'second-try' : 'independent', now: MONDAY + i, challenge: { purpose: 'review' } });
      if (i < 4) expect(badgeKeys(last.rewards)).not.toContain('memory-keeper');
    }
    expect(badgeKeys(last?.rewards ?? [])).toContain('memory-keeper');
  });

  it('grants Real-World Explorer after three missions', async () => {
    const child = await addChild();
    let last;
    for (let i = 0; i < 3; i += 1) {
      last = await solve(child.id, { outcome: 'walkthrough', now: MONDAY + i, challenge: { mode: 'mission' } });
      if (i < 2) expect(badgeKeys(last.rewards)).not.toContain('real-world-explorer');
    }
    expect(badgeKeys(last?.rewards ?? [])).toContain('real-world-explorer');
  });

  it('only ever grants badges from the catalogue, each at most once', async () => {
    const child = await addChild({ grade: '2' });
    const known = new Set(BADGES.map((b) => b.key));
    const outcomes: AttemptOutcome[] = ['independent', 'nudge', 'second-try', 'hint', 'walkthrough'];
    for (let i = 0; i < 40; i += 1) {
      const strand = STRANDS[i % STRANDS.length] ?? 'math';
      await solve(child.id, {
        outcome: outcomes[i % 3] ?? 'independent',
        now: MONDAY + i * 3600_000 * 5,
        teachBack: i % 2 === 0,
        wrongCount: i % 7 === 0 ? 3 : undefined,
        challenge: { skillId: SKILL_IN[strand], mode: MODES[i % MODES.length], purpose: i % 4 === 0 ? 'review' : 'core' },
      });
    }
    const granted = await allBadges(child.id);
    expect(granted.length).toBeGreaterThan(8);
    expect(new Set(granted).size).toBe(granted.length);
    for (const key of granted) expect(known.has(key)).toBe(true);
  });
});

describe('recordAttempt: suggesting a break', () => {
  it('suggests a break after rapid random tapping', async () => {
    const child = await addChild();
    const challenge = challengeFor(child.id);
    const answers = [wrong(MONDAY), wrong(MONDAY + 2000), wrong(MONDAY + 4000), wrong(MONDAY + 6000), right(MONDAY + 60_000)];
    const result = await recordAttempt({
      challenge,
      answers,
      hintsUsed: 0,
      walkthroughUsed: false,
      teachBackCorrect: null,
      timeMs: 60_000,
      now: MONDAY + 60_000,
    });
    expect(result.suggestBreak).toBe(true);
    expect(result.attempt.outcome).toBe('second-try');
  });

  it('suggests a break after six wrong answers in a row', async () => {
    const child = await addChild();
    const result = await solve(child.id, { outcome: 'hint', wrongCount: 6 });
    expect(result.suggestBreak).toBe(true);
  });

  it('suggests a break when three attempts in a row ended with the walkthrough', async () => {
    const child = await addChild();
    const results = [];
    for (const [i, strand] of (['math', 'science', 'logic'] as const).entries()) {
      results.push(await solve(child.id, { outcome: 'walkthrough', now: MONDAY + i, challenge: { skillId: SKILL_IN[strand] } }));
    }
    expect(results.map((r) => r.suggestBreak)).toEqual([false, false, true]);
  });

  it('does not suggest a break when the run of walkthroughs was interrupted', async () => {
    const child = await addChild();
    const outcomes: AttemptOutcome[] = ['walkthrough', 'walkthrough', 'nudge', 'walkthrough'];
    const results = [];
    for (const [i, outcome] of outcomes.entries()) results.push(await solve(child.id, { outcome, now: MONDAY + i }));
    expect(results.map((r) => r.suggestBreak)).toEqual([false, false, false, false]);
  });

  it('does not suggest a break for a few calm wrong tries', async () => {
    const child = await addChild();
    const result = await solve(child.id, { outcome: 'second-try', wrongCount: 3 });
    expect(result.suggestBreak).toBe(false);
  });
});

describe('placement, end to end', () => {
  /** Plays the whole placement game with one outcome for every item. */
  async function playPlacement(child: ChildProfile, outcome: AttemptOutcome, seed = 4) {
    const rng = seededRng(seed);
    const results = [];
    const plans = [];
    for (let i = 0; i < TUNING.placement.totalItems; i += 1) {
      const now = MONDAY + i * 60_000;
      expect(await placementStatus(child.id)).toEqual({ done: false, answered: i, total: 8 });
      const [plan] = await planNext(child.id, 1, { rng, now });
      if (!plan) throw new Error('no plan');
      expect(plan.purpose).toBe('placement');
      plans.push(plan);
      const challenge = challengeFromPlan(plan);
      await db.challenges.put(challenge);
      results.push(
        await recordAttempt({ challenge, ...attemptDetails(outcome, now), teachBackCorrect: null, timeMs: 30_000, now }),
      );
    }
    return { results, plans };
  }

  it('places a strong child at or above the enrolled grade', async () => {
    const child = await addChild({ grade: '3', placementDone: false });
    const { results, plans } = await playPlacement(child, 'independent');

    expect(plans.map((p) => p.strand)).toEqual([
      'math', 'science', 'technology', 'engineering', 'logic', 'math', 'science', 'technology',
    ]);
    // The second math item is pitched at the estimate after the first one: grade 2 growing + 4 steps.
    const secondMath = plans[5];
    expect(secondMath?.stage).toBe(clampStageToSkill(skillOrThrow(secondMath?.skillId), 17));
    expect(secondMath?.skillId).not.toBe(plans[0]?.skillId);

    expect(await placementStatus(child.id)).toEqual({ done: true, answered: 8, total: 8 });
    expect((await childNow(child.id)).placementDone).toBe(true);

    const stages = await getStrandStages(child.id);
    expect(stages.map((s) => [s.strand, s.practisedSkills])).toEqual([
      ['math', 2], ['science', 2], ['technology', 2], ['engineering', 1], ['logic', 1],
    ]);
    const stageOf = Object.fromEntries(stages.map((s) => [s.strand, s.stage]));
    // Two independent solves: 13 + 4 + 4 = grade 4, growing: above the enrolled grade. One: 13 + 4 = grade 3, growing.
    expect(stageOf.math).toBe(makeStage('4', 'growing'));
    expect(stageOf.science).toBe(makeStage('4', 'growing'));
    expect(stageOf.engineering).toBe(makeStage('3', 'growing'));
    expect(stageOf.logic).toBe(makeStage('3', 'growing'));

    const states = await db.skillStates.where('childId').equals(child.id).toArray();
    expect(states.map((s) => s.skillId).sort()).toEqual([...new Set(plans.map((p) => p.skillId))].sort());
    for (const state of states) {
      expect(state.mastery).toBe(TUNING.placement.seedMastery);
      expect(state.attempts).toBe(1);
      expect(state.checkPending).toBe(false);
    }

    const changes = await db.stageChanges.where('childId').equals(child.id).toArray();
    expect(changes).toHaveLength(5);
    expect(changes.every((c) => c.reason === 'placement' && c.skillId === null && c.from === 13)).toBe(true);
    expect(Object.fromEntries(changes.map((c) => [c.strand, c.to]))).toEqual(stageOf);
    expect(results[7]?.stageChanges).toHaveLength(5);
    expect(results.slice(0, 7).every((r) => r.stageChanges.length === 0)).toBe(true);

    // Stars are earned during placement like anywhere else.
    expect((await childNow(child.id)).stars).toBe(8 * 3);
    expect(badgeKeys(results[7]?.rewards ?? [])).toContain('trailblazer');
    expect(badgeKeys(results[0]?.rewards ?? [])).toContain('first-spark');

    const [next] = await planNext(child.id, 1, { rng: seededRng(1), now: MONDAY + DAY });
    expect(next?.purpose).not.toBe('placement');
  });

  it('places a struggling child below the enrolled grade', async () => {
    const child = await addChild({ grade: '3', placementDone: false });
    const { results } = await playPlacement(child, 'walkthrough');

    const stageOf = Object.fromEntries((await getStrandStages(child.id)).map((s) => [s.strand, s.stage]));
    // Two walkthroughs: 13 - 3 - 3 = kindergarten, ready. One: 13 - 3 = grade 1, strong.
    expect(stageOf.math).toBe(makeStage('K', 'ready'));
    expect(stageOf.science).toBe(makeStage('K', 'ready'));
    expect(stageOf.technology).toBe(makeStage('K', 'ready'));
    expect(stageOf.engineering).toBe(makeStage('1', 'strong'));
    expect(stageOf.logic).toBe(makeStage('1', 'strong'));
    for (const stage of Object.values(stageOf)) expect(stage).toBeLessThan(makeStage('3', 'starting'));

    expect((await childNow(child.id)).placementDone).toBe(true);
    expect((await childNow(child.id)).stars).toBe(8);
    // The walkthroughs of placement never count against the child afterwards.
    const states = await db.skillStates.where('childId').equals(child.id).toArray();
    expect(states.every((s) => s.assistedStreak === 0)).toBe(true);
    expect(results.every((r) => r.masteryDelta === 0)).toBe(true);
  });

  it('keeps the estimates in the key-value store between attempts and writes no skill state before the end', async () => {
    const child = await addChild({ grade: '3', placementDone: false });
    const [plan] = await planNext(child.id, 1, { rng: seededRng(2) });
    if (!plan) throw new Error('no plan');
    const challenge = challengeFromPlan(plan);
    const result = await recordAttempt({
      challenge,
      ...attemptDetails('second-try', MONDAY),
      teachBackCorrect: null,
      timeMs: 1000,
      now: MONDAY,
    });

    const stored = await readPlacement(child.id);
    expect(stored).toMatchObject({ answered: 1, start: { math: 13 }, estimates: { math: 14 } });
    expect(stored?.attempted).toEqual([{ skillId: plan.skillId, strand: 'math', interaction: plan.interaction, stage: plan.stage }]);
    expect((await db.kv.get(placementKey(child.id)))?.value).toEqual(stored);
    expect(await db.skillStates.count()).toBe(0);
    expect(await db.stageChanges.count()).toBe(0);
    expect(result.skillState).toMatchObject({ skillId: plan.skillId, attempts: 1 });
    expect(result.skillState.stage).toBe(clampStageToSkill(skillOrThrow(plan.skillId), 14));

    // Recording the same placement item again changes nothing.
    const again = await recordAttempt({
      challenge,
      ...attemptDetails('second-try', MONDAY),
      teachBackCorrect: null,
      timeMs: 1000,
      now: MONDAY + 5,
    });
    expect(again.attempt.id).toBe(result.attempt.id);
    expect(again.skillState.stage).toBe(result.skillState.stage);
    expect((await readPlacement(child.id))?.answered).toBe(1);
  });

  it('plays eight items over two strands when the parent enabled only two', async () => {
    const child = await addChild({
      grade: '5',
      placementDone: false,
      controlsOverride: { strands: { math: true, science: false, technology: false, engineering: false, logic: true } },
    });
    const { plans } = await playPlacement(child, 'second-try');
    expect(plans.map((p) => p.strand)).toEqual(['math', 'logic', 'math', 'logic', 'math', 'logic', 'math', 'logic']);
    const stages = await getStrandStages(child.id);
    const stageOf = Object.fromEntries(stages.map((s) => [s.strand, s.stage]));
    // Four second tries: grade 4 growing (21) + 4 = grade 5, growing.
    expect(stageOf.math).toBe(25);
    expect(stageOf.logic).toBe(25);
    expect(stageOf.science).toBeNull();
    expect(await db.stageChanges.count()).toBe(2);
  });

  it('with one subject switched on, places within two grades and only asks skills taught at the estimate', async () => {
    const mathOnly = { strands: { math: true, science: false, technology: false, engineering: false, logic: false } };
    const strong = await addChild({ grade: '2', placementDone: false, controlsOverride: mathOnly });
    const up = await playPlacement(strong, 'independent');
    const start = makeStage('1', 'growing');
    for (const plan of up.plans) {
      // Never a skill that had to be asked at another grade than the estimate at that moment.
      expect(Math.abs(plan.stage - start)).toBeLessThanOrEqual(TUNING.placement.maxMove);
    }
    const seededUp = await db.skillStates.where('childId').equals(strong.id).toArray();
    expect(seededUp.length).toBeGreaterThan(0);
    for (const state of seededUp) {
      expect(state.stage).toBeLessThanOrEqual(start + TUNING.placement.maxMove);
      // No skill starts far from anything the child was asked about it.
      const asked = up.plans.filter((plan) => plan.skillId === state.skillId).map((plan) => plan.stage);
      expect(Math.min(...asked.map((stage) => Math.abs(stage - state.stage)))).toBeLessThanOrEqual(TUNING.placement.maxMove);
    }
    expect((await getStrandStages(strong.id)).find((s) => s.strand === 'math')?.stage).toBe(makeStage('3', 'growing'));

    const struggling = await addChild({ grade: '5', placementDone: false, controlsOverride: mathOnly });
    const down = await playPlacement(struggling, 'walkthrough');
    const low = makeStage('4', 'growing') - TUNING.placement.maxMove;
    for (const plan of down.plans) expect(plan.stage).toBeGreaterThanOrEqual(low);
    const seededDown = await db.skillStates.where('childId').equals(struggling.id).toArray();
    for (const state of seededDown) expect(state.stage).toBeGreaterThanOrEqual(low);
    expect((await getStrandStages(struggling.id)).find((s) => s.strand === 'math')?.stage).toBe(makeStage('2', 'growing'));
  });

  it('treats a leftover placement item as regular practice once placement is done', async () => {
    const child = await addChild({ grade: '3', placementDone: true });
    const result = await solve(child.id, { challenge: { skillId: SKILL_IN.math, purpose: 'placement' } });
    expect(result.masteryDelta).toBe(25);
    expect(await readPlacement(child.id)).toBeNull();
    expect(await db.skillStates.count()).toBe(1);
  });

  it('uses the placement estimate as the starting stage of other items played before placement ends', async () => {
    const child = await addChild({ grade: '3', placementDone: false });
    const [plan] = await planNext(child.id, 1, { rng: seededRng(2) });
    if (!plan) throw new Error('no plan');
    await recordAttempt({
      challenge: challengeFromPlan(plan),
      ...attemptDetails('independent', MONDAY),
      teachBackCorrect: null,
      timeMs: 1000,
      now: MONDAY,
    });
    const studio = await solve(child.id, { now: MONDAY + 1, challenge: { skillId: 'math-fractions-decimals', mode: 'studio' } });
    expect(studio.skillState.stage).toBe(17);
    expect((await readPlacement(child.id))?.answered).toBe(1);
  });
});
