import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { clampStageToSkill, getSkill, SKILLS, skillsForStrand } from '@/core/skills';
import { STRANDS } from '@/core/types';
import type { ChallengePlan, ChildProfile, Mode, SkillDef, SkillState, Strand } from '@/core/types';
import { db, updateSettings } from '@/data';
import { freshPlacement, writePlacement } from './placement';
import {
  FALLBACK_THEMES,
  kindsFor,
  makeSiblingPlan,
  planFromContext,
  planNext,
  YOUNG_KINDS,
  type PlannerContext,
  type TrailItem,
} from './plan';
import { seededRng, setRng } from './rng';
import { addChild, challengeFor, childProfile, controls, DAY, MONDAY, resetDb, sequenceRng, stateFor } from './testing';
import { TUNING } from './tuning';

function skillOrThrow(id: string): SkillDef {
  const skill = getSkill(id);
  if (!skill) throw new Error(`missing skill ${id}`);
  return skill;
}

function context(patch: Partial<PlannerContext> = {}, child: Partial<ChildProfile> = {}): PlannerContext {
  return {
    child: childProfile({ grade: '3', ...child }),
    controls: controls(),
    states: [],
    placement: null,
    recent: [],
    pending: [],
    challengeCount: 0,
    now: MONDAY,
    rng: seededRng(7),
    ...patch,
  };
}

/** Every skill practised, at grade 3 where the skill exists there (clamped otherwise). */
function allPractised(childId: string, patch: Partial<SkillState> = {}): SkillState[] {
  return SKILLS.map((skill, index) =>
    stateFor(childId, skill.id, clampStageToSkill(skill, makeStage('3', 'growing')), {
      lastPracticedAt: MONDAY - (index + 1) * 1000,
      mastery: 50,
      independentStreak: 1,
      ...patch,
    }),
  );
}

const trail = (skillId: string, patch: Partial<TrailItem> = {}): TrailItem => ({
  skillId,
  strand: skillOrThrow(skillId).strand,
  interaction: 'choice',
  purpose: 'core',
  ...patch,
});

/** Plans one item at a time from the same snapshot, `times` times, with one running rng. */
function sample(ctx: PlannerContext, times: number, opts: { mode?: Mode; strand?: Strand } = {}): ChallengePlan[] {
  const plans: ChallengePlan[] = [];
  for (let i = 0; i < times; i += 1) plans.push(...planFromContext(ctx, 1, opts));
  return plans;
}

describe('planFromContext: basics', () => {
  it('returns the number of plans asked for, each a complete plan for the child', () => {
    const ctx = context();
    const plans = planFromContext(ctx, 4);
    expect(plans).toHaveLength(4);
    for (const plan of plans) {
      const skill = skillOrThrow(plan.skillId);
      expect(plan.childId).toBe(ctx.child.id);
      expect(plan.strand).toBe(skill.strand);
      expect(plan.stage).toBe(clampStageToSkill(skill, plan.stage));
      expect(plan.theme.length).toBeGreaterThan(0);
    }
    expect(planFromContext(ctx, 0)).toEqual([]);
  });

  it('is deterministic for the same random seed', () => {
    const a = planFromContext(context({ rng: seededRng(42) }), 6);
    const b = planFromContext(context({ rng: seededRng(42) }), 6);
    const c = planFromContext(context({ rng: seededRng(43) }), 6);
    const strip = (plans: ChallengePlan[]) => plans.map(({ childId: _childId, ...rest }) => rest);
    expect(strip(a)).toEqual(strip(b));
    expect(strip(a)).not.toEqual(strip(c));
  });

  it('plans distinct skills within one call', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const plans = planFromContext(context({ rng: seededRng(seed) }), 5);
      expect(new Set(plans.map((p) => p.skillId)).size).toBe(5);
    }
  });

  it('starts a new skill at the enrolled grade when the strand has no stage yet', () => {
    const plans = planFromContext(context({}, { grade: '5' }), 5);
    for (const plan of plans) {
      expect(plan.purpose).toBe('core');
      expect(plan.stage).toBe(clampStageToSkill(skillOrThrow(plan.skillId), makeStage('5', 'starting')));
    }
  });

  it('starts a new skill at the strand stage, clamped to the skill', () => {
    const child = childProfile({ grade: '3' });
    const states = [stateFor(child.id, 'math-place-value', 22), stateFor(child.id, 'math-geometry-shapes', 22)];
    const ctx = context({ child, states, rng: sequenceRng([0.1]) });
    // A roll of 0.1 always asks for a core item and always introduces a new skill.
    const [plan] = planFromContext(ctx, 1, { strand: 'math' });
    expect(plan?.purpose).toBe('core');
    expect(states.map((s) => s.skillId)).not.toContain(plan?.skillId);
    expect(plan?.stage).toBe(clampStageToSkill(skillOrThrow(plan?.skillId ?? ''), 22));
  });

  it('rotates through the interests for the theme, continuing where earlier challenges stopped', () => {
    const interests = ['space', 'dinosaurs', 'music'];
    const plans = planFromContext(context({ challengeCount: 4 }, { interests }), 4);
    expect(plans.map((p) => p.theme)).toEqual(['dinosaurs', 'music', 'space', 'dinosaurs']);
  });

  it('uses neutral themes when the child has no interests', () => {
    const plans = planFromContext(context({}, { interests: [] }), 3);
    expect(plans.map((p) => p.theme)).toEqual(FALLBACK_THEMES.slice(0, 3));
  });
});

