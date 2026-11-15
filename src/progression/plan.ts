/**
 * Item selection: decides what the child should work on next.
 *
 * `planFromContext` is the pure planner. `planNext` loads what it needs from
 * the database and calls it. The planner never talks to the AI: it returns
 * `ChallengePlan`s (skill, stage, interaction, mode, purpose, theme) that the
 * supply queue turns into challenges.
 *
 * Order of priority for each plan:
 *   1. placement items while the first-session game is running
 *   2. concept checks for skills that are ready to move up
 *   3. spaced reviews that are due
 *   4. the regular mix: mostly the current stage, some review, a little stretch
 * Reviews of both kinds together are at most one item in five.
 */
import Dexie from 'dexie';
import { gradeAt, gradeIndex, makeStage, stageGrade, stageGradeIndex } from '@/core/grades';
import { clampStageToSkill, getSkill, SKILLS, skillExistsAt, skillGrades, skillsForStrand } from '@/core/skills';
import { STRANDS } from '@/core/types';
import type {
  AgeGroup,
  ChallengePlan,
  ChallengeRecord,
  ChildProfile,
  InteractionKind,
  ItemPurpose,
  Mode,
  ParentalControls,
  SkillDef,
  SkillState,
  StageValue,
  Strand,
} from '@/core/types';
import { db, getSettings } from '@/data';
import { effectiveControls, enabledStrands } from './limits';
import { aggregateStrandStage, clampToSkill, isTopStage, stepDown, stepUp } from './mastery';
import {
  estimateFor,
  placementStrand,
  readPlacement,
  runningPlacement,
  type PlacementState,
} from './placement';
import { chance, getRng, pickFrontWeighted, pickOne, type Rng } from './rng';
import { TUNING } from './tuning';

export interface PlanOptions {
  /** A mode the child started. The plan then uses a skill that suits the mode. */
  mode?: Mode;
  /** Stay inside this strand, when the parent has it enabled. */
  strand?: Strand;
  now?: number;
  /** Random source for this call. Defaults to the module-level one (see `setRng`). */
  rng?: Rng;
  /**
   * Skills whose concept check cannot be built right now (the supply has nothing new about them).
   * No check is planned for them; they wait, and the child goes on with other skills.
   */
  withoutChecks?: readonly string[];
}

/** What the planner needs to know about a challenge that was planned earlier. */
export type TrailItem = Pick<ChallengePlan, 'skillId' | 'strand' | 'interaction' | 'purpose'>;

export interface PlannerContext {
  child: Pick<ChildProfile, 'id' | 'grade' | 'ageGroup' | 'interests' | 'placementDone'>;
  controls: ParentalControls;
  /** Every skill state of the child. */
  states: readonly SkillState[];
  /** The stored placement state, or null. */
  placement: PlacementState | null;
  /** Recently completed challenges, oldest first. */
  recent: readonly TrailItem[];
  /** Queued and active challenges, oldest first. */
  pending: readonly TrailItem[];
  /** How many challenges were ever created for the child. Rotates the theme. */
  challengeCount: number;
  now: number;
  rng: Rng;
}

/** Themes used when the child has no interests set. */
export const FALLBACK_THEMES: readonly string[] = ['animals', 'space', 'nature', 'building', 'ocean', 'music'];

/** Interaction kinds that work without reading or typing, preferred for ages 3-5. */
export const YOUNG_KINDS: readonly InteractionKind[] = ['tap', 'choice', 'sort', 'match', 'order'];

/** Modes that are only ever started by the child, never picked automatically. */
const CHILD_STARTED_MODES: readonly Mode[] = ['studio', 'story', 'mission'];

const REPORT_KINDS: readonly InteractionKind[] = ['choice', 'number', 'order'];

/** Interaction kinds a mode calls for. Modes not listed take any kind that suits the skill. */
const MODE_KINDS: Partial<Record<Mode, readonly InteractionKind[]>> = {
  robot: ['robot'],
  invention: ['build'],
  experiment: REPORT_KINDS,
  detective: REPORT_KINDS,
  fixbot: REPORT_KINDS,
  wonder: REPORT_KINDS,
  mission: ['choice', 'number'],
};

