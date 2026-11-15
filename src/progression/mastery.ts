/**
 * The stage engine: pure functions that turn one attempt into a new skill state.
 *
 * Mastery (0-100) measures progress inside the current stage step. Mastery
 * alone never raises a stage: when a skill is ready to move up it is marked
 * `checkPending`, and only a passed concept check moves it up one step.
 */
import { clampStage } from '@/core/grades';
import { clampStageToSkill } from '@/core/skills';
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
      const to = stepUp(skill, prev.stage);
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
 */
export function aggregateStrandStage(
  states: readonly SkillState[],
  strand: Strand,
): { stage: StageValue | null; practisedSkills: number } {
  let weightSum = 0;
  let stageSum = 0;
  let practisedSkills = 0;
  for (const state of states) {
    if (state.strand !== strand || state.attempts <= 0) continue;
    const weight = Math.min(state.attempts, TUNING.mastery.strandWeightCap);
    weightSum += weight;
    stageSum += state.stage * weight;
    practisedSkills += 1;
  }
  if (weightSum === 0) return { stage: null, practisedSkills: 0 };
  return { stage: clampStage(stageSum / weightSum), practisedSkills };
}
