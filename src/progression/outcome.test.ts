import { describe, expect, it } from 'vitest';
import { detectFrustration, outcomeOf, wrongTries } from './outcome';
import { right, wrong } from './testing';

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
