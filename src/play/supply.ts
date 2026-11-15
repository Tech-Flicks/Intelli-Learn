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
  localSafetyCheck,
  remixChallenge,
  type ChildContext,
  type GenerateChallengeRequest,
  type GradeExpectation,
  type StoryChapterContext,
} from '@/ai';
import { avoidNotesFor, findReusable, markSeen, markServed, saveToLibrary } from '@/library';
import { pickOfflineChallenge, pickOfflineStory } from '@/offline';
import { effectiveControls, FALLBACK_THEMES, makeSiblingPlan, planNext } from '@/progression';

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
  /** A queued challenge is stale when its stage is further than this from the skill's stage. */
  staleStageDistance: 1,
  /** Longest Imagination Studio idea that is passed on. */
  ideaMaxLength: 80,
  storyThemeMaxLength: 60,
  /** Story chapters for ages 3-8, and for older children. */
  storyChaptersYoung: 3,
  storyChaptersOlder: 4,
} as const;

export interface SupplyDeps {
  /** The clock. Defaults to `Date.now`. */
  now: () => number;
  /** Random source in [0, 1) for item selection and offline seeds. Null uses the progression module's own source. */
  rng: (() => number) | null;
}

const DEFAULT_DEPS: SupplyDeps = { now: () => Date.now(), rng: null };
let deps: SupplyDeps = DEFAULT_DEPS;

/** Replaces the clock and the random source (tests). Pass `null` to go back to the defaults. */
export function setSupplyDeps(next: Partial<SupplyDeps> | null): void {
  deps = next ? { ...DEFAULT_DEPS, ...next } : DEFAULT_DEPS;
}

