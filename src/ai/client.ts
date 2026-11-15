/**
 * OpenAI-compatible client over `fetch`.
 *
 * - `POST {baseUrl}/chat/completions`, asking for a JSON object.
 * - Sends `Authorization: Bearer <key>` in direct mode only; never in proxy mode.
 * - Checks the parent's budget before every request and counts every request
 *   that reached the service (or may have: a time-out, a cancelled wait), its
 *   tokens and its failures. A send that never left the device is not counted.
 * - One retry with a pause on 429, 5xx and network failures. Endpoints that do
 *   not know `response_format` (or `max_tokens`, or `temperature`) get the
 *   request again without it, and that is remembered for the session.
 * - A reply that was cut off at the token limit is recognised (`finish_reason`
 *   "length"): a model that used the whole allowance on "thinking" is asked
 *   again with room to think, a cut-off answer is asked again with a higher
 *   limit, and both are remembered for the model.
 * - A slow endpoint (this computer, the home network, the proxy) gets more
 *   time than a hosted service.
 * - All failures become an `AiError` with a parent-readable message.
 *
 * Nothing in this file knows about children: callers pass finished messages.
 */
import type { z } from 'zod';
import { checkBudget, recordUsage } from '@/data';
import { isLocalAddress, loadAiConfig, type AiConfig } from './config';
import { AiError } from './errors';
import { describeJsonFailure, extractJsonObject } from './json';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Timing knobs. Tests set these to zero; the app never changes them. */
export const clientTuning = {
  timeoutMs: 45_000,
  backoffMs: 900,
  maxBackoffMs: 8_000,
};

/** What was learned about one model of one endpoint in this session. */
interface ModelQuirks {
  maxCompletionTokens: boolean;
  noTemperature: boolean;
  /** Extra tokens on top of every limit, for a model that "thinks" before it answers (thinking counts against the limit). */
  thinkingRoom: number;
  /** Multiplier for the limit, for a model whose answers were cut off. */
  capFactor: number;
  /** The service refused a raised limit: stay with what the caller asked for. */
  capLocked: boolean;
}

const NO_QUIRKS: ModelQuirks = { maxCompletionTokens: false, noTemperature: false, thinkingRoom: 0, capFactor: 1, capLocked: false };
/** Room for thinking: none, then this much, then (when that was still not enough) the second step. */
const THINKING_ROOM_STEPS = [4_000, 12_000] as const;
const MAX_CAP_FACTOR = 3;
/** A raised answer limit stops here (or at what the caller asked for, when that is more). */
const RAISED_ANSWER_LIMIT = 8_000;

const noResponseFormat = new Set<string>();
const modelQuirks = new Map<string, ModelQuirks>();

function quirksOf(key: string): ModelQuirks {
  return modelQuirks.get(key) ?? NO_QUIRKS;
}

function learn(key: string, patch: Partial<ModelQuirks>): void {
  modelQuirks.set(key, { ...quirksOf(key), ...patch });
}

/** The token limit to send: what the caller asked for, raised by what the model was found to need. */
function tokenLimit(asked: number, quirks: ModelQuirks): number {
  if (quirks.capLocked) return asked;
  const answer = Math.min(Math.round(asked * quirks.capFactor), Math.max(asked, RAISED_ANSWER_LIMIT));
  return answer + quirks.thinkingRoom;
}

/** True when the service is on this device or the home network (for the proxy: when the page itself is). */
function targetIsLocal(config: AiConfig): boolean {
  if (!config.baseUrl.startsWith('/')) return isLocalAddress(config.baseUrl);
  const origin = typeof globalThis.location !== 'undefined' ? globalThis.location.origin : '';
  return isLocalAddress(origin);
}

/**
 * How much longer than a hosted service this endpoint may take: a model on this computer or
 * the home network writes 10 to 30 tokens a second and may have to be loaded first (4x), and
 * the proxy may have such a model behind it (2x; the proxy itself gives up after 90 s).
 */
export function timeoutScale(config: AiConfig): number {
  if (config.provider === 'direct' && isLocalAddress(config.baseUrl)) return 4;
  let scale = config.provider === 'proxy' ? 2 : 1;
  // A model that thinks before it answers needs the time to do it.
  if (quirksOf(`${config.baseUrl}|${config.chatModel}`).thinkingRoom > 0) scale = Math.max(scale, 2);
  return scale;
}

/** Forgets what was learned about endpoints in this session (tests, and after the parent changes the AI settings). */
export function resetClientSession(): void {
  noResponseFormat.clear();
  modelQuirks.clear();
}

