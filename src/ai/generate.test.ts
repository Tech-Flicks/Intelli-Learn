import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStage } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type { ChallengePlan, Settings } from '@/core/types';
import { completion, fakeResponse, sentRequest, settingsFor } from './testSupport';

const world = vi.hoisted(() => ({
  settings: null as unknown,
  budget: { allowed: true, reason: 'ok' } as { allowed: boolean; reason: string },
  usage: [] as Record<string, number>[],
}));

vi.mock('@/data', () => ({
  getSettings: vi.fn(async () => world.settings as Settings),
  checkBudget: vi.fn(async () => world.budget),
  recordUsage: vi.fn(async (delta: Record<string, number>) => {
    world.usage.push(delta);
  }),
}));
vi.mock('@/security', () => ({ getApiKey: vi.fn(async () => 'sk-test') }));
vi.mock('@/offline', () => ({
  pickOfflineChallenge: vi.fn(() => OFFLINE),
  pickOfflineStory: vi.fn(),
}));

import { pickOfflineChallenge } from '@/offline';
import { clientTuning, resetClientSession } from './client';
import { generateChallenge, hardProblems, remixChallenge, softProblems } from './generate';
import { KIND_EXAMPLES } from './prompts';
import { resetModerationSession } from './safety';
import type { ChildContext, GenerateChallengeRequest } from './types';

const OFFLINE: Challenge = ChallengeSchema.parse({
  title: 'Offline fallback',
  intro: 'A built-in challenge.',
  question: 'How many dots?',
  readAloud: 'A built-in challenge. How many dots?',
  interaction: { kind: 'number', answer: 2 },
  hints: ['Count them.', 'Point at each dot.'],
  walkthrough: ['Point at a dot.', 'Count on.'],
  explanation: 'There are two dots.',
  scene: { theme: 'plain', objects: [] },
});

const child: ChildContext = { ageGroup: '6-8', grade: '2', interests: ['space'], locale: 'en', strictness: 'strict' };
const plan: ChallengePlan = {
  childId: 'c1',
  skillId: 'math-addition',
  strand: 'math',
  stage: makeStage('2', 'growing'),
  interaction: 'number',
  mode: 'quest',
  purpose: 'core',
  theme: 'space',
};

function request(patch: Partial<GenerateChallengeRequest> = {}): GenerateChallengeRequest {
  return { plan, child, expectation: { grade: '2', text: 'Add and subtract within 100' }, skillName: 'Addition', ...patch };
}

/** A copy of a prompt example with changes, as the model would send it. */
function example(kind: keyof typeof KIND_EXAMPLES, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(structuredClone(KIND_EXAMPLES[kind]) as Record<string, unknown>), ...patch };
}

const fetchMock = vi.fn();
let chatReplies: unknown[] = [];
let moderationReply: () => Response = () => fakeResponse('Not found', { status: 404 });

function chatCalls(): ReturnType<typeof sentRequest>[] {
  return fetchMock.mock.calls.map((call) => sentRequest(call as unknown[])).filter((sent) => sent.url.endsWith('/chat/completions'));
}

function messagesOf(index: number): { role: string; content: string }[] {
  return chatCalls()[index]?.body.messages as { role: string; content: string }[];
}

