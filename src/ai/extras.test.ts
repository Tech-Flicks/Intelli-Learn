import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryOutlineSchema, WeeklyReportSchema, type StoryOutline } from '@/core/schemas';
import { LOCALES, type Settings } from '@/core/types';
import { completion, errorBody, fakeResponse, sentRequest, settingsFor } from './testSupport';

const world = vi.hoisted(() => ({
  settings: null as unknown,
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
  getApiKeyFor: vi.fn(async () => 'sk-test'),
  hasApiKey: vi.fn(async () => true),
}));
vi.mock('@/offline', () => ({
  pickOfflineChallenge: vi.fn(),
  pickOfflineStory: vi.fn(() => OFFLINE_STORY),
}));

import { pickOfflineStory } from '@/offline';
import { clientTuning, resetClientSession } from './client';
import {
  generateImage,
  generateLearnerNotes,
  generateStoryOutline,
  generateWeeklyReport,
  resetImageSession,
  templateWeeklyReport,
} from './extras';
import { localSafetyCheck } from './safety';
import type { ChildContext, WeeklyReportRequest } from './types';

const OFFLINE_STORY: StoryOutline = StoryOutlineSchema.parse({
  title: 'Built-in story',
  chapters: [
    { heading: 'One', narrative: 'The hero finds a locked door.', illustration: 'A door.' },
    { heading: 'Two', narrative: 'The hero finds a second door.', illustration: 'Another door.' },
  ],
  ending: 'All doors are open.',
});

const child: ChildContext = { ageGroup: '6-8', grade: '2', interests: ['ocean'], locale: 'en', strictness: 'strict' };
const fetchMock = vi.fn();

function aiStory(chapters: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'The Brave Little Submarine',
    chapters: Array.from({ length: chapters }, (_, index) => ({
      heading: `Chapter ${index + 1}`,
      narrative: `Finn dives deeper and reaches puzzle gate number ${index + 1}. It will not open yet.`,
      illustration: 'A yellow submarine in front of a coral gate.',
    })),
    ending: 'The reef glows again, thanks to a clever helper.',
    ...patch,
  };
}

function withImages(patch: Partial<Settings['ai']> = {}, aiImages = true): Settings {
  const settings = settingsFor('direct', { imageModel: 'image-model', ...patch });
  settings.controls = { ...settings.controls, aiImages };
  return settings;
}

beforeEach(() => {
  world.settings = settingsFor('direct');
  world.budget = { allowed: true, reason: 'ok' };
  world.usage = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(pickOfflineStory).mockClear();
  resetClientSession();
  resetImageSession();
  clientTuning.backoffMs = 0;
});

describe('generateStoryOutline', () => {
  it('uses the built-in story in demo mode', async () => {
    world.settings = settingsFor('demo');
    expect(await generateStoryOutline({ child, theme: 'ocean', chapters: 3 })).toEqual(OFFLINE_STORY);
    expect(pickOfflineStory).toHaveBeenCalledWith('ocean', 3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the AI story and sends the story markers', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion(aiStory(3))));
    const story = await generateStoryOutline({ child, theme: 'ocean', chapters: 3 });
    expect(story.title).toBe('The Brave Little Submarine');
    expect(story.chapters).toHaveLength(3);
    const messages = sentRequest(fetchMock.mock.calls[0] as unknown[]).body.messages as { content: string }[];
    expect(messages[0]?.content.startsWith('TASK: story\nTHEME: ocean\nCHAPTERS: 3')).toBe(true);
  });

  it('trims a story that is too long, keeping the final chapter', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion(aiStory(5))));
    const story = await generateStoryOutline({ child, theme: 'ocean', chapters: 3 });
    expect(story.chapters.map((chapter) => chapter.heading)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 5']);
  });

  it('falls back when the story is unsuitable, the theme is unsuitable, or the service fails', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(completion(aiStory(3, { ending: 'The shark was killed.' }))));
    expect(await generateStoryOutline({ child, theme: 'ocean', chapters: 3 })).toEqual(OFFLINE_STORY);

    fetchMock.mockClear();
    expect(await generateStoryOutline({ child, theme: 'guns', chapters: 3 })).toEqual(OFFLINE_STORY);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await generateStoryOutline({ child, theme: 'ocean', chapters: 9 })).toEqual(OFFLINE_STORY);
    expect(pickOfflineStory).toHaveBeenLastCalledWith('ocean', 5);
  });
});

