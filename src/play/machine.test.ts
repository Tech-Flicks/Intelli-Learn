import { describe, expect, it } from 'vitest';
import type { PipState } from '@/bot';
import type { AttemptResult } from '@/core/types';
import {
  PLAY,
  answerEvent,
  attemptInput,
  baseBotState,
  canWalkthrough,
  checkPassed,
  describeAnswer,
  frameOf,
  freshRun,
  helpToOffer,
  highlightsFor,
  hintLevelOf,
  isSolved,
  lastResortPlan,
  namedObjectIds,
  notesRow,
  offersHelpAfterWrong,
  outcomeOfRun,
  parseRequest,
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
  type BotView,
  type Run,
} from './machine';
import { CHOICE, NUMBER, ORDER, TEACH_BACK, makeContent, makeRecord } from './testing/support';

const wrong = (at = 1) => answerEvent(['a'], { correct: false, misconception: 'One is hiding.', progress: 0 }, at);
const right = (at = 2) => answerEvent(['b'], { correct: true, misconception: null, progress: 1 }, at);

function after(...steps: ((run: Run) => Run)[]): Run {
  return steps.reduce((run, step) => step(run), freshRun());
}
const hint = (run: Run): Run => withHint(run).run;
const miss = (run: Run): Run => withAnswer(run, wrong());
const hit = (run: Run): Run => withAnswer(run, right());

describe('tracking the outcome', () => {
  it('names how the child got there', () => {
    expect(outcomeOfRun(after(hit))).toBe('independent');
    expect(outcomeOfRun(after(miss, hit))).toBe('second-try');
    expect(outcomeOfRun(after(miss, hint, hit))).toBe('nudge');
    expect(outcomeOfRun(after(hint, hint, hit))).toBe('hint');
    expect(outcomeOfRun(after(hint, hint, withWalkthrough, hit))).toBe('walkthrough');
  });

  it('keeps every answer and counts the wrong tries', () => {
    const run = after(miss, miss, hit);
    expect(run.answers).toHaveLength(3);
    expect(run.answers[0]).toEqual({ at: 1, answer: ['a'], correct: false, misconception: 'One is hiding.' });
    expect(wrongTriesOf(run)).toBe(2);
    expect(isSolved(run)).toBe(true);
  });

  it('takes no more answers once the challenge is solved', () => {
    const solved = after(hit);
    expect(withAnswer(solved, wrong(9))).toBe(solved);
  });
});

describe('the help ladder', () => {
  it('goes up one level per request and never past the strong hint', () => {
    const first = withHint(freshRun());
    expect(first.level).toBe(1);
    expect(hintLevelOf(first.run)).toBe(1);
    const second = withHint(first.run);
    expect(second.level).toBe(2);
    expect(hintLevelOf(second.run)).toBe(2);
    const third = withHint(second.run);
    expect(third.level).toBe(2);
    expect(hintLevelOf(third.run)).toBe(2);
    expect(third.run.walkthroughUsed).toBe(false);
  });

  it('cannot jump to the walkthrough', () => {
    expect(canWalkthrough(freshRun())).toBe(false);
    expect(withWalkthrough(freshRun())).toEqual(freshRun());
    const oneHint = after(hint);
    expect(canWalkthrough(oneHint)).toBe(false);
    expect(withWalkthrough(oneHint)).toBe(oneHint);
    expect(hintLevelOf(withWalkthrough(oneHint))).toBe(1);
  });

  it('opens "Show me how" after the strong hint or after three wrong tries', () => {
    expect(canWalkthrough(after(hint, hint))).toBe(true);
    expect(canWalkthrough(after(miss, miss))).toBe(false);
    expect(canWalkthrough(after(miss, miss, miss))).toBe(true);
    expect(hintLevelOf(after(miss, miss, miss, withWalkthrough))).toBe(3);
  });

  it('shows the steps one at a time, and then the child still answers', () => {
    let run = after(hint, hint, withWalkthrough);
    expect(run).toMatchObject({ walkthroughOpen: true, walkthroughStep: 0, walkthroughUsed: true });
    run = withNextStep(run, 3);
    expect(run).toMatchObject({ walkthroughOpen: true, walkthroughStep: 1 });
    run = withNextStep(run, 3);
    expect(run).toMatchObject({ walkthroughOpen: true, walkthroughStep: 2 });
    run = withNextStep(run, 3);
    expect(run.walkthroughOpen).toBe(false);
    // Nothing was answered for the child.
    expect(isSolved(run)).toBe(false);
    expect(run.answers).toHaveLength(0);
    const solved = withAnswer(run, right());
    expect(isSolved(solved)).toBe(true);
    expect(outcomeOfRun(solved)).toBe('walkthrough');
  });

  it('does nothing on "Next step" while no walkthrough is open', () => {
    const run = freshRun();
    expect(withNextStep(run, 3)).toBe(run);
  });

  it('offers help from the second wrong try on, one rung at a time', () => {
    expect(offersHelpAfterWrong(after(miss))).toBe(false);
    expect(offersHelpAfterWrong(after(miss, miss))).toBe(true);
    expect(helpToOffer(after(miss, miss))).toBe('hint');
    expect(helpToOffer(after(miss, miss, hint))).toBe('hint');
    expect(helpToOffer(after(miss, miss, hint, hint))).toBe('walkthrough');
    expect(helpToOffer(after(hint, hint, withWalkthrough))).toBeNull();
    expect(helpToOffer(after(hit))).toBeNull();
  });
});

