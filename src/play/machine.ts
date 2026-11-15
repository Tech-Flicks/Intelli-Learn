/**
 * The rules of one challenge on the play screen, as plain functions.
 *
 * Nothing in this file touches the database, the AI, the voice or React. The
 * session store (`session.ts`) calls these functions to decide what happens
 * next; the tests call them directly.
 *
 * The rules in one place:
 * - There is no way to skip. The only ways forward are solving and the help
 *   ladder: nudge, strong hint, walkthrough. A request moves up one level.
 * - After a walkthrough the child still enters the answer.
 * - Help is offered, never forced.
 */
import type { PipState } from '@/bot';
import { makeStage } from '@/core/grades';
import type { Challenge, Interaction } from '@/core/schemas';
import { SKILLS, skillExistsAt } from '@/core/skills';
import { MODES, STRANDS } from '@/core/types';
import type {
  AnswerEvent,
  AttemptOutcome,
  AttemptRecord,
  AttemptResult,
  ChallengePlan,
  ChallengeRecord,
  ChildProfile,
  Grade,
  ItemPurpose,
  Mode,
  StageValue,
  Strand,
} from '@/core/types';
import type { Answer, CheckResult } from '@/engine';

/** Every number of the play screen's rules. */
export const PLAY = {
  /** Help is offered from this many wrong tries on. */
  offerAfterWrongTries: 2,
  /** "Show me how" appears after this many wrong tries (or after the strong hint). */
  walkthroughAfterWrongTries: 3,
  /** Help is offered after this long without any interaction. */
  idleOfferMs: 45_000,
  /** Play time is counted in ticks of this length ... */
  sessionTickMs: 15_000,
  /** ... while the child did something in the last two minutes. */
  activeWindowMs: 120_000,
  /** Share of ordinary challenges that end with a teach-back moment. */
  teachBackChance: 1 / 3,
  /** Learner notes are refreshed after every this many attempts ... */
  notesEvery: 10,
  /** ... from this many of the latest attempts. */
  notesAttempts: 20,
  /** Pip looks tired when fewer minutes of play time are left. */
  tiredMinutes: 3,
  /** Longest question a child can ask the helper. */
  chatMaxLength: 160,
  /** Turns of the conversation that are passed to the tutor. */
  historyTurns: 6,
  /** Helper lines kept on screen for one challenge. */
  messagesKept: 40,
  /** How long the local wrong-answer line stands in alone before it is said without the tutor's wording. */
  feedbackWaitMs: 1200,
  /** The tutor's wording is still added when it arrives within this time and nothing newer was said (a real model needs 1 to 5 seconds). */
  lateFeedbackMs: 6000,
  /**
   * How long a child who asked for a hint or a walkthrough step waits for the tutor's own wording.
   * After that the request is given up and the hint of the challenge itself is shown (a real model
   * needs 1 to 5 seconds; a slow one must not leave the child looking at a thinking face).
   */
  helpWaitMs: 4000,
  /** The same wrong answer again within this time is a double tap on Check: one try, not two. */
  doubleSubmitMs: 800,
  /** Scene objects that glow for one helper line. */
  maxHighlights: 3,
  /** Slow and normal speaking rates of the speed control. */
  slowRate: 0.75,
  normalRate: 1,
} as const;

export type HintLevel = 0 | 1 | 2 | 3;

export type PlayPhase =
  /** Nothing is running (before `start`, after `leave`). */
  | 'idle'
  | 'loading'
  /** Story Quest: the chapter is told before its challenge. */
  | 'story'
  | 'presenting'
  | 'answering'
  | 'solved'
  | 'teachback'
  | 'recorded';

/** What the URL asked for. */
export interface PlayRequest {
  mode?: Mode;
  strand?: Strand;
  /** Imagination Studio: the idea the child typed or said. Only honoured while open chat is on (see supply.ts). */
  idea?: string;
  /** Imagination Studio: the picture idea, as the ids of its three chips ("dragon.baking.moon"). Never free text. */
  pick?: string;
}

/** Three chip ids joined by dots: lower-case letters only, so no sentence fits in here. */
const PICK_PATTERN = /^[a-z]{1,24}\.[a-z]{1,24}\.[a-z]{1,24}$/;

