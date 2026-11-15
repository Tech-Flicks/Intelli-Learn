/**
 * The play session store: one child, one challenge at a time.
 *
 * The rules live in `machine.ts` as plain functions. This file strings them
 * together with the outside world: the supply queue, the tutor, the voice, the
 * progression service and the database. `PlayScreen` renders what is in the
 * store; `HelperBot` reads it and drives the help ladder through its actions.
 *
 * Promises that this file never breaks:
 * - No skipping. A challenge ends only by being solved; help goes up one rung
 *   per request and never shows the answer.
 * - `recordAttempt` runs exactly once per challenge.
 * - Nothing here can leave the child on an error page: whatever fails, there
 *   is an offline challenge to carry on with.
 * - The child's nickname never reaches the tutor: only `buildContext` output does.
 */
import Dexie from 'dexie';
import { create } from 'zustand';
import type { PipState } from '@/bot';
import { makeStage, newId, stageGrade } from '@/core/grades';
import type { TutorReply } from '@/core/schemas';
import { getSkill } from '@/core/skills';
import type {
  AnswerEvent,
  AttemptOutcome,
  AttemptResult,
  ChallengePlan,
  ChallengeRecord,
  ChildProfile,
  HelperMessage,
  HelperMessageKind,
  ParentalControls,
  PlayAllowance,
} from '@/core/types';
import { db, getSettings, updateChild } from '@/data';
import { generateLearnerNotes, localSafetyCheck, tutorReply, type ChildContext, type TutorRequest } from '@/ai';
import type { Answer, CheckResult } from '@/engine';
import { t } from '@/i18n';
import { recordLibraryOutcome } from '@/library';
import { pickOfflineChallenge } from '@/offline';
import {
  detectFrustration,
  effectiveControls,
  endSession,
  getPlayAllowance,
  placementStatus,
  planNext,
  recordAttempt,
  startSession,
  tickSession,
} from '@/progression';
import { cancelListening, speak, stopSpeaking } from '@/voice';
import {
  PLAY,
  answerEvent,
  attemptInput,
  baseBotState,
  canWalkthrough,
  checkPassed,
  describeAnswer,
  helpToOffer,
  highlightsFor,
  hintLevelOf,
  isSolved,
  lastResortPlan,
  notesRow,
  offersHelpAfterWrong,
  outcomeOfRun,
  partsRight,
  rewardSummary,
  rotate,
  shouldTeachBack,
  withAnswer,
  withHint,
  withNextStep,
  withWalkthrough,
  wrongTriesOf,
  wrongTryMoods,
  type AttemptInput,
  type HintLevel,
  type PlayPhase,
  type PlayRequest,
  type RewardSummary,
  type Run,
} from './machine';
import { LINE_COUNTS } from './strings';
import { advanceStory, buildContext, ensureQueue, makeSibling, prepareConceptCheck, takeNext } from './supply';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One line of the conversation with the helper on the current challenge. */
export interface BotMessage {
  id: string;
  role: 'child' | 'bot';
  kind: HelperMessageKind;
  text: string;
  at: number;
}

export type BotOffer = 'hint' | 'walkthrough';

export interface TeachBackView {
  /** The option the child picked, or null while the question is open. */
  chosenId: string | null;
  correct: boolean | null;
  /** Pip's kind answer, once it is there. */
  feedback: string | null;
}

/** The chapter a story challenge belongs to. The picture is read live by the screen. */
export interface StoryView {
  storyId: string;
  title: string;
  heading: string;
  narrative: string;
  chapterIndex: number;
  chapterCount: number;
}

export interface PlaySessionData {
  childId: string | null;
  /** What `takeNext` is asked for. Starts as the URL's request. */
  request: PlayRequest;
  challenge: ChallengeRecord | null;
  phase: PlayPhase;

  // --- the run ---
  answers: AnswerEvent[];
  wrongTries: number;
  /** 0 none, 1 nudge, 2 strong hint, 3 walkthrough. */
  hintLevel: HintLevel;
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
  walkthroughStep: number;
  walkthroughOpen: boolean;
  /** The text of the step on show, or null while Pip is still wording it. */
  walkthroughText: string | null;
  highlightIds: string[];

  // --- Pip ---
  botState: PipState;
  /** The text in Pip's speech bubble, or null. */
  botLine: string | null;
  /** Changes with every new line, so the bubble can time itself. */
  botLineId: number;
  /** A sticky line stays until it is closed or replaced; other lines fade by themselves. */
  botLineSticky: boolean;
  /** Help that the bubble offers with a yes / not-yet choice. */
  botOffer: BotOffer | null;
  helpOffered: boolean;
  /** Bumped when Pip should wiggle for attention. */
  wiggle: number;
  /** Waiting for the tutor. */
  thinking: boolean;
  messages: BotMessage[];
  muted: boolean;
  voiceRate: number;
  /** The challenge text is being read aloud right now. */
  reading: boolean;
  /** The helper's panel is open (the stage is disabled underneath). */
  panelOpen: boolean;
  /** Pip sits in his home spot next to the question. */
  botDocked: boolean;

  // --- moments ---
  breakOpen: boolean;
  /** Bumped on every solve: the stage fires its celebration burst. */
  celebrate: number;
  /** Bumped for every new challenge: the stage starts with an empty answer. */
  resetKey: number;
  solvedOutcome: AttemptOutcome | null;
  checkPassed: boolean;
  willTeachBack: boolean;
  teachBack: TeachBackView | null;
  result: AttemptResult | null;
  rewards: RewardSummary | null;
  /** Stars of the last result that have not flown into the counter yet. */
  starsPending: number;
  /** Set when the solved chapter was the last one of its story. */
  storyEnding: string | null;

  // --- context ---
  controls: ParentalControls | null;
  /** Read new text aloud without being asked (ages 3-5, or the read-aloud setting). */
  autoRead: boolean;
  story: StoryView | null;
  placement: { answered: number; total: number } | null;
  allowance: PlayAllowance | null;
  /** Challenges finished since the screen opened. */
  sessionCompleted: number;
  /** Where the screen should navigate to, or null. */
  exit: string | null;
  /** Bumped when the URL's query no longer describes what is being played (a studio idea was used, a story ended). */
  urlReset: number;
}

