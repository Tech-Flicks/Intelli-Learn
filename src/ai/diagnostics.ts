/**
 * What happened to the latest AI requests, for the parent.
 *
 * Every AI feature falls back silently when the model fails, so that a child
 * never waits on a broken model. Without a record of those fall-backs a parent
 * would see "AI challenges are on" while every challenge comes from the
 * built-in bank. This module keeps a short rolling log on the device (`kv` key
 * `ai:recent`; never in a backup) and derives two things from it:
 *
 * - what the parent area shows ("Today 3 of 20 challenges came from the AI;
 *   most common problem: ..."), and
 * - a pause for challenge generation after repeated failures, so that a model
 *   that cannot do the job does not use up the day's request budget.
 *
 * Privacy: an entry holds the task, the interaction kind, the model name, an
 * outcome and a message written by this app (an error text, or what the
 * validators found). Nothing a child typed or said is ever stored here.
 */
import type { InteractionKind } from '@/core/types';
import { db } from '@/data';
import { OFFLINE_CODE, TRUNCATED_CODE } from './client';
import { AiError } from './errors';

export type AiTask = 'challenge' | 'remix' | 'tutor' | 'story' | 'notes' | 'report';

export type AiOutcome =
  | 'ok'
  | 'offline' // the device had no connection; nothing was sent
  | 'timeout'
  | 'network'
  | 'auth'
  | 'rate-limit'
  | 'truncated' // the reply was cut off at the token limit
  | 'format' // not JSON, or not the expected shape
  | 'validation' // the challenge was wrong or unsolvable
  | 'safety' // the content was not suitable for the child
  | 'refused'
  | 'other';

export interface AiLogEntry {
  at: number;
  task: AiTask;
  /** The interaction kind of a challenge or remix. */
  kind?: InteractionKind;
  model: string;
  outcome: AiOutcome;
  /** Parent-readable; '' for 'ok'. At most 200 characters. */
  message: string;
  /** How long it took. */
  ms: number;
}

export const AI_LOG_KEY = 'ai:recent';
/** Challenge and remix results that are kept. */
export const AI_LOG_BUILDS = 30;
/** Failures of the other tasks that are kept (their successes are not logged). */
export const AI_LOG_OTHER = 15;
const MESSAGE_MAX = 200;

const isBuild = (entry: Pick<AiLogEntry, 'task'>): boolean => entry.task === 'challenge' || entry.task === 'remix';

function isEntry(value: unknown): value is AiLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<AiLogEntry>;
  return typeof entry.at === 'number' && typeof entry.task === 'string' && typeof entry.outcome === 'string' && typeof entry.message === 'string';
}

