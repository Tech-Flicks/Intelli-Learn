/**
 * Request and context types of the AI service (the `@/ai` contract).
 *
 * Privacy: none of these types carries the child's nickname or any other
 * identifying detail, on purpose. Only age group, grade, interests and the
 * learning context ever reach a prompt.
 */
import type { Challenge } from '@/core/schemas';
import type { AgeGroup, AttemptOutcome, ChallengePlan, Grade, Locale, Strand, WeeklyReport } from '@/core/types';

export interface ChildContext {
  ageGroup: AgeGroup;
  grade: Grade;
  interests: string[];
  locale: Locale;
  strictness: 'strict' | 'standard';
}

export interface GradeExpectation {
  grade: Grade;
  text: string;
}

export interface StoryChapterContext {
  title: string;
  heading: string;
  narrative: string;
  illustration: string;
}

export interface GenerateChallengeRequest {
  plan: ChallengePlan;
  child: ChildContext;
  /** Grade expectation text from the skill map for plan.stage. */
  expectation: GradeExpectation;
  skillName: string;
  /** Recent titles, to avoid repeats. */
  avoidTitles?: string[];
  /** Parent thumbs-down notes. */
  avoidNotes?: string[];
  learnerSummary?: string;
  /** Imagination Studio: what the child asked to see. */
  studioIdea?: string;
  story?: StoryChapterContext;
  /** Generate an easier sibling of this item. */
  previousSibling?: { question: string };
  /** plan.purpose === 'check': recent questions on this skill; the new item must test the same concept in a NEW way. */
  conceptCheck?: { previousQuestions: string[] };
  signal?: AbortSignal;
}

export type TutorIntent =
  | 'nudge'
  | 'hint'
  | 'walkthrough-step'
  | 'wrong-answer'
  | 'chat'
  | 'praise'
  | 'teachback-feedback';

export interface TutorRequest {
  child: ChildContext;
  challenge: Challenge;
  /** What the child wants. 'chat' needs childText. */
  intent: TutorIntent;
  hintLevel: 0 | 1 | 2 | 3;
  /** Zero-based index into `challenge.walkthrough` for intent 'walkthrough-step'. */
  walkthroughStep?: number;
  wrongAnswerSummary?: string;
  misconception?: string | null;
  childText?: string;
  openChat: boolean;
  history?: { role: 'child' | 'bot'; text: string }[];
  signal?: AbortSignal;
}

export interface RemixChallengeRequest {
  original: Challenge;
  plan: ChallengePlan;
  child: ChildContext;
  expectation: GradeExpectation;
  skillName: string;
  signal?: AbortSignal;
}

export interface StoryOutlineRequest {
  child: ChildContext;
  theme: string;
  chapters: number;
  signal?: AbortSignal;
}

export interface LearnerNotesAttempt {
  skill: string;
  grade: Grade;
  outcome: AttemptOutcome;
  question: string;
  misconceptions: string[];
}

export interface LearnerNotesRequest {
  child: ChildContext;
  attempts: LearnerNotesAttempt[];
}

export interface WeeklyReportRequest {
  child: ChildContext;
  stats: WeeklyReport['stats'];
  strandStages: { strand: Strand; label: string }[];
  learnerSummary: string;
}