export interface PlaySessionActions {
  start(childId: string, request?: PlayRequest): Promise<void>;
  /** Leaves the screen. An unfinished challenge stays `active` and comes back next time. */
  leave(): Promise<void>;
  /** The child did something: keeps the play-time clock and the idle offer honest. */
  touch(): void;
  setVisible(visible: boolean): void;
  /** Story card -> the chapter's challenge. */
  beginChallenge(): void;
  /** The intro has been shown. */
  beginAnswering(): void;
  submitAnswer(answer: Answer, result: CheckResult): void;
  requestRead(): void;
  stopReading(): void;
  requestHint(): Promise<void>;
  requestWalkthrough(): Promise<void>;
  nextWalkthroughStep(): Promise<void>;
  askBot(text: string): Promise<void>;
  acceptOffer(): Promise<void>;
  dismissBotLine(lineId?: number): void;
  setMuted(muted: boolean): void;
  setVoiceRate(rate: number): void;
  setPanelOpen(open: boolean): void;
  setBotDocked(docked: boolean): void;
  closeBreak(): void;
  continueAfterSolved(): void;
  answerTeachBack(optionId: string): Promise<void>;
  /** One star reached the counter. */
  landStar(): void;
  /** "Next adventure": only once the current challenge is recorded. */
  next(): Promise<void>;
  /** Records a solved challenge that is still waiting for its teach-back (the page is closing). */
  recordIfSolved(): Promise<void>;
}

export type PlaySessionState = PlaySessionData & PlaySessionActions;

// ---------------------------------------------------------------------------
// Injectable clock and randomness, and what is not worth re-rendering for
// ---------------------------------------------------------------------------

export interface PlayDeps {
  now: () => number;
  /** Random number in [0, 1). */
  random: () => number;
}

const DEFAULT_DEPS: PlayDeps = { now: () => Date.now(), random: () => Math.random() };
let deps: PlayDeps = DEFAULT_DEPS;

/** Replaces the clock and the random source (tests). `null` restores the real ones. */
export function setPlayDeps(next: Partial<PlayDeps> | null): void {
  deps = next ? { ...DEFAULT_DEPS, ...next } : DEFAULT_DEPS;
}

const now = (): number => deps.now();

interface Runtime {
  /** Bumped by start, leave and next: work that finishes under an older number is dropped. */
  token: number;
  child: ChildProfile | null;
  context: ChildContext | null;
  sessionId: string | null;
  lastInteractionAt: number;
  /** Active play time on the current challenge, and the start of the stretch that is running. */
  activeMs: number;
  activeMark: number | null;
  tickTimer: ReturnType<typeof setInterval> | null;
  ticks: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleArmedAt: number;
  /** The open offer came from a long pause (Pip waits) and not from a wrong try. */
  idleOffer: boolean;
  moodTimer: ReturnType<typeof setTimeout> | null;
  mood: PipState | null;
  thinking: number;
  record: Promise<void> | null;
  sibling: Promise<void> | null;
  breakShown: boolean;
  wrongLines: number;
  speakSeq: number;
}

const rt: Runtime = {
  token: 0,
  child: null,
  context: null,
  sessionId: null,
  lastInteractionAt: 0,
  activeMs: 0,
  activeMark: null,
  tickTimer: null,
  ticks: 0,
  idleTimer: null,
  idleArmedAt: 0,
  idleOffer: false,
  moodTimer: null,
  mood: null,
  thinking: 0,
  record: null,
  sibling: null,
  breakShown: false,
  wrongLines: 0,
  speakSeq: 0,
};

const RUN_START = {
  answers: [] as AnswerEvent[],
  wrongTries: 0,
  hintLevel: 0 as HintLevel,
  hintsUsed: 0 as 0 | 1 | 2,
  walkthroughUsed: false,
  walkthroughStep: 0,
  walkthroughOpen: false,
  walkthroughText: null,
  highlightIds: [] as string[],
  botLine: null,
  botLineSticky: false,
  botOffer: null,
  helpOffered: false,
  thinking: false,
  messages: [] as BotMessage[],
  reading: false,
  breakOpen: false,
  solvedOutcome: null,
  checkPassed: false,
  willTeachBack: false,
  teachBack: null,
  result: null,
  rewards: null,
  starsPending: 0,
  storyEnding: null,
  story: null,
  placement: null,
} satisfies Partial<PlaySessionData>;

