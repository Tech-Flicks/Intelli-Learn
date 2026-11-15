/**
 * The challenge supply queue: keeps a few validated challenges ready for each
 * child, so the next one appears at once, and builds one on the spot when the
 * queue has nothing that fits.
 *
 * A challenge moves `queued` -> `active` (when it is taken) -> `completed`
 * (`recordAttempt` in `@/progression` does that), or `discarded` when it went
 * stale in the queue. There is no way to skip: an active challenge is resumed
 * until it is solved.
 *
 * Where a challenge comes from, in this order:
 *   1. the canvas library, when an unseen item fits (served as it is, or remixed
 *      to the child's theme), for at most about half of what a child gets;
 *   2. the AI (`generateChallenge`), whose result is kept in the library;
 *   3. the offline bank, which `generateChallenge` falls back to by itself.
 *
 * Privacy: the only things about a child that leave this module towards the AI
 * are in `buildContext`: age group, grade, interests, language and strictness.
 */
import { clampStage, newId, stageGrade } from '@/core/grades';
import type { Challenge, StoryOutline } from '@/core/schemas';
import { expectationAt, getSkill } from '@/core/skills';
import { MODES, STRANDS } from '@/core/types';
import type {
  ChallengePlan,
  ChallengeRecord,
  ChallengeSource,
  ChildProfile,
  InteractionKind,
  Mode,
  ParentalControls,
  Settings,
  SkillState,
  StoryRecord,
  Strand,
} from '@/core/types';
import { checkBudget, db, getSettings, INTEREST_MAX_LENGTH, MAX_INTERESTS } from '@/data';
import {
  generateChallenge,
  generateImage,
  generateStoryOutline,
  localChallengeSafety,
  localSafetyCheck,
  remixChallenge,
  type ChildContext,
  type GenerateChallengeRequest,
  type GradeExpectation,
  type StoryChapterContext,
} from '@/ai';
import { avoidNotesFor, findReusable, fingerprintOf, markSeen, markServed, saveToLibrary } from '@/library';
import { pickOfflineChallenge, pickOfflineStory, pickOwnSkillChallenge } from '@/offline';
import { effectiveControls, FALLBACK_THEMES, kindsFor, makeSiblingPlan, planNext } from '@/progression';

// ---------------------------------------------------------------------------
// Tuning and injectable time / randomness
// ---------------------------------------------------------------------------

/** Every number of the supply rules in one place. */
export const SUPPLY = {
  /** `ensureQueue` starts filling when fewer than this many challenges are queued ... */
  queueMin: 3,
  /** ... and fills up to this many. */
  queueTarget: 5,
  /** Upper bound for a caller's `target`. */
  queueMax: 10,
  /** How many of the child's latest titles a new challenge must not repeat. */
  recentTitles: 15,
  /** The library share is measured over this many of the child's latest challenges ... */
  libraryWindow: 10,
  /** ... and fewer than this share of them may come from the library. */
  libraryShare: 0.5,
  /** A library item with at least this rating is served as it is, even when the theme differs. */
  keepAsIsRating: 4,
  /** Questions of this many completed challenges on the skill go to a concept check. */
  checkPreviousQuestions: 4,
  /** After a concept check could not be built for a skill, it is not tried again for this long. */
  checkRetryMs: 10 * 60_000,
  /** A queued challenge is stale when its stage is further than this from the skill's stage. */
  staleStageDistance: 1,
  /** Longest Imagination Studio idea that is passed on. */
  ideaMaxLength: 80,
  storyThemeMaxLength: 60,
  /** Story chapters for ages 3-8, and for older children. */
  storyChaptersYoung: 3,
  storyChaptersOlder: 4,
  /**
   * How long a child who is waiting for a challenge waits for the AI. A real model needs 15 to
   * 40 seconds for a challenge, and several minutes when it has to be corrected: when this time
   * is up the built-in bank serves the child, and the AI's challenge joins the queue when it
   * arrives ...
   */
  onDemandWaitMs: 8_000,
  /** ... and longer where only the AI can make what was asked for (a story chapter, the child's studio idea). */
  madeToOrderWaitMs: 20_000,
} as const;

export interface SupplyDeps {
  /** The clock. Defaults to `Date.now`. */
  now: () => number;
  /** Random source in [0, 1) for item selection and offline seeds. Null uses the progression module's own source. */
  rng: (() => number) | null;
  /** How long a waiting child waits for the AI: `SUPPLY.onDemandWaitMs` and `SUPPLY.madeToOrderWaitMs`. */
  onDemandWaitMs: number;
  madeToOrderWaitMs: number;
}

const DEFAULT_DEPS: SupplyDeps = {
  now: () => Date.now(),
  rng: null,
  onDemandWaitMs: SUPPLY.onDemandWaitMs,
  madeToOrderWaitMs: SUPPLY.madeToOrderWaitMs,
};
let deps: SupplyDeps = DEFAULT_DEPS;

/** Replaces the clock and the random source (tests). Pass `null` to go back to the defaults. */
export function setSupplyDeps(next: Partial<SupplyDeps> | null): void {
  deps = next ? { ...DEFAULT_DEPS, ...next } : DEFAULT_DEPS;
}

/**
 * Skills whose concept check could not be built a moment ago, per child, with the time it was
 * tried: the built-in bank had nothing new about the skill that the child has not solved
 * already, and no AI delivered one. The planner is asked to leave these checks out for a while,
 * so the child goes on with other skills instead of being handed a "check" that proves nothing.
 */
const checkless = new Map<string, Map<string, number>>();

function rememberCheckless(childId: string, skillId: string): void {
  const skills = checkless.get(childId) ?? new Map<string, number>();
  skills.set(skillId, deps.now());
  checkless.set(childId, skills);
}

function checklessSkills(childId: string): string[] {
  const skills = checkless.get(childId);
  if (!skills) return [];
  const now = deps.now();
  for (const [skillId, at] of skills) {
    if (now - at >= SUPPLY.checkRetryMs || now < at) skills.delete(skillId);
  }
  return [...skills.keys()];
}

/** Options for `planNext`: the request's mode and strand (when given), the clock and the random source. */
function planOptions(
  mode?: Mode,
  strand?: Strand,
  childId?: string,
): { mode?: Mode; strand?: Strand; now: number; rng?: () => number; withoutChecks?: string[] } {
  const withoutChecks = childId === undefined ? [] : checklessSkills(childId);
  return {
    ...(mode ? { mode } : {}),
    ...(strand ? { strand } : {}),
    now: deps.now(),
    ...(deps.rng ? { rng: deps.rng } : {}),
    ...(withoutChecks.length > 0 ? { withoutChecks } : {}),
  };
}

function offlineSeed(): number {
  return Math.floor((deps.rng ?? Math.random)() * 0x7fffffff);
}