describe('generateLearnerNotes', () => {
  const attempts = [{ skill: 'Addition', grade: '2' as const, outcome: 'hint' as const, question: 'What is 47 + 38?', misconceptions: ['Forgot the ten'] }];

  it('returns null in demo mode and with nothing to summarize', async () => {
    world.settings = settingsFor('demo');
    expect(await generateLearnerNotes({ child, attempts })).toBeNull();
    world.settings = settingsFor('direct');
    expect(await generateLearnerNotes({ child, attempts: [] })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the notes and writes them in the parent interface language', async () => {
    world.settings = { ...settingsFor('direct'), locale: 'es' };
    fetchMock.mockResolvedValueOnce(fakeResponse(completion({ summary: 'Va muy bien con las sumas.', strengths: ['Contar'], struggles: [], nextFocus: ['Llevar decenas'] })));
    const notes = await generateLearnerNotes({ child, attempts });
    expect(notes).toEqual({ summary: 'Va muy bien con las sumas.', strengths: ['Contar'], struggles: [], nextFocus: ['Llevar decenas'] });
    const messages = sentRequest(fetchMock.mock.calls[0] as unknown[]).body.messages as { content: string }[];
    expect(messages[0]?.content.startsWith('TASK: notes')).toBe(true);
    expect(messages[0]?.content).toMatch(/in Spanish/);
  });

  it('returns null when the service fails or the notes are unsuitable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await generateLearnerNotes({ child, attempts })).toBeNull();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(fakeResponse(completion({ summary: 'Your child is stupid.', strengths: [], struggles: [], nextFocus: [] })));
    expect(await generateLearnerNotes({ child, attempts })).toBeNull();
  });
});

describe('weekly report', () => {
  const base: WeeklyReportRequest = {
    child,
    stats: { minutes: 42, completed: 12, independentShare: 0.75, stageUps: 2 },
    strandStages: [
      { strand: 'science', label: 'Grade 2, Growing' },
      { strand: 'math', label: 'Grade 2, Strong' },
    ],
    learnerSummary: 'Doing well.',
  };

  it('builds a template report from the numbers', () => {
    const report = templateWeeklyReport(base);
    expect(() => WeeklyReportSchema.parse(report)).not.toThrow();
    expect(report.headline).toBe('12 challenges solved in 42 minutes of play this week.');
    expect(report.highlights[0]).toContain('75%');
    expect(report.highlights.join(' ')).toContain('Moved up 2 stage steps');
    expect(report.highlights.join(' ')).toContain('Science: Grade 2, Growing; Math: Grade 2, Strong');
    expect(report.struggles).toEqual([]);
    expect(report.homeActivities).toHaveLength(3);
    expect(report.homeActivities[0]).toMatch(/Kitchen math/);
    expect(report.homeActivities[1]).toMatch(/Sink or float/);
  });

  it('handles a quiet week and a week that needed a lot of help', () => {
    const quiet = templateWeeklyReport({ ...base, stats: { minutes: 0, completed: 0, independentShare: 0, stageUps: 0 }, strandStages: [] });
    expect(quiet.headline).toMatch(/quiet week/i);
    expect(quiet.highlights).toHaveLength(1);
    expect(quiet.homeActivities.length).toBeGreaterThanOrEqual(1);

    const hard = templateWeeklyReport({ ...base, stats: { minutes: 30, completed: 8, independentShare: 0.25, stageUps: 0 } });
    expect(hard.highlights[0]).toContain('25%');
    expect(hard.struggles).toHaveLength(1);
    expect(hard.struggles[0]).toMatch(/normal/);
  });

  it('writes singular forms and accepts a share given as a percentage', () => {
    const report = templateWeeklyReport({ ...base, stats: { minutes: 1, completed: 1, independentShare: 100, stageUps: 1 } });
    expect(report.headline).toBe('1 challenge solved in 1 minute of play this week.');
    expect(report.highlights[0]).toContain('100%');
    expect(report.highlights[1]).toContain('1 stage step ');
  });

  it.each(LOCALES)('has a complete, schema-valid, safe template in %s', (locale) => {
    for (const stats of [base.stats, { minutes: 0, completed: 0, independentShare: 0, stageUps: 0 }, { minutes: 20, completed: 6, independentShare: 0.1, stageUps: 0 }]) {
      const report = templateWeeklyReport({ ...base, stats }, locale);
      expect(() => WeeklyReportSchema.parse(report)).not.toThrow();
      for (const text of [report.headline, ...report.highlights, ...report.struggles, ...report.homeActivities]) {
        expect(localSafetyCheck(text, 'strict'), text).toEqual({ safe: true, reason: '' });
      }
    }
  });

  it('uses the template in demo mode and when the service fails', async () => {
    world.settings = settingsFor('demo');
    expect(await generateWeeklyReport(base)).toEqual(templateWeeklyReport(base));
    expect(fetchMock).not.toHaveBeenCalled();

    world.settings = settingsFor('direct');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await generateWeeklyReport(base)).toEqual(templateWeeklyReport(base));
  });

  it('uses the template in the parent interface language', async () => {
    world.settings = { ...settingsFor('demo'), locale: 'es' };
    expect((await generateWeeklyReport(base)).headline).toMatch(/retos resueltos/);
  });

  it('returns the AI report when it is valid', async () => {
    const ai = { headline: 'A strong week of adding.', highlights: ['Solved most challenges alone.'], struggles: [], homeActivities: ['Count stairs together.'] };
    fetchMock.mockResolvedValueOnce(fakeResponse(completion(ai)));
    expect(await generateWeeklyReport(base)).toEqual(ai);
    const messages = sentRequest(fetchMock.mock.calls[0] as unknown[]).body.messages as { content: string }[];
    expect(messages[0]?.content.startsWith('TASK: report')).toBe(true);
  });
});

