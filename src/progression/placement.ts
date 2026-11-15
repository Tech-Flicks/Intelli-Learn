/**
 * Placement: the first-session mini-game that finds a sensible starting stage
 * for each strand.
 *
 * Eight items rotate over the enabled strands. Each strand has an estimate
 * that starts a little below the enrolled grade and moves after every
 * placement item: up fast when the child solves alone, down fast when the
 * walkthrough was needed, and at most two grades either way. The estimates between items live in `db.kv`, one
 * record per child. When the eighth item is done, the skills that were
 * actually attempted are seeded at their strand's estimate.
 */
import { gradeAt, gradeIndex, makeStage, MAX_STAGE, MIN_STAGE } from '@/core/grades';
import { getSkill, skillGrades, skillsForStrand } from '@/core/skills';
import { INTERACTION_KINDS, STRANDS } from '@/core/types';
import type {
  AttemptOutcome,
  ChildProfile,
  Grade,
  InteractionKind,
  SkillState,
  StageValue,
  Strand,
} from '@/core/types';
import { db } from '@/data';
import { clampToSkill, newSkillState } from './mastery';
import { TUNING } from './tuning';

export interface PlacementNote {
  skillId: string;
  strand: Strand;
  interaction: InteractionKind;
  /** The stage the item was pitched at. Missing in a record that was stored before this was kept. */
  stage?: StageValue;
}

export interface PlacementState {
  v: 1;
  /** The estimate each strand started from. */
  start: Partial<Record<Strand, StageValue>>;
  /** The current estimate per strand. */
  estimates: Partial<Record<Strand, StageValue>>;
  /** Placement items completed so far. */
  answered: number;
  /** One entry per completed placement item, oldest first. */
  attempted: PlacementNote[];
}

export function placementKey(childId: string): string {
  return `progression:placement:${childId}`;
}

export function freshPlacement(): PlacementState {
  return { v: 1, start: {}, estimates: {}, answered: 0, attempted: [] };
}

const strandRanges = new Map<Strand, { min: StageValue; max: StageValue }>();

/** The stages covered by the grades where the strand has at least one skill. */
export function strandStageRange(strand: Strand): { min: StageValue; max: StageValue } {
  const cached = strandRanges.get(strand);
  if (cached) return cached;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const skill of skillsForStrand(strand)) {
    for (const grade of skillGrades(skill)) {
      lowest = Math.min(lowest, gradeIndex(grade));
      highest = Math.max(highest, gradeIndex(grade));
    }
  }
  const range = Number.isFinite(lowest)
    ? { min: makeStage(gradeAt(lowest), 'starting'), max: makeStage(gradeAt(highest), 'ready') }
    : { min: MIN_STAGE, max: MAX_STAGE };
  strandRanges.set(strand, range);
  return range;
}

export function clampToStrand(strand: Strand, stage: number): StageValue {
  const { min, max } = strandStageRange(strand);
  return Math.max(min, Math.min(max, Math.round(stage)));
}

/** Where a strand's estimate starts: one grade below the enrolled grade (never below Pre-K), 'growing'. */
export function initialEstimate(grade: Grade, strand: Strand): StageValue {
  const index = Math.max(0, gradeIndex(grade) + TUNING.placement.startGradeOffset);
  return clampToStrand(strand, makeStage(gradeAt(index), TUNING.placement.startStep));
}

export function estimateFor(state: PlacementState, grade: Grade, strand: Strand): StageValue {
  return state.estimates[strand] ?? initialEstimate(grade, strand);
}

/** The strand of the n-th placement item (0-based): the enabled strands in rotation. */
export function placementStrand(slot: number, enabled: readonly Strand[]): Strand {
  const strands = enabled.length > 0 ? enabled : STRANDS;
  return strands[slot % strands.length] ?? 'math';
}

/** The state after one completed placement item. Pure. */
export function applyPlacementAttempt(
  state: PlacementState,
  grade: Grade,
  note: PlacementNote,
  outcome: AttemptOutcome,
): PlacementState {
  const { steps, maxMove, maxItemGap } = TUNING.placement;
  const before = estimateFor(state, grade, note.strand);
  const start = state.start[note.strand] ?? before;
  let move = steps[outcome];
  // A skill that does not exist at the estimate's grade is asked at its nearest grade. Solving an
  // item from far below the estimate shows nothing about a higher level, and needing help on one
  // from far above shows nothing about a lower one.
  const asked = note.stage ?? before;
  if ((move > 0 && asked < before - maxItemGap) || (move < 0 && asked > before + maxItemGap)) move = 0;
  // Eight items can place a child up to two grades from the start, not further: with one subject
  // switched on, all eight go to the same strand.
  const bounded = Math.max(start - maxMove, Math.min(start + maxMove, before + move));
  const after = clampToStrand(note.strand, bounded);
  return {
    v: 1,
    start: { ...state.start, [note.strand]: start },
    estimates: { ...state.estimates, [note.strand]: after },
    answered: state.answered + 1,
    attempted: [...state.attempted, note],
  };
}

