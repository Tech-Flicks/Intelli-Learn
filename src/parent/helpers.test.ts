/** The parent area's pure helpers: formatting, form data, history and chart maths. */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/defaults';
import { ChallengeSchema } from '@/core/schemas';
import type { StageChange } from '@/core/types';
import { t } from '@/i18n';
import './strings';
import { buildHistory, EMPTY_HISTORY_FILTER, filterHistory, isFiltering } from './child/history';
import { chartGeometry, stageSeries } from './child/stageHistory';
import { cleanOverride, validateOverride } from './child/ProfileTab';
import {
  aiDraftOf,
  aiSettingsOf,
  connectionOverride,
  draftHasImageModel,
  isLocalAddress,
  normalizeBaseUrl,
  sameAiDraft,
  validateAiDraft,
} from './forms/aiForm';
import { childDraftToInput, emptyChildDraft, sameChildDraft, tidyText, validateChildDraft } from './forms/ChildForm';
import { sameControls, validateControls } from './forms/ControlsForm';
import { validateNewPassword } from './forms/password';
import {
  addDays,
  dayStart,
  describeAnswer,
  describeSolution,
  formatDuration,
  formatHour,
  formatNumber,
  formatPercent,
  recentWeeks,
  weekRangeLabel,
} from './format';
import { sampleChallenge } from './testSupport';

const base = {
  title: 'A title',
  intro: 'An intro.',
  question: 'A question?',
  readAloud: 'An intro. A question?',
  hints: ['One.', 'Two.'],
  walkthrough: ['First.', 'Then.'],
  explanation: 'Because.',
  scene: { theme: 'space', objects: [{ id: 'star-1', type: 'emoji', emoji: '⭐', label: 'star', x: 20, y: 20 }] },
};

describe('formatting', () => {
  it('writes numbers, shares and hours the way the language does', () => {
    expect(formatNumber(12345, 'en')).toBe('12,345');
    expect(formatNumber(12345, 'es')).toMatch(/12[.\s  ]?345/);
    expect(formatPercent(0.5, 'en')).toBe('50%');
    expect(formatHour(7, 'en')).toMatch(/^7:00\sAM$/);
    expect(formatHour(20, 'es')).toMatch(/20:00/);
    expect(formatHour(24, 'en')).toMatch(/^12:00\sAM$/);
  });

  it('writes durations in the largest sensible units', () => {
    expect(formatDuration(45_000, 'en', t)).toBe('45 s');
    expect(formatDuration(180_000, 'en', t)).toBe('3 min');
    expect(formatDuration(200_000, 'en', t)).toBe('3 min 20 s');
    expect(formatDuration(3_900_000, 'en', t)).toBe('1 h 5 min');
    expect(formatDuration(Number.NaN, 'en', t)).toBe('0 s');
  });

  it('does its day arithmetic in local time', () => {
    expect(dayStart('2026-03-09')).toBe(new Date(2026, 2, 9).getTime());
    expect(dayStart('yesterday')).toBeNull();
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(recentWeeks('2026-03-09', 3)).toEqual(['2026-03-09', '2026-03-02', '2026-02-23']);
    expect(weekRangeLabel('2026-03-09', 'en')).toBe('Mar 9 – Mar 15, 2026');
  });
});

describe('answers in words', () => {
  it('names chosen options instead of showing their ids', () => {
    const challenge = ChallengeSchema.parse({
      ...base,
      interaction: {
        kind: 'choice',
        options: [
          { id: 'a', label: 'Three', emoji: '3️⃣' },
          { id: 'b', label: 'Four' },
        ],
        correctIds: ['a'],
      },
    });
    expect(describeAnswer(challenge, ['b'], 'en', t)).toBe('Four');
    expect(describeAnswer(challenge, [], 'en', t)).toBe('Nothing chosen');
    expect(describeAnswer(challenge, null, 'en', t)).toBe('Nothing chosen');
    expect(describeSolution(challenge, 'en', t)).toBe('3️⃣ Three');
  });

  it('describes sorting, numbers and robot programs', () => {
    const sort = ChallengeSchema.parse({
      ...base,
      interaction: {
        kind: 'sort',
        bins: [
          { id: 'float', label: 'Floats' },
          { id: 'sink', label: 'Sinks' },
        ],
        items: [
          { id: 'cork', label: 'Cork', binId: 'float' },
          { id: 'rock', label: 'Rock', binId: 'sink' },
        ],
      },
    });
    expect(describeAnswer(sort, { cork: 'float', rock: 'float' }, 'en', t)).toBe('Cork → Floats, Rock → Floats');

    const number = sampleChallenge();
    expect(describeAnswer(number, 4, 'en', t)).toBe('4');
    expect(describeAnswer(number, 'four', 'en', t)).toBe('four');
    expect(describeSolution(number, 'en', t)).toBe('3');
  });

  it('shows an answer that does not fit the challenge as it was stored', () => {
    expect(describeAnswer(sampleChallenge(), { odd: true }, 'en', t)).toBe('{"odd":true}');
  });
});

