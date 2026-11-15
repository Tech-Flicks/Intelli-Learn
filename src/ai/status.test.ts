import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '@/core/types';
import { completion, errorBody, fakeResponse, sentRequest, settingsFor } from './testSupport';

const world = vi.hoisted(() => ({
  settings: null as unknown,
  apiKey: 'sk-saved' as string | null,
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
vi.mock('@/security', () => ({
  getApiKeyFor: vi.fn(async () => world.apiKey),
  hasApiKey: vi.fn(async () => world.apiKey !== null),
}));

import { clientTuning, resetClientSession } from './client';
import { isLocalAddress, loadAiConfig, normalizeBaseUrl } from './config';
import { getAiStatus, testConnection } from './status';

const fetchMock = vi.fn();

beforeEach(() => {
  world.settings = settingsFor('direct');
  world.apiKey = 'sk-saved';
  world.budget = { allowed: true, reason: 'ok' };
  world.usage = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetClientSession();
  clientTuning.backoffMs = 0;
});

describe('config', () => {
  it('normalizes the base URL', () => {
    expect(normalizeBaseUrl('  https://api.example.org/v1//  ')).toBe('https://api.example.org/v1');
  });

  it('knows local addresses', () => {
    for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://192.168.1.20:8080/v1', 'http://10.0.0.5/v1', 'http://nas.local/v1', 'http://172.20.0.3/v1']) {
      expect(isLocalAddress(url), url).toBe(true);
    }
    for (const url of ['https://api.openai.com/v1', 'http://172.40.0.3/v1', 'http://8.8.8.8/v1', 'not a url']) {
      expect(isLocalAddress(url), url).toBe(false);
    }
  });

  it('explains what is missing', async () => {
    world.settings = settingsFor('demo');
    expect(await loadAiConfig()).toMatchObject({ ok: false, provider: 'demo' });

    world.settings = settingsFor('direct', { baseUrl: 'api.example.org' });
    expect(await loadAiConfig()).toMatchObject({ ok: false, reason: expect.stringMatching(/must start with http/) });

    world.settings = settingsFor('direct', { baseUrl: '' });
    expect(await loadAiConfig()).toMatchObject({ ok: false, reason: expect.stringMatching(/No AI address/) });

    world.settings = settingsFor('direct', { chatModel: '' });
    expect(await loadAiConfig()).toMatchObject({ ok: false, reason: expect.stringMatching(/No AI model/) });

    world.settings = settingsFor('direct');
    world.apiKey = null;
    expect(await loadAiConfig()).toMatchObject({ ok: false, reason: expect.stringMatching(/No API key/) });
  });

  it('never carries a key in proxy mode', async () => {
    world.settings = settingsFor('proxy', { baseUrl: '/ai-proxy/v1' });
    const loaded = await loadAiConfig({ apiKey: 'sk-typed' });
    expect(loaded).toMatchObject({ ok: true, config: { provider: 'proxy', apiKey: null, baseUrl: '/ai-proxy/v1' } });
  });
});

describe('getAiStatus', () => {
  it('reports demo mode as not ready, with the reason', async () => {
    world.settings = settingsFor('demo');
    const status = await getAiStatus();
    expect(status.provider).toBe('demo');
    expect(status.ready).toBe(false);
    expect(status.reason).toMatch(/Demo mode/);
  });

  it('reports a usable configuration as ready', async () => {
    const status = await getAiStatus();
    expect(status).toMatchObject({ provider: 'direct', ready: true });
    expect(status.reason).toContain('test-model');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a spent budget and a missing key', async () => {
    world.budget = { allowed: false, reason: 'monthly-cap' };
    expect(await getAiStatus()).toMatchObject({ provider: 'direct', ready: false, reason: expect.stringMatching(/month/) });
    world.budget = { allowed: true, reason: 'ok' };
    world.apiKey = null;
    expect(await getAiStatus()).toMatchObject({ provider: 'direct', ready: false, reason: expect.stringMatching(/API key/) });
  });
});

describe('testConnection', () => {
  it('sends one tiny JSON request and reports success with the latency', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"ok": true}')));
    const result = await testConnection();
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Connected.*test-model/);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const sent = sentRequest(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.headers.Authorization).toBe('Bearer sk-saved');
    expect(sent.body.max_tokens).toBeLessThanOrEqual(100);
    // No TASK marker: the mock AI answers a plain greeting for a connection test.
    expect(JSON.stringify(sent.body.messages)).not.toMatch(/TASK:/);
  });

  it('tests the values from the form before they are saved', async () => {
    world.settings = settingsFor('demo');
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"ok": true}')));
    const result = await testConnection({ provider: 'direct', baseUrl: 'http://localhost:8787/v1/', apiKey: 'sk-typed', chatModel: 'mock-stem-1' });
    expect(result.ok).toBe(true);
    const sent = sentRequest(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.url).toBe('http://localhost:8787/v1/chat/completions');
    expect(sent.headers.Authorization).toBe('Bearer sk-typed');
    expect(sent.body.model).toBe('mock-stem-1');
  });

  it('works even when the budget is spent, and still counts the request', async () => {
    world.budget = { allowed: false, reason: 'daily-budget' };
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"ok": true}')));
    expect((await testConnection()).ok).toBe(true);
    expect(world.usage).toContainEqual({ requests: 1 });
  });

  it('says there is nothing to test in demo mode', async () => {
    world.settings = settingsFor('demo');
    const result = await testConnection();
    expect(result).toMatchObject({ ok: true, latencyMs: 0 });
    expect(result.message).toMatch(/Demo mode/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports incomplete settings without sending anything', async () => {
    const result = await testConnection({ provider: 'direct', baseUrl: 'https://api.example.org/v1', apiKey: '', chatModel: '' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/model/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a wrong key', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('Incorrect API key provided'), { status: 401 }));
    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rejected the API key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains a wrong URL', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse('<html>404 page not found</html>', { status: 404 }));
    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Nothing answered at this address/);
    expect(result.message).toMatch(/\/v1/);
  });

  it('explains a model that does not exist', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('The model `gpt-nope` does not exist or you do not have access to it.'), { status: 404 }));
    const remote = await testConnection({ chatModel: 'gpt-nope' });
    expect(remote.ok).toBe(false);
    expect(remote.message).toMatch(/does not know the model "gpt-nope"/);

    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('model "llama9" not found, try pulling it first'), { status: 404 }));
    const local = await testConnection({ baseUrl: 'http://localhost:11434/v1', chatModel: 'llama9' });
    expect(local.message).toMatch(/downloaded on the local server/);
  });

  it('explains a blocked or unreachable endpoint with the Ollama and proxy hint', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await testConnection({ baseUrl: 'http://localhost:11434/v1' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not be reached/);
    expect(result.message).toMatch(/OLLAMA_ORIGINS/);
    expect(result.message).toMatch(/proxy mode/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds the proxy advice for a plain http address on another computer, which an installed copy may not call', async () => {
    world.settings = settingsFor('direct', { baseUrl: 'http://192.168.1.60:11434/v1' });
    world.apiKey = null;
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await testConnection()).message).toMatch(/starts with http:\/\/ and is on another computer.*proxy mode/);

    world.settings = settingsFor('direct', { baseUrl: 'http://localhost:11434/v1' });
    expect((await testConnection()).message).not.toMatch(/on another computer/);
  });

  it('explains an unreachable proxy', async () => {
    world.settings = settingsFor('proxy', { baseUrl: '/ai-proxy/v1' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await testConnection();
    expect(result.message).toMatch(/proxy could not be reached/);
  });

  it.each([
    [503, 'proxy_unavailable', /proxy is not running/],
    [503, 'proxy_not_configured', /UPSTREAM_BASE_URL/],
    [502, 'upstream_auth_error', /UPSTREAM_API_KEY/],
    [502, 'upstream_error', /could not reach the AI service/],
    [504, 'upstream_timeout', /took too long/],
    [429, 'rate_limit_exceeded', /RATE_LIMIT_PER_MINUTE/],
    [403, 'forbidden', /ALLOWED_ORIGINS/],
  ] as const)('explains the proxy error %i %s', async (status, type, advice) => {
    world.settings = settingsFor('proxy', { baseUrl: '/ai-proxy/v1' });
    fetchMock.mockResolvedValue(fakeResponse({ error: { message: 'Proxy says no.', type } }, { status }));
    const result = await testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(advice);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not read proxy error types into the answers of a direct service', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ error: { message: 'Forbidden', type: 'forbidden' } }, { status: 403 }));
    const result = await testConnection();
    expect(result.message).toMatch(/rejected the API key/);
  });

  it('explains rate limiting, a server fault and a model that cannot write JSON', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('You exceeded your current quota'), { status: 429 }));
    expect((await testConnection()).message).toMatch(/limiting requests|no credit/);

    fetchMock.mockResolvedValueOnce(fakeResponse('bad gateway', { status: 502 }));
    expect((await testConnection()).message).toMatch(/HTTP 502/);

    fetchMock.mockResolvedValueOnce(fakeResponse(completion('Hello there! How can I help?')));
    const noJson = await testConnection();
    expect(noJson.ok).toBe(false);
    expect(noJson.message).toMatch(/not with JSON/);
  });

  it('retries without response_format for servers that reject it', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('response_format is not supported'), { status: 400 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(completion('{"ok": true}')));
    expect((await testConnection()).ok).toBe(true);
  });

  it('gives up after 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );
      const pending = testConnection();
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/did not answer within 15 seconds/);
    } finally {
      vi.useRealTimers();
    }
  });
});
