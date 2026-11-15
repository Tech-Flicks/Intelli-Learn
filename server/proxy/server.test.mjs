// @vitest-environment node
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { clientIp, createProxyServer, createRateLimiter, loadConfig, modelProblem, originAllowed } from './server.mjs';

const KEY = 'sk-test-SECRET-KEY-123';
const cleanup = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

function listen(server) {
  cleanup.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

/** A fake OpenAI-compatible upstream that records what it receives. */
async function startUpstream(behaviour = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (behaviour.hang) return; // never answers
      if (behaviour.status) {
        res.writeHead(behaviour.status, { 'content-type': 'application/json', ...(behaviour.headers ?? {}) });
        res.end(JSON.stringify(behaviour.body ?? { error: { message: 'upstream said no', type: 'upstream' } }));
        return;
      }
      if (behaviour.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"n":1}\n\n');
        behaviour.stream.afterFirstChunk.then(() => {
          res.write('data: {"n":2}\n\n');
          res.end('data: [DONE]\n\n');
        });
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-request-id': 'req_123',
        'x-ratelimit-remaining-requests': '99',
        'set-cookie': 'session=upstream-cookie',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ id: 'chatcmpl-1', path: req.url, echo: JSON.parse(body) }));
    });
  });
  const port = await listen(server);
  return { seen, port, baseUrl: `http://127.0.0.1:${port}/v1` };
}

async function startProxy(options = {}) {
  const logs = [];
  const server = createProxyServer({
    upstreamApiKey: KEY,
    rateLimitPerMinute: 0,
    log: (entry) => logs.push(entry),
    ...options,
  });
  const port = await listen(server);
  return { port, logs };
}

/** Raw HTTP request with full control over the headers. */
function request(port, { method = 'POST', path = '/ai-proxy/v1/chat/completions', headers = {}, body, onChunk } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
          onChunk?.(chunk.toString('utf8'));
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const CHAT = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'PRIVATE-PROMPT-TEXT' }] };