export function budgetMessage(reason: 'ok' | 'daily-budget' | 'monthly-cap'): string {
  return reason === 'monthly-cap'
    ? "This month's AI request cap is used up. Built-in challenges are used until next month, or raise the cap in the AI settings."
    : "Today's AI request budget is used up. Built-in challenges are used until tomorrow, or raise the budget in the AI settings.";
}

async function count(delta: Parameters<typeof recordUsage>[0]): Promise<void> {
  try {
    await recordUsage(delta);
  } catch {
    // Counting must never break play.
  }
}

function abortedError(): AiError {
  return new AiError('aborted', 'The request was cancelled.');
}

/** Resolves after `ms`, or at once when the signal aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

interface RawResponse {
  status: number;
  ok: boolean;
  text: string;
  retryAfterMs: number | null;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function sendOnce(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<RawResponse> {
  if (signal?.aborted) throw abortedError();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text, retryAfterMs: retryAfterMs(response) };
  } catch (error) {
    if (signal?.aborted) throw abortedError();
    if (timedOut) {
      throw new AiError('network', `The AI service did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, { timedOut: true });
    }
    throw new AiError('network', 'The AI service could not be reached.', {
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** The service's own error message from an error body, shortened. */
export function errorDetail(text: string): string {
  let detail = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'string') detail = error;
      else if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
        detail = (error as { message: string }).message;
      } else if (typeof (parsed as { message?: unknown }).message === 'string') {
        detail = (parsed as { message: string }).message;
      }
    }
  } catch {
    // not JSON: keep the raw text
  }
  return detail.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** The machine-readable `error.type` of an error body ('' when there is none). */
export function errorCode(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    const error = typeof parsed === 'object' && parsed !== null ? (parsed as { error?: unknown }).error : null;
    const type = typeof error === 'object' && error !== null ? (error as { type?: unknown }).type : null;
    return typeof type === 'string' ? type.trim().toLowerCase().slice(0, 60) : '';
  } catch {
    return '';
  }
}

/**
 * Errors written by the app's own proxy (`server/proxy`) and by nginx in front of it. They are told
 * apart by `error.type`, because their HTTP status alone would be misread: a 403 from the proxy is
 * a refused origin, not a rejected key, and a rejected key arrives as 502.
 */
function proxyError(status: number, code: string, detail: string): AiError | null {
  const extra = { status, detail, code };
  switch (code) {
    case 'proxy_unavailable':
      return new AiError('network', 'The AI proxy is not running on this server.', extra);
    case 'proxy_not_configured':
      return new AiError('no-config', 'The AI proxy is running, but it has no AI service address configured.', extra);
    case 'upstream_auth_error':
      return new AiError('auth', 'The AI service rejected the API key that is configured on the proxy.', extra);
    case 'upstream_error':
      return new AiError('network', 'The AI proxy could not reach the AI service.', extra);
    case 'upstream_timeout':
      return new AiError('network', 'The AI service took too long to answer the proxy.', extra);
    case 'rate_limit_exceeded':
      return new AiError('rate-limit', 'Too many AI requests were sent in a short time.', extra);
    case 'forbidden':
      return new AiError('auth', 'The AI proxy refused this request because it came from a web address it does not serve.', extra);
    default:
      return null;
  }
}

function errorForStatus(status: number, text: string, viaProxy = false): AiError {
  const detail = errorDetail(text);
  const code = errorCode(text);
  if (viaProxy) {
    const known = proxyError(status, code, detail);
    if (known) return known;
  }
  const extra = { status, detail, code };
  if (status === 401 || status === 403) {
    return new AiError('auth', `The AI service did not accept the API key (HTTP ${status}).`, extra);
  }
  if (status === 429) {
    return new AiError('rate-limit', 'The AI service is limiting requests or the account is out of credit (HTTP 429).', extra);
  }
  if (status === 404) {
    return new AiError('bad-response', 'The AI address or the model was not found (HTTP 404).', extra);
  }
  if (status >= 500) {
    return new AiError('network', `The AI service had a problem (HTTP ${status}).`, extra);
  }
  return new AiError('bad-response', `The AI service rejected the request (HTTP ${status}).`, extra);
}

export interface PostOptions {
  /** Builds the body for the next send. Called again after `adapt` changed something. */
  body: () => Record<string, unknown>;
  /**
   * Called on HTTP 400, 404 and 422 with the error body. Return true after
   * changing what `body()` builds to send again at once.
   */
  adapt?: (status: number, text: string) => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Retries after 429, 5xx and network failures. Default 1. */
  transportRetries?: number;
  /** Which usage counter one send adds to. 'none' also skips the budget check. */
  count: 'requests' | 'imageRequests' | 'none';
  /** Send even when the budget is used up (the parent's own connection test). */
  skipBudget?: boolean;
}