describe('planFromContext: strands and controls', () => {
  it('only uses enabled strands', () => {
    const only = controls({ strands: { math: false, science: true, technology: false, engineering: false, logic: true } });
    const plans = planFromContext(context({ controls: only }), 8);
    expect(new Set(plans.map((p) => p.strand))).toEqual(new Set(['science', 'logic']));
  });

  it('stays in the requested strand when it is enabled', () => {
    const plans = planFromContext(context(), 5, { strand: 'engineering' });
    expect(plans.every((p) => p.strand === 'engineering')).toBe(true);
  });

  it('ignores a requested strand the parent disabled', () => {
    const only = controls({ strands: { math: true, science: true, technology: false, engineering: true, logic: true } });
    const plans = planFromContext(context({ controls: only }), 6, { strand: 'technology' });
    expect(plans.some((p) => p.strand === 'technology')).toBe(false);
  });

  it('rotates strands so that consecutive plans differ', () => {
    const plans = planFromContext(context(), 10);
    expect(plans.slice(0, 5).map((p) => p.strand)).toEqual([...STRANDS]);
    for (let i = 1; i < plans.length; i += 1) expect(plans[i]?.strand).not.toBe(plans[i - 1]?.strand);
  });

  it('continues the rotation after the strand of the latest queued or completed challenge', () => {
    const afterQueued = planFromContext(context({ pending: [trail('science-matter')] }), 1);
    expect(afterQueued[0]?.strand).toBe('technology');
    const afterCompleted = planFromContext(context({ recent: [trail('logic-patterns')] }), 1);
    expect(afterCompleted[0]?.strand).toBe('math');
  });
});

describe('planFromContext: purpose mix', () => {
  it('is about 70% core, 20% review and 10% stretch for a child with practised skills', () => {
    const child = childProfile({ grade: '3' });
    const ctx = context({ child, states: allPractised(child.id), rng: seededRng(11) });
    const plans = STRANDS.flatMap((strand) => sample(ctx, 500, { strand }));
    const share = (purpose: string) => plans.filter((p) => p.purpose === purpose).length / plans.length;
    expect(share('core')).toBeGreaterThan(0.66);
    expect(share('core')).toBeLessThan(0.74);
    expect(share('review')).toBeGreaterThan(0.17);
    expect(share('review')).toBeLessThan(0.23);
    expect(share('stretch')).toBeGreaterThan(0.08);
    expect(share('stretch')).toBeLessThan(0.12);
  });

  it('plans core items at the current stage, reviews at the current stage and stretch one step above', () => {
    const child = childProfile({ grade: '3' });
    const states = allPractised(child.id);
    const stageOf = new Map(states.map((s) => [s.skillId, s.stage]));
    const ctx = context({ child, states, rng: seededRng(5) });
    const plans = STRANDS.flatMap((strand) => sample(ctx, 100, { strand }));
    for (const plan of plans) {
      const current = stageOf.get(plan.skillId) ?? -1;
      if (plan.purpose === 'stretch') expect(plan.stage).toBe(current + 1);
      else expect(plan.stage).toBe(current);
    }
    expect(new Set(plans.map((p) => p.purpose))).toEqual(new Set(['core', 'review', 'stretch']));
  });

  it('falls back to a core item when there is nothing to review or stretch yet', () => {
    const review = planFromContext(context({ rng: sequenceRng([0.8, 0.1]) }), 1);
    const stretch = planFromContext(context({ rng: sequenceRng([0.95, 0.1]) }), 1);
    expect(review[0]?.purpose).toBe('core');
    expect(stretch[0]?.purpose).toBe('core');
  });

  it('does not stretch a skill that is already at its top stage', () => {
    const child = childProfile({ grade: '2' });
    const top = stateFor(child.id, 'math-counting-cardinality', makeStage('2', 'ready'), {
      mastery: 90,
      independentStreak: 2,
    });
    const ctx = context({ child, states: [top], rng: sequenceRng([0.95, 0.99]) });
    const [plan] = planFromContext(ctx, 1, { strand: 'math' });
    expect(plan?.purpose).toBe('core');
  });

  it('only stretches a skill the child is doing well on', () => {
    const child = childProfile({ grade: '3' });
    const stretchRoll = () => sequenceRng([0.95, 0.99]);
    const plan = (patch: Partial<SkillState>) =>
      planFromContext(
        context({ child, states: [stateFor(child.id, 'logic-patterns', 17, patch)], rng: stretchRoll() }),
        1,
        { strand: 'logic' },
      )[0];
    const enough = TUNING.plan.stretchMinMastery;
    expect(plan({ mastery: enough, independentStreak: 1 })).toMatchObject({ purpose: 'stretch', stage: 18 });
    expect(plan({ mastery: enough - 1, independentStreak: 1 })?.purpose).toBe('core');
    expect(plan({ mastery: 70, independentStreak: 0 })?.purpose).toBe('core');
  });

  it('regularly introduces a skill the child has not practised yet', () => {
    const child = childProfile({ grade: '3' });
    const states = [
      stateFor(child.id, 'math-place-value', 16),
      stateFor(child.id, 'math-geometry-shapes', 16),
      stateFor(child.id, 'math-addition-subtraction', 16),
    ];
    const known = new Set(states.map((s) => s.skillId));
    const core = sample(context({ child, states, rng: seededRng(3) }), 600, { strand: 'math' }).filter(
      (p) => p.purpose === 'core',
    );
    const share = core.filter((p) => !known.has(p.skillId)).length / core.length;
    expect(share).toBeGreaterThan(TUNING.plan.newSkillChance - 0.07);
    expect(share).toBeLessThan(TUNING.plan.newSkillChance + 0.07);
  });
});