const INITIAL: PlaySessionData = {
  childId: null,
  request: {},
  challenge: null,
  phase: 'idle',
  ...RUN_START,
  botState: 'idle',
  botLineId: 0,
  wiggle: 0,
  muted: false,
  voiceRate: 1,
  panelOpen: false,
  botDocked: true,
  celebrate: 0,
  resetKey: 0,
  controls: null,
  autoRead: false,
  allowance: null,
  sessionCompleted: 0,
  exit: null,
  urlReset: 0,
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export const usePlaySession = create<PlaySessionState>()(() => ({
  ...INITIAL,
  start,
  leave,
  touch,
  setVisible,
  beginChallenge,
  beginAnswering,
  submitAnswer,
  requestRead,
  stopReading,
  requestHint,
  requestWalkthrough,
  nextWalkthroughStep,
  askBot,
  acceptOffer,
  dismissBotLine,
  setMuted,
  setVoiceRate,
  setPanelOpen: (open) => apply({ panelOpen: open }),
  setBotDocked: (docked) => apply({ botDocked: docked }),
  closeBreak: () => apply({ breakOpen: false }),
  continueAfterSolved,
  answerTeachBack,
  landStar: () => apply({ starsPending: Math.max(0, get().starsPending - 1) }),
  next,
  recordIfSolved,
}));

const get = (): PlaySessionState => usePlaySession.getState();

/** Sets state and brings Pip's face in step with it. */
function apply(patch: Partial<PlaySessionData>): void {
  usePlaySession.setState(patch);
  refreshBot();
}

function refreshBot(): void {
  const s = get();
  const botState = baseBotState({
    phase: s.phase,
    thinking: s.thinking,
    mood: rt.mood,
    walkthroughOpen: s.walkthroughOpen,
    checkPassed: s.checkPassed,
    waiting: s.helpOffered && rt.idleOffer,
    resting: s.breakOpen,
    minutesLeft: s.allowance ? (s.allowance.allowed ? s.allowance.minutesLeft : 0) : null,
  });
  if (botState !== s.botState) usePlaySession.setState({ botState });
}

function runOf(s: PlaySessionData): Run {
  return {
    answers: s.answers,
    hintsUsed: s.hintsUsed,
    walkthroughUsed: s.walkthroughUsed,
    walkthroughStep: s.walkthroughStep,
    walkthroughOpen: s.walkthroughOpen,
  };
}

function runPatch(run: Run): Partial<PlaySessionData> {
  return {
    answers: run.answers,
    wrongTries: wrongTriesOf(run),
    hintsUsed: run.hintsUsed,
    hintLevel: hintLevelOf(run),
    walkthroughUsed: run.walkthroughUsed,
    walkthroughStep: run.walkthroughStep,
    walkthroughOpen: run.walkthroughOpen,
  };
}

async function quiet<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch {
    return undefined;
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const restPath = (childId: string): string => `/kids/${childId}/rest`;
const homePath = (childId: string): string => `/kids/${childId}`;

/** The challenge can still be worked on (and helped with). */
function isOpen(s: PlaySessionData): boolean {
  return s.challenge !== null && (s.phase === 'presenting' || s.phase === 'answering');
}

// ---------------------------------------------------------------------------
// Pip's moods and lines
// ---------------------------------------------------------------------------

function playMoods(steps: { state: PipState; ms: number }[]): void {
  if (rt.moodTimer !== null) clearTimeout(rt.moodTimer);
  rt.moodTimer = null;
  const [first, ...rest] = steps;
  rt.mood = first?.state ?? null;
  refreshBot();
  if (!first) return;
  rt.moodTimer = setTimeout(() => {
    rt.moodTimer = null;
    playMoods(rest);
  }, first.ms);
}

/** Whether Pip may use his voice. Lines the child asked for are spoken unless muted; others only for a child who is read to. */
function mayVoice(when: 'asked' | 'auto' | 'never'): boolean {
  const s = get();
  if (when === 'never' || !s.controls?.voiceOutput || s.muted) return false;
  return when === 'asked' || s.autoRead;
}

/** A line that is safe to show and speak, whatever went into it. */
function safeLine(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const strictness = rt.context?.strictness ?? 'strict';
  return clean !== '' && localSafetyCheck(clean, strictness).safe ? clean : t('play.fallback');
}

function say(text: string, reading = false): void {
  rt.speakSeq += 1;
  const seq = rt.speakSeq;
  usePlaySession.setState({ reading });
  void speak(text, { rate: get().voiceRate }).then(() => {
    if (seq === rt.speakSeq && get().reading) usePlaySession.setState({ reading: false });
  });
}

/** Adds a line to the conversation and, when the parent allows it, to the stored transcript. */
function logMessage(role: 'child' | 'bot', kind: HelperMessageKind, text: string): void {
  const s = get();
  if (!s.childId) return;
  const message: BotMessage = { id: newId('msg'), role, kind, text, at: now() };
  usePlaySession.setState({ messages: [...s.messages, message].slice(-PLAY.messagesKept) });
  if (!s.controls?.keepTranscripts) return;
  const row: HelperMessage = { ...message, childId: s.childId, challengeId: s.challenge?.id ?? null };
  void quiet(db.messages.add(row));
}

interface LineOptions {
  voice: 'asked' | 'auto' | 'never';
  sticky?: boolean;
  offer?: BotOffer | null;
  /** Show it in the speech bubble (default) or only in the conversation. */
  bubble?: boolean;
}

/** Pip says something: bubble, conversation, transcript and voice. Returns the id of the bubble line. */
function botSay(text: string, kind: HelperMessageKind, options: LineOptions): number {
  const line = safeLine(text);
  const s = get();
  let lineId = s.botLineId;
  if (options.bubble !== false) {
    lineId += 1;
    apply({
      botLine: line,
      botLineId: lineId,
      botLineSticky: options.sticky === true,
      botOffer: options.offer ?? null,
      helpOffered: (options.offer ?? null) !== null,
    });
  }
  logMessage('bot', kind, line);
  if (mayVoice(options.voice)) say(line);
  return lineId;
}

function recentHistory(messages: readonly BotMessage[]): { role: 'child' | 'bot'; text: string }[] {
  return messages
    .filter((message) => message.kind !== 'read')
    .slice(-PLAY.historyTurns)
    .map((message) => ({ role: message.role, text: message.text }));
}

type TutorPart = Pick<TutorRequest, 'intent' | 'hintLevel'> &
  Partial<Pick<TutorRequest, 'walkthroughStep' | 'wrongAnswerSummary' | 'misconception' | 'childText' | 'signal'>>;

/** Asks the tutor about the current challenge. Null when the answer came too late to matter. */
async function askTutor(part: TutorPart, showThinking = true): Promise<TutorReply | null> {
  const s = get();
  const record = s.challenge;
  const context = rt.context;
  if (!record || !context) return null;
  const token = rt.token;
  if (showThinking) {
    rt.thinking += 1;
    apply({ thinking: true });
  }
  let reply: TutorReply | null = null;
  try {
    reply = await tutorReply({
      child: context,
      challenge: record.content,
      openChat: s.controls?.openChat === true,
      history: recentHistory(s.messages),
      ...part,
    });
  } catch {
    reply = null;
  }
  const stale = token !== rt.token || get().challenge?.id !== record.id;
  if (showThinking) {
    rt.thinking = Math.max(0, rt.thinking - 1);
    if (!stale) apply({ thinking: rt.thinking > 0 });
  }
  return stale ? null : reply;
}

// ---------------------------------------------------------------------------
// Play time
// ---------------------------------------------------------------------------

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function countsAsPlay(phase: PlayPhase): boolean {
  return phase === 'story' || phase === 'presenting' || phase === 'answering';
}

/** Adds the running stretch to the challenge's active time. A pause of more than two minutes counts as two minutes. */
function flushActive(at: number): void {
  if (rt.activeMark === null) return;
  rt.activeMs += Math.max(0, Math.min(at - rt.activeMark, PLAY.activeWindowMs));
  rt.activeMark = at;
}

function stopActive(at: number): void {
  flushActive(at);
  rt.activeMark = null;
}

function onTick(): void {
  const at = now();
  if (!pageVisible() || at - rt.lastInteractionAt > PLAY.activeWindowMs || rt.sessionId === null) return;
  void quiet(tickSession(rt.sessionId, PLAY.sessionTickMs, at));
  rt.ticks += 1;
  // Once a minute: how much time is left, so Pip can look tired near the end. Never interrupts a challenge.
  if (rt.ticks % 4 === 0) void refreshAllowance();
}

async function refreshAllowance(): Promise<void> {
  const childId = get().childId;
  if (!childId) return;
  const token = rt.token;
  const allowance = await quiet(getPlayAllowance(childId, now()));
  if (allowance && token === rt.token) apply({ allowance });
}

function armIdle(at: number): void {
  if (rt.idleTimer !== null) clearTimeout(rt.idleTimer);
  rt.idleArmedAt = at;
  rt.idleTimer = setTimeout(onIdle, PLAY.idleOfferMs);
}

/** A long pause: Pip offers help. He never starts helping by himself. */
function onIdle(): void {
  rt.idleTimer = null;
  const s = get();
  if (!isOpen(s) || s.thinking || s.walkthroughOpen || s.panelOpen || s.breakOpen || s.botOffer !== null) return;
  const offer = helpToOffer(runOf(s));
  if (!offer) return;
  rt.idleOffer = true;
  botSay(`${t('play.offer.idle')} ${t(`play.offer.${offer}`)}`, 'chat', { voice: 'auto', sticky: true, offer });
  apply({ wiggle: get().wiggle + 1 });
}

function clearTimers(): void {
  if (rt.tickTimer !== null) clearInterval(rt.tickTimer);
  if (rt.idleTimer !== null) clearTimeout(rt.idleTimer);
  if (rt.moodTimer !== null) clearTimeout(rt.moodTimer);
  rt.tickTimer = null;
  rt.idleTimer = null;
  rt.moodTimer = null;
  rt.mood = null;
}

function touch(): void {
  const at = now();
  rt.lastInteractionAt = at;
  flushActive(at);
  // Re-arming on every key or pointer event would be wasteful; once a second is plenty.
  if (isOpen(get()) && at - rt.idleArmedAt > 1000) armIdle(at);
}

function setVisible(visible: boolean): void {
  const at = now();
  if (!visible) {
    stopActive(at);
    void persistRun();
    return;
  }
  if (countsAsPlay(get().phase)) rt.activeMark = at;
}

// ---------------------------------------------------------------------------
// Keeping an unfinished run, so that leaving and coming back does not wipe the help that was used
// ---------------------------------------------------------------------------

const runKey = (record: Pick<ChallengeRecord, 'id' | 'childId'>): string => `play:run:${record.id}:${record.childId}`;
const mutedKey = (childId: string): string => `bot-muted:${childId}`;

interface StoredRun {
  v: 1;
  answers: AnswerEvent[];
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
  activeMs: number;
}

async function persistRun(): Promise<void> {
  const s = get();
  if (!s.challenge || !isOpen(s)) return;
  const value: StoredRun = {
    v: 1,
    answers: s.answers.filter((answer) => !answer.correct),
    hintsUsed: s.hintsUsed,
    walkthroughUsed: s.walkthroughUsed,
    activeMs: rt.activeMs,
  };
  await quiet(db.kv.put({ key: runKey(s.challenge), value }));
}

async function restoreRun(record: ChallengeRecord): Promise<{ run: Run; activeMs: number } | null> {
  const stored = (await quiet(db.kv.get(runKey(record))))?.value as Partial<StoredRun> | undefined;
  if (!stored || stored.v !== 1 || !Array.isArray(stored.answers)) return null;
  const answers = stored.answers.filter(
    (answer): answer is AnswerEvent => typeof answer === 'object' && answer !== null && answer.correct === false && typeof answer.at === 'number',
  );
  const hintsUsed = stored.hintsUsed === 1 || stored.hintsUsed === 2 ? stored.hintsUsed : 0;
  return {
    run: { answers, hintsUsed, walkthroughUsed: stored.walkthroughUsed === true, walkthroughStep: 0, walkthroughOpen: false },
    activeMs: typeof stored.activeMs === 'number' && Number.isFinite(stored.activeMs) ? Math.max(0, stored.activeMs) : 0,
  };
}

// ---------------------------------------------------------------------------
// Entering and leaving
// ---------------------------------------------------------------------------

async function start(childId: string, request: PlayRequest = {}): Promise<void> {
  rt.token += 1;
  const token = rt.token;
  clearTimers();
  rt.sibling = null;
  rt.record = null;
  rt.thinking = 0;
  usePlaySession.setState({ ...INITIAL, childId, request, phase: 'loading', botState: 'thinking' });

  const child = await quiet(db.children.get(childId));
  const settings = await quiet(getSettings());
  if (token !== rt.token) return;
  if (!child || !settings) {
    apply({ exit: '/kids' });
    return;
  }
  rt.child = child;
  rt.context = buildContext(child, settings);
  const muted = (await quiet(db.kv.get(mutedKey(childId))))?.value === true;
  const allowance = (await quiet(getPlayAllowance(childId, now()))) ?? null;
  if (token !== rt.token) return;
  apply({
    controls: effectiveControls(settings, child),
    autoRead: child.ageGroup === '3-5' || child.accessibility.readAloud,
    voiceRate: child.voiceRate,
    muted,
    allowance,
  });
  if (allowance && !allowance.allowed) {
    apply({ exit: restPath(childId) });
    return;
  }

  const session = await quiet(startSession(childId, now()));
  if (token !== rt.token) {
    if (session) void quiet(endSession(session.id, now()));
    return;
  }
  rt.sessionId = session?.id ?? null;
  rt.lastInteractionAt = now();
  rt.ticks = 0;
  rt.tickTimer = setInterval(onTick, PLAY.sessionTickMs);
  await loadChallenge(token);
}

async function leave(): Promise<void> {
  const s = get();
  stopActive(now());
  // A solved challenge is recorded even when the child leaves before the reward moment;
  // an unsolved one keeps the help that was used, for when the child comes back.
  // Both start here, before anything is awaited, while the store still holds the run.
  const solved = s.challenge !== null && (s.phase === 'solved' || s.phase === 'teachback');
  if (solved) void recordOnce(s.teachBack?.correct ?? null);
  const saved = solved ? Promise.resolve() : persistRun();

  // The token moves on at once: the screen may be opened again before the awaits below finish.
  rt.token += 1;
  const token = rt.token;
  clearTimers();
  rt.speakSeq += 1;
  stopSpeaking();
  cancelListening();
  const pending = rt.record;
  const sessionId = rt.sessionId;
  rt.sessionId = null;
  await quiet(saved);
  if (pending) await quiet(pending);
  if (sessionId) await quiet(endSession(sessionId, now()));
  // A newer start() owns the store by now when the screen was opened again at once.
  if (token === rt.token) usePlaySession.setState({ ...INITIAL });
}

// ---------------------------------------------------------------------------
// Getting a challenge
// ---------------------------------------------------------------------------

/**
 * The challenge of last resort: the unfinished one when there is one, else a
 * new offline challenge. Used when the supply queue failed; cannot fail itself.
 */
async function fallbackChallenge(child: ChildProfile): Promise<ChallengeRecord> {
  const active = (await quiet(db.challenges.where('[childId+status]').equals([child.id, 'active']).toArray())) ?? [];
  const unfinished = active.sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt))[0];
  if (unfinished) return unfinished;

  const planned: ChallengePlan[] = (await quiet(planNext(child.id, 1, { now: now() }))) ?? [];
  const plan = planned[0] ?? lastResortPlan(child);
  const content = pickOfflineChallenge(plan, { seed: Math.floor(deps.random() * 0x7fffffff) });
  const at = now();
  const record: ChallengeRecord = {
    id: newId('ch'),
    childId: child.id,
    skillId: plan.skillId,
    strand: plan.strand,
    stage: plan.stage,
    interaction: content.interaction.kind,
    mode: plan.mode,
    purpose: plan.purpose,
    theme: plan.theme,
    content,
    source: 'offline',
    status: 'active',
    storyId: null,
    chapterIndex: null,
    libraryId: null,
    parentRating: null,
    parentNote: '',
    createdAt: at,
    startedAt: at,
    completedAt: null,
  };
  await quiet(db.challenges.add(record));
  return record;
}

