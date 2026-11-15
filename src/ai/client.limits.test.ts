/**
 * Token limits, cut-off replies, time limits by endpoint, and what counts as a request.
 * (The request shape, retries and error mapping are in client.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Settings } from '@/core/types';
import { completion, errorBody, fakeResponse, sentRequest, settingsFor } from './testSupport';

const world = vi.hoisted(() => ({
  settings: null as unknown,
  usage: [] as Record<string, number>[],
}));

vi.mock('@/data', () => ({
  getSettings: vi.fn(async () => world.settings as Settings),
  checkBudget: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
  recordUsage: vi.fn(async (delta: Record<string, number>) => {
    world.usage.push(delta);
  }),
}));
vi.mock('@/security', () => ({
  getApiKeyFor: vi.fn(async () => 'sk-test'),
  hasApiKey: vi.fn(async () => true),
}));

import { chat, chatJson, clientTuning, resetClientSession, TRUNCATED_CODE } from './client';
import { AiError } from './errors';
import { testConnection } from './status';

const fetchMock = vi.fn();
const MESSAGES = [
  { role: 'system' as const, content: 'Reply in JSON.' },
  { role: 'user' as const, content: 'Go.' },
];
const Shape = z.object({ title: z.string().min(1), interaction: z.object({ kind: z.string() }), scene: z.object({ objects: z.array(z.unknown()) }) });
const GOOD = { title: 'Stars', interaction: { kind: 'choice' }, scene: { objects: [] } };

function total(counter: string): number {
  return world.usage.reduce((sum, delta) => sum + (delta[counter] ?? 0), 0);
}

function body(index: number): Record<string, unknown> {
  return sentRequest(fetchMock.mock.calls[index] as unknown[]).body;
}

/** A completion with the given finish_reason. */
function finished(content: string, reason: string): unknown {
  return { choices: [{ message: { role: 'assistant', content }, finish_reason: reason }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error('expected the call to fail');
}

function hangingFetch(): void {
  fetchMock.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
}

beforeEach(() => {
  world.settings = settingsFor('direct');
  world.usage = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetClientSession();
  clientTuning.backoffMs = 0;
  clientTuning.timeoutMs = 45_000;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a reply that was cut off at the token limit', () => {
  const cutOff = JSON.stringify(GOOD).slice(0, -12); // the scene never closes

  it('is asked again as the same question with a higher limit, not "corrected"', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(finished(cutOff, 'length')));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion(GOOD)));
    expect(await chatJson(MESSAGES, Shape, { maxTokens: 3000 })).toEqual(GOOD);

    expect(body(0).max_tokens).toBe(3000);
    expect(body(1).max_tokens).toBe(6000);
    // No echo of the cut-off text and no list of "missing" fields: the conversation is unchanged.
    expect(body(1).messages).toEqual(MESSAGES);
  });

  it('keeps the higher limit for the next request to that model', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(finished(cutOff, 'length')));
    fetchMock.mockResolvedValue(fakeResponse(completion(GOOD)));
    await chatJson(MESSAGES, Shape, { maxTokens: 3000 });
    await chatJson(MESSAGES, Shape, { maxTokens: 3000 });
    expect(body(2).max_tokens).toBe(6000);
  });

  it('asks for a shorter answer once the limit cannot go higher, with roles that alternate', async () => {
    fetchMock.mockResolvedValue(fakeResponse(finished(cutOff, 'length')));
    const error = await failure(chatJson(MESSAGES, Shape, { maxTokens: 6000 }));
    expect(error.kind).toBe('bad-response');
    expect(error.code).toBe(TRUNCATED_CODE);
    expect(error.detail).toMatch(/cut off/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect([body(0).max_tokens, body(1).max_tokens, body(2).max_tokens]).toEqual([6000, 8000, 8000]);

    const last = body(2).messages as { role: string; content: string }[];
    expect(last.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(last[3]?.content).toMatch(/cut off/);
    expect(last[3]?.content).not.toMatch(/expected|required|title|interaction/i);
  });

  it('accepts a complete answer even when the service says the limit was reached', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(finished(JSON.stringify(GOOD), 'length')));
    expect(await chatJson(MESSAGES, Shape)).toEqual(GOOD);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('goes back to the limit that was asked for when the service refuses the raised one', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(finished(cutOff, 'length')));
    fetchMock.mockResolvedValueOnce(
      fakeResponse(errorBody('max_tokens is too large: 6000. This model supports at most 4096 completion tokens.'), { status: 400 }),
    );
    fetchMock.mockResolvedValueOnce(fakeResponse(completion(GOOD)));
    expect(await chatJson(MESSAGES, Shape, { maxTokens: 3000 })).toEqual(GOOD);
    expect(body(2).max_tokens).toBe(3000);
    expect(body(2).response_format).toEqual({ type: 'json_object' });
  });
});

