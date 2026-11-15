#!/usr/bin/env node
/**
 * Intelli-Learn AI proxy.
 *
 * A zero-dependency Node 22 HTTP server that sits on the same origin as the
 * web app (behind nginx at /ai-proxy/) and forwards a small, fixed set of
 * OpenAI-compatible requests to the real AI endpoint. The API key lives here,
 * on the server, and never reaches the browser.
 *
 *   POST /ai-proxy/v1/chat/completions    -> {UPSTREAM_BASE_URL}/chat/completions
 *   POST /ai-proxy/v1/moderations         -> {UPSTREAM_BASE_URL}/moderations
 *   POST /ai-proxy/v1/images/generations  -> {UPSTREAM_BASE_URL}/images/generations
 *   GET  /ai-proxy/health
 *
 * Environment (see .env.example):
 *   UPSTREAM_BASE_URL       e.g. https://api.openai.com/v1 (required to forward anything)
 *   UPSTREAM_API_KEY        sent upstream as "Authorization: Bearer ..."; leave empty for keyless local models
 *   ALLOWED_MODELS          optional comma-separated allowlist of model names
 *   RATE_LIMIT_PER_MINUTE   requests per client IP per minute, default 60, 0 = unlimited
 *   ALLOWED_ORIGINS         optional comma-separated extra browser origins (same-origin always works)
 *   TRUSTED_PROXY_HOPS      reverse proxies in front of this server that append X-Forwarded-For, default 0
 *   UPSTREAM_TIMEOUT_MS     give up after this long without upstream activity, default 90000
 *   PORT, HOST              listen address, default 0.0.0.0:8788
 *
 * Privacy: the log has one line per request with method, path, status and
 * duration. Request bodies, response bodies, headers and keys are never logged.
 */
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

export const MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_PORT = 8788;
const PREFIX = '/ai-proxy';

/** Public path -> path appended to UPSTREAM_BASE_URL. */
const ROUTES = new Map([
  [`${PREFIX}/v1/chat/completions`, '/chat/completions'],
  [`${PREFIX}/v1/moderations`, '/moderations'],
  [`${PREFIX}/v1/images/generations`, '/images/generations'],
]);

/** Upstream response headers that are safe and useful to hand back to the browser. */
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-encoding', 'retry-after', 'x-request-id'];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function list(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function wholeNumber(value, fallback, min = 0) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return trimmed;
  } catch {
    return '';
  }
}

/** Reads the configuration from environment variables. Invalid values fall back to safe defaults. */
export function loadConfig(env = process.env) {
  return {
    port: wholeNumber(env.PORT, DEFAULT_PORT),
    host: String(env.HOST ?? '').trim() || '0.0.0.0',
    upstreamBaseUrl: normalizeBaseUrl(env.UPSTREAM_BASE_URL),
    upstreamApiKey: String(env.UPSTREAM_API_KEY ?? '').trim(),
    allowedModels: list(env.ALLOWED_MODELS),
    rateLimitPerMinute: wholeNumber(env.RATE_LIMIT_PER_MINUTE, 60),
    allowedOrigins: list(env.ALLOWED_ORIGINS).map(normalizeOrigin).filter(Boolean),
    trustedProxyHops: wholeNumber(env.TRUSTED_PROXY_HOPS, 0),
    upstreamTimeoutMs: wholeNumber(env.UPSTREAM_TIMEOUT_MS, 90_000, 1),
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Sliding-window limiter: at most `limit` hits per key in any `windowMs`.
 * `limit` 0 disables it.
 */
export function createRateLimiter({ limit, windowMs = 60_000, now = Date.now, maxKeys = 10_000 }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  const sweep = (time) => {
    for (const [key, stamps] of hits) {
      if (stamps.length === 0 || stamps[stamps.length - 1] <= time - windowMs) hits.delete(key);
    }
  };

  return {
    /** Records a hit when allowed. */
    take(key) {
      if (limit <= 0) return { allowed: true, retryAfterSeconds: 0 };
      const time = now();
      const cutoff = time - windowMs;
      const stamps = (hits.get(key) ?? []).filter((stamp) => stamp > cutoff);
      if (stamps.length >= limit) {
        hits.set(key, stamps);
        const oldest = stamps[0] ?? time;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - time) / 1000)) };
      }
      stamps.push(time);
      hits.set(key, stamps);
      if (hits.size > maxKeys) sweep(time);
      // Still too many distinct clients inside one window: forget the oldest entries.
      for (const oldestKey of hits.keys()) {
        if (hits.size <= maxKeys) break;
        hits.delete(oldestKey);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    sweep: () => sweep(now()),
    size: () => hits.size,
  };
}

/**
 * The client address used for rate limiting. With `hops` trusted reverse
 * proxies in front (each appending the address it saw to X-Forwarded-For), the
 * client is the entry `hops` places from the end. Anything further left was
 * supplied by the client itself and is ignored.
 */
