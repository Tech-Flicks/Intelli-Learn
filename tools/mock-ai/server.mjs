#!/usr/bin/env node
/**
 * Intelli-Learn mock AI: a zero-dependency, OpenAI-compatible server for
 * development, demos and end-to-end tests.
 *
 *   node tools/mock-ai/server.mjs          (or: npm run mock-ai)
 *
 * Then, in the app's AI settings, choose "Direct", set the base URL to
 * http://localhost:8787/v1 and enter any key.
 *
 * What it returns is decided by the marker lines the app puts in its prompts
 * (see docs/AI_PROMPT_MARKERS.md). It never calls out to the network.
 *
 * Environment:
 *   MOCK_PORT (or PORT)            port, default 8787
 *   MOCK_HOST                      bind address, default loopback only (127.0.0.1 and ::1)
 *   MOCK_DELAY_MS                  artificial delay before every POST answer, default 0
 *   MOCK_FAIL_RATE                 0..1 share of POST requests answered with HTTP 500
 *   MOCK_INVALID_RATE              0..1 share of challenge answers that break the schema on purpose
 *   MOCK_REJECT_RESPONSE_FORMAT=1  answer HTTP 400 when a request carries response_format
 *   MOCK_SEED                      start value of the content counter, default 0
 *   MOCK_LOG_LIMIT                 how many requests GET /__mock/log remembers, default 50 (1..10000)
 *   MOCK_QUIET=1                   no request log on stdout
 */
import http from 'node:http';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import {
  GRADES,
  INTERACTION_KINDS,
  MODES,
  TASKS,
  hashString,
  makeChallenge,
  makeNotes,
  makeReport,
  makeSafetyVerdict,
  makeStory,
  makeTutorReply,
} from './generators.mjs';

export const DEFAULT_PORT = 8787;
export const FLAG_WORD = 'FLAGME';
export const REDIRECT_WORD = 'REDIRECTME';
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_LOGGED_REQUESTS = 50;
const MAX_LOGGED_REQUESTS = 10000;

// ---------------------------------------------------------------------------
// Marker protocol
// ---------------------------------------------------------------------------

/** Text of a chat message whose content is a string or an array of content parts. */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}

const MARKER_LINE = /^[ \t]*([A-Z][A-Z_]{1,30}):[ \t]*(.*?)[ \t]*$/;

/**
 * Collects `KEY: value` marker lines from the messages. System (and developer)
 * messages are read first and the first occurrence of a key wins, so text
 * typed by a child later in the conversation can never override the app's own
 * markers.
 */
export function parseMarkers(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const isSystem = (m) => m?.role === 'system' || m?.role === 'developer';
  const ordered = [...list.filter(isSystem), ...list.filter((m) => !isSystem(m))];
  const markers = {};
  for (const message of ordered) {
    for (const line of messageText(message).split(/\r?\n/)) {
      const match = MARKER_LINE.exec(line);
      if (match && !(match[1] in markers)) markers[match[1]] = match[2];
    }
  }
  return markers;
}

function conversationContains(messages, word) {
  return (Array.isArray(messages) ? messages : []).some((m) => messageText(m).includes(word));
}

// ---------------------------------------------------------------------------
// Tiny PNG encoder (1 x 1 pixel, solid colour)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(typeAndData.length + 8);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), out.length - 4);
  return out;
}

/** A valid 1 x 1 PNG whose colour depends on the prompt, so different prompts look different. */
export function tinyPng(prompt = '') {
  const hash = hashString(String(prompt));
  // Soft pastel: every channel in 128..255.
  const rgb = [128 + (hash & 0x7f), 128 + ((hash >>> 8) & 0x7f), 128 + ((hash >>> 16) & 0x7f)];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); // width
  header.writeUInt32BE(1, 4); // height
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, ...rgb]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function corsHeaders(req) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': req.headers['access-control-request-headers'] ?? 'authorization, content-type',
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '600',
  };
}