/** The interaction kinds to choose from for this skill, mode and age group, best first. */
export function kindsFor(skill: SkillDef, mode: Mode, ageGroup: AgeGroup): InteractionKind[] {
  if (mode === 'robot') return ['robot'];
  if (mode === 'invention') return ['build'];
  let kinds: InteractionKind[] = skill.interactions.length > 0 ? [...skill.interactions] : ['choice'];
  const wanted = MODE_KINDS[mode];
  if (wanted) {
    const fitting = kinds.filter((kind) => wanted.includes(kind));
    kinds = fitting.length > 0 ? fitting : [wanted[0] ?? 'choice'];
  }
  if (ageGroup === '3-5') {
    const young = kinds.filter((kind) => YOUNG_KINDS.includes(kind));
    if (young.length > 0) kinds = young;
  }
  return kinds;
}

function skillSuitsMode(skill: SkillDef, mode: Mode | undefined): boolean {
  return mode === undefined || mode === 'quest' || skill.modes.includes(mode);
}

/** Sort order for skill states: least recently practised first, never-practised before everything. */
function byLeastRecent(a: SkillState, b: SkillState): number {
  return (a.lastPracticedAt ?? 0) - (b.lastPracticedAt ?? 0);
}

/**
 * Plans `count` items from a snapshot of the child's data. Pure apart from
 * the injected rng.
 */