describe('forwarding', () => {
  it('forwards the three endpoints to the matching upstream path with the server-side key', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });

    const chat = await request(proxy.port, { body: CHAT });
    expect(chat.status).toBe(200);
    expect(chat.json.echo).toEqual(CHAT);
    expect(chat.json.path).toBe('/v1/chat/completions');

    const moderation = await request(proxy.port, { path: '/ai-proxy/v1/moderations', body: { input: 'hello' } });
    expect(moderation.json.path).toBe('/v1/moderations');

    const image = await request(proxy.port, { path: '/ai-proxy/v1/images/generations?ignored=1', body: { model: 'img', prompt: 'a fox' } });
    expect(image.json.path).toBe('/v1/images/generations');

    expect(upstream.seen).toHaveLength(3);
    for (const call of upstream.seen) {
      expect(call.method).toBe('POST');
      expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(call.headers['content-type']).toBe('application/json');
    }
  });

  it('accepts a trailing slash on UPSTREAM_BASE_URL', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: `${upstream.baseUrl}/` });
    const answer = await request(proxy.port, { body: CHAT });
    expect(answer.json.path).toBe('/v1/chat/completions');
  });

  it('strips incoming Authorization, cookies and other browser headers', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    await request(proxy.port, {
      body: CHAT,
      headers: {
        authorization: 'Bearer browser-supplied-key',
        cookie: 'session=abc',
        referer: 'http://home.example/kids/42',
        'x-forwarded-for': '203.0.113.9',
        'x-custom': 'nope',
        'user-agent': 'KidsTablet/1.0',
      },
    });
    const { headers } = upstream.seen[0];
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers.cookie).toBeUndefined();
    expect(headers.referer).toBeUndefined();
    expect(headers['x-forwarded-for']).toBeUndefined();
    expect(headers['x-custom']).toBeUndefined();
    expect(headers['user-agent']).toBe('intelli-learn-proxy');
  });

  it('sends no Authorization header when no key is configured (keyless local models)', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl, upstreamApiKey: '' });
    await request(proxy.port, { body: CHAT, headers: { authorization: 'Bearer from-browser' } });
    expect(upstream.seen[0].headers.authorization).toBeUndefined();
  });

  it('passes useful upstream headers through but never cookies or CORS headers', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    const answer = await request(proxy.port, { body: CHAT, headers: { origin: `http://127.0.0.1:${proxy.port}` } });
    expect(answer.headers['x-request-id']).toBe('req_123');
    expect(answer.headers['x-ratelimit-remaining-requests']).toBe('99');
    expect(answer.headers['content-type']).toBe('application/json');
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(answer.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(answer.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });

  it('passes upstream error statuses and bodies through', async () => {
    const upstream = await startUpstream({ status: 429, headers: { 'retry-after': '7' }, body: { error: { message: 'slow down', type: 'rate_limit_error' } } });
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    const answer = await request(proxy.port, { body: CHAT });
    expect(answer.status).toBe(429);
    expect(answer.headers['retry-after']).toBe('7');
    expect(answer.json.error.message).toBe('slow down');
  });

  it('hides the upstream 401 body, which may quote part of the key', async () => {
    const upstream = await startUpstream({ status: 401, body: { error: { message: `Incorrect API key provided: ${KEY}`, type: 'invalid_request_error' } } });
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    const answer = await request(proxy.port, { body: CHAT });
    expect(answer.status).toBe(502);
    expect(answer.json.error.type).toBe('upstream_auth_error');
    expect(answer.text).not.toContain(KEY);
  });

  it('streams the upstream response through chunk by chunk', async () => {
    let release;
    const afterFirstChunk = new Promise((resolve) => {
      release = resolve;
    });
    const upstream = await startUpstream({ stream: { afterFirstChunk } });
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    const received = [];
    const answer = await request(proxy.port, {
      body: { ...CHAT, stream: true },
      onChunk: (text) => {
        received.push(text);
        // The second chunk is only produced after the first one reached the client.
        if (received.length === 1) release();
      },
    });
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('text/event-stream');
    expect(received[0]).toBe('data: {"n":1}\n\n');
    expect(answer.text).toBe('data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\n');
  });

  it('answers 504 when the upstream does not respond in time', async () => {
    const upstream = await startUpstream({ hang: true });
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl, upstreamTimeoutMs: 80 });
    const answer = await request(proxy.port, { body: CHAT });
    expect(answer.status).toBe(504);
    expect(answer.json.error.type).toBe('upstream_timeout');
  });

  it('answers 502 when the upstream cannot be reached, without naming it', async () => {
    const dead = http.createServer();
    const deadPort = await listen(dead);
    await new Promise((resolve) => dead.close(resolve));
    const proxy = await startProxy({ upstreamBaseUrl: `http://127.0.0.1:${deadPort}/v1` });
    const answer = await request(proxy.port, { body: CHAT });
    expect(answer.status).toBe(502);
    expect(answer.json.error.type).toBe('upstream_error');
    expect(answer.text).not.toContain(String(deadPort));
  });

  it('answers 503 when no upstream is configured', async () => {
    for (const upstreamBaseUrl of ['', 'ftp://example.com/v1', 'https://user:pass@example.com/v1', 'not a url']) {
      const proxy = await startProxy({ upstreamBaseUrl });
      const answer = await request(proxy.port, { body: CHAT });
      expect(answer.status).toBe(503);
      expect(answer.json.error.type).toBe('proxy_not_configured');
    }
  });
});

