import { describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { STRANDS } from '@/core/types';
import {
  applyPlacementAttempt,
  clampToStrand,
  estimateFor,
  freshPlacement,
  initialEstimate,
  isPlacementComplete,
  parsePlacement,
  placementStrand,
  runningPlacement,
  seedPlacementStates,
  strandStageRange,
  type PlacementNote,
} from './placement';
import { MONDAY, stateFor } from './testing';
import { TUNING } from './tuning';

const note = (skillId: string, strand: PlacementNote['strand'] = 'math'): PlacementNote => ({
  skillId,
  strand,
  interaction: 'choice',
});

describe('placement estimates', () => {
  it('start one grade below the enrolled grade, at growing', () => {
    expect(initialEstimate('3', 'math')).toBe(makeStage('2', 'growing'));
    expect(initialEstimate('8', 'science')).toBe(makeStage('7', 'growing'));
    expect(initialEstimate('K', 'logic')).toBe(makeStage('PK', 'growing'));
  });

  it('never start below Pre-K', () => {
    expect(initialEstimate('PK', 'math')).toBe(makeStage('PK', 'growing'));
  });

  it('stay inside the grades where the strand has skills', () => {
    for (const strand of STRANDS) {
      const { min, max } = strandStageRange(strand);
      expect(min).toBe(0);
      expect(max).toBe(39);
      expect(clampToStrand(strand, -5)).toBe(min);
      expect(clampToStrand(strand, 99)).toBe(max);
    }
  });

  it.each([
    ['independent', 4],
    ['second-try', 1],
    ['nudge', 0],
    ['hint', -1],
    ['walkthrough', -3],
  ] as const)('a %s solve moves the estimate by %i steps', (outcome, steps) => {
    const after = applyPlacementAttempt(freshPlacement(), '3', note('math-place-value'), outcome);
    expect(after.estimates.math).toBe(13 + steps);
    expect(after.start.math).toBe(13);
    expect(after.answered).toBe(1);
    expect(after.attempted).toEqual([note('math-place-value')]);
  });

  it('keeps moving from the updated estimate and remembers where the strand started', () => {
    let state = freshPlacement();
    state = applyPlacementAttempt(state, '3', note('math-place-value'), 'independent');
    state = applyPlacementAttempt(state, '3', note('math-geometry-shapes'), 'independent');
    state = applyPlacementAttempt(state, '3', note('science-matter', 'science'), 'walkthrough');
    expect(state.estimates).toEqual({ math: 21, science: 10 });
    expect(state.start).toEqual({ math: 13, science: 13 });
    expect(estimateFor(state, '3', 'logic')).toBe(13);
  });

  it('clamps at the bottom and the top', () => {
    const low = applyPlacementAttempt(freshPlacement(), 'PK', note('math-counting-cardinality'), 'walkthrough');
    expect(low.estimates.math).toBe(0);
    let high = freshPlacement();
    for (let i = 0; i < 4; i += 1) high = applyPlacementAttempt(high, '8', note('math-algebra-ratios'), 'independent');
    expect(high.estimates.math).toBe(39);
  });

  it('can place a child who solves alone above the enrolled grade', () => {
    let state = freshPlacement();
    state = applyPlacementAttempt(state, '3', note('math-place-value'), 'independent');
    state = applyPlacementAttempt(state, '3', note('math-geometry-shapes'), 'independent');
    expect(state.estimates.math).toBeGreaterThan(makeStage('3', 'ready'));
  });

  it('moves an estimate at most two grades from where it started, however many items a strand gets', () => {
    let up = freshPlacement();
    let down = freshPlacement();
    for (let i = 0; i < 8; i += 1) {
      up = applyPlacementAttempt(up, '3', note('math-geometry-shapes'), 'independent');
      down = applyPlacementAttempt(down, '5', note('math-geometry-shapes'), 'walkthrough');
    }
    expect(up.estimates.math).toBe(13 + TUNING.placement.maxMove);
    expect(down.estimates.math).toBe(21 - TUNING.placement.maxMove);
  });

  it('learns nothing about a higher level from an item that had to be pitched far below the estimate', () => {
    let state = freshPlacement();
    state = applyPlacementAttempt(state, '5', note('math-geometry-shapes'), 'independent');
    expect(state.estimates.math).toBe(25);
    // Counting ends at grade 2: the item was a grade 2 item, and solving it says nothing about grade 5.
    const counting = { ...note('math-counting-cardinality'), stage: makeStage('2', 'ready') };
    expect(applyPlacementAttempt(state, '5', counting, 'independent').estimates.math).toBe(25);
    // Needing help on it does say something.
    expect(applyPlacementAttempt(state, '5', counting, 'walkthrough').estimates.math).toBe(22);
  });

  it('learns nothing about a lower level from an item that had to be pitched far above the estimate', () => {
    const state = applyPlacementAttempt(freshPlacement(), '1', note('math-geometry-shapes'), 'walkthrough');
    expect(state.estimates.math).toBe(2);
    // Multiplication starts at grade 2.
    const multiplication = { ...note('math-multiplication-division'), stage: makeStage('2', 'starting') };
    expect(applyPlacementAttempt(state, '1', multiplication, 'walkthrough').estimates.math).toBe(2);
    expect(applyPlacementAttempt(state, '1', multiplication, 'independent').estimates.math).toBe(6);
  });

  it('counts an item that was planned one answer earlier, a step away from the estimate', () => {
    const state = applyPlacementAttempt(freshPlacement(), '3', note('math-geometry-shapes'), 'independent');
    const planned = { ...note('math-place-value'), stage: 13 };
    expect(applyPlacementAttempt(state, '3', planned, 'independent').estimates.math).toBe(21);
  });

  it('does not mutate the state it is given', () => {
    const state = freshPlacement();
    applyPlacementAttempt(state, '3', note('math-place-value'), 'independent');
    expect(state).toEqual(freshPlacement());
  });

  it('is complete after eight items', () => {
    let state = freshPlacement();
    for (let i = 0; i < TUNING.placement.totalItems - 1; i += 1) {
      state = applyPlacementAttempt(state, '3', note('math-place-value'), 'nudge');
    }
    expect(isPlacementComplete(state)).toBe(false);
    state = applyPlacementAttempt(state, '3', note('math-place-value'), 'nudge');
    expect(isPlacementComplete(state)).toBe(true);
  });
});

describe('placement rotation', () => {
  it('goes round the enabled strands twice within eight items', () => {
    const strands = Array.from({ length: 8 }, (_, slot) => placementStrand(slot, STRANDS));
    expect(strands).toEqual(['math', 'science', 'technology', 'engineering', 'logic', 'math', 'science', 'technology']);
  });

  it('still fills eight items with fewer strands', () => {
    const strands = Array.from({ length: 8 }, (_, slot) => placementStrand(slot, ['science', 'logic']));
    expect(strands.filter((s) => s === 'science')).toHaveLength(4);
    expect(strands.filter((s) => s === 'logic')).toHaveLength(4);
  });

  it('uses every strand when none is enabled', () => {
    expect(placementStrand(1, [])).toBe('science');
  });
});

describe('seeding skill states', () => {
  it('seeds each attempted skill at its strand estimate, clamped to the skill', () => {
    let state = freshPlacement();
    state = applyPlacementAttempt(state, '3', note('math-place-value'), 'independent');
    state = applyPlacementAttempt(state, '3', note('math-counting-cardinality'), 'independent');
    const seeded = seedPlacementStates(state, { id: 'c1', grade: '3' }, [], MONDAY);
    expect(seeded).toHaveLength(2);
    const placeValue = seeded.find((s) => s.skillId === 'math-place-value');
    expect(placeValue).toMatchObject({
      id: 'c1:math-place-value',
      childId: 'c1',
      strand: 'math',
      stage: 21,
      mastery: TUNING.placement.seedMastery,
      attempts: 1,
      checkPending: false,
      recentInteractions: ['choice'],
      lastPracticedAt: MONDAY,
      reviewDueAt: null,
    });
    // Counting only exists up to grade 2: the estimate (grade 3) is clamped to the top of the skill.
    expect(seeded.find((s) => s.skillId === 'math-counting-cardinality')?.stage).toBe(makeStage('2', 'ready'));
  });

  it('counts two placement items on the same skill as two attempts', () => {
    let state = freshPlacement();
    state = applyPlacementAttempt(state, '3', note('math-place-value'), 'nudge');
    state = applyPlacementAttempt(state, '3', { ...note('math-place-value'), interaction: 'number' }, 'nudge');
    const seeded = seedPlacementStates(state, { id: 'c1', grade: '3' }, [], MONDAY);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.attempts).toBe(2);
    expect(seeded[0]?.recentInteractions).toEqual(['number', 'choice']);
  });

  it('moves an existing state to the estimate and keeps its history', () => {
    const existing = stateFor('c1', 'math-place-value', 30, { attempts: 5, mastery: 70, checksPassed: 2 });
    const state = applyPlacementAttempt(freshPlacement(), '3', note('math-place-value'), 'walkthrough');
    const seeded = seedPlacementStates(state, { id: 'c1', grade: '3' }, [existing], MONDAY);
    expect(seeded[0]).toMatchObject({ stage: 10, attempts: 6, mastery: 70, checksPassed: 2 });
  });
});