describe('AI connection draft', () => {
  const ai = defaultSettings().ai;

  it('starts from the stored settings and never from a key', () => {
    const draft = aiDraftOf(ai);
    expect(draft).toMatchObject({ provider: 'demo', directBaseUrl: 'https://api.openai.com/v1', apiKey: '', removeKey: false });
    expect(draft.proxyBaseUrl).not.toBe('');
    expect(sameAiDraft(draft, aiDraftOf(ai))).toBe(true);
    expect(sameAiDraft(draft, { ...draft, apiKey: 'x' })).toBe(false);
  });

  it('validates each mode on its own terms', () => {
    const draft = aiDraftOf(ai);
    expect(validateAiDraft(draft, false, t)).toEqual({});
    expect(validateAiDraft({ ...draft, dailyRequestBudget: -1, monthlyRequestCap: null }, false, t)).toHaveProperty('dailyRequestBudget');
    expect(validateAiDraft({ ...draft, dailyRequestBudget: 1.5 }, false, t)).toHaveProperty('dailyRequestBudget');

    const direct = { ...draft, provider: 'direct' as const };
    expect(Object.keys(validateAiDraft(direct, false, t))).toEqual(['apiKey']);
    expect(validateAiDraft(direct, true, t)).toEqual({});
    expect(Object.keys(validateAiDraft({ ...direct, removeKey: true }, true, t))).toEqual(['apiKey']);
    expect(validateAiDraft({ ...direct, apiKey: 'sk-1' }, false, t)).toEqual({});
    expect(validateAiDraft({ ...direct, directBaseUrl: 'http://192.168.1.20:1234/v1' }, false, t)).toEqual({});
    expect(Object.keys(validateAiDraft({ ...direct, directBaseUrl: 'ftp://example.com', apiKey: 'sk-1' }, false, t))).toEqual(['baseUrl']);
    expect(Object.keys(validateAiDraft({ ...direct, chatModel: ' ', apiKey: 'sk-1' }, false, t))).toEqual(['chatModel']);

    const proxy = { ...draft, provider: 'proxy' as const };
    expect(validateAiDraft(proxy, false, t)).toEqual({});
    expect(validateAiDraft({ ...proxy, proxyBaseUrl: 'https://home.example/ai-proxy/' }, false, t)).toEqual({});
    expect(Object.keys(validateAiDraft({ ...proxy, proxyBaseUrl: 'ai-proxy' }, false, t))).toEqual(['baseUrl']);
  });

  it('knows which addresses are on the home network', () => {
    for (const local of ['http://localhost:11434/v1', 'http://127.0.0.1:1234', 'http://10.0.0.5/v1', 'http://172.20.1.1/v1', 'http://nas.local:8080/v1']) {
      expect(isLocalAddress(local), local).toBe(true);
    }
    for (const remote of ['https://api.openai.com/v1', 'http://172.32.0.1/v1', 'http://8.8.8.8/v1', 'not a url']) {
      expect(isLocalAddress(remote), remote).toBe(false);
    }
  });

  it('turns a draft into settings and into the values for a connection test', () => {
    const draft = { ...aiDraftOf(ai), provider: 'direct' as const, directBaseUrl: ' https://api.example.com/v1// ', apiKey: ' sk-2 ', imageModel: ' gpt-image-1 ' };
    expect(normalizeBaseUrl(' https://a.example/v1/ ')).toBe('https://a.example/v1');
    const settings = aiSettingsOf(draft, ai);
    expect(settings).toMatchObject({ provider: 'direct', baseUrl: 'https://api.example.com/v1', imageModel: 'gpt-image-1' });
    // The typed key never lands in the settings object.
    expect(JSON.stringify(settings)).not.toContain('sk-2');
    expect(connectionOverride(draft)).toEqual({ provider: 'direct', baseUrl: 'https://api.example.com/v1', chatModel: ai.chatModel, apiKey: 'sk-2' });
    expect(connectionOverride({ ...draft, provider: 'proxy' })).not.toHaveProperty('apiKey');
    expect(draftHasImageModel(draft)).toBe(true);
    expect(draftHasImageModel({ ...draft, provider: 'demo' })).toBe(false);
  });
});

