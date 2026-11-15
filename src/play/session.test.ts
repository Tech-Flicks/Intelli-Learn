import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipState } from '@/bot';
import type { AttemptResult, ChallengeRecord, ChildProfile, PlayAllowance } from '@/core/types';
import { db } from '@/data';
import { generateLearnerNotes, tutorReply } from '@/ai';
import type { Answer, CheckResult } from '@/engine';
import { recordLibraryOutcome } from '@/library';
import { getPlayAllowance, recordAttempt } from '@/progression';
import { recordSettled, resetPlaySession, setPlayDeps, usePlaySession } from './session';
import { makeSibling, prepareConceptCheck, resetSupply, supplyIdle, takeNext } from './supply';
import { CHOICE, NUMBER, ORDER, TEACH_BACK, addChild, freshDevice, giveChallenge, makeContent } from './testing/support';
import { voiceMock } from './testing/voiceMock';
import './strings';

vi.mock('@/voice', () => import('./testing/voiceMock'));

vi.mock('./supply', async (importOriginal) => {
  const real = await importOriginal<typeof import('./supply')>();
  return {
    ...real,
    takeNext: vi.fn(real.takeNext),
    makeSibling: vi.fn(real.makeSibling),
    prepareConceptCheck: vi.fn(real.prepareConceptCheck),
  };
});

vi.mock('@/progression', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/progression')>();
  return { ...real, recordAttempt: vi.fn(real.recordAttempt), getPlayAllowance: vi.fn(real.getPlayAllowance) };
});

vi.mock('@/library', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/library')>();
  return { ...real, recordLibraryOutcome: vi.fn(real.recordLibraryOutcome) };
});

vi.mock('@/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/ai')>();
  return { ...real, tutorReply: vi.fn(real.tutorReply), generateLearnerNotes: vi.fn(real.generateLearnerNotes) };
});

const realProgression = await vi.importActual<typeof import('@/progression')>('@/progression');
const realSupply = await vi.importActual<typeof import('./supply')>('./supply');
const realAi = await vi.importActual<typeof import('@/ai')>('@/ai');

const WRONG: CheckResult = { correct: false, misconception: 'One apple is hiding behind the leaf.', progress: 0 };
const RIGHT: CheckResult = { correct: true, misconception: null, progress: 1 };

const play = () => usePlaySession.getState();
const answerWrong = (answer: Answer = ['a'], result: CheckResult = WRONG) => play().submitAnswer(answer, result);
const answerRight = (answer: Answer = ['b']) => play().submitAnswer(answer, RIGHT);

/** Enters the play screen and waits until the child can answer. */
async function enter(child: ChildProfile, request: Parameters<ReturnType<typeof play>['start']>[1] = {}): Promise<ChallengeRecord> {
  await play().start(child.id, request);
  play().beginAnswering();
  const record = play().challenge;
  if (!record) throw new Error('No challenge was loaded');
  return record;
}

/** Waits for Pip's reaction to the latest wrong try (the tutor's wording replaces the instant line). */
async function settled(): Promise<void> {
  await vi.waitFor(() => expect(play().messages.at(-1)?.role).toBe('bot'));
}

async function untilRecorded(): Promise<void> {
  await recordSettled();
  await vi.waitFor(() => expect(play().phase).toBe('recorded'));
}

/** Every face Pip shows from now on. */
function watchFaces(): { faces: PipState[]; stop: () => void } {
  const faces: PipState[] = [play().botState];
  const stop = usePlaySession.subscribe((state) => {
    if (faces[faces.length - 1] !== state.botState) faces.push(state.botState);
  });
  return { faces, stop };
}

let mia: ChildProfile;

beforeEach(async () => {
  voiceMock.reset();
  vi.mocked(takeNext).mockClear();
  vi.mocked(makeSibling).mockClear();
  vi.mocked(prepareConceptCheck).mockClear();
  vi.mocked(recordAttempt).mockClear();
  vi.mocked(getPlayAllowance).mockClear();
  vi.mocked(recordLibraryOutcome).mockClear();
  vi.mocked(tutorReply).mockClear();
  vi.mocked(generateLearnerNotes).mockClear();
  await freshDevice();
  mia = await addChild({ nickname: 'Mia' });
});

