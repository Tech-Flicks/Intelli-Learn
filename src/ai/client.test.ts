import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Settings } from '@/core/types';
import { completion, errorBody, fakeResponse, sentRequest, settingsFor } from './testSupport';

const world = vi.hoisted(() => ({
  settings: null as unknown,
  apiKey: 'sk-test' as string | null,
  budget: { allowed: true, reason: 'ok' } as { allowed: boolean; reason: 'ok' | 'daily-budget' | 'monthly-cap' },
  usage: [] as Record<string, number>[],
}));

vi.mock('@/data', () => ({
  getSettings: vi.fn(async () => world.settings as Settings),
  checkBudget: vi.fn(async () => world.budget),
  recordUsage: vi.fn(async (delta: Record<string, number>) => {
    world.usage.push(delta);
  }),
}));
vi.mock('@/security', () => ({
  getApiKeyFor: vi.fn(async () => world.apiKey),
  hasApiKey: vi.fn(async () => world.apiKey !== null),
}));

import { chat, chatJson, clientTuning, resetClientSession } from './client';
import { AiError } from './errors';

const fetchMock = vi.fn();
const MESSAGES = [
  { role: 'system' as const, content: 'Reply in JSON.' },
  { role: 'user' as const, content: 'Go.' },
];

function total(counter: string): number {
  return world.usage.reduce((sum, delta) => sum + (delta[counter] ?? 0), 0);
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

beforeEach(() => {
  world.settings = settingsFor('direct');
  world.apiKey = 'sk-test';
  world.budget = { allowed: true, reason: 'ok' };
  world.usage = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetClientSession();
  clientTuning.backoffMs = 0;
  clientTuning.timeoutMs = 45_000;
});

describe('chat: request shape', () => {
  it('posts an OpenAI-style body to {baseUrl}/chat/completions with a bearer key in direct mode', async () => {
    world.settings = settingsFor('direct', { baseUrl: 'https://ai.test/v1/', temperature: 0.5 });
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"ok":true}')));
    const result = await chat(MESSAGES, { maxTokens: 321 });

    expect(result.content).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = sentRequest(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.url).toBe('https://ai.test/v1/chat/completions');
    expect(sent.headers.Authorization).toBe('Bearer sk-test');
    expect(sent.headers['Content-Type']).toBe('application/json');
    expect(sent.body).toEqual({
      model: 'test-model',
      messages: MESSAGES,
      temperature: 0.5,
      max_tokens: 321,
      response_format: { type: 'json_object' },
    });
  });

  it('sends no Authorization header in proxy mode and defaults to the same-origin proxy path', async () => {
    world.settings = settingsFor('proxy', { baseUrl: '' });
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    const sent = sentRequest(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.url).toBe('/ai-proxy/v1/chat/completions');
    expect(Object.keys(sent.headers).map((name) => name.toLowerCase())).not.toContain('authorization');
  });

  it('never reads or sends the stored key in proxy mode', async () => {
    world.settings = settingsFor('proxy', { baseUrl: '/ai-proxy/v1' });
    world.apiKey = 'sk-should-not-leak';
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain('sk-should-not-leak');
  });

  it('is never called in demo mode', async () => {
    world.settings = settingsFor('demo');
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('no-config');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs a key for a remote service but not for a local one', async () => {
    world.apiKey = null;
    expect((await failure(chat(MESSAGES))).kind).toBe('no-config');

    world.settings = settingsFor('direct', { baseUrl: 'http://localhost:11434/v1' });
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    expect(sentRequest(fetchMock.mock.calls[0] as unknown[]).headers.Authorization).toBeUndefined();
  });

  it('reads content given as a list of text parts', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ choices: [{ message: { content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] } }] }),
    );
    expect((await chat(MESSAGES)).content).toBe('{"a":1}');
  });
});

describe('chat: budget and usage', () => {
  it('refuses to send when the budget is spent', async () => {
    world.budget = { allowed: false, reason: 'daily-budget' };
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('budget');
    expect(error.message).toMatch(/budget/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(total('requests')).toBe(0);
  });

  it('counts the request and its tokens', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}', { prompt_tokens: 120, completion_tokens: 45 })));
    await chat(MESSAGES);
    expect(total('requests')).toBe(1);
    expect(total('promptTokens')).toBe(120);
    expect(total('completionTokens')).toBe(45);
    expect(total('failures')).toBe(0);
  });

  it('counts every send and every failure', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('overloaded'), { status: 503 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    expect(total('requests')).toBe(2);
    expect(total('failures')).toBe(1);
  });
});

