/**
 * The stage engine: pure functions that turn one attempt into a new skill state.
 *
 * Mastery (0-100) measures progress inside the current stage step. Mastery
 * alone never raises a stage: when a skill is ready to move up it is marked
 * `checkPending`, and only a passed concept check moves it up one step.
 */
import { clampStage } from '@/core/grades';
import { clampStageToSkill, getSkill } from '@/core/skills';
import type {
  AttemptOutcome,
  InteractionKind,
  ItemPurpose,
  SkillDef,
  SkillState,
  StageValue,
  Strand,
} from '@/core/types';
import { DAY_MS, TUNING } from './tuning';

export function skillStateId(childId: string, skillId: string): string {
  return `${childId}:${skillId}`;
}

/** A skill the child has not practised yet, placed at `stage`. */
export function newSkillState(childId: string, skillId: string, strand: Strand, stage: StageValue): SkillState {
  return {
    id: skillStateId(childId, skillId),
    childId,
    skillId,
    strand,
    stage,
    mastery: 0,
    assistedStreak: 0,
    independentStreak: 0,
    attempts: 0,
    checkPending: false,
    checksPassed: 0,
    recentInteractions: [],
    lastPracticedAt: null,
    reviewDueAt: null,
    reviewIntervalDays: firstReviewInterval(),
  };
}

/** Clamp a stage into the skill's grades, or into 0..39 when the skill is not in the map any more. */
export function clampToSkill(skill: SkillDef | undefined, stage: number): StageValue {
  return skill ? clampStageToSkill(skill, stage) : clampStage(stage);
}

/** One stage step up, staying inside the skill's grades. Returns the same stage at the top. */
export function stepUp(skill: SkillDef | undefined, stage: StageValue): StageValue {
  return Math.max(stage, clampToSkill(skill, stage + 1));
}

/** One stage step down, never below the skill's lowest stage. */
export function stepDown(skill: SkillDef | undefined, stage: StageValue): StageValue {
  return Math.min(stage, clampToSkill(skill, stage - 1));
}

/**
 * How many steps a passed concept check moves the skill up: one, or more when the check was
 * solved at the first try at the end of a long run of independent solves (`streak` counts the
 * check itself). A child placed well below their level gets there in weeks, not in a year.
 */
export function stepsForPassedCheck(outcome: AttemptOutcome, streak: number): number {
  const m = TUNING.mastery;
  if (outcome !== 'independent') return 1;
  if (streak >= m.leapStreak) return m.leapSteps;
  if (streak >= m.accelerateStreak) return m.accelerateSteps;
  return 1;
}

/** `steps` stage steps up, staying inside the skill's grades. */
function stepUpBy(skill: SkillDef | undefined, stage: StageValue, steps: number): StageValue {
  let to = stage;
  for (let i = 0; i < steps; i += 1) to = stepUp(skill, to);
  return to;
}

export function isTopStage(skill: SkillDef | undefined, stage: StageValue): boolean {
  return stepUp(skill, stage) === stage;
}

export function firstReviewInterval(): number {
  return TUNING.review.intervalsDays[0] ?? 2;
}

/** The interval after a good review: 2 -> 7 -> 21 -> 21. */
export function nextReviewInterval(current: number): number {
  const intervals = TUNING.review.intervalsDays;
  const longest = intervals[intervals.length - 1] ?? current;
  const following = intervals.find((days) => days > current);
  return following ?? longest;
}

export interface AttemptEvent {
  purpose: ItemPurpose;
  outcome: AttemptOutcome;
  teachBackCorrect: boolean | null;
  interaction: InteractionKind;
  now: number;
}

export interface SkillStageMove {
  from: StageValue;
  to: StageValue;
  reason: 'mastery' | 'support';
}

export interface SkillUpdate {
  state: SkillState;
  /**
   * Mastery points this item added on the current step (0 or more). Negative
   * only when a concept check was not passed and mastery dropped back. 0 for a
   * passed concept check: there the gain is the stage change itself.
   */
  masteryDelta: number;
  stageChange: SkillStageMove | null;
  checkPassed: boolean;
}

const SOLVED_ALONE: readonly AttemptOutcome[] = ['independent', 'second-try'];

/** Spaced-review bookkeeping for a 'review' item. Mutates `state`. */
function applyReviewSchedule(state: SkillState, prev: SkillState, event: AttemptEvent): void {
  const wasDue = prev.reviewDueAt !== null && prev.reviewDueAt <= event.now;
  if (event.outcome === 'hint' || event.outcome === 'walkthrough') {
    // The idea did not stick: bring it back soon.
    state.reviewIntervalDays = firstReviewInterval();
    state.reviewDueAt = event.now + state.reviewIntervalDays * DAY_MS;
    return;
  }
  if (!wasDue) return; // an early review neither advances nor resets the schedule
  if (SOLVED_ALONE.includes(event.outcome)) {
    state.reviewIntervalDays = nextReviewInterval(prev.reviewIntervalDays);
  }
  // A nudge repeats the current interval.
  state.reviewDueAt = event.now + state.reviewIntervalDays * DAY_MS;
}