afterEach(async () => {
  await play().leave();
  await supplyIdle();
  resetSupply();
  resetPlaySession();
  vi.mocked(takeNext).mockImplementation(realSupply.takeNext);
  vi.mocked(recordAttempt).mockImplementation(realProgression.recordAttempt);
  vi.mocked(getPlayAllowance).mockImplementation(realProgression.getPlayAllowance);
  vi.mocked(generateLearnerNotes).mockImplementation(realAi.generateLearnerNotes);
});

describe('entering', () => {
  it('sends an unknown child back to the profile picker', async () => {
    await play().start('nobody');
    expect(play().exit).toBe('/kids');
    expect(takeNext).not.toHaveBeenCalled();
  });

  it('sends the child to the rest screen when play time is over, before any challenge is taken', async () => {
    vi.mocked(getPlayAllowance).mockResolvedValue({ allowed: false, reason: 'daily-limit', minutesLeft: 0, minutesUsedToday: 30 });
    await play().start(mia.id);
    expect(play().exit).toBe(`/kids/${mia.id}/rest`);
    expect(takeNext).not.toHaveBeenCalled();
    expect(await db.sessions.count()).toBe(0);
  });

  it('takes the next challenge from the supply with what the address asked for', async () => {
    const loading: string[] = [];
    const stop = usePlaySession.subscribe((state) => loading.push(`${state.phase}:${state.botState}`));
    await play().start(mia.id, { mode: 'robot', strand: 'technology' });
    stop();
    expect(takeNext).toHaveBeenCalledWith(mia.id, { mode: 'robot', strand: 'technology' });
    // Pip thinks while the challenge is on its way.
    expect(loading[0]).toBe('loading:thinking');
    expect(play().phase).toBe('presenting');
    expect(play().challenge?.status).toBe('active');
    play().beginAnswering();
    expect(play().phase).toBe('answering');
    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.endedAt).toBeNull();
  });

  it('ends the play session on leaving and keeps the unfinished challenge for next time', async () => {
    const record = await enter(mia);
    await play().leave();
    expect((await db.sessions.toArray())[0]?.endedAt).not.toBeNull();
    expect((await db.challenges.get(record.id))?.status).toBe('active');
    expect(play().phase).toBe('idle');
    expect(recordAttempt).not.toHaveBeenCalled();
  });
});

describe('when the supply fails', () => {
  it('falls back to an offline challenge instead of an error', async () => {
    vi.mocked(takeNext).mockRejectedValue(new Error('the supply is broken'));
    await play().start(mia.id);
    const record = play().challenge;
    expect(play().phase).toBe('presenting');
    expect(play().exit).toBeNull();
    expect(record).not.toBeNull();
    expect(record?.source).toBe('offline');
    expect(record?.childId).toBe(mia.id);
    expect((await db.challenges.get(record?.id ?? ''))?.status).toBe('active');
  });

  it('comes back to the unfinished challenge first', async () => {
    const waiting = await giveChallenge(mia.id);
    vi.mocked(takeNext).mockRejectedValue(new Error('the supply is broken'));
    await play().start(mia.id);
    expect(play().challenge?.id).toBe(waiting.id);
  });

  it('can still be solved and recorded', async () => {
    vi.mocked(takeNext).mockRejectedValueOnce(new Error('the supply is broken'));
    setPlayDeps({ random: () => 0.99 });
    const record = await enter(mia);
    answerRight(record.content.interaction.kind === 'number' ? record.content.interaction.answer : ['x']);
    await untilRecorded();
    expect((await db.challenges.get(record.id))?.status).toBe('completed');
    expect(play().rewards?.stars).toBeGreaterThan(0);
  });
});

