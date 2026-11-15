import { beforeEach, describe, expect, it } from 'vitest';
import type { AttemptRecord } from '@/core/types';
import { db } from '@/data';
import { formatHour, getTodaySummary } from './today';

function attempt(id: string, childId: string, completedAt: number, starsEarned: number): AttemptRecord {
  return {
    id,
    challengeId: `ch-${id}`,
    childId,
    skillId: 'counting',
    strand: 'math',
    answers: [{ at: completedAt, answer: 3, correct: true, misconception: null }],
    hintsUsed: 0,
    walkthroughUsed: false,
    teachBackCorrect: null,
    outcome: 'independent',
    timeMs: 20_000,
    starsEarned,
    completedAt,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('getTodaySummary', () => {
  it("counts today's solved challenges and stars of one child only", async () => {
    const noon = new Date(2026, 10, 9, 12, 0, 0).getTime();
    const day = 24 * 60 * 60 * 1000;
    await db.attempts.bulkPut([
      attempt('a', 'kid', new Date(2026, 10, 9, 0, 0, 0).getTime(), 3),
      attempt('b', 'kid', noon - 60_000, 2),
      attempt('c', 'kid', noon - day, 3), // yesterday
      attempt('d', 'kid', new Date(2026, 10, 10, 0, 0, 0).getTime(), 3), // tomorrow, midnight
      attempt('e', 'other', noon, 3),
    ]);
    expect(await getTodaySummary('kid', noon)).toEqual({ items: 2, stars: 5 });
    expect(await getTodaySummary('nobody', noon)).toEqual({ items: 0, stars: 0 });
  });
});

describe('formatHour', () => {
  it('writes a whole hour as a clock time', () => {
    expect(formatHour(7, 'en')).toMatch(/^7:00\sAM$/);
    expect(formatHour(15, 'en')).toMatch(/^3:00\sPM$/);
    expect(formatHour(24, 'en')).toMatch(/^12:00\sAM$/);
    expect(formatHour(7, 'es')).toContain('7:00');
    expect(formatHour(Number.NaN, 'en')).toMatch(/^12:00\sAM$/);
  });
});