describe('planFromContext: spaced reviews', () => {
  const coreOnly = () => sequenceRng([0.1]);

  it('serves a due review first, one step below the current stage', () => {
    const child = childProfile({ grade: '3' });
    const due = stateFor(child.id, 'logic-patterns', 17, { reviewDueAt: MONDAY - DAY, reviewIntervalDays: 2 });
    const notDue = stateFor(child.id, 'math-place-value', 17, { reviewDueAt: MONDAY + DAY });
    const [plan] = planFromContext(context({ child, states: [due, notDue], rng: coreOnly() }), 1);
    expect(plan).toMatchObject({ purpose: 'review', skillId: 'logic-patterns', stage: 16 });
  });

  it('serves the most overdue skill first', () => {
    const child = childProfile({ grade: '3' });
    const states = [
      stateFor(child.id, 'logic-patterns', 17, { reviewDueAt: MONDAY - DAY }),
      stateFor(child.id, 'science-matter', 17, { reviewDueAt: MONDAY - 5 * DAY }),
    ];
    const [plan] = planFromContext(context({ child, states, rng: coreOnly() }), 1);
    expect(plan?.skillId).toBe('science-matter');
  });

  it('serves at most one review in five items', () => {
    const child = childProfile({ grade: '3' });
    const states = ['logic-patterns', 'science-matter', 'math-place-value', 'logic-deduction'].map((id) =>
      stateFor(child.id, id, 17, { reviewDueAt: MONDAY - DAY }),
    );
    const plans = planFromContext(context({ child, states, rng: coreOnly() }), 11);
    expect(plans.map((p) => p.purpose === 'review')).toEqual([
      true, false, false, false, false,
      true, false, false, false, false,
      true,
    ]);
  });

  it('keeps to one review in five items for the reviews of the regular mix too', () => {
    const child = childProfile({ grade: '3' });
    // Half of the skills are due, so both kinds of review have something to serve.
    const states = allPractised(child.id).map((state, index) =>
      index % 2 === 0 ? { ...state, reviewDueAt: MONDAY - DAY } : state,
    );
    const rng = seededRng(21);
    const played: ChallengePlan[] = [];
    for (let i = 0; i < 400; i += 1) {
      const recent = played.slice(-TUNING.plan.recentWindow);
      played.push(...planFromContext(context({ child, states, recent, rng }), 1));
    }
    const reviews = played.map((plan) => plan.purpose === 'review');
    for (let i = 0; i + TUNING.review.atMostOneIn <= reviews.length; i += 1) {
      expect(reviews.slice(i, i + TUNING.review.atMostOneIn).filter(Boolean).length).toBeLessThanOrEqual(1);
    }
    const share = reviews.filter(Boolean).length / reviews.length;
    expect(share).toBeLessThanOrEqual(1 / TUNING.review.atMostOneIn);
    expect(share).toBeGreaterThan(0.1);
  });

  it('counts reviews that are already queued or were just played', () => {
    const child = childProfile({ grade: '3' });
    const states = [stateFor(child.id, 'logic-patterns', 17, { reviewDueAt: MONDAY - DAY })];
    const recent = [trail('science-matter', { purpose: 'review' }), trail('math-place-value')];
    const blocked = planFromContext(context({ child, states, recent, rng: coreOnly() }), 1);
    expect(blocked[0]?.purpose).toBe('core');
    const older = [trail('science-matter', { purpose: 'review' }), ...Array.from({ length: 4 }, () => trail('math-place-value'))];
    const allowed = planFromContext(context({ child, states, recent: older, rng: coreOnly() }), 1);
    expect(allowed[0]?.purpose).toBe('review');
  });

  it('does not review the skill that was just played', () => {
    const child = childProfile({ grade: '3' });
    const states = [stateFor(child.id, 'logic-patterns', 17, { reviewDueAt: MONDAY - DAY })];
    const [plan] = planFromContext(context({ child, states, recent: [trail('logic-patterns')], rng: coreOnly() }), 1);
    expect(plan?.skillId).not.toBe('logic-patterns');
  });

  it('does not plan a review for a skill that is already queued', () => {
    const child = childProfile({ grade: '3' });
    const states = [stateFor(child.id, 'logic-patterns', 17, { reviewDueAt: MONDAY - DAY })];
    const plans = planFromContext(context({ child, states, pending: [trail('logic-patterns')], rng: coreOnly() }), 2);
    expect(plans.some((p) => p.skillId === 'logic-patterns')).toBe(false);
  });
});

describe('planFromContext: concept checks', () => {
  const child = childProfile({ grade: '3' });
  const ready = () =>
    stateFor(child.id, 'math-place-value', 17, {
      checkPending: true,
      mastery: 85,
      recentInteractions: ['number', 'choice', 'order'],
    });

  it('puts the concept check first, at the current stage, in a format the child has not just used', () => {
    const due = stateFor(child.id, 'logic-patterns', 17, { reviewDueAt: MONDAY - DAY });
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const [plan] = planFromContext(context({ child, states: [due, ready()], rng: seededRng(seed) }), 1);
      expect(plan).toMatchObject({ purpose: 'check', skillId: 'math-place-value', stage: 17, mode: 'quest' });
      expect(['sort', 'match', 'tap']).toContain(plan?.interaction);
    }
  });

  it('avoids at least the most recent format when the skill has been seen in every format', () => {
    const state = stateFor(child.id, 'engineering-design-constraints', 17, {
      checkPending: true,
      recentInteractions: ['number', 'build', 'choice'],
    });
    for (const seed of [1, 2, 3, 4]) {
      const [plan] = planFromContext(context({ child, states: [state], rng: seededRng(seed) }), 1);
      expect(plan?.purpose).toBe('check');
      expect(plan?.interaction).not.toBe('number');
    }
  });

  it('plans each check once: not again in the same call, and not when one is already queued', () => {
    const plans = planFromContext(context({ child, states: [ready()] }), 3);
    expect(plans.filter((p) => p.purpose === 'check')).toHaveLength(1);
    expect(plans.filter((p) => p.skillId === 'math-place-value')).toHaveLength(1);

    const queued = [trail('math-place-value', { purpose: 'check' })];
    const later = planFromContext(context({ child, states: [ready()], pending: queued }), 3);
    expect(later.some((p) => p.skillId === 'math-place-value')).toBe(false);
  });

  it('gives a skill that waits for its check no other practice', () => {
    const plans = sample(context({ child, states: [ready()], pending: [trail('math-place-value', { purpose: 'check' })] }), 200, {
      strand: 'math',
    });
    expect(plans.some((p) => p.skillId === 'math-place-value')).toBe(false);
  });

  it('respects the enabled strands and the requested strand', () => {
    const noMath = controls({ strands: { math: false, science: true, technology: true, engineering: true, logic: true } });
    expect(planFromContext(context({ child, states: [ready()], controls: noMath }), 1)[0]?.purpose).not.toBe('check');
    expect(planFromContext(context({ child, states: [ready()] }), 1, { strand: 'logic' })[0]?.purpose).not.toBe('check');
    expect(planFromContext(context({ child, states: [ready()] }), 1, { strand: 'math' })[0]?.purpose).toBe('check');
  });

  it('keeps the mode the child started when the skill suits it', () => {
    const [detective] = planFromContext(context({ child, states: [ready()] }), 1, { mode: 'detective' });
    expect(detective).toMatchObject({ purpose: 'check', mode: 'detective' });
    const [robot] = planFromContext(context({ child, states: [ready()] }), 1, { mode: 'robot' });
    expect(robot?.purpose).not.toBe('check');
    expect(robot?.mode).toBe('robot');
  });
});