describe('answering', () => {
  it('keeps every answer and never shows an angry or startled face for a wrong one', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    const { faces, stop } = watchFaces();
    const resetKey = play().resetKey;

    answerWrong(['a']);
    await settled();
    expect(play().wrongTries).toBe(1);
    expect(play().phase).toBe('answering');
    expect(play().botOffer).toBeNull();
    // Kind and specific: the misconception behind the chosen option, never "wrong".
    expect(play().botLine).toContain('One apple is hiding behind the leaf.');
    expect(play().botLine).not.toMatch(/wrong|incorrect/i);

    answerWrong(['c'], { correct: false, misconception: null, progress: 0 });
    await settled();
    answerWrong(['a']);
    await settled();
    stop();

    expect(play().answers.map((answer) => answer.correct)).toEqual([false, false, false]);
    expect(play().answers[0]).toMatchObject({ answer: ['a'], misconception: 'One apple is hiding behind the leaf.' });
    expect(play().wrongTries).toBe(3);
    expect(faces).toContain('curious');
    expect(faces).not.toContain('angry');
    expect(faces).not.toContain('jump_scared');
    // The child's work stays where it is.
    expect(play().resetKey).toBe(resetKey);
    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it('offers a hint from the second wrong try on, and only offers', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    answerWrong();
    await settled();
    expect(play().helpOffered).toBe(false);
    answerWrong();
    await vi.waitFor(() => expect(play().botLine).toContain('Want a hint?'));
    expect(play().botOffer).toBe('hint');
    expect(play().helpOffered).toBe(true);
    expect(play().hintLevel).toBe(0);

    await play().acceptOffer();
    expect(play().hintLevel).toBe(1);
    expect(play().botOffer).toBeNull();
    expect(play().botLine).toContain('Look closely at the picture.');
  });

  it('tells how many parts are already right', async () => {
    await giveChallenge(mia.id, makeContent(ORDER));
    await enter(mia);
    answerWrong(['o1', 'o2', 'o4', 'o3'], { correct: false, misconception: null, progress: 0.5 });
    await vi.waitFor(() => expect(play().messages.at(-1)?.text).toContain('2 of 4 are in the right spot'));
    expect(play().botLine).toContain('2 of 4 are in the right spot');
  });

  it('gives the tutor the context of the child, never the nickname', async () => {
    await freshDevice({ openChat: true });
    mia = await addChild({ nickname: 'Zebulon' });
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    answerWrong();
    await settled();
    await play().requestHint();
    await play().askBot('Why is the sky blue?');
    expect(vi.mocked(tutorReply).mock.calls.map((call) => call[0].intent)).toEqual(['wrong-answer', 'nudge', 'chat']);
    expect(JSON.stringify(vi.mocked(tutorReply).mock.calls)).not.toContain('Zebulon');
    expect(vi.mocked(tutorReply).mock.calls[2]?.[0]).toMatchObject({ childText: 'Why is the sky blue?', openChat: true });
  });

  it('takes no questions while microphone and chat are switched off', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().askBot('What is the answer?');
    expect(tutorReply).not.toHaveBeenCalled();
    expect(play().messages).toHaveLength(0);
  });
});

describe('the help ladder', () => {
  it('cannot be skipped: nudge, strong hint, then the walkthrough, and the child still answers', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE, { teachBack: TEACH_BACK }));
    await enter(mia);

    // Straight to the walkthrough: nothing happens.
    await play().requestWalkthrough();
    expect(play().hintLevel).toBe(0);
    expect(play().walkthroughOpen).toBe(false);

    await play().requestHint();
    expect(play().hintLevel).toBe(1);
    expect(play().botLine).toContain('Look closely at the picture.');
    await play().requestWalkthrough();
    expect(play().walkthroughOpen).toBe(false);

    await play().requestHint();
    expect(play().hintLevel).toBe(2);
    expect(play().botLine).toContain('Try counting each one slowly.');
    // Asking again stays on the strong hint.
    await play().requestHint();
    expect(play().hintLevel).toBe(2);

    await play().requestWalkthrough();
    expect(play().hintLevel).toBe(3);
    expect(play().walkthroughOpen).toBe(true);
    expect(play().walkthroughStep).toBe(0);
    expect(play().walkthroughText).toContain('Point at the first apple.');
    expect(play().botState).toBe('teaching');

    await play().nextWalkthroughStep();
    expect(play().walkthroughStep).toBe(1);
    expect(play().walkthroughText).toContain('Then count the next ones.');

    await play().nextWalkthroughStep();
    // The steps are over. Nothing was answered for the child.
    expect(play().walkthroughOpen).toBe(false);
    expect(play().phase).toBe('answering');
    expect(play().answers).toHaveLength(0);
    expect(recordAttempt).not.toHaveBeenCalled();
    expect((await db.challenges.get(given.id))?.status).toBe('active');

    answerRight();
    expect(play().phase).toBe('solved');
    expect(play().solvedOutcome).toBe('walkthrough');
    // After a walkthrough Pip always asks to be taught.
    expect(play().willTeachBack).toBe(true);
  });

  it('makes an easier sibling after a walkthrough, and plays it next', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().requestHint();
    await play().requestHint();
    await play().requestWalkthrough();
    await play().nextWalkthroughStep();
    await play().nextWalkthroughStep();
    answerRight();
    await untilRecorded();

    expect(makeSibling).toHaveBeenCalledTimes(1);
    expect(vi.mocked(makeSibling).mock.calls[0]?.[0]).toMatchObject({ id: given.id });
    expect((await db.attempts.toArray())[0]).toMatchObject({ outcome: 'walkthrough', walkthroughUsed: true, hintsUsed: 2 });

    await play().next();
    expect(takeNext).toHaveBeenCalledTimes(2);
    const next = play().challenge;
    expect(next?.id).not.toBe(given.id);
    expect(next?.skillId).toBe(given.skillId);
    expect(play().hintLevel).toBe(0);
  });

  it('makes no sibling when the child did not need the walkthrough', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().requestHint();
    answerRight();
    await untilRecorded();
    expect(makeSibling).not.toHaveBeenCalled();
    expect((await db.attempts.toArray())[0]?.outcome).toBe('nudge');
  });

  it('remembers the help that was used when the child leaves and comes back', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    answerWrong();
    await settled();
    await play().requestHint();
    await play().leave();

    await enter(mia);
    expect(play().wrongTries).toBe(1);
    expect(play().hintLevel).toBe(1);
    answerRight();
    await untilRecorded();
    expect((await db.attempts.toArray())[0]?.outcome).toBe('nudge');
  });
});

