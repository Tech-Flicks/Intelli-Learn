/**
 * Helpers for the progression module's own unit tests. Not part of the public
 * API and not imported by application code.
 */
import { DEFAULT_ACCESSIBILITY, DEFAULT_CONTROLS } from '@/core/defaults';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { getSkill } from '@/core/skills';
import type {
  AnswerEvent,
  AttemptOutcome,
  AttemptResult,
  ChallengePlan,
  ChallengeRecord,
  ChildProfile,
  ParentalControls,
  SkillState,
} from '@/core/types';
import { db } from '@/data';
import { newSkillState } from './mastery';
import { recordAttempt, type RecordAttemptInput } from './record';

/** Monday 9 November 2026, 10:00 local time. */
export const MONDAY = new Date(2026, 10, 9, 10, 0, 0).getTime();
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** Gives each test a brand-new, empty database. */
export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}

let childCounter = 0;

export function childProfile(patch: Partial<ChildProfile> = {}): ChildProfile {
  childCounter += 1;
  return {
    id: `child_${childCounter}`,
    nickname: 'Tester',
    avatar: '🦊',
    ageGroup: '6-8',
    grade: '2',
    interests: ['space', 'animals', 'robots'],
    accessibility: { ...DEFAULT_ACCESSIBILITY },
    controlsOverride: {},
    placementDone: true,
    companion: { species: 'fox', name: '', growth: 0, xp: 0 },
    stars: 0,
    totalStars: 0,
    collectibles: [],
    voiceRate: 0.9,
    streakDays: 0,
    lastPlayedDay: null,
    createdAt: MONDAY - DAY,
    ...patch,
  };
}

/** Stores a child profile. Placement is already done unless the patch says otherwise. */
export async function addChild(patch: Partial<ChildProfile> = {}): Promise<ChildProfile> {
  const child = childProfile(patch);
  await db.children.put(child);
  return child;
}

export function controls(patch: Partial<ParentalControls> = {}): ParentalControls {
  return { ...DEFAULT_CONTROLS, strands: { ...DEFAULT_CONTROLS.strands }, ...patch };
}

export function sampleContent(title = 'Count the stars'): Challenge {
  return ChallengeSchema.parse({
    title,
    intro: 'Three stars twinkle over the hill.',
    question: 'How many stars can you see?',
    readAloud: 'Three stars twinkle over the hill. How many stars can you see?',
    interaction: { kind: 'number', answer: 3 },
    hints: ['Count slowly.', 'Point at each star as you count.'],
    walkthrough: ['Point at the first star.', 'Count on: one, two, three.'],
    explanation: 'There are three stars, so the answer is 3.',
    scene: { theme: 'space', objects: [{ id: 'star-1', type: 'emoji', emoji: '⭐', x: 20, y: 20 }] },
  });
}

let challengeCounter = 0;

/** An unsaved challenge record for the child. The strand follows the skill. */
export function challengeFor(childId: string, patch: Partial<ChallengeRecord> = {}): ChallengeRecord {
  challengeCounter += 1;
  const skillId = patch.skillId ?? 'math-addition-subtraction';
  return {
    id: `ch_${challengeCounter}`,
    childId,
    skillId,
    strand: getSkill(skillId)?.strand ?? 'math',
    stage: 12,
    interaction: 'choice',
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
    content: sampleContent(),
    source: 'offline',
    status: 'queued',
    storyId: null,
    chapterIndex: null,
    libraryId: null,
    parentRating: null,
    parentNote: '',
    createdAt: MONDAY,
    startedAt: null,
    completedAt: null,
    ...patch,
  };
}

export function challengeFromPlan(plan: ChallengePlan, patch: Partial<ChallengeRecord> = {}): ChallengeRecord {
  return challengeFor(plan.childId, { ...plan, ...patch });
}

export function right(at: number): AnswerEvent {
  return { at, answer: 3, correct: true, misconception: null };
}

export function wrong(at: number): AnswerEvent {
  return { at, answer: 0, correct: false, misconception: null };
}

/** The attempt details that produce the given outcome. Wrong tries are 20 seconds apart. */
export function attemptDetails(
  outcome: AttemptOutcome,
  now: number,
  wrongCount = outcome === 'second-try' ? 1 : 0,
): Pick<RecordAttemptInput, 'answers' | 'hintsUsed' | 'walkthroughUsed'> {
  const answers: AnswerEvent[] = [];
  for (let i = wrongCount; i > 0; i -= 1) answers.push(wrong(now - i * 20_000));
  answers.push(right(now));
  return {
    answers,
    hintsUsed: outcome === 'nudge' ? 1 : outcome === 'hint' || outcome === 'walkthrough' ? 2 : 0,
    walkthroughUsed: outcome === 'walkthrough',
  };
}

export interface SolveOptions {
  outcome?: AttemptOutcome;
  now?: number;
  teachBack?: boolean | null;
  wrongCount?: number;
  challenge?: Partial<ChallengeRecord>;
}

/** Stores a challenge for the child and records a solved attempt on it. */
export async function solve(childId: string, opts: SolveOptions = {}): Promise<AttemptResult> {
  const now = opts.now ?? MONDAY;
  const outcome = opts.outcome ?? 'independent';
  const challenge = challengeFor(childId, opts.challenge);
  await db.challenges.put(challenge);
  return recordAttempt({
    challenge,
    ...attemptDetails(outcome, now, opts.wrongCount),
    teachBackCorrect: opts.teachBack ?? null,
    timeMs: 30_000,
    now,
  });
}

/** A practised skill state at the given stage. The strand follows the skill. */
export function stateFor(childId: string, skillId: string, stage: number, patch: Partial<SkillState> = {}): SkillState {
  const strand = getSkill(skillId)?.strand ?? 'math';
  return {
    ...newSkillState(childId, skillId, strand, stage),
    attempts: 4,
    mastery: 30,
    lastPracticedAt: MONDAY - DAY,
    ...patch,
  };
}

/** A rng that replays the given values, then keeps returning the last one. */
export function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}