async function storyViewOf(record: ChallengeRecord): Promise<StoryView | null> {
  if (record.storyId === null || record.chapterIndex === null) return null;
  const story = await quiet(db.stories.get(record.storyId));
  const chapter = story?.chapters[record.chapterIndex];
  if (!story || !chapter) return null;
  return {
    storyId: story.id,
    title: story.title,
    heading: chapter.heading,
    narrative: chapter.narrative,
    chapterIndex: record.chapterIndex,
    chapterCount: story.chapters.length,
  };
}

async function loadChallenge(token: number): Promise<void> {
  const childId = get().childId;
  const child = rt.child;
  if (!childId || !child) return;
  if (rt.moodTimer !== null) clearTimeout(rt.moodTimer);
  rt.moodTimer = null;
  rt.mood = null;
  rt.thinking = 0;
  rt.record = null;
  rt.activeMs = 0;
  rt.activeMark = null;
  rt.breakShown = false;
  rt.idleOffer = false;
  rt.speakSeq += 1;
  stopSpeaking();
  apply({ ...RUN_START, challenge: null, phase: 'loading' });

  let record: ChallengeRecord;
  try {
    // After a walkthrough the easier sibling has to be in the queue before the next one is taken.
    const sibling = rt.sibling;
    rt.sibling = null;
    if (sibling) await sibling;
    record = await takeNext(childId, get().request);
  } catch {
    record = await fallbackChallenge(child);
  }
  if (token !== rt.token) return;
  void ensureQueue(childId);

  const restored = await restoreRun(record);
  const story = await storyViewOf(record);
  const placement = record.purpose === 'placement' ? ((await quiet(placementStatus(childId))) ?? null) : null;
  if (token !== rt.token) return;

  const s = get();
  // A studio idea is drawn once: afterwards play goes on as usual.
  const usedIdea = s.request.mode === 'studio';
  rt.activeMs = restored?.activeMs ?? 0;
  const at = now();
  rt.lastInteractionAt = at;
  rt.activeMark = pageVisible() ? at : null;
  apply({
    ...(restored ? runPatch(restored.run) : {}),
    challenge: record,
    story,
    placement: placement && !placement.done ? { answered: placement.answered, total: placement.total } : null,
    phase: story ? 'story' : 'presenting',
    resetKey: s.resetKey + 1,
    ...(usedIdea ? { request: {}, urlReset: s.urlReset + 1 } : {}),
  });
  armIdle(at);
  introduce();
}