export function planFromContext(
  ctx: PlannerContext,
  count: number,
  opts: { mode?: Mode; strand?: Strand; withoutChecks?: readonly string[] } = {},
): ChallengePlan[] {
  const { child, rng } = ctx;
  const P = TUNING.plan;
  const wanted = Math.max(0, Math.floor(count));

  const enabled = enabledStrands(ctx.controls);
  const scope: Strand[] = opts.strand && enabled.includes(opts.strand) ? [opts.strand] : enabled;
  // A real-world mission is only planned when the parent allows them.
  const requestedMode: Mode | undefined =
    opts.mode === 'mission' && !ctx.controls.realWorldMissions ? undefined : opts.mode;

  const themes = child.interests.length > 0 ? child.interests : FALLBACK_THEMES;
  const stateBySkill = new Map(ctx.states.map((state) => [state.skillId, state]));
  const baseStage = makeStage(child.grade, 'starting');
  const aggregates = new Map<Strand, StageValue | null>(
    STRANDS.map((strand) => [strand, aggregateStrandStage(ctx.states, strand).stage]),
  );

  const plans: ChallengePlan[] = [];
  const trail: TrailItem[] = [...ctx.recent, ...ctx.pending];
  const lastCompleted = ctx.recent[ctx.recent.length - 1]?.skillId ?? null;
  /** Skills that are queued, active or already chosen in this call. */
  const taken = new Set(ctx.pending.map((item) => item.skillId));
  const chosen = new Set<string>();
  const pendingChecks = new Set(ctx.pending.filter((item) => item.purpose === 'check').map((item) => item.skillId));
  const withoutChecks = new Set(opts.withoutChecks ?? []);

  /** The strand's working stage: its aggregate, else the placement estimate, else the enrolled grade. */
  const strandStage = (strand: Strand): StageValue =>
    aggregates.get(strand) ?? ctx.placement?.estimates[strand] ?? baseStage;

  const add = (plan: ChallengePlan): void => {
    plans.push(plan);
    trail.push(plan);
    taken.add(plan.skillId);
    chosen.add(plan.skillId);
  };

  const nextTheme = (): string => themes[(ctx.challengeCount + plans.length) % themes.length] ?? 'animals';
  const previousKind = (): InteractionKind | undefined => trail[trail.length - 1]?.interaction;

  /** Front-weighted choice that does not repeat the previous plan's kind when there is another. */
  const pickKind = (kinds: readonly InteractionKind[]): InteractionKind => {
    const previous = previousKind();
    const others = kinds.filter((kind) => kind !== previous);
    return pickFrontWeighted(rng, others.length > 0 ? others : kinds) ?? 'choice';
  };

  const modeFor = (skill: SkillDef): Mode => {
    if (requestedMode) return requestedMode;
    if (chance(rng, P.questShare)) return 'quest';
    const options = skill.modes.filter((mode) => {
      if (mode === 'quest' || CHILD_STARTED_MODES.includes(mode)) return false;
      // Robot and invention force kinds the youngest children are not offered by default.
      if (child.ageGroup === '3-5' && (mode === 'robot' || mode === 'invention')) return false;
      return true;
    });
    return pickOne(rng, options) ?? 'quest';
  };

  const makePlan = (skill: SkillDef, purpose: ItemPurpose, stage: StageValue): ChallengePlan => {
    const mode = modeFor(skill);
    return {
      childId: child.id,
      skillId: skill.id,
      strand: skill.strand,
      stage,
      interaction: pickKind(kindsFor(skill, mode, child.ageGroup)),
      mode,
      purpose,
      theme: nextTheme(),
    };
  };

  // ---- 1. placement ------------------------------------------------------

  const planPlacement = (state: PlacementState, slot: number): ChallengePlan | null => {
    const strand = placementStrand(slot, enabled);
    const estimate = estimateFor(state, child.grade, strand);
    const grade = stageGrade(estimate);
    const attempted = new Set(state.attempted.map((note) => note.skillId));
    const all = skillsForStrand(strand);
    const unused = all.filter((skill) => !attempted.has(skill.id) && !taken.has(skill.id));
    // Prefer skills that also exist one grade below and above the estimate, so the result is not
    // cut short by a skill that ends (or only starts) at this grade.
    const index = gradeIndex(grade);
    const around = [gradeAt(index - 1), grade, gradeAt(index + 1)];
    const fitting = (pool: readonly SkillDef[]): SkillDef[] => {
      const roomy = pool.filter((skill) => around.every((g) => skillExistsAt(skill, g)));
      return roomy.length > 0 ? roomy : pool.filter((skill) => skillExistsAt(skill, grade));
    };
    // A skill that is not taught at the estimate's grade would be asked at another grade, which
    // tells little about the estimate. With few subjects switched on a strand gets more items
    // than it has such skills: asking a fitting skill a second time is better then.
    const timesAsked = (skill: SkillDef): number => state.attempted.filter((note) => note.skillId === skill.id).length;
    const candidates = ([fitting(unused), fitting(all), unused, all].find((list) => list.length > 0) ?? all)
      .slice()
      .sort((a, b) => timesAsked(a) - timesAsked(b));
    // Foundational skills (no prerequisites) make the fairest first questions.
    const basics = candidates.filter((skill) => skill.prerequisites.length === 0);
    const skill = pickFrontWeighted(rng, (basics.length > 0 ? basics : candidates).slice(0, 3));
    if (!skill) return null;
    const kinds = kindsFor(skill, 'quest', child.ageGroup);
    // Keep the first session quick and comparable: no robot programs or builds when there is another way.
    const quick = kinds.filter((kind) => kind !== 'robot' && kind !== 'build');
    return {
      childId: child.id,
      skillId: skill.id,
      strand,
      stage: clampStageToSkill(skill, estimate),
      interaction: pickKind(quick.length > 0 ? quick : kinds),
      mode: 'quest',
      purpose: 'placement',
      theme: nextTheme(),
    };
  };

  if (!child.placementDone && requestedMode === undefined) {
    const state = runningPlacement(ctx.placement);
    let slot = state.answered + ctx.pending.filter((item) => item.purpose === 'placement').length;
    while (plans.length < wanted && slot < TUNING.placement.totalItems) {
      const plan = planPlacement(state, slot);
      if (!plan) break;
      add(plan);
      slot += 1;
    }
  }

  // ---- 2. concept checks -------------------------------------------------

  const planCheck = (): ChallengePlan | null => {
    const ready = ctx.states
      .filter((state) => state.checkPending && scope.includes(state.strand))
      .filter((state) => !pendingChecks.has(state.skillId) && !chosen.has(state.skillId))
      .filter((state) => !withoutChecks.has(state.skillId))
      .sort(byLeastRecent);
    for (const state of ready) {
      const skill = getSkill(state.skillId);
      if (!skill || !skillSuitsMode(skill, requestedMode)) continue;
      let mode: Mode = requestedMode ?? 'quest';
      let kinds = kindsFor(skill, mode, child.ageGroup);
      // A mode with one format only (Robot Coder is always a robot program) cannot test the idea in
      // another way than the practice did. The check is a plain quest then, where the skill offers more.
      if (mode !== 'quest' && kinds.length === 1 && kinds[0] === state.recentInteractions[0]) {
        const plain = kindsFor(skill, 'quest', child.ageGroup);
        if (plain.some((kind) => kind !== kinds[0])) {
          mode = 'quest';
          kinds = plain;
        }
      }
      // Test the same idea in a different format from the recent items, where the skill offers one.
      const unseen = kinds.filter((kind) => !state.recentInteractions.includes(kind));
      const notLatest = kinds.filter((kind) => kind !== state.recentInteractions[0]);
      const pool = unseen.length > 0 ? unseen : notLatest.length > 0 ? notLatest : kinds;
      return {
        childId: child.id,
        skillId: skill.id,
        strand: skill.strand,
        stage: clampToSkill(skill, state.stage),
        interaction: pickFrontWeighted(rng, pool) ?? 'choice',
        mode,
        purpose: 'check',
        theme: nextTheme(),
      };
    }
    return null;
  };

  /**
   * A skill that ended at a lower grade than the strand has reached: it is at its own top stage
   * (so there is no check to work towards) and its grade is behind the strand's. More practice
   * on it teaches nothing; its spaced reviews keep it fresh.
   */
  const isOutgrown = (skill: SkillDef): boolean => {
    const state = stateBySkill.get(skill.id);
    if (!state || !isTopStage(skill, state.stage)) return false;
    return stageGradeIndex(state.stage) < stageGradeIndex(strandStage(skill.strand));
  };

  // ---- 3. reviews --------------------------------------------------------

  const isDue = (state: SkillState): boolean => state.reviewDueAt !== null && state.reviewDueAt <= ctx.now;

  const reviewPlan = (state: SkillState, skill: SkillDef): ChallengePlan =>
    // A due spaced review re-tests the step that was mastered when it was scheduled: one below the current one.
    makePlan(skill, 'review', isDue(state) ? stepDown(skill, state.stage) : clampToSkill(skill, state.stage));

  const reviewable = (blocked: (skillId: string) => boolean): { state: SkillState; skill: SkillDef }[] => {
    const rows: { state: SkillState; skill: SkillDef }[] = [];
    for (const state of ctx.states) {
      if (state.attempts <= 0 || state.checkPending || !scope.includes(state.strand)) continue;
      if (blocked(state.skillId)) continue;
      const skill = getSkill(state.skillId);
      if (skill && skillSuitsMode(skill, requestedMode)) rows.push({ state, skill });
    }
    return rows;
  };

  const planDueReview = (): ChallengePlan | null => {
    const due = reviewable((id) => taken.has(id) || id === lastCompleted)
      .filter((row) => isDue(row.state))
      .sort((a, b) => (a.state.reviewDueAt ?? 0) - (b.state.reviewDueAt ?? 0));
    const first = due[0];
    return first ? reviewPlan(first.state, first.skill) : null;
  };

  const planPractiseReview = (): ChallengePlan | null => {
    // A skill the child has outgrown only comes back for its spaced reviews.
    const rows = reviewable((id) => taken.has(id) || id === lastCompleted).filter(
      (row) => isDue(row.state) || !isOutgrown(row.skill),
    );
    if (rows.length === 0) return null;
    const previousStrand = trail[trail.length - 1]?.strand;
    const elsewhere = rows.filter((row) => row.state.strand !== previousStrand);
    const pool = (elsewhere.length > 0 ? elsewhere : rows).sort((a, b) => {
      const dueFirst = Number(isDue(b.state)) - Number(isDue(a.state));
      return dueFirst !== 0 ? dueFirst : byLeastRecent(a.state, b.state);
    });
    const row = pickFrontWeighted(rng, pool.slice(0, 4));
    return row ? reviewPlan(row.state, row.skill) : null;
  };

  // ---- 4. core and stretch ----------------------------------------------

  /** The scope's strands starting after the previous item's strand, so consecutive plans differ. */
  const strandsInRotation = (): Strand[] => {
    const previousStrand = trail[trail.length - 1]?.strand;
    const start = previousStrand ? STRANDS.indexOf(previousStrand) + 1 : 0;
    return [...STRANDS.slice(start), ...STRANDS.slice(0, start)].filter((strand) => scope.includes(strand));
  };

  /**
   * A skill the child has no state for may be introduced when it has no
   * prerequisites, or the strand is already above the skill's entry grade, or
   * every prerequisite is at least 'growing' at the grade the skill would start at.
   */
  const isEligible = (skill: SkillDef): boolean => {
    if (skill.prerequisites.length === 0) return true;
    const working = strandStage(skill.strand);
    const entryGrade = skillGrades(skill)[0];
    if (entryGrade !== undefined && stageGradeIndex(working) > gradeIndex(entryGrade)) return true;
    const startGrade = stageGrade(clampStageToSkill(skill, working));
    return skill.prerequisites.every((id) => {
      const prerequisite = getSkill(id);
      if (!prerequisite) return true;
      const state = stateBySkill.get(id);
      if (!state || state.attempts <= 0) return false;
      return state.stage >= clampStageToSkill(prerequisite, makeStage(startGrade, 'growing'));
    });
  };

  const pickFresh = (skills: readonly SkillDef[], strand: Strand): SkillDef | undefined => {
    const grade = stageGrade(strandStage(strand));
    const atGrade = skills.filter((skill) => skillExistsAt(skill, grade));
    return pickFrontWeighted(rng, (atGrade.length > 0 ? atGrade : skills).slice(0, 3));
  };

  /**
   * Half of the time the skill closest to its next concept check (so a skill is
   * seen often enough to build a run), otherwise front-weighted towards the
   * skills that were practised longest ago (so nothing is forgotten).
   */
  const pickPractised = (skills: readonly SkillDef[]): SkillDef | undefined => {
    if (skills.length <= 1) return skills[0];
    const stateOf = (skill: SkillDef): SkillState | undefined => stateBySkill.get(skill.id);
    const leastRecentFirst = [...skills].sort((a, b) => {
      const stateA = stateOf(a);
      const stateB = stateOf(b);
      return stateA && stateB ? byLeastRecent(stateA, stateB) : 0;
    });
    if (chance(rng, P.focusChance)) {
      // A skill at its top stage has no next check to work towards.
      const climbing = leastRecentFirst.filter((skill) => !isTopStage(skill, stateOf(skill)?.stage ?? 0));
      // The sort is stable, so equal mastery keeps the least recently practised skill in front.
      const closest = climbing.sort((a, b) => (stateOf(b)?.mastery ?? 0) - (stateOf(a)?.mastery ?? 0))[0];
      if (closest) return closest;
    }
    return pickFrontWeighted(rng, leastRecentFirst);
  };

  const planInStrand = (
    strand: Strand,
    purpose: 'core' | 'stretch',
    blocked: (skillId: string) => boolean,
    respectMode: boolean,
    allowCheckPending: boolean,
  ): ChallengePlan | null => {
    const skills = skillsForStrand(strand).filter(
      (skill) => !blocked(skill.id) && (!respectMode || skillSuitsMode(skill, requestedMode)),
    );
    const practised = skills.filter((skill) => {
      const state = stateBySkill.get(skill.id);
      if (state === undefined) return false;
      // The last resort takes anything, so that the planner always has an answer.
      if (allowCheckPending) return true;
      // A skill waiting for its concept check gets the check next, not more practice.
      return !state.checkPending && !isOutgrown(skill);
    });
    const fresh = skills.filter((skill) => !stateBySkill.has(skill.id));
    const eligible = fresh.filter(isEligible);

    if (purpose === 'stretch') {
      const stretchable = practised.filter((skill) => {
        const state = stateBySkill.get(skill.id);
        if (!state || state.attempts <= 0 || isTopStage(skill, state.stage)) return false;
        // A stretch is for a child who is doing well on the skill: the last item on it was solved
        // without any help, and there is some mastery to build on.
        return state.mastery >= P.stretchMinMastery && state.independentStreak >= 1;
      });
      const skill = pickPractised(stretchable);
      const state = skill ? stateBySkill.get(skill.id) : undefined;
      if (skill && state) return makePlan(skill, 'stretch', stepUp(skill, state.stage));
      // Nothing to stretch in this strand yet: plan a regular item instead.
    }

    // Do not open many skills at once: wait while several are still new to the child.
    const settling = practised.filter((skill) => (stateBySkill.get(skill.id)?.attempts ?? 0) < P.settledAfterAttempts);
    const roomForNew = settling.length < P.maxSettlingSkills;
    const introduce =
      eligible.length > 0 && (practised.length === 0 || (roomForNew && chance(rng, P.newSkillChance)));
    if (introduce) {
      const skill = pickFresh(eligible, strand);
      if (skill) return makePlan(skill, 'core', clampStageToSkill(skill, strandStage(strand)));
    }
    const known = pickPractised(practised);
    const knownState = known ? stateBySkill.get(known.id) : undefined;
    if (known && knownState) return makePlan(known, 'core', clampToSkill(known, knownState.stage));
    // Only gated skills are left: start with the most basic one rather than nothing.
    const fallback = pickFresh(fresh, strand);
    if (fallback) return makePlan(fallback, 'core', clampStageToSkill(fallback, strandStage(strand)));
    return null;
  };

  const planCoreOrStretch = (purpose: 'core' | 'stretch'): ChallengePlan => {
    const order = strandsInRotation();
    // Avoidance is relaxed one notch at a time until something fits.
    const tiers: ((skillId: string) => boolean)[] = [
      (id) => taken.has(id) || id === lastCompleted,
      (id) => taken.has(id),
      (id) => chosen.has(id),
      () => false,
    ];
    for (const respectMode of [true, false]) {
      for (const [tier, blocked] of tiers.entries()) {
        for (const strand of order) {
          const plan = planInStrand(strand, purpose, blocked, respectMode, tier === tiers.length - 1);
          if (plan) return plan;
        }
      }
    }
    // Unreachable while every strand has skills; kept so the planner always answers.
    const skill = SKILLS.find((candidate) => scope.includes(candidate.strand)) ?? SKILLS[0];
    if (!skill) throw new Error('The skill map is empty');
    return makePlan(skill, 'core', clampStageToSkill(skill, strandStage(skill.strand)));
  };

  const planRegular = (): ChallengePlan => {
    const check = planCheck();
    if (check) return check;

    // At most one review in `atMostOneIn` items, whichever kind of review it is: a due one, or
    // one from the regular mix. A due review takes the slot first, so due reviews are part of
    // the review share and never come on top of it.
    const window = trail.slice(-(TUNING.review.atMostOneIn - 1));
    const reviewAllowed = !window.some((item) => item.purpose === 'review');
    if (reviewAllowed) {
      const due = planDueReview();
      if (due) return due;
    }

    const roll = rng();
    if (roll >= P.coreShare && roll < P.coreShare + P.reviewShare) {
      const review = reviewAllowed ? planPractiseReview() : null;
      if (review) return review;
      return planCoreOrStretch('core');
    }
    return planCoreOrStretch(roll < P.coreShare ? 'core' : 'stretch');
  };

  while (plans.length < wanted) add(planRegular());
  return plans;
}

