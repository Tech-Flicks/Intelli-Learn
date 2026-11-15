/**
 * Long simulated journeys through the whole service: plan an item, solve it,
 * record it, repeat. These catch problems the unit tests cannot, such as a
 * planner and a stage engine that disagree, or rules that loop.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clampStageToSkill, getSkill } from '@/core/skills';
import type { AttemptOutcome, AttemptResult, ChallengePlan, ChildProfile, StrandStage } from '@/core/types';
import { db } from '@/data';
import { planNext } from './plan';
import { recordAttempt } from './record';
import { seededRng } from './rng';
import { getStrandStages, weekStartOf, weekStats } from './stats';
import { addChild, attemptDetails, challengeFromPlan, DAY, MONDAY, resetDb } from './testing';
import { TUNING } from './tuning';

const ITEMS = 240;
const PER_DAY = 12;

interface Journey {
  child: ChildProfile;
  plans: ChallengePlan[];
  results: AttemptResult[];
  afterPlacement: StrandStage[];
  atEnd: StrandStage[];
}

/** Plays `ITEMS` items, twelve a day, deciding each outcome with `decide`. */
async function play(decide: (roll: number) => AttemptOutcome, patch: Partial<ChildProfile> = {}): Promise<Journey> {
  const child = await addChild({ grade: '3', placementDone: false, ...patch });
  const planRng = seededRng(99);
  const outcomeRng = seededRng(5);
  const plans: ChallengePlan[] = [];
  const results: AttemptResult[] = [];
  let afterPlacement: StrandStage[] = [];
  for (let i = 0; i < ITEMS; i += 1) {
    const now = MONDAY + Math.floor(i / PER_DAY) * DAY + (i % PER_DAY) * 120_000;
    const [plan] = await planNext(child.id, 1, { rng: planRng, now });
    if (!plan) throw new Error('planNext returned nothing');
    const challenge = challengeFromPlan(plan, { id: `journey-${i}` });
    await db.challenges.put(challenge);
    results.push(
      await recordAttempt({
        challenge,
        ...attemptDetails(decide(outcomeRng()), now),
        teachBackCorrect: null,
        timeMs: 45_000,
        now,
      }),
    );
    plans.push(plan);
    if (i === TUNING.placement.totalItems - 1) afterPlacement = await getStrandStages(child.id);
  }
  const saved = await db.children.get(child.id);
  if (!saved) throw new Error('child missing');
  return { child: saved, plans, results, afterPlacement, atEnd: await getStrandStages(child.id) };
}

function expectSound(journey: Journey): void {
  const { child, plans, results } = journey;
  expect(plans.slice(0, 8).every((p) => p.purpose === 'placement')).toBe(true);
  expect(plans.slice(8).some((p) => p.purpose === 'placement')).toBe(false);
  for (const [i, plan] of plans.entries()) {
    const skill = getSkill(plan.skillId);
    expect(skill).toBeDefined();
    if (!skill) continue;
    expect(plan.strand).toBe(skill.strand);
    expect(plan.stage).toBe(clampStageToSkill(skill, plan.stage));
    // The skill of the item just played is not planned again straight away, except for its concept check.
    if (i > 0 && plan.purpose !== 'check') expect(plan.skillId).not.toBe(plans[i - 1]?.skillId);
  }
  for (const result of results) {
    expect(result.skillState.mastery).toBeGreaterThanOrEqual(0);
    expect(result.skillState.mastery).toBeLessThanOrEqual(100);
    expect(result.attempt.starsEarned).toBeGreaterThanOrEqual(1);
  }
  // Stars only ever go up, and the balance matches the reward log.
  const earned = results.reduce((sum, result) => sum + result.attempt.starsEarned, 0);
  expect(child.stars).toBe(earned);
  expect(child.totalStars).toBe(earned);
  expect(child.companion.xp).toBe(earned);
  expect(child.placementDone).toBe(true);
  expect(child.streakDays).toBe(ITEMS / PER_DAY);
}

beforeEach(resetDb);

