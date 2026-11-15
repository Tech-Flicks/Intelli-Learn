import { describe, expect, it } from 'vitest';
import { TUNING } from './tuning';

/** Pins the agreed numbers, so that changing one is always a deliberate edit in two places. */
describe('TUNING', () => {
  it('has the agreed mastery numbers', () => {
    expect(TUNING.mastery.gain).toEqual({ independent: 25, 'second-try': 15, nudge: 10, hint: 5, walkthrough: 0 });
    expect(TUNING.mastery.reviewGain.independent).toBe(10);
    expect(TUNING.mastery.teachBackBonus).toBe(5);
    expect(TUNING.mastery.stepUpAt).toBe(80);
    expect(TUNING.mastery.afterStepUp).toBe(20);
    expect(TUNING.mastery.fastTrackStreak).toBe(3);
    expect(TUNING.mastery.fastTrackAt).toBe(60);
    expect(TUNING.mastery.max).toBe(100);
    expect(TUNING.mastery.stepDownAfterWalkthroughs).toBe(3);
    expect(TUNING.mastery.afterStepDown).toBe(50);
    expect(TUNING.mastery.afterCheckWithHelp).toBe(60);
    expect(TUNING.mastery.afterCheckWithWalkthrough).toBe(40);
    expect(TUNING.mastery.strandWeightCap).toBe(10);
  });

  it('never lets a review item move mastery more than a regular item', () => {
    for (const outcome of Object.keys(TUNING.mastery.gain) as (keyof typeof TUNING.mastery.gain)[]) {
      expect(TUNING.mastery.reviewGain[outcome]).toBeLessThanOrEqual(TUNING.mastery.gain[outcome]);
    }
  });

  it('has the agreed review, star, companion and streak numbers', () => {
    expect(TUNING.review.intervalsDays).toEqual([2, 7, 21]);
    expect(TUNING.review.atMostOneIn).toBe(5);
    expect(TUNING.stars.perOutcome).toEqual({ independent: 3, 'second-try': 2, nudge: 2, hint: 1, walkthrough: 1 });
    expect(TUNING.stars.teachBackBonus).toBe(1);
    expect(TUNING.companion.growthXp).toEqual([0, 15, 60, 150, 300]);
    expect(TUNING.streak.forgivenGapDays).toBe(2);
    expect(TUNING.streak.milestones).toEqual([3, 7, 14, 30]);
  });

  it('gives at least one star for every outcome, so help never costs the last star', () => {
    for (const stars of Object.values(TUNING.stars.perOutcome)) expect(stars).toBeGreaterThanOrEqual(1);
  });

  it('has the agreed placement, planning, limit and frustration numbers', () => {
    expect(TUNING.placement.totalItems).toBe(8);
    expect(TUNING.placement.startGradeOffset).toBe(-1);
    expect(TUNING.placement.startStep).toBe('growing');
    expect(TUNING.placement.steps).toEqual({ independent: 3, 'second-try': 1, nudge: 0, hint: -1, walkthrough: -3 });
    expect(TUNING.plan.coreShare + TUNING.plan.reviewShare + TUNING.plan.stretchShare).toBeCloseTo(1);
    expect(TUNING.plan.coreShare).toBe(0.7);
    expect(TUNING.plan.reviewShare).toBe(0.2);
    expect(TUNING.plan.stretchShare).toBe(0.1);
    expect(TUNING.plan.questShare).toBe(0.6);
    expect(TUNING.plan.newSkillChance).toBe(0.3);
    expect(TUNING.plan.settledAfterAttempts).toBe(3);
    expect(TUNING.plan.maxSettlingSkills).toBe(2);
    expect(TUNING.plan.focusChance).toBe(0.5);
    expect(TUNING.plan.stretchMinMastery).toBe(40);
    expect(TUNING.placement.seedMastery).toBe(30);
    expect(TUNING.limits.maxTickMs).toBe(60_000);
    expect(TUNING.frustration.rapidWrong).toBe(4);
    expect(TUNING.frustration.rapidWindowMs).toBe(15_000);
    expect(TUNING.frustration.consecutiveWrong).toBe(6);
    expect(TUNING.frustration.walkthroughRun).toBe(3);
  });

  it('has the agreed badge thresholds', () => {
    expect(TUNING.badges.solveMilestones).toEqual([10, 50, 100, 250]);
    expect(TUNING.badges.independentRun).toBe(5);
    expect(TUNING.badges.wrongTries).toBe(3);
    expect(TUNING.badges.strandExplorer).toBe(5);
    expect(TUNING.badges.teachBacks).toBe(5);
    expect(TUNING.badges.modes).toBe(5);
    expect(TUNING.badges.robotSolves).toBe(5);
    expect(TUNING.badges.buildSolves).toBe(5);
  });
});
