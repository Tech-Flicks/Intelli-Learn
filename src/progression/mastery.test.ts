import { describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { getSkill } from '@/core/skills';
import type { AttemptOutcome, ItemPurpose, SkillDef, SkillState } from '@/core/types';
import {
  aggregateStrandStage,
  applyAttempt,
  isTopStage,
  newSkillState,
  nextReviewInterval,
  stepDown,
  stepUp,
  type AttemptEvent,
} from './mastery';
import { DAY, MONDAY, stateFor } from './testing';
import { TUNING } from './tuning';

const M = TUNING.mastery;

function skillOrThrow(id: string): SkillDef {
  const skill = getSkill(id);
  if (!skill) throw new Error(`missing skill ${id}`);
  return skill;
}

/** Pre-K to grade 4. */
const ADDITION = skillOrThrow('math-addition-subtraction');
/** Grade 2 to grade 8. */
const MULTIPLICATION = skillOrThrow('math-multiplication-division');

function event(outcome: AttemptOutcome, patch: Partial<AttemptEvent> = {}): AttemptEvent {
  return { purpose: 'core', outcome, teachBackCorrect: null, interaction: 'choice', now: MONDAY, ...patch };
}

function fresh(patch: Partial<SkillState> = {}): SkillState {
  return { ...newSkillState('c1', ADDITION.id, 'math', makeStage('2', 'starting')), ...patch };
}

/** Applies the outcomes one after another and returns every update. */
function run(start: SkillState, outcomes: AttemptOutcome[], purpose: ItemPurpose = 'core', skill = ADDITION) {
  const updates = [];
  let state = start;
  for (const outcome of outcomes) {
    const update = applyAttempt(state, skill, event(outcome, { purpose }));
    updates.push(update);
    state = update.state;
  }
  return updates;
}

describe('stage steps', () => {
  it('moves one step up and down inside the skill', () => {
    expect(stepUp(ADDITION, 12)).toBe(13);
    expect(stepDown(ADDITION, 12)).toBe(11);
  });

  it('stops at the top and the bottom of the skill', () => {
    const top = makeStage('4', 'ready');
    expect(stepUp(ADDITION, top)).toBe(top);
    expect(isTopStage(ADDITION, top)).toBe(true);
    expect(isTopStage(ADDITION, top - 1)).toBe(false);
    const bottom = makeStage('2', 'starting');
    expect(stepDown(MULTIPLICATION, bottom)).toBe(bottom);
    expect(stepDown(ADDITION, 0)).toBe(0);
  });

  it('stays inside 0..39 when the skill is unknown', () => {
    expect(stepUp(undefined, 39)).toBe(39);
    expect(stepDown(undefined, 0)).toBe(0);
    expect(stepUp(undefined, 7)).toBe(8);
  });
});

describe('mastery gains', () => {
  it.each([
    ['independent', 25],
    ['second-try', 15],
    ['nudge', 10],
    ['hint', 5],
    ['walkthrough', 0],
  ] as const)('a %s solve adds %i mastery', (outcome, gain) => {
    const update = applyAttempt(fresh(), ADDITION, event(outcome));
    expect(update.state.mastery).toBe(gain);
    expect(update.masteryDelta).toBe(gain);
    expect(update.stageChange).toBeNull();
    expect(update.state.attempts).toBe(1);
    expect(update.state.lastPracticedAt).toBe(MONDAY);
  });

  it('adds 5 for a correct teach-back, and nothing for a wrong or missing one', () => {
    expect(applyAttempt(fresh(), ADDITION, event('nudge', { teachBackCorrect: true })).state.mastery).toBe(15);
    expect(applyAttempt(fresh(), ADDITION, event('nudge', { teachBackCorrect: false })).state.mastery).toBe(10);
    expect(applyAttempt(fresh(), ADDITION, event('walkthrough', { teachBackCorrect: true })).state.mastery).toBe(5);
  });

  it('gives only 10 for a review solved independently, and less with help', () => {
    expect(applyAttempt(fresh(), ADDITION, event('independent', { purpose: 'review' })).state.mastery).toBe(10);
    expect(applyAttempt(fresh(), ADDITION, event('second-try', { purpose: 'review' })).state.mastery).toBe(6);
    expect(applyAttempt(fresh(), ADDITION, event('hint', { purpose: 'review' })).state.mastery).toBe(2);
    expect(applyAttempt(fresh(), ADDITION, event('walkthrough', { purpose: 'review' })).state.mastery).toBe(0);
  });

  it.each(['stretch', 'sibling', 'placement'] as const)('treats a %s item like a regular one', (purpose) => {
    expect(applyAttempt(fresh(), ADDITION, event('independent', { purpose })).state.mastery).toBe(25);
  });

  it('never lowers mastery on a regular item and does not mutate the previous state', () => {
    const before = fresh({ mastery: 40 });
    const snapshot = { ...before };
    const update = applyAttempt(before, ADDITION, event('walkthrough'));
    expect(update.state.mastery).toBe(40);
    expect(before).toEqual(snapshot);
  });

  it('remembers the four most recent interaction kinds, newest first', () => {
    let state = fresh();
    for (const interaction of ['choice', 'number', 'match', 'tap', 'sort'] as const) {
      state = applyAttempt(state, ADDITION, event('hint', { interaction })).state;
    }
    expect(state.recentInteractions).toEqual(['sort', 'tap', 'match', 'number']);
  });
});

describe('getting ready to move up', () => {
  it('marks a concept check at mastery 80, without changing the stage', () => {
    const update = applyAttempt(fresh({ mastery: 70 }), ADDITION, event('nudge'));
    expect(update.state.mastery).toBe(80);
    expect(update.state.checkPending).toBe(true);
    expect(update.state.stage).toBe(makeStage('2', 'starting'));
    expect(update.stageChange).toBeNull();
  });

  it('does not mark a check just below 80', () => {
    const update = applyAttempt(fresh({ mastery: 69 }), ADDITION, event('nudge'));
    expect(update.state.mastery).toBe(79);
    expect(update.state.checkPending).toBe(false);
  });

  it('fast-tracks three independent solves in a row once mastery is 60 or more', () => {
    const updates = run(fresh(), ['independent', 'independent', 'independent']);
    expect(updates.map((u) => u.state.mastery)).toEqual([25, 50, 75]);
    expect(updates.map((u) => u.state.checkPending)).toEqual([false, false, true]);
    expect(updates[2]?.state.independentStreak).toBe(3);
  });

  it('does not fast-track below mastery 60', () => {
    const update = applyAttempt(fresh({ mastery: 30, independentStreak: 2 }), ADDITION, event('independent'));
    expect(update.state.independentStreak).toBe(3);
    expect(update.state.mastery).toBe(55);
    expect(update.state.checkPending).toBe(false);
  });

  it('does not fast-track when the run was broken by a second try', () => {
    const updates = run(fresh({ mastery: 10 }), ['independent', 'second-try', 'independent']);
    expect(updates[2]?.state.mastery).toBe(75);
    expect(updates[2]?.state.independentStreak).toBe(1);
    expect(updates[2]?.state.checkPending).toBe(false);
  });

  it('caps mastery at 100 and asks for no check when the skill is at its top stage', () => {
    const top = fresh({ stage: makeStage('4', 'ready'), mastery: 90 });
    const update = applyAttempt(top, ADDITION, event('independent'));
    expect(update.state.mastery).toBe(M.max);
    expect(update.masteryDelta).toBe(10);
    expect(update.state.checkPending).toBe(false);
    expect(update.stageChange).toBeNull();
  });

  it('keeps collecting mastery up to 100 while a check is pending', () => {
    const update = applyAttempt(fresh({ mastery: 90, checkPending: true }), ADDITION, event('independent'));
    expect(update.state.mastery).toBe(100);
    expect(update.state.checkPending).toBe(true);
    expect(update.stageChange).toBeNull();
  });
});

describe('concept checks', () => {
  const ready = () => fresh({ mastery: 85, checkPending: true, checksPassed: 1 });

  it.each(['independent', 'second-try'] as const)('a check solved %s moves the skill up one step', (outcome) => {
    const update = applyAttempt(ready(), ADDITION, event(outcome, { purpose: 'check' }));
    expect(update.stageChange).toEqual({ from: 12, to: 13, reason: 'mastery' });
    expect(update.state.stage).toBe(13);
    expect(update.state.mastery).toBe(M.afterStepUp);
    expect(update.state.checkPending).toBe(false);
    expect(update.state.checksPassed).toBe(2);
    expect(update.checkPassed).toBe(true);
    expect(update.masteryDelta).toBe(0);
  });

  it('schedules the first spaced review two days after moving up', () => {
    const update = applyAttempt(ready(), ADDITION, event('independent', { purpose: 'check' }));
    expect(update.state.reviewIntervalDays).toBe(2);
    expect(update.state.reviewDueAt).toBe(MONDAY + 2 * DAY);
  });

  it('crosses into the next grade from the last step of a grade', () => {
    const state = fresh({ stage: makeStage('2', 'ready'), mastery: 80, checkPending: true });
    const update = applyAttempt(state, ADDITION, event('independent', { purpose: 'check' }));
    expect(update.state.stage).toBe(makeStage('3', 'starting'));
  });

  it.each(['nudge', 'hint'] as const)('a check that needed a %s drops mastery to 60 and keeps the stage', (outcome) => {
    const update = applyAttempt(ready(), ADDITION, event(outcome, { purpose: 'check' }));
    expect(update.stageChange).toBeNull();
    expect(update.state.stage).toBe(12);
    expect(update.state.mastery).toBe(60);
    expect(update.masteryDelta).toBe(-25);
    expect(update.state.checkPending).toBe(false);
    expect(update.state.checksPassed).toBe(1);
    expect(update.checkPassed).toBe(false);
    expect(update.state.reviewDueAt).toBeNull();
  });

  it('a check that needed the walkthrough drops mastery to 40', () => {
    const update = applyAttempt(ready(), ADDITION, event('walkthrough', { purpose: 'check' }));
    expect(update.stageChange).toBeNull();
    expect(update.state.mastery).toBe(40);
    expect(update.state.checkPending).toBe(false);
    expect(update.state.assistedStreak).toBe(1);
  });

  it('needs more practice and another check after a failed check', () => {
    const failed = applyAttempt(ready(), ADDITION, event('hint', { purpose: 'check' })).state;
    const practised = applyAttempt(failed, ADDITION, event('independent')).state;
    expect(practised.mastery).toBe(85);
    expect(practised.checkPending).toBe(true);
    expect(practised.stage).toBe(12);
  });

  it('treats a check item as regular practice when no check is pending', () => {
    const update = applyAttempt(fresh({ mastery: 30 }), ADDITION, event('independent', { purpose: 'check' }));
    expect(update.state.mastery).toBe(55);
    expect(update.state.stage).toBe(12);
    expect(update.checkPassed).toBe(false);
  });

  it('keeps a streak going across a passed check, so a child above level moves quickly', () => {
    const state = fresh({ mastery: 75, checkPending: true, independentStreak: 3 });
    const passed = applyAttempt(state, ADDITION, event('independent', { purpose: 'check' })).state;
    expect(passed.independentStreak).toBe(4);
    const next = run(passed, ['independent', 'independent']);
    expect(next.map((u) => u.state.mastery)).toEqual([45, 70]);
    expect(next.map((u) => u.state.checkPending)).toEqual([false, true]);
  });
});

describe('needing a lot of support', () => {
  it('moves down one step after three walkthroughs in a row', () => {
    const updates = run(fresh({ mastery: 30 }), ['walkthrough', 'walkthrough', 'walkthrough']);
    expect(updates.map((u) => u.state.assistedStreak)).toEqual([1, 2, 0]);
    expect(updates[1]?.stageChange).toBeNull();
    expect(updates[2]?.stageChange).toEqual({ from: 12, to: 11, reason: 'support' });
    expect(updates[2]?.state.stage).toBe(11);
    expect(updates[2]?.state.mastery).toBe(M.afterStepDown);
  });

  it('never moves below the lowest stage of the skill', () => {
    const lowest = { ...newSkillState('c1', MULTIPLICATION.id, 'math', makeStage('2', 'starting')), mastery: 30 };
    const updates = run(lowest, ['walkthrough', 'walkthrough', 'walkthrough'], 'core', MULTIPLICATION);
    expect(updates[2]?.stageChange).toBeNull();
    expect(updates[2]?.state.stage).toBe(makeStage('2', 'starting'));
    expect(updates[2]?.state.mastery).toBe(30);
    expect(updates[2]?.state.assistedStreak).toBe(0);
  });

  it('a strong hint neither adds to nor clears the run of walkthroughs', () => {
    const updates = run(fresh(), ['walkthrough', 'walkthrough', 'hint', 'walkthrough']);
    expect(updates.map((u) => u.state.assistedStreak)).toEqual([1, 2, 2, 0]);
    expect(updates[2]?.stageChange).toBeNull();
    expect(updates[3]?.stageChange?.reason).toBe('support');
  });

  it.each(['independent', 'second-try', 'nudge'] as const)('a %s solve clears the run of walkthroughs', (outcome) => {
    const updates = run(fresh(), ['walkthrough', 'walkthrough', outcome, 'walkthrough']);
    expect(updates.map((u) => u.state.assistedStreak)).toEqual([1, 2, 0, 1]);
    expect(updates.every((u) => u.stageChange === null)).toBe(true);
  });

  it('cancels a pending check when the skill moves down', () => {
    const state = fresh({ mastery: 90, checkPending: true, assistedStreak: 2 });
    const update = applyAttempt(state, ADDITION, event('walkthrough'));
    expect(update.state.stage).toBe(11);
    expect(update.state.checkPending).toBe(false);
  });
});

describe('spaced review', () => {
  const dueState = (interval: number) =>
    fresh({ mastery: 20, reviewDueAt: MONDAY - 1000, reviewIntervalDays: interval });
  const review = (outcome: AttemptOutcome) => event(outcome, { purpose: 'review' });

  it('advances 2 -> 7 -> 21 -> 21', () => {
    expect(nextReviewInterval(2)).toBe(7);
    expect(nextReviewInterval(7)).toBe(21);
    expect(nextReviewInterval(21)).toBe(21);
  });

  it.each(['independent', 'second-try'] as const)('a due review solved %s moves to the next interval', (outcome) => {
    const update = applyAttempt(dueState(2), ADDITION, review(outcome));
    expect(update.state.reviewIntervalDays).toBe(7);
    expect(update.state.reviewDueAt).toBe(MONDAY + 7 * DAY);
  });

  it('stays at 21 days once it is there', () => {
    const update = applyAttempt(dueState(21), ADDITION, review('independent'));
    expect(update.state.reviewIntervalDays).toBe(21);
    expect(update.state.reviewDueAt).toBe(MONDAY + 21 * DAY);
  });

  it.each(['hint', 'walkthrough'] as const)('a review that needed a %s goes back to 2 days', (outcome) => {
    const update = applyAttempt(dueState(21), ADDITION, review(outcome));
    expect(update.state.reviewIntervalDays).toBe(2);
    expect(update.state.reviewDueAt).toBe(MONDAY + 2 * DAY);
  });

  it('a nudge repeats the current interval', () => {
    const update = applyAttempt(dueState(7), ADDITION, review('nudge'));
    expect(update.state.reviewIntervalDays).toBe(7);
    expect(update.state.reviewDueAt).toBe(MONDAY + 7 * DAY);
  });

  it('an early review that went well leaves the schedule alone', () => {
    const early = fresh({ reviewDueAt: MONDAY + DAY, reviewIntervalDays: 7 });
    const update = applyAttempt(early, ADDITION, review('independent'));
    expect(update.state.reviewIntervalDays).toBe(7);
    expect(update.state.reviewDueAt).toBe(MONDAY + DAY);
  });

  it('a review that needed the walkthrough is scheduled even when none was planned', () => {
    const update = applyAttempt(fresh(), ADDITION, review('walkthrough'));
    expect(update.state.reviewDueAt).toBe(MONDAY + 2 * DAY);
  });

  it('a regular item does not touch the schedule', () => {
    const update = applyAttempt(dueState(7), ADDITION, event('independent'));
    expect(update.state.reviewDueAt).toBe(MONDAY - 1000);
    expect(update.state.reviewIntervalDays).toBe(7);
  });
});

describe('aggregateStrandStage', () => {
  it('is null when nothing in the strand was practised', () => {
    expect(aggregateStrandStage([], 'math')).toEqual({ stage: null, practisedSkills: 0 });
    const unpractised = stateFor('c1', ADDITION.id, 12, { attempts: 0 });
    const other = stateFor('c1', 'science-matter', 20);
    expect(aggregateStrandStage([unpractised, other], 'math')).toEqual({ stage: null, practisedSkills: 0 });
  });

  it('is the attempts-weighted mean of the practised skills, rounded', () => {
    const states = [
      stateFor('c1', ADDITION.id, 12, { attempts: 3 }),
      stateFor('c1', MULTIPLICATION.id, 16, { attempts: 1 }),
    ];
    // (12 * 3 + 16 * 1) / 4 = 13
    expect(aggregateStrandStage(states, 'math')).toEqual({ stage: 13, practisedSkills: 2 });
  });

  it('caps the weight of one skill at ten attempts', () => {
    const states = [
      stateFor('c1', ADDITION.id, 10, { attempts: 500 }),
      stateFor('c1', MULTIPLICATION.id, 20, { attempts: 10 }),
    ];
    expect(aggregateStrandStage(states, 'math').stage).toBe(15);
  });

  it('only looks at the given strand', () => {
    const states = [stateFor('c1', ADDITION.id, 12), stateFor('c1', 'science-matter', 30)];
    expect(aggregateStrandStage(states, 'math').stage).toBe(12);
    expect(aggregateStrandStage(states, 'science').stage).toBe(30);
  });
});
