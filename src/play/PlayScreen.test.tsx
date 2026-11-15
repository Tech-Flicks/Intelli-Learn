import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dayKey } from '@/core/grades';
import type { ChildProfile } from '@/core/types';
import { db } from '@/data';
import { recordSettled, resetPlaySession, setPlayDeps, usePlaySession } from './session';
import { resetSupply, supplyIdle } from './supply';
import { CHOICE, NUMBER, TEACH_BACK, addChild, freshDevice, giveChallenge, makeContent, renderPlay } from './testing/support';
import { voiceMock } from './testing/voiceMock';

// The whole loop runs on the real modules in demo mode (no AI), on a fake IndexedDB.
// Only what jsdom cannot do is replaced: the voice, the animated mascot and the canvas.
vi.mock('@/voice', () => import('./testing/voiceMock'));
vi.mock('@/bot/pip', () => import('./testing/pipMock'));

let mia: ChildProfile;
const user = userEvent.setup();

const check = (): HTMLElement => screen.getByTestId('check-button');
const option = (name: RegExp): HTMLElement => screen.getByRole('button', { name });
/** Pip comes in a moment after the challenge: he first looks up where he was left. */
const pip = (): Promise<HTMLElement> => screen.findByRole('button', { name: /Pip, your helper/ });
const where = (): string => screen.getByTestId('where').textContent ?? '';

async function ready(): Promise<HTMLElement> {
  return screen.findByTestId('prompt-card');
}

function noSkipAnywhere(): void {
  expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  expect(screen.queryByRole('link', { name: /skip/i })).toBeNull();
  expect(screen.queryByText(/skip/i)).toBeNull();
}

beforeEach(async () => {
  // jsdom has no canvas; the stage must work without one.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  voiceMock.reset();
  await freshDevice();
  mia = await addChild({ nickname: 'Mia' });
  // No teach-back by chance: the tests that want one ask for it.
  setPlayDeps({ random: () => 0.99 });
});

afterEach(async () => {
  cleanup();
  await usePlaySession.getState().leave();
  await supplyIdle();
  resetSupply();
  resetPlaySession();
  vi.restoreAllMocks();
});

describe('PlayScreen: entering', () => {
  it('is never blank: Pip thinks out loud while the challenge is on its way', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    renderPlay(mia.id);
    const loading = screen.getByTestId('play-loading');
    expect(loading).toHaveAccessibleName('Getting your next adventure ready');
    expect(within(loading).getByTestId('pip')).toHaveAttribute('data-state', 'thinking');
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    await ready();
    expect(screen.queryByTestId('play-loading')).toBeNull();
  });

  it('shows the title, the intro and the question above the stage', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    renderPlay(mia.id);
    const card = await ready();
    expect(within(card).getByRole('heading', { name: 'Apple count' })).toBeInTheDocument();
    expect(within(card).getByText('A friendly robot needs your help.')).toBeInTheDocument();
    expect(within(card).getByTestId('question')).toHaveTextContent('How many apples are in the basket?');
    expect(card).toHaveAttribute('data-frame', 'plain');
    expect(check()).toBeDisabled();
    expect(screen.getByTestId('star-counter')).toHaveTextContent('0');
  });

  it('sends an unknown child to the profile picker', async () => {
    renderPlay('nobody');
    await waitFor(() => expect(where()).toBe('/kids'));
  });

  it('sends the child to the rest screen when the play time of today is used up', async () => {
    await freshDevice({ dailyMinutes: 20 });
    mia = await addChild();
    const now = Date.now();
    await db.sessions.put({ id: 'ses-old', childId: mia.id, day: dayKey(now), startedAt: now, endedAt: now, activeMs: 21 * 60_000, itemsCompleted: 0 });
    renderPlay(mia.id);
    await waitFor(() => expect(where()).toBe(`/kids/${mia.id}/rest`));
  });

  it('frames a concept check as a star challenge', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE), { purpose: 'check' });
    renderPlay(mia.id);
    const card = await ready();
    expect(card).toHaveAttribute('data-frame', 'check');
    expect(within(card).getByText('Star challenge!')).toBeInTheDocument();
    expect(within(card).getByText('Show what you know.')).toBeInTheDocument();

    await user.click(option(/Four/));
    await user.click(check());
    expect(await screen.findByRole('heading', { name: 'You proved it!' })).toBeInTheDocument();
    expect(screen.getByText('You really understand this.')).toBeInTheDocument();
    expect(within(screen.getByTestId('helper-bot')).getByTestId('pip')).toHaveAttribute('data-state', 'proud');
  });

  it('frames the placement game calmly, with progress dots and never as a test', async () => {
    mia = await addChild({ nickname: 'Noor', placementDone: false });
    await giveChallenge(mia.id, makeContent(CHOICE), { purpose: 'placement' });
    renderPlay(mia.id);
    const card = await ready();
    expect(card).toHaveAttribute('data-frame', 'placement');
    expect(within(card).getByText('Pip is finding your perfect starting point')).toBeInTheDocument();
    expect(within(card).getByTestId('placement-dots')).toHaveTextContent(/Step 1 of \d+/);
    expect(screen.getByTestId('play-screen').textContent).not.toMatch(/\b(test|exam|quiz)\b/i);
  });
});

