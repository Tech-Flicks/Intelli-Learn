import { beforeEach, describe, expect, it } from 'vitest';
import { dayKey } from '@/core/grades';
import { STRANDS } from '@/core/types';
import type { AttemptOutcome, AttemptRecord, StageChange } from '@/core/types';
import { db } from '@/data';
import { getStrandStages, weekStartOf, weekStats } from './stats';
import { DAY, MONDAY, resetDb, right, stateFor } from './testing';

const WEEK = dayKey(MONDAY); // 2026-11-09
const WEEK_START = new Date(2026, 10, 9).getTime();

function attempt(id: string, childId: string, completedAt: number, outcome: AttemptOutcome): AttemptRecord {
  return {
    id,
    challengeId: `ch-${id}`,
    childId,
    skillId: 'math-place-value',
    strand: 'math',
    answers: [right(completedAt)],
    hintsUsed: 0,
    walkthroughUsed: outcome === 'walkthrough',
    teachBackCorrect: null,
    outcome,
    timeMs: 20_000,
    starsEarned: 1,
    completedAt,
  };
}

function change(id: string, childId: string, at: number, patch: Partial<StageChange> = {}): StageChange {
  return { id, childId, skillId: null, strand: 'math', from: 12, to: 13, reason: 'mastery', at, ...patch };
}

describe('weekStartOf', () => {
  it('is the Monday of the local week', () => {
    expect(weekStartOf(MONDAY)).toBe('2026-11-09');
    expect(weekStartOf(new Date(2026, 10, 9, 0, 0, 0).getTime())).toBe('2026-11-09');
    expect(weekStartOf(new Date(2026, 10, 14, 16, 0, 0).getTime())).toBe('2026-11-09'); // Saturday
    expect(weekStartOf(new Date(2026, 10, 15, 23, 59, 0).getTime())).toBe('2026-11-09'); // Sunday
    expect(weekStartOf(new Date(2026, 10, 16, 0, 0, 0).getTime())).toBe('2026-11-16');
  });

  it('works across a month and a year boundary', () => {
    expect(weekStartOf(new Date(2026, 10, 1, 12).getTime())).toBe('2026-10-26'); // Sunday 1 November
    expect(weekStartOf(new Date(2027, 0, 1, 12).getTime())).toBe('2026-12-28'); // Friday 1 January
  });
});

describe('weekStats', () => {
  beforeEach(resetDb);

  it('is all zeros for a week without play', async () => {
    expect(await weekStats('c1', WEEK)).toEqual({ minutes: 0, completed: 0, independentShare: 0, stageUps: 0 });
  });

  it('adds up the minutes of the sessions that started in the week', async () => {
    const session = (id: string, childId: string, day: string, activeMs: number) =>
      db.sessions.put({ id, childId, day, startedAt: MONDAY, endedAt: MONDAY, activeMs, itemsCompleted: 0 });
    await session('a', 'c1', '2026-11-09', 10 * 60_000);
    await session('b', 'c1', '2026-11-15', 5 * 60_000 + 40_000);
    await session('before', 'c1', '2026-11-08', 30 * 60_000);
    await session('after', 'c1', '2026-11-16', 30 * 60_000);
    await session('other', 'c2', '2026-11-10', 30 * 60_000);
    expect((await weekStats('c1', WEEK)).minutes).toBe(16);
  });

  it('counts attempts completed in the week and the share solved without help', async () => {
    await db.attempts.bulkPut([
      attempt('1', 'c1', WEEK_START, 'independent'),
      attempt('2', 'c1', MONDAY, 'second-try'),
      attempt('3', 'c1', MONDAY + DAY, 'nudge'),
      attempt('4', 'c1', MONDAY + 2 * DAY, 'hint'),
      attempt('5', 'c1', WEEK_START + 7 * DAY - 1, 'walkthrough'),
      attempt('before', 'c1', WEEK_START - 1, 'independent'),
      attempt('after', 'c1', WEEK_START + 7 * DAY, 'independent'),
      attempt('other', 'c2', MONDAY, 'independent'),
    ]);
    const stats = await weekStats('c1', WEEK);
    expect(stats.completed).toBe(5);
    expect(stats.independentShare).toBeCloseTo(2 / 5);
  });

  it('counts strand-level moves upward through learning as stage-ups', async () => {
    await db.stageChanges.bulkPut([
      change('up-1', 'c1', MONDAY),
      change('up-2', 'c1', MONDAY + DAY, { strand: 'logic', from: 7, to: 8 }),
      change('skill-level', 'c1', MONDAY, { skillId: 'math-place-value' }),
      change('down', 'c1', MONDAY, { from: 13, to: 12, reason: 'support' }),
      change('placement', 'c1', MONDAY, { reason: 'placement' }),
      change('parent', 'c1', MONDAY, { reason: 'parent' }),
      change('before', 'c1', WEEK_START - 1),
      change('after', 'c1', WEEK_START + 7 * DAY),
      change('other', 'c2', MONDAY),
    ]);
    expect((await weekStats('c1', WEEK)).stageUps).toBe(2);
  });

  it('rejects a week start that is not a date', async () => {
    await expect(weekStats('c1', 'last week')).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('getStrandStages', () => {
  beforeEach(resetDb);

  it('lists every strand, with null for strands that were not practised', async () => {
    await db.skillStates.bulkPut([
      stateFor('c1', 'math-place-value', 12, { attempts: 3 }),
      stateFor('c1', 'math-geometry-shapes', 16, { attempts: 1 }),
      stateFor('c1', 'logic-patterns', 9, { attempts: 2 }),
      stateFor('c1', 'science-matter', 20, { attempts: 0 }),
      stateFor('c2', 'science-matter', 30, { attempts: 5 }),
    ]);
    const stages = await getStrandStages('c1');
    expect(stages.map((s) => s.strand)).toEqual([...STRANDS]);
    expect(stages).toEqual([
      { strand: 'math', stage: 13, practisedSkills: 2 },
      { strand: 'science', stage: null, practisedSkills: 0 },
      { strand: 'technology', stage: null, practisedSkills: 0 },
      { strand: 'engineering', stage: null, practisedSkills: 0 },
      { strand: 'logic', stage: 9, practisedSkills: 1 },
    ]);
  });
});