/** Reads `mode`, `strand`, `idea` and `pick` from the query string. Unknown values are dropped. */
export function parseRequest(params: { get(name: string): string | null }): PlayRequest {
  const request: PlayRequest = {};
  const mode = params.get('mode');
  if (mode !== null && (MODES as readonly string[]).includes(mode)) request.mode = mode as Mode;
  const strand = params.get('strand');
  if (strand !== null && (STRANDS as readonly string[]).includes(strand)) request.strand = strand as Strand;
  const idea = params.get('idea')?.replace(/\s+/g, ' ').trim() ?? '';
  if (request.mode === 'studio' && idea !== '') request.idea = Array.from(idea).slice(0, 80).join('');
  const pick = params.get('pick') ?? '';
  if (request.mode === 'studio' && PICK_PATTERN.test(pick)) request.pick = pick;
  return request;
}

// ---------------------------------------------------------------------------
// One run through a challenge
// ---------------------------------------------------------------------------

/** What the child did on the current challenge. */
export interface Run {
  /** Every submitted answer, oldest first. */
  answers: AnswerEvent[];
  /** Highest hint given: 0 none, 1 nudge, 2 strong hint. */
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
  /** Zero-based index of the walkthrough step on show. */
  walkthroughStep: number;
  /** True while the steps are on show. False again after the last step, when the child answers. */
  walkthroughOpen: boolean;
}

export function freshRun(): Run {
  return { answers: [], hintsUsed: 0, walkthroughUsed: false, walkthroughStep: 0, walkthroughOpen: false };
}

export function wrongTriesOf(run: Pick<Run, 'answers'>): number {
  return run.answers.reduce((count, answer) => count + (answer.correct ? 0 : 1), 0);
}

export function isSolved(run: Pick<Run, 'answers'>): boolean {
  return run.answers[run.answers.length - 1]?.correct === true;
}

/** The highest rung of the help ladder the child reached. */
export function hintLevelOf(run: Pick<Run, 'hintsUsed' | 'walkthroughUsed'>): HintLevel {
  return run.walkthroughUsed ? 3 : run.hintsUsed;
}

export function answerEvent(answer: Answer, result: CheckResult, at: number): AnswerEvent {
  return { at, answer, correct: result.correct, misconception: result.misconception };
}

/** The run with one more answer. A solved run takes no further answers. */
export function withAnswer(run: Run, event: AnswerEvent): Run {
  if (isSolved(run)) return run;
  return { ...run, answers: [...run.answers, event] };
}

/** An answer as text that is the same for the same answer: the keys of a sort or match answer in a fixed order. */
function answerKey(answer: unknown): string {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return JSON.stringify(answer) ?? '';
  const record = answer as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key]]));
}

/**
 * True when `answer` is the latest wrong answer once more, given right after it: a child's double
 * tap on Check. That is one wrong try, not two. It must not cost the stars of a second try, and
 * two honest mistakes must not look like the rapid tapping that opens the break. The same answer
 * after a pause, or any other answer, is a new try.
 */
export function isRepeatedSubmit(run: Pick<Run, 'answers'>, answer: unknown, at: number): boolean {
  const last = run.answers[run.answers.length - 1];
  if (!last || last.correct) return false;
  const since = at - last.at;
  return since >= 0 && since < PLAY.doubleSubmitMs && answerKey(last.answer) === answerKey(answer);
}

/**
 * "Give me a hint": one level up per request, and never past the strong hint.
 * Asking again at the top repeats the strong hint.
 */
export function withHint(run: Run): { run: Run; level: 1 | 2 } {
  const level: 1 | 2 = run.hintsUsed === 0 ? 1 : 2;
  return { run: { ...run, hintsUsed: level }, level };
}

/** "Show me how" is there after the strong hint, or after three wrong tries. */
export function canWalkthrough(run: Pick<Run, 'answers' | 'hintsUsed' | 'walkthroughUsed'>): boolean {
  return run.walkthroughUsed || run.hintsUsed >= 2 || wrongTriesOf(run) >= PLAY.walkthroughAfterWrongTries;
}