function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...corsHeaders(req),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendError(req, res, status, message, type = 'invalid_request_error') {
  sendJson(req, res, status, { error: { message, type, param: null, code: null } });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Keep draining so the client can read the error, but stop storing.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('The request body is too large.'), { status: 413 }));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('The request body is not valid JSON.'), { status: 400 }));
      }
    });
  });
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clampRate(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

function chatContent(body, state, options) {
  const markers = parseMarkers(body.messages);
  const task = String(markers.TASK ?? '').toLowerCase();
  const seq = state.seq;
  let payload;
  switch (task) {
    case 'challenge': {
      state.seq += 1;
      payload = makeChallenge({
        kind: String(markers.INTERACTION_KIND ?? '').toLowerCase(),
        grade: markers.GRADE,
        mode: String(markers.MODE ?? '').toLowerCase(),
        theme: markers.THEME,
        seq,
      });
      if (options.invalidRate > 0 && options.random() < options.invalidRate) {
        // Deliberately broken: no question and an interaction the schema does not know.
        payload = { title: payload.title, interaction: { kind: 'teleport' }, scene: { objects: [] } };
      }
      break;
    }
    case 'tutor':
      state.seq += 1;
      payload = makeTutorReply({
        intent: String(markers.INTENT ?? '').toLowerCase(),
        seq,
        redirect: conversationContains(body.messages, REDIRECT_WORD),
      });
      break;
    case 'story':
      state.seq += 1;
      payload = makeStory({ theme: markers.THEME, chapters: markers.CHAPTERS, seq });
      break;
    case 'notes':
      payload = makeNotes();
      break;
    case 'report':
      payload = makeReport();
      break;
    case 'safety':
      payload = makeSafetyVerdict(conversationContains(body.messages, FLAG_WORD));
      break;
    default:
      // No TASK line (or "TASK: ping"): a harmless answer for connection tests.
      payload = { ok: true, say: 'Hello from the Intelli-Learn mock AI.' };
  }
  return { content: JSON.stringify(payload), markers, task: TASKS.includes(task) ? task : 'ping' };
}

function writeChatStream(req, res, base, content, usage, includeUsage) {
  res.writeHead(200, {
    ...corsHeaders(req),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const chunk = (delta, finishReason = null) => ({
    ...base,
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  });
  send(chunk({ role: 'assistant', content: '' }));
  for (let i = 0; i < content.length; i += 160) send(chunk({ content: content.slice(i, i + 160) }));
  send(chunk({}, 'stop'));
  if (includeUsage) send({ ...base, object: 'chat.completion.chunk', choices: [], usage });
  res.write('data: [DONE]\n\n');
  res.end();
}

function handleChat(req, res, body, state, options) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    sendError(req, res, 400, "'messages' must be a non-empty array.");
    return { task: 'invalid', markers: {} };
  }
  if (options.rejectResponseFormat && body.response_format !== undefined) {
    sendError(req, res, 400, "This mock is configured to reject 'response_format'.");
    return { task: 'rejected', markers: {} };
  }
  const { content, markers, task } = chatContent(body, state, options);
  const promptTokens = estimateTokens(body.messages.map(messageText).join('\n'));
  const completionTokens = estimateTokens(content);
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  state.completions += 1;
  const base = {
    id: `chatcmpl-mock-${state.completions}`,
    created: Math.floor(Date.now() / 1000),
    model: typeof body.model === 'string' && body.model ? body.model : 'mock-stem-1',
    system_fingerprint: 'intelli-learn-mock',
  };
  if (body.stream === true) {
    writeChatStream(req, res, base, content, usage, body.stream_options?.include_usage === true);
  } else {
    sendJson(req, res, 200, {
      ...base,
      object: 'chat.completion',
      choices: [
        { index: 0, message: { role: 'assistant', content, refusal: null }, logprobs: null, finish_reason: 'stop' },
      ],
      usage,
    });
  }
  return { task, markers };
}

function moderationInputs(input) {
  const one = (entry) => (typeof entry === 'string' ? entry : typeof entry?.text === 'string' ? entry.text : '');
  if (Array.isArray(input)) return input.map(one);
  return [one(input)];
}

const MODERATION_CATEGORIES = [
  'harassment',
  'harassment/threatening',
  'hate',
  'hate/threatening',
  'illicit',
  'illicit/violent',
  'self-harm',
  'self-harm/instructions',
  'self-harm/intent',
  'sexual',
  'sexual/minors',
  'violence',
  'violence/graphic',
];

function handleModeration(req, res, body, state) {
  if (body.input === undefined || body.input === null) {
    sendError(req, res, 400, "'input' is required.");
    return;
  }
  const inputs = moderationInputs(body.input);
  state.moderations += 1;
  sendJson(req, res, 200, {
    id: `modr-mock-${state.moderations}`,
    model: typeof body.model === 'string' && body.model ? body.model : 'mock-moderation-1',
    results: inputs.map((text) => {
      const flagged = text.includes(FLAG_WORD);
      return {
        flagged,
        categories: Object.fromEntries(MODERATION_CATEGORIES.map((c) => [c, flagged && c === 'violence'])),
        category_scores: Object.fromEntries(MODERATION_CATEGORIES.map((c) => [c, flagged && c === 'violence' ? 0.99 : 0.0001])),
      };
    }),
    usage: { prompt_tokens: estimateTokens(inputs.join('\n')), completion_tokens: 0, total_tokens: estimateTokens(inputs.join('\n')) },
  });
}

function handleImage(req, res, body, state) {
  if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
    sendError(req, res, 400, "'prompt' is required.");
    return;
  }
  const count = Math.max(1, Math.min(4, Number.isInteger(body.n) ? body.n : 1));
  state.images += 1;
  sendJson(req, res, 200, {
    created: Math.floor(Date.now() / 1000),
    data: Array.from({ length: count }, (_, index) => ({
      b64_json: tinyPng(`${body.prompt}#${index}`).toString('base64'),
      revised_prompt: body.prompt,
    })),
    usage: { input_tokens: estimateTokens(body.prompt), output_tokens: 1, total_tokens: estimateTokens(body.prompt) + 1 },
  });
}