/** Pip's hello for a new challenge, and the read-aloud for a child who is read to. */
function introduce(): void {
  const s = get();
  const record = s.challenge;
  if (!record) return;
  if (s.phase === 'story' && s.story) {
    playMoods([]);
    readAloud(`${s.story.heading}. ${s.story.narrative}`, 'auto');
    return;
  }
  let opening = '';
  if (record.purpose === 'check') {
    opening = `${t('play.frame.check.title')} ${t('play.frame.check.text')}`;
    playMoods([{ state: 'happy', ms: 2400 }]);
  } else if (record.mode === 'fixbot') {
    // The one place where Pip may look startled: his own playful "oops".
    opening = t('play.fixbot.intro');
    playMoods([
      { state: 'jump_scared', ms: 900 },
      { state: 'curious', ms: 1800 },
    ]);
  } else {
    playMoods([{ state: 'happy', ms: 2400 }]);
  }
  // The star challenge is already written on the card: Pip only adds it to the conversation (and reads it).
  if (opening !== '') botSay(opening, 'chat', { voice: 'never', bubble: record.purpose !== 'check' });
  readAloud(`${opening} ${record.content.readAloud}`.trim(), 'auto');
}

/** Reads text aloud and notes it in the transcript. `auto` only for a child who is read to. */
function readAloud(text: string, when: 'asked' | 'auto'): void {
  const s = get();
  if (!s.controls?.voiceOutput) return;
  if (when === 'auto' && (!s.autoRead || s.muted)) return;
  const strictness = rt.context?.strictness ?? 'strict';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '' || !localSafetyCheck(clean, strictness).safe) return;
  logMessage('bot', 'read', clean);
  say(clean, true);
}