describe('a long journey', () => {
  it('a child who solves everything alone keeps moving up through concept checks', async () => {
    const journey = await play(() => 'independent');
    expectSound(journey);

    const purposes = new Set(journey.plans.map((p) => p.purpose));
    expect(purposes).toEqual(new Set(['placement', 'core', 'check', 'review', 'stretch']));

    const changes = await db.stageChanges.where('childId').equals(journey.child.id).toArray();
    const skillUps = changes.filter((c) => c.skillId !== null);
    expect(skillUps.length).toBeGreaterThan(30);
    // One step at a time at first, more once a skill has a long run of independent solves.
    expect(skillUps.every((c) => c.reason === 'mastery' && c.to > c.from && c.to <= c.from + TUNING.mastery.leapSteps)).toBe(true);
    expect(skillUps.some((c) => c.to === c.from + 1)).toBe(true);
    expect(skillUps.some((c) => c.to === c.from + TUNING.mastery.leapSteps)).toBe(true);
    // Every step up was earned with a concept check.
    expect(skillUps.length).toBe(journey.plans.filter((p) => p.purpose === 'check').length);
    expect(changes.some((c) => c.reason === 'support')).toBe(false);

    for (const [i, end] of journey.atEnd.entries()) {
      const start = journey.afterPlacement[i]?.stage ?? 0;
      expect(end.stage ?? 0).toBeGreaterThanOrEqual(start);
    }
    const gained = journey.atEnd.reduce((sum, s, i) => sum + (s.stage ?? 0) - (journey.afterPlacement[i]?.stage ?? 0), 0);
    // A child who needs no help at all is far above the level: more than a grade per strand in twenty days.
    expect(gained).toBeGreaterThan(5 * 4);

    // Each strand's history is one unbroken chain of levels.
    for (const { strand } of journey.atEnd) {
      const history = changes.filter((c) => c.skillId === null && c.strand === strand).sort((a, b) => a.at - b.at);
      for (let i = 1; i < history.length; i += 1) expect(history[i]?.from).toBe(history[i - 1]?.to);
    }

    const week = await weekStats(journey.child.id, weekStartOf(MONDAY));
    expect(week.completed).toBe(7 * PER_DAY);
    expect(week.independentShare).toBe(1);
    expect(week.stageUps).toBeGreaterThan(0);
  });

  it('a child who needs a lot of support is moved down gently and never loses a star', async () => {
    const journey = await play((roll) => (roll < 0.6 ? 'walkthrough' : roll < 0.8 ? 'hint' : 'nudge'));
    expectSound(journey);

    expect(journey.plans.some((p) => p.purpose === 'stretch')).toBe(false);
    const changes = await db.stageChanges.where('childId').equals(journey.child.id).toArray();
    const afterPlacement = changes.filter((c) => c.reason !== 'placement');
    expect(afterPlacement.length).toBeGreaterThan(5);
    expect(afterPlacement.every((c) => c.reason === 'support' && c.to < c.from)).toBe(true);
    expect(afterPlacement.filter((c) => c.skillId !== null).every((c) => c.to === c.from - 1)).toBe(true);
    for (const stage of journey.atEnd) expect(stage.stage ?? 0).toBeGreaterThanOrEqual(0);

    expect(journey.results.some((r) => r.suggestBreak)).toBe(true);
    const week = await weekStats(journey.child.id, weekStartOf(MONDAY));
    expect(week.independentShare).toBe(0);
    expect(week.stageUps).toBe(0);
  });

  it('a child with mixed results sees every kind of item and stays inside the enabled strands', async () => {
    const outcomes: AttemptOutcome[] = ['independent', 'independent', 'second-try', 'nudge', 'hint', 'walkthrough'];
    const journey = await play((roll) => outcomes[Math.floor(roll * outcomes.length)] ?? 'independent', {
      controlsOverride: { strands: { math: true, science: true, technology: false, engineering: false, logic: true } },
    });
    expectSound(journey);
    expect(new Set(journey.plans.map((p) => p.strand))).toEqual(new Set(['math', 'science', 'logic']));
    expect(new Set(journey.plans.map((p) => p.purpose)).size).toBeGreaterThanOrEqual(4);
    expect(journey.atEnd.filter((s) => s.stage === null).map((s) => s.strand)).toEqual(['technology', 'engineering']);

    const badges = await db.rewards.where('[childId+kind]').equals([journey.child.id, 'badge']).toArray();
    expect(new Set(badges.map((b) => b.key)).size).toBe(badges.length);
    expect(badges.length).toBeGreaterThan(8);
  });
});