describe('planFromContext: concept checks in a mode with one format', () => {
  const child = childProfile({ grade: '3' });

  it('plans the check as a plain quest in another format when the mode only has the format of the practice', () => {
    const robotSkill = SKILLS.find((skill) => skill.modes.includes('robot') && skill.interactions.some((kind) => kind !== 'robot'));
    if (!robotSkill) throw new Error('no robot skill with a second format');
    const state = stateFor(child.id, robotSkill.id, clampStageToSkill(robotSkill, 17), {
      checkPending: true,
      mastery: 100,
      recentInteractions: ['robot', 'robot', 'robot'],
    });
    for (const seed of [1, 2, 3, 4, 5]) {
      const [plan] = planFromContext(context({ child, states: [state], rng: seededRng(seed) }), 1, { mode: 'robot' });
      expect(plan).toMatchObject({ purpose: 'check', skillId: robotSkill.id, mode: 'quest' });
      expect(plan?.interaction).not.toBe('robot');
    }
  });

  it('keeps the mode when the child has not just used its format on the skill', () => {
    const robotSkill = SKILLS.find((skill) => skill.modes.includes('robot') && skill.interactions.some((kind) => kind !== 'robot'));
    if (!robotSkill) throw new Error('no robot skill with a second format');
    const state = stateFor(child.id, robotSkill.id, clampStageToSkill(robotSkill, 17), {
      checkPending: true,
      mastery: 100,
      recentInteractions: ['choice', 'order'],
    });
    const [plan] = planFromContext(context({ child, states: [state] }), 1, { mode: 'robot' });
    expect(plan).toMatchObject({ purpose: 'check', mode: 'robot', interaction: 'robot' });
  });
});