/**
 * Creates the mock server (not yet listening).
 *
 * @param {object} [options]
 * @param {number} [options.delayMs]     artificial delay for POST answers
 * @param {number} [options.failRate]    0..1 share of POST requests answered with HTTP 500
 * @param {number} [options.invalidRate] 0..1 share of challenge answers that break the schema
 * @param {boolean} [options.rejectResponseFormat]
 * @param {number} [options.seed]        start value of the content counter
 * @param {() => number} [options.random]
 * @param {(line: string) => void} [options.log]
 * @returns {import('node:http').Server & { mock: { state: object, handler: Function } }}
 */
export function createMockAiServer(options = {}) {
  const settings = {
    delayMs: Math.max(0, Number(options.delayMs) || 0),
    failRate: clampRate(options.failRate),
    invalidRate: clampRate(options.invalidRate),
    rejectResponseFormat: options.rejectResponseFormat === true,
    random: typeof options.random === 'function' ? options.random : Math.random,
    log: typeof options.log === 'function' ? options.log : () => {},
  };
  const seed = Number.isFinite(Number(options.seed)) ? Math.max(0, Math.floor(Number(options.seed))) : 0;
  const wantedLog = Math.floor(Number(options.logLimit));
  const logLimit = Number.isFinite(wantedLog) && wantedLog >= 1 ? Math.min(wantedLog, MAX_LOGGED_REQUESTS) : DEFAULT_LOGGED_REQUESTS;
  const state = { seq: seed, completions: 0, moderations: 0, images: 0, requests: [] };

  const remember = (entry) => {
    state.requests.push(entry);
    if (state.requests.length > logLimit) state.requests.shift();
  };

  const handler = async (req, res) => {
    const started = Date.now();
    const path = new URL(req.url ?? '/', 'http://mock.local').pathname.replace(/\/+$/, '') || '/';
    let note = '';
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        res.end();
      } else if (req.method === 'GET' && (path === '/' || path === '/health' || path === '/v1')) {
        sendJson(req, res, 200, { ok: true, name: 'intelli-learn-mock-ai', baseUrl: '/v1' });
      } else if (req.method === 'GET' && path === '/v1/models') {
        const created = Math.floor(started / 1000);
        sendJson(req, res, 200, {
          object: 'list',
          data: ['mock-stem-1', 'mock-image-1', 'mock-moderation-1'].map((id) => ({
            id,
            object: 'model',
            created,
            owned_by: 'intelli-learn-mock',
          })),
        });
      } else if (req.method === 'GET' && path === '/__mock/log') {
        sendJson(req, res, 200, { seq: state.seq, requests: state.requests });
      } else if (req.method === 'POST' && path === '/__mock/reset') {
        state.seq = seed;
        state.requests = [];
        sendJson(req, res, 200, { ok: true, seq: state.seq });
      } else if (
        req.method === 'POST' &&
        (path === '/v1/chat/completions' || path === '/v1/moderations' || path === '/v1/images/generations')
      ) {
        const body = await readJsonBody(req);
        if (settings.delayMs > 0) await sleep(settings.delayMs);
        if (settings.failRate > 0 && settings.random() < settings.failRate) {
          note = ' injected-failure';
          sendError(req, res, 500, 'Injected mock failure (MOCK_FAIL_RATE).', 'server_error');
        } else if (path === '/v1/chat/completions') {
          const { task, markers } = handleChat(req, res, body, state, settings);
          note = ` task=${task}${markers.INTERACTION_KIND ? ` kind=${markers.INTERACTION_KIND}` : ''}${markers.GRADE ? ` grade=${markers.GRADE}` : ''}`;
          remember({ at: started, path, task, markers, body });
        } else if (path === '/v1/moderations') {
          handleModeration(req, res, body, state);
          remember({ at: started, path, task: 'moderation', markers: {}, body });
        } else {
          handleImage(req, res, body, state);
          remember({ at: started, path, task: 'image', markers: {}, body });
        }
      } else {
        sendError(req, res, 404, `Unknown endpoint: ${req.method} ${path}`, 'not_found_error');
      }
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (!res.headersSent) {
        sendError(
          req,
          res,
          status,
          status === 500 ? 'The mock server hit an internal error.' : error.message,
          status === 500 ? 'server_error' : 'invalid_request_error',
        );
      } else {
        res.destroy();
      }
    }
    settings.log(`${req.method} ${path} ${res.statusCode}${note} ${Date.now() - started}ms`);
  };

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  server.mock = { state, handler };
  return server;
}