/** Options for `planNext`: the request's mode and strand (when given), the clock and the random source. */
function planOptions(mode?: Mode, strand?: Strand): { mode?: Mode; strand?: Strand; now: number; rng?: () => number } {
  return {
    ...(mode ? { mode } : {}),
    ...(strand ? { strand } : {}),
    now: deps.now(),
    ...(deps.rng ? { rng: deps.rng } : {}),
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

function offlineMade(plan: ChallengePlan, avoidTitles: string[]): Made {
  return {
    content: pickOfflineChallenge(plan, { avoidTitles, seed: offlineSeed() }),
    source: 'offline',
    libraryId: null,
    rating: null,
    note: '',
  };
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
): Promise<Made | null> {
  const { child, context } = env;
  let found: Awaited<ReturnType<typeof findReusable>> = null;
  try {
    found = await findReusable(plan, { id: child.id, ageGroup: child.ageGroup, interests: context.interests }, context.locale);
  } catch {
    return null;
  }
  if (!found) return null;
  const { item, themeFits } = found;
  const wellLiked = item.rating !== null && item.rating >= SUPPLY.keepAsIsRating;
  if (!themeFits && !wellLiked && !offlineOnly) {
    let remixed: Challenge | null = null;
    try {
      remixed = await remixChallenge({ original: item.content, plan, child: context, expectation, skillName });
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

/** A new challenge from the AI (kept in the library), or from the offline bank when the AI has none. */
async function freshlyMade(
  plan: ChallengePlan,
  env: Env,
  expectation: GradeExpectation,
  skillName: string,
  avoidTitles: string[],
  options: BuildOptions,
  now: number,
): Promise<Made> {
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

    const result = await generateChallenge(request);
    if (result.source !== 'ai') return { content: result.content, source: 'offline', libraryId: null, rating: null, note: '' };
    const kept = await keepInLibrary(result.content, plan, env, 'ai', null, now);
    if (kept) return kept;
  } catch {
    // generateChallenge promises not to throw; if anything here does, the child still gets a challenge.
  }
  return offlineMade(plan, request.avoidTitles ?? avoidTitles);
}

/**
 * Turns a plan into a stored challenge. Concept checks, siblings, story
 * chapters and studio canvases are always made new; everything else looks in
 * the library first.
 */
async function buildChallenge(plan: ChallengePlan, env: Env, options: BuildOptions): Promise<ChallengeRecord> {
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
  const madeToOrder =
    plan.purpose === 'check' ||
    plan.purpose === 'sibling' ||
    plan.mode === 'story' ||
    plan.mode === 'studio' ||
    options.story !== undefined;

  let made: Made | null = null;
  if (!madeToOrder && (await libraryShareAllows(recent))) {
    made = await fromLibrary(plan, env, expectation, skillName, offlineOnly, now);
  }
  made ??= offlineOnly
    ? offlineMade(plan, avoidTitles)
    : await freshlyMade(plan, env, expectation, skillName, avoidTitles, options, now);

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

// ---------------------------------------------------------------------------
// The queue: stale items, picking, filling
// ---------------------------------------------------------------------------

function isStale(item: ChallengeRecord, env: Env, states: ReadonlyMap<string, SkillState>): boolean {
  if (strandDisabled(env.controls, item.strand)) return true;
  if (item.mode === 'mission' && !env.controls.realWorldMissions) return true;
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

/** Discards the queued challenges that went stale and returns the rest, oldest first. */
async function freshQueue(env: Env): Promise<ChallengeRecord[]> {
  const childId = env.child.id;
  const [queued, stateRows] = await Promise.all([
    db.challenges.where('[childId+status]').equals([childId, 'queued']).toArray(),
    db.skillStates.where('childId').equals(childId).toArray(),
  ]);
  const states = new Map(stateRows.map((state) => [state.skillId, state]));
  const stale = queued.filter((item) => isStale(item, env, states));
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

/** What the child asked for, with everything a parent switched off (or that is not a real value) taken out. */
interface Request {
  mode?: Mode;
  strand?: Strand;
  idea?: string;
}

function readRequest(opts: { mode?: Mode; strand?: Strand; idea?: string }, env: Env): Request {
  const request: Request = {};
  const mode = (MODES as readonly unknown[]).includes(opts.mode) ? opts.mode : undefined;
  // A plain quest is ordinary play. A mission is ordinary play too while missions are switched off.
  if (mode && mode !== 'quest' && !(mode === 'mission' && !env.controls.realWorldMissions)) request.mode = mode;
  const strand = (STRANDS as readonly unknown[]).includes(opts.strand) ? opts.strand : undefined;
  if (strand && !strandDisabled(env.controls, strand)) request.strand = strand;
  if (typeof opts.idea === 'string') request.idea = opts.idea;
  return request;
}

function fitsRequest(item: Pick<ChallengeRecord, 'mode' | 'strand'>, request: Request): boolean {
  if (request.mode !== undefined && item.mode !== request.mode) return false;
  if (request.strand !== undefined && item.strand !== request.strand) return false;
  return true;
}

const PURPOSE_ORDER: Partial<Record<ChallengeRecord['purpose'], number>> = { check: 0, sibling: 1 };

/** The queued challenge to serve next: concept checks first, then siblings, then the oldest. */
async function pickQueued(env: Env, request: Request): Promise<ChallengeRecord | undefined> {
  const queue = (await freshQueue(env)).filter((item) => fitsRequest(item, request));
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
      const [plan] = await planNext(childId, 1, planOptions());
      if (!plan) return false;
      // With the AI budget spent, stop asking: the offline bank fills the rest at once.
      await buildChallenge(plan, env, { status: 'queued', offlineOnly: budgetRefusals > 1 });
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

  const [planned] = await planNext(env.child.id, 1, planOptions('story', request.strand));
  if (!planned) throw new Error('The planner returned no plan');
  // The story's theme joins the plan only when it is one of the known themes; the chapter text carries the rest.
  const known = [...env.context.interests, ...FALLBACK_THEMES].some((theme) => theme.toLowerCase() === story.theme.toLowerCase());
  const plan: ChallengePlan = { ...planned, mode: 'story', theme: known ? story.theme : planned.theme };

  const record = await buildChallenge(plan, env, {
    status: 'active',
    story: {
      id: story.id,
      chapterIndex,
      context: { title: story.title, heading: chapter.heading, narrative: chapter.narrative, illustration },
    },
  });
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

async function studioCanvas(env: Env, request: Request): Promise<ChallengeRecord> {
  const [planned] = await planNext(env.child.id, 1, planOptions('studio', request.strand));
  if (!planned) throw new Error('The planner returned no plan');
  const idea = safeIdea(request.idea, env.context.strictness);
  // Without a usable idea the canvas is about the child's first interest.
  const fallback = env.context.interests[0] ?? FALLBACK_THEMES[0] ?? 'animals';
  const plan: ChallengePlan = { ...planned, mode: 'studio', theme: idea ? planned.theme : fallback };
  return buildChallenge(plan, env, { status: 'active', studioIdea: idea ?? fallback });
}

// ---------------------------------------------------------------------------
// Taking the next challenge
// ---------------------------------------------------------------------------

async function takeNextNow(childId: string, opts: { mode?: Mode; strand?: Strand; idea?: string }): Promise<ChallengeRecord> {
  const env = await loadEnv(childId);
  const request = readRequest(opts, env);

  // 1. No skipping: an unfinished challenge that fits what was asked for comes back first.
  const active = await db.challenges.where('[childId+status]').equals([childId, 'active']).toArray();
  const resumed = active
    // A story has one challenge per chapter: an unfinished chapter comes back whatever strand was asked for.
    .filter((item) => (request.mode === 'story' ? item.mode === 'story' : fitsRequest(item, request)))
    .sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt))[0];
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
    let queued = await pickQueued(env, request);
    if (!queued && request.mode === undefined && request.strand === undefined) {
      // A top-up is already making a challenge: waiting for it is quicker than starting another.
      const underway = tails.get(buildKey(childId));
      if (underway) {
        await underway;
        queued = await pickQueued(env, request);
      }
    }
    if (queued) record = await activate(queued.id);
    // 3. Nothing ready: make one now, so the child never waits on a missing queue.
    if (!record) {
      const [plan] = await planNext(childId, 1, planOptions(request.mode, request.strand));
      if (!plan) throw new Error('The planner returned no plan');
      record = await buildChallenge(plan, env, { status: 'active' });
    }
  }
  void ensureQueue(childId);
  return record;
}

/**
 * The challenge the child plays next, already marked `active`.
 *
 * - An active challenge that fits the request (no mode and strand asked for, or
 *   the same ones) is returned again: there is no skipping. An active challenge
 *   that does not fit stays active and comes back on the next plain request.
 * - Otherwise the queue is used: concept checks first, then siblings, then the
 *   oldest, after stale items were discarded.
 * - Otherwise one is built now. Story mode serves the next chapter of the
 *   child's story; studio mode draws the child's idea when it is suitable.
 *
 * `mode: 'quest'` means ordinary play, like no mode. Calls for one child run
 * one after the other, so two callers never get two different new challenges.
 * Rejects only when the child does not exist.
 */
export function takeNext(childId: string, opts: { mode?: Mode; strand?: Strand; idea?: string } = {}): Promise<ChallengeRecord> {
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
      return buildChallenge(makeSiblingPlan(previous), env, {
        status: 'queued',
        previousQuestion: previous.content.question,
      });
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
      const plans = await planNext(childId, CHECK_LOOKAHEAD, planOptions());
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
  deps = DEFAULT_DEPS;
}
