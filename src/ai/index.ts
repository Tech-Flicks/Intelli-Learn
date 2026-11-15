/**
 * Public API of the AI service. Other modules import from `@/ai`.
 *
 * Privacy: nothing exported here accepts or reads a child's nickname.
 */
export type {
  ChildContext,
  GenerateChallengeRequest,
  GradeExpectation,
  LearnerNotesAttempt,
  LearnerNotesRequest,
  RemixChallengeRequest,
  StoryChapterContext,
  StoryOutlineRequest,
  TutorIntent,
  TutorRequest,
  WeeklyReportRequest,
} from './types';

export { generateChallenge, remixChallenge } from './generate';
export { tutorReply } from './tutor';
export { generateStoryOutline, generateLearnerNotes, generateWeeklyReport, generateImage } from './extras';
export { localSafetyCheck, checkChallengeSafety } from './safety';
export { getAiStatus, testConnection } from './status';
export { ageStyleCard } from './prompts';

export { AiError, isAiError } from './errors';
export type { AiErrorKind } from './errors';
export type { AiConfigOverride } from './config';
/** True for an address on this device or the home network; such a server needs no API key. */
export { isLocalAddress } from './config';

import { resetClientSession } from './client';
import { resetImageSession } from './extras';
import { resetModerationSession } from './safety';

/**
 * Forgets what was learned about the AI endpoint in this session (which
 * request options it rejects, whether it has a moderation service). Call it
 * after the parent changes the AI settings.
 */
export function resetAiSession(): void {
  resetClientSession();
  resetImageSession();
  resetModerationSession();
}