/** Starts (or restarts) the walkthrough at its first step. Unchanged while it is not available. */
export function withWalkthrough(run: Run): Run {
  if (!canWalkthrough(run)) return run;
  return { ...run, walkthroughUsed: true, walkthroughStep: 0, walkthroughOpen: true };
}

/** The next step, or the end of the steps: then it is the child's turn to answer. */
export function withNextStep(run: Run, steps: number): Run {
  if (!run.walkthroughOpen) return run;
  if (run.walkthroughStep + 1 < steps) return { ...run, walkthroughStep: run.walkthroughStep + 1 };
  return { ...run, walkthroughOpen: false };
}

/** The help Pip may offer by himself, or null when there is none to offer right now. */
export function helpToOffer(run: Run): 'hint' | 'walkthrough' | null {
  if (run.walkthroughOpen || isSolved(run)) return null;
  if (run.hintsUsed < 2 && !run.walkthroughUsed) return 'hint';
  return 'walkthrough';
}

/** True when a wrong try should come with an offer of help. */
export function offersHelpAfterWrong(run: Run): boolean {
  return wrongTriesOf(run) >= PLAY.offerAfterWrongTries && helpToOffer(run) !== null;
}

/** The same rule as `outcomeOf` in `@/progression`, for the screen's own decisions before the attempt is stored. */
export function outcomeOfRun(run: Pick<Run, 'answers' | 'hintsUsed' | 'walkthroughUsed'>): AttemptOutcome {
  if (run.walkthroughUsed) return 'walkthrough';
  if (run.hintsUsed >= 2) return 'hint';
  if (run.hintsUsed === 1) return 'nudge';
  if (run.answers.length > 1 || wrongTriesOf(run) > 0) return 'second-try';
  return 'independent';
}

/**
 * A concept check counts as passed only when the child needed no help. Pass the credited outcome
 * (`creditedOutcome` in `@/progression`), so that an answer found by trying the options does not count.
 */
export function checkPassed(purpose: ItemPurpose, outcome: AttemptOutcome): boolean {
  return purpose === 'check' && (outcome === 'independent' || outcome === 'second-try');
}

/**
 * The teach-back moment: always after a walkthrough and on a concept check,
 * otherwise for about one challenge in three. `roll` is a random number in [0, 1).
 */
export function shouldTeachBack(input: {
  challenge: Pick<Challenge, 'teachBack'>;
  walkthroughUsed: boolean;
  purpose: ItemPurpose;
  roll: number;
}): boolean {
  if (!input.challenge.teachBack) return false;
  if (input.walkthroughUsed || input.purpose === 'check') return true;
  return input.roll < PLAY.teachBackChance;
}

/** How the challenge is framed for the child. */
export type Frame = 'check' | 'placement' | 'story' | 'plain';

export function frameOf(record: Pick<ChallengeRecord, 'purpose' | 'storyId'>): Frame {
  if (record.purpose === 'check') return 'check';
  if (record.purpose === 'placement') return 'placement';
  if (record.storyId !== null) return 'story';
  return 'plain';
}

// ---------------------------------------------------------------------------
// Words about an answer
// ---------------------------------------------------------------------------

/**
 * "3 of 5 are in the right spot": only for the kinds where the child places
 * several things, and only when some but not all of them are right.
 */
export function partsRight(interaction: Interaction, result: Pick<CheckResult, 'progress' | 'correct'>): { right: number; total: number } | null {
  if (result.correct) return null;
  let total = 0;
  if (interaction.kind === 'sort' || interaction.kind === 'order') total = interaction.items.length;
  else if (interaction.kind === 'match') total = interaction.pairs.length;
  else return null;
  const right = Math.round(Math.max(0, Math.min(1, result.progress)) * total);
  if (right <= 0 || right >= total) return null;
  return { right, total };
}

/**
 * A short description of what the child answered, for the tutor. It is built
 * only from the challenge's own labels, so nothing about the child is in it.
 */