describe('planFromContext: skill choice', () => {
  const mathOf = (ctx: PlannerContext, seeds: number[], count = 6): Set<string> => {
    const ids = new Set<string>();
    for (const seed of seeds) {
      for (const plan of planFromContext({ ...ctx, rng: seededRng(seed) }, count, { strand: 'math' })) ids.add(plan.skillId);
    }
    return ids;
  };
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it('does not introduce a skill before its prerequisite is growing at that grade', () => {
    const child = childProfile({ grade: '2' });
    const ids = mathOf(context({ child }), seeds);
    expect(ids.has('math-multiplication-division')).toBe(false);
    expect(ids.has('math-algebra-ratios')).toBe(false);
    // Skills without prerequisites, and skills whose entry grade is below the child's grade, are fine.
    expect(ids.has('math-geometry-shapes')).toBe(true);
    expect(ids.has('math-addition-subtraction')).toBe(true);
  });

  it('keeps a skill back while its prerequisite is only starting', () => {
    const child = childProfile({ grade: '2' });
    const states = [stateFor(child.id, 'math-addition-subtraction', makeStage('2', 'starting'))];
    expect(mathOf(context({ child, states }), seeds).has('math-multiplication-division')).toBe(false);
  });

  it('introduces the skill once the prerequisite is growing at the same grade', () => {
    const child = childProfile({ grade: '2' });
    const states = [stateFor(child.id, 'math-addition-subtraction', makeStage('2', 'growing'))];
    expect(mathOf(context({ child, states }), seeds).has('math-multiplication-division')).toBe(true);
  });

  it('introduces the skill without the prerequisite when the strand is above its entry grade', () => {
    const child = childProfile({ grade: '3' });
    expect(mathOf(context({ child }), seeds).has('math-multiplication-division')).toBe(true);
  });

  it('prefers skills that exist at the working grade of the strand', () => {
    const child = childProfile({ grade: '7' });
    const ids = mathOf(context({ child }), seeds, 4);
    // Counting ends at grade 2, addition at grade 4, place value at grade 6.
    expect(ids.has('math-counting-cardinality')).toBe(false);
    expect(ids.has('math-addition-subtraction')).toBe(false);
    expect(ids.has('math-place-value')).toBe(false);
  });

  it('avoids the skill that was just completed and the ones already queued', () => {
    const child = childProfile({ grade: '3' });
    const states = allPractised(child.id);
    const ctx = context({
      child,
      states,
      recent: [trail('logic-patterns')],
      pending: [trail('math-place-value'), trail('science-matter')],
    });
    const rng = seededRng(9);
    const plans = STRANDS.flatMap((strand) => sample({ ...ctx, rng }, 150, { strand }));
    const ids = new Set(plans.map((p) => p.skillId));
    expect(ids.has('logic-patterns')).toBe(false);
    expect(ids.has('math-place-value')).toBe(false);
    expect(ids.has('science-matter')).toBe(false);
    expect(ids.size).toBeGreaterThan(25);
  });

  it('repeats a skill rather than failing when everything suitable is already taken', () => {
    const robotSkills = SKILLS.filter((skill) => skill.modes.includes('robot'));
    const pending = robotSkills.map((skill) => trail(skill.id, { interaction: 'robot' }));
    const plans = planFromContext(context({ pending }), 3, { mode: 'robot' });
    expect(plans).toHaveLength(3);
    for (const plan of plans) expect(robotSkills.map((s) => s.id)).toContain(plan.skillId);
  });

  it('practises the least recently practised skills more often', () => {
    const child = childProfile({ grade: '3' });
    const states = skillsForStrand('logic').map((skill, index) =>
      stateFor(child.id, skill.id, clampStageToSkill(skill, 17), { lastPracticedAt: MONDAY - (index + 1) * DAY }),
    );
    const oldest = states[states.length - 1]?.skillId;
    const newest = states[0]?.skillId;
    const plans = sample(context({ child, states, rng: seededRng(21) }), 400, { strand: 'logic' });
    const count = (id: string | undefined) => plans.filter((p) => p.skillId === id).length;
    expect(count(oldest)).toBeGreaterThan(count(newest));
    expect(count(newest)).toBeGreaterThan(0);
  });

  it('keeps coming back to the skill that is closest to its concept check', () => {
    const child = childProfile({ grade: '3' });
    const states = skillsForStrand('logic').map((skill, index) =>
      stateFor(child.id, skill.id, clampStageToSkill(skill, 17), {
        lastPracticedAt: MONDAY - (index + 1) * DAY,
        mastery: skill.id === 'logic-deduction' ? 70 : 20,
      }),
    );
    const plans = sample(context({ child, states, rng: seededRng(22) }), 400, { strand: 'logic' }).filter(
      (p) => p.purpose === 'core',
    );
    const share = plans.filter((p) => p.skillId === 'logic-deduction').length / plans.length;
    expect(share).toBeGreaterThan(TUNING.plan.focusChance - 0.05);
  });

  it('does not keep coming back to a skill that is already at its top stage', () => {
    const child = childProfile({ grade: '2' });
    const states = [
      stateFor(child.id, 'math-counting-cardinality', makeStage('2', 'ready'), { mastery: 100 }),
      stateFor(child.id, 'math-geometry-shapes', 12, { mastery: 10 }),
      stateFor(child.id, 'math-place-value', 12, { mastery: 10 }),
    ];
    const plans = sample(context({ child, states, rng: seededRng(26) }), 300, { strand: 'math' }).filter(
      (p) => p.purpose === 'core' && states.some((s) => s.skillId === p.skillId),
    );
    const share = plans.filter((p) => p.skillId === 'math-counting-cardinality').length / plans.length;
    expect(share).toBeLessThan(0.4);
  });

  it('leaves a skill that ended at a lower grade to its spaced reviews', () => {
    const child = childProfile({ grade: '7' });
    // Counting ends at grade 2 and addition at grade 4; the child is at grade 7 in the rest of math.
    const finished = ['math-counting-cardinality', 'math-addition-subtraction'];
    const states = skillsForStrand('math').map((skill, index) =>
      stateFor(child.id, skill.id, clampStageToSkill(skill, makeStage('7', 'growing')), {
        mastery: finished.includes(skill.id) ? 100 : 50,
        independentStreak: 1,
        // The finished skills were practised longest ago, which would otherwise put them first.
        lastPracticedAt: MONDAY - (finished.includes(skill.id) ? 30 : index + 1) * DAY,
      }),
    );
    const plans = sample(context({ child, states, rng: seededRng(8) }), 400, { strand: 'math' });
    expect(plans.filter((plan) => finished.includes(plan.skillId))).toEqual([]);

    // Once its review is due, a finished skill comes back for it.
    const due = states.map((state) => (state.skillId === 'math-addition-subtraction' ? { ...state, reviewDueAt: MONDAY - DAY } : state));
    const withDue = sample(context({ child, states: due, rng: seededRng(8) }), 50, { strand: 'math' });
    const back = withDue.filter((plan) => finished.includes(plan.skillId));
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((plan) => plan.purpose === 'review' && plan.skillId === 'math-addition-subtraction')).toBe(true);
  });

  it('keeps practising a finished skill while nothing else in the strand is further on', () => {
    const child = childProfile({ grade: '2' });
    const top = makeStage('2', 'ready');
    const states = [stateFor(child.id, 'math-counting-cardinality', top, { mastery: 100 })];
    const scienceOff = controls({ strands: { math: true, science: false, technology: false, engineering: false, logic: false } });
    const plans = sample(context({ child, states, controls: scienceOff, rng: sequenceRng([0.1, 0.99]) }), 5);
    expect(plans.some((plan) => plan.skillId === 'math-counting-cardinality')).toBe(true);
  });

  it('does not open more skills while two are still new to the child', () => {
    const child = childProfile({ grade: '3' });
    const settling = [
      stateFor(child.id, 'logic-patterns', 17, { attempts: 1 }),
      stateFor(child.id, 'logic-deduction', 17, { attempts: 2 }),
    ];
    const known = new Set(settling.map((s) => s.skillId));
    const waiting = sample(context({ child, states: settling, rng: seededRng(24) }), 200, { strand: 'logic' });
    expect(waiting.every((p) => known.has(p.skillId))).toBe(true);

    const settled = settling.map((state) => ({ ...state, attempts: TUNING.plan.settledAfterAttempts }));
    const open = sample(context({ child, states: settled, rng: seededRng(24) }), 200, { strand: 'logic' });
    expect(open.some((p) => !known.has(p.skillId))).toBe(true);
  });
});

