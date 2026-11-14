/**
 * Runtime shapes of the records a backup file may contain.
 *
 * A backup is a file a parent picks from disk, so it is untrusted input:
 * every row is parsed with these schemas before anything is written to the
 * database. Unknown fields are stripped, wrong types are rejected.
 *
 * Each schema is annotated with its record type from `@/core/types`, so the
 * compiler flags a schema that drifts from the type it guards.
 */
import { z } from 'zod';
import { ChallengeSchema } from '@/core/schemas';
import { AGE_GROUPS, GRADES, INTERACTION_KINDS, LOCALES, MODES, STRANDS } from '@/core/types';
import type {
  AttemptRecord,
  ChallengeRecord,
  ChildProfile,
  HelperMessage,
  LearnerNotes,
  LibraryItem,
  ParentalControls,
  RewardRecord,
  SessionRecord,
  SkillState,
  StageChange,
  StoryRecord,
  WeeklyReport,
} from '@/core/types';
import type { CHILD_TABLES } from './db';

export type ChildTableName = (typeof CHILD_TABLES)[number];

const id = z.string().min(1).max(200);
const num = z.number(); // zod numbers are always finite
const count = z.number().min(0);
const time = z.number().min(0);
const text = z.string();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a day like 2026-01-31');
const strand = z.enum(STRANDS);
const stage = z.number().int().min(0).max(GRADES.length * 4 - 1);
const interaction = z.enum(INTERACTION_KINDS);
const mode = z.enum(MODES);
/** Parent rating in stars. */
const rating = z.number().min(1).max(5);

const controlsObject = z.object({
  dailyMinutes: z.number().min(0).max(24 * 60),
  allowedStartHour: z.number().int().min(0).max(23),
  allowedEndHour: z.number().int().min(1).max(24),
  strands: z.record(strand, z.boolean()),
  voiceOutput: z.boolean(),
  microphone: z.boolean(),
  openChat: z.boolean(),
  aiImages: z.boolean(),
  realWorldMissions: z.boolean(),
  strictness: z.enum(['strict', 'standard']),
  keepTranscripts: z.boolean(),
});
export const ParentalControlsSchema: z.ZodType<ParentalControls> = controlsObject;

/** The only part of a backed-up settings record that is ever read back. */
export const BackupSettingsSchema = z.object({ controls: ParentalControlsSchema });

const ChildProfileSchema: z.ZodType<ChildProfile> = z.object({
  id,
  nickname: z.string().trim().min(1).max(40),
  avatar: z.string().trim().min(1).max(16),
  ageGroup: z.enum(AGE_GROUPS),
  grade: z.enum(GRADES),
  interests: z.array(z.string().trim().min(1).max(60)).max(16),
  accessibility: z.object({
    dyslexiaFont: z.boolean(),
    largeText: z.boolean(),
    highContrast: z.boolean(),
    reducedMotion: z.boolean(),
    readAloud: z.boolean(),
  }),
  controlsOverride: controlsObject.partial(),
  placementDone: z.boolean(),
  companion: z.object({
    species: z.string().min(1).max(40),
    name: z.string().max(100),
    growth: z.number().min(0).max(4),
    xp: count,
  }),
  stars: count,
  totalStars: count,
  collectibles: z.array(z.string().min(1).max(80)),
  voiceRate: z.number().min(0.1).max(4),
  streakDays: count,
  lastPlayedDay: day.nullable(),
  createdAt: time,
});

const SkillStateSchema: z.ZodType<SkillState> = z.object({
  id,
  childId: id,
  skillId: id,
  strand,
  stage,
  mastery: num,
  assistedStreak: count,
  independentStreak: count,
  attempts: count,
  checkPending: z.boolean(),
  checksPassed: count,
  recentInteractions: z.array(interaction).max(16),
  lastPracticedAt: time.nullable(),
  reviewDueAt: time.nullable(),
  reviewIntervalDays: count,
});

const StageChangeSchema: z.ZodType<StageChange> = z.object({
  id,
  childId: id,
  skillId: id.nullable(),
  strand,
  from: stage,
  to: stage,
  reason: z.enum(['placement', 'mastery', 'support', 'parent']),
  at: time,
});

const ChallengeRecordSchema: z.ZodType<ChallengeRecord> = z.object({
  id,
  childId: id,
  skillId: id,
  strand,
  stage,
  interaction,
  mode,
  purpose: z.enum(['placement', 'core', 'review', 'stretch', 'sibling', 'check']),
  theme: text,
  // The same schema every AI-written challenge has to pass before it is stored.
  content: ChallengeSchema,
  source: z.enum(['ai', 'offline', 'reused']),
  status: z.enum(['queued', 'active', 'completed', 'discarded']),
  storyId: id.nullable(),
  chapterIndex: z.number().int().min(0).nullable(),
  libraryId: id.nullable(),
  parentRating: rating.nullable(),
  parentNote: text,
  createdAt: time,
  startedAt: time.nullable(),
  completedAt: time.nullable(),
});