describe('framing', () => {
  it('frames a concept check, the placement game and a story chapter', () => {
    expect(frameOf({ purpose: 'check', storyId: null })).toBe('check');
    expect(frameOf({ purpose: 'placement', storyId: null })).toBe('placement');
    expect(frameOf({ purpose: 'core', storyId: 'st1' })).toBe('story');
    expect(frameOf({ purpose: 'core', storyId: null })).toBe('plain');
  });

  it('passes a concept check only without help', () => {
    expect(checkPassed('check', 'independent')).toBe(true);
    expect(checkPassed('check', 'second-try')).toBe(true);
    expect(checkPassed('check', 'nudge')).toBe(false);
    expect(checkPassed('check', 'walkthrough')).toBe(false);
    expect(checkPassed('core', 'independent')).toBe(false);
  });

  it('asks for a teach-back after a walkthrough, on a check, and about one time in three', () => {
    const challenge = makeContent(CHOICE, { teachBack: TEACH_BACK });
    expect(shouldTeachBack({ challenge, walkthroughUsed: true, purpose: 'core', roll: 0.99 })).toBe(true);
    expect(shouldTeachBack({ challenge, walkthroughUsed: false, purpose: 'check', roll: 0.99 })).toBe(true);
    expect(shouldTeachBack({ challenge, walkthroughUsed: false, purpose: 'core', roll: 0.2 })).toBe(true);
    expect(shouldTeachBack({ challenge, walkthroughUsed: false, purpose: 'core', roll: 0.5 })).toBe(false);
    expect(shouldTeachBack({ challenge: makeContent(), walkthroughUsed: true, purpose: 'check', roll: 0 })).toBe(false);
  });

  it('reads the request from the address and drops what it does not know', () => {
    expect(parseRequest(new URLSearchParams('mode=robot&strand=math'))).toEqual({ mode: 'robot', strand: 'math' });
    expect(parseRequest(new URLSearchParams('mode=skip&strand=cheats'))).toEqual({});
    expect(parseRequest(new URLSearchParams('mode=studio&idea=  a   dragon  '))).toEqual({ mode: 'studio', idea: 'a dragon' });
    expect(parseRequest(new URLSearchParams('mode=quest&idea=a dragon'))).toEqual({ mode: 'quest' });
    expect(parseRequest(new URLSearchParams(`mode=studio&idea=${'x'.repeat(200)}`)).idea).toHaveLength(80);
  });
});

describe('words about an answer', () => {
  it('counts the parts that are right, for the kinds with several parts', () => {
    const order = makeContent(ORDER).interaction;
    expect(partsRight(order, { correct: false, progress: 0.5 })).toEqual({ right: 2, total: 4 });
    expect(partsRight(order, { correct: false, progress: 0 })).toBeNull();
    expect(partsRight(order, { correct: true, progress: 1 })).toBeNull();
    expect(partsRight(makeContent(CHOICE).interaction, { correct: false, progress: 0.5 })).toBeNull();
  });

  it('describes an answer with the labels of the challenge only', () => {
    expect(describeAnswer(makeContent(CHOICE).interaction, ['a'])).toBe('Three');
    expect(describeAnswer(makeContent(NUMBER).interaction, 7)).toBe('7');
    expect(describeAnswer(makeContent(ORDER).interaction, ['o2', 'o1'])).toBe('Caterpillar > Egg');
    expect(describeAnswer(makeContent(NUMBER).interaction, 'seven')).toBe('');
  });

  it('lets named scene objects glow, but never a tap target', () => {
    const scene = {
      theme: 'plain',
      objects: [
        { id: 'basket', type: 'emoji', emoji: '🧺', x: 20, y: 50, label: 'Basket' },
        { id: 'apple1', type: 'emoji', emoji: '🍎', x: 50, y: 50, label: 'Apple', tappable: true },
      ],
    };
    const choice = makeContent(CHOICE, { scene });
    expect(namedObjectIds(choice, 'Look at the basket first.')).toEqual(['basket']);
    expect(highlightsFor(choice, 'Look at the apple.', ['basket', 'ghost'])).toEqual(['basket', 'apple1']);
    const tap = makeContent({ kind: 'tap', targetIds: ['apple1'] }, { scene });
    expect(highlightsFor(tap, 'Find the apple next to the basket.', ['apple1'])).toEqual(['basket']);
  });

  it('rotates through lines', () => {
    expect([0, 1, 2, 3, 4].map((turn) => rotate(['a', 'b', 'c'], turn))).toEqual(['a', 'b', 'c', 'a', 'b']);
    expect(rotate(['a', 'b', 'c'], -1)).toBe('c');
  });
});

