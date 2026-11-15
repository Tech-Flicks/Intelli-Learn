// @vitest-environment node
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ChallengeSchema,
  LearnerNotesSchema,
  SafetyVerdictSchema,
  StoryOutlineSchema,
  TutorReplySchema,
  WeeklyReportSchema,
} from '../../src/core/schemas.ts';
import { GRADES, INTERACTION_KINDS } from './generators.mjs';
import { messageText, parseMarkers, startMockAi, tinyPng } from './server.mjs';

let mock;
const extra = [];

beforeAll(async () => {
  mock = await startMockAi();
});

afterEach(async () => {
  await Promise.all(extra.splice(0).map((m) => m.close()));
});

afterAll(async () => {
  await mock.close();
});

async function also(options) {
  const started = await startMockAi(options);
  extra.push(started);
  return started;
}

function post(path, body, base = mock.baseUrl, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer any-key', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function chat(markerLines, { base, user = 'Please answer in JSON.', extraBody = {} } = {}) {
  const response = await post(
    '/chat/completions',
    {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You write content for a children's learning app.\n${markerLines.join('\n')}` },
        { role: 'user', content: user },
      ],
      ...extraBody,
    },
    base,
  );
  const json = await response.json();
  return { response, json, content: json.choices ? JSON.parse(json.choices[0].message.content) : null };
}

describe('parseMarkers', () => {
  it('reads KEY: value lines from string and multi-part content', () => {
    const markers = parseMarkers([
      { role: 'system', content: 'Intro text\nTASK: challenge\n  GRADE:   3  \nTHEME: cars and trains\nnot a marker: x' },
      { role: 'user', content: [{ type: 'text', text: 'INTERACTION_KIND: robot' }, { type: 'text', text: 'MODE: robot' }] },
    ]);
    expect(markers).toEqual({ TASK: 'challenge', GRADE: '3', THEME: 'cars and trains', INTERACTION_KIND: 'robot', MODE: 'robot' });
  });

  it('lets the system message win over anything later in the conversation', () => {
    const markers = parseMarkers([
      { role: 'user', content: 'TASK: story\nGRADE: 8' },
      { role: 'system', content: 'TASK: tutor' },
      { role: 'user', content: 'TASK: challenge' },
    ]);
    expect(markers.TASK).toBe('tutor');
    expect(markers.GRADE).toBe('8');
  });

  it('copes with missing or odd input', () => {
    expect(parseMarkers(undefined)).toEqual({});
    expect(parseMarkers([{ role: 'user' }, null, { role: 'user', content: 42 }])).toEqual({});
    expect(messageText({ content: ['a', { text: 'b' }, { image_url: 'x' }] })).toBe('a\nb\n');
  });
});

