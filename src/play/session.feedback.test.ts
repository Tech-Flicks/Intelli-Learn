/**
 * What Pip says after a wrong try when a real model is connected: the tutor's reply takes
 * longer than the instant line waits, and its request is paid for whether it is used or not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TutorReply } from '@/core/schemas';
import type { ChildProfile } from '@/core/types';
import { tutorReply } from '@/ai';
import type { CheckResult } from '@/engine';
import { PLAY } from './machine';
import { resetPlaySession, usePlaySession } from './session';
import { resetSupply, supplyIdle } from './supply';
import { CHOICE, ORDER, addChild, freshDevice, giveChallenge, makeContent } from './testing/support';
import { voiceMock } from './testing/voiceMock';
import './strings';

vi.mock('@/voice', () => import('./testing/voiceMock'));
vi.mock('@/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/ai')>();
  return { ...real, tutorReply: vi.fn(real.tutorReply) };
});

const realAi = await vi.importActual<typeof import('@/ai')>('@/ai');
const play = () => usePlaySession.getState();
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const UNKNOWN_MISTAKE: CheckResult = { correct: false, misconception: null, progress: 0.5 };
const KNOWN_MISTAKE: CheckResult = { correct: false, misconception: 'One apple is hiding behind the leaf.', progress: 0 };
const AI_LINE = 'You are close: check the two in the middle once more.';

let mia: ChildProfile;
/** Whether each request to the tutor was cancelled before it was made, and whether it is cancelled now. */
let asked: { abortedAtCall: boolean; signal: AbortSignal | undefined }[] = [];

/** A tutor that answers like a real model: after `ms`. */
function slowTutor(ms: number): void {
  vi.mocked(tutorReply).mockImplementation(async (req) => {
    asked.push({ abortedAtCall: req.signal?.aborted === true, signal: req.signal });
    if (req.intent !== 'wrong-answer' || req.signal?.aborted) return realAi.tutorReply(req);
    await pause(ms);
    return { say: AI_LINE, highlightIds: [], redirected: false } satisfies TutorReply;
  });
}

async function enter(content = makeContent(ORDER)): Promise<void> {
  await giveChallenge(mia.id, content);
  await play().start(mia.id);
  play().beginAnswering();
}

beforeEach(async () => {
  voiceMock.reset();
  asked = [];
  vi.mocked(tutorReply).mockReset();
  await freshDevice();
  mia = await addChild({ nickname: 'Mia' });
});

afterEach(async () => {
  await play().leave();
  await supplyIdle();
  resetSupply();
  resetPlaySession();
});

describe('feedback on a wrong try with a real model', () => {
  it('keeps the request that was sent and adds its answer when it arrives a moment later', async () => {
    slowTutor(PLAY.feedbackWaitMs + 300);
    await enter();
    play().submitAnswer(['o1', 'o2', 'o4', 'o3'], UNKNOWN_MISTAKE);

    // First the instant line, as before.
    await vi.waitFor(() => expect(play().messages.at(-1)?.role).toBe('bot'), { timeout: 3000 });
    expect(play().messages.at(-1)?.text).not.toContain(AI_LINE);
    // The request is not cancelled: it was sent, and the service bills it.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.signal?.aborted).toBe(false);

    await vi.waitFor(() => expect(play().botLine).toContain(AI_LINE), { timeout: 3000 });
    expect(play().messages.at(-1)?.text).toContain(AI_LINE);
    expect(play().botLine).toContain('2 of 4 are in the right spot');
  });

  it('drops a late answer when something newer was said in the meantime', async () => {
    slowTutor(PLAY.feedbackWaitMs + 500);
    await enter();
    play().submitAnswer(['o1', 'o2', 'o4', 'o3'], UNKNOWN_MISTAKE);
    await vi.waitFor(() => expect(play().messages.at(-1)?.role).toBe('bot'), { timeout: 3000 });
    await play().requestHint();
    const hint = play().botLine;
    await pause(900);
    expect(play().botLine).toBe(hint);
    expect(play().messages.some((message) => message.text.includes(AI_LINE))).toBe(false);
  });

  it('spends no AI request when the challenge already says what is behind the mistake', async () => {
    slowTutor(50);
    await enter(makeContent(CHOICE));
    play().submitAnswer(['a'], KNOWN_MISTAKE);
    await vi.waitFor(() => expect(play().messages.at(-1)?.role).toBe('bot'), { timeout: 3000 });
    // The tutor is asked for its on-device reply (a request that is already cancelled is never sent) ...
    expect(asked).toHaveLength(1);
    expect(asked[0]?.abortedAtCall).toBe(true);
    // ... and the child hears what the challenge's author wrote about this mistake.
    expect(play().botLine).toContain('One apple is hiding behind the leaf.');
    expect(play().botLine).not.toContain(AI_LINE);
  });
});
