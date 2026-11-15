/**
 * Turns what happened on a challenge into an outcome, and spots frustration.
 */
import type { AnswerEvent, AttemptOutcome } from '@/core/types';
import { TUNING } from './tuning';

export interface OutcomeInput {
  answers: AnswerEvent[];
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
}

/** How many of the answers were wrong tries. */
export function wrongTries(answers: readonly { correct: boolean }[]): number {
  return answers.reduce((count, answer) => count + (answer.correct ? 0 : 1), 0);
}

/**
 * The most help the child needed decides the outcome: walkthrough, then the
 * strong hint, then the nudge. Without help, any wrong try makes it a
 * 'second-try'; otherwise the child solved it independently.
 */
export function outcomeOf(input: OutcomeInput): AttemptOutcome {
  if (input.walkthroughUsed) return 'walkthrough';
  if (input.hintsUsed >= 2) return 'hint';
  if (input.hintsUsed === 1) return 'nudge';
  if (input.answers.length > 1 || wrongTries(input.answers) > 0) return 'second-try';
  return 'independent';
}

/**
 * True when the answers look like frustration: rapid random tapping (several
 * wrong answers inside a short window) or a long run of wrong answers.
 *
 * Without `now` the whole list is judged (used when an attempt is recorded).
 * With `now`, only answers from the last few minutes count, so a live caller
 * asks "is the child frustrated right now".
 */
export function detectFrustration(recent: { at: number; correct: boolean }[], now?: number): boolean {
  const { rapidWrong, rapidWindowMs, consecutiveWrong, recentWindowMs } = TUNING.frustration;
  const events = (now === undefined ? recent : recent.filter((event) => event.at >= now - recentWindowMs && event.at <= now))
    .slice()
    .sort((a, b) => a.at - b.at);

  let run = 0;
  for (const event of events) {
    run = event.correct ? 0 : run + 1;
    if (run >= consecutiveWrong) return true;
  }

  const wrongTimes = events.filter((event) => !event.correct).map((event) => event.at);
  for (let end = rapidWrong - 1; end < wrongTimes.length; end += 1) {
    const first = wrongTimes[end - (rapidWrong - 1)];
    const last = wrongTimes[end];
    if (first !== undefined && last !== undefined && last - first <= rapidWindowMs) return true;
  }
  return false;
}