export function clientIp(req, hops = 0) {
  const socketIp = String(req.socket?.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  if (hops <= 0) return socketIp;
  const header = req.headers['x-forwarded-for'];
  const chain = String(Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const entry = chain[chain.length - hops];
  return entry ? entry.replace(/^::ffff:/, '') : socketIp;
}

// ---------------------------------------------------------------------------
// Request checks
// ---------------------------------------------------------------------------

/**
 * Same-origin use only. A browser request is accepted when its Origin host
 * equals the Host header, or the origin is listed in ALLOWED_ORIGINS. Requests
 * without an Origin header (curl, server-side tools) cannot be forged by a web
 * page and are accepted, unless the browser marked them as cross-site.
 */
export function originAllowed(headers, allowedOrigins = []) {
  const origin = headers.origin;
  if (origin === undefined) {
    const site = headers['sec-fetch-site'];
    return site === undefined || site === 'same-origin' || site === 'none';
  }
  const normalized = normalizeOrigin(String(origin));
  if (normalized === null) return false; // includes the opaque origin "null"
  if (allowedOrigins.includes(normalized)) return true;
  const host = String(headers.host ?? '').trim().toLowerCase();
  return host !== '' && new URL(normalized).host === host;
}

/** Returns an error message when the body's model is not on the allowlist, else null. */
export function modelProblem(body, allowedModels, upstreamPath) {
  if (allowedModels.length === 0) return null;
  const model = body.model;
  if (model === undefined || model === null) {
    // The moderation endpoint has a server-side default model.
    return upstreamPath === '/moderations' ? null : 'This proxy requires a "model" from its allowlist.';
  }
  if (typeof model !== 'string' || !allowedModels.includes(model)) {
    return 'This model is not allowed by the proxy.';
  }
  return null;
}

class HttpError extends Error {
  constructor(status, message, type, headers = {}) {
    super(message);
    this.status = status;
    this.type = type;
    this.headers = headers;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, `The request body is larger than ${Math.floor(limit / 1024)} KB.`, 'invalid_request_error'));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(new HttpError(413, `The request body is larger than ${Math.floor(limit / 1024)} KB.`, 'invalid_request_error'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks));
      done = true;
    });
    req.on('error', () => {
      if (!done) reject(new HttpError(400, 'The request could not be read.', 'invalid_request_error'));
      done = true;
    });
  });
}

/**
 * Reads and drops what is left of a rejected upload, so the client can still
 * receive the error response, but never more than `capBytes`.
 */
function discardRest(req, capBytes = 1024 * 1024) {
  let seen = 0;
  req.on('data', (chunk) => {
    seen += chunk.length;
    if (seen > capBytes) req.destroy();
  });
  req.on('error', () => {});
  req.resume();
}

function sendJson(res, status, payload, headers = {}) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

/** Errors are shaped like OpenAI's: { error: { message, type } }. */
function sendError(res, status, message, type, headers = {}) {
  sendJson(res, status, { error: { message, type } }, headers);
}

// ---------------------------------------------------------------------------
// Forwarding
// ---------------------------------------------------------------------------