describe('routing', () => {
  it('serves a health check', async () => {
    const proxy = await startProxy({ upstreamBaseUrl: 'http://127.0.0.1:9/v1' });
    const answer = await request(proxy.port, { method: 'GET', path: '/ai-proxy/health' });
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ ok: true, upstreamConfigured: true });
    const unconfigured = await startProxy({});
    expect((await request(unconfigured.port, { method: 'GET', path: '/ai-proxy/health' })).json.upstreamConfigured).toBe(false);
    expect((await request(proxy.port, { method: 'POST', path: '/ai-proxy/health', body: {} })).status).toBe(405);
  });

  it('rejects every other path with an OpenAI-shaped 404', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    for (const path of ['/', '/v1/chat/completions', '/ai-proxy/v1/embeddings', '/ai-proxy/v1/models', '/ai-proxy/v1/chat/completions/', '/ai-proxy/v1/../v1/files']) {
      const answer = await request(proxy.port, { path, body: CHAT });
      expect(answer.status, path).toBe(404);
      expect(answer.json.error).toEqual({ message: expect.any(String), type: 'not_found_error' });
    }
    expect(upstream.seen).toHaveLength(0);
  });

  it('rejects other methods, including CORS preflights, without CORS headers', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const answer = await request(proxy.port, {
        method,
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      expect(answer.status, method).toBe(405);
      expect(answer.headers.allow).toBe('POST');
      expect(answer.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(upstream.seen).toHaveLength(0);
  });

  it('requires a JSON content type and a JSON object body', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    const form = await request(proxy.port, { body: 'a=b', headers: { 'content-type': 'text/plain' } });
    expect(form.status).toBe(415);
    for (const body of ['{broken', '[1,2]', '"text"', 'null', '']) {
      const answer = await request(proxy.port, { body });
      expect(answer.status, body).toBe(400);
      expect(answer.json.error.type).toBe('invalid_request_error');
    }
    expect(upstream.seen).toHaveLength(0);
  });
});

describe('body limit', () => {
  it('rejects bodies over 256 KB by Content-Length', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    const big = { ...CHAT, padding: 'x'.repeat(256 * 1024) };
    const answer = await request(proxy.port, { body: big });
    expect(answer.status).toBe(413);
    expect(answer.json.error.message).toMatch(/256 KB/);
    expect(upstream.seen).toHaveLength(0);
  });

  it('accepts a body just under the limit', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    const answer = await request(proxy.port, { body: { ...CHAT, padding: 'x'.repeat(250 * 1024) } });
    expect(answer.status).toBe(200);
    expect(upstream.seen[0].body.length).toBeGreaterThan(250 * 1024);
  });

  it('rejects oversized chunked uploads that declare no length', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl, maxBodyBytes: 1024 });
    const answer = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: proxy.port, method: 'POST', path: '/ai-proxy/v1/chat/completions', headers: { 'content-type': 'application/json' } },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode }));
        },
      );
      req.on('error', reject);
      req.write('{"padding":"');
      req.write('x'.repeat(4096));
      req.end('"}');
    });
    expect(answer.status).toBe(413);
    expect(upstream.seen).toHaveLength(0);
  });
});

describe('model allowlist', () => {
  it('rejects models that are not listed and forwards the ones that are', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl, allowedModels: ['gpt-4o-mini', 'omni-moderation-latest'] });
    expect((await request(proxy.port, { body: CHAT })).status).toBe(200);
    const denied = await request(proxy.port, { body: { ...CHAT, model: 'gpt-expensive' } });
    expect(denied.status).toBe(400);
    expect(denied.json.error.type).toBe('invalid_request_error');
    expect((await request(proxy.port, { body: { messages: [] } })).status).toBe(400);
    expect((await request(proxy.port, { body: { ...CHAT, model: ['gpt-4o-mini'] } })).status).toBe(400);
    expect((await request(proxy.port, { path: '/ai-proxy/v1/moderations', body: { input: 'x' } })).status).toBe(200);
    expect((await request(proxy.port, { path: '/ai-proxy/v1/moderations', body: { input: 'x', model: 'other' } })).status).toBe(400);
    expect(upstream.seen).toHaveLength(2);
  });

  it('explains the rule', () => {
    expect(modelProblem({ model: 'anything' }, [], '/chat/completions')).toBeNull();
    expect(modelProblem({}, ['a'], '/moderations')).toBeNull();
    expect(modelProblem({}, ['a'], '/images/generations')).toMatch(/allowlist/);
    expect(modelProblem({ model: 'b' }, ['a'], '/chat/completions')).toMatch(/not allowed/);
    expect(modelProblem({ model: 'a' }, ['a'], '/chat/completions')).toBeNull();
  });
});

