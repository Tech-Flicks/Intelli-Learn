/**
 * A child who is waiting on the loading screen never waits for the whole
 * generate-validate-repair loop of a real model: after a short time the built-in bank
 * serves, and the AI's challenge is kept for the next turn.
 * (The mocked AI of supply.test.ts answers at once, so this was never visible there.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStage } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type { ChallengePlan, ChallengeRecord, ChildProfile } from '@/core/types';
import { createChild, db } from '@/data';
import { generateChallenge, generateImage, generateStoryOutline, remixChallenge } from '@/ai';
import { saveToLibrary } from '@/library';
import { pickOfflineChallenge, pickOfflineStory } from '@/offline';
import { planNext, seededRng } from '@/progression';
import { ensureQueue, resetSupply, setSupplyDeps, supplyIdle, takeNext } from './supply';

vi.mock('@/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/ai')>();
  return { ...real, generateChallenge: vi.fn(), remixChallenge: vi.fn(), generateStoryOutline: vi.fn(), generateImage: vi.fn() };
});
vi.mock('@/progression', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/progression')>();
  return { ...real, planNext: vi.fn(real.planNext) };
});

const generate = vi.mocked(generateChallenge);
const remix = vi.mocked(remixChallenge);
const plan$ = vi.mocked(planNext);

const T0 = new Date(2026, 10, 9, 10, 0, 0).getTime();
let clock = T0;
const tick = (): number => (clock += 1000);
/** The wait of a child in these tests; the real one is SUPPLY.onDemandWaitMs. */
const WAIT = 40;

let cannedCount = 0;
function canned(plan: ChallengePlan, label = 'AI'): Challenge {
  cannedCount += 1;
  const base = pickOfflineChallenge(plan, { seed: cannedCount });
  return ChallengeSchema.parse({ ...base, title: `${label} ${cannedCount} ${base.title}`.slice(0, 60), question: `${base.question.slice(0, 260)} (${label} ${cannedCount})` });
}

function fixedPlan(childId: string, patch: Partial<ChallengePlan> = {}): ChallengePlan {
  return { childId, skillId: 'math-addition-subtraction', strand: 'math', stage: makeStage('2', 'growing'), interaction: 'number', mode: 'quest', purpose: 'core', theme: 'space', ...patch };
}

async function addChild(): Promise<ChildProfile> {
  const child = await createChild({ nickname: 'Zuzu', avatar: '🦊', ageGroup: '6-8', grade: '2', interests: ['space', 'robots'] }, T0 - 86_400_000);
  await db.children.update(child.id, { placementDone: true });
  return (await db.children.get(child.id)) as ChildProfile;
}

async function rowsOf(childId: string, status: ChallengeRecord['status']): Promise<ChallengeRecord[]> {
  return (await db.challenges.where('childId').equals(childId).toArray()).filter((row) => row.status === status);
}

interface SlowCall {
  signal: AbortSignal | undefined;
  finish: () => void;
}

let aiIsSlow = true;

/** Makes the mocked AI answer only when the test says so (`release` ends that: every call is answered). */
function slowAi(): SlowCall[] {
  const calls: SlowCall[] = [];
  aiIsSlow = true;
  generate.mockImplementation((req) => {
    const answer = (): { content: Challenge; source: 'ai' } => ({ content: canned(req.plan), source: 'ai' });
    if (!aiIsSlow) return Promise.resolve(answer());
    return new Promise((resolve) => {
      calls.push({ signal: req.signal, finish: () => resolve(answer()) });
    });
  });
  return calls;
}

function release(calls: SlowCall[]): void {
  aiIsSlow = false;
  calls.forEach((call) => call.finish());
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  clock = T0;
  cannedCount = 0;
  resetSupply();
  setSupplyDeps({ now: tick, rng: seededRng(11), onDemandWaitMs: WAIT, madeToOrderWaitMs: WAIT });
  generate.mockReset();
  remix.mockReset();
  remix.mockResolvedValue(null);
  vi.mocked(generateStoryOutline).mockReset();
  vi.mocked(generateStoryOutline).mockImplementation(async (req) => pickOfflineStory(req.theme, req.chapters));
  vi.mocked(generateImage).mockReset();
  vi.mocked(generateImage).mockResolvedValue(null);
  plan$.mockReset();
  plan$.mockImplementation(async (childId, count = 1) => Array.from({ length: count }, () => fixedPlan(childId)));
});

afterEach(async () => {
  await supplyIdle();
  setSupplyDeps(null);
});

describe('a child who is waiting for a challenge', () => {
  it('gets a built-in challenge when the AI takes too long, and the AI challenge joins the queue when it arrives', async () => {
    const child = await addChild();
    const calls = slowAi();
    const started = Date.now();

    const taken = await takeNext(child.id);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(taken).toMatchObject({ status: 'active', source: 'offline' });

    // The request is not cancelled: it is paid for, and its challenge is as good a minute later.
    expect(calls[0]?.signal?.aborted).toBe(false);
    release(calls);
    await supplyIdle();

    const queued = await rowsOf(child.id, 'queued');
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.every((row) => row.source === 'ai')).toBe(true);
    expect(queued.some((row) => row.content.title.startsWith('AI 1 '))).toBe(true);
    // Each is in the library, as every AI challenge is.
    for (const row of queued) expect(await db.library.get(row.libraryId ?? '')).toBeTruthy();
  });

  it('does not start a second AI request while the top-up is still busy with one', async () => {
    const child = await addChild();
    const calls = slowAi();
    void ensureQueue(child.id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const taken = await takeNext(child.id);
    expect(taken).toMatchObject({ status: 'active', source: 'offline' });
    expect(generate).toHaveBeenCalledTimes(1);

    release(calls);
  });

  it('waits no longer for a remix either: the canvas is served as it is, and the remix is given up', async () => {
    const child = await addChild();
    const plan = fixedPlan('someone-else', { theme: 'dinosaurs' });
    const item = await saveToLibrary({ content: canned(plan, 'Lib'), plan, ageGroup: '6-8', locale: 'en', origin: 'ai' }, tick());
    let signal: AbortSignal | undefined;
    remix.mockImplementation(
      (req) =>
        new Promise((resolve) => {
          signal = req.signal;
          req.signal?.addEventListener('abort', () => resolve(null));
        }),
    );
    generate.mockImplementation(async (req) => ({ content: canned(req.plan), source: 'ai' }));

    const taken = await takeNext(child.id);
    expect(taken).toMatchObject({ source: 'reused', libraryId: item.id });
    expect(signal?.aborted).toBe(true);
  });

  it('cancels a late challenge that only this moment could use (a studio idea)', async () => {
    const child = await addChild();
    const calls = slowAi();
    const taken = await takeNext(child.id, { mode: 'studio', pick: 'dragon.baking.moon' });
    expect(taken).toMatchObject({ status: 'active', source: 'offline', mode: 'studio' });
    expect(calls[0]?.signal?.aborted).toBe(true);
    release(calls);
  });

  it('still gets the AI challenge when the AI is quick enough', async () => {
    const child = await addChild();
    generate.mockImplementation(async (req) => ({ content: canned(req.plan), source: 'ai' }));
    expect((await takeNext(child.id)).source).toBe('ai');
  });
});