describe('Pip', () => {
  const view: BotView = {
    phase: 'answering',
    thinking: false,
    mood: null,
    walkthroughOpen: false,
    checkPassed: false,
    waiting: false,
    resting: false,
    minutesLeft: null,
  };

  it('mirrors what is going on', () => {
    expect(baseBotState({ ...view, phase: 'loading' })).toBe('thinking');
    expect(baseBotState({ ...view, thinking: true })).toBe('thinking');
    expect(baseBotState({ ...view, phase: 'story' })).toBe('storytelling');
    expect(baseBotState({ ...view, walkthroughOpen: true })).toBe('teaching');
    expect(baseBotState({ ...view, phase: 'solved', mood: 'celebrating' })).toBe('celebrating');
    expect(baseBotState({ ...view, phase: 'recorded', checkPassed: true })).toBe('proud');
    expect(baseBotState({ ...view, phase: 'recorded' })).toBe('happy');
    expect(baseBotState({ ...view, waiting: true })).toBe('waiting');
    expect(baseBotState({ ...view, minutesLeft: 2 })).toBe('tired');
    expect(baseBotState({ ...view, minutesLeft: PLAY.tiredMinutes })).toBe('idle');
    expect(baseBotState(view)).toBe('idle');
  });

  it('is never angry, whatever mood is asked for', () => {
    expect(baseBotState({ ...view, mood: 'angry' })).toBe('idle');
  });

  it('never answers a wrong try with an angry or startled face', () => {
    const faces = new Set<PipState>();
    for (let tries = 1; tries <= 12; tries += 1) for (const step of wrongTryMoods(tries)) faces.add(step.state);
    expect(faces.has('angry')).toBe(false);
    expect(faces.has('jump_scared')).toBe(false);
    expect([...faces].sort()).toEqual(['curious', 'happy', 'sad']);
    // The soft "aww" turns into encouragement at once.
    expect(wrongTryMoods(3).map((step) => step.state)).toEqual(['sad', 'happy']);
  });
});

describe('recording', () => {
  it('builds the attempt from the run, with whole milliseconds of active time', () => {
    const record = makeRecord('kid1');
    const run = after(miss, hint, hit);
    expect(attemptInput(record, run, true, 1234.6)).toEqual({
      challenge: record,
      answers: run.answers,
      hintsUsed: 1,
      walkthroughUsed: false,
      teachBackCorrect: true,
      timeMs: 1235,
    });
    expect(attemptInput(record, run, null, Number.NaN).timeMs).toBe(0);
    expect(attemptInput(record, run, null, -5).timeMs).toBe(0);
  });

  it('shows only good news in the reward moment', () => {
    const result = {
      attempt: { starsEarned: 2, outcome: 'nudge', teachBackCorrect: true },
      skillState: {},
      masteryDelta: 4,
      stageChanges: [
        { strand: 'math', skillId: null, from: 2, to: 2.5, reason: 'check' },
        { strand: 'science', skillId: null, from: 3, to: 2.5, reason: 'support' },
        { strand: 'math', skillId: 'math-place-value', from: 2, to: 3, reason: 'check' },
      ],
      rewards: [
        { kind: 'badge', key: 'first-spark', reason: 'You finished your first challenge!' },
        { kind: 'companion', key: 'stage-2', reason: '' },
        { kind: 'streak', key: '3', reason: '' },
      ],
      suggestBreak: false,
    } as unknown as AttemptResult;
    expect(rewardSummary(result)).toEqual({
      stars: 2,
      outcome: 'nudge',
      teachBonus: true,
      badges: [{ key: 'first-spark', reason: 'You finished your first challenge!' }],
      companionGrew: true,
      stageUps: [{ strand: 'math', to: 2.5 }],
      streakDays: 3,
      placementFinished: false,
      suggestBreak: false,
    });
  });

  it('gives the learner notes no name and no id', () => {
    const record = makeRecord('kid1');
    const row = notesRow(
      { skillId: record.skillId, outcome: 'second-try', answers: [wrong(), wrong(), right()] },
      record,
      'Adding and subtracting',
      '2',
    );
    expect(row).toEqual({
      skill: 'Adding and subtracting',
      grade: '2',
      outcome: 'second-try',
      question: record.content.question,
      misconceptions: ['One is hiding.'],
    });
    expect(JSON.stringify(row)).not.toContain('kid1');
  });

  it('always has a plan of last resort', () => {
    const plan = lastResortPlan({ id: 'kid1', grade: '2', interests: [] });
    expect(plan).toMatchObject({ childId: 'kid1', mode: 'quest', purpose: 'core', theme: 'animals' });
    expect(plan.skillId).not.toBe('');
  });
});