describe('recording', () => {
  it('records a solved challenge exactly once, whatever is pressed afterwards', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE, { teachBack: TEACH_BACK }));
    setPlayDeps({ random: () => 0 });
    await enter(mia);
    answerRight();
    expect(play().phase).toBe('solved');
    expect(play().botState).toBe('celebrating');
    // Pip waits for the teach-back before the attempt is stored.
    expect(recordAttempt).not.toHaveBeenCalled();

    answerRight();
    play().continueAfterSolved();
    expect(play().phase).toBe('teachback');
    await Promise.all([play().answerTeachBack('t1'), play().answerTeachBack('t2'), play().recordIfSolved()]);
    await untilRecorded();
    await play().recordIfSolved();
    answerRight();
    await play().leave();

    expect(recordAttempt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAttempt).mock.calls[0]?.[0]).toMatchObject({ teachBackCorrect: true, hintsUsed: 0, walkthroughUsed: false });
    expect(await db.attempts.count()).toBe(1);
    expect((await db.challenges.get(given.id))?.status).toBe('completed');
    expect((await db.children.get(mia.id))?.stars).toBeGreaterThan(0);
  });

  it('records at once when there is no teach-back, and shows the rewards', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    answerWrong();
    await settled();
    answerRight();
    await untilRecorded();

    expect(recordAttempt).toHaveBeenCalledTimes(1);
    const attempt = (await db.attempts.toArray())[0];
    expect(attempt).toMatchObject({ challengeId: given.id, outcome: 'second-try' });
    expect(attempt?.answers.map((answer) => answer.correct)).toEqual([false, true]);
    expect(play().rewards).toMatchObject({ outcome: 'second-try', stars: attempt?.starsEarned });
    expect(play().starsPending).toBe(attempt?.starsEarned);
    expect(play().sessionCompleted).toBe(1);
  });

  it('records a solved challenge when the child leaves before the reward moment', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE, { teachBack: TEACH_BACK }));
    setPlayDeps({ random: () => 0 });
    await enter(mia);
    answerRight();
    await play().leave();
    expect(recordAttempt).toHaveBeenCalledTimes(1);
    expect((await db.challenges.get(given.id))?.status).toBe('completed');
  });

  it('counts only the time the child was really playing', async () => {
    let clock = 1_000_000;
    setPlayDeps({ now: () => clock, random: () => 0.99 });
    await giveChallenge(mia.id, makeContent(NUMBER));
    await enter(mia);
    clock += 5000;
    play().touch();
    // The tab goes to the background for ten minutes.
    play().setVisible(false);
    clock += 600_000;
    play().setVisible(true);
    clock += 4000;
    answerRight(12);
    await untilRecorded();
    expect(vi.mocked(recordAttempt).mock.calls[0]?.[0].timeMs).toBe(9000);
  });

  it('tells the library how a library challenge went', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE), { libraryId: 'lib-1' });
    await enter(mia);
    answerRight();
    await untilRecorded();
    expect(recordLibraryOutcome).toHaveBeenCalledWith('lib-1', 'independent');
  });

  it('still shows the way on when the attempt cannot be stored', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    vi.mocked(recordAttempt).mockRejectedValue(new Error('the disk is full'));
    await enter(mia);
    answerRight();
    await untilRecorded();
    expect(play().rewards).toBeNull();
    expect(play().exit).toBeNull();
  });
});