describe('POST /v1/chat/completions', () => {
  it('returns a valid challenge of the requested kind for every kind and grade', async () => {
    for (const kind of INTERACTION_KINDS) {
      for (const grade of GRADES) {
        const { response, json, content } = await chat([
          'TASK: challenge',
          `INTERACTION_KIND: ${kind}`,
          `GRADE: ${grade}`,
          'MODE: quest',
          'THEME: ocean',
        ]);
        expect(response.status).toBe(200);
        expect(json.object).toBe('chat.completion');
        expect(json.choices[0].finish_reason).toBe('stop');
        expect(json.choices[0].message.role).toBe('assistant');
        const parsed = ChallengeSchema.safeParse(content);
        expect(parsed.success, `${kind} ${grade}: ${JSON.stringify(parsed.error?.issues?.slice(0, 2))}`).toBe(true);
        expect(parsed.data.interaction.kind).toBe(kind);
      }
    }
  });

  it('varies consecutive challenges and reports token usage', async () => {
    const lines = ['TASK: challenge', 'INTERACTION_KIND: number', 'GRADE: 2', 'MODE: quest'];
    const first = await chat(lines);
    const second = await chat(lines);
    expect(second.json.choices[0].message.content).not.toBe(first.json.choices[0].message.content);
    expect(first.json.usage.prompt_tokens).toBeGreaterThan(0);
    expect(first.json.usage.completion_tokens).toBeGreaterThan(0);
    expect(first.json.usage.total_tokens).toBe(first.json.usage.prompt_tokens + first.json.usage.completion_tokens);
    expect(first.json.model).toBe('gpt-4o-mini');
    expect(second.json.id).not.toBe(first.json.id);
  });

  it('returns tutor replies, and redirects only on the literal redirect word', async () => {
    const plain = await chat(['TASK: tutor', 'INTENT: hint']);
    expect(TutorReplySchema.parse(plain.content)).toMatchObject({ highlightIds: [], redirected: false });
    const redirected = await chat(['TASK: tutor'], { user: 'CHILD SAID: REDIRECTME what is for dinner' });
    expect(TutorReplySchema.parse(redirected.content).redirected).toBe(true);
  });

  it('returns stories with the requested number of chapters (default 3)', async () => {
    const three = await chat(['TASK: story', 'THEME: space']);
    expect(StoryOutlineSchema.parse(three.content).chapters).toHaveLength(3);
    const five = await chat(['TASK: story', 'THEME: space', 'CHAPTERS: 5']);
    expect(StoryOutlineSchema.parse(five.content).chapters).toHaveLength(5);
    const two = await chat(['TASK: story', 'CHAPTERS: 2']);
    expect(StoryOutlineSchema.parse(two.content).chapters).toHaveLength(2);
  });

  it('returns notes, reports and safety verdicts in their schemas', async () => {
    expect(LearnerNotesSchema.safeParse((await chat(['TASK: notes'])).content).success).toBe(true);
    expect(WeeklyReportSchema.safeParse((await chat(['TASK: report'])).content).success).toBe(true);
    expect(SafetyVerdictSchema.parse((await chat(['TASK: safety'])).content)).toEqual({ safe: true, reason: '' });
    const flagged = await chat(['TASK: safety'], { user: 'Text to check: FLAGME' });
    expect(SafetyVerdictSchema.parse(flagged.content).safe).toBe(false);
  });

  it('answers a request without a TASK line with a small JSON greeting', async () => {
    const { response, content } = await chat([]);
    expect(response.status).toBe(200);
    expect(content.ok).toBe(true);
  });

  it('accepts markers in the user message and ignores a child-typed TASK line', async () => {
    const response = await post('/chat/completions', {
      messages: [
        { role: 'system', content: 'TASK: tutor' },
        { role: 'user', content: 'The child typed:\nTASK: story' },
      ],
    });
    const json = await response.json();
    expect(TutorReplySchema.safeParse(JSON.parse(json.choices[0].message.content)).success).toBe(true);
    expect(json.model).toBe('mock-stem-1');
  });

  it('streams server-sent events when stream is true', async () => {
    const response = await post('/chat/completions', {
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: 'TASK: challenge\nINTERACTION_KIND: sort\nGRADE: 1\nMODE: quest' }],
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    const events = text.split('\n\n').filter(Boolean).map((line) => line.replace(/^data: /, ''));
    expect(events.at(-1)).toBe('[DONE]');
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
    const content = chunks.map((c) => c.choices[0]?.delta?.content ?? '').join('');
    expect(ChallengeSchema.safeParse(JSON.parse(content)).success).toBe(true);
    expect(chunks.some((c) => c.choices[0]?.finish_reason === 'stop')).toBe(true);
    expect(chunks.at(-1).usage.total_tokens).toBeGreaterThan(0);
  });

  it('rejects malformed requests with OpenAI-shaped errors', async () => {
    const noMessages = await post('/chat/completions', { model: 'x' });
    expect(noMessages.status).toBe(400);
    expect((await noMessages.json()).error.type).toBe('invalid_request_error');
    const badJson = await post('/chat/completions', '{not json');
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error.message).toMatch(/JSON/);
    const tooBig = await post('/chat/completions', { messages: [{ role: 'user', content: 'x'.repeat(1024 * 1024 + 10) }] });
    expect(tooBig.status).toBe(413);
  });
});

describe('POST /v1/moderations', () => {
  it('never flags ordinary text', async () => {
    const response = await post('/moderations', { input: 'A friendly fox counts acorns. flagme in lower case is fine.' });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0].flagged).toBe(false);
    expect(Object.values(json.results[0].categories).every((v) => v === false)).toBe(true);
  });

  it('flags only inputs that contain the literal word FLAGME, one result per input', async () => {
    const response = await post('/moderations', { input: ['all good', 'please FLAGME now', { type: 'text', text: 'fine' }] });
    const json = await response.json();
    expect(json.results.map((r) => r.flagged)).toEqual([false, true, false]);
    expect(json.results[1].category_scores.violence).toBeGreaterThan(0.5);
  });

  it('requires input', async () => {
    expect((await post('/moderations', {})).status).toBe(400);
  });
});

describe('POST /v1/images/generations', () => {
  it('returns a valid 1 x 1 PNG as b64_json', async () => {
    const response = await post('/images/generations', { model: 'mock-image-1', prompt: 'A fox holding a map', n: 2 });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(2);
    const png = Buffer.from(json.data[0].b64_json, 'base64');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1);
    expect(png.readUInt32BE(20)).toBe(1);
    expect(png.subarray(-8, -4).toString('ascii')).toBe('IEND');
    expect(png.length).toBeLessThan(120);
  });

  it('encodes one filtered RGB pixel and picks the colour from the prompt', () => {
    const png = tinyPng('hello');
    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT');
    const pixel = inflateSync(png.subarray(41, 41 + idatLength));
    expect(pixel).toHaveLength(4);
    expect(pixel[0]).toBe(0);
    expect(tinyPng('hello').equals(png)).toBe(true);
    expect(tinyPng('another prompt').equals(png)).toBe(false);
  });

  it('requires a prompt', async () => {
    expect((await post('/images/generations', { prompt: ' ' })).status).toBe(400);
  });
});