const MAX_ADAPTATIONS = 3;
/** `AiError.code` of a request that was not sent because the device has no connection. */
export const OFFLINE_CODE = 'offline';
/** `AiError.code` of an answer that is empty because the model used its whole token limit on thinking. */
export const TRUNCATED_CODE = 'output_truncated';
/** Proxy answers that describe a setup problem; sending the same request again cannot help. */
const PROXY_SETUP_CODES: ReadonlySet<string> = new Set(['proxy_unavailable', 'proxy_not_configured', 'upstream_auth_error', 'forbidden']);

/**
 * Sends one JSON POST to `{baseUrl}{path}` with budget check, usage counting,
 * retries and error mapping. Returns the parsed response body.
 */
export async function postJson(config: AiConfig, path: string, opts: PostOptions): Promise<unknown> {
  const url = `${config.baseUrl}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.provider === 'direct' && config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const counted = opts.count !== 'none';
  let transportLeft = opts.transportRetries ?? 1;
  let adaptLeft = MAX_ADAPTATIONS;

  for (;;) {
    if (opts.signal?.aborted) throw abortedError();
    if (counted && !opts.skipBudget) {
      const verdict = await checkBudget();
      if (!verdict.allowed) throw new AiError('budget', budgetMessage(verdict.reason));
    }
    // Without a connection nothing can leave the device: no send, no count, no retry.
    // (A service on this device or the home network is tried anyway.)
    if (typeof navigator !== 'undefined' && navigator.onLine === false && !targetIsLocal(config)) {
      throw new AiError('network', 'This device is offline, so the AI service was not contacted.', { code: OFFLINE_CODE });
    }
    const countSend = async (): Promise<void> => {
      if (opts.count === 'requests') await count({ requests: 1 });
      else if (opts.count === 'imageRequests') await count({ imageRequests: 1 });
    };

    let raw: RawResponse;
    // Checked again after the waits above: from here on, a cancelled request is one that was sent.
    if (opts.signal?.aborted) throw abortedError();
    try {
      raw = await sendOnce(url, headers, opts.body(), opts.timeoutMs ?? clientTuning.timeoutMs, opts.signal);
      await countSend();
    } catch (error) {
      // A request that timed out or was cancelled while waiting was sent, and the service may bill
      // it. One that failed before any answer (no connection, blocked by the browser, a wrong
      // address) never arrived: it must not use up the parent's budget.
      if (!(error instanceof AiError) || error.kind === 'aborted' || error.timedOut) await countSend();
      if (!(error instanceof AiError) || error.kind === 'aborted') throw error;
      if (counted) await count({ failures: 1 });
      if (!error.timedOut && transportLeft > 0) {
        transportLeft -= 1;
        await pause(clientTuning.backoffMs, opts.signal);
        continue;
      }
      throw error;
    }

    if (raw.ok) {
      try {
        return JSON.parse(raw.text) as unknown;
      } catch {
        if (counted) await count({ failures: 1 });
        throw new AiError('bad-response', 'The AI service answered with something that is not JSON. Check that the address ends in /v1.', {
          status: raw.status,
          detail: raw.text.slice(0, 200),
        });
      }
    }

    if (counted) await count({ failures: 1 });
    if ((raw.status === 400 || raw.status === 404 || raw.status === 422) && adaptLeft > 0 && opts.adapt?.(raw.status, raw.text)) {
      adaptLeft -= 1;
      continue;
    }
    const outOfCredit = /insufficient_quota|billing|credit/i.test(raw.text);
    // A proxy that is absent, unconfigured or holding a bad key answers the same way a second later.
    const settled = config.provider === 'proxy' && PROXY_SETUP_CODES.has(errorCode(raw.text));
    if ((raw.status === 429 || raw.status >= 500) && transportLeft > 0 && !outOfCredit && !settled) {
      transportLeft -= 1;
      const wait = Math.min(raw.retryAfterMs ?? clientTuning.backoffMs, clientTuning.maxBackoffMs);
      await pause(wait, opts.signal);
      continue;
    }
    throw errorForStatus(raw.status, raw.text, config.provider === 'proxy');
  }
}

export interface ChatOptions {
  signal?: AbortSignal;
  /** Overrides the temperature from the settings. */
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Time limit for a fast hosted service. A slow endpoint (see `timeoutScale`) gets a multiple of it,
   * at most `maxTimeoutScale` times.
   */
  maxTimeoutScale?: number;
  /** Ask for a JSON object (default true). */
  json?: boolean;
  /** Use this configuration instead of the saved settings (connection test). */
  config?: AiConfig;
  transportRetries?: number;
  skipBudget?: boolean;
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  /** The service's `finish_reason` ('' when it sent none). 'length' means the text was cut off at the token limit. */
  finishReason: string;
  /** With `finishReason` 'length': true when the limit for this model was raised just now, so asking again can help. */
  limitRaised: boolean;
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Text of `choices[0].message.content`, which is a string or a list of text parts. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

async function requireConfig(): Promise<AiConfig> {
  const result = await loadAiConfig();
  if (!result.ok) throw new AiError('no-config', result.reason);
  return result.config;
}

/** One chat completion. Throws `AiError`. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const config = opts.config ?? (await requireConfig());
  const quirkKey = `${config.baseUrl}|${config.chatModel}`;
  const asked = opts.maxTokens ?? 1200;
  const state = {
    responseFormat: opts.json !== false && !noResponseFormat.has(config.baseUrl),
    maxCompletionTokens: quirksOf(quirkKey).maxCompletionTokens,
    temperature: !quirksOf(quirkKey).noTemperature,
  };

  // At most two passes: the second only for a model that spent the whole limit on thinking.
  for (let pass = 0; ; pass += 1) {
    let droppedFormatOnAGuess = false;
    const limit = tokenLimit(asked, quirksOf(quirkKey));
    const timeoutMs = (opts.timeoutMs ?? clientTuning.timeoutMs) * Math.min(timeoutScale(config), opts.maxTimeoutScale ?? Number.POSITIVE_INFINITY);

    const raw = await postJson(config, '/chat/completions', {
      count: 'requests',
      signal: opts.signal,
      timeoutMs,
      transportRetries: opts.transportRetries,
      skipBudget: opts.skipBudget,
      body: () => {
        const body: Record<string, unknown> = { model: config.chatModel, messages };
        if (state.temperature) body.temperature = opts.temperature ?? config.temperature;
        const tokens = tokenLimit(asked, quirksOf(quirkKey));
        if (state.maxCompletionTokens) body.max_completion_tokens = tokens;
        else body.max_tokens = tokens;
        if (state.responseFormat) body.response_format = { type: 'json_object' };
        return body;
      },
      adapt: (status, text) => {
        const lower = text.toLowerCase();
        if (state.responseFormat && /response_format|json_object|json mode/.test(lower)) {
          state.responseFormat = false;
          noResponseFormat.add(config.baseUrl);
          return true;
        }
        if (status === 400 && !state.maxCompletionTokens && lower.includes('max_completion_tokens')) {
          state.maxCompletionTokens = true;
          learn(quirkKey, { maxCompletionTokens: true });
          return true;
        }
        if (status === 400 && state.temperature && lower.includes('temperature')) {
          state.temperature = false;
          learn(quirkKey, { noTemperature: true });
          return true;
        }
        // The limit this client raised is more than the model or its context window allows: back to what was asked.
        if (tokenLimit(asked, quirksOf(quirkKey)) > asked && /max_tokens|max_completion_tokens|context|maximum|too (?:large|long|many)/.test(lower)) {
          learn(quirkKey, { capLocked: true });
          return true;
        }
        // An unexplained 400: older or local servers often reject response_format without naming it.
        if (status === 400 && state.responseFormat) {
          state.responseFormat = false;
          droppedFormatOnAGuess = true;
          return true;
        }
        return false;
      },
    });
    // The guess is only remembered once the request went through without it.
    if (droppedFormatOnAGuess) noResponseFormat.add(config.baseUrl);

    const data = (typeof raw === 'object' && raw !== null ? raw : {}) as {
      choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const promptTokens = tokenCount(data.usage?.prompt_tokens);
    const completionTokens = tokenCount(data.usage?.completion_tokens);
    if (promptTokens > 0 || completionTokens > 0) await count({ promptTokens, completionTokens });

    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    const content = messageText(choice?.message?.content).trim();
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : '';
    if (content === '') {
      await count({ failures: 1 });
      const refusal = choice?.message?.refusal;
      if ((typeof refusal === 'string' && refusal.trim() !== '') || finishReason === 'content_filter') {
        throw new AiError('refused', 'The AI model declined to answer this request.');
      }
      if (finishReason === 'length') {
        // The whole limit went into thinking. Give the model room for it, once, and remember that it needs it.
        const quirks = quirksOf(quirkKey);
        if (pass === 0 && !quirks.capLocked) {
          const next = THINKING_ROOM_STEPS.find((room) => room > quirks.thinkingRoom);
          // (Another request may have learned it in the meantime: then the higher limit is simply used.)
          if (tokenLimit(asked, quirks) === limit && next !== undefined) learn(quirkKey, { thinkingRoom: next });
          if (tokenLimit(asked, quirksOf(quirkKey)) > limit) continue;
        }
        throw new AiError(
          'bad-response',
          'The AI model used up its whole answer allowance on "thinking" and wrote no answer. A model without long "thinking" works better.',
          { code: TRUNCATED_CODE },
        );
      }
      throw new AiError('bad-response', 'The AI service answered without any text.');
    }
    if (finishReason === 'content_filter') {
      await count({ failures: 1 });
      throw new AiError('refused', 'The AI service filtered the answer.');
    }
    let limitRaised = false;
    if (finishReason === 'length') {
      // The answer was cut off: the next request to this model gets a higher limit.
      const quirks = quirksOf(quirkKey);
      if (!quirks.capLocked && quirks.capFactor < MAX_CAP_FACTOR) {
        learn(quirkKey, { capFactor: quirks.capFactor + 1 });
        limitRaised = tokenLimit(asked, quirksOf(quirkKey)) > limit;
      }
    }
    return { content, promptTokens, completionTokens, finishReason, limitRaised };
  }
}

export interface ChatJsonOptions extends ChatOptions {
  /** Total tries, counting the first (default 3: the first plus two repairs). */
  attempts?: number;
  /** Applied to the extracted JSON before it is validated, to repair harmless slips. */
  prepare?: (raw: Record<string, unknown>) => unknown;
}

const MAX_ISSUES = 12;
const MAX_ECHO_CHARS = 12_000;

/** Zod issues as short lines a model can act on. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.map((part) => String(part)).join('.');
    return `${path === '' ? '(top level)' : path}: ${issue.message}`;
  });
}

export function repairMessage(problems: string[]): string {
  return [
    'Your JSON did not pass validation.',
    'Fix these problems and return the full corrected JSON only:',
    ...problems.map((problem) => `- ${problem}`),
  ].join('\n');
}

/** What to tell a model whose reply was cut off although the limit cannot be raised any further. */
const CUT_OFF_MESSAGE =
  'Your reply was cut off before the JSON was complete, because it was too long. Write the whole JSON object again, more compactly: shorter texts, fewer scene objects and no svg drawing.';
const CUT_OFF_ECHO_CHARS = 600;

/**
 * Chat that must come back as JSON matching `schema`. The JSON object of the
 * reply is parsed and validated; on failure the model gets its own reply back
 * with the list of problems, up to two more times. A reply that was cut off
 * at the token limit is not echoed and not "corrected": the same question is
 * asked again with a higher limit.
 * Throws `AiError` ('bad-response' when the model never produced valid JSON).
 */
export async function chatJson<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts: ChatJsonOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.min(3, opts.attempts ?? 3));
  let conversation = messages;
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { content, finishReason, limitRaised } = await chat(conversation, { ...opts, json: true });
    const candidate = extractJsonObject(content);
    if (candidate !== undefined) {
      const parsed = schema.safeParse(opts.prepare ? opts.prepare(candidate) : candidate);
      if (parsed.success) return parsed.data;
      lastProblems = describeIssues(parsed.error);
    }
    if (finishReason === 'length') {
      // Nothing is wrong with what the model wrote, there was only no room for all of it.
      lastProblems = ['The reply was cut off at the token limit before the JSON was complete.'];
      if (!limitRaised) {
        conversation = [
          ...messages,
          { role: 'assistant', content: `${content.slice(0, CUT_OFF_ECHO_CHARS)} ...` },
          { role: 'user', content: CUT_OFF_MESSAGE },
        ];
      }
      continue;
    }
    if (candidate === undefined) {
      const broken = describeJsonFailure(content);
      lastProblems = [broken !== '' ? broken : 'The reply did not contain a JSON object. Reply with exactly one JSON object and nothing else.'];
    }
    conversation = [
      ...conversation,
      { role: 'assistant', content: content.slice(0, MAX_ECHO_CHARS) },
      { role: 'user', content: repairMessage(lastProblems) },
    ];
  }
  await count({ failures: 1 });
  throw new AiError('bad-response', 'The AI model did not return content in the expected format.', {
    detail: lastProblems.join('; ').slice(0, 300),
    code: lastProblems[0]?.startsWith('The reply was cut off') ? TRUNCATED_CODE : '',
  });
}