describe('concept checks', () => {
  it('frames the check as a star challenge and is proud when the child proves it', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE, { teachBack: TEACH_BACK }), { purpose: 'check' });
    await enter(mia);
    expect(play().messages[0]).toMatchObject({ role: 'bot', text: 'Star challenge! Show what you know.' });
    // The card carries the frame; Pip does not cover it with a bubble.
    expect(play().botLine).toBeNull();
    answerRight();
    expect(play().checkPassed).toBe(true);
    expect(play().botState).toBe('proud');
    expect(play().willTeachBack).toBe(true);
  });

  it('is not passed with help', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE), { purpose: 'check' });
    await enter(mia);
    await play().requestHint();
    answerRight();
    expect(play().checkPassed).toBe(false);
    expect(play().botState).toBe('celebrating');
  });

  it('has a concept check prepared when the skill is ready for one', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    vi.mocked(recordAttempt).mockImplementation(async (input) => {
      const result: AttemptResult = await realProgression.recordAttempt(input);
      return { ...result, skillState: { ...result.skillState, checkPending: true } };
    });
    await enter(mia);
    answerRight();
    await untilRecorded();
    expect(prepareConceptCheck).toHaveBeenCalledTimes(1);
    expect(prepareConceptCheck).toHaveBeenCalledWith(mia.id, given.skillId);
  });

  it('prepares none otherwise', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    answerRight();
    await untilRecorded();
    expect(play().result?.skillState.checkPending).toBe(false);
    expect(prepareConceptCheck).not.toHaveBeenCalled();
  });
});

describe('Fix the Bot', () => {
  it('is the one place where Pip plays startled, as his own "oops", before he gets curious', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE), { mode: 'fixbot' });
    await play().start(mia.id);
    expect(play().botState).toBe('jump_scared');
    expect(play().botLine).not.toBeNull();
    // A wrong try right away still gets the curious face, not the startled one.
    answerWrong();
    expect(play().botState).toBe('curious');
  });

  it('does not startle Pip in any other mode', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE), { mode: 'detective' });
    await play().start(mia.id);
    expect(play().botState).toBe('happy');
    expect(play().botLine).toBeNull();
  });
});

describe('play time', () => {
  it('lets the child finish the challenge and then leads to the rest screen', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    const open: PlayAllowance = { allowed: true, reason: 'ok', minutesLeft: 1, minutesUsedToday: 29 };
    const over: PlayAllowance = { allowed: false, reason: 'daily-limit', minutesLeft: 0, minutesUsedToday: 30 };
    vi.mocked(getPlayAllowance).mockResolvedValue(open);
    await enter(mia);
    // Time runs out in the middle of the challenge: nothing is interrupted.
    vi.mocked(getPlayAllowance).mockResolvedValue(over);
    answerWrong();
    await settled();
    expect(play().exit).toBeNull();
    expect(play().phase).toBe('answering');

    answerRight();
    await untilRecorded();
    expect(play().exit).toBeNull();
    expect(play().allowance?.allowed).toBe(false);
    expect((await db.challenges.get(given.id))?.status).toBe('completed');

    await play().next();
    expect(play().exit).toBe(`/kids/${mia.id}/rest`);
    expect(takeNext).toHaveBeenCalledTimes(1);
  });

  it('goes on to the next challenge while there is time', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    answerRight();
    await untilRecorded();
    await play().next();
    expect(play().exit).toBeNull();
    expect(play().phase).toBe('presenting');
    expect(play().challenge?.id).not.toBe(given.id);
    expect(play().answers).toHaveLength(0);
  });

  it('does not move on before the challenge is recorded', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().next();
    expect(play().challenge?.id).toBe(given.id);
    expect(takeNext).toHaveBeenCalledTimes(1);
  });
});