describe('controls, password and child drafts', () => {
  const controls = defaultSettings().controls;

  it('accepts the defaults and names what is wrong otherwise', () => {
    expect(validateControls(controls, t)).toEqual({});
    expect(validateControls({ ...controls, dailyMinutes: 2 }, t)).toHaveProperty('dailyMinutes');
    expect(validateControls({ ...controls, dailyMinutes: 12.5 }, t)).toHaveProperty('dailyMinutes');
    expect(validateControls({ ...controls, allowedStartHour: 9, allowedEndHour: 9 }, t)).toHaveProperty('hours');
    expect(validateControls({ ...controls, allowedStartHour: 0, allowedEndHour: 24 }, t)).toEqual({});
    expect(validateControls({ ...controls, allowedStartHour: 20, allowedEndHour: 7 }, t)).toEqual({});
    const none = { math: false, science: false, technology: false, engineering: false, logic: false };
    expect(validateControls({ ...controls, strands: none }, t)).toHaveProperty('strands');
    expect(sameControls(controls, { ...controls, strands: { ...controls.strands } })).toBe(true);
    expect(sameControls(controls, { ...controls, strands: { ...controls.strands, logic: !controls.strands.logic } })).toBe(false);
  });

  it('keeps only real overrides and validates them like the family rules', () => {
    expect(cleanOverride({ dailyMinutes: undefined, microphone: true })).toEqual({ microphone: true });
    expect(validateOverride({ dailyMinutes: 20 }, t)).toEqual({});
    expect(validateOverride({ dailyMinutes: 1 }, t)).toHaveProperty('dailyMinutes');
    expect(validateOverride({ allowedStartHour: 8, allowedEndHour: 8 }, t)).toHaveProperty('hours');
    const none = { math: false, science: false, technology: false, engineering: false, logic: false };
    expect(validateOverride({ strands: none }, t)).toHaveProperty('strands');
  });

  it('checks a new password and its repetition', () => {
    expect(validateNewPassword('', '', t)).toEqual({ password: 'Enter a password.', confirm: 'Type the password once more.' });
    expect(validateNewPassword('abc', 'abc', t)).toEqual({ password: 'Use at least 6 characters.' });
    expect(validateNewPassword('       ', '       ', t)).toEqual({ password: 'A password cannot be only spaces.' });
    expect(validateNewPassword('long enough', 'long enoug', t)).toEqual({ confirm: 'The two passwords do not match.' });
    expect(validateNewPassword('long enough', 'long enough', t)).toEqual({});
  });

  it('tidies and validates a child draft', () => {
    const draft = emptyChildDraft();
    expect(validateChildDraft(draft, t)).toHaveProperty('nickname');
    expect(validateChildDraft({ ...draft, nickname: 'x'.repeat(21) }, t)).toHaveProperty('nickname');
    expect(validateChildDraft({ ...draft, nickname: 'Mia', interests: Array.from({ length: 9 }, (_, index) => `thing ${index}`) }, t)).toHaveProperty('interests');
    expect(tidyText('  two   words ')).toBe('two words');
    expect(childDraftToInput({ ...draft, nickname: '  Mia  ', interests: ['space'] })).toMatchObject({ nickname: 'Mia', interests: ['space'] });
    expect(sameChildDraft(draft, { ...draft, interests: [...draft.interests] })).toBe(true);
    expect(sameChildDraft(draft, { ...draft, nickname: 'Leo' })).toBe(false);
  });
});