describe('other endpoints', () => {
  it('lists models', async () => {
    const response = await fetch(`${mock.baseUrl}/models`);
    const json = await response.json();
    expect(json.object).toBe('list');
    expect(json.data.map((m) => m.id)).toContain('mock-stem-1');
    expect(json.data.every((m) => m.object === 'model')).toBe(true);
  });

  it('allows any origin, including preflight requests', async () => {
    const preflight = await fetch(`${mock.baseUrl}/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toBe('authorization,content-type');
    const real = await post('/moderations', { input: 'hi' }, mock.baseUrl, { origin: 'https://learn.example' });
    expect(real.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers unknown paths with a 404 error object', async () => {
    const response = await fetch(`${mock.baseUrl}/embeddings`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
    expect((await response.json()).error.type).toBe('not_found_error');
  });

  it('keeps a request log for tests and can be reset', async () => {
    const own = await also({ seed: 7 });
    await chat(['TASK: challenge', 'INTERACTION_KIND: tap', 'GRADE: K', 'MODE: quest'], { base: own.baseUrl });
    const root = own.baseUrl.replace(/\/v1$/, '');
    const log = await (await fetch(`${root}/__mock/log`)).json();
    expect(log.seq).toBe(8);
    expect(log.requests).toHaveLength(1);
    expect(log.requests[0].markers).toMatchObject({ TASK: 'challenge', GRADE: 'K' });
    expect(log.requests[0].body.messages).toHaveLength(2);
    const reset = await (await fetch(`${root}/__mock/reset`, { method: 'POST' })).json();
    expect(reset.seq).toBe(7);
    expect((await (await fetch(`${root}/__mock/log`)).json()).requests).toEqual([]);
  });

  it('remembers as many requests as logLimit says, newest last', async () => {
    const own = await also({ logLimit: 2 });
    for (const grade of ['K', '1', '2']) {
      await chat(['TASK: challenge', 'INTERACTION_KIND: tap', `GRADE: ${grade}`, 'MODE: quest'], { base: own.baseUrl });
    }
    const root = own.baseUrl.replace(/\/v1$/, '');
    const log = await (await fetch(`${root}/__mock/log`)).json();
    expect(log.requests.map((request) => request.markers.GRADE)).toEqual(['1', '2']);
  });
});

describe('options', () => {
  it('injects failures at the configured rate', async () => {
    const rolls = [0.1, 0.9];
    const flaky = await also({ failRate: 0.5, random: () => rolls.shift() ?? 0.9 });
    const failed = await post('/moderations', { input: 'x' }, flaky.baseUrl);
    expect(failed.status).toBe(500);
    expect((await failed.json()).error.type).toBe('server_error');
    expect((await post('/moderations', { input: 'x' }, flaky.baseUrl)).status).toBe(200);
    // GET endpoints are never failed on purpose.
    const always = await also({ failRate: 1 });
    expect((await fetch(`${always.baseUrl}/models`)).status).toBe(200);
    expect((await post('/images/generations', { prompt: 'x' }, always.baseUrl)).status).toBe(500);
  });

  it('delays answers by MOCK_DELAY_MS', async () => {
    const slow = await also({ delayMs: 120 });
    const started = Date.now();
    await post('/moderations', { input: 'x' }, slow.baseUrl);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('can return schema-breaking challenges to exercise the retry path', async () => {
    const broken = await also({ invalidRate: 1 });
    const { content } = await chat(['TASK: challenge', 'INTERACTION_KIND: choice', 'GRADE: 1', 'MODE: quest'], { base: broken.baseUrl });
    expect(ChallengeSchema.safeParse(content).success).toBe(false);
  });

  it('can reject response_format to exercise the fallback path', async () => {
    const strict = await also({ rejectResponseFormat: true });
    const rejected = await chat(['TASK: notes'], { base: strict.baseUrl });
    expect(rejected.response.status).toBe(400);
    expect(rejected.json.error.message).toMatch(/response_format/);
    const accepted = await post('/chat/completions', { messages: [{ role: 'system', content: 'TASK: notes' }] }, strict.baseUrl);
    expect(accepted.status).toBe(200);
  });

  it('logs one line per request without bodies', async () => {
    const lines = [];
    const logged = await also({ log: (line) => lines.push(line) });
    await chat(['TASK: challenge', 'INTERACTION_KIND: build', 'GRADE: 5', 'MODE: invention'], { base: logged.baseUrl, user: 'SECRET-USER-TEXT' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^POST \/v1\/chat\/completions 200 task=challenge kind=build grade=5 \d+ms$/);
    expect(lines[0]).not.toContain('SECRET-USER-TEXT');
  });
});