/** Starts a mock server on `port` (0 = any free port) and resolves once it is listening. */
export function startMockAi(options = {}) {
  const server = createMockAiServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

function main() {
  const env = process.env;
  const port = Number(env.MOCK_PORT ?? env.PORT ?? DEFAULT_PORT);
  const quiet = env.MOCK_QUIET === '1';
  const options = {
    delayMs: env.MOCK_DELAY_MS,
    failRate: env.MOCK_FAIL_RATE,
    invalidRate: env.MOCK_INVALID_RATE,
    rejectResponseFormat: env.MOCK_REJECT_RESPONSE_FORMAT === '1',
    seed: env.MOCK_SEED,
    logLimit: env.MOCK_LOG_LIMIT,
    log: quiet ? undefined : (line) => console.log(line),
  };
  const primary = createMockAiServer(options);
  // By default listen on both loopback addresses, because "localhost" resolves to
  // either of them depending on the system. Never on the network unless asked.
  const hosts = env.MOCK_HOST ? [env.MOCK_HOST] : ['127.0.0.1', '::1'];
  const servers = hosts.map((host, index) => {
    const server = index === 0 ? primary : http.createServer((req, res) => void primary.mock.handler(req, res));
    server.on('error', (error) => {
      if (index === 0) {
        console.error(`Mock AI could not listen on ${host}:${port}: ${error.message}`);
        process.exit(1);
      }
      // IPv6 loopback is optional.
    });
    server.listen(port, host);
    return server;
  });
  primary.on('listening', () => {
    console.log(`Intelli-Learn mock AI listening on http://localhost:${port}/v1`);
    console.log('In the app: AI settings -> Direct -> base URL http://localhost:' + port + '/v1, any key.');
    console.log(`Kinds: ${INTERACTION_KINDS.join(', ')} | grades: ${GRADES.join(', ')} | modes: ${MODES.length}`);
  });
  const stop = () => {
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