describe('voice and transcripts', () => {
  it('speaks what the child asked for only when voice output is on', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().requestHint();
    expect(voiceMock.spoken().at(-1)).toContain('Look closely at the picture.');
    play().requestRead();
    expect(voiceMock.spoken().at(-1)).toBe('A friendly robot needs your help. How many apples are in the basket?');
  });

  it('stays silent when voice output is off', async () => {
    await freshDevice({ voiceOutput: false });
    mia = await addChild();
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().requestHint();
    play().requestRead();
    expect(play().botLine).toContain('Look closely at the picture.');
    expect(voiceMock.speak).not.toHaveBeenCalled();
  });

  it('reads the challenge aloud by itself for a child who is read to', async () => {
    mia = await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'K' });
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    expect(voiceMock.spoken()).toEqual(['A friendly robot needs your help. How many apples are in the basket?']);
  });

  it('does not read by itself to an older child, and not when muted', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    expect(voiceMock.speak).not.toHaveBeenCalled();
    play().setMuted(true);
    await play().requestHint();
    expect(voiceMock.speak).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect((await db.kv.get(`bot-muted:${mia.id}`))?.value).toBe(true));
  });

  it('stores the speed the child picked', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    play().setVoiceRate(0.75);
    expect(play().voiceRate).toBe(0.75);
    await vi.waitFor(async () => expect((await db.children.get(mia.id))?.voiceRate).toBe(0.75));
  });

  it('keeps the transcript only when the parent switched it on', async () => {
    await freshDevice({ keepTranscripts: false });
    mia = await addChild();
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().requestHint();
    expect(play().messages.length).toBeGreaterThan(0);
    await play().leave();
    expect(await db.messages.count()).toBe(0);

    await freshDevice({ keepTranscripts: true });
    mia = await addChild();
    const second = await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    await play().requestHint();
    await vi.waitFor(async () => expect(await db.messages.count()).toBe(1));
    expect((await db.messages.toArray())[0]).toMatchObject({ childId: mia.id, challengeId: second.id, role: 'bot', kind: 'hint' });
  });

  it('never passes on a line that fails the safety check', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    vi.mocked(tutorReply).mockResolvedValueOnce({ say: 'I will kill you with a gun.', highlightIds: [], redirected: false } as Awaited<
      ReturnType<typeof tutorReply>
    >);
    await play().requestHint();
    expect(play().botLine).not.toContain('kill');
    expect(play().botLine).not.toBe('');
  });
});

describe('learner notes', () => {
  async function solveTen(): Promise<void> {
    setPlayDeps({ random: () => 0.99 });
    await giveChallenge(mia.id, makeContent(CHOICE));
    await enter(mia);
    for (let round = 0; round < 10; round += 1) {
      answerRight();
      // A concept check on the way always ends with teaching Pip.
      if (play().willTeachBack) {
        play().continueAfterSolved();
        await play().answerTeachBack(play().challenge?.content.teachBack?.options[0]?.id ?? '');
      }
      await untilRecorded();
      if (round < 9) {
        await play().next();
        play().beginAnswering();
      }
    }
  }

  it('are rewritten after every tenth attempt, from attempts without names', async () => {
    vi.mocked(generateLearnerNotes).mockResolvedValue({
      summary: 'Counts with care.',
      strengths: ['Counting'],
      struggles: [],
      nextFocus: ['Skip counting'],
    });
    await solveTen();
    await vi.waitFor(async () => expect(await db.learnerNotes.count()).toBe(1));
    expect(generateLearnerNotes).toHaveBeenCalledTimes(1);
    const input = vi.mocked(generateLearnerNotes).mock.calls[0]?.[0];
    expect(input?.attempts).toHaveLength(10);
    expect(JSON.stringify(input)).not.toContain('Mia');
    expect(await db.learnerNotes.get(mia.id)).toMatchObject({ summary: 'Counts with care.', attemptsAtUpdate: 10 });
  }, 30_000);

  it('are skipped silently when there is nothing to write', async () => {
    vi.mocked(generateLearnerNotes).mockResolvedValue(null);
    await solveTen();
    await vi.waitFor(() => expect(generateLearnerNotes).toHaveBeenCalledTimes(1));
    expect(await db.learnerNotes.count()).toBe(0);
    expect(play().phase).toBe('recorded');
  }, 30_000);
});