describe('chat: response_format fallback', () => {
  it('retries once without response_format when the endpoint rejects it, and remembers that', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody("Unknown parameter: 'response_format'."), { status: 422 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"n":1}')));
    await chat(MESSAGES);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentRequest(fetchMock.mock.calls[0] as unknown[]).body).toHaveProperty('response_format');
    expect(sentRequest(fetchMock.mock.calls[1] as unknown[]).body).not.toHaveProperty('response_format');

    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"n":2}')));
    await chat(MESSAGES);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentRequest(fetchMock.mock.calls[2] as unknown[]).body).not.toHaveProperty('response_format');
  });

  it('also retries without it on an unexplained 400, and remembers only when that worked', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse('Bad Request', { status: 400 }));
    fetchMock.mockResolvedValueOnce(fakeResponse('Bad Request', { status: 400 }));
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('bad-response');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Nothing was remembered: the next chat asks for JSON mode again.
    fetchMock.mockResolvedValueOnce(fakeResponse('Bad Request', { status: 400 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    expect(sentRequest(fetchMock.mock.calls[2] as unknown[]).body).toHaveProperty('response_format');
    expect(sentRequest(fetchMock.mock.calls[3] as unknown[]).body).not.toHaveProperty('response_format');

    // Now it is remembered.
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    expect(sentRequest(fetchMock.mock.calls[4] as unknown[]).body).not.toHaveProperty('response_format');
  });

  it('remembers per base URL', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('response_format is not supported'), { status: 400 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);

    world.settings = settingsFor('direct', { baseUrl: 'https://other.test/v1' });
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES);
    expect(sentRequest(fetchMock.mock.calls[2] as unknown[]).body).toHaveProperty('response_format');
  });

  it('switches to max_completion_tokens and drops temperature for models that demand it', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(errorBody("Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead."), { status: 400 }),
    );
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody("Unsupported value: 'temperature' does not support 0.8."), { status: 400 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{}')));
    await chat(MESSAGES, { maxTokens: 50 });
    const last = sentRequest(fetchMock.mock.calls[2] as unknown[]).body;
    expect(last.max_completion_tokens).toBe(50);
    expect(last).not.toHaveProperty('max_tokens');
    expect(last).not.toHaveProperty('temperature');
    expect(last).toHaveProperty('response_format');
  });
});

