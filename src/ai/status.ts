/**
 * What a parent needs to know about the AI connection: is it ready, and when
 * a test fails, what exactly to fix.
 */
import type { AiProvider } from '@/core/types';
import { checkBudget } from '@/data';
import { budgetMessage, chat, timeoutScale, TRUNCATED_CODE } from './client';
import { isLocalAddress, loadAiConfig, type AiConfig, type AiConfigOverride } from './config';
import { recentAiResults, summarizeAiResults } from './diagnostics';
import { AiError } from './errors';
import { extractJsonObject } from './json';

/** Whether AI generation can be used right now, with a parent-readable reason either way. */
export async function getAiStatus(): Promise<{ provider: AiProvider; ready: boolean; reason: string }> {
  const loaded = await loadAiConfig();
  if (!loaded.ok) return { provider: loaded.provider, ready: false, reason: loaded.reason };
  const { provider } = loaded.config;
  try {
    const budget = await checkBudget();
    if (!budget.allowed) return { provider, ready: false, reason: budgetMessage(budget.reason) };
  } catch {
    return { provider, ready: false, reason: 'The AI usage counters could not be read on this device.' };
  }
  const how = provider === 'proxy' ? 'through the proxy' : 'directly from this device';
  const on = `AI challenges are on, using the model "${loaded.config.chatModel}" ${how}.`;
  return { provider, ready: true, reason: `${on}${await recentTrouble()}` };
}

/** Failed builds in a row before the status says so. */
const TROUBLE_AFTER = 3;

/**
 * A sentence for the status when the latest challenge builds all failed: "on" must not be all a
 * parent reads while every challenge comes from the built-in bank. '' when all is well.
 */
async function recentTrouble(): Promise<string> {
  const now = Date.now();
  const entries = await recentAiResults();
  const summary = summarizeAiResults(entries, now);
  if (summary.failuresInARow < TROUBLE_AFTER) return '';
  const last = [...entries].reverse().find((entry) => (entry.task === 'challenge' || entry.task === 'remix') && entry.outcome !== 'ok');
  const why = last && last.message !== '' ? ` Latest problem: ${last.message}` : '';
  const pause = summary.pause
    ? ` The AI is not asked again for about ${Math.max(1, Math.ceil((summary.pause.until - now) / 60_000))} minutes, so that failed tries do not use up the request budget.`
    : '';
  return ` But the last ${summary.failuresInARow} challenges could not be built by the AI, so built-in challenges were used instead.${why}${pause}`;
}

/** Time limit of the connection test for a hosted service; a slow endpoint gets a multiple (`timeoutScale`). */
const TEST_TIMEOUT_MS = 15_000;
/** Enough for {"ok": true}; a model that thinks first gets more from the client. */
const TEST_MAX_TOKENS = 60;

const BLOCKED_HINT =
  'If the address is right, the browser may be blocking it. A local server such as Ollama must allow this site (set OLLAMA_ORIGINS, then restart it), or use the proxy mode, which avoids the problem.';

