import { beforeEach, describe, expect, it } from 'vitest';
import { dayKey } from '@/core/grades';
import { db, getSettings, updateSettings } from './db';
import { resetDb } from './testSupport';
import { checkBudget, getUsageThisMonth, getUsageToday, recordUsage } from './usage';

// Local-time dates, so the tests pass in any time zone.
const NOV_14 = new Date(2026, 10, 14, 12, 0, 0).getTime();
const NOV_15 = new Date(2026, 10, 15, 9, 0, 0).getTime();
const NOV_30_LATE = new Date(2026, 10, 30, 23, 59, 0).getTime();
const DEC_1 = new Date(2026, 11, 1, 0, 1, 0).getTime();
const OCT_31 = new Date(2026, 9, 31, 12, 0, 0).getTime();

async function setLimits(dailyRequestBudget: number, monthlyRequestCap: number): Promise<void> {
  await updateSettings((s) => ({ ...s, ai: { ...s.ai, dailyRequestBudget, monthlyRequestCap } }));
}

beforeEach(resetDb);

describe('recordUsage', () => {
  it('creates the record for the day and adds to it', async () => {
    await recordUsage({ requests: 1, promptTokens: 100, completionTokens: 40 }, NOV_14);
    await recordUsage({ requests: 1, imageRequests: 1, failures: 1 }, NOV_14);

    expect(await getUsageToday(NOV_14)).toEqual({
      day: '2026-11-14',
      requests: 2,
      imageRequests: 1,
      promptTokens: 100,
      completionTokens: 40,
      failures: 1,
    });
    expect(await db.usage.count()).toBe(1);
  });

  it('keeps separate records per local day', async () => {
    await recordUsage({ requests: 2 }, NOV_14);
    await recordUsage({ requests: 5 }, NOV_15);

    expect((await getUsageToday(NOV_14)).requests).toBe(2);
    expect((await getUsageToday(NOV_15)).requests).toBe(5);
    expect(await db.usage.count()).toBe(2);
  });

  it('does not lose increments when calls overlap', async () => {
    await Promise.all(Array.from({ length: 25 }, () => recordUsage({ requests: 1, promptTokens: 10 }, NOV_14)));

    const today = await getUsageToday(NOV_14);
    expect(today.requests).toBe(25);
    expect(today.promptTokens).toBe(250);
  });

  it('ignores negative and non-numeric amounts', async () => {
    await recordUsage({ requests: 3 }, NOV_14);
    await recordUsage({ requests: -2, promptTokens: Number.NaN, completionTokens: Number.POSITIVE_INFINITY }, NOV_14);

    expect(await getUsageToday(NOV_14)).toMatchObject({ requests: 3, promptTokens: 0, completionTokens: 0 });
  });

  it('uses the current day by default', async () => {
    await recordUsage({ requests: 1 });
    expect(await db.usage.get(dayKey())).toMatchObject({ requests: 1 });
  });
});

describe('getUsageToday', () => {
  it('returns zeros without writing anything', async () => {
    expect(await getUsageToday(NOV_14)).toEqual({
      day: '2026-11-14',
      requests: 0,
      imageRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      failures: 0,
    });
    expect(await db.usage.count()).toBe(0);
  });
});

describe('getUsageThisMonth', () => {
  it('sums the days of the current month only', async () => {
    await recordUsage({ requests: 9, promptTokens: 900 }, OCT_31);
    await recordUsage({ requests: 1, imageRequests: 2, promptTokens: 10, completionTokens: 5 }, NOV_14);
    await recordUsage({ requests: 3, promptTokens: 30, completionTokens: 6 }, NOV_30_LATE);
    await recordUsage({ requests: 7 }, DEC_1);

    expect(await getUsageThisMonth(NOV_15)).toEqual({
      requests: 4,
      imageRequests: 2,
      promptTokens: 40,
      completionTokens: 11,
    });
    expect((await getUsageThisMonth(DEC_1)).requests).toBe(7);
  });

  it('returns zeros for an empty month', async () => {
    expect(await getUsageThisMonth(NOV_14)).toEqual({
      requests: 0,
      imageRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
    });
  });
});

describe('checkBudget', () => {
  it('allows requests under both limits', async () => {
    await setLimits(3, 10);
    await recordUsage({ requests: 2 }, NOV_14);
    expect(await checkBudget(NOV_14)).toEqual({ allowed: true, reason: 'ok' });
  });

  it('refuses when the daily budget is used up, and allows again the next day', async () => {
    await setLimits(3, 100);
    await recordUsage({ requests: 3 }, NOV_14);

    expect(await checkBudget(NOV_14)).toEqual({ allowed: false, reason: 'daily-budget' });
    expect(await checkBudget(NOV_15)).toEqual({ allowed: true, reason: 'ok' });
  });

  it('refuses when the monthly cap is used up, and allows again the next month', async () => {
    await setLimits(5, 6);
    await recordUsage({ requests: 4 }, NOV_14);
    await recordUsage({ requests: 2 }, NOV_15);

    expect(await checkBudget(NOV_30_LATE)).toEqual({ allowed: false, reason: 'monthly-cap' });
    expect(await checkBudget(DEC_1)).toEqual({ allowed: true, reason: 'ok' });
  });

  it('reports the daily budget first when both limits are reached', async () => {
    await setLimits(2, 2);
    await recordUsage({ requests: 2 }, NOV_14);
    expect((await checkBudget(NOV_14)).reason).toBe('daily-budget');
  });

  it('counts image requests against the limits', async () => {
    await setLimits(3, 100);
    await recordUsage({ requests: 1 }, NOV_14);
    await recordUsage({ imageRequests: 2 }, NOV_14);
    expect(await checkBudget(NOV_14)).toEqual({ allowed: false, reason: 'daily-budget' });
  });

  it('treats 0 as unlimited', async () => {
    await setLimits(0, 0);
    await recordUsage({ requests: 100_000 }, NOV_14);
    expect(await checkBudget(NOV_14)).toEqual({ allowed: true, reason: 'ok' });

    await setLimits(0, 50);
    expect((await checkBudget(NOV_14)).reason).toBe('monthly-cap');
  });

  it('uses the default limits before settings exist, without creating them', async () => {
    expect(await checkBudget(NOV_14)).toEqual({ allowed: true, reason: 'ok' });
    expect(await db.settings.count()).toBe(0);

    const defaults = (await getSettings()).ai;
    await recordUsage({ requests: defaults.dailyRequestBudget }, NOV_14);
    expect((await checkBudget(NOV_14)).reason).toBe('daily-budget');
  });
});