/** The log, oldest first. Read-only (safe inside a live query); never throws. */
export async function recentAiResults(): Promise<AiLogEntry[]> {
  try {
    const stored = (await db.kv.get(AI_LOG_KEY))?.value;
    return Array.isArray(stored) ? stored.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function trim(entries: AiLogEntry[]): AiLogEntry[] {
  const builds = entries.filter(isBuild).slice(-AI_LOG_BUILDS);
  const other = entries.filter((entry) => !isBuild(entry)).slice(-AI_LOG_OTHER);
  return [...builds, ...other].sort((a, b) => a.at - b.at);
}

/** Adds one result to the log. Never throws: a log that cannot be written must not break play. */
export async function noteAiResult(entry: AiLogEntry): Promise<void> {
  try {
    const clean: AiLogEntry = { ...entry, message: entry.message.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX) };
    await db.transaction('rw', db.kv, async () => {
      const stored = (await db.kv.get(AI_LOG_KEY))?.value;
      const entries = Array.isArray(stored) ? stored.filter(isEntry) : [];
      await db.kv.put({ key: AI_LOG_KEY, value: trim([...entries, clean]) });
    });
  } catch {
    // no log is better than no challenge
  }
}

/** Empties the log (after the parent changed the AI settings: the old results say nothing about the new ones). Never throws. */
export async function clearAiResults(): Promise<void> {
  try {
    await db.kv.delete(AI_LOG_KEY);
  } catch {
    // nothing to forget
  }
}

/** The outcome and the parent-readable message for a thrown error. Null for what is not a result (the caller gave up, no AI is set up, the budget is spent). */
export function outcomeOfError(error: unknown): { outcome: AiOutcome; message: string } | null {
  if (!(error instanceof AiError)) return { outcome: 'other', message: 'Something unexpected went wrong while the answer was read.' };
  const detail = error.detail !== '' ? ` (${error.detail})` : '';
  switch (error.kind) {
    case 'aborted':
    case 'no-config':
    case 'budget':
      return null;
    case 'network':
      if (error.code === OFFLINE_CODE) return { outcome: 'offline', message: error.message };
      return { outcome: error.timedOut ? 'timeout' : 'network', message: error.message };
    case 'auth':
      return { outcome: 'auth', message: error.message };
    case 'rate-limit':
      return { outcome: 'rate-limit', message: error.message };
    case 'refused':
      return { outcome: 'refused', message: error.message };
    case 'bad-response':
      if (error.code === TRUNCATED_CODE) {
        return { outcome: 'truncated', message: 'The answer of the AI model was cut off before it was complete, also with a higher limit.' };
      }
      return { outcome: error.status === null ? 'format' : 'other', message: `${error.message}${detail}` };
  }
}

/** Logs a thrown error of one of the smaller tasks (their successes are not logged). Never throws. */
export async function noteAiFailure(task: AiTask, model: string, error: unknown, startedAt: number): Promise<void> {
  const failed = outcomeOfError(error);
  if (failed) await noteAiResult({ at: Date.now(), task, model, outcome: failed.outcome, message: failed.message, ms: Date.now() - startedAt });
}

// ---------------------------------------------------------------------------
// The pause after repeated failures
// ---------------------------------------------------------------------------

/** Failed builds in a row before generation pauses. */
export const PAUSE_AFTER_FAILURES = 3;
const PAUSE_BASE_MS = 10 * 60_000;
const PAUSE_MAX_MS = 60 * 60_000;

export interface GenerationPause {
  /** Failed challenge builds in a row, up to now. */
  failures: number;
  /** Generation is paused until this time. */
  until: number;
  /** The message of the latest failure. */
  message: string;
}

/**
 * After three failed challenge builds in a row, generation pauses for 10 minutes; every further
 * failure (one build is tried when a pause ends) doubles the pause, up to an hour. Any success
 * ends it. Being offline is not a failure of the model and never counts. Returns null when no
 * pause is running at `now`.
 */
export function generationPause(entries: readonly AiLogEntry[], now: number): GenerationPause | null {
  const builds = entries.filter((entry) => isBuild(entry) && entry.outcome !== 'offline');
  let failures = 0;
  for (let i = builds.length - 1; i >= 0 && builds[i]?.outcome !== 'ok'; i -= 1) failures += 1;
  const last = builds[builds.length - 1];
  if (!last || failures < PAUSE_AFTER_FAILURES) return null;
  const length = Math.min(PAUSE_MAX_MS, PAUSE_BASE_MS * 2 ** (failures - PAUSE_AFTER_FAILURES));
  const until = last.at + length;
  // A clock that was set back must not pause generation for longer than one pause.
  if (now >= until || now < last.at - length) return null;
  return { failures, until, message: last.message };
}

// ---------------------------------------------------------------------------
// The summary for the parent
// ---------------------------------------------------------------------------

export interface AiResultsSummary {
  /** Challenge builds (fresh and remix) that were tried since local midnight, and how many of them the AI delivered. */
  buildsToday: number;
  builtToday: number;
  /** The message that failed builds had most often today, and how often. '' and 0 when none failed. */
  commonProblem: string;
  commonProblemCount: number;
  /** Failed challenge builds in a row up to now (0 after a success). */
  failuresInARow: number;
  pause: GenerationPause | null;
}

function startOfDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function summarizeAiResults(entries: readonly AiLogEntry[], now: number): AiResultsSummary {
  const today = entries.filter((entry) => isBuild(entry) && entry.at >= startOfDay(now));
  const failed = today.filter((entry) => entry.outcome !== 'ok');
  const counts = new Map<string, number>();
  for (const entry of failed) counts.set(entry.message, (counts.get(entry.message) ?? 0) + 1);
  let commonProblem = '';
  let commonProblemCount = 0;
  for (const [message, count] of counts) {
    if (count > commonProblemCount) {
      commonProblem = message;
      commonProblemCount = count;
    }
  }
  const builds = entries.filter(isBuild);
  let failuresInARow = 0;
  for (let i = builds.length - 1; i >= 0 && builds[i]?.outcome !== 'ok'; i -= 1) failuresInARow += 1;
  return {
    buildsToday: today.length,
    builtToday: today.length - failed.length,
    commonProblem,
    commonProblemCount,
    failuresInARow,
    pause: generationPause(entries, now),
  };
}