describe('stored placement state', () => {
  it('round-trips a valid record and rejects a malformed one', () => {
    const state = applyPlacementAttempt(freshPlacement(), '3', note('math-place-value'), 'independent');
    expect(parsePlacement(structuredClone(state))).toEqual(state);
    expect(parsePlacement(undefined)).toBeNull();
    expect(parsePlacement({ ...state, v: 3 })).toBeNull();
    expect(parsePlacement({ ...state, estimates: { math: 99 } })).toBeNull();
    expect(parsePlacement({ ...state, estimates: { cooking: 3 } })).toBeNull();
    expect(parsePlacement({ ...state, answered: -1 })).toBeNull();
    expect(parsePlacement({ ...state, attempted: [{ skillId: 1 }] })).toBeNull();
    // The stage an item was asked at is kept with it; a record from before that was stored is still read.
    const staged = applyPlacementAttempt(freshPlacement(), '3', { ...note('math-place-value'), stage: 13 }, 'independent');
    expect(parsePlacement(structuredClone(staged))).toEqual(staged);
    expect(parsePlacement({ ...staged, attempted: [{ ...note('math-place-value'), stage: 99 }] })).toBeNull();
  });

  it('starts over when nothing is stored or a finished placement is run again', () => {
    expect(runningPlacement(null)).toEqual(freshPlacement());
    const finished = { ...freshPlacement(), answered: TUNING.placement.totalItems };
    expect(runningPlacement(finished)).toEqual(freshPlacement());
    const running = { ...freshPlacement(), answered: 3 };
    expect(runningPlacement(running)).toBe(running);
  });
});
