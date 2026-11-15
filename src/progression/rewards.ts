/**
 * Stars, the companion, the daily streak and badges.
 *
 * Pure rules first, then the two small database helpers. Rewards are only
 * ever added: nothing here removes a star, a badge or companion growth.
 * (Spending stars on a collectible is the child's own choice.)
 */
import { dayKey, newId, stageGradeIndex } from '@/core/grades';
import { MODES, STRANDS } from '@/core/types';
import type {
  AttemptOutcome,
  ChildProfile,
  Companion,
  InteractionKind,
  ItemPurpose,
  Mode,
  RewardKind,
  RewardRecord,
  Strand,
} from '@/core/types';
import { db } from '@/data';
import { getCollectible, getCompanionDef, growthForXp, solveBadgeKey } from './catalog';
import { DAY_MS, TUNING } from './tuning';

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

/** Stars for one solved item. Always at least one: getting help never costs the last star. */
export function starsFor(outcome: AttemptOutcome, teachBackCorrect: boolean | null): number {
  const base = TUNING.stars.perOutcome[outcome];
  return base + (teachBackCorrect === true ? TUNING.stars.teachBackBonus : 0);
}

const STAR_REASONS: Record<AttemptOutcome, string> = {
  independent: 'You worked it out all on your own!',
  'second-try': 'You tried again and got it. Trying again is how learning works!',
  nudge: 'You used a little clue and solved it yourself!',
  hint: 'You asked for help and kept going until you solved it!',
  walkthrough: 'You followed every step and finished it. Great sticking with it!',
};

/** Child-friendly reason for the stars of one item. Names the effort, never ability. */
export function starReason(outcome: AttemptOutcome, teachBackCorrect: boolean | null): string {
  const base = STAR_REASONS[outcome];
  return teachBackCorrect === true ? `${base} Plus a bonus star for explaining it!` : base;
}

export function makeReward(
  childId: string,
  kind: RewardKind,
  key: string,
  amount: number,
  reason: string,
  at: number,
): RewardRecord {
  return { id: newId('rw'), childId, kind, key, amount, reason, at };
}

// ---------------------------------------------------------------------------
// Companion
// ---------------------------------------------------------------------------

const GROWTH_REASONS = [
  '',
  'Your egg hatched because you kept practising!',
  'Your companion grew because you keep learning new things!',
  'Your companion is all grown up, thanks to your steady practice!',
  'Your companion became legendary. That took a lot of patient work!',
];

/** Adds xp to the companion. Growth never goes down. */
export function feedCompanion(companion: Companion, xp: number): { companion: Companion; grew: boolean } {
  const totalXp = Math.max(0, companion.xp) + Math.max(0, xp);
  const growth = Math.max(companion.growth, growthForXp(totalXp));
  return { companion: { ...companion, xp: totalXp, growth }, grew: growth > companion.growth };
}

export function companionGrowthReason(companion: Companion): string {
  const fallback = 'Your companion grew because you kept practising!';
  const sentence = GROWTH_REASONS[companion.growth] || fallback;
  const def = getCompanionDef(companion.species);
  if (companion.growth === 1 && def) return `${sentence} Say hello to your ${def.name.toLowerCase()}!`;
  return sentence;
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

/** Whole days from one YYYY-MM-DD local day to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const parse = (day: string): number => {
    const [y, m, d] = day.split('-').map((part) => Number.parseInt(part, 10));
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).getTime();
  };
  return Math.round((parse(to) - parse(from)) / DAY_MS);
}

export interface StreakUpdate {
  streakDays: number;
  lastPlayedDay: string;
  /** The milestone reached by this update, or null. */
  milestone: number | null;
}

/**
 * Forgiving streak: playing on a new day continues the streak when the last
 * played day was yesterday or the day before (one missed day is forgiven).
 * A longer gap starts a new streak at 1. Playing again on the same day changes nothing.
 */
export function nextStreak(child: Pick<ChildProfile, 'streakDays' | 'lastPlayedDay'>, now: number): StreakUpdate {
  const today = dayKey(now);
  if (child.lastPlayedDay === null) return { streakDays: 1, lastPlayedDay: today, milestone: null };
  const gap = daysBetween(child.lastPlayedDay, today);
  if (gap <= 0) {
    // Same day, or the device clock moved back: keep everything as it is.
    return { streakDays: Math.max(1, child.streakDays), lastPlayedDay: child.lastPlayedDay, milestone: null };
  }
  const streakDays = gap <= TUNING.streak.forgivenGapDays ? Math.max(0, child.streakDays) + 1 : 1;
  const milestone = TUNING.streak.milestones.includes(streakDays) ? streakDays : null;
  return { streakDays, lastPlayedDay: today, milestone };
}

