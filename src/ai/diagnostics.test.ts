/**
 * The log of recent AI results and what follows from it: what the parent is told, and the
 * pause after repeated failures. The second half runs the real `generateChallenge` against
 * a mocked `fetch` with the real database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStage } from '@/core/grades';
import type { ChallengePlan } from '@/core/types';
import { db, getUsageToday, updateSettings } from '@/data';
import { resetDb } from '@/data/testSupport';
import { clientTuning, resetClientSession } from './client';
import {
  AI_LOG_BUILDS,
  AI_LOG_OTHER,
  generationPause,
  noteAiResult,
  outcomeOfError,
  recentAiResults,
  summarizeAiResults,
  type AiLogEntry,
} from './diagnostics';
import { AiError } from './errors';
import { generateChallenge, getAiStatus, resetAiSession, tutorReply } from './index';
import { KIND_EXAMPLES } from './prompts';
import { resetModerationSession } from './safety';
import { completion, fakeResponse } from './testSupport';
import type { ChildContext, GenerateChallengeRequest } from './types';
import { ChallengeSchema } from '@/core/schemas';

const MINUTE = 60_000;
const T0 = new Date(2026, 5, 10, 12, 0, 0).getTime();

function entry(patch: Partial<AiLogEntry> = {}): AiLogEntry {
  return { at: T0, task: 'challenge', kind: 'number', model: 'tiny', outcome: 'validation', message: 'The challenge had mistakes: x', ms: 900, ...patch };
}

describe('generationPause', () => {
  const failures = (count: number, last = T0): AiLogEntry[] =>
    Array.from({ length: count }, (_, index) => entry({ at: last - (count - 1 - index) * 1000 }));

  it('starts after three failed builds in a row and lasts ten minutes', () => {
    expect(generationPause(failures(2), T0 + 1)).toBeNull();
    const pause = generationPause(failures(3), T0 + 1);
    expect(pause).toMatchObject({ failures: 3, until: T0 + 10 * MINUTE });
    expect(generationPause(failures(3), T0 + 10 * MINUTE)).toBeNull();
  });

  it('doubles with every further failure, up to an hour', () => {
    expect(generationPause(failures(4), T0 + 1)?.until).toBe(T0 + 20 * MINUTE);
    expect(generationPause(failures(5), T0 + 1)?.until).toBe(T0 + 40 * MINUTE);
    expect(generationPause(failures(9), T0 + 1)?.until).toBe(T0 + 60 * MINUTE);
  });

  it('ends with a success, ignores being offline, and ignores the other tasks', () => {
    expect(generationPause([...failures(5, T0 - 5000), entry({ outcome: 'ok', message: '' })], T0 + 1)).toBeNull();
    const offline = Array.from({ length: 6 }, () => entry({ outcome: 'offline' }));
    expect(generationPause(offline, T0 + 1)).toBeNull();
    expect(generationPause([...failures(2), entry({ outcome: 'offline' }), entry()], T0 + 1)?.failures).toBe(3);
    const tutor = Array.from({ length: 6 }, () => entry({ task: 'tutor', outcome: 'timeout' }));
    expect(generationPause(tutor, T0 + 1)).toBeNull();
  });

  it('does not last longer when the clock was set back', () => {
    expect(generationPause(failures(3), T0 - 3 * 60 * MINUTE)).toBeNull();
  });
});

describe('outcomeOfError', () => {
  it('names the outcome and keeps the message that was written for a parent', () => {
    expect(outcomeOfError(new AiError('network', 'The AI service did not answer within 45 seconds.', { timedOut: true }))).toEqual({
      outcome: 'timeout',
      message: 'The AI service did not answer within 45 seconds.',
    });
    expect(outcomeOfError(new AiError('network', 'offline', { code: 'offline' }))?.outcome).toBe('offline');
    expect(outcomeOfError(new AiError('auth', 'The AI service did not accept the API key (HTTP 401).'))?.outcome).toBe('auth');
    expect(outcomeOfError(new AiError('bad-response', 'cut', { code: 'output_truncated' }))?.outcome).toBe('truncated');
    const format = outcomeOfError(new AiError('bad-response', 'The AI model did not return content in the expected format.', { detail: 'title: too long' }));
    expect(format).toEqual({ outcome: 'format', message: 'The AI model did not return content in the expected format. (title: too long)' });
  });

  it('has nothing to log when the caller gave up, no AI is set up or the budget is spent', () => {
    expect(outcomeOfError(new AiError('aborted', 'x'))).toBeNull();
    expect(outcomeOfError(new AiError('no-config', 'x'))).toBeNull();
    expect(outcomeOfError(new AiError('budget', 'x'))).toBeNull();
  });
});

describe('the log', () => {
  beforeEach(resetDb);

  it('keeps the latest builds and the latest failures of other tasks, oldest first', async () => {
    for (let i = 0; i < AI_LOG_BUILDS + 5; i += 1) await noteAiResult(entry({ at: T0 + i, outcome: 'ok', message: '' }));
    for (let i = 0; i < AI_LOG_OTHER + 5; i += 1) await noteAiResult(entry({ at: T0 + 100 + i, task: 'tutor', outcome: 'timeout' }));
    const entries = await recentAiResults();
    expect(entries.filter((item) => item.task === 'challenge')).toHaveLength(AI_LOG_BUILDS);
    expect(entries.filter((item) => item.task === 'tutor')).toHaveLength(AI_LOG_OTHER);
    expect(entries[0]?.at).toBe(T0 + 5);
    expect(entries.map((item) => item.at)).toEqual([...entries.map((item) => item.at)].sort((a, b) => a - b));
  });

  it('cuts a long message and survives concurrent writes', async () => {
    await Promise.all([noteAiResult(entry({ message: 'x'.repeat(500) })), noteAiResult(entry({ at: T0 + 1 })), noteAiResult(entry({ at: T0 + 2 }))]);
    const entries = await recentAiResults();
    expect(entries).toHaveLength(3);
    expect(Math.max(...entries.map((item) => item.message.length))).toBe(200);
  });

  it('summarizes today for the parent', () => {
    const yesterday = T0 - 24 * 60 * MINUTE;
    const summary = summarizeAiResults(
      [
        entry({ at: yesterday, outcome: 'timeout', message: 'old' }),
        entry({ at: T0 - 5000, outcome: 'ok', message: '' }),
        entry({ at: T0 - 4000, outcome: 'timeout', message: 'The AI service did not answer within 45 seconds.' }),
        entry({ at: T0 - 3000, task: 'remix', outcome: 'timeout', message: 'The AI service did not answer within 45 seconds.' }),
        entry({ at: T0 - 2000 }),
        entry({ at: T0 - 1000, task: 'tutor', outcome: 'timeout', message: 'tutor' }),
      ],
      T0,
    );
    expect(summary).toMatchObject({
      buildsToday: 4,
      builtToday: 1,
      commonProblem: 'The AI service did not answer within 45 seconds.',
      commonProblemCount: 2,
      failuresInARow: 3,
    });
    expect(summary.pause?.failures).toBe(3);
  });
});

describe('a model that keeps failing, through generateChallenge', () => {
  const child: ChildContext = { ageGroup: '6-8', grade: '2', interests: ['space'], locale: 'en', strictness: 'strict' };
  const plan: ChallengePlan = {
    childId: 'c1',
    skillId: 'math-addition-subtraction',
    strand: 'math',
    stage: makeStage('2', 'growing'),
    interaction: 'number',
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
  };
  const request = (patch: Partial<GenerateChallengeRequest> = {}): GenerateChallengeRequest => ({
    plan,
    child,
    expectation: { grade: '2', text: 'Add and subtract within 100' },
    skillName: 'Addition',
    ...patch,
  });
  const good = (): Record<string, unknown> => structuredClone(KIND_EXAMPLES.number) as Record<string, unknown>;
  /** Valid JSON of the wrong kind: a hard problem every time. */
  const wrongKind = (): Record<string, unknown> => structuredClone(KIND_EXAMPLES.choice) as Record<string, unknown>;

  const fetchMock = vi.fn();
  let reply: () => unknown = good;
  const chatCalls = (): number => fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/chat/completions')).length;

  beforeEach(async () => {
    await resetDb();
    await updateSettings((settings) => ({
      ...settings,
      ai: { ...settings.ai, provider: 'direct', baseUrl: 'http://localhost:11434/v1', chatModel: 'tiny', dailyRequestBudget: 0, monthlyRequestCap: 0 },
    }));
    reply = good;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/moderations')) return fakeResponse('Not found', { status: 404 });
      const next = reply();
      if (next instanceof Error) throw next;
      if (typeof next === 'object' && next !== null && 'choices' in next) return fakeResponse(next);
      return fakeResponse(completion(next));
    });
    vi.stubGlobal('fetch', fetchMock);
    resetClientSession();
    resetModerationSession();
    clientTuning.backoffMs = 0;
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes down why the built-in bank had to step in, and counts the failure', async () => {
    reply = wrongKind;
    expect((await generateChallenge(request())).source).toBe('offline');
    const [logged] = await recentAiResults();
    expect(logged).toMatchObject({ task: 'challenge', kind: 'number', model: 'tiny', outcome: 'validation' });
    expect(logged?.message).toMatch(/interaction\.kind must be "number"/);
    expect((await getUsageToday()).failures).toBe(1);
  });

  it('logs a success, a safety rejection and a transport error by their names', async () => {
    expect((await generateChallenge(request())).source).toBe('ai');
    reply = () => ({ ...good(), intro: 'Pilot Juno loads a gun before lift-off.' });
    await generateChallenge(request());
    reply = () => new TypeError('Failed to fetch');
    await generateChallenge(request());
    const entries = await recentAiResults();
    expect(entries.map((item) => item.outcome)).toEqual(['ok', 'safety', 'network']);
    expect(entries[1]?.message).toMatch(/not suitable for a child \(weapons/);
    expect(entries[2]?.message).toBe('The AI service could not be reached.');
  });

  it('stops asking after three failed builds, tells the parent, and tries again when the pause is over', async () => {
    reply = wrongKind;
    for (let i = 0; i < 3; i += 1) await generateChallenge(request());
    const afterThree = chatCalls();
    expect(afterThree).toBe(6); // two requests per build: the first reply and the one feedback round

    // Paused: the next twenty challenges cost nothing.
    for (let i = 0; i < 20; i += 1) expect((await generateChallenge(request())).source).toBe('offline');
    expect(chatCalls()).toBe(afterThree);
    expect(await recentAiResults()).toHaveLength(3);

    const status = await getAiStatus();
    expect(status.ready).toBe(true);
    expect(status.reason).toMatch(/last 3 challenges could not be built by the AI/);
    expect(status.reason).toMatch(/interaction\.kind must be "number"/);
    expect(status.reason).toMatch(/not asked again for about 10 minutes/);

    // After the pause one build is tried; it fails, and the pause doubles.
    vi.setSystemTime(T0 + 11 * MINUTE);
    await generateChallenge(request());
    expect(chatCalls()).toBe(afterThree + 2);
    vi.setSystemTime(T0 + 25 * MINUTE);
    await generateChallenge(request());
    expect(chatCalls()).toBe(afterThree + 2);

    // A success ends it.
    vi.setSystemTime(T0 + 32 * MINUTE);
    reply = good;
    expect((await generateChallenge(request())).source).toBe('ai');
    expect((await getAiStatus()).reason).not.toMatch(/could not be built/);
  });

  it('recovers from a reply that was cut off at the token limit with one more request and a higher limit', async () => {
    const whole = JSON.stringify(good());
    let sent = 0;
    reply = () => {
      sent += 1;
      // The first reply stops at 90%: title, intro, question and the whole interaction are there, the scene is not closed.
      return sent === 1 ? { choices: [{ message: { content: whole.slice(0, Math.floor(whole.length * 0.9)) }, finish_reason: 'length' }] } : good();
    };
    expect((await generateChallenge(request())).source).toBe('ai');
    const bodies = fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith('/chat/completions'))
      .map((call) => JSON.parse((call[1] as { body: string }).body) as { max_tokens: number; messages: { role: string; content: string }[] });
    expect(bodies.map((body) => body.max_tokens)).toEqual([3000, 6000]);
    // The model is not told that fields it wrote are "missing", and its cut-off text is not sent back.
    expect(bodies[1]?.messages).toEqual(bodies[0]?.messages);
  });

  it('forgets the failures when the parent changes the AI settings', async () => {
    reply = wrongKind;
    for (let i = 0; i < 3; i += 1) await generateChallenge(request());
    resetAiSession();
    await vi.waitFor(async () => expect(await db.kv.get('ai:recent')).toBeUndefined());
    reply = good;
    expect((await generateChallenge(request())).source).toBe('ai');
  });

  it('asks a model on this computer for a small scene, and a hosted model for the full one', async () => {
    const systemPrompt = (): string => {
      const call = fetchMock.mock.calls.filter((entry) => String(entry[0]).endsWith('/chat/completions')).at(-1);
      const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}')) as { messages?: { role: string; content: string }[] };
      return (body.messages ?? []).map((message) => message.content).join('\n');
    };
    expect((await generateChallenge(request())).source).toBe('ai');
    expect(systemPrompt()).toContain('Do not use objects of type "svg".');

    await updateSettings((settings) => ({ ...settings, ai: { ...settings.ai, provider: 'proxy', baseUrl: '/api/ai' } }));
    resetClientSession();
    expect((await generateChallenge(request())).source).toBe('ai');
    expect(systemPrompt()).not.toContain('Do not use objects of type "svg".');
  });

  it('logs a failed tutor request, but not what the child said', async () => {
    reply = () => new TypeError('Failed to fetch');
    const challenge = ChallengeSchema.parse(good());
    await tutorReply({ child, challenge, intent: 'chat', hintLevel: 0, openChat: true, childText: 'why is the rocket so tall' });
    const entries = await recentAiResults();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ task: 'tutor', outcome: 'network' });
    expect(JSON.stringify(entries)).not.toContain('rocket so tall');
  });
});