describe('PlayScreen: solving', () => {
  it('plays a choice challenge to the end: stars are awarded and the challenge is completed', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE, { funFact: 'Apples float in water.' }));
    renderPlay(mia.id);
    await ready();
    await user.click(option(/Four/));
    await user.click(check());

    const sheet = await screen.findByTestId('solved-sheet');
    expect(within(sheet).getByText('We counted every apple once.')).toBeInTheDocument();
    expect(within(sheet).getByText('Apples float in water.')).toBeInTheDocument();
    const next = await screen.findByTestId('next-button');
    expect(next).toHaveTextContent('Next adventure');
    expect(screen.getByTestId('stars-earned')).toHaveTextContent(/You earned \d stars?!/);
    expect(within(sheet).getByText('You worked it out all on your own!')).toBeInTheDocument();
    // The first finished challenge brings the first badge.
    expect(within(sheet).getByText(/New badge!/)).toBeInTheDocument();

    const attempts = await db.attempts.toArray();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ challengeId: given.id, outcome: 'independent', hintsUsed: 0, walkthroughUsed: false });
    expect(attempts[0]?.starsEarned).toBeGreaterThan(0);
    expect((await db.challenges.get(given.id))?.status).toBe('completed');
    const stars = (await db.children.get(mia.id))?.stars ?? 0;
    expect(stars).toBe(attempts[0]?.starsEarned);
    // The stars fly into the counter.
    await waitFor(() => expect(screen.getByTestId('star-counter')).toHaveTextContent(String(stars)), { timeout: 4000 });
    noSkipAnywhere();

    await user.click(next);
    await waitFor(() => expect(usePlaySession.getState().challenge?.id).not.toBe(given.id));
    expect(await ready()).toBeInTheDocument();
    expect(screen.queryByTestId('solved-sheet')).toBeNull();
  });

  it('plays a number challenge to the end: stars are awarded and the challenge is completed', async () => {
    const given = await giveChallenge(mia.id, makeContent(NUMBER));
    renderPlay(mia.id);
    await ready();
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(check());

    expect(await screen.findByTestId('next-button')).toBeInTheDocument();
    expect(screen.getByTestId('stars-earned')).toHaveTextContent(/You earned \d stars?!/);
    const attempt = (await db.attempts.toArray())[0];
    expect(attempt).toMatchObject({ challengeId: given.id, outcome: 'independent' });
    expect(attempt?.answers).toHaveLength(1);
    expect(attempt?.answers[0]).toMatchObject({ answer: 12, correct: true });
    expect((await db.challenges.get(given.id))?.status).toBe('completed');
    expect((await db.children.get(mia.id))?.stars).toBeGreaterThan(0);
  });

  it('goes from a wrong answer over a hint to the right answer, kindly', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    renderPlay(mia.id);
    await ready();

    await user.click(option(/Three/));
    await user.click(check());
    const bubble = await screen.findByTestId('bot-bubble');
    await waitFor(() => expect(bubble).toHaveTextContent('One apple is hiding behind the leaf.'));
    // No red cross, no "wrong", and the pick is kept.
    expect(screen.queryByText(/[✗✘❌]/)).toBeNull();
    expect(screen.getByTestId('play-screen').textContent).not.toMatch(/\bwrong\b|incorrect/i);
    expect(option(/Three/)).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByTestId('helper-bot')).getByTestId('pip')).toHaveAttribute('data-state', 'curious');
    expect(screen.queryByRole('button', { name: 'Yes please!' })).toBeNull();
    noSkipAnywhere();

    // The second wrong try comes with an offer, nothing more. (A moment later: the same answer
    // again at once would be a double tap on Check, which is one try.)
    setPlayDeps({ now: () => Date.now() + 5000, random: () => 0.99 });
    await user.click(check());
    await user.click(await screen.findByRole('button', { name: 'Yes please!' }));
    await waitFor(() => expect(screen.getByTestId('bot-bubble')).toHaveTextContent('Look closely at the picture.'));
    expect(usePlaySession.getState().hintLevel).toBe(1);
    expect((await db.challenges.get(given.id))?.status).toBe('active');
    noSkipAnywhere();

    await user.click(option(/Four/));
    await user.click(check());
    expect(await screen.findByTestId('next-button')).toBeInTheDocument();
    expect(screen.getByText('You used a little clue and solved it yourself!')).toBeInTheDocument();
    const attempt = (await db.attempts.toArray())[0];
    expect(attempt).toMatchObject({ outcome: 'nudge', hintsUsed: 1, walkthroughUsed: false });
    expect(attempt?.answers.map((answer) => answer.correct)).toEqual([false, false, true]);
    expect(attempt?.starsEarned).toBeGreaterThan(0);
  });

  it('walks through the steps one at a time, and the child still puts in the answer', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE, { teachBack: TEACH_BACK }));
    renderPlay(mia.id);
    await ready();

    // "Show me how" is not there before the two hints.
    await user.click(await pip());
    const panel = await screen.findByTestId('bot-panel');
    expect(within(panel).queryByRole('button', { name: 'Show me how' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Give me a hint' }));
    await waitFor(() => expect(screen.getByTestId('bot-bubble')).toHaveTextContent('Look closely at the picture.'));
    await user.click(await pip());
    expect(within(screen.getByTestId('bot-panel')).queryByRole('button', { name: 'Show me how' })).toBeNull();
    await user.click(within(screen.getByTestId('bot-panel')).getByRole('button', { name: 'Give me a hint' }));
    await waitFor(() => expect(screen.getByTestId('bot-bubble')).toHaveTextContent('Try counting each one slowly.'));

    await user.click(await pip());
    noSkipAnywhere();
    await user.click(within(screen.getByTestId('bot-panel')).getByRole('button', { name: 'Show me how' }));
    const sheet = await screen.findByTestId('walkthrough-sheet');
    await waitFor(() => expect(sheet).toHaveTextContent('Point at the first apple.'));
    expect(sheet).toHaveTextContent('Step 1 of 2');
    expect(sheet).not.toHaveTextContent('Then count the next ones.');
    // (Quick taps on Pip make him giggle for a moment first.)
    await waitFor(() => expect(within(screen.getByTestId('helper-bot')).getByTestId('pip')).toHaveAttribute('data-state', 'teaching'), {
      timeout: 3000,
    });
    noSkipAnywhere();

    await user.click(within(sheet).getByRole('button', { name: /Next step/ }));
    await waitFor(() => expect(sheet).toHaveTextContent('Then count the next ones.'));
    await user.click(within(sheet).getByRole('button', { name: /Now I will try/ }));
    expect(screen.queryByTestId('walkthrough-sheet')).toBeNull();

    // Nothing was filled in and nothing was recorded: the answer is still the child's.
    expect(check()).toBeDisabled();
    expect(screen.queryByTestId('solved-sheet')).toBeNull();
    expect(await db.attempts.count()).toBe(0);
    expect((await db.challenges.get(given.id))?.status).toBe('active');

    await user.click(option(/Four/));
    await user.click(check());
    // After a walkthrough Pip asks to be taught.
    await user.click(await screen.findByRole('button', { name: /Keep going/ }));
    const teach = await screen.findByTestId('teachback');
    expect(teach).toHaveTextContent('Can you teach Pip how to count?');
    await user.click(within(teach).getByRole('button', { name: 'Touch each one once.' }));
    expect(await screen.findByTestId('next-button')).toBeInTheDocument();
    expect(screen.getByText(/You followed every step and finished it/)).toBeInTheDocument();
    await recordSettled();
    expect((await db.attempts.toArray())[0]).toMatchObject({ outcome: 'walkthrough', walkthroughUsed: true, teachBackCorrect: true });
    noSkipAnywhere();
  });

  it('keeps the home button there all the way, and going home keeps the challenge for next time', async () => {
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    renderPlay(mia.id);
    await ready();
    await user.click(option(/Three/));
    await user.click(check());
    await screen.findByTestId('bot-bubble');
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(where()).toBe(`/kids/${mia.id}`));
    await waitFor(() => expect(usePlaySession.getState().phase).toBe('idle'));
    expect((await db.challenges.get(given.id))?.status).toBe('active');
    expect(await db.attempts.count()).toBe(0);
    await waitFor(async () => expect((await db.sessions.toArray())[0]?.endedAt).not.toBeNull());
  });

  it('finishes the challenge first when the play time runs out, then offers the rest', async () => {
    await freshDevice({ dailyMinutes: 20 });
    mia = await addChild();
    const given = await giveChallenge(mia.id, makeContent(CHOICE));
    renderPlay(mia.id);
    await ready();
    // The time is used up while the child is still thinking.
    const now = Date.now();
    await db.sessions.put({ id: 'ses-old', childId: mia.id, day: dayKey(now), startedAt: now, endedAt: now, activeMs: 21 * 60_000, itemsCompleted: 0 });
    await user.click(option(/Three/));
    await user.click(check());
    await screen.findByTestId('bot-bubble');
    expect(where()).toBe(`/kids/${mia.id}/play`);

    await user.click(option(/Four/));
    await user.click(check());
    const next = await screen.findByTestId('next-button');
    expect(next).toHaveTextContent('Time for a rest');
    expect((await db.challenges.get(given.id))?.status).toBe('completed');
    await user.click(next);
    await waitFor(() => expect(where()).toBe(`/kids/${mia.id}/rest`));
  });
});

describe('PlayScreen: reading aloud', () => {
  it('reads the challenge by itself to a young child', async () => {
    mia = await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'K' });
    await giveChallenge(mia.id, makeContent(CHOICE));
    renderPlay(mia.id);
    await ready();
    await waitFor(() => expect(voiceMock.spoken()).toEqual(['A friendly robot needs your help. How many apples are in the basket?']));
  });

  it('reads on request for everybody else, and has no read button when voice output is off', async () => {
    await giveChallenge(mia.id, makeContent(CHOICE));
    const first = renderPlay(mia.id);
    const card = await ready();
    expect(voiceMock.speak).not.toHaveBeenCalled();
    await user.click(within(card).getByRole('button', { name: 'Read it to me' }));
    expect(voiceMock.spoken()).toEqual(['A friendly robot needs your help. How many apples are in the basket?']);
    first.unmount();
    await usePlaySession.getState().leave();

    await freshDevice({ voiceOutput: false });
    mia = await addChild();
    await giveChallenge(mia.id, makeContent(CHOICE));
    renderPlay(mia.id);
    const silent = await ready();
    expect(within(silent).queryByRole('button', { name: 'Read it to me' })).toBeNull();
  });
});