describe('planFromContext: interactions', () => {
  it('only picks kinds the skill offers', () => {
    const rng = seededRng(13);
    const plans = STRANDS.flatMap((strand) => sample(context({ rng }), 100, { strand }));
    for (const plan of plans) {
      const skill = skillOrThrow(plan.skillId);
      expect(kindsFor(skill, plan.mode, '6-8')).toContain(plan.interaction);
    }
  });

  it('does not repeat the previous kind when the skill offers another', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const ctx = context({ rng: seededRng(seed) });
      const plans = planFromContext(ctx, 5);
      for (let i = 1; i < plans.length; i += 1) {
        const plan = plans[i];
        if (!plan) continue;
        const kinds = kindsFor(skillOrThrow(plan.skillId), plan.mode, ctx.child.ageGroup);
        if (kinds.length > 1) expect(plan.interaction).not.toBe(plans[i - 1]?.interaction);
      }
    }
  });

  it('does not repeat the kind of the latest queued challenge either', () => {
    const pending = [trail('science-matter', { interaction: 'tap' })];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [plan] = planFromContext(context({ pending, rng: seededRng(seed) }), 1, { strand: 'math', mode: 'quest' });
      expect(plan?.interaction).not.toBe('tap');
    }
  });

  it('leans towards the kinds the skill lists first', () => {
    const plans = sample(context({ rng: seededRng(17) }), 600, { strand: 'science', mode: 'quest' }).filter(
      (p) => p.skillId === 'science-matter',
    );
    const count = (kind: string) => plans.filter((p) => p.interaction === kind).length;
    expect(plans.length).toBeGreaterThan(30);
    expect(count('sort')).toBeGreaterThan(count('number'));
  });

  it('prefers tapping, choosing, sorting, matching and ordering for ages 3-5', () => {
    const rng = seededRng(19);
    const plans = STRANDS.flatMap((strand) => sample(context({ rng }, { ageGroup: '3-5', grade: 'K' }), 120, { strand }));
    for (const plan of plans) {
      expect(YOUNG_KINDS).toContain(plan.interaction);
      expect(plan.mode).not.toBe('robot');
      expect(plan.mode).not.toBe('invention');
    }
  });

  it('lists the kinds for a skill, a mode and an age group', () => {
    const sequencing = skillOrThrow('technology-sequencing');
    expect(kindsFor(sequencing, 'quest', '9-11')).toEqual(['robot', 'order', 'choice', 'match']);
    expect(kindsFor(sequencing, 'quest', '3-5')).toEqual(['order', 'choice', 'match']);
    expect(kindsFor(sequencing, 'robot', '3-5')).toEqual(['robot']);
    expect(kindsFor(sequencing, 'fixbot', '9-11')).toEqual(['order', 'choice']);
    expect(kindsFor(skillOrThrow('engineering-structures'), 'invention', '6-8')).toEqual(['build']);
    expect(kindsFor(skillOrThrow('math-measurement-data'), 'mission', '9-11')).toEqual(['number', 'choice']);
    expect(kindsFor(skillOrThrow('math-measurement-data'), 'mission', '3-5')).toEqual(['choice']);
  });
});

describe('planFromContext: modes', () => {
  it('uses a plain quest about 60% of the time and one of the skill modes otherwise', () => {
    const rng = seededRng(23);
    const plans = STRANDS.flatMap((strand) => sample(context({ rng }), 400, { strand }));
    const quests = plans.filter((p) => p.mode === 'quest').length / plans.length;
    expect(quests).toBeGreaterThan(0.55);
    expect(quests).toBeLessThan(0.65);
    for (const plan of plans) {
      if (plan.mode !== 'quest') expect(skillOrThrow(plan.skillId).modes).toContain(plan.mode);
    }
    expect(new Set(plans.map((p) => p.mode)).size).toBeGreaterThan(4);
  });

  it('never starts a story, the studio or a mission by itself', () => {
    const rng = seededRng(29);
    const plans = STRANDS.flatMap((strand) => sample(context({ rng }), 300, { strand }));
    for (const plan of plans) expect(['story', 'studio', 'mission']).not.toContain(plan.mode);
  });

  it('robot mode: a skill that suits robot coding and the robot interaction', () => {
    const plans = planFromContext(context(), 3, { mode: 'robot' });
    for (const plan of plans) {
      expect(plan.mode).toBe('robot');
      expect(plan.interaction).toBe('robot');
      expect(skillOrThrow(plan.skillId).modes).toContain('robot');
    }
  });

  it('invention mode: a skill that suits inventing and the build interaction', () => {
    const plans = planFromContext(context(), 3, { mode: 'invention' });
    for (const plan of plans) {
      expect(plan.mode).toBe('invention');
      expect(plan.interaction).toBe('build');
      expect(skillOrThrow(plan.skillId).modes).toContain('invention');
    }
  });

  it('has the robot and build interactions on every skill that lists those modes', () => {
    for (const skill of SKILLS) {
      if (skill.modes.includes('robot')) expect(skill.interactions).toContain('robot');
      if (skill.modes.includes('invention')) expect(skill.interactions).toContain('build');
    }
  });

  it.each(['story', 'studio', 'experiment', 'detective', 'fixbot', 'wonder'] as const)(
    '%s mode: every plan uses the mode and a skill that lists it',
    (mode) => {
      const plans = planFromContext(context({ rng: seededRng(31) }), 4, { mode });
      for (const plan of plans) {
        expect(plan.mode).toBe(mode);
        expect(skillOrThrow(plan.skillId).modes).toContain(mode);
      }
    },
  );

  it('experiment, detective, fixbot and wonder items are answered by choosing, typing a number or ordering', () => {
    for (const mode of ['experiment', 'detective', 'fixbot', 'wonder'] as const) {
      for (const plan of sample(context({ rng: seededRng(37) }), 60, { mode })) {
        expect(['choice', 'number', 'order']).toContain(plan.interaction);
      }
    }
  });

  it('plans a real-world mission only when the parent allows them', () => {
    const allowed = planFromContext(context({ controls: controls({ realWorldMissions: true }) }), 3, { mode: 'mission' });
    for (const plan of allowed) {
      expect(plan.mode).toBe('mission');
      expect(['choice', 'number']).toContain(plan.interaction);
      expect(skillOrThrow(plan.skillId).modes).toContain('mission');
    }
    const refused = sample(context({ controls: controls({ realWorldMissions: false }), rng: seededRng(41) }), 100, {
      mode: 'mission',
    });
    expect(refused.some((p) => p.mode === 'mission')).toBe(false);
  });

  it('stays inside the enabled strands even when no skill there lists the mode', () => {
    const mathOnly = controls({ strands: { math: true, science: false, technology: false, engineering: false, logic: false } });
    const plans = planFromContext(context({ controls: mathOnly }), 2, { mode: 'robot' });
    for (const plan of plans) {
      expect(plan.strand).toBe('math');
      expect(plan).toMatchObject({ mode: 'robot', interaction: 'robot' });
    }
  });
});