// ---------------------------------------------------------------------------
// Serializing work per child, and knowing when everything is quiet
// ---------------------------------------------------------------------------

const tails = new Map<string, Promise<void>>();
const busy = new Set<Promise<unknown>>();

/** Keeps a promise on the list of running work until it settles. */
function track<T>(work: Promise<T>): Promise<T> {
  const quiet: Promise<unknown> = work.then(
    () => undefined,
    () => undefined,
  );
  busy.add(quiet);
  void quiet.then(() => busy.delete(quiet));
  return work;
}

/** Runs `task` after every earlier task with the same key has finished, whether it failed or not. */
function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return track(run);
}

const LATE = Symbol('late');

/** The value of `work`, or `LATE` when it takes longer than `ms`. The work itself goes on. */
function within<T>(work: Promise<T>, ms: number): Promise<T | typeof LATE> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(LATE), Math.max(0, ms));
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const takeKey = (childId: string): string => `take:${childId}`;
const buildKey = (childId: string): string => `build:${childId}`;

/**
 * Resolves when no supply work is running any more: queue fills, concept-check
 * preparation, story pictures. For tests, and for code that must not leave
 * writes behind (before wiping the database, for example).
 */
export async function supplyIdle(): Promise<void> {
  while (busy.size > 0) await Promise.all([...busy]);
}

// ---------------------------------------------------------------------------
// The child, as far as the supply (and the AI) needs to know them
// ---------------------------------------------------------------------------