describe('a model that thinks before it answers', () => {
  it('gets room for thinking when the whole limit went into it, and keeps that room', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(finished('', 'length')));
    fetchMock.mockResolvedValue(fakeResponse(completion('{"ok":true}')));
    const result = await chat(MESSAGES, { maxTokens: 60 });
    expect(result.content).toBe('{"ok":true}');
    expect(body(0).max_tokens).toBe(60);
    expect(body(1).max_tokens).toBe(4060);
    expect(total('requests')).toBe(2);

    await chat(MESSAGES, { maxTokens: 260 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(body(2).max_tokens).toBe(4260);
  });

  it('says so when even that was not enough', async () => {
    fetchMock.mockResolvedValue(fakeResponse(finished('', 'length')));
    const error = await failure(chat(MESSAGES, { maxTokens: 60 }));
    expect(error.kind).toBe('bad-response');
    expect(error.code).toBe(TRUNCATED_CODE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The next call starts one step higher.
    await failure(chat(MESSAGES, { maxTokens: 60 }));
    expect(body(2).max_tokens).toBe(4060);
    expect(body(3).max_tokens).toBe(12060);
  });
});

describe('how long the client waits', () => {
  async function timesOutAfter(ms: number, call: () => Promise<unknown>): Promise<AiError> {
    vi.useFakeTimers();
    hangingFetch();
    let settled: AiError | null = null;
    const pending = failure(call()).then((error) => (settled = error));
    await vi.advanceTimersByTimeAsync(ms - 1_000);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    return pending;
  }

  it('gives a hosted service 45 seconds', async () => {
    const error = await timesOutAfter(45_000, () => chat(MESSAGES));
    expect(error.timedOut).toBe(true);
    expect(error.message).toMatch(/45 seconds/);
  });

  it('gives a model on this computer or the home network four times as long', async () => {
    world.settings = settingsFor('direct', { baseUrl: 'http://localhost:11434/v1' });
    const error = await timesOutAfter(180_000, () => chat(MESSAGES));
    expect(error.timedOut).toBe(true);
    expect(error.message).toMatch(/180 seconds/);
  });

  it('gives the proxy twice as long, and respects the cap a caller sets', async () => {
    world.settings = settingsFor('proxy', { baseUrl: '/ai-proxy/v1' });
    expect((await timesOutAfter(90_000, () => chat(MESSAGES))).timedOut).toBe(true);
    vi.useRealTimers();
    world.settings = settingsFor('direct', { baseUrl: 'http://192.168.1.20:1234/v1' });
    expect((await timesOutAfter(30_000, () => chat(MESSAGES, { timeoutMs: 15_000, maxTimeoutScale: 2 }))).timedOut).toBe(true);
  });
});

describe('what counts as a request', () => {
  it('does not count a send that never reached the service', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(total('requests')).toBe(0);
    expect(total('failures')).toBe(2);
  });

  it('does not even try a service on the internet while the device is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('network');
    expect(error.code).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(total('requests')).toBe(0);
  });

  it('still calls a model on this computer while the device is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    world.settings = settingsFor('direct', { baseUrl: 'http://127.0.0.1:11434/v1' });
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    expect(total('requests')).toBe(1);
  });

  it('counts a request that timed out or was cancelled while waiting: it was sent', async () => {
    hangingFetch();
    expect((await failure(chat(MESSAGES, { timeoutMs: 20 }))).timedOut).toBe(true);
    expect(total('requests')).toBe(1);

    const controller = new AbortController();
    const pending = failure(chat(MESSAGES, { signal: controller.signal }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    expect((await pending).kind).toBe('aborted');
    expect(total('requests')).toBe(2);
  });
});

describe('the connection test with a model that thinks first', () => {
  const gpt5Style = (): void => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(errorBody("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."), { status: 400 }),
    );
    fetchMock.mockResolvedValueOnce(
      fakeResponse(errorBody("Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported."), { status: 400 }),
    );
    fetchMock.mockResolvedValueOnce(fakeResponse(finished('', 'length')));
  };

  it('passes: the model gets room to think and then answers', async () => {
    gpt5Style();
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"ok": true}')));
    const result = await testConnection();
    expect(result.ok).toBe(true);
    expect(body(3).max_completion_tokens).toBe(4060);
    expect(body(3).temperature).toBeUndefined();
  });

  it('does not send the parent to the address when the model still writes nothing', async () => {
    gpt5Style();
    fetchMock.mockResolvedValueOnce(fakeResponse(finished('', 'length')));
    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/thinking/);
    expect(result.message).toMatch(/address and the key are fine/);
    expect(result.message).not.toMatch(/ends in \/v1/);
  });

  it('waits a minute for a model on this computer and says that the first load can be slow', async () => {
    world.settings = settingsFor('direct', { baseUrl: 'http://localhost:11434/v1' });
    vi.useFakeTimers();
    hangingFetch();
    const pending = testConnection();
    await vi.advanceTimersByTimeAsync(59_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/within 60 seconds/);
    expect(result.message).toMatch(/load the first time/);
    expect(result.message).not.toMatch(/Check the address/);
  });
});