describe('planFromContext: placement', () => {
  const placing = (patch: Partial<PlannerContext> = {}, child: Partial<ChildProfile> = {}) =>
    context(patch, { placementDone: false, grade: '3', ...child });

  it('plans placement items over the strands in rotation, starting below the enrolled grade', () => {
    const plans = planFromContext(placing(), 8);
    expect(plans.every((p) => p.purpose === 'placement' && p.mode === 'quest')).toBe(true);
    expect(plans.map((p) => p.strand)).toEqual([
      'math', 'science', 'technology', 'engineering', 'logic', 'math', 'science', 'technology',
    ]);
    for (const plan of plans) {
      expect(plan.stage).toBe(clampStageToSkill(skillOrThrow(plan.skillId), makeStage('2', 'growing')));
      expect(['robot', 'build']).not.toContain(plan.interaction);
    }
    expect(new Set(plans.map((p) => p.skillId)).size).toBe(8);
  });

  it('uses the updated estimate of the strand and a skill that was not asked yet', () => {
    const placement = {
      ...freshPlacement(),
      answered: 5,
      start: { math: 13 },
      estimates: { math: 16 },
      attempted: [{ skillId: 'math-geometry-shapes', strand: 'math' as const, interaction: 'tap' as const }],
    };
    for (const seed of [1, 2, 3, 4, 5]) {
      const [plan] = planFromContext(placing({ placement, rng: seededRng(seed) }), 1);
      expect(plan).toMatchObject({ purpose: 'placement', strand: 'math' });
      expect(plan?.skillId).not.toBe('math-geometry-shapes');
      expect(plan?.stage).toBe(clampStageToSkill(skillOrThrow(plan?.skillId ?? ''), 16));
    }
  });

  it('asks about skills that have room below and above the estimate', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const [plan] = planFromContext(placing({ rng: seededRng(seed) }), 1);
      // Counting ends at grade 2 and multiplication only starts there: neither can show a grade 1 or grade 3 level.
      expect(plan?.strand).toBe('math');
      expect(['math-counting-cardinality', 'math-multiplication-division']).not.toContain(plan?.skillId);
    }
  });

  it('asks a fitting skill again rather than one that is not taught at the estimate', () => {
    const child = childProfile({ grade: '1', placementDone: false });
    const mathOnly = controls({ strands: { math: true, science: false, technology: false, engineering: false, logic: false } });
    const preK = makeStage('PK', 'starting');
    // Every math skill that exists at Pre-K was asked already; multiplication, fractions and algebra start later.
    const asked = skillsForStrand('math').filter((skill) => skill.gradeExpectations.PK !== undefined);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThan(skillsForStrand('math').length);
    const placement = {
      ...freshPlacement(),
      start: { math: makeStage('K', 'growing') },
      estimates: { math: preK },
      answered: asked.length,
      attempted: asked.map((skill) => ({ skillId: skill.id, strand: 'math' as const, interaction: 'choice' as const })),
    };
    for (let seed = 1; seed <= 20; seed += 1) {
      const [plan] = planFromContext(context({ child, controls: mathOnly, placement, rng: seededRng(seed) }), 1);
      expect(plan?.purpose).toBe('placement');
      expect(plan?.stage).toBe(preK);
      expect(asked.map((skill) => skill.id)).toContain(plan?.skillId);
    }
  });

  it('counts queued placement items, and fills the rest of the request with regular items', () => {
    const placement = { ...freshPlacement(), answered: 5 };
    const pending = [trail('math-place-value', { purpose: 'placement' }), trail('science-matter', { purpose: 'placement' })];
    const plans = planFromContext(placing({ placement, pending }), 3);
    expect(plans.map((p) => p.purpose)).toEqual(['placement', 'core', 'core']);
    expect(plans[0]?.strand).toBe('technology');
  });

  it('still plans eight items when only two strands are enabled', () => {
    const two = controls({ strands: { math: false, science: true, technology: false, engineering: false, logic: true } });
    const plans = planFromContext(placing({ controls: two }), 9);
    expect(plans.slice(0, 8).every((p) => p.purpose === 'placement')).toBe(true);
    expect(plans[8]?.purpose).toBe('core');
    expect(plans.slice(0, 8).map((p) => p.strand)).toEqual([
      'science', 'logic', 'science', 'logic', 'science', 'logic', 'science', 'logic',
    ]);
  });

  it('plans regular items once eight are answered, even before the profile is updated', () => {
    const placement = { ...freshPlacement(), answered: 0 };
    const pending = Array.from({ length: 8 }, () => trail('math-place-value', { purpose: 'placement' }));
    expect(planFromContext(placing({ placement, pending }), 1)[0]?.purpose).toBe('core');
  });

  it('starts over when a parent restarts a finished placement', () => {
    const finished = { ...freshPlacement(), answered: 8, estimates: { math: 30 } };
    const [plan] = planFromContext(placing({ placement: finished }), 1);
    expect(plan).toMatchObject({ purpose: 'placement', strand: 'math' });
    expect(plan?.stage).toBe(clampStageToSkill(skillOrThrow(plan?.skillId ?? ''), 13));
  });

  it('lets the child start a mode of their own before placement is finished', () => {
    const [plan] = planFromContext(placing(), 1, { mode: 'robot' });
    expect(plan).toMatchObject({ purpose: 'core', mode: 'robot' });
  });

  it('uses easy-to-answer kinds for the youngest children', () => {
    const plans = planFromContext(placing({}, { ageGroup: '3-5', grade: 'PK' }), 8);
    for (const plan of plans) {
      expect(YOUNG_KINDS).toContain(plan.interaction);
      expect(plan.stage).toBeLessThanOrEqual(makeStage('K', 'starting'));
    }
  });

  it('does not plan placement for a child who is done with it', () => {
    expect(planFromContext(context(), 3).some((p) => p.purpose === 'placement')).toBe(false);
  });
});