function tidyInterests(interests: unknown): string[] {
  if (!Array.isArray(interests)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of interests) {
    if (typeof raw !== 'string') continue;
    const interest = Array.from(raw.replace(/\s+/g, ' ').trim()).slice(0, INTEREST_MAX_LENGTH).join('').trim();
    const key = interest.toLowerCase();
    if (interest === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(interest);
    if (out.length >= MAX_INTERESTS) break;
  }
  return out;
}

/**
 * What the AI may know about a child: age group, grade, tidied interests, the
 * language challenges are written in, and how strict the content rules are for
 * this child. Never the nickname, the avatar or the id.
 */
export function buildContext(child: ChildProfile, settings: Settings): ChildContext {
  return {
    ageGroup: child.ageGroup,
    grade: child.grade,
    interests: tidyInterests(child.interests),
    locale: settings.contentLocale,
    strictness: effectiveControls(settings, child).strictness,
  };
}

interface Env {
  child: ChildProfile;
  controls: ParentalControls;
  context: ChildContext;
}

async function loadEnv(childId: string): Promise<Env> {
  const child = await db.children.get(childId);
  if (!child) throw new Error(`Child profile not found: ${childId}`);
  const settings = await getSettings();
  return { child, controls: effectiveControls(settings, child), context: buildContext(child, settings) };
}

/** A strand the parent switched off. When every strand is off, none counts as off (the planner plays them all then). */
function strandDisabled(controls: ParentalControls, strand: Strand): boolean {
  if (controls.strands[strand] !== false) return false;
  return STRANDS.some((other) => controls.strands[other] !== false);
}

/**
 * Whether a challenge that was approved earlier still passes the content rules of the child
 * it is about to be shown to. Content is checked when it is made, with the strictness of the
 * child it was made for; a library item made for a sibling on 'standard', or anything made
 * before the parent turned strictness up, has to pass again here.
 */
function suitsChild(content: Challenge, env: Pick<Env, 'context'>): boolean {
  return localChallengeSafety(content, env.context.strictness).safe;
}

/**
 * Whether a stored challenge may (still) be put in front of the child: its subject and its
 * kind are switched on and its content passes the child's content rules. Applies to queued
 * challenges and to an unfinished one alike.
 */
function allowedNow(item: Pick<ChallengeRecord, 'strand' | 'mode' | 'content'>, env: Env): boolean {
  if (strandDisabled(env.controls, item.strand)) return false;
  if (item.mode === 'mission' && !env.controls.realWorldMissions) return false;
  return suitsChild(item.content, env);
}

/**
 * For the play store's last resort (the supply failed): may this unfinished challenge still
 * be shown to the child under the current settings?
 */
export function stillAllowed(record: ChallengeRecord, child: ChildProfile, settings: Settings): boolean {
  return allowedNow(record, { child, controls: effectiveControls(settings, child), context: buildContext(child, settings) });
}

// ---------------------------------------------------------------------------
// Building one challenge for a plan
// ---------------------------------------------------------------------------

interface BuildOptions {
  status: 'queued' | 'active';
  /** Use only what costs nothing: the library as it is and the offline bank. */
  offlineOnly?: boolean;
  /** Imagination Studio: what the canvas should show. Already checked. */
  studioIdea?: string;
  story?: { id: string; chapterIndex: number; context: StoryChapterContext };
  /** For a sibling: the question of the challenge that needed the walkthrough. */
  previousQuestion?: string;
}

/** A challenge that is ready to be stored. */
interface Made {
  content: Challenge;
  source: ChallengeSource;
  libraryId: string | null;
  rating: number | null;
  note: string;
}

/** The child's latest challenges that were not thrown away, newest first. */
async function recentRows(childId: string, limit: number): Promise<ChallengeRecord[]> {
  return db.challenges
    .orderBy('createdAt')
    .reverse()
    .filter((row) => row.childId === childId && row.status !== 'discarded')
    .limit(limit)
    .toArray();
}

function titlesOf(rows: readonly ChallengeRecord[]): string[] {
  return [...new Set(rows.map((row) => row.content.title))];
}

/**
 * Whether the next challenge may come from the library: only while fewer than
 * half of the child's latest ten came from it (served as-is, or remixed). For a
 * child with a shorter history the same share applies to what there is, so the
 * very first challenge may be a library item but the second may not be too.
 */
async function libraryShareAllows(recent: readonly ChallengeRecord[]): Promise<boolean> {
  const latest = recent.slice(0, SUPPLY.libraryWindow);
  const maybeRemixes = latest.filter((row) => row.source === 'ai' && row.libraryId !== null);
  const items = await db.library.bulkGet(maybeRemixes.map((row) => row.libraryId as string));
  const remixes = items.filter((item) => item?.origin === 'remix').length;
  const fromLibrary = latest.filter((row) => row.source === 'reused').length + remixes;
  const limit = Math.min(SUPPLY.libraryWindow * SUPPLY.libraryShare, Math.ceil((latest.length + 1) * SUPPLY.libraryShare));
  return fromLibrary < limit;
}

/**
 * What each child has completed, as fingerprints by challenge id. A completed challenge never
 * changes, so only the ones that were completed since the last look are read from the database.
 */
const completedPrints = new Map<string, Map<string, { strand: Strand; print: string }>>();

/**
 * Fingerprints of everything the child has solved in the strand, or has waiting (queued or
 * unfinished). A challenge that was thrown away unseen does not count.
 */
async function seenInStrand(childId: string, strand: Strand): Promise<Set<string>> {
  const known = completedPrints.get(childId) ?? new Map<string, { strand: Strand; print: string }>();
  completedPrints.set(childId, known);
  const ids = (await db.challenges.where('[childId+status]').equals([childId, 'completed']).primaryKeys()) as string[];
  const current = new Set(ids);
  for (const id of known.keys()) if (!current.has(id)) known.delete(id);
  const missing = ids.filter((id) => !known.has(id));
  for (const row of await db.challenges.bulkGet(missing)) {
    if (row) known.set(row.id, { strand: row.strand, print: fingerprintOf(row.content) });
  }
  const waiting = await db.challenges
    .where('[childId+status]')
    .anyOf([
      [childId, 'queued'],
      [childId, 'active'],
    ])
    .toArray();
  const seen = new Set<string>();
  for (const entry of known.values()) if (entry.strand === strand) seen.add(entry.print);
  for (const row of waiting) if (row.strand === strand) seen.add(fingerprintOf(row.content));
  return seen;
}

/**
 * The interaction kinds offline content may come in: the planned one first, then the other
 * kinds the skill offers in this mode and at this age, those the child used longest ago on the
 * skill first. Robot programs and builds belong to their modes and are never swapped in or out.
 */
async function kindsToTry(plan: ChallengePlan, env: Env): Promise<InteractionKind[]> {
  const fixed = plan.interaction === 'robot' || plan.interaction === 'build';
  const skill = getSkill(plan.skillId);
  // A sibling keeps the format of the challenge it follows; placement items are picked to be quick.
  if (fixed || !skill || plan.purpose === 'sibling' || plan.purpose === 'placement') return [plan.interaction];
  const state = await db.skillStates.get(`${env.child.id}:${plan.skillId}`);
  const recent = state?.recentInteractions ?? [];
  const age = (kind: InteractionKind): number => {
    const index = recent.indexOf(kind);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  const others = kindsFor(skill, plan.mode, env.child.ageGroup)
    .filter((kind) => kind !== plan.interaction && kind !== 'robot' && kind !== 'build')
    .sort((a, b) => age(b) - age(a));
  return [plan.interaction, ...others];
}

/**
 * A challenge from the built-in bank.
 *
 * The bank always has *something* for a plan, but when it has nothing for the plan's own skill
 * in the planned kind it borrows from a neighbouring skill or another strand. So content made
 * for the skill itself comes first, and one the child has not been given before: in the planned
 * kind, else in another kind the skill offers. Practice then accepts a repeat, and as the last
 * resort borrowed content. A concept check accepts neither: solving a challenge again, or one
 * about something else, proves nothing about the skill. Null means there is no such check.
 */
async function offlineMade(plan: ChallengePlan, env: Env, avoidTitles: string[]): Promise<Made | null> {
  const made = (content: Challenge): Made => ({ content, source: 'offline', libraryId: null, rating: null, note: '' });
  const seed = offlineSeed();
  const seen = await seenInStrand(env.child.id, plan.strand);
  const unseen = (content: Challenge): boolean => !seen.has(fingerprintOf(content));
  for (const kind of await kindsToTry(plan, env)) {
    const own = pickOwnSkillChallenge({ ...plan, interaction: kind }, { avoidTitles, seed, accept: unseen });
    if (own) return made(own);
  }
  if (plan.purpose === 'check') return null;
  const repeat = pickOwnSkillChallenge(plan, { avoidTitles, seed });
  return made(repeat ?? pickOfflineChallenge(plan, { avoidTitles, seed }));
}

/**
 * Keeps an AI-built challenge in the library and marks it as served to the
 * child. Returns null when it cannot be used: the library already holds the
 * same canvas and it is retired, rated low, or this child has seen it.
 */
async function keepInLibrary(
  content: Challenge,
  plan: ChallengePlan,
  env: Env,
  origin: 'ai' | 'remix',
  remixOf: string | null,
  now: number,
): Promise<Made | null> {
  try {
    const item = await saveToLibrary(
      { content, plan, ageGroup: env.child.ageGroup, locale: env.context.locale, origin, remixOf },
      now,
    );
    const lowRated = item.rating !== null && item.rating < 3;
    if (item.retired || lowRated || item.seenBy.includes(env.child.id)) return null;
    await markServed(item.id, env.child.id, now);
    return { content: item.content, source: 'ai', libraryId: item.id, rating: item.rating, note: item.ratingNote };
  } catch {
    return null;
  }
}

/** A library item for the plan: as it is, or remixed to the child's theme. Null when nothing fits. */
async function fromLibrary(
  plan: ChallengePlan,
  env: Env,
  expectation: GradeExpectation,
  skillName: string,
  offlineOnly: boolean,
  now: number,
  /** The child is waiting: a remix that takes too long is given up, and the item is served as it is. */
  waiting = false,
): Promise<Made | null> {
  const { child, context } = env;
  let found: Awaited<ReturnType<typeof findReusable>> = null;
  try {
    found = await findReusable(plan, { id: child.id, ageGroup: child.ageGroup, interests: context.interests }, context.locale, {
      // The library is shared: an item approved under a sibling's looser rules is not for this child.
      accept: (item) => suitsChild(item.content, env),
    });
  } catch {
    return null;
  }
  if (!found) return null;
  const { item, themeFits } = found;
  const wellLiked = item.rating !== null && item.rating >= SUPPLY.keepAsIsRating;
  if (!themeFits && !wellLiked && !offlineOnly) {
    let remixed: Challenge | null = null;
    try {
      const controller = new AbortController();
      const pending = remixChallenge({ original: item.content, plan, child: context, expectation, skillName, signal: controller.signal });
      const result = waiting ? await within(pending, deps.onDemandWaitMs) : await pending;
      // Too slow for a child who is waiting. The original is served instead, so the remix has no use any more.
      if (result === LATE) controller.abort();
      else remixed = result;
    } catch {
      remixed = null;
    }
    const kept = remixed ? await keepInLibrary(remixed, plan, env, 'remix', item.id, now) : null;
    if (kept) {
      // The child got the same idea in new clothes: the original is not for them any more.
      await markSeen(item.id, child.id);
      return kept;
    }
  }
  await markServed(item.id, child.id, now);
  return { content: item.content, source: 'reused', libraryId: item.id, rating: item.rating, note: item.ratingNote };
}

/** The child's latest completed challenges on a skill, newest first. */
async function lastCompletedOnSkill(childId: string, skillId: string, limit: number): Promise<ChallengeRecord[]> {
  const rows = await db.challenges
    .where('[childId+skillId]')
    .equals([childId, skillId])
    .filter((row) => row.status === 'completed')
    .toArray();
  return rows.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, limit);
}

/** Made for one moment only (a concept check, a sibling, a story chapter, a studio canvas): never taken from the library, never queued for later. */
function isMadeToOrder(plan: ChallengePlan, options: BuildOptions): boolean {
  return plan.purpose === 'check' || plan.purpose === 'sibling' || plan.mode === 'story' || plan.mode === 'studio' || options.story !== undefined;
}

/**
 * `generateChallenge` for a child who is waiting on the loading screen: its answer, or `LATE`
 * when the AI needs longer than a child should wait (the caller then serves the built-in bank).
 * A late answer is not thrown away: an ordinary challenge joins the queue when it arrives. One
 * that only this moment could use is cancelled.
 */
async function generatedInTime(
  request: GenerateChallengeRequest,
  plan: ChallengePlan,
  env: Env,
  options: BuildOptions,
): Promise<Awaited<ReturnType<typeof generateChallenge>> | typeof LATE> {
  const madeToOrder = isMadeToOrder(plan, options);
  const controller = new AbortController();
  const pending = generateChallenge({ ...request, signal: controller.signal });
  const result = await within(pending, madeToOrder ? deps.madeToOrderWaitMs : deps.onDemandWaitMs);
  if (result === LATE) {
    if (madeToOrder) controller.abort();
    else void track(queueLate(pending, plan, env.child.id));
  }
  return result;
}

/** Stores the AI's challenge that arrived after the child was served from the bank: in the library, and in the child's queue. Never rejects. */
async function queueLate(pending: ReturnType<typeof generateChallenge>, plan: ChallengePlan, childId: string): Promise<void> {
  try {
    const late = await pending;
    if (late.source !== 'ai') return;
    await serialize(buildKey(childId), async () => {
      const env = await loadEnv(childId);
      // The parent may have changed the rules in the meantime.
      if (!allowedNow({ strand: plan.strand, mode: plan.mode, content: late.content }, env)) return;
      const now = deps.now();
      if ((await freshQueue(env)).length >= SUPPLY.queueMax) {
        // No room in the queue: the canvas is still kept for later (not marked as served to anyone).
        await saveToLibrary({ content: late.content, plan, ageGroup: env.child.ageGroup, locale: env.context.locale, origin: 'ai', remixOf: null }, now);
        return;
      }
      const kept = await keepInLibrary(late.content, plan, env, 'ai', null, now);
      if (kept) await storeChallenge(kept, plan, env, { status: 'queued' }, now);
    });
  } catch {
    // Nobody is waiting for it.
  }
}

/**
 * A new challenge from the AI (kept in the library), or from the offline bank when the AI has
 * none (or, for a child who is waiting, takes too long). Null only for a concept check that neither could deliver (see `offlineMade`).
 */
async function freshlyMade(
  plan: ChallengePlan,
  env: Env,
  expectation: GradeExpectation,
  skillName: string,
  avoidTitles: string[],
  options: BuildOptions,
  now: number,
): Promise<Made | null> {
  const childId = env.child.id;
  const request: GenerateChallengeRequest = { plan, child: env.context, expectation, skillName, avoidTitles };
  try {
    request.avoidNotes = await avoidNotesFor(plan.skillId);
    const summary = (await db.learnerNotes.get(childId))?.summary.trim() ?? '';
    if (summary !== '') request.learnerSummary = summary;
    if (plan.purpose === 'check') {
      // The same idea must be tested in a new way: tell the AI what the child was asked before.
      const previous = await lastCompletedOnSkill(childId, plan.skillId, SUPPLY.checkPreviousQuestions);
      request.conceptCheck = { previousQuestions: previous.map((row) => row.content.question) };
      request.avoidTitles = [...new Set([...titlesOf(previous), ...avoidTitles])];
    }
    if (plan.purpose === 'sibling' && options.previousQuestion) {
      request.previousSibling = { question: options.previousQuestion };
    }
    if (options.story) request.story = options.story.context;
    if (options.studioIdea) request.studioIdea = options.studioIdea;

    const result = options.status === 'active' ? await generatedInTime(request, plan, env, options) : await generateChallenge(request);
    if (result !== LATE && result.source === 'ai') {
      const kept = await keepInLibrary(result.content, plan, env, 'ai', null, now);
      if (kept) return kept;
    }
    // Without the AI (Demo mode, the budget spent, a failure) `generateChallenge` answers from the
    // bank with the wide search. The supply knows what the child has seen: it picks for itself.
  } catch {
    // generateChallenge promises not to throw; if anything here does, the child still gets a challenge.
  }
  return offlineMade(plan, env, request.avoidTitles ?? avoidTitles);
}

/**
 * Turns a plan into a stored challenge. Concept checks, siblings, story
 * chapters and studio canvases are always made new; everything else looks in
 * the library first.
 *
 * Null only for a concept check that cannot be made: nothing new about the skill is to be had.
 * The skill is remembered (`checkless`), so the planner leaves its check out for a while.
 */
async function buildChallenge(plan: ChallengePlan, env: Env, options: BuildOptions): Promise<ChallengeRecord | null> {
  const now = deps.now();
  const { child } = env;
  const stage = clampStage(plan.stage);
  const skill = getSkill(plan.skillId);
  const expectation: GradeExpectation = skill
    ? expectationAt(skill, stage)
    : { grade: stageGrade(stage), text: plan.skillId };
  const skillName = skill?.name ?? plan.skillId;

  const recent = await recentRows(child.id, SUPPLY.recentTitles);
  const avoidTitles = titlesOf(recent);
  const offlineOnly = options.offlineOnly === true;
  const madeToOrder = isMadeToOrder(plan, options);

  let made: Made | null = null;
  if (!madeToOrder && (await libraryShareAllows(recent))) {
    made = await fromLibrary(plan, env, expectation, skillName, offlineOnly, now, options.status === 'active');
  }
  made ??= offlineOnly
    ? await offlineMade(plan, env, avoidTitles)
    : await freshlyMade(plan, env, expectation, skillName, avoidTitles, options, now);
  if (!made) {
    rememberCheckless(child.id, plan.skillId);
    return null;
  }
  return storeChallenge(made, { ...plan, stage }, env, options, now);
}

/** Writes the row of a challenge that was made for the plan. */
async function storeChallenge(made: Made, plan: ChallengePlan, env: Env, options: BuildOptions, now: number): Promise<ChallengeRecord> {
  const { child } = env;
  const stage = clampStage(plan.stage);
  const record: ChallengeRecord = {
    id: newId('ch'),
    childId: child.id,
    skillId: plan.skillId,
    strand: plan.strand,
    stage,
    interaction: made.content.interaction.kind,
    mode: plan.mode,
    purpose: plan.purpose,
    theme: plan.theme,
    content: made.content,
    source: made.source,
    status: options.status,
    storyId: options.story?.id ?? null,
    chapterIndex: options.story?.chapterIndex ?? null,
    libraryId: made.libraryId,
    parentRating: made.rating,
    parentNote: made.note,
    createdAt: now,
    startedAt: options.status === 'active' ? now : null,
    completedAt: null,
  };
  await db.transaction('rw', db.children, db.challenges, async () => {
    // A profile that was deleted while the challenge was being made gets nothing written.
    if (!(await db.children.get(child.id))) throw new Error(`Child profile not found: ${child.id}`);
    await db.challenges.add(record);
  });
  return record;
}

/**
 * Plans the child's next challenge and builds it. When the plan is a concept check that cannot
 * be made, the planner is asked again, now without that check; `shape` adapts each plan (a story
 * chapter, a studio canvas) and gives the build options.
 */
async function buildPlanned(
  env: Env,
  request: { mode?: Mode; strand?: Strand },
  shape: (planned: ChallengePlan) => { plan: ChallengePlan; options: BuildOptions },
): Promise<ChallengeRecord> {
  const childId = env.child.id;
  for (let go = 0; ; go += 1) {
    const [planned] = await planNext(childId, 1, planOptions(request.mode, request.strand, childId));
    if (!planned) throw new Error('The planner returned no plan');
    const { plan, options } = shape(planned);
    // The planner should not come back with the same impossible check. If it ever does, the
    // child gets the challenge as plain practice rather than nothing.
    const last = go >= 2 && plan.purpose === 'check';
    const record = await buildChallenge(last ? { ...plan, purpose: 'core' } : plan, env, options);
    if (record) return record;
  }
}

// ---------------------------------------------------------------------------
// The queue: stale items, picking, filling
// ---------------------------------------------------------------------------

function isStale(item: ChallengeRecord, env: Env, states: ReadonlyMap<string, SkillState>): boolean {
  if (!allowedNow(item, env)) return true;
  if (item.purpose === 'placement') return env.child.placementDone;
  const state = states.get(item.skillId);
  if (item.purpose === 'check') {
    // A check only means something while the skill is waiting for it.
    if (!state?.checkPending) return true;
  } else if (state?.checkPending) {
    // The skill gets its concept check next, not more practice.
    return true;
  }
  if (!state) return false;
  // A sibling was made a step easier on purpose, right after a walkthrough.
  if (item.purpose === 'sibling') return false;
  return Math.abs(state.stage - item.stage) > SUPPLY.staleStageDistance;
}

const lowRating = (rating: number | null): boolean => rating !== null && rating < 3;

/**
 * The library canvases behind these challenges that a parent took out of circulation: retired,
 * or rated 1 or 2 stars. "Never served again" also holds for a challenge that was made from the
 * canvas before the parent looked at it and is still waiting (or unfinished).
 */
async function retiredCanvases(rows: readonly ChallengeRecord[]): Promise<Set<string>> {
  const ids = [...new Set(rows.flatMap((row) => (row.libraryId === null ? [] : [row.libraryId])))];
  if (ids.length === 0) return new Set();
  const items = await db.library.bulkGet(ids);
  return new Set(items.flatMap((item) => (item && (item.retired || lowRating(item.rating)) ? [item.id] : [])));
}

/** Whether a parent rejected this challenge: its own rating is 1 or 2 stars, or its canvas was retired. */
function rejectedByParent(item: Pick<ChallengeRecord, 'libraryId' | 'parentRating'>, retired: ReadonlySet<string>): boolean {
  return lowRating(item.parentRating) || (item.libraryId !== null && retired.has(item.libraryId));
}

/** Discards the queued challenges that went stale and returns the rest, oldest first. */
async function freshQueue(env: Env): Promise<ChallengeRecord[]> {
  const childId = env.child.id;
  const [queued, stateRows] = await Promise.all([
    db.challenges.where('[childId+status]').equals([childId, 'queued']).toArray(),
    db.skillStates.where('childId').equals(childId).toArray(),
  ]);
  const states = new Map(stateRows.map((state) => [state.skillId, state]));
  const retired = await retiredCanvases(queued);
  const stale = queued.filter((item) => rejectedByParent(item, retired) || isStale(item, env, states));
  if (stale.length > 0) {
    const staleIds = new Set(stale.map((item) => item.id));
    await db.challenges
      .where('[childId+status]')
      .equals([childId, 'queued'])
      .filter((row) => staleIds.has(row.id))
      .modify({ status: 'discarded' });
  }
  return queued.filter((item) => !stale.includes(item)).sort((a, b) => a.createdAt - b.createdAt);
}

/** Where the play store keeps the run of an unfinished challenge (see session.ts). Per-child `kv` key. */
const runKey = (record: Pick<ChallengeRecord, 'id' | 'childId'>): string => `play:run:${record.id}:${record.childId}`;

/**
 * The child's unfinished challenges that may still be shown, oldest first. One that the
 * parent's settings no longer allow (its subject or real-world missions were switched off,
 * or the content rules were tightened), or whose canvas the parent retired or rated 1 or 2
 * stars, is discarded together with its saved run: "no skipping" binds the child, not the
 * parent's switches.
 */
async function activeChallenges(env: Env): Promise<ChallengeRecord[]> {
  const childId = env.child.id;
  const active = await db.challenges.where('[childId+status]').equals([childId, 'active']).toArray();
  const retired = await retiredCanvases(active);
  const withdrawn = active.filter((item) => !allowedNow(item, env) || rejectedByParent(item, retired));
  if (withdrawn.length > 0) {
    await db.transaction('rw', db.challenges, db.kv, async () => {
      for (const item of withdrawn) {
        const row = await db.challenges.get(item.id);
        if (row?.status === 'active') await db.challenges.update(item.id, { status: 'discarded' });
        await db.kv.delete(runKey(item));
      }
    });
  }
  return active
    .filter((item) => !withdrawn.includes(item))
    .sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt));
}