/**
 * Applies one solved item to a skill state and returns the new state.
 * Does not touch the database and does not mutate `prev`.
 */
export function applyAttempt(prev: SkillState, skill: SkillDef | undefined, event: AttemptEvent): SkillUpdate {
  const m = TUNING.mastery;
  const state: SkillState = {
    ...prev,
    attempts: prev.attempts + 1,
    lastPracticedAt: event.now,
    recentInteractions: [event.interaction, ...prev.recentInteractions].slice(0, m.recentInteractionsKept),
  };

  switch (event.outcome) {
    case 'independent':
      state.independentStreak = prev.independentStreak + 1;
      state.assistedStreak = 0;
      break;
    case 'second-try':
    case 'nudge':
      state.independentStreak = 0;
      state.assistedStreak = 0;
      break;
    case 'hint':
      // A strong hint neither adds to nor clears the run of walkthroughs.
      state.independentStreak = 0;
      break;
    case 'walkthrough':
      state.independentStreak = 0;
      state.assistedStreak = prev.assistedStreak + 1;
      break;
  }

  let masteryDelta = 0;
  let stageChange: SkillStageMove | null = null;
  let checkPassed = false;

  if (event.purpose === 'check' && prev.checkPending) {
    state.checkPending = false;
    if (SOLVED_ALONE.includes(event.outcome)) {
      checkPassed = true;
      state.checksPassed = prev.checksPassed + 1;
      const to = stepUpBy(skill, prev.stage, stepsForPassedCheck(event.outcome, state.independentStreak));
      if (to > prev.stage) {
        stageChange = { from: prev.stage, to, reason: 'mastery' };
        state.stage = to;
        state.mastery = m.afterStepUp;
        state.reviewIntervalDays = firstReviewInterval();
        state.reviewDueAt = event.now + state.reviewIntervalDays * DAY_MS;
      } else {
        state.mastery = m.max;
      }
    } else {
      const fallBackTo = event.outcome === 'walkthrough' ? m.afterCheckWithWalkthrough : m.afterCheckWithHelp;
      state.mastery = Math.min(prev.mastery, fallBackTo);
      masteryDelta = state.mastery - prev.mastery;
    }
  } else {
    const table = event.purpose === 'review' ? m.reviewGain : m.gain;
    const gain = table[event.outcome] + (event.teachBackCorrect === true ? m.teachBackBonus : 0);
    state.mastery = Math.min(m.max, prev.mastery + gain);
    masteryDelta = state.mastery - prev.mastery;
    if (event.purpose === 'review') applyReviewSchedule(state, prev, event);

    const ready =
      state.mastery >= m.stepUpAt ||
      (state.independentStreak >= m.fastTrackStreak && state.mastery >= m.fastTrackAt);
    if (ready && !isTopStage(skill, state.stage)) state.checkPending = true;
  }

  if (state.assistedStreak >= m.stepDownAfterWalkthroughs) {
    state.assistedStreak = 0;
    const to = stepDown(skill, state.stage);
    if (to < state.stage) {
      stageChange = { from: state.stage, to, reason: 'support' };
      state.stage = to;
      state.mastery = m.afterStepDown;
      state.checkPending = false;
    }
  }

  return { state, masteryDelta, stageChange, checkPassed };
}

/**
 * Strand stage: the mean of the stages of the strand's practised skills,
 * weighted by attempts (one skill counts at most `strandWeightCap`), rounded.
 * Null when nothing in the strand has been practised.
 *
 * Some skills end before grade 8 (counting ends at grade 2). A skill that is at
 * its own top stage while another skill of the strand is further on has nothing
 * left to show, so it does not pull the strand down: it counts at the level of
 * the other skills then (never below its own).
 */
export function aggregateStrandStage(
  states: readonly SkillState[],
  strand: Strand,
): { stage: StageValue | null; practisedSkills: number } {
  const practised = states.filter((state) => state.strand === strand && state.attempts > 0);
  if (practised.length === 0) return { stage: null, practisedSkills: 0 };
  const highest = Math.max(...practised.map((state) => state.stage));
  const rows = practised.map((state) => ({
    stage: state.stage,
    weight: Math.min(state.attempts, TUNING.mastery.strandWeightCap),
    leftBehind: state.stage < highest && isTopStage(getSkill(state.skillId), state.stage),
  }));

  const mean = (list: readonly { stage: number; weight: number }[]): number =>
    list.reduce((sum, row) => sum + row.stage * row.weight, 0) / list.reduce((sum, row) => sum + row.weight, 0);
  // The skill at the highest stage is never left behind, so this list is not empty.
  const level = mean(rows.filter((row) => !row.leftBehind));
  const counted = rows.map((row) => (row.leftBehind ? { stage: Math.max(row.stage, level), weight: row.weight } : row));
  return { stage: clampStage(mean(counted)), practisedSkills: rows.length };
}