/** True when the address is plain http on another computer (anything but localhost and 127.0.0.1). */
function isPlainHttpElsewhere(config: AiConfig): boolean {
  if (!config.baseUrl.startsWith('http://')) return false;
  try {
    const host = new URL(config.baseUrl).hostname;
    return host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

/** True when a secure page tries to call a plain http address that is not on this device: browsers refuse that. */
function isMixedContent(config: AiConfig): boolean {
  const pageIsSecure = typeof globalThis.location !== 'undefined' && globalThis.location.protocol === 'https:';
  return pageIsSecure && isPlainHttpElsewhere(config);
}

/**
 * The Docker image of the app is served with a security policy (docker/nginx.conf) that lets
 * the browser call https addresses and this device itself only. A model server on another
 * computer of the home network, reached over plain http, needs the proxy mode.
 */
const PLAIN_HTTP_HINT =
  'Also, this address starts with http:// and is on another computer. An installed copy of Intelli-Learn only lets the browser call https addresses or this device itself (localhost), so for a model server elsewhere on your network use the proxy mode.';

/**
 * Advice for the errors the app's own proxy reports (`error.type` in `server/proxy/server.mjs`
 * and `docker/nginx.conf`). The settings they name are described in docs/HOSTING.md.
 */
const PROXY_ADVICE: Record<string, string> = {
  proxy_unavailable:
    'The AI proxy is not running on this server. Start it (with Docker: add "proxy" to COMPOSE_PROFILES and start the services again), or choose another AI mode.',
  proxy_not_configured:
    'The AI proxy is running, but it does not know which AI service to call. Set UPSTREAM_BASE_URL (and UPSTREAM_API_KEY when the service needs a key) on the server, then restart the proxy.',
  upstream_auth_error:
    'The proxy answered, but the AI service behind it rejected its API key. Check UPSTREAM_API_KEY on the server, then restart the proxy.',
  upstream_error:
    'The proxy is running, but it could not reach the AI service behind it. Check UPSTREAM_BASE_URL on the server and its internet connection.',
  upstream_timeout: 'The proxy is running, but the AI service behind it took too long to answer. Try again, or use a smaller, faster model.',
  rate_limit_exceeded:
    'Too many AI requests were sent in a short time. Wait a minute and try again. If it keeps happening, raise RATE_LIMIT_PER_MINUTE on the server, or check the limits of the AI account.',
  forbidden:
    'The proxy refused the request because this page is opened from an address it does not serve. Open the app through the address of its own server, or add this address to ALLOWED_ORIGINS on the server.',
};

/** Turns a failed test into advice a parent can act on. */
export function explainConnectionError(error: unknown, config: AiConfig): string {
  if (!(error instanceof AiError)) return 'The connection test failed for an unknown reason. Please try again.';
  const proxyAdvice = PROXY_ADVICE[error.code];
  if (config.provider === 'proxy' && proxyAdvice) return proxyAdvice;
  const detail = error.detail.toLowerCase();
  const modelMissing = /model/.test(detail) && /(not found|does not exist|not exist|unknown|no such|pull|not available|invalid)/.test(detail);
  switch (error.kind) {
    case 'auth':
      return config.provider === 'proxy'
        ? 'The proxy answered, but the AI service behind it rejected its API key. Check the key in the proxy settings.'
        : 'The AI service rejected the API key. Check that the key is complete, still active, and belongs to this service.';
    case 'rate-limit':
      return 'The AI service answered, but it is limiting requests or the account has no credit left (HTTP 429). Check the plan and billing of the AI account, or try again in a minute.';
    case 'network':
      if (error.timedOut) {
        const seconds = Math.round((TEST_TIMEOUT_MS * timeoutScale(config)) / 1000);
        if (config.provider === 'direct' && isLocalAddress(config.baseUrl)) {
          return `The AI service did not answer within ${seconds} seconds. A model on your own computer can take that long to load the first time: run the test once more. If it keeps happening, try a smaller, faster model.`;
        }
        return `The AI service did not answer within ${seconds} seconds. Check the address, or try a smaller, faster model.`;
      }
      if (error.status !== null) {
        return `The AI service is reachable but reported a problem of its own (HTTP ${error.status}). Try again in a moment.`;
      }
      if (isMixedContent(config)) {
        return 'This page is loaded securely (https), so the browser refuses to call an address that starts with http://. Use an https address, or use the proxy mode.';
      }
      if (config.provider === 'proxy') {
        return 'The proxy could not be reached. Check that the proxy is running and that the address is right (usually /ai-proxy/v1).';
      }
      return `The AI service could not be reached. Check the address and the internet connection. ${BLOCKED_HINT}${isPlainHttpElsewhere(config) ? ` ${PLAIN_HTTP_HINT}` : ''}`;
    case 'bad-response':
      if (error.code === TRUNCATED_CODE) {
        // The address, the key and the model name are all right: do not send the parent looking there.
        return `The service and the model "${config.chatModel}" answered, but the model spent its whole answer allowance on "thinking" and wrote nothing. The address and the key are fine. Choose a model without long thinking, or switch thinking off (or to low) for this model at the AI service.`;
      }
      if (modelMissing) {
        return `The service is reachable, but it does not know the model "${config.chatModel}". Check the spelling of the model name${isLocalAddress(config.baseUrl) ? ', and that the model is downloaded on the local server' : ''}.`;
      }
      if (error.status === 404) {
        return 'Nothing answered at this address (HTTP 404). Check the base URL: it normally ends in /v1, without /chat/completions.';
      }
      if (error.status === 400 || error.status === 422) {
        return `The AI service did not accept the request (HTTP ${error.status})${error.detail ? `: ${error.detail}` : ''}. Check the model name.`;
      }
      return `${error.message} Check that the address points at an OpenAI-compatible service and ends in /v1.`;
    case 'refused':
      return 'The service is reachable, but the model declined a harmless test request. Try another model.';
    case 'budget':
    case 'no-config':
    case 'aborted':
      return error.message;
  }
}

/**
 * Sends one tiny request to check the connection. `override` lets the
 * settings form test values before they are saved. Never throws.
 */
export async function testConnection(
  override: AiConfigOverride = {},
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const loaded = await loadAiConfig(override);
  if (!loaded.ok) {
    // Demo mode has nothing to connect to, which is fine; anything else is a setting to fix.
    return { ok: loaded.provider === 'demo', message: loaded.reason, latencyMs: 0 };
  }
  const { config } = loaded;
  const started = Date.now();
  try {
    const result = await chat(
      [
        { role: 'system', content: 'This is a connection test. Reply with one JSON object and nothing else.' },
        { role: 'user', content: 'Reply with exactly this JSON: {"ok": true}' },
      ],
      { config, json: true, maxTokens: TEST_MAX_TOKENS, temperature: 0, timeoutMs: TEST_TIMEOUT_MS, transportRetries: 0, skipBudget: true },
    );
    const latencyMs = Date.now() - started;
    if (extractJsonObject(result.content) === undefined) {
      return {
        ok: false,
        message: `The model "${config.chatModel}" answered, but not with JSON. Intelli-Learn needs a model that can reply in JSON; try another model.`,
        latencyMs,
      };
    }
    return { ok: true, message: `Connected. The model "${config.chatModel}" answered in ${(latencyMs / 1000).toFixed(1)} seconds.`, latencyMs };
  } catch (error) {
    return { ok: false, message: explainConnectionError(error, config), latencyMs: Date.now() - started };
  }
}
