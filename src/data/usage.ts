/**
 * AI usage counters, one record per local calendar day for the whole device.
 *
 * The AI client calls `checkBudget()` before every request and
 * `recordUsage()` after it, so a parent's daily budget and monthly cap hold
 * no matter which feature is asking.
 */
import { defaultSettings } from '@/core/defaults';
import { dayKey } from '@/core/grades';
import type { UsageRecord } from '@/core/types';
import { db } from './db';

export type UsageDelta = Partial<Omit<UsageRecord, 'day'>>;

export interface UsageTotals {
  requests: number;
  imageRequests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface BudgetVerdict {
  allowed: boolean;
  reason: 'ok' | 'daily-budget' | 'monthly-cap';
}

const COUNTERS = ['requests', 'imageRequests', 'promptTokens', 'completionTokens', 'failures'] as const;

function emptyUsage(day: string): UsageRecord {
  return { day, requests: 0, imageRequests: 0, promptTokens: 0, completionTokens: 0, failures: 0 };
}

/** Counters only ever go up: anything that is not a positive finite number adds nothing. */
function increment(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Adds the given amounts to today's counters. The read and the write share
 * one transaction, so concurrent calls never lose an increment.
 */
export async function recordUsage(delta: UsageDelta, now: number = Date.now()): Promise<void> {
  const day = dayKey(now);
  await db.transaction('rw', db.usage, async () => {
    const next = { ...emptyUsage(day), ...(await db.usage.get(day)) };
    for (const counter of COUNTERS) {
      next[counter] += increment(delta[counter]);
    }
    await db.usage.put(next);
  });
}

/** Today's counters. Returns zeros (without writing anything) when nothing was recorded yet. */
export async function getUsageToday(now: number = Date.now()): Promise<UsageRecord> {
  const day = dayKey(now);
  return { ...emptyUsage(day), ...(await db.usage.get(day)) };
}

/** Totals over every day of the current local calendar month. */
export async function getUsageThisMonth(now: number = Date.now()): Promise<UsageTotals> {
  const monthPrefix = dayKey(now).slice(0, 7); // YYYY-MM
  const totals: UsageTotals = { requests: 0, imageRequests: 0, promptTokens: 0, completionTokens: 0 };
  await db.usage
    .where('day')
    .startsWith(`${monthPrefix}-`)
    .each((record) => {
      totals.requests += record.requests;
      totals.imageRequests += record.imageRequests;
      totals.promptTokens += record.promptTokens;
      totals.completionTokens += record.completionTokens;
    });
  return totals;
}

/**
 * Whether one more AI request fits the parent's limits.
 *
 * Text requests and image requests both count against the limits (image calls
 * are the costly ones, so they must not escape the budget). A limit of 0, or
 * anything that is not a positive number, means "unlimited". The daily budget
 * is checked first.
 */
export async function checkBudget(now: number = Date.now()): Promise<BudgetVerdict> {
  // Read-only: `getSettings()` would create the record, which this check has no business doing.
  const ai = ((await db.settings.get('app')) ?? defaultSettings(now)).ai;

  if (isLimit(ai.dailyRequestBudget)) {
    const today = await getUsageToday(now);
    if (today.requests + today.imageRequests >= ai.dailyRequestBudget) {
      return { allowed: false, reason: 'daily-budget' };
    }
  }
  if (isLimit(ai.monthlyRequestCap)) {
    const month = await getUsageThisMonth(now);
    if (month.requests + month.imageRequests >= ai.monthlyRequestCap) {
      return { allowed: false, reason: 'monthly-cap' };
    }
  }
  return { allowed: true, reason: 'ok' };
}

function isLimit(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