describe('planNext', () => {
  beforeEach(resetDb);
  afterEach(() => setRng(null));

  it('throws for an unknown child', async () => {
    await expect(planNext('nobody')).rejects.toThrow(/not found/);
  });

  it('returns one plan by default and uses the module-level random source', async () => {
    const child = await addChild({ grade: '3' });
    setRng(seededRng(5));
    const first = await planNext(child.id);
    setRng(seededRng(5));
    const again = await planNext(child.id);
    expect(first).toHaveLength(1);
    expect(again).toEqual(first);
    const other = await planNext(child.id, 1, { rng: seededRng(6) });
    const otherAgain = await planNext(child.id, 1, { rng: seededRng(6) });
    expect(otherAgain).toEqual(other);
  });

  it('reads the skill states: a pending concept check comes first', async () => {
    const child = await addChild({ grade: '3' });
    await db.skillStates.put(stateFor(child.id, 'science-matter', 17, { checkPending: true }));
    const [plan] = await planNext(child.id, 1, { rng: seededRng(1) });
    expect(plan).toMatchObject({ purpose: 'check', skillId: 'science-matter', stage: 17 });
  });

  it('uses `now` to decide which reviews are due', async () => {
    const child = await addChild({ grade: '3' });
    await db.skillStates.put(stateFor(child.id, 'science-matter', 17, { reviewDueAt: MONDAY + DAY }));
    const rng = () => 0.1;
    expect((await planNext(child.id, 1, { now: MONDAY, rng }))[0]?.purpose).toBe('core');
    expect((await planNext(child.id, 1, { now: MONDAY + 2 * DAY, rng }))[0]).toMatchObject({
      purpose: 'review',
      skillId: 'science-matter',
    });
  });

  it('avoids queued and active challenges and the one completed last, and continues the rotation', async () => {
    const child = await addChild({ grade: '3' });
    await db.skillStates.bulkPut(allPractised(child.id));
    await db.challenges.bulkPut([
      challengeFor(child.id, { skillId: 'math-place-value', status: 'completed', completedAt: MONDAY - 3000 }),
      challengeFor(child.id, { skillId: 'logic-patterns', status: 'completed', completedAt: MONDAY - 2000 }),
      challengeFor(child.id, { skillId: 'science-matter', status: 'queued', createdAt: MONDAY - 1000 }),
      challengeFor(child.id, { skillId: 'technology-loops', status: 'active', createdAt: MONDAY - 500 }),
      challengeFor(child.id, { skillId: 'engineering-materials', status: 'discarded', createdAt: MONDAY - 100 }),
    ]);
    const seen = new Set<string>();
    const firstStrands = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const plans = await planNext(child.id, 3, { rng: seededRng(seed), now: MONDAY });
      for (const plan of plans) seen.add(plan.skillId);
      if (plans[0] && plans[0].purpose === 'core') firstStrands.add(plans[0].strand);
    }
    expect(seen.has('logic-patterns')).toBe(false);
    expect(seen.has('science-matter')).toBe(false);
    expect(seen.has('technology-loops')).toBe(false);
    // The latest planned challenge was technology, so core items continue with engineering.
    expect([...firstStrands]).toEqual(['engineering']);
  });

  it('applies the parental controls of the device and the child override', async () => {
    await updateSettings((s) => ({
      ...s,
      controls: { ...s.controls, strands: { ...s.controls.strands, math: false, science: false } },
    }));
    const child = await addChild({
      grade: '3',
      controlsOverride: { strands: { math: false, science: false, technology: false, engineering: true, logic: true } },
    });
    const plans = await planNext(child.id, 6, { rng: seededRng(2) });
    expect(new Set(plans.map((p) => p.strand))).toEqual(new Set(['engineering', 'logic']));
  });

  it('returns placement items for a new child, using the estimates stored between attempts', async () => {
    const child = await addChild({ grade: '3', placementDone: false });
    const first = await planNext(child.id, 2, { rng: seededRng(3) });
    expect(first.map((p) => p.purpose)).toEqual(['placement', 'placement']);
    expect(first.map((p) => p.strand)).toEqual(['math', 'science']);

    await writePlacement(child.id, {
      ...freshPlacement(),
      answered: 5,
      start: { math: 13 },
      estimates: { math: 19 },
      attempted: [{ skillId: first[0]?.skillId ?? '', strand: 'math', interaction: 'choice' }],
    });
    const [next] = await planNext(child.id, 1, { rng: seededRng(3) });
    expect(next).toMatchObject({ purpose: 'placement', strand: 'math' });
    expect(next?.skillId).not.toBe(first[0]?.skillId);
    expect(next?.stage).toBe(clampStageToSkill(skillOrThrow(next?.skillId ?? ''), 19));
  });
});

describe('makeSiblingPlan', () => {
  it('keeps the skill, interaction and theme and goes one stage step lower', () => {
    const previous = challengeFor('c1', {
      skillId: 'math-place-value',
      stage: 17,
      interaction: 'order',
      mode: 'detective',
      theme: 'dinosaurs',
      purpose: 'core',
    });
    expect(makeSiblingPlan(previous)).toEqual({
      childId: 'c1',
      skillId: 'math-place-value',
      strand: 'math',
      stage: 16,
      interaction: 'order',
      mode: 'detective',
      purpose: 'sibling',
      theme: 'dinosaurs',
    });
  });

  it('never goes below the lowest stage of the skill', () => {
    const lowest = makeStage('2', 'starting');
    const previous = challengeFor('c1', { skillId: 'math-multiplication-division', stage: lowest });
    expect(makeSiblingPlan(previous).stage).toBe(lowest);
    expect(makeSiblingPlan(challengeFor('c1', { skillId: 'math-place-value', stage: 0 })).stage).toBe(0);
  });

  it('keeps robot and invention items in their mode', () => {
    const robot = challengeFor('c1', { skillId: 'technology-loops', interaction: 'robot', mode: 'robot', stage: 9 });
    expect(makeSiblingPlan(robot)).toMatchObject({ mode: 'robot', interaction: 'robot', stage: 8 });
  });

  it.each(['story', 'studio', 'mission'] as const)('turns the sibling of a %s item into a plain quest', (mode) => {
    const previous = challengeFor('c1', { skillId: 'math-place-value', mode, stage: 17 });
    expect(makeSiblingPlan(previous).mode).toBe('quest');
  });

  it('still answers for a skill that is no longer in the map', () => {
    const previous = challengeFor('c1', { skillId: 'retired-skill', strand: 'logic', stage: 5 });
    expect(makeSiblingPlan(previous)).toMatchObject({ skillId: 'retired-skill', strand: 'logic', stage: 4 });
  });
});