describe('rate limit', () => {
  it('is a sliding window per key', () => {
    let time = 1_000_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => time });
    expect(limiter.take('a').allowed).toBe(true);
    time += 20_000;
    expect(limiter.take('a').allowed).toBe(true);
    time += 20_000;
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 20 });
    expect(limiter.take('b').allowed).toBe(true);
    time += 20_001; // the first hit has left the window, the second has not
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('can be switched off, and forgets idle clients', () => {
    let time = 0;
    const off = createRateLimiter({ limit: 0, now: () => time });
    for (let i = 0; i < 500; i += 1) expect(off.take('a').allowed).toBe(true);
    const limiter = createRateLimiter({ limit: 5, windowMs: 1000, now: () => time, maxKeys: 3 });
    for (const key of ['a', 'b', 'c']) limiter.take(key);
    expect(limiter.size()).toBe(3);
    time += 2000;
    limiter.sweep();
    expect(limiter.size()).toBe(0);
    for (const key of ['a', 'b', 'c', 'd', 'e']) limiter.take(key);
    expect(limiter.size()).toBeLessThanOrEqual(3);
  });

  it('answers 429 with Retry-After once a client is over the limit', async () => {
    const upstream = await startUpstream();
    let time = 5_000_000;
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl, rateLimitPerMinute: 2, now: () => time });
    expect((await request(proxy.port, { body: CHAT })).status).toBe(200);
    expect((await request(proxy.port, { body: CHAT })).status).toBe(200);
    const limited = await request(proxy.port, { body: CHAT });
    expect(limited.status).toBe(429);
    expect(limited.json.error.type).toBe('rate_limit_exceeded');
    expect(limited.headers['retry-after']).toBe('60');
    // The health check is never limited.
    expect((await request(proxy.port, { method: 'GET', path: '/ai-proxy/health' })).status).toBe(200);
    time += 60_001;
    expect((await request(proxy.port, { body: CHAT })).status).toBe(200);
    expect(upstream.seen).toHaveLength(3);
  });

  it('limits per client address behind trusted reverse proxies', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl, rateLimitPerMinute: 1, trustedProxyHops: 1 });
    const from = (chain) => request(proxy.port, { body: CHAT, headers: { 'x-forwarded-for': chain } });
    expect((await from('10.0.0.1')).status).toBe(200);
    expect((await from('10.0.0.2')).status).toBe(200);
    expect((await from('10.0.0.1')).status).toBe(429);
    // A client cannot dodge the limit by inventing the left-hand part of the chain.
    expect((await from('1.2.3.4, 10.0.0.2')).status).toBe(429);
  });

  it('reads the client address from the right hop', () => {
    const req = (xff) => ({ socket: { remoteAddress: '::ffff:172.18.0.3' }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });
    expect(clientIp(req('1.1.1.1'), 0)).toBe('172.18.0.3');
    expect(clientIp(req(undefined), 1)).toBe('172.18.0.3');
    expect(clientIp(req('9.9.9.9, 192.168.1.20'), 1)).toBe('192.168.1.20');
    expect(clientIp(req('9.9.9.9, 192.168.1.20, 172.18.0.2'), 2)).toBe('192.168.1.20');
    expect(clientIp(req('192.168.1.20'), 2)).toBe('172.18.0.3');
  });
});