export function streakReason(days: number): string {
  return `You came back to learn ${days} days in a row. Little and often is how big things grow!`;
}

// ---------------------------------------------------------------------------
// Counters behind the badges
// ---------------------------------------------------------------------------

/** Running totals per child, cached in `db.kv` and rebuilt from the attempts when missing or stale. */
export interface ChildCounters {
  v: 1;
  /** Attempts recorded. Also used to notice a stale cache (after a backup restore). */
  solves: number;
  strandSolves: Record<Strand, number>;
  /** Current run of solves without any help or wrong try. */
  independentRun: number;
  teachBacks: number;
  modes: Mode[];
  robotSolves: number;
  buildSolves: number;
  /** Review items solved without a hint. */
  reviewWins: number;
  missions: number;
}

export interface CountedAttempt {
  strand: Strand;
  outcome: AttemptOutcome;
  teachBackCorrect: boolean | null;
  mode: Mode;
  interaction: InteractionKind;
  purpose: ItemPurpose;
}

export function countersKey(childId: string): string {
  return `progression:counters:${childId}`;
}

export function emptyCounters(): ChildCounters {
  return {
    v: 1,
    solves: 0,
    strandSolves: { math: 0, science: 0, technology: 0, engineering: 0, logic: 0 },
    independentRun: 0,
    teachBacks: 0,
    modes: [],
    robotSolves: 0,
    buildSolves: 0,
    reviewWins: 0,
    missions: 0,
  };
}