/** What the child asked for, with everything a parent switched off (or that is not a real value) taken out. */
interface Request {
  mode?: Mode;
  strand?: Strand;
  /** Free text from the child. Only present while open chat is on. */
  idea?: string;
  /** The ids of the three studio chips ("dragon.baking.moon"). */
  pick?: string;
}

/** What `takeNext` may be asked for: it comes from the address of the play screen, which anyone can type. */
export interface TakeOptions {
  mode?: Mode;
  strand?: Strand;
  idea?: string;
  pick?: string;
}

function readRequest(opts: TakeOptions, env: Env): Request {
  const request: Request = {};
  // The creative modes open after the first adventure: until the placement is done every request is ordinary play.
  const mode = env.child.placementDone && (MODES as readonly unknown[]).includes(opts.mode) ? opts.mode : undefined;
  // A plain quest is ordinary play. A mission is ordinary play too while missions are switched off.
  if (mode && mode !== 'quest' && !(mode === 'mission' && !env.controls.realWorldMissions)) request.mode = mode;
  const strand = (STRANDS as readonly unknown[]).includes(opts.strand) ? opts.strand : undefined;
  if (strand && !strandDisabled(env.controls, strand)) request.strand = strand;
  // Free text reaches the AI only while the parent has open chat on. The studio screen hides
  // its text box otherwise, but the address can be typed by hand: the rule is enforced here.
  if (typeof opts.idea === 'string' && env.controls.openChat) request.idea = opts.idea;
  if (typeof opts.pick === 'string') request.pick = opts.pick;
  return request;
}