describe('chat: retries and errors', () => {
  it('retries once after a 5xx and then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse('oops', { status: 500 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"ok":1}')));
    expect((await chat(MESSAGES)).content).toBe('{"ok":1}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up with rate-limit after a second 429', async () => {
    fetchMock.mockResolvedValue(fakeResponse(errorBody('slow down'), { status: 429, headers: { 'retry-after': '0' } }));
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('rate-limit');
    expect(error.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once after a network failure and reports network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(total('failures')).toBe(2);
  });

  it('maps a rejected key to auth without retrying', async () => {
    fetchMock.mockResolvedValue(fakeResponse(errorBody('Incorrect API key provided'), { status: 401 }));
    const error = await failure(chat(MESSAGES));
    expect(error.kind).toBe('auth');
    expect(error.detail).toContain('Incorrect API key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the error types of the app proxy, and does not retry a proxy that is not set up', async () => {
    world.settings = settingsFor('proxy', { baseUrl: '/ai-proxy/v1' });
    const answer = (status: number, type: string): Response => fakeResponse({ error: { message: 'From the proxy.', type } }, { status });

    fetchMock.mockResolvedValue(answer(503, 'proxy_unavailable'));
    const absent = await failure(chat(MESSAGES));
    expect(absent).toMatchObject({ kind: 'network', status: 503, code: 'proxy_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(502, 'upstream_auth_error'));
    expect(await failure(chat(MESSAGES))).toMatchObject({ kind: 'auth', code: 'upstream_auth_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(503, 'proxy_not_configured'));
    expect(await failure(chat(MESSAGES))).toMatchObject({ kind: 'no-config', code: 'proxy_not_configured' });

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(403, 'forbidden'));
    expect(await failure(chat(MESSAGES))).toMatchObject({ kind: 'auth', code: 'forbidden' });

    // A slow or unreachable upstream may recover: one retry, as for any server fault.
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(answer(504, 'upstream_timeout')).mockResolvedValueOnce(fakeResponse(completion('{"ok":true}')));
    expect((await chat(MESSAGES)).content).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a 404 and an empty answer to bad-response, and a refusal to refused', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('The model `nope` does not exist'), { status: 404 }));
    expect((await failure(chat(MESSAGES))).kind).toBe('bad-response');

    fetchMock.mockResolvedValueOnce(fakeResponse({ choices: [{ message: { content: '' } }] }));
    expect((await failure(chat(MESSAGES))).kind).toBe('bad-response');

    fetchMock.mockResolvedValueOnce(fakeResponse({ choices: [{ message: { content: null, refusal: 'I cannot help with that.' } }] }));
    expect((await failure(chat(MESSAGES))).kind).toBe('refused');

    fetchMock.mockResolvedValueOnce(fakeResponse('<html>not an api</html>'));
    expect((await failure(chat(MESSAGES))).kind).toBe('bad-response');
  });

  it('stops at once when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await failure(chat(MESSAGES, { signal: controller.signal }))).kind).toBe('aborted');
    expect(fetchMock).not.toHaveBeenCalled();

    const second = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      second.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    expect((await failure(chat(MESSAGES, { signal: second.signal }))).kind).toBe('aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out with a network error and does not retry a timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const error = await failure(chat(MESSAGES, { timeoutMs: 20 }));
    expect(error.kind).toBe('network');
    expect(error.timedOut).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('chatJson', () => {
  const Shape = z.object({ title: z.string().min(1), count: z.number().int() });

  it('extracts JSON from a fenced reply and validates it', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('Here you go:\n```json\n{"title":"Stars","count":3}\n```')));
    expect(await chatJson(MESSAGES, Shape)).toEqual({ title: 'Stars', count: 3 });
  });

  it('feeds validation problems back and accepts the corrected reply', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion({ title: 'Stars', count: 'three' })));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion({ title: 'Stars', count: 3 })));
    expect(await chatJson(MESSAGES, Shape)).toEqual({ title: 'Stars', count: 3 });

    const retry = sentRequest(fetchMock.mock.calls[1] as unknown[]).body.messages as { role: string; content: string }[];
    expect(retry).toHaveLength(4);
    expect(retry[2]).toEqual({ role: 'assistant', content: '{"title":"Stars","count":"three"}' });
    expect(retry[3]?.role).toBe('user');
    expect(retry[3]?.content).toContain('Fix these problems and return the full corrected JSON only');
    expect(retry[3]?.content).toMatch(/- count: /);
  });

  it('tells the model when there was no JSON at all', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('I would rather write a poem.')));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion({ title: 'Ok', count: 1 })));
    await chatJson(MESSAGES, Shape);
    const retry = sentRequest(fetchMock.mock.calls[1] as unknown[]).body.messages as { content: string }[];
    expect(retry[3]?.content).toContain('did not contain a JSON object');
  });

  it('gives up with bad-response after three tries', async () => {
    fetchMock.mockImplementation(async () => fakeResponse(completion({ title: '', count: 1.5 })));
    const error = await failure(chatJson(MESSAGES, Shape));
    expect(error.kind).toBe('bad-response');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const last = sentRequest(fetchMock.mock.calls[2] as unknown[]).body.messages as unknown[];
    expect(last).toHaveLength(6);
  });

  it('respects a lower number of attempts', async () => {
    fetchMock.mockImplementation(async () => fakeResponse(completion('nope')));
    await failure(chatJson(MESSAGES, Shape, { attempts: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a transport error as if it were a format problem', async () => {
    fetchMock.mockResolvedValue(fakeResponse(errorBody('bad key'), { status: 401 }));
    expect((await failure(chatJson(MESSAGES, Shape))).kind).toBe('auth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