export function countAttempt(counters: ChildCounters, attempt: CountedAttempt): ChildCounters {
  const solvedAlone = attempt.outcome === 'independent' || attempt.outcome === 'second-try';
  return {
    v: 1,
    solves: counters.solves + 1,
    strandSolves: { ...counters.strandSolves, [attempt.strand]: counters.strandSolves[attempt.strand] + 1 },
    independentRun: attempt.outcome === 'independent' ? counters.independentRun + 1 : 0,
    teachBacks: counters.teachBacks + (attempt.teachBackCorrect === true ? 1 : 0),
    modes: counters.modes.includes(attempt.mode) ? counters.modes : [...counters.modes, attempt.mode],
    robotSolves: counters.robotSolves + (attempt.interaction === 'robot' ? 1 : 0),
    buildSolves: counters.buildSolves + (attempt.interaction === 'build' ? 1 : 0),
    reviewWins: counters.reviewWins + (attempt.purpose === 'review' && solvedAlone ? 1 : 0),
    missions: counters.missions + (attempt.mode === 'mission' ? 1 : 0),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Accepts only a well-formed cache record; anything else is rebuilt. */
export function parseCounters(value: unknown): ChildCounters | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  const strandSolves = record.strandSolves as Record<string, unknown> | null | undefined;
  if (typeof strandSolves !== 'object' || strandSolves === null) return null;
  if (!STRANDS.every((strand) => isCount(strandSolves[strand]))) return null;
  const numbers = ['solves', 'independentRun', 'teachBacks', 'robotSolves', 'buildSolves', 'reviewWins', 'missions'];
  if (!numbers.every((field) => isCount(record[field]))) return null;
  const modes = record.modes;
  if (!Array.isArray(modes) || !modes.every((mode) => (MODES as readonly unknown[]).includes(mode))) return null;
  return value as ChildCounters;
}

/**
 * The child's counters before the attempt being recorded. Reads the cache and
 * rebuilds it from `db.attempts` and `db.challenges` when it does not match the
 * number of stored attempts. Call inside a transaction that includes
 * `attempts`, `challenges` and `kv`.
 */
export async function loadCounters(childId: string): Promise<ChildCounters> {
  const stored = await db.kv.get(countersKey(childId));
  const cached = parseCounters(stored?.value);
  const attemptCount = await db.attempts.where('childId').equals(childId).count();
  if (cached && cached.solves === attemptCount) return cached;

  const attempts = await db.attempts.where('childId').equals(childId).sortBy('completedAt');
  const challenges = await db.challenges.bulkGet(attempts.map((attempt) => attempt.challengeId));
  let counters = emptyCounters();
  attempts.forEach((attempt, index) => {
    const challenge = challenges[index];
    counters = countAttempt(counters, {
      strand: attempt.strand,
      outcome: attempt.outcome,
      teachBackCorrect: attempt.teachBackCorrect,
      mode: challenge?.mode ?? 'quest',
      interaction: challenge?.interaction ?? 'choice',
      purpose: challenge?.purpose ?? 'core',
    });
  });
  return counters;
}

export async function saveCounters(childId: string, counters: ChildCounters): Promise<void> {
  await db.kv.put({ key: countersKey(childId), value: counters });
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export interface BadgeContext {
  /** Counters including the attempt being recorded. */
  counters: ChildCounters;
  outcome: AttemptOutcome;
  purpose: ItemPurpose;
  strand: Strand;
  /** Wrong tries before the correct answer on this item. */
  wrongTries: number;
  now: number;
  /** A skill moved up a stage step on this item. */
  skillSteppedUp: boolean;
  /** A strand-level stage change on this item, when there was one. */
  strandMove: { from: number; to: number } | null;
  checkPassed: boolean;
  placementFinished: boolean;
}

/** Keys of every badge whose condition is met right now (whether or not it was granted before). */
export function earnedBadgeKeys(ctx: BadgeContext): string[] {
  const B = TUNING.badges;
  const c = ctx.counters;
  const keys: string[] = [];
  if (c.solves >= 1) keys.push('first-spark');
  for (const milestone of B.solveMilestones) {
    if (c.solves >= milestone) keys.push(solveBadgeKey(milestone));
  }
  if (c.independentRun >= B.independentRun) keys.push('on-a-roll');
  if (ctx.wrongTries >= B.wrongTries) keys.push('never-gave-up');
  for (const strand of STRANDS) {
    if (c.strandSolves[strand] >= B.strandExplorer) keys.push(`explorer-${strand}`);
  }
  if (STRANDS.every((strand) => c.strandSolves[strand] >= 1)) keys.push('all-rounder');
  if (ctx.skillSteppedUp) keys.push('level-up');
  if (ctx.strandMove && stageGradeIndex(ctx.strandMove.to) > stageGradeIndex(ctx.strandMove.from)) {
    keys.push('grade-climber');
  }
  if (ctx.checkPassed) keys.push('double-checker');
  if (c.teachBacks >= B.teachBacks) keys.push('star-teacher');
  if (c.modes.length >= B.modes) keys.push('mode-explorer');
  if (c.robotSolves >= B.robotSolves) keys.push('robot-coder');
  if (c.buildSolves >= B.buildSolves) keys.push('inventor');
  const weekday = new Date(ctx.now).getDay();
  if (ctx.strand === 'science' && (weekday === 0 || weekday === 6)) keys.push('weekend-scientist');
  if (ctx.outcome === 'nudge' || ctx.outcome === 'hint') keys.push('brave-asker');
  if (ctx.purpose === 'sibling' && (ctx.outcome === 'independent' || ctx.outcome === 'second-try')) {
    keys.push('bounce-back');
  }
  if (c.reviewWins >= B.reviewWins) keys.push('memory-keeper');
  if (c.missions >= B.missions) keys.push('real-world-explorer');
  if (ctx.placementFinished) keys.push('trailblazer');
  return keys;
}

/** Keys of the badges the child already has. Each badge is granted once. */
export async function grantedBadgeKeys(childId: string): Promise<Set<string>> {
  const rows = await db.rewards.where('[childId+kind]').equals([childId, 'badge']).toArray();
  return new Set(rows.map((row) => row.key));
}

// ---------------------------------------------------------------------------
// Collectibles
// ---------------------------------------------------------------------------

export type BuyResult = { ok: boolean; reason: 'ok' | 'not-enough-stars' | 'owned' | 'unknown' };

/**
 * Spends stars on a collectible for the rewards shelf. 'unknown' when the
 * collectible or the child does not exist.
 */
export async function buyCollectible(childId: string, key: string, now: number = Date.now()): Promise<BuyResult> {
  const item = getCollectible(key);
  if (!item) return { ok: false, reason: 'unknown' };
  return db.transaction('rw', [db.children, db.rewards], async (): Promise<BuyResult> => {
    const child = await db.children.get(childId);
    if (!child) return { ok: false, reason: 'unknown' };
    if (child.collectibles.includes(key)) return { ok: false, reason: 'owned' };
    if (child.stars < item.cost) return { ok: false, reason: 'not-enough-stars' };
    await db.children.put({
      ...child,
      stars: child.stars - item.cost,
      collectibles: [...child.collectibles, key],
    });
    await db.rewards.add(
      makeReward(childId, 'collectible', key, -item.cost, `You saved up your stars and chose the ${item.name}!`, now),
    );
    return { ok: true, reason: 'ok' };
  });
}