describe('history and level chart', () => {
  const challenge = (id: string, patch: Record<string, unknown> = {}) =>
    ({
      id,
      childId: 'c1',
      skillId: 'math-counting-cardinality',
      strand: 'math',
      stage: 4,
      interaction: 'number',
      mode: 'quest',
      purpose: 'core',
      theme: 'space',
      content: sampleChallenge(id),
      source: 'offline',
      status: 'completed',
      storyId: null,
      chapterIndex: null,
      libraryId: null,
      parentRating: null,
      parentNote: '',
      createdAt: 1000,
      startedAt: 1000,
      completedAt: 2000,
      ...patch,
    }) as Parameters<typeof buildHistory>[0][number];
  const attempt = (challengeId: string, completedAt: number, outcome = 'independent') =>
    ({
      id: `at-${challengeId}-${completedAt}`,
      challengeId,
      childId: 'c1',
      skillId: 'math-counting-cardinality',
      strand: 'math',
      answers: [],
      hintsUsed: 0,
      walkthroughUsed: false,
      teachBackCorrect: null,
      outcome,
      timeMs: 1000,
      starsEarned: 1,
      completedAt,
    }) as Parameters<typeof buildHistory>[1][number];

  it('joins finished challenges with their latest attempt, newest first', () => {
    const march3 = new Date(2026, 2, 3, 15).getTime();
    const march5 = new Date(2026, 2, 5, 9).getTime();
    const entries = buildHistory(
      [challenge('a'), challenge('b', { strand: 'science', mode: 'story' }), challenge('open', { status: 'active' }), challenge('lost', { completedAt: 500 })],
      [attempt('a', march3, 'hint'), attempt('b', march5), attempt('b', march5 - 1000, 'walkthrough')],
    );
    expect(entries.map((entry) => entry.challenge.id)).toEqual(['b', 'a', 'lost']);
    expect(entries[0]?.attempt?.outcome).toBe('independent');
    expect(entries[2]).toMatchObject({ attempt: null, at: 500 });

    expect(isFiltering(EMPTY_HISTORY_FILTER)).toBe(false);
    expect(filterHistory(entries, EMPTY_HISTORY_FILTER)).toHaveLength(3);
    const ids = (filter: Partial<typeof EMPTY_HISTORY_FILTER>) =>
      filterHistory(entries, { ...EMPTY_HISTORY_FILTER, ...filter }).map((entry) => entry.challenge.id);
    expect(ids({ strand: 'science' })).toEqual(['b']);
    expect(ids({ mode: 'quest' })).toEqual(['a', 'lost']);
    expect(ids({ outcome: 'hint' })).toEqual(['a']);
    // Both ends of a date range are included.
    expect(ids({ from: '2026-03-03', to: '2026-03-03' })).toEqual(['a']);
    expect(ids({ from: '2026-03-04' })).toEqual(['b']);
    expect(ids({ to: '2026-03-02' })).toEqual(['lost']);
  });

  it('turns level changes into a step line', () => {
    const changes: StageChange[] = [
      { id: '2', childId: 'c1', skillId: null, strand: 'math', from: 8, to: 9, reason: 'mastery', at: 2000 },
      { id: '1', childId: 'c1', skillId: null, strand: 'math', from: 6, to: 8, reason: 'placement', at: 1000 },
    ];
    const points = stageSeries(changes, 9, 3000);
    expect(points).toEqual([
      { at: 1000, stage: 6 },
      { at: 1000, stage: 8 },
      { at: 2000, stage: 9 },
      { at: 3000, stage: 9 },
    ]);
    expect(stageSeries([], null, 3000)).toEqual([]);
    expect(stageSeries([], 5, 3000)).toEqual([{ at: 3000, stage: 5 }]);

    const geometry = chartGeometry(points, 200, 60, 10);
    expect(geometry.dots).toHaveLength(4);
    // Levels 6 to 9 are drawn on an axis of a whole grade (5 to 9), so 6 sits a quarter up.
    expect(geometry.dots[0]).toEqual({ x: 10, y: 40 });
    expect(geometry.dots[3]).toEqual({ x: 190, y: 10 });
    // Higher levels sit higher up; the line never leaves the box.
    expect(geometry.dots[2]?.y).toBeLessThan(geometry.dots[0]?.y ?? 0);
    for (const dot of geometry.dots) {
      expect(dot.y).toBeGreaterThanOrEqual(10);
      expect(dot.y).toBeLessThanOrEqual(50);
    }
    expect(geometry.path).toBe('M10 40 L10 20 L100 20 L100 10 L190 10');
    expect(chartGeometry([], 200, 60, 10)).toEqual({ path: '', dots: [] });
    expect(chartGeometry([{ at: 5, stage: 0 }], 200, 60, 10).dots).toEqual([{ x: 100, y: 50 }]);
  });
});