function fitsRequest(item: Pick<ChallengeRecord, 'mode' | 'strand'>, request: Request): boolean {
  if (request.mode !== undefined && item.mode !== request.mode) return false;
  if (request.strand !== undefined && item.strand !== request.strand) return false;
  return true;
}

const PURPOSE_ORDER: Partial<Record<ChallengeRecord['purpose'], number>> = { check: 0, sibling: 1 };

/**
 * Whether a queued challenge may be served for the request. A concept check and the easier
 * follow-up after a walkthrough are due whatever mode the child is playing in: a child who
 * only ever opens Robot Coder must still get the checks that raise a stage (they are planned
 * as plain quests, in another format than the practice). The strand asked for still holds.
 */
function servesRequest(item: Pick<ChallengeRecord, 'mode' | 'strand' | 'purpose'>, request: Request): boolean {
  if (item.purpose === 'check' || item.purpose === 'sibling') {
    return request.strand === undefined || item.strand === request.strand;
  }
  return fitsRequest(item, request);
}

/** The queued challenge to serve next: concept checks first, then siblings, then the oldest. */
async function pickQueued(env: Env, request: Request): Promise<ChallengeRecord | undefined> {
  const queue = (await freshQueue(env)).filter((item) => servesRequest(item, request));
  queue.sort((a, b) => (PURPOSE_ORDER[a.purpose] ?? 2) - (PURPOSE_ORDER[b.purpose] ?? 2) || a.createdAt - b.createdAt);
  return queue[0];
}

