/**
 * Every number the progression service uses, in one place.
 *
 * Change a value here and the behaviour changes everywhere. The unit tests in
 * this directory read these constants instead of repeating the numbers, except
 * `tuning.test.ts`, which pins the agreed values so that a change is deliberate.
 */
import type { AttemptOutcome } from '@/core/types';

type PerOutcome = Readonly<Record<AttemptOutcome, number>>;

export const TUNING = {
  mastery: {
    /** Mastery points (0-100 inside one stage step) earned by an item, by how much help was needed. */
    gain: { independent: 25, 'second-try': 15, nudge: 10, hint: 5, walkthrough: 0 } as PerOutcome,
    /** A review item re-tests something already learned, so it moves mastery less (independent gives 10 only). */
    reviewGain: { independent: 10, 'second-try': 6, nudge: 4, hint: 2, walkthrough: 0 } as PerOutcome,
    /** Extra mastery when the child explained the idea back correctly. */
    teachBackBonus: 5,
    /** Mastery at which the skill is ready to move up one stage step (confirmed by a concept check). */
    stepUpAt: 80,
    /** Mastery a skill starts with on the new step after moving up. */
    afterStepUp: 20,
    /** Fast track: this many independent solves in a row ... */
    fastTrackStreak: 3,
    /** ... at this mastery or more also makes the skill ready to move up. */
    fastTrackAt: 60,
    /** Upper bound of mastery. A skill at its top stage stays here. */
    max: 100,
    /** Consecutive walkthroughs on a skill that move it down one stage step. */
    stepDownAfterWalkthroughs: 3,
    /** Mastery after moving down a step: half way, so the child is not far from moving back up. */
    afterStepDown: 50,
    /** Mastery after a concept check that needed a nudge or a hint: more practice, then another check. */
    afterCheckWithHelp: 60,
    /** Mastery after a concept check that needed the walkthrough. */
    afterCheckWithWalkthrough: 40,
    /** How many recent interaction kinds are remembered per skill, to vary the format. */
    recentInteractionsKept: 4,
    /** Strand stage = mean of its practised skills weighted by attempts; one skill counts at most this much. */
    strandWeightCap: 10,
  },
  review: {
    /** Spaced review intervals in days. A good review moves one to the right; the last one repeats. */
    intervalsDays: [2, 7, 21] as readonly number[],
    /** Due reviews are served first, but at most one review in this many items. */
    atMostOneIn: 5,
  },
  stars: {
    /** Stars per solved item. Help never costs the last star: every solved item earns at least one. */
    perOutcome: { independent: 3, 'second-try': 2, nudge: 2, hint: 1, walkthrough: 1 } as PerOutcome,
    /** Bonus star for a correct teach-back. */
    teachBackBonus: 1,
  },
  companion: {
    /** Companion xp needed for growth 0 (egg), 1 (hatchling), 2 (junior), 3 (grown), 4 (legendary). */
    growthXp: [0, 15, 60, 150, 300] as readonly number[],
  },
  streak: {
    /** The streak continues when the last played day is at most this many days ago (2 = one missed day is forgiven). */
    forgivenGapDays: 2,
    /** Streak lengths that are celebrated with a 'streak' reward. */
    milestones: [3, 7, 14, 30] as readonly number[],
  },
  badges: {
    solveMilestones: [10, 50, 100, 250] as readonly number[],
    /** Independent solves in a row for "On a Roll". */
    independentRun: 5,
    /** Wrong tries before the correct answer for "Never Gave Up". */
    wrongTries: 3,
    /** Solves in one strand for that strand's explorer badge. */
    strandExplorer: 5,
    teachBacks: 5,
    /** Different play modes tried for "Mode Explorer". */
    modes: 5,
    robotSolves: 5,
    buildSolves: 5,
    /** Reviews solved without a hint for "Memory Keeper". */
    reviewWins: 5,
    /** Real-world missions completed for "Real-World Explorer". */
    missions: 3,
  },
  placement: {
    /** Items in the first-session placement game. */
    totalItems: 8,
    /** The estimate starts this many grades from the enrolled grade (never below Pre-K) ... */
    startGradeOffset: -1,
    /** ... at this step. */
    startStep: 'growing' as const,
    /** Stage steps the strand estimate moves after one placement item. */
    steps: { independent: 3, 'second-try': 1, nudge: 0, hint: -1, walkthrough: -3 } as PerOutcome,
    /** Mastery a skill is seeded with when placement ends. */
    seedMastery: 30,
  },
  plan: {
    /** Purpose mix of regular items. The three shares add up to 1. */
    coreShare: 0.7,
    reviewShare: 0.2,
    stretchShare: 0.1,
    /** Without a requested mode, this share of items is a plain quest; the rest use one of the skill's modes. */
    questShare: 0.6,
    /** Chance that a core item introduces a skill the child has not practised yet, when one is available. */
    newSkillChance: 0.3,
    /** A skill counts as still new to the child until it has this many attempts ... */
    settledAfterAttempts: 3,
    /** ... and no further skill is introduced in a strand while this many are still new. */
    maxSettlingSkills: 2,
    /** Chance that practice goes to the skill closest to its next concept check, instead of the one practised longest ago. */
    focusChance: 0.5,
    /** A stretch item (one step above) is only offered on a skill with at least this much mastery whose last item was solved independently. */
    stretchMinMastery: 40,
    /** How many recently completed challenges the planner looks at. */
    recentWindow: 5,
  },
  limits: {
    /** One activity tick counts for at most this long, so a sleeping tab does not eat the daily minutes. */
    maxTickMs: 60_000,
  },
  frustration: {
    /** This many wrong answers ... */
    rapidWrong: 4,
    /** ... inside a window this long means rapid random tapping. */
    rapidWindowMs: 15_000,
    /** This many wrong answers in a row also suggests a break. */
    consecutiveWrong: 6,
    /** A break is suggested when this many attempts in a row ended with the walkthrough. */
    walkthroughRun: 3,
    /** When `now` is passed to `detectFrustration`, older answers than this are ignored. */
    recentWindowMs: 5 * 60_000,
  },
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;