beforeEach(() => {
  world.settings = settingsFor('direct');
  world.budget = { allowed: true, reason: 'ok' };
  world.usage = [];
  chatReplies = [];
  moderationReply = () => fakeResponse('Not found', { status: 404 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/moderations')) return moderationReply();
    const next = chatReplies.shift();
    if (next === undefined) return fakeResponse('no more replies', { status: 500 });
    if (next instanceof Error) throw next;
    return fakeResponse(completion(next));
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(pickOfflineChallenge).mockClear();
  resetClientSession();
  resetModerationSession();
  clientTuning.backoffMs = 0;
});

describe('generateChallenge: offline paths', () => {
  it('uses the offline bank in demo mode without touching the network', async () => {
    world.settings = settingsFor('demo');
    const result = await generateChallenge(request({ avoidTitles: ['Old title'] }));
    expect(result).toEqual({ content: OFFLINE, source: 'offline' });
    expect(pickOfflineChallenge).toHaveBeenCalledWith(plan, { avoidTitles: ['Old title'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the offline bank when the settings are incomplete', async () => {
    world.settings = settingsFor('direct', { chatModel: '  ' });
    expect((await generateChallenge(request())).source).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the offline bank when the budget is spent', async () => {
    world.budget = { allowed: false, reason: 'daily-budget' };
    expect((await generateChallenge(request())).source).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the offline item at once when the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await generateChallenge(request({ signal: controller.signal }))).source).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the offline item when the request is aborted while waiting', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    expect((await generateChallenge(request({ signal: controller.signal }))).source).toBe('offline');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws: a dead network ends in the offline bank', async () => {
    chatReplies = [new TypeError('Failed to fetch'), new TypeError('Failed to fetch')];
    expect((await generateChallenge(request())).source).toBe('offline');
  });

  it('gives up after malformed replies', async () => {
    chatReplies = ['not json', 'still not json', '{"title": 5}'];
    expect((await generateChallenge(request())).source).toBe('offline');
    expect(chatCalls()).toHaveLength(3);
  });
});

describe('generateChallenge: AI path', () => {
  it('returns a validated, normalized AI challenge', async () => {
    chatReplies = [example('number')];
    const result = await generateChallenge(request());
    expect(result.source).toBe('ai');
    expect(result.content.title).toBe('Rocket Fuel Check');
    expect(result.content.interaction).toMatchObject({ kind: 'number', answer: 5 });
    expect(pickOfflineChallenge).not.toHaveBeenCalled();

    const [first] = chatCalls();
    expect(first?.body.response_format).toEqual({ type: 'json_object' });
    const messages = messagesOf(0);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content.startsWith('TASK: challenge\nINTERACTION_KIND: number\nGRADE: 2\nMODE: quest\nTHEME: space')).toBe(true);
    expect(messages[1]?.role).toBe('user');
  });

  it('accepts harmless slips (null optionals, a colour name, a coordinate off the stage) without a second request', async () => {
    const sloppy = example('number', { funFact: null });
    const scene = sloppy.scene as { objects: Record<string, unknown>[] };
    scene.objects[0] = { ...scene.objects[0], x: 104, color: 'orange', label: null };
    chatReplies = [sloppy];
    const result = await generateChallenge(request());
    expect(result.source).toBe('ai');
    expect(result.content.scene.objects[0]).toMatchObject({ x: 100, color: '#fb8c00' });
    expect(chatCalls()).toHaveLength(1);
  });

  it('checks the result with the moderation endpoint and remembers when there is none', async () => {
    chatReplies = [example('number'), example('number', { title: 'Second one' })];
    await generateChallenge(request());
    await generateChallenge(request());
    const moderationCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/moderations'));
    expect(moderationCalls).toHaveLength(1);
  });

  it('feeds back a wrong interaction kind once, then falls back', async () => {
    chatReplies = [example('choice'), example('choice')];
    const result = await generateChallenge(request());
    expect(result).toEqual({ content: OFFLINE, source: 'offline' });
    expect(chatCalls()).toHaveLength(2);

    const retry = messagesOf(1);
    expect(retry).toHaveLength(4);
    expect(retry[2]?.role).toBe('assistant');
    expect(retry[3]?.content).toContain('interaction.kind must be "number", but it is "choice"');
    expect(retry[3]?.content).toContain('Fix these problems and return the full corrected JSON only');
  });

  it('accepts the corrected challenge after feedback', async () => {
    chatReplies = [example('choice'), example('number')];
    const result = await generateChallenge(request());
    expect(result.source).toBe('ai');
    expect(result.content.interaction.kind).toBe('number');
  });

  it('feeds back what the engine validators report', async () => {
    const leaky = example('number', { hints: ['Think about taking away.', 'The answer is 5.'] });
    chatReplies = [leaky, example('number')];
    const result = await generateChallenge(request());
    expect(result.source).toBe('ai');
    expect(messagesOf(1)[3]?.content).toMatch(/hint 2 gives away the exact answer/);
  });

  it('rejects unsafe content, asks for a different challenge without echoing it, then falls back', async () => {
    const unsafe = example('number', { intro: 'Pilot Juno loads a gun before lift-off.' });
    chatReplies = [unsafe, unsafe];
    const result = await generateChallenge(request());
    expect(result).toEqual({ content: OFFLINE, source: 'offline' });
    expect(chatCalls()).toHaveLength(2);

    const retry = messagesOf(1);
    expect(retry).toHaveLength(3);
    expect(retry.some((message) => message.role === 'assistant')).toBe(false);
    expect(retry[2]?.content).toMatch(/not suitable for a child/);
    expect(retry[2]?.content).toMatch(/weapons/);
  });

  it('applies the stricter tier only for strict children', async () => {
    const spooky = example('number', { intro: 'A friendly ghost counts the fuel cells.' });
    chatReplies = [spooky];
    const standard = await generateChallenge(request({ child: { ...child, strictness: 'standard' } }));
    expect(standard.source).toBe('ai');

    chatReplies = [spooky, spooky];
    expect((await generateChallenge(request())).source).toBe('offline');
  });

  it('falls back when the moderation endpoint flags the content', async () => {
    moderationReply = () => fakeResponse({ results: [{ flagged: true, categories: { violence: true } }] });
    chatReplies = [example('number'), example('number')];
    expect((await generateChallenge(request())).source).toBe('offline');
    expect(messagesOf(1)[2]?.content).toMatch(/moderation/);
  });

  it('is not blocked by a moderation outage', async () => {
    moderationReply = () => fakeResponse('down', { status: 503 });
    chatReplies = [example('number')];
    expect((await generateChallenge(request())).source).toBe('ai');
  });

  it('gives one round of feedback for a hint that names the answer, then accepts a correct and safe challenge', async () => {
    const options = [
      { id: 'o1', label: 'Triangle' },
      { id: 'o2', label: 'Square', misconception: 'Count the sides again.' },
    ];
    const leaky = example('choice', {
      interaction: { kind: 'choice', multi: false, options, correctIds: ['o1'] },
      hints: ['Count the sides.', 'It is the triangle.'],
    });
    const choicePlan = { ...plan, interaction: 'choice' as const };

    chatReplies = [leaky, leaky];
    const result = await generateChallenge(request({ plan: choicePlan }));
    expect(result.source).toBe('ai');
    expect(chatCalls()).toHaveLength(2);
    expect(messagesOf(1)[3]?.content).toMatch(/hint 2 gives the answer away/);
  });

  it('passes a harmless studio idea as delimited data and drops an unsafe one before anything is sent', async () => {
    const studioPlan = { ...plan, mode: 'studio' as const };
    chatReplies = [example('number')];
    await generateChallenge(request({ plan: studioPlan, studioIdea: 'a purple dragon eating pancakes' }));
    expect(messagesOf(0)[1]?.content).toContain('<child_input>a purple dragon eating pancakes</child_input>');

    chatReplies = [example('number', { title: 'Another' })];
    await generateChallenge(request({ plan: studioPlan, studioIdea: 'a man with a gun, my address is 12 Oak Street' }));
    const sent = JSON.stringify(messagesOf(1));
    expect(sent).not.toContain('<child_input>a man');
    expect(sent).not.toContain('Oak Street');
  });

  it('counts the requests it makes', async () => {
    chatReplies = [example('choice'), example('number')];
    await generateChallenge(request());
    const requests = world.usage.reduce((sum, delta) => sum + (delta.requests ?? 0), 0);
    expect(requests).toBe(2);
  });
});

describe('hardProblems and softProblems', () => {
  it('reports nothing for a good challenge', () => {
    const good = ChallengeSchema.parse(KIND_EXAMPLES.build);
    expect(hardProblems(good, 'build')).toEqual([]);
    expect(softProblems(good, 'en')).toEqual([]);
  });

  it('reports a kind mismatch and validator problems together', () => {
    const broken = ChallengeSchema.parse(example('choice', { interaction: { kind: 'choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctIds: ['zzz'] } }));
    const problems = hardProblems(broken, 'tap');
    expect(problems[0]).toContain('interaction.kind must be "tap"');
    expect(problems.join(' ')).toMatch(/correctIds are not options/);
  });
});

describe('remixChallenge', () => {
  const original = ChallengeSchema.parse(KIND_EXAMPLES.number);
  const remixRequest = { original, plan: { ...plan, theme: 'ocean' }, child, expectation: { grade: '2' as const, text: 'Subtract within 10' }, skillName: 'Subtraction' };

  it('returns null without AI', async () => {
    world.settings = settingsFor('demo');
    expect(await remixChallenge(remixRequest)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pickOfflineChallenge).not.toHaveBeenCalled();
  });

  it('returns the re-themed challenge and sends the original as data', async () => {
    chatReplies = [example('number', { title: 'Submarine Battery Check', question: 'The submarine has 9 lamps. 4 go out. How many still shine?', interaction: { kind: 'number', answer: 5 } })];
    const remix = await remixChallenge(remixRequest);
    expect(remix?.title).toBe('Submarine Battery Check');
    const messages = messagesOf(0);
    expect(messages[0]?.content).toContain('THEME: ocean');
    expect(messages[1]?.content).toContain('<original_challenge>');
    expect(messages[1]?.content).toContain('Rocket Fuel Check');
  });

  it('returns null for a copy of the original', async () => {
    chatReplies = [example('number')];
    expect(await remixChallenge(remixRequest)).toBeNull();
  });

  it('returns null when the kind changed or the model keeps failing', async () => {
    chatReplies = [example('choice'), example('choice')];
    expect(await remixChallenge(remixRequest)).toBeNull();
    chatReplies = [new TypeError('Failed to fetch'), new TypeError('Failed to fetch')];
    expect(await remixChallenge(remixRequest)).toBeNull();
  });
});