function toTrail(row: ChallengeRecord): TrailItem {
  return { skillId: row.skillId, strand: row.strand, interaction: row.interaction, purpose: row.purpose };
}

/**
 * The next `count` items for the child, as distinct plans. Looks at the
 * child's skill states, what is already queued and what was just played.
 */
export async function planNext(childId: string, count: number = 1, opts: PlanOptions = {}): Promise<ChallengePlan[]> {
  const child = await db.children.get(childId);
  if (!child) throw new Error(`Child profile not found: ${childId}`);
  const controls = effectiveControls(await getSettings(), child);

  const [states, pendingRows, recentRows, placement, challengeCount] = await Promise.all([
    db.skillStates.where('childId').equals(childId).toArray(),
    db.challenges
      .where('[childId+status]')
      .anyOf([
        [childId, 'queued'],
        [childId, 'active'],
      ])
      .toArray(),
    db.challenges
      .where('[childId+completedAt]')
      .between([childId, Dexie.minKey], [childId, Dexie.maxKey])
      .reverse()
      .limit(TUNING.plan.recentWindow)
      .toArray(),
    readPlacement(childId),
    db.challenges.where('childId').equals(childId).count(),
  ]);

  return planFromContext(
    {
      child,
      controls,
      states,
      placement,
      recent: recentRows
        .filter((row) => row.status === 'completed')
        .reverse()
        .map(toTrail),
      pending: pendingRows.sort((a, b) => a.createdAt - b.createdAt).map(toTrail),
      challengeCount,
      now: opts.now ?? Date.now(),
      rng: opts.rng ?? getRng(),
    },
    count,
    { mode: opts.mode, strand: opts.strand, withoutChecks: opts.withoutChecks },
  );
}

/**
 * The easier follow-up after a walkthrough: same skill, same interaction and
 * theme, one stage step lower (never below the skill's lowest stage).
 * Story, studio and mission items need context only the child's own launch
 * provides, so their sibling is a plain quest.
 */
export function makeSiblingPlan(previous: ChallengeRecord): ChallengePlan {
  const skill = getSkill(previous.skillId);
  const mode: Mode = CHILD_STARTED_MODES.includes(previous.mode) ? 'quest' : previous.mode;
  return {
    childId: previous.childId,
    skillId: previous.skillId,
    strand: previous.strand,
    stage: stepDown(skill, clampToSkill(skill, previous.stage)),
    interaction: previous.interaction,
    mode,
    purpose: 'sibling',
    theme: previous.theme,
  };
}