describe('same-origin rule', () => {
  it('accepts same-origin browser requests and requests without an Origin', () => {
    expect(originAllowed({ host: 'learn.home:8080', origin: 'http://learn.home:8080' })).toBe(true);
    expect(originAllowed({ host: 'learn.example.com', origin: 'https://LEARN.example.com' })).toBe(true);
    expect(originAllowed({ host: 'learn.home:8080' })).toBe(true);
    expect(originAllowed({ host: 'learn.home:8080', 'sec-fetch-site': 'same-origin' })).toBe(true);
  });

  it('rejects other origins unless they are listed', () => {
    expect(originAllowed({ host: 'learn.home:8080', origin: 'https://evil.example' })).toBe(false);
    expect(originAllowed({ host: 'learn.home:8080', origin: 'http://learn.home:9090' })).toBe(false);
    expect(originAllowed({ host: 'learn.home:8080', origin: 'null' })).toBe(false);
    expect(originAllowed({ host: 'learn.home:8080', origin: 'garbage' })).toBe(false);
    expect(originAllowed({ origin: 'http://learn.home:8080' })).toBe(false);
    expect(originAllowed({ host: 'learn.home:8080', 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(originAllowed({ host: 'internal:8080', origin: 'https://app.example' }, ['https://app.example'])).toBe(true);
  });

  it('enforces the rule on real requests and sends no CORS headers', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl, allowedOrigins: ['https://app.example'] });
    const same = await request(proxy.port, { body: CHAT, headers: { origin: `http://127.0.0.1:${proxy.port}` } });
    expect(same.status).toBe(200);
    const listed = await request(proxy.port, { body: CHAT, headers: { origin: 'https://app.example' } });
    expect(listed.status).toBe(200);
    expect(listed.headers['access-control-allow-origin']).toBeUndefined();
    const other = await request(proxy.port, { body: CHAT, headers: { origin: 'https://evil.example' } });
    expect(other.status).toBe(403);
    expect(other.json.error.type).toBe('forbidden');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const crossSite = await request(proxy.port, { body: CHAT, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
    expect(upstream.seen).toHaveLength(2);
  });
});

describe('logging', () => {
  it('logs only method, path, status and duration', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy({ upstreamBaseUrl: upstream.baseUrl });
    await request(proxy.port, { body: CHAT, path: '/ai-proxy/v1/chat/completions?secret=QUERY-SECRET', headers: { authorization: 'Bearer BROWSER-KEY' } });
    await request(proxy.port, { path: '/ai-proxy/v1/nope', body: CHAT });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(proxy.logs).toHaveLength(2);
    for (const entry of proxy.logs) {
      expect(Object.keys(entry).sort()).toEqual(['method', 'ms', 'path', 'status', 'time']);
      expect(typeof entry.ms).toBe('number');
    }
    expect(proxy.logs[0]).toMatchObject({ method: 'POST', path: '/ai-proxy/v1/chat/completions', status: 200 });
    expect(proxy.logs[1]).toMatchObject({ method: 'POST', path: '/ai-proxy/v1/nope', status: 404 });
    const everything = JSON.stringify(proxy.logs);
    for (const secret of [KEY, 'PRIVATE-PROMPT-TEXT', 'QUERY-SECRET', 'BROWSER-KEY']) expect(everything).not.toContain(secret);
  });
});

describe('loadConfig', () => {
  it('uses safe defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 8788,
      host: '0.0.0.0',
      upstreamBaseUrl: '',
      upstreamApiKey: '',
      allowedModels: [],
      rateLimitPerMinute: 60,
      allowedOrigins: [],
      trustedProxyHops: 0,
      upstreamTimeoutMs: 90_000,
    });
  });

  it('parses and cleans the environment', () => {
    const config = loadConfig({
      PORT: '9000',
      HOST: '127.0.0.1',
      UPSTREAM_BASE_URL: ' https://api.openai.com/v1/ ',
      UPSTREAM_API_KEY: ' sk-abc ',
      ALLOWED_MODELS: 'gpt-4o-mini, gpt-4o ,,',
      RATE_LIMIT_PER_MINUTE: '0',
      ALLOWED_ORIGINS: 'https://Learn.Example.com/, nonsense, http://tablet.home:8080',
      TRUSTED_PROXY_HOPS: '2',
      UPSTREAM_TIMEOUT_MS: '1500',
    });
    expect(config).toEqual({
      port: 9000,
      host: '127.0.0.1',
      upstreamBaseUrl: 'https://api.openai.com/v1',
      upstreamApiKey: 'sk-abc',
      allowedModels: ['gpt-4o-mini', 'gpt-4o'],
      rateLimitPerMinute: 0,
      allowedOrigins: ['https://learn.example.com', 'http://tablet.home:8080'],
      trustedProxyHops: 2,
      upstreamTimeoutMs: 1500,
    });
  });

  it('ignores invalid numbers and unusable upstream URLs', () => {
    const config = loadConfig({ PORT: 'abc', RATE_LIMIT_PER_MINUTE: '-5', UPSTREAM_TIMEOUT_MS: '0', UPSTREAM_BASE_URL: 'file:///etc/passwd' });
    expect(config.port).toBe(8788);
    expect(config.rateLimitPerMinute).toBe(60);
    expect(config.upstreamTimeoutMs).toBe(90_000);
    expect(config.upstreamBaseUrl).toBe('');
  });
});