export function isPlacementComplete(state: PlacementState): boolean {
  return state.answered >= TUNING.placement.totalItems;
}

/**
 * Skill states for the skills attempted during placement, each at its strand's
 * estimate (clamped to the grades where the skill exists). A state that
 * already exists keeps its history and is moved to the estimate.
 */
export function seedPlacementStates(
  state: PlacementState,
  child: Pick<ChildProfile, 'id' | 'grade'>,
  existing: readonly SkillState[],
  now: number,
): SkillState[] {
  const byId = new Map(existing.map((row) => [row.skillId, row]));
  const seeded = new Map<string, SkillState>();
  for (const note of state.attempted) {
    const stage = clampToSkill(getSkill(note.skillId), estimateFor(state, child.grade, note.strand));
    const base =
      seeded.get(note.skillId) ??
      byId.get(note.skillId) ??
      newSkillState(child.id, note.skillId, note.strand, stage);
    seeded.set(note.skillId, {
      ...base,
      stage,
      mastery: Math.max(base.mastery, TUNING.placement.seedMastery),
      attempts: base.attempts + 1,
      checkPending: false,
      recentInteractions: [note.interaction, ...base.recentInteractions].slice(
        0,
        TUNING.mastery.recentInteractionsKept,
      ),
      lastPracticedAt: now,
    });
  }
  return [...seeded.values()];
}

function isStageMap(value: unknown): value is Partial<Record<Strand, StageValue>> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).every(
    ([strand, stage]) =>
      (STRANDS as readonly string[]).includes(strand) &&
      typeof stage === 'number' &&
      Number.isInteger(stage) &&
      stage >= MIN_STAGE &&
      stage <= MAX_STAGE,
  );
}

/** Accepts only a well-formed stored record. */
export function parsePlacement(value: unknown): PlacementState | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || !isStageMap(record.start) || !isStageMap(record.estimates)) return null;
  if (typeof record.answered !== 'number' || !Number.isInteger(record.answered) || record.answered < 0) return null;
  if (!Array.isArray(record.attempted)) return null;
  const notesOk = record.attempted.every((note: unknown) => {
    if (typeof note !== 'object' || note === null) return false;
    const n = note as Record<string, unknown>;
    return (
      typeof n.skillId === 'string' &&
      (STRANDS as readonly unknown[]).includes(n.strand) &&
      (INTERACTION_KINDS as readonly unknown[]).includes(n.interaction) &&
      (n.stage === undefined ||
        (typeof n.stage === 'number' && Number.isInteger(n.stage) && n.stage >= MIN_STAGE && n.stage <= MAX_STAGE))
    );
  });
  return notesOk ? (value as PlacementState) : null;
}

/** The stored placement state, or null when there is none (or it is not readable). */
export async function readPlacement(childId: string): Promise<PlacementState | null> {
  const stored = await db.kv.get(placementKey(childId));
  return parsePlacement(stored?.value);
}

/**
 * The state to continue from while placement is running: the stored one, or a
 * fresh one when nothing is stored or a parent restarted placement after it
 * had been completed.
 */
export function runningPlacement(stored: PlacementState | null): PlacementState {
  if (!stored || isPlacementComplete(stored)) return freshPlacement();
  return stored;
}

export async function writePlacement(childId: string, state: PlacementState): Promise<void> {
  await db.kv.put({ key: placementKey(childId), value: state });
}

export async function placementStatus(childId: string): Promise<{ done: boolean; answered: number; total: number }> {
  const total = TUNING.placement.totalItems;
  const child = await db.children.get(childId);
  if (!child) throw new Error(`Child profile not found: ${childId}`);
  if (child.placementDone) return { done: true, answered: total, total };
  const state = runningPlacement(await readPlacement(childId));
  return { done: false, answered: Math.min(state.answered, total), total };
}
