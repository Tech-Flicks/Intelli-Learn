/**
 * Helpers for this module's own unit tests. Not part of the public API and
 * not imported by application code.
 */
import { defaultSettings } from '@/core/defaults';
import type { AiProvider, Settings } from '@/core/types';

export interface FakeResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

/** A minimal stand-in for a fetch Response. */
export function fakeResponse(body: unknown, init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

/** A chat completion body whose message content is `content` (objects are serialized). */
export function completion(content: unknown, usage = { prompt_tokens: 11, completion_tokens: 7 }): unknown {
  return {
    choices: [{ message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  };
}

export function errorBody(message: string): unknown {
  return { error: { message, type: 'invalid_request_error' } };
}

export interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Reads what a mocked fetch was called with. */
export function sentRequest(call: unknown[]): SentRequest {
  const [url, init] = call as [string, { headers?: Record<string, string>; body?: string }];
  return { url, headers: init.headers ?? {}, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> };
}

/** Settings with the given provider, for mocked `getSettings`. */
export function settingsFor(provider: AiProvider, patch: Partial<Settings['ai']> = {}): Settings {
  const settings = defaultSettings(0);
  settings.ai = { ...settings.ai, provider, baseUrl: 'https://ai.test/v1', chatModel: 'test-model', ...patch };
  return settings;
}
