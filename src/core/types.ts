/**
 * Shared domain types for Intelli-Learn.
 *
 * This file is the single source of truth for records stored on the device and
 * for values passed between modules. AI-generated content types (Challenge,
 * Scene, Interaction, ...) are inferred from the zod schemas in `./schemas`.
 */
import type { Challenge } from './schemas';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const AGE_GROUPS = ['3-5', '6-8', '9-11', '12-14'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

/** US school grades. Index in this array is the "grade index" (PK = 0 ... 8 = 9). */
export const GRADES = ['PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8'] as const;
export type Grade = (typeof GRADES)[number];

export const STRANDS = ['math', 'science', 'technology', 'engineering', 'logic'] as const;
export type Strand = (typeof STRANDS)[number];

/** The four steps inside one grade. */
export const STAGE_STEPS = ['starting', 'growing', 'strong', 'ready'] as const;
export type StageStep = (typeof STAGE_STEPS)[number];

/**
 * A learning stage as one integer: `gradeIndex * 4 + stepIndex`.
 * Range 0 (Pre-K, Starting) .. 39 (Grade 8, Ready for next grade).
 * Use the helpers in `./grades` instead of doing the arithmetic by hand.
 */
export type StageValue = number;

/** How the child answers. Each kind has a deterministic checker in `@/engine`. */
export const INTERACTION_KINDS = [
  'choice',
  'tap',
  'sort',
  'match',
  'order',
  'number',
  'robot',
  'build',
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** Creative play modes. A mode is the framing; the interaction is the mechanic. */
export const MODES = [
  'quest', // standard themed challenge
  'story', // Story Quest: branching story, a challenge per chapter
  'experiment', // Experiment Lab: predict, watch, explain
  'robot', // Robot Coder
  'detective', // Mystery Detective
  'fixbot', // Fix the Bot: find the helper's mistake
  'invention', // Invention Workshop
  'wonder', // Wonder of the Day
  'studio', // Imagination Studio
  'mission', // Real-world Mission
] as const;
export type Mode = (typeof MODES)[number];

export const LOCALES = ['en', 'es', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

/** Why this item was chosen for the child. */
export type ItemPurpose = 'placement' | 'core' | 'review' | 'stretch' | 'sibling';

/**
 * How much the child did themselves, best to most-assisted.
 * - independent: correct on the first try with no help
 * - second-try: correct after one or more wrong tries, no help
 * - nudge: correct after hint level 1
 * - hint: correct after hint level 2
 * - walkthrough: completed after the full walkthrough
 */
export type AttemptOutcome = 'independent' | 'second-try' | 'nudge' | 'hint' | 'walkthrough';

// ---------------------------------------------------------------------------
// Settings (single record, id = 'app')
// ---------------------------------------------------------------------------

/** AES-GCM ciphertext, both fields base64. */
export interface EncryptedBlob {
  iv: string;
  data: string;
}

export interface AdminAuth {
  /** base64 salt */
  salt: string;
  /** base64 PBKDF2-SHA256 hash */
  hash: string;
  iterations: number;
  failedAttempts: number;
  /** epoch ms until which unlock attempts are refused, or null */
  lockedUntil: number | null;
}

/**
 * - demo: no AI endpoint. Uses the built-in offline challenge bank only.
 * - direct: the browser calls the OpenAI-compatible endpoint with the stored key.
 * - proxy: the browser calls a same-origin proxy (`baseUrl`, default `/ai-proxy/v1`)
 *          that holds the key server-side. No key is stored on the device.
 */
export type AiProvider = 'demo' | 'direct' | 'proxy';

export interface AiSettings {
  provider: AiProvider;
  /** e.g. https://api.openai.com/v1 (no trailing slash) */
  baseUrl: string;
  /** Encrypted at rest with a non-exportable device key. Null when not set. */
  apiKeyCipher: EncryptedBlob | null;
  chatModel: string;
  /** Empty string = image generation unavailable. */
  imageModel: string;
  temperature: number;
  /** Maximum AI requests per calendar day for the whole device. */
  dailyRequestBudget: number;
  /** Maximum AI requests per calendar month for the whole device. */
  monthlyRequestCap: number;
}

export interface ParentalControls {
  dailyMinutes: number;
  /** Local hour 0-23, inclusive start of allowed play. */
  allowedStartHour: number;
  /** Local hour 1-24, exclusive end of allowed play. */
  allowedEndHour: number;
  strands: Record<Strand, boolean>;
  voiceOutput: boolean;
  microphone: boolean;
  /** Lets the child ask the helper questions beyond the current challenge and use free text in Imagination Studio. */
  openChat: boolean;
  /** AI-generated raster images (story illustrations). */
  aiImages: boolean;
  realWorldMissions: boolean;
  strictness: 'strict' | 'standard';
  keepTranscripts: boolean;
}

export interface AccessibilitySettings {
  dyslexiaFont: boolean;
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  /** Read every screen aloud automatically. */
  readAloud: boolean;
}

export interface Settings {
  id: 'app';
  setupComplete: boolean;
  auth: AdminAuth | null;
  ai: AiSettings;
  controls: ParentalControls;
  /** Interface language. */
  locale: Locale;
  /** Language the AI writes challenges in. */
  contentLocale: Locale;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Child profile
// ---------------------------------------------------------------------------

export interface Companion {
  /** key into the companion catalogue in `@/progression` */
  species: string;
  name: string;
  /** 0 = egg, 1 = hatchling, 2 = junior, 3 = grown, 4 = legendary */
  growth: number;
  xp: number;
}

export interface ChildProfile {
  id: string;
  /** Stays on the device. Never sent to the AI. */
  nickname: string;
  /** emoji used as avatar */
  avatar: string;
  ageGroup: AgeGroup;
  /** Enrolled school grade, chosen by the parent. */
  grade: Grade;
  interests: string[];
  accessibility: AccessibilitySettings;
  /** Per-child overrides of the global parental controls. */
  controlsOverride: Partial<ParentalControls>;
  placementDone: boolean;
  companion: Companion;
  /** Spendable star balance. */
  stars: number;
  /** Lifetime stars earned. */
  totalStars: number;
  /** Keys of collectibles the child owns. */
  collectibles: string[];
  /** TTS speaking rate, 0.6 - 1.4 */
  voiceRate: number;
  streakDays: number;
  /** YYYY-MM-DD of the last day with a completed challenge */
  lastPlayedDay: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Skills and stages
// ---------------------------------------------------------------------------

export interface SkillDef {
  id: string;
  strand: Strand;
  name: string;
  /** One sentence for parents. */
  description: string;
  /**
   * What this skill looks like at each grade. A skill only exists at the grades
   * listed here. Each entry is a concrete, assessable expectation, e.g.
   * "Add and subtract within 20".
   */
  gradeExpectations: Partial<Record<Grade, string>>;
  /** Interaction kinds that suit this skill, best first. */
  interactions: InteractionKind[];
  /** Modes that suit this skill in addition to 'quest'. */
  modes: Mode[];
  /** Skill ids that should be at least 'growing' at the same grade first. */
  prerequisites: string[];
}

export interface SkillState {
  /** `${childId}:${skillId}` */
  id: string;
  childId: string;
  skillId: string;
  strand: Strand;
  stage: StageValue;
  /** 0-100 progress inside the current stage step. */
  mastery: number;
  /** Consecutive items that needed a walkthrough. */
  assistedStreak: number;
  /** Consecutive independent solves. */
  independentStreak: number;
  attempts: number;
  lastPracticedAt: number | null;
  /** Spaced review: epoch ms when this skill is next due, or null. */
  reviewDueAt: number | null;
  /** Current review interval in days (2, 7, 21). */
  reviewIntervalDays: number;
}

export interface StageChange {
  id: string;
  childId: string;
  /** Skill-level change when skillId is set, strand-level change when it is null. */
  skillId: string | null;
  strand: Strand;
  from: StageValue;
  to: StageValue;
  reason: 'placement' | 'mastery' | 'support' | 'parent';
  at: number;
}

// ---------------------------------------------------------------------------
// Challenges, attempts, helper transcript
// ---------------------------------------------------------------------------

/** What the progression service asks the AI service to create. */
export interface ChallengePlan {
  childId: string;
  skillId: string;
  strand: Strand;
  /** Target stage: grade and step the item should be pitched at. */
  stage: StageValue;
  interaction: InteractionKind;
  mode: Mode;
  purpose: ItemPurpose;
  /** One of the child's interests, or a neutral theme. */
  theme: string;
}

export type ChallengeStatus = 'queued' | 'active' | 'completed' | 'discarded';
export type ChallengeSource = 'ai' | 'offline' | 'reused';

export interface ChallengeRecord {
  id: string;
  childId: string;
  skillId: string;
  strand: Strand;
  stage: StageValue;
  interaction: InteractionKind;
  mode: Mode;
  purpose: ItemPurpose;
  theme: string;
  content: Challenge;
  source: ChallengeSource;
  status: ChallengeStatus;
  /** Set when the challenge belongs to a Story Quest. */
  storyId: string | null;
  chapterIndex: number | null;
  /** Parent feedback from the history view. */
  parentRating: 'up' | 'down' | null;
  parentNote: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface AnswerEvent {
  at: number;
  /** The raw answer in the shape documented per interaction kind in `@/engine`. */
  answer: unknown;
  correct: boolean;
  /** Misconception text attached to the chosen wrong option, when known. */
  misconception: string | null;
}

export interface AttemptRecord {
  id: string;
  challengeId: string;
  childId: string;
  skillId: string;
  strand: Strand;
  answers: AnswerEvent[];
  /** Highest hint level given: 0 none, 1 nudge, 2 strong hint. */
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
  /** Result of the teach-it-back moment; null when not shown. */
  teachBackCorrect: boolean | null;
  outcome: AttemptOutcome;
  /** Active time on the challenge in ms. */
  timeMs: number;
  starsEarned: number;
  completedAt: number;
}

export type HelperMessageKind =
  | 'read'
  | 'hint'
  | 'walkthrough'
  | 'chat'
  | 'praise'
  | 'teachback'
  | 'redirect';

export interface HelperMessage {
  id: string;
  childId: string;
  challengeId: string | null;
  role: 'child' | 'bot';
  kind: HelperMessageKind;
  text: string;
  at: number;
}

// ---------------------------------------------------------------------------
// Rewards, sessions, notes, usage, stories, reports
// ---------------------------------------------------------------------------

export type RewardKind = 'star' | 'badge' | 'collectible' | 'companion' | 'streak';

export interface RewardRecord {
  id: string;
  childId: string;
  kind: RewardKind;
  /** Badge key, collectible key, or '' for stars. */
  key: string;
  /** Stars granted (negative when spent on a collectible). */
  amount: number;
  /** Child-friendly reason, e.g. "Solved it on your own!" */
  reason: string;
  at: number;
}

export interface SessionRecord {
  id: string;
  childId: string;
  /** Local calendar day YYYY-MM-DD the session started on. */
  day: string;
  startedAt: number;
  endedAt: number | null;
  /** Milliseconds of active play counted toward the daily limit. */
  activeMs: number;
  itemsCompleted: number;
}

export interface LearnerNotes {
  childId: string;
  /** Plain-language summary for the parent and for future prompts. */
  summary: string;
  strengths: string[];
  struggles: string[];
  nextFocus: string[];
  /** Number of attempts that had been recorded when the notes were written. */
  attemptsAtUpdate: number;
  updatedAt: number;
}

export interface UsageRecord {
  /** Local calendar day YYYY-MM-DD */
  day: string;
  requests: number;
  imageRequests: number;
  promptTokens: number;
  completionTokens: number;
  failures: number;
}

export interface StoryRecord {
  id: string;
  childId: string;
  title: string;
  theme: string;
  /** Narrative per chapter. The challenge for chapter i is the ChallengeRecord with storyId and chapterIndex = i. */
  chapters: { heading: string; narrative: string; imageDataUrl: string | null }[];
  ending: string;
  currentChapter: number;
  status: 'active' | 'finished';
  createdAt: number;
}

export interface WeeklyReport {
  id: string;
  childId: string;
  /** YYYY-MM-DD of the Monday starting the week. */
  weekStart: string;
  headline: string;
  highlights: string[];
  struggles: string[];
  /** Screen-free activities to try together. */
  homeActivities: string[];
  stats: {
    minutes: number;
    completed: number;
    independentShare: number;
    stageUps: number;
  };
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Results passed between modules
// ---------------------------------------------------------------------------

/** Returned by the progression service after an attempt is recorded. */
export interface AttemptResult {
  attempt: AttemptRecord;
  skillState: SkillState;
  masteryDelta: number;
  stageChanges: StageChange[];
  rewards: RewardRecord[];
  /** True when the child should be offered a calmer pace or a break. */
  suggestBreak: boolean;
}

export interface PlayAllowance {
  allowed: boolean;
  reason: 'ok' | 'daily-limit' | 'outside-hours';
  minutesLeft: number;
  minutesUsedToday: number;
}

export interface StrandStage {
  strand: Strand;
  /** Aggregated working stage for the strand, or null when nothing has been practised. */
  stage: StageValue | null;
  practisedSkills: number;
}