const AttemptRecordSchema: z.ZodType<AttemptRecord> = z.object({
  id,
  challengeId: id,
  childId: id,
  skillId: id,
  strand,
  answers: z.array(
    z.object({
      at: time,
      // Shape depends on the interaction kind; `@/engine` re-checks it when it is read.
      answer: z.unknown(),
      correct: z.boolean(),
      misconception: text.nullable(),
    }),
  ),
  hintsUsed: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  walkthroughUsed: z.boolean(),
  teachBackCorrect: z.boolean().nullable(),
  outcome: z.enum(['independent', 'second-try', 'nudge', 'hint', 'walkthrough']),
  timeMs: count,
  starsEarned: count,
  completedAt: time,
});

const HelperMessageSchema: z.ZodType<HelperMessage> = z.object({
  id,
  childId: id,
  challengeId: id.nullable(),
  role: z.enum(['child', 'bot']),
  kind: z.enum(['read', 'hint', 'walkthrough', 'chat', 'praise', 'teachback', 'redirect']),
  text,
  at: time,
});

const RewardRecordSchema: z.ZodType<RewardRecord> = z.object({
  id,
  childId: id,
  kind: z.enum(['star', 'badge', 'collectible', 'companion', 'streak']),
  key: text,
  amount: num, // negative when stars were spent
  reason: text,
  at: time,
});

const SessionRecordSchema: z.ZodType<SessionRecord> = z.object({
  id,
  childId: id,
  day,
  startedAt: time,
  endedAt: time.nullable(),
  activeMs: count,
  itemsCompleted: count,
});

const LearnerNotesSchema: z.ZodType<LearnerNotes> = z.object({
  childId: id,
  summary: text,
  strengths: z.array(text),
  struggles: z.array(text),
  nextFocus: z.array(text),
  attemptsAtUpdate: count,
  updatedAt: time,
});

const StoryRecordSchema: z.ZodType<StoryRecord> = z.object({
  id,
  childId: id,
  title: text,
  theme: text,
  chapters: z.array(
    z.object({
      heading: text,
      narrative: text,
      // Embedded pictures only. A remote URL here would make the app fetch from a third party.
      imageDataUrl: z.string().startsWith('data:image/', 'must be an embedded image').nullable(),
    }),
  ),
  ending: text,
  currentChapter: z.number().int().min(0),
  status: z.enum(['active', 'finished']),
  createdAt: time,
});

const WeeklyReportSchema: z.ZodType<WeeklyReport> = z.object({
  id,
  childId: id,
  weekStart: day,
  headline: text,
  highlights: z.array(text),
  struggles: z.array(text),
  homeActivities: z.array(text),
  stats: z.object({
    minutes: count,
    completed: count,
    independentShare: num,
    stageUps: count,
  }),
  createdAt: time,
});

export const LIBRARY_ROW_SCHEMA: z.ZodType<LibraryItem> = z.object({
  id,
  fingerprint: z.string().min(1).max(200),
  skillId: id,
  strand,
  stage,
  grade: z.enum(GRADES),
  interaction,
  mode,
  theme: text,
  ageGroup: z.enum(AGE_GROUPS),
  locale: z.enum(LOCALES),
  content: ChallengeSchema,
  origin: z.enum(['ai', 'remix']),
  remixOf: id.nullable(),
  rating: rating.nullable(),
  ratingNote: text,
  retired: z.boolean(),
  seenBy: z.array(id),
  uses: count,
  independentSolves: count,
  assistedSolves: count,
  createdAt: time,
  lastUsedAt: time.nullable(),
});

export const CHILDREN_ROW_SCHEMA = ChildProfileSchema;

/** Row schema for every table in `CHILD_TABLES`. Adding a table there without a schema here is a compile error. */
export const CHILD_ROW_SCHEMAS: { [K in ChildTableName]: z.ZodType<{ childId: string }> } = {
  skillStates: SkillStateSchema,
  stageChanges: StageChangeSchema,
  challenges: ChallengeRecordSchema,
  attempts: AttemptRecordSchema,
  messages: HelperMessageSchema,
  rewards: RewardRecordSchema,
  sessions: SessionRecordSchema,
  learnerNotes: LearnerNotesSchema,
  stories: StoryRecordSchema,
  weeklyReports: WeeklyReportSchema,
};
