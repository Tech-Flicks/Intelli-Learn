/**
 * Helpers for the data module's own unit tests. Not part of the public API
 * and not imported by application code.
 */
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type {
  AttemptRecord,
  ChallengeRecord,
  HelperMessage,
  LearnerNotes,
  LibraryItem,
  RewardRecord,
  SessionRecord,
  SkillState,
  StageChange,
  StoryRecord,
  WeeklyReport,
} from '@/core/types';
import { db } from './db';

/** Gives each test a brand-new, empty database. */
export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}

export function sampleChallenge(title = 'Count the stars'): Challenge {
  return ChallengeSchema.parse({
    title,
    intro: 'Three stars twinkle over the hill.',
    question: 'How many stars can you see?',
    readAloud: 'Three stars twinkle over the hill. How many stars can you see?',
    interaction: { kind: 'number', answer: 3 },
    hints: ['Count slowly.', 'Point at each star as you count.'],
    walkthrough: ['Point at the first star.', 'Count on: one, two, three.'],
    explanation: 'There are three stars, so the answer is 3.',
    scene: {
      theme: 'space',
      objects: [{ id: 'star-1', type: 'emoji', emoji: '⭐', x: 20, y: 20 }],
    },
  });
}

export function sampleLibraryItem(id: string, patch: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    fingerprint: `fp-${id}`,
    skillId: 'counting',
    strand: 'math',
    stage: 4,
    grade: 'K',
    interaction: 'number',
    mode: 'quest',
    theme: 'space',
    ageGroup: '3-5',
    locale: 'en',
    content: sampleChallenge(),
    origin: 'ai',
    remixOf: null,
    rating: null,
    ratingNote: '',
    retired: false,
    seenBy: [],
    uses: 0,
    independentSolves: 0,
    assistedSolves: 0,
    createdAt: 1_700_000_000_000,
    lastUsedAt: null,
    ...patch,
  };
}

/**
 * Writes one row into every child data table for the given child and returns
 * how many rows that was. `libraryId` links the challenge to a library item.
 */
export async function seedChildData(childId: string, libraryId: string | null = null): Promise<number> {
  const at = 1_700_000_000_000;
  const skillState: SkillState = {
    id: `${childId}:counting`,
    childId,
    skillId: 'counting',
    strand: 'math',
    stage: 4,
    mastery: 55,
    assistedStreak: 0,
    independentStreak: 2,
    attempts: 3,
    checkPending: false,
    checksPassed: 1,
    recentInteractions: ['number', 'choice'],
    lastPracticedAt: at,
    reviewDueAt: null,
    reviewIntervalDays: 2,
  };
  const stageChange: StageChange = {
    id: `sc-${childId}`,
    childId,
    skillId: 'counting',
    strand: 'math',
    from: 3,
    to: 4,
    reason: 'mastery',
    at,
  };
  const challenge: ChallengeRecord = {
    id: `ch-${childId}`,
    childId,
    skillId: 'counting',
    strand: 'math',
    stage: 4,
    interaction: 'number',
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
    content: sampleChallenge(),
    source: libraryId ? 'reused' : 'offline',
    status: 'completed',
    storyId: null,
    chapterIndex: null,
    libraryId,
    parentRating: 4,
    parentNote: 'Nice one',
    createdAt: at,
    startedAt: at,
    completedAt: at + 60_000,
  };
  const attempt: AttemptRecord = {
    id: `at-${childId}`,
    challengeId: challenge.id,
    childId,
    skillId: 'counting',
    strand: 'math',
    answers: [
      { at, answer: 2, correct: false, misconception: null },
      { at: at + 5_000, answer: 3, correct: true, misconception: null },
    ],
    hintsUsed: 1,
    walkthroughUsed: false,
    teachBackCorrect: null,
    outcome: 'nudge',
    timeMs: 42_000,
    starsEarned: 2,
    completedAt: at + 60_000,
  };
  const message: HelperMessage = {
    id: `msg-${childId}`,
    childId,
    challengeId: challenge.id,
    role: 'bot',
    kind: 'hint',
    text: 'Count slowly.',
    at,
  };
  const reward: RewardRecord = {
    id: `rw-${childId}`,
    childId,
    kind: 'star',
    key: '',
    amount: 2,
    reason: 'Solved it!',
    at,
  };
  const session: SessionRecord = {
    id: `se-${childId}`,
    childId,
    day: '2023-11-14',
    startedAt: at,
    endedAt: at + 600_000,
    activeMs: 300_000,
    itemsCompleted: 1,
  };
  const notes: LearnerNotes = {
    childId,
    summary: 'Counts confidently to ten.',
    strengths: ['counting'],
    struggles: [],
    nextFocus: ['adding'],
    attemptsAtUpdate: 1,
    updatedAt: at,
  };
  const story: StoryRecord = {
    id: `st-${childId}`,
    childId,
    title: 'The Star Garden',
    theme: 'space',
    chapters: [{ heading: 'Lift-off', narrative: 'The rocket hums.', imageDataUrl: 'data:image/png;base64,AAAA' }],
    ending: 'Everyone got home safely.',
    currentChapter: 0,
    status: 'active',
    createdAt: at,
  };
  const report: WeeklyReport = {
    id: `wr-${childId}`,
    childId,
    weekStart: '2023-11-13',
    headline: 'A great week',
    highlights: ['Counted to ten'],
    struggles: [],
    homeActivities: ['Count the stairs together'],
    stats: { minutes: 30, completed: 1, independentShare: 0.5, stageUps: 1 },
    createdAt: at,
  };

  await db.skillStates.put(skillState);
  await db.stageChanges.put(stageChange);
  await db.challenges.put(challenge);
  await db.attempts.put(attempt);
  await db.messages.put(message);
  await db.rewards.put(reward);
  await db.sessions.put(session);
  await db.learnerNotes.put(notes);
  await db.stories.put(story);
  await db.weeklyReports.put(report);
  return 10;
}
