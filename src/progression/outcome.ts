/**
 * Turns what happened on a challenge into an outcome, and spots frustration.
 */
import type { Challenge } from '@/core/schemas';
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

/** Above this an answer cannot be found by trying; the exact count does not matter any more. */
const MANY_ANSWERS = 1_000_000;

function factorial(n: number): number {
  let out = 1;
  for (let i = 2; i <= n && out < MANY_ANSWERS; i += 1) out *= i;
  return Math.min(out, MANY_ANSWERS);
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= Math.min(k, n - k) && out < MANY_ANSWERS; i += 1) out = (out * (n - i + 1)) / i;
  return Math.min(Math.round(out), MANY_ANSWERS);
}

/**
 * How many different answers the child could give to the challenge: the size of
 * the space a guess is drawn from. A two-option choice has 2, a typed number or
 * a robot program has (practically) no end of them.
 */
export function answerSpace(content: Pick<Challenge, 'interaction' | 'scene'>): number {
  const interaction = content.interaction;
  switch (interaction.kind) {
    case 'choice': {
      const options = interaction.options.length;
      return interaction.multi ? Math.min(2 ** options - 1, MANY_ANSWERS) : options;
    }
    case 'tap': {
      const targets = new Set(interaction.targetIds);
      const tappable = content.scene.objects.filter((object) => object.tappable || targets.has(object.id)).length;
      // The question tells how many to tap ("tap the three apples"), so that many are chosen.
      return choose(Math.max(tappable, targets.size), targets.size);
    }
    case 'sort':
      return Math.min(interaction.bins.length ** interaction.items.length, MANY_ANSWERS);
    case 'match':
      return factorial(interaction.pairs.length);
    case 'order':
      return factorial(interaction.items.length);
    case 'number':
    case 'robot':
    case 'build':
      return MANY_ANSWERS;
  }
}

/**
 * The outcome the stage engine gives credit for. It differs from what happened
 * in one case: a 'second-try' only counts as solved alone when the right answer
 * was not simply what was left over. After more than one wrong try, or one wrong
 * try on an item with only two or three possible answers, the child found the
 * answer by ruling the others out, which is worth what a nudge is worth: some
 * mastery, and a concept check that is not passed.
 *
 * The stored attempt keeps the plain outcome, because no help was used.
 */
export function creditedOutcome(outcome: AttemptOutcome, wrong: number, answers: number): AttemptOutcome {
  if (outcome !== 'second-try') return outcome;
  const { secondTryMaxWrong, secondTryMinAnswers } = TUNING.mastery;
  return wrong > secondTryMaxWrong || answers < secondTryMinAnswers ? 'nudge' : 'second-try';
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