/** Makes a queued challenge the active one. Null when it is no longer queued. */
async function activate(id: string): Promise<ChallengeRecord | null> {
  const now = deps.now();
  return db.transaction('rw', db.challenges, async () => {
    const row = await db.challenges.get(id);
    if (!row || row.status !== 'queued') return null;
    const active: ChallengeRecord = { ...row, status: 'active', startedAt: now };
    await db.challenges.put(active);
    return active;
  });
}

const filling = new Map<string, Promise<void>>();
const refill = new Set<string>();

function wholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

async function fillQueue(childId: string, opts: { min?: number; target?: number }): Promise<void> {
  const min = wholeNumber(opts.min, SUPPLY.queueMin, 0, SUPPLY.queueMax);
  const target = wholeNumber(opts.target, Math.max(min, SUPPLY.queueTarget), Math.max(min, 1), SUPPLY.queueMax);
  let started = false;
  let budgetRefusals = 0;
  for (let built = 0; built < target; built += 1) {
    // One challenge at a time: kind to rate limits, and the planner sees the previous one.
    const more = await serialize(buildKey(childId), async () => {
      const env = await loadEnv(childId);
      const queue = await freshQueue(env);
      // Placement items depend on the answers so far: keep just one ahead until placement is done.
      const placing = !env.child.placementDone;
      const wanted = placing ? Math.min(1, target) : started ? target : min;
      if (queue.length >= wanted) return false;
      started = true;
      const budget = await checkBudget(deps.now());
      budgetRefusals = budget.allowed ? 0 : budgetRefusals + 1;
      // With the AI budget spent, stop asking: the offline bank fills the rest at once.
      const offlineOnly = budgetRefusals > 1;
      await buildPlanned(env, {}, (plan) => ({ plan, options: { status: 'queued', offlineOnly } }));
      return true;
    });
    if (!more) return;
  }
}

/**
 * Tops the child's queue up in the background: when fewer than `min` (3)
 * challenges are queued, it builds up to `target` (5), one after the other.
 * While placement is running it keeps exactly one ahead. Calls for the same
 * child share one run. Never rejects.
 */
export function ensureQueue(childId: string, opts: { min?: number; target?: number } = {}): Promise<void> {
  const running = filling.get(childId);
  if (running) {
    // Something may have been taken since the run last looked: have it look once more before it ends.
    refill.add(childId);
    return running;
  }
  const run = (async () => {
    try {
      do {
        refill.delete(childId);
        await fillQueue(childId, opts);
      } while (refill.has(childId));
    } catch {
      // A background top-up has nobody to report to; takeNext builds on demand when the queue is short.
    } finally {
      refill.delete(childId);
      filling.delete(childId);
    }
  })();
  filling.set(childId, run);
  return track(run);
}

// ---------------------------------------------------------------------------
// Story Quest
// ---------------------------------------------------------------------------

/** Where a story's picture descriptions are kept (they are not part of `StoryRecord`). Per-child `kv` key. */
const illustrationKey = (storyId: string, childId: string): string => `play:story:${storyId}:${childId}`;

function oneLine(text: string, max: number): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
}

function rotatingTheme(env: Env, turn: number): string {
  const themes = env.context.interests.length > 0 ? env.context.interests : FALLBACK_THEMES;
  return themes[turn % themes.length] ?? 'animals';
}

async function createStory(env: Env, theme: string | undefined): Promise<StoryRecord> {
  const { child, context } = env;
  const wanted = typeof theme === 'string' ? oneLine(theme, SUPPLY.storyThemeMaxLength) : '';
  const storiesSoFar = await db.stories.where('childId').equals(child.id).count();
  const chosen =
    wanted !== '' && localSafetyCheck(wanted, context.strictness).safe ? wanted : rotatingTheme(env, storiesSoFar);
  const chapters = child.ageGroup === '3-5' || child.ageGroup === '6-8' ? SUPPLY.storyChaptersYoung : SUPPLY.storyChaptersOlder;

  let outline: StoryOutline;
  try {
    outline = await generateStoryOutline({ child: context, theme: chosen, chapters });
  } catch {
    outline = pickOfflineStory(chosen, chapters);
  }

  const story: StoryRecord = {
    id: newId('story'),
    childId: child.id,
    title: outline.title,
    theme: chosen,
    chapters: outline.chapters.map((chapter) => ({ heading: chapter.heading, narrative: chapter.narrative, imageDataUrl: null })),
    ending: outline.ending,
    currentChapter: 0,
    status: 'active',
    createdAt: deps.now(),
  };
  await db.transaction('rw', db.children, db.stories, db.kv, async () => {
    if (!(await db.children.get(child.id))) throw new Error(`Child profile not found: ${child.id}`);
    // One story at a time: an unfinished one is closed when a new one begins.
    const open = await db.stories.where('[childId+status]').equals([child.id, 'active']).toArray();
    for (const old of open) {
      await db.stories.update(old.id, { status: 'finished' });
      await db.kv.delete(illustrationKey(old.id, child.id));
    }
    await db.stories.add(story);
    await db.kv.put({
      key: illustrationKey(story.id, child.id),
      value: { v: 1, illustrations: outline.chapters.map((chapter) => chapter.illustration) },
    });
  });
  return story;
}