describe('generateImage', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('returns a data URL from the configured image model', async () => {
    world.settings = withImages();
    fetchMock.mockResolvedValueOnce(fakeResponse({ data: [{ b64_json: PNG }] }));
    const url = await generateImage('A fox flying a red kite');
    expect(url).toBe(`data:image/png;base64,${PNG}`);

    const sent = sentRequest(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.url).toBe('https://ai.test/v1/images/generations');
    expect(sent.headers.Authorization).toBe('Bearer sk-test');
    expect(sent.body).toMatchObject({ model: 'image-model', size: '512x512', response_format: 'b64_json', n: 1 });
    expect(String(sent.body.prompt)).toMatch(/^Children's picture-book illustration.*A fox flying a red kite$/);
    expect(world.usage).toContainEqual({ imageRequests: 1 });
  });

  it('recognises a JPEG', async () => {
    world.settings = withImages();
    fetchMock.mockResolvedValueOnce(fakeResponse({ data: [{ b64_json: '/9j/4AAQSkZJRg==' }] }));
    expect(await generateImage('A fox')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  });

  it('returns null without an image model, in demo mode, or when the parent switched images off', async () => {
    world.settings = withImages({ imageModel: '' });
    expect(await generateImage('A fox')).toBeNull();
    world.settings = { ...withImages(), ai: { ...withImages().ai, provider: 'demo' } };
    expect(await generateImage('A fox')).toBeNull();
    world.settings = withImages({}, false);
    expect(await generateImage('A fox')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for an unsuitable description, a spent budget or an aborted request', async () => {
    world.settings = withImages();
    expect(await generateImage('A man with a gun')).toBeNull();
    world.budget = { allowed: false, reason: 'daily-budget' };
    expect(await generateImage('A fox')).toBeNull();
    world.budget = { allowed: true, reason: 'ok' };
    const controller = new AbortController();
    controller.abort();
    expect(await generateImage('A fox', controller.signal)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on failure and never loads a remote image', async () => {
    world.settings = withImages();
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody('nope'), { status: 401 }));
    expect(await generateImage('A fox')).toBeNull();
    fetchMock.mockResolvedValueOnce(fakeResponse({ data: [{ url: 'https://cdn.example.org/image.png' }] }));
    expect(await generateImage('A fox')).toBeNull();
    fetchMock.mockResolvedValueOnce(fakeResponse({ data: [{ b64_json: 'not base64 <script>' }] }));
    expect(await generateImage('A fox')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('moves to the smallest size the API accepts and drops response_format when it is rejected, and remembers both', async () => {
    world.settings = withImages();
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody("Unknown parameter: 'response_format'."), { status: 400 }));
    fetchMock.mockResolvedValueOnce(fakeResponse(errorBody("Invalid value: '512x512'. Supported size values are '1024x1024'."), { status: 400 }));
    fetchMock.mockResolvedValueOnce(fakeResponse({ data: [{ b64_json: PNG }] }));
    expect(await generateImage('A fox')).toBe(`data:image/png;base64,${PNG}`);
    const third = sentRequest(fetchMock.mock.calls[2] as unknown[]).body;
    expect(third.size).toBe('1024x1024');
    expect(third).not.toHaveProperty('response_format');

    fetchMock.mockResolvedValueOnce(fakeResponse({ data: [{ b64_json: PNG }] }));
    await generateImage('A cat');
    const fourth = sentRequest(fetchMock.mock.calls[3] as unknown[]).body;
    expect(fourth.size).toBe('1024x1024');
    expect(fourth).not.toHaveProperty('response_format');
  });

  it('sends no key in proxy mode', async () => {
    world.settings = { ...withImages({ baseUrl: '/ai-proxy/v1' }), ai: { ...withImages({ baseUrl: '/ai-proxy/v1' }).ai, provider: 'proxy' } };
    fetchMock.mockResolvedValueOnce(fakeResponse({ data: [{ b64_json: PNG }] }));
    await generateImage('A fox');
    const sent = sentRequest(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.url).toBe('/ai-proxy/v1/images/generations');
    expect(sent.headers.Authorization).toBeUndefined();
  });
});