function forward(req, res, config, upstreamPath, body) {
  return new Promise((resolve) => {
    const target = new URL(`${config.upstreamBaseUrl}${upstreamPath}`);
    const transport = target.protocol === 'https:' ? https : http;
    // Built from scratch: nothing the browser sent (Authorization, cookies,
    // user agent, referrer, forwarding headers) is passed on, except Accept.
    const headers = {
      'content-type': 'application/json',
      'content-length': body.length,
      accept: typeof req.headers.accept === 'string' ? req.headers.accept : 'application/json',
      'accept-encoding': 'identity',
      'user-agent': 'intelli-learn-proxy',
    };
    if (config.upstreamApiKey) headers.authorization = `Bearer ${config.upstreamApiKey}`;

    let timedOut = false;
    const upstream = transport.request(target, { method: 'POST', headers });
    upstream.setTimeout(config.upstreamTimeoutMs, () => {
      timedOut = true;
      upstream.destroy(new Error('upstream timeout'));
    });

    // The browser went away: stop paying for the upstream answer.
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
      resolve();
    });

    upstream.on('response', (answer) => {
      if (answer.statusCode === 401) {
        // The upstream rejected OUR key. Its message can quote part of the key, so it is not passed on.
        answer.resume();
        sendError(res, 502, 'The AI service rejected the key configured on the proxy.', 'upstream_auth_error');
        return;
      }
      const out = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no' };
      for (const name of RESPONSE_HEADERS) {
        const value = answer.headers[name];
        if (value !== undefined) out[name] = value;
      }
      for (const [name, value] of Object.entries(answer.headers)) {
        if (name.startsWith('x-ratelimit-') && value !== undefined) out[name] = value;
      }
      res.writeHead(answer.statusCode ?? 502, out);
      res.flushHeaders();
      answer.on('error', () => res.destroy());
      answer.pipe(res);
    });

    upstream.on('error', () => {
      if (res.headersSent) {
        res.destroy();
      } else if (timedOut) {
        sendError(res, 504, 'The AI service took too long to answer.', 'upstream_timeout');
      } else if (!res.destroyed) {
        sendError(res, 502, 'The AI service could not be reached.', 'upstream_error');
      }
    });

    upstream.end(body);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function defaultLog(entry) {
  console.log(JSON.stringify(entry));
}

/**
 * Creates the proxy server (not yet listening).
 *
 * @param {Partial<ReturnType<typeof loadConfig>> & {
 *   maxBodyBytes?: number,
 *   now?: () => number,
 *   log?: (entry: { time: string, method: string, path: string, status: number, ms: number }) => void,
 * }} [options]
 */
export function createProxyServer(options = {}) {
  const config = { ...loadConfig({}), maxBodyBytes: MAX_BODY_BYTES, now: Date.now, log: defaultLog, ...options };
  config.upstreamBaseUrl = normalizeBaseUrl(config.upstreamBaseUrl);
  const limiter = createRateLimiter({ limit: config.rateLimitPerMinute, now: config.now });
  const sweeper = setInterval(() => limiter.sweep(), 60_000);
  sweeper.unref();

  const handle = async (req, res, path) => {
    if (path === `${PREFIX}/health`) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Use GET for the health check.', 'invalid_request_error', { allow: 'GET, HEAD' });
      }
      sendJson(res, 200, { ok: true, upstreamConfigured: config.upstreamBaseUrl !== '' });
      return;
    }
    const upstreamPath = ROUTES.get(path);
    if (upstreamPath === undefined) {
      throw new HttpError(404, 'This proxy does not serve that path.', 'not_found_error');
    }
    if (req.method !== 'POST') {
      throw new HttpError(405, 'Use POST for this endpoint.', 'invalid_request_error', { allow: 'POST' });
    }
    if (!originAllowed(req.headers, config.allowedOrigins)) {
      throw new HttpError(403, 'Cross-origin requests are not allowed.', 'forbidden');
    }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
      throw new HttpError(415, 'Send the request as application/json.', 'invalid_request_error');
    }
    const limit = limiter.take(clientIp(req, config.trustedProxyHops));
    if (!limit.allowed) {
      throw new HttpError(429, 'Too many requests. Please wait a moment.', 'rate_limit_exceeded', {
        'retry-after': String(limit.retryAfterSeconds),
      });
    }
    if (config.upstreamBaseUrl === '') {
      throw new HttpError(503, 'The AI proxy is not configured. Set UPSTREAM_BASE_URL on the server.', 'proxy_not_configured');
    }
    const body = await readBody(req, config.maxBodyBytes);
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      parsed = null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new HttpError(400, 'The request body must be a JSON object.', 'invalid_request_error');
    }
    const problem = modelProblem(parsed, config.allowedModels, upstreamPath);
    if (problem) throw new HttpError(400, problem, 'invalid_request_error');
    await forward(req, res, config, upstreamPath, body);
  };

  const server = http.createServer((req, res) => {
    const started = config.now();
    let path = '/';
    try {
      path = new URL(req.url ?? '/', 'http://proxy.local').pathname;
    } catch {
      path = '/';
    }
    res.on('close', () => {
      config.log({
        time: new Date(started).toISOString(),
        method: String(req.method),
        path: path.slice(0, 200),
        status: res.statusCode,
        ms: Math.max(0, config.now() - started),
      });
    });
    handle(req, res, path).catch((error) => {
      // Rejected before the upload was fully read: answer, throw the rest away and close the connection.
      const headers = req.complete ? {} : { connection: 'close' };
      if (!req.complete) discardRest(req);
      if (error instanceof HttpError) {
        sendError(res, error.status, error.message, error.type, { ...error.headers, ...headers });
      } else {
        sendError(res, 500, 'The proxy hit an internal error.', 'server_error', headers);
      }
    });
  });
  server.on('close', () => clearInterval(sweeper));
  return server;
}

function main() {
  const config = loadConfig(process.env);
  const server = createProxyServer(config);
  server.listen(config.port, config.host, () => {
    const upstreamHost = config.upstreamBaseUrl ? new URL(config.upstreamBaseUrl).host : null;
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        message: 'Intelli-Learn AI proxy listening',
        port: config.port,
        upstreamHost,
        keyConfigured: config.upstreamApiKey !== '',
        allowedModels: config.allowedModels.length > 0 ? config.allowedModels : 'any',
        rateLimitPerMinute: config.rateLimitPerMinute,
        trustedProxyHops: config.trustedProxyHops,
      }),
    );
    if (!upstreamHost) {
      console.warn('UPSTREAM_BASE_URL is missing or not a plain http(s) URL. Requests will be answered with HTTP 503.');
    }
  });
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