/**
 * Starts a new Story Quest for the child and makes it the active story: three
 * chapters for ages 3-8, four for older children. Without a (suitable) theme
 * the child's interests take turns. An unfinished earlier story is closed.
 */
export async function startStory(childId: string, theme?: string): Promise<StoryRecord> {
  return createStory(await loadEnv(childId), theme);
}

/**
 * Brings a story in step with what was solved: `currentChapter` becomes the
 * first chapter without a completed challenge, and the story is `finished`
 * when every chapter has one. Returns the story, or undefined when it is gone.
 * `takeNext` does this by itself; the play screen may call it after a chapter
 * to know whether to show the ending.
 */
export async function advanceStory(storyId: string): Promise<StoryRecord | undefined> {
  return db.transaction('rw', db.stories, db.challenges, db.kv, async () => {
    const story = await db.stories.get(storyId);
    if (!story) return undefined;
    const solved = new Set<number>();
    await db.challenges
      .where('storyId')
      .equals(storyId)
      .each((row) => {
        if (row.status === 'completed' && row.chapterIndex !== null) solved.add(row.chapterIndex);
      });
    const next = story.chapters.findIndex((_, index) => !solved.has(index));
    const finished = next < 0;
    const updated: StoryRecord = {
      ...story,
      currentChapter: finished ? Math.max(0, story.chapters.length - 1) : next,
      status: finished || story.status === 'finished' ? 'finished' : 'active',
    };
    if (updated.currentChapter !== story.currentChapter || updated.status !== story.status) {
      await db.stories.put(updated);
    }
    if (updated.status === 'finished') await db.kv.delete(illustrationKey(story.id, story.childId));
    return updated;
  });
}

/** The picture description of a chapter. Rebuilt from the chapter text when the stored one is gone (after a restore). */
async function illustrationFor(story: StoryRecord, chapterIndex: number): Promise<string> {
  const stored = (await db.kv.get(illustrationKey(story.id, story.childId)))?.value as
    | { illustrations?: unknown }
    | undefined;
  const list = Array.isArray(stored?.illustrations) ? stored.illustrations : [];
  const text: unknown = list[chapterIndex];
  if (typeof text === 'string' && text.trim() !== '') return oneLine(text, 200);
  const chapter = story.chapters[chapterIndex];
  const narrative = chapter?.narrative ?? '';
  const firstSentence = /^.*?[.!?।](?=\s|$)/.exec(narrative)?.[0] ?? narrative;
  return oneLine(`${chapter?.heading ?? story.title}. ${firstSentence}`, 200);
}

/** Fetches the chapter's picture and stores it on the chapter. Never rejects. */
async function fetchIllustration(storyId: string, chapterIndex: number, illustration: string): Promise<void> {
  try {
    const url = await generateImage(illustration);
    // Embedded pictures only: anything else would make the app load from a third address.
    if (typeof url !== 'string' || !url.startsWith('data:image/')) return;
    await db.transaction('rw', db.stories, async () => {
      const story = await db.stories.get(storyId);
      const chapter = story?.chapters[chapterIndex];
      if (!story || !chapter || chapter.imageDataUrl !== null) return;
      const chapters = story.chapters.map((entry, index) => (index === chapterIndex ? { ...entry, imageDataUrl: url } : entry));
      await db.stories.update(storyId, { chapters });
    });
  } catch {
    // A story reads fine without its picture.
  }
}

/** The child's active story at its next unsolved chapter, starting a new story when there is none. */
async function storyToContinue(env: Env): Promise<StoryRecord> {
  const open = await db.stories.where('[childId+status]').equals([env.child.id, 'active']).toArray();
  const latest = open.sort((a, b) => b.createdAt - a.createdAt)[0];
  const current = latest ? await advanceStory(latest.id) : undefined;
  return current && current.status === 'active' ? current : createStory(env, undefined);
}

async function nextStoryChapter(env: Env, request: Request): Promise<ChallengeRecord> {
  const story = await storyToContinue(env);
  const chapterIndex = story.currentChapter;
  const chapter = story.chapters[chapterIndex];
  if (!chapter) throw new Error(`Story ${story.id} has no chapter ${chapterIndex}`);
  const illustration = await illustrationFor(story, chapterIndex);

  // The story's theme joins the plan only when it is one of the known themes; the chapter text carries the rest.
  const known = [...env.context.interests, ...FALLBACK_THEMES].some((theme) => theme.toLowerCase() === story.theme.toLowerCase());
  const record = await buildPlanned(env, { mode: 'story', ...(request.strand ? { strand: request.strand } : {}) }, (planned) => ({
    plan: { ...planned, mode: 'story', theme: known ? story.theme : planned.theme },
    options: {
      status: 'active',
      story: {
        id: story.id,
        chapterIndex,
        context: { title: story.title, heading: chapter.heading, narrative: chapter.narrative, illustration },
      },
    },
  }));
  if (env.controls.aiImages && chapter.imageDataUrl === null) {
    void track(fetchIllustration(story.id, chapterIndex, illustration));
  }
  return record;
}

// ---------------------------------------------------------------------------
// Imagination Studio
// ---------------------------------------------------------------------------

/** The child's idea when it is a harmless thing to draw, cut to one short line. Null otherwise. */
function safeIdea(idea: string | undefined, strictness: ChildContext['strictness']): string | null {
  if (typeof idea !== 'string') return null;
  const whole = idea.replace(/\s+/g, ' ').trim();
  const short = oneLine(whole, SUPPLY.ideaMaxLength);
  if (short === '') return null;
  return localSafetyCheck(whole, strictness).safe && localSafetyCheck(short, strictness).safe ? short : null;
}

/**
 * The sentence for a picture idea ("dragon.baking.moon" -> "A dragon baking cookies on the
 * moon"), built from the studio's own fixed phrases. Null for ids that are not chips.
 * The child module owns the chips and their words; it is loaded on demand.
 */
async function pictureIdea(pick: string): Promise<string | null> {
  const [character, action, place, ...rest] = pick.split('.');
  if (!character || !action || !place || rest.length > 0) return null;
  try {
    const { buildIdea } = await import('@/child');
    return buildIdea({ character, action, place });
  } catch {
    return null;
  }
}