export function describeAnswer(interaction: Interaction, answer: unknown): string {
  const clip = (text: string): string => Array.from(text).slice(0, 200).join('');
  const ids = Array.isArray(answer) ? answer.filter((entry): entry is string => typeof entry === 'string') : [];
  switch (interaction.kind) {
    case 'choice':
      return clip(ids.map((id) => interaction.options.find((option) => option.id === id)?.label ?? '').filter(Boolean).join(', '));
    case 'number':
      return typeof answer === 'number' && Number.isFinite(answer) ? String(answer) : '';
    case 'order':
      return clip(ids.map((id) => interaction.items.find((item) => item.id === id)?.label ?? '').filter(Boolean).join(' > '));
    case 'build':
      return clip(ids.map((id) => interaction.parts.find((part) => part.id === id)?.label ?? '').filter(Boolean).join(', '));
    default:
      return '';
  }
}

function foldForMatch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Scene objects that a helper line names (by caption or text). Tap targets
 * never glow: that would point straight at the answer.
 */
export function namedObjectIds(challenge: Pick<Challenge, 'scene' | 'interaction'>, line: string): string[] {
  const said = ` ${foldForMatch(line).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const secret = new Set(challenge.interaction.kind === 'tap' ? challenge.interaction.targetIds : []);
  const found: string[] = [];
  for (const object of challenge.scene.objects) {
    if (secret.has(object.id)) continue;
    const name = foldForMatch((object.label ?? object.text ?? '').trim()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (Array.from(name).length < 3) continue;
    if (said.includes(` ${name} `) && !found.includes(object.id)) found.push(object.id);
    if (found.length >= PLAY.maxHighlights) break;
  }
  return found;
}

/** Scene object ids to glow for a helper line: the tutor's own, plus the ones the line names. */
export function highlightsFor(challenge: Pick<Challenge, 'scene' | 'interaction'>, line: string, fromTutor: readonly string[]): string[] {
  const known = new Set(challenge.scene.objects.map((object) => object.id));
  const secret = new Set(challenge.interaction.kind === 'tap' ? challenge.interaction.targetIds : []);
  const ids = [...fromTutor.filter((id) => known.has(id) && !secret.has(id)), ...namedObjectIds(challenge, line)];
  return [...new Set(ids)].slice(0, PLAY.maxHighlights);
}

/** Picks from a list by a running number, so lines rotate instead of repeating. */
export function rotate<T>(options: readonly T[], turn: number): T {
  const index = ((Math.floor(turn) % options.length) + options.length) % options.length;
  return options[index] as T;
}

// ---------------------------------------------------------------------------
// Pip
// ---------------------------------------------------------------------------

export interface BotView {
  phase: PlayPhase;
  /** Waiting for the tutor. */
  thinking: boolean;
  /** A short reaction that is running, or null. */
  mood: PipState | null;
  walkthroughOpen: boolean;
  /** The solved challenge was a concept check and the child passed it. */
  checkPassed: boolean;
  /** Pip offered help after a long pause. */
  waiting: boolean;
  /** The calm breathing moment is on show. */
  resting: boolean;
  minutesLeft: number | null;
}

/**
 * What Pip does while nobody is speaking or listening (the helper adds
 * talking, listening and giggling on top). Never 'angry'; 'jump_scared' can
 * only come in as the playful reaction of a Fix-the-Bot intro.
 */
export function baseBotState(view: BotView): PipState {
  if (view.phase === 'loading' || view.thinking) return 'thinking';
  if (view.mood !== null && view.mood !== 'angry') return view.mood;
  if (view.phase === 'story') return 'storytelling';
  if (view.walkthroughOpen) return 'teaching';
  if (view.phase === 'solved' || view.phase === 'teachback' || view.phase === 'recorded') {
    return view.checkPassed ? 'proud' : 'happy';
  }
  if (view.resting) return 'idle';
  if (view.waiting) return 'waiting';
  if (view.minutesLeft !== null && view.minutesLeft < PLAY.tiredMinutes) return 'tired';
  return 'idle';
}

/**
 * Pip's face after a wrong try: curious about the answer, and now and then a
 * soft "aww" that turns into encouragement at once. Never a telling-off.
 */
export function wrongTryMoods(wrongTries: number): { state: PipState; ms: number }[] {
  if (wrongTries > 0 && wrongTries % 3 === 0) {
    return [
      { state: 'sad', ms: 900 },
      { state: 'happy', ms: 2000 },
    ];
  }
  return [{ state: 'curious', ms: 2600 }];
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface AttemptInput {
  challenge: ChallengeRecord;
  answers: AnswerEvent[];
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
  teachBackCorrect: boolean | null;
  timeMs: number;
}

/** The input of `recordAttempt` for a solved run. */
export function attemptInput(challenge: ChallengeRecord, run: Run, teachBackCorrect: boolean | null, activeMs: number): AttemptInput {
  return {
    challenge,
    answers: run.answers,
    hintsUsed: run.hintsUsed,
    walkthroughUsed: run.walkthroughUsed,
    teachBackCorrect,
    timeMs: Number.isFinite(activeMs) ? Math.max(0, Math.round(activeMs)) : 0,
  };
}

/** What the reward moment shows, taken from the attempt result. Only good news: a step down is never shown. */
export interface RewardSummary {
  stars: number;
  outcome: AttemptOutcome;
  teachBonus: boolean;
  /** Newly earned badges, with the reason stored in English as a fallback. */
  badges: { key: string; reason: string }[];
  companionGrew: boolean;
  /** Strands that moved up a step. */
  stageUps: { strand: Strand; to: StageValue }[];
  /** A streak milestone reached today, in days. */
  streakDays: number | null;
  /** This attempt finished the placement game. */
  placementFinished: boolean;
  suggestBreak: boolean;
}

export function rewardSummary(result: AttemptResult): RewardSummary {
  const streak = result.rewards.find((reward) => reward.kind === 'streak');
  const streakDays = streak ? Number.parseInt(streak.key, 10) : Number.NaN;
  const placementFinished = result.stageChanges.some((change) => change.reason === 'placement');
  const stageUps = new Map<Strand, StageValue>();
  for (const change of result.stageChanges) {
    if (change.skillId !== null || change.reason === 'placement' || change.to <= change.from) continue;
    stageUps.set(change.strand, Math.max(change.to, stageUps.get(change.strand) ?? 0));
  }
  return {
    stars: Math.max(0, result.attempt.starsEarned),
    outcome: result.attempt.outcome,
    teachBonus: result.attempt.teachBackCorrect === true,
    badges: result.rewards.filter((reward) => reward.kind === 'badge').map((reward) => ({ key: reward.key, reason: reward.reason })),
    companionGrew: result.rewards.some((reward) => reward.kind === 'companion'),
    stageUps: [...stageUps].map(([strand, to]) => ({ strand, to })),
    streakDays: Number.isFinite(streakDays) && streakDays > 0 ? streakDays : null,
    placementFinished,
    suggestBreak: result.suggestBreak,
  };
}

/** One row of what `generateLearnerNotes` reads. No name, no id: skill, grade, outcome, question, misconceptions. */
export interface NotesRow {
  skill: string;
  grade: Grade;
  outcome: AttemptOutcome;
  question: string;
  misconceptions: string[];
}

export function notesRow(
  attempt: Pick<AttemptRecord, 'skillId' | 'outcome' | 'answers'>,
  challenge: Pick<ChallengeRecord, 'content'> | undefined,
  skillName: string,
  grade: Grade,
): NotesRow {
  const misconceptions = attempt.answers
    .map((answer) => answer.misconception?.trim() ?? '')
    .filter((text) => text !== '');
  return {
    skill: skillName,
    grade,
    outcome: attempt.outcome,
    question: challenge?.content.question ?? '',
    misconceptions: [...new Set(misconceptions)],
  };
}

/**
 * A plan for the challenge of last resort, used when nothing else could be
 * planned: the first skill that exists at the child's grade, as a plain quest.
 */
export function lastResortPlan(child: Pick<ChildProfile, 'id' | 'grade' | 'interests'>): ChallengePlan {
  const skill = SKILLS.find((candidate) => skillExistsAt(candidate, child.grade)) ?? SKILLS[0];
  return {
    childId: child.id,
    skillId: skill?.id ?? 'math-counting-cardinality',
    strand: skill?.strand ?? 'math',
    stage: makeStage(child.grade, 'starting'),
    interaction: skill?.interactions[0] ?? 'choice',
    mode: 'quest',
    purpose: 'core',
    theme: child.interests[0] ?? 'animals',
  };
}