function beginChallenge(): void {
  const s = get();
  if (s.phase !== 'story' || !s.challenge) return;
  apply({ phase: 'presenting' });
  introduce();
}

function beginAnswering(): void {
  if (get().phase === 'presenting') apply({ phase: 'answering' });
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

function submitAnswer(answer: Answer, result: CheckResult): void {
  const s = get();
  const record = s.challenge;
  if (!record || !isOpen(s)) return;
  const at = now();
  rt.lastInteractionAt = at;
  flushActive(at);
  const run = withAnswer(runOf(s), answerEvent(answer, result, at));
  if (result.correct) {
    apply(runPatch(run));
    solve();
    return;
  }
  rt.idleOffer = false;
  apply({ ...runPatch(run), phase: 'answering', highlightIds: [] });
  armIdle(at);
  void persistRun();
  void wrongFeedback(record, run, answer, result);
}

/**
 * A wrong try: no cross, no "wrong". Pip looks curious, says something kind
 * and specific, keeps the child's work, and from the second try on offers help.
 */
async function wrongFeedback(record: ChallengeRecord, run: Run, answer: Answer, result: CheckResult): Promise<void> {
  const interaction = record.content.interaction;
  const parts = partsRight(interaction, result);
  const tail = parts ? ` ${t('play.wrong.parts', parts)}` : '';
  const frustrated = !rt.breakShown && detectFrustration(run.answers.map(({ at, correct }) => ({ at, correct })), now());
  const offer = !frustrated && offersHelpAfterWrong(run) ? helpToOffer(run) : null;
  const offerText = offer ? ` ${t(`play.offer.${offer}`)}` : '';

  rt.wrongLines += 1;
  const local = `${t(`play.wrong.${rotate(range(LINE_COUNTS.wrong), rt.wrongLines)}`)}${tail}`;
  playMoods(wrongTryMoods(wrongTriesOf(run)));
  // On screen at once; the tutor's own wording replaces it when it comes quickly.
  const lineId = get().botLineId + 1;
  apply({ botLine: local, botLineId: lineId, botLineSticky: offer !== null, botOffer: offer, helpOffered: offer !== null });

  const controller = new AbortController();
  const reply = await Promise.race([
    askTutor(
      {
        intent: 'wrong-answer',
        hintLevel: hintLevelOf(run),
        misconception: result.misconception,
        wrongAnswerSummary: describeAnswer(interaction, answer),
        signal: controller.signal,
      },
      false,
    ),
    wait(PLAY.feedbackWaitMs).then(() => null),
  ]);
  controller.abort();
  // Something newer is in the bubble (a hint, the solve): this line is history.
  if (get().botLineId !== lineId || get().challenge?.id !== record.id) return;
  const text = reply ? `${reply.say}${tail}` : local;
  botSay(`${text}${offerText}`, 'praise', { voice: 'auto', sticky: offer !== null, offer });

  if (frustrated) {
    rt.breakShown = true;
    apply({ breakOpen: true });
    if (mayVoice('auto')) say(`${t('play.break.title')}. ${t('play.break.text')}`);
  }
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

// ---------------------------------------------------------------------------
// The help ladder
// ---------------------------------------------------------------------------

async function requestHint(): Promise<void> {
  const s = get();
  const record = s.challenge;
  if (!record || !isOpen(s) || s.walkthroughOpen) return;
  touch();
  const { run, level } = withHint(runOf(s));
  rt.idleOffer = false;
  apply({ ...runPatch(run), phase: 'answering', botOffer: null, helpOffered: false });
  void persistRun();
  const reply = await askTutor({ intent: level === 1 ? 'nudge' : 'hint', hintLevel: level });
  if (get().challenge?.id !== record.id || !isOpen(get())) return;
  const line = reply?.say ?? t('play.fallback');
  apply({ highlightIds: highlightsFor(record.content, line, reply?.highlightIds ?? []) });
  botSay(line, 'hint', { voice: 'asked', sticky: true });
}

async function requestWalkthrough(): Promise<void> {
  const s = get();
  const record = s.challenge;
  if (!record || !isOpen(s) || !canWalkthrough(runOf(s))) return;
  touch();
  const run = withWalkthrough(runOf(s));
  rt.idleOffer = false;
  // Whatever face Pip was making, he is the teacher now.
  playMoods([]);
  apply({
    ...runPatch(run),
    phase: 'answering',
    walkthroughText: null,
    botLine: null,
    botOffer: null,
    helpOffered: false,
    highlightIds: [],
  });
  void persistRun();
  await showStep(record, 0);
}

async function showStep(record: ChallengeRecord, step: number): Promise<void> {
  apply({ walkthroughText: null, highlightIds: [] });
  const reply = await askTutor({ intent: 'walkthrough-step', hintLevel: 3, walkthroughStep: step });
  const s = get();
  if (s.challenge?.id !== record.id || !s.walkthroughOpen || s.walkthroughStep !== step) return;
  const line = safeLine(reply?.say ?? record.content.walkthrough[step] ?? t('play.fallback'));
  apply({ walkthroughText: line, highlightIds: highlightsFor(record.content, line, reply?.highlightIds ?? []) });
  logMessage('bot', 'walkthrough', line);
  if (mayVoice('asked')) say(line);
}

async function nextWalkthroughStep(): Promise<void> {
  const s = get();
  const record = s.challenge;
  if (!record || !s.walkthroughOpen || s.thinking) return;
  touch();
  const run = withNextStep(runOf(s), record.content.walkthrough.length);
  if (run.walkthroughOpen) {
    apply(runPatch(run));
    await showStep(record, run.walkthroughStep);
    return;
  }
  // The steps are done. The answer is still the child's to put in.
  apply({ ...runPatch(run), walkthroughText: null, highlightIds: [] });
  botSay(t('play.walk.yourTurn'), 'walkthrough', { voice: 'asked' });
}

async function acceptOffer(): Promise<void> {
  const offer = get().botOffer;
  if (offer === 'walkthrough') await requestWalkthrough();
  else if (offer === 'hint') await requestHint();
}

function dismissBotLine(lineId?: number): void {
  const s = get();
  if (lineId !== undefined && lineId !== s.botLineId) return;
  rt.idleOffer = false;
  apply({ botLine: null, botOffer: null, helpOffered: false });
}

async function askBot(text: string): Promise<void> {
  const s = get();
  const record = s.challenge;
  // Questions come from the microphone or the text box; with both switched off there is nothing to ask with.
  if (!record || s.phase === 'loading' || (!s.controls?.microphone && !s.controls?.openChat)) return;
  const said = Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, PLAY.chatMaxLength).join('');
  if (said === '') return;
  touch();
  logMessage('child', 'chat', said);
  const reply = await askTutor({ intent: 'chat', hintLevel: get().hintLevel, childText: said });
  if (get().challenge?.id !== record.id) return;
  const line = reply?.say ?? t('play.fallback');
  botSay(line, reply?.redirected ? 'redirect' : 'chat', { voice: 'asked', sticky: true });
}

function requestRead(): void {
  const s = get();
  const record = s.challenge;
  if (!record) return;
  touch();
  if (s.phase === 'story' && s.story) readAloud(`${s.story.heading}. ${s.story.narrative}`, 'asked');
  else if (s.phase === 'solved' || s.phase === 'teachback' || s.phase === 'recorded') readAloud(record.content.explanation, 'asked');
  else readAloud(record.content.readAloud, 'asked');
}

function stopReading(): void {
  rt.speakSeq += 1;
  stopSpeaking();
  usePlaySession.setState({ reading: false });
}

function setMuted(muted: boolean): void {
  const childId = get().childId;
  apply({ muted });
  if (muted) stopReading();
  if (childId) void quiet(db.kv.put({ key: mutedKey(childId), value: muted }));
}

function setVoiceRate(rate: number): void {
  const childId = get().childId;
  const voiceRate = rate <= (PLAY.slowRate + PLAY.normalRate) / 2 ? PLAY.slowRate : PLAY.normalRate;
  apply({ voiceRate });
  if (childId) void quiet(updateChild(childId, { voiceRate }));
}

// ---------------------------------------------------------------------------
// Solved, teach-back, recorded
// ---------------------------------------------------------------------------

function solve(): void {
  const s = get();
  const record = s.challenge;
  if (!record) return;
  stopActive(now());
  if (rt.idleTimer !== null) clearTimeout(rt.idleTimer);
  rt.idleTimer = null;
  rt.idleOffer = false;
  const run = runOf(s);
  const outcome = outcomeOfRun(run);
  const passed = checkPassed(record.purpose, outcome);
  const willTeachBack = shouldTeachBack({
    challenge: record.content,
    walkthroughUsed: run.walkthroughUsed,
    purpose: record.purpose,
    roll: deps.random(),
  });
  playMoods([{ state: passed ? 'proud' : 'celebrating', ms: 2800 }]);
  apply({
    phase: 'solved',
    celebrate: s.celebrate + 1,
    solvedOutcome: outcome,
    checkPassed: passed,
    willTeachBack,
    walkthroughOpen: false,
    walkthroughText: null,
    highlightIds: [],
    botLine: null,
    botOffer: null,
    helpOffered: false,
    breakOpen: false,
  });
  void praise(record);
  // Without a teach-back there is nothing left to wait for: the attempt is stored at once.
  if (!willTeachBack) void recordOnce(null);
}

async function praise(record: ChallengeRecord): Promise<void> {
  const reply = await askTutor({ intent: 'praise', hintLevel: get().hintLevel }, false);
  if (!reply || get().challenge?.id !== record.id) return;
  const line = safeLine(reply.say);
  logMessage('bot', 'praise', line);
  if (mayVoice('auto')) say(line);
}

function continueAfterSolved(): void {
  const s = get();
  const teachBack = s.challenge?.content.teachBack;
  if (s.phase !== 'solved') return;
  if (!s.willTeachBack || !teachBack) {
    void recordOnce(null);
    return;
  }
  apply({ phase: 'teachback', teachBack: { chosenId: null, correct: null, feedback: null } });
  const line = safeLine(teachBack.prompt);
  logMessage('bot', 'teachback', line);
  if (mayVoice('auto')) say(line);
}

async function answerTeachBack(optionId: string): Promise<void> {
  const s = get();
  const record = s.challenge;
  const option = record?.content.teachBack?.options.find((candidate) => candidate.id === optionId);
  if (!record || !option || s.phase !== 'teachback' || s.teachBack?.chosenId) return;
  apply({ teachBack: { chosenId: option.id, correct: option.correct, feedback: null } });
  logMessage('child', 'teachback', option.label);
  playMoods([{ state: 'happy', ms: 2400 }]);
  const recorded = recordOnce(option.correct);
  const reply = await askTutor({ intent: 'teachback-feedback', hintLevel: get().hintLevel, childText: option.id });
  if (get().challenge?.id === record.id) {
    const line = safeLine(reply?.say ?? t('play.teach.thanks'));
    usePlaySession.setState({ teachBack: { chosenId: option.id, correct: option.correct, feedback: line } });
    logMessage('bot', 'teachback', line);
    if (mayVoice('auto')) say(line);
  }
  await recorded;
}

/** Stores the attempt. However often it is asked for, one challenge is recorded once. */
function recordOnce(teachBackCorrect: boolean | null): Promise<void> {
  if (rt.record) return rt.record;
  const s = get();
  if (!s.challenge || !isSolved(runOf(s))) return Promise.resolve();
  rt.record = finishAttempt(attemptInput(s.challenge, runOf(s), teachBackCorrect, rt.activeMs), rt.token, rt.context);
  return rt.record;
}

function recordIfSolved(): Promise<void> {
  const s = get();
  if (s.phase !== 'solved' && s.phase !== 'teachback') return Promise.resolve();
  return recordOnce(s.teachBack?.correct ?? null);
}

async function finishAttempt(input: AttemptInput, token: number, context: ChildContext | null): Promise<void> {
  const { challenge } = input;
  const childId = challenge.childId;
  // `recordAttempt` is one transaction and idempotent per challenge, so a second go after a failure is safe.
  let result: AttemptResult | null = null;
  for (let go = 0; go < 2 && result === null; go += 1) {
    result = (await quiet(recordAttempt({ ...input, now: now() }))) ?? null;
  }

  let storyEnding: string | null = null;
  if (result) {
    if (challenge.libraryId !== null) await quiet(recordLibraryOutcome(challenge.libraryId, result.attempt.outcome));
    if (result.skillState.checkPending) void prepareConceptCheck(childId, challenge.skillId);
    // After a walkthrough the next item is an easier sibling. Placement keeps its own order of items.
    if (input.walkthroughUsed && challenge.purpose !== 'placement') {
      rt.sibling = makeSibling(challenge).then(
        () => undefined,
        () => undefined,
      );
    }
    if (challenge.storyId !== null) {
      const story = await quiet(advanceStory(challenge.storyId));
      if (story?.status === 'finished') storyEnding = story.ending;
    }
    void quiet(db.kv.delete(runKey(challenge)));
    if (context) void writeNotesWhenDue(childId, context);
  }
  const allowance = await quiet(getPlayAllowance(childId, now()));
  const placement = challenge.purpose === 'placement' ? await quiet(placementStatus(childId)) : undefined;
  if (token !== rt.token) return;

  const s = get();
  apply({
    phase: 'recorded',
    result,
    rewards: result ? rewardSummary(result) : null,
    starsPending: result ? Math.max(0, result.attempt.starsEarned) : 0,
    allowance: allowance ?? s.allowance,
    placement: placement && !placement.done ? { answered: placement.answered, total: placement.total } : null,
    storyEnding,
    sessionCompleted: s.sessionCompleted + 1,
    // A finished story does not start another one by itself: play goes on as usual.
    ...(storyEnding !== null ? { request: {}, urlReset: s.urlReset + 1 } : {}),
  });
}

/** Every tenth attempt the learner notes are rewritten from the latest twenty. Silent when the AI has nothing to say. */
async function writeNotesWhenDue(childId: string, context: ChildContext): Promise<void> {
  try {
    const count = await db.attempts.where('childId').equals(childId).count();
    if (count === 0 || count % PLAY.notesEvery !== 0) return;
    const recent = await db.attempts
      .where('[childId+completedAt]')
      .between([childId, Dexie.minKey], [childId, Dexie.maxKey])
      .reverse()
      .limit(PLAY.notesAttempts)
      .toArray();
    const challenges = await db.challenges.bulkGet(recent.map((attempt) => attempt.challengeId));
    const attempts = recent.map((attempt, index) => {
      const challenge = challenges[index];
      const grade = stageGrade(challenge?.stage ?? makeStage(context.grade));
      return notesRow(attempt, challenge, getSkill(attempt.skillId)?.name ?? attempt.skillId, grade);
    });
    const notes = await generateLearnerNotes({ child: context, attempts });
    if (!notes) return;
    await db.learnerNotes.put({
      childId,
      summary: notes.summary,
      strengths: notes.strengths,
      struggles: notes.struggles,
      nextFocus: notes.nextFocus,
      attemptsAtUpdate: count,
      updatedAt: now(),
    });
  } catch {
    // Notes are a nicety for the parent; the next round tries again.
  }
}

async function next(): Promise<void> {
  const s = get();
  if (s.phase !== 'recorded' || !s.childId) return;
  // The limit is only ever applied between challenges, never in the middle of one.
  if (s.allowance && !s.allowance.allowed) {
    apply({ exit: restPath(s.childId) });
    return;
  }
  rt.token += 1;
  rt.lastInteractionAt = now();
  await loadChallenge(rt.token);
}

/** Where the home button goes. */
export function playHomePath(childId: string): string {
  return homePath(childId);
}

/** Forgets everything (tests): timers, the session in progress and the injected clock. */
export function resetPlaySession(): void {
  rt.token += 1;
  clearTimers();
  rt.child = null;
  rt.context = null;
  rt.sessionId = null;
  rt.record = null;
  rt.sibling = null;
  rt.thinking = 0;
  rt.activeMs = 0;
  rt.activeMark = null;
  rt.breakShown = false;
  rt.idleOffer = false;
  rt.wrongLines = 0;
  deps = DEFAULT_DEPS;
  usePlaySession.setState({ ...INITIAL });
}

/** Resolves when the attempt of the current challenge has been stored (tests, and before leaving). */
export function recordSettled(): Promise<void> {
  return rt.record ?? Promise.resolve();
}