async function studioCanvas(env: Env, request: Request): Promise<ChallengeRecord> {
  // The child's own words when there are any (open chat is on then), else the picture idea.
  const wanted = request.idea ?? (request.pick !== undefined ? await pictureIdea(request.pick) : null);
  const idea = safeIdea(wanted ?? undefined, env.context.strictness);
  // Without a usable idea the canvas is about the child's first interest.
  const fallback = env.context.interests[0] ?? FALLBACK_THEMES[0] ?? 'animals';
  return buildPlanned(env, { mode: 'studio', ...(request.strand ? { strand: request.strand } : {}) }, (planned) => ({
    plan: { ...planned, mode: 'studio', theme: idea ? planned.theme : fallback },
    options: { status: 'active', studioIdea: idea ?? fallback },
  }));
}

// ---------------------------------------------------------------------------
// Taking the next challenge
// ---------------------------------------------------------------------------

async function takeNextNow(childId: string, opts: TakeOptions): Promise<ChallengeRecord> {
  const env = await loadEnv(childId);
  const request = readRequest(opts, env);

  // 1. No skipping: an unfinished challenge comes back first, whatever was asked for. Opening
  //    another world or mode is not a way around it: what was asked for comes after it. Rows
  //    from before this rule can hold several unfinished ones; then the one that fits goes first.
  const active = await activeChallenges(env);
  const resumed =
    active
      // A story has one challenge per chapter: an unfinished chapter comes back whatever strand was asked for.
      .filter((item) => (request.mode === 'story' ? item.mode === 'story' : fitsRequest(item, request)))[0] ?? active[0];
  if (resumed) {
    void ensureQueue(childId);
    return resumed;
  }

  let record: ChallengeRecord | null = null;
  if (request.mode === 'story') {
    record = await nextStoryChapter(env, request);
  } else if (request.mode === 'studio') {
    record = await studioCanvas(env, request);
  } else {
    // 2. Something from the queue.
    let topUpIsSlow = false;
    let queued = await pickQueued(env, request);
    if (!queued && request.mode === undefined && request.strand === undefined) {
      // A top-up is already making a challenge: waiting for it is quicker than starting another.
      // But not for longer than a child should wait: a real model can take minutes over one.
      const underway = tails.get(buildKey(childId));
      if (underway) {
        topUpIsSlow = (await within(underway, deps.onDemandWaitMs)) === LATE;
        queued = await pickQueued(env, request);
      }
    }
    if (queued) record = await activate(queued.id);
    // 3. Nothing ready: make one now, so the child never waits on a missing queue. While the
    //    top-up is still busy with the AI, this one comes from the library or the built-in bank
    //    (one AI request at a time), and the top-up's challenge is there for the next turn.
    if (!record) {
      const asked = { ...(request.mode ? { mode: request.mode } : {}), ...(request.strand ? { strand: request.strand } : {}) };
      record = await buildPlanned(env, asked, (plan) => ({ plan, options: { status: 'active', offlineOnly: topUpIsSlow } }));
    }
  }
  void ensureQueue(childId);
  return record;
}

/**
 * The challenge the child plays next, already marked `active`.
 *
 * - An active challenge is returned again, whatever mode or strand was asked
 *   for: there is no skipping, and opening another world or mode does not set a
 *   challenge aside. What was asked for is served once it is finished.
 * - Otherwise the queue is used: concept checks first, then siblings, then the
 *   oldest, after stale items were discarded.
 * - Otherwise one is built now. Story mode serves the next chapter of the
 *   child's story; studio mode draws the child's idea when it is suitable: the
 *   picture idea (`pick`, three chip ids), or the typed `idea` while open chat
 *   is on. With open chat off, free text from the request is ignored.
 * - Until the placement is done, a mode in the request is ignored.
 *
 * `mode: 'quest'` means ordinary play, like no mode. Calls for one child run
 * one after the other, so two callers never get two different new challenges.
 * Rejects only when the child does not exist.
 */
export function takeNext(childId: string, opts: TakeOptions = {}): Promise<ChallengeRecord> {
  return serialize(takeKey(childId), () => takeNextNow(childId, opts));
}

// ---------------------------------------------------------------------------
// Siblings and concept checks
// ---------------------------------------------------------------------------

const siblings = new Map<string, Promise<ChallengeRecord>>();
const SIBLINGS_REMEMBERED = 50;

/**
 * The easier follow-up after a walkthrough: same skill and interaction, one
 * step lower. It is stored as `queued`, and `takeNext` serves siblings right
 * after concept checks. Asking twice for the same challenge gives the same sibling.
 */
export function makeSibling(previous: ChallengeRecord): Promise<ChallengeRecord> {
  const known = siblings.get(previous.id);
  if (known) return known.then(async (made) => (await db.challenges.get(made.id)) ?? made);
  const making = track(
    (async () => {
      const env = await loadEnv(previous.childId);
      const sibling = await buildChallenge(makeSiblingPlan(previous), env, {
        status: 'queued',
        previousQuestion: previous.content.question,
      });
      // Only a concept check can come back empty.
      if (!sibling) throw new Error('The sibling could not be built');
      return sibling;
    })(),
  );
  siblings.set(previous.id, making);
  making.catch(() => siblings.delete(previous.id));
  if (siblings.size > SIBLINGS_REMEMBERED) {
    const oldest = siblings.keys().next().value;
    if (oldest !== undefined) siblings.delete(oldest);
  }
  return making;
}

/** How many plans to look through for the wanted check: other skills' checks may come first. */
const CHECK_LOOKAHEAD = 4;

/**
 * Builds the concept check for a skill ahead of time, so it is ready when the
 * child gets to it. Does nothing unless the skill is waiting for its check and
 * none is queued or active. Never rejects.
 */
export function prepareConceptCheck(childId: string, skillId: string): Promise<void> {
  return serialize(buildKey(childId), async () => {
    try {
      const state = await db.skillStates.where('[childId+skillId]').equals([childId, skillId]).first();
      if (!state?.checkPending) return;
      const waiting = await db.challenges
        .where('[childId+skillId]')
        .equals([childId, skillId])
        .filter((row) => row.purpose === 'check' && (row.status === 'queued' || row.status === 'active'))
        .count();
      if (waiting > 0) return;
      const env = await loadEnv(childId);
      // The planner puts checks first; make sure the plan really is the check for this skill.
      const plans = await planNext(childId, CHECK_LOOKAHEAD, planOptions(undefined, undefined, childId));
      const plan = plans.find((candidate) => candidate.purpose === 'check' && candidate.skillId === skillId);
      if (!plan) return;
      await buildChallenge(plan, env, { status: 'queued' });
    } catch {
      // The check is planned again by the next top-up.
    }
  });
}

/** Forgets which siblings were made and goes back to the real clock (tests, after `supplyIdle()`). */
export function resetSupply(): void {
  siblings.clear();
  checkless.clear();
  completedPrints.clear();
  deps = DEFAULT_DEPS;
}
