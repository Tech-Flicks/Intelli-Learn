import { describe, expect, it } from 'vitest';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { answerSpace, creditedOutcome, detectFrustration, outcomeOf, wrongTries } from './outcome';
import { right, sampleContent, wrong } from './testing';

const T = 1_000_000;

describe('outcomeOf', () => {
  it('is independent for one correct answer and no help', () => {
    expect(outcomeOf({ answers: [right(T)], hintsUsed: 0, walkthroughUsed: false })).toBe('independent');
  });

  it('is second-try after wrong tries without help', () => {
    expect(outcomeOf({ answers: [wrong(T), right(T + 1)], hintsUsed: 0, walkthroughUsed: false })).toBe('second-try');
    expect(
      outcomeOf({ answers: [wrong(T), wrong(T + 1), wrong(T + 2), right(T + 3)], hintsUsed: 0, walkthroughUsed: false }),
    ).toBe('second-try');
  });

  it('is nudge after hint level 1 and hint after hint level 2', () => {
    expect(outcomeOf({ answers: [right(T)], hintsUsed: 1, walkthroughUsed: false })).toBe('nudge');
    expect(outcomeOf({ answers: [wrong(T), right(T + 1)], hintsUsed: 1, walkthroughUsed: false })).toBe('nudge');
    expect(outcomeOf({ answers: [right(T)], hintsUsed: 2, walkthroughUsed: false })).toBe('hint');
  });

  it('is walkthrough whenever the walkthrough was used', () => {
    expect(outcomeOf({ answers: [right(T)], hintsUsed: 0, walkthroughUsed: true })).toBe('walkthrough');
    expect(outcomeOf({ answers: [wrong(T), right(T + 1)], hintsUsed: 2, walkthroughUsed: true })).toBe('walkthrough');
  });

  it('counts wrong tries', () => {
    expect(wrongTries([wrong(T), wrong(T), right(T)])).toBe(2);
    expect(wrongTries([right(T)])).toBe(0);
  });
});

describe('answerSpace and creditedOutcome', () => {
  const withInteraction = (interaction: unknown, objects: unknown[] = []): Challenge =>
    ChallengeSchema.parse({ ...sampleContent(), interaction, scene: { theme: 'space', objects } });
  const options = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` }));
  const apples = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `a${i}`, type: 'emoji', emoji: '🍎', x: 10 + i * 10, y: 50, tappable: true }));

  it('counts the answers a child could give', () => {
    expect(answerSpace(withInteraction({ kind: 'choice', options: options(2), correctIds: ['o0'] }))).toBe(2);
    expect(answerSpace(withInteraction({ kind: 'choice', options: options(4), correctIds: ['o0'] }))).toBe(4);
    expect(answerSpace(withInteraction({ kind: 'choice', multi: true, options: options(3), correctIds: ['o0', 'o1'] }))).toBe(7);
    expect(answerSpace(withInteraction({ kind: 'tap', targetIds: ['a0'] }, apples(3)))).toBe(3);
    expect(answerSpace(withInteraction({ kind: 'tap', targetIds: ['a0', 'a1'] }, apples(4)))).toBe(6);
    const sort = {
      kind: 'sort',
      bins: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
      items: [{ id: 'i1', label: 'one', binId: 'x' }, { id: 'i2', label: 'two', binId: 'y' }, { id: 'i3', label: 'three', binId: 'y' }],
    };
    expect(answerSpace(withInteraction(sort))).toBe(8);
    const order = { kind: 'order', items: [{ id: 'o1', label: '1' }, { id: 'o2', label: '2' }, { id: 'o3', label: '3' }] };
    expect(answerSpace(withInteraction(order))).toBe(6);
    expect(answerSpace(sampleContent())).toBeGreaterThan(1000);
  });

  it('credits a second try as solved alone only when the wrong try did not give the answer away', () => {
    expect(creditedOutcome('second-try', 1, 4)).toBe('second-try');
    expect(creditedOutcome('second-try', 1, 1_000_000)).toBe('second-try');
    // One wrong try on a two- or three-option item leaves little to choose from.
    expect(creditedOutcome('second-try', 1, 2)).toBe('nudge');
    expect(creditedOutcome('second-try', 1, 3)).toBe('nudge');
    // Trying one option after the other.
    expect(creditedOutcome('second-try', 2, 4)).toBe('nudge');
    expect(creditedOutcome('second-try', 3, 1_000_000)).toBe('nudge');
  });

  it('leaves every other outcome as it is', () => {
    expect(creditedOutcome('independent', 0, 2)).toBe('independent');
    expect(creditedOutcome('nudge', 5, 2)).toBe('nudge');
    expect(creditedOutcome('hint', 5, 2)).toBe('hint');
    expect(creditedOutcome('walkthrough', 5, 2)).toBe('walkthrough');
  });
});

describe('detectFrustration', () => {
  const at = (seconds: number, correct = false) => ({ at: T + seconds * 1000, correct });

  it('is false for no answers and for a few spaced-out wrong tries', () => {
    expect(detectFrustration([])).toBe(false);
    expect(detectFrustration([at(0), at(20), at(40), at(60), at(80, true)])).toBe(false);
  });

  it('is true for four wrong answers inside fifteen seconds', () => {
    expect(detectFrustration([at(0), at(4), at(9), at(15)])).toBe(true);
  });

  it('is false when the fourth wrong answer falls just outside the window', () => {
    expect(detectFrustration([at(0), at(4), at(9), at(15.001)])).toBe(false);
  });

  it('finds a rapid burst anywhere in the list, even with correct answers around it', () => {
    expect(detectFrustration([at(0), at(60, true), at(100), at(102), at(104), at(106), at(200, true)])).toBe(true);
  });

  it('does not count three rapid wrong answers', () => {
    expect(detectFrustration([at(0), at(1), at(2), at(3, true)])).toBe(false);
  });

  it('is true for six wrong answers in a row, however slow', () => {
    const slow = [0, 30, 60, 90, 120, 150].map((s) => at(s));
    expect(detectFrustration(slow)).toBe(true);
    expect(detectFrustration(slow.slice(0, 5))).toBe(false);
  });

  it('starts the run again after a correct answer', () => {
    const events = [at(0), at(30), at(60), at(90, true), at(120), at(150), at(180)];
    expect(detectFrustration(events)).toBe(false);
  });

  it('does not depend on the order of the events', () => {
    expect(detectFrustration([at(15), at(0), at(9), at(4)])).toBe(true);
  });

  it('with now, only looks at the last few minutes', () => {
    const burst = [at(0), at(2), at(4), at(6)];
    expect(detectFrustration(burst, T + 10_000)).toBe(true);
    expect(detectFrustration(burst, T + 10 * 60_000)).toBe(false);
  });
});
