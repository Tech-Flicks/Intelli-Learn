import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStage } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { SKILLS, skillGrades } from '@/core/skills';
import type { ChallengePlan, Settings } from '@/core/types';
import { fakeResponse, sentRequest, settingsFor } from './testSupport';

const world = vi.hoisted(() => ({
  settings: null as unknown,
  usage: [] as Record<string, number>[],
  budgetChecks: 0,
}));

vi.mock('@/data', () => ({
  getSettings: vi.fn(async () => world.settings as Settings),
  checkBudget: vi.fn(async () => {
    world.budgetChecks += 1;
    return { allowed: true, reason: 'ok' };
  }),
  recordUsage: vi.fn(async (delta: Record<string, number>) => {
    world.usage.push(delta);
  }),
}));
vi.mock('@/security', () => ({ getApiKey: vi.fn(async () => 'sk-test') }));

import { SAMPLE_CHALLENGES } from '@/engine';
import { pickOfflineChallenge, pickOfflineStory } from '@/offline';
import { clientTuning, resetClientSession } from './client';
import { KIND_EXAMPLES } from './prompts';
import {
  challengeTexts,
  checkChallengeSafety,
  checkTexts,
  localSafetyCheck,
  normalizeForSafety,
  resetModerationSession,
  svgTextContent,
} from './safety';

const fetchMock = vi.fn();

function challenge(patch: Record<string, unknown> = {}): Challenge {
  return ChallengeSchema.parse({
    title: 'Count the stars',
    intro: 'Three stars twinkle over the hill.',
    question: 'How many stars can you see?',
    readAloud: 'Three stars twinkle over the hill. How many stars can you see?',
    interaction: { kind: 'number', answer: 3 },
    hints: ['Count slowly.', 'Point at each star as you count.'],
    walkthrough: ['Point at the first star.', 'Keep pointing and counting until you run out of stars.'],
    explanation: 'There are three stars.',
    scene: { theme: 'space', objects: [{ id: 'star-1', type: 'emoji', emoji: '⭐', x: 20, y: 20 }] },
    ...patch,
  });
}

beforeEach(() => {
  world.settings = settingsFor('demo');
  world.usage = [];
  world.budgetChecks = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetClientSession();
  resetModerationSession();
  clientTuning.backoffMs = 0;
});

describe('localSafetyCheck: true positives', () => {
  const blocked: [string, string][] = [
    ['violence', 'The pirate wants to kill the captain.'],
    ['violence', 'He murdered three people.'],
    ['weapons', 'Count the guns on the table.'],
    ['weapons', 'The robot carries a bomb.'],
    ['self-harm', 'She wanted to hurt herself.'],
    ['sexual content', 'This is a sexy robot.'],
    ['sexual content', 'They looked at porn.'],
    ['drugs or alcohol', 'Dad drank five beers and some vodka.'],
    ['drugs or alcohol', 'He sells drugs at school.'],
    ['drugs or alcohol', 'Smoking a cigarette is cool.'],
    ['profanity', 'What the fuck is this?'],
    ['profanity', 'That is bullshit.'],
    ['profanity', 'Sh1t happens.'],
    ['unkind words', 'That was a stupid mistake.'],
    ['unkind words', 'You are so lazy.'],
    ['hate', 'The nazis marched.'],
    ['scary content', 'A demon lives in the cave.'],
    ['personal', 'Before we start, what is your name?'],
    ['personal', 'Tell me your home address.'],
    ['personal', 'Type your password here.'],
    ['personal', 'Can you tell me your phone number?'],
    ['personal', 'Where do you live?'],
    ['personal', 'How old are you?'],
    ['personal', 'Which school do you go to?'],
    ['personal', "What's your school's name?"],
    ['links', 'Visit http://example.org for more.'],
    ['links', 'Go to www.example.org now.'],
    ['links', 'Check out coolgames.com today!'],
    ['links', 'Write to me at friend@example.org'],
    ['links', 'Find me on Discord.'],
    // Spanish
    ['violence', 'El pirata quiere matar al capitán.'],
    ['profanity', 'Esto es una mierda.'],
    ['drugs or alcohol', 'Bebió tres cervezas.'],
    ['personal', '¿Cómo te llamas?'],
    ['personal', '¿Dónde vives?'],
    ['personal', 'Dime tu dirección.'],
    ['personal', '¿Cuántos años tienes?'],
    // Hindi
    ['weapons', 'उसके पास बंदूक है।'],
    ['drugs or alcohol', 'वह शराब पीता है।'],
    ['personal', 'तुम्हारा नाम क्या है?'],
    ['personal', 'तुम कहाँ रहते हो?'],
    ['personal', 'अपना फ़ोन नंबर बताओ।'],
    ['unkind words', 'तुम बेवकूफ हो।'],
  ];

  it.each(blocked)('blocks %s: %s', (_category, text) => {
    expect(localSafetyCheck(text, 'standard').safe).toBe(false);
    expect(localSafetyCheck(text, 'strict').safe).toBe(false);
  });

  it('gives a short reason that names the category', () => {
    const result = localSafetyCheck('The pirate wants to kill the captain.');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('violence');
    expect(result.reason.length).toBeLessThanOrEqual(200);
  });

  it('blocks unsuitable emoji', () => {
    expect(localSafetyCheck('Look 🔫', 'standard').safe).toBe(false);
    expect(localSafetyCheck('Cheers 🍺', 'standard').safe).toBe(false);
    expect(localSafetyCheck('Boo 👻', 'standard').safe).toBe(true);
    expect(localSafetyCheck('Boo 👻', 'strict').safe).toBe(false);
  });

  it('defaults to strict', () => {
    expect(localSafetyCheck('A ghost said boo.').safe).toBe(false);
  });
});

describe('localSafetyCheck: no false positives', () => {
  const harmless = [
    'Our class will assess the grass on the field.',
    'Practise this skill to build your skills.',
    'A fruit cocktail has four kinds of fruit.',
    'The town of Scunthorpe has a football team.',
    'A peacock, a cockatoo and a cockroach sat in the cockpit.',
    'The rooster says cock-a-doodle-doo.',
    'Pass the bass to the bassist. Assemble the chassis.',
    'Press the button on the butterfly shell. Hello!',
    'Essex, Sussex and Middlesex are in England.',
    'Do a careful analysis of the title.',
    'Count each shooting star tonight.',
    'The bullet train is very fast.',
    'A killer whale is really a big dolphin.',
    'The robot reached a dead end and its battery is a dead battery.',
    'Decomposers break down dead plants and animals.',
    'A knife is a wedge that pushes things apart.',
    'Throw the ball farther. Which car rolled the farthest?',
    'The rope in a tug-of-war is in tension.',
    'Roll a die. What number is on the die?',
    'Eat the grapes. The therapist reads a document about a cucumber.',
    'The sextant helped sailors. Sixteen is a number.',
    'A pussy willow grows by the pond, and the pussy cat sleeps.',
    'We drank root beer and ginger beer.',
    'Pull the weeds in the garden and look at the seaweed.',
    'Plot the points on the x and y axes.',
    'A bamboo shoot grows fast. Shoot the ball into the hoop.',
    'A strong password has many letters and numbers.',
    'You should never tell anyone your password.',
    'Never type your password on a site you do not know.',
    'Is it safe to share your home address with a stranger online?',
    'A website asks you to enter your home address. What should you do?',
    'Type your answer in the box. What is your guess?',
    'What is your favourite strategy for counting?',
    'You can see the planet with the naked eye.',
    'Mix the batter with a method that works. A drugstore sells bandages.',
    'The dinosaurs went extinct a very long time ago.',
    'Cut the pizza into 4 equal slices.',
    'The heart pumps blood around the body.',
    'Skeletons have 206 bones in an adult.',
    'A monster truck has huge wheels.',
    'The canal is 3.5 km long. Stop.Come back later.',
    // Spanish
    'El año tiene doce meses.',
    'El cono tiene una base redonda.',
    'El gato vino a casa y se sentó en la mata.',
    'La heroína de la historia arma el rompecabezas.',
    'Hay un círculo y un triángulo en la clase.',
    'Es el sexto día de la semana.',
    'Nunca escribas tu contraseña en un sitio desconocido.',
    // Hindi
    'कुत्ता बगीचे में खेल रहा है।',
    'उल्टी गिनती शुरू करो: पांच, चार, तीन।',
    'अपना पासवर्ड किसी को मत बताओ।',
    'तीन सेब और चार केले गिनो।',
  ];

  it.each(harmless)('allows: %s', (text) => {
    expect(localSafetyCheck(text, 'standard')).toEqual({ safe: true, reason: '' });
    expect(localSafetyCheck(text, 'strict')).toEqual({ safe: true, reason: '' });
  });

  it('never matches inside a longer word', () => {
    for (const word of ['class', 'assess', 'grass', 'skill', 'cocktail', 'Scunthorpe', 'bassoon', 'shiitake', 'hello', 'arsenal', 'title', 'raccoon']) {
      expect(localSafetyCheck(word, 'strict').safe, word).toBe(true);
    }
  });
});

describe('localSafetyCheck: strict adds a second tier', () => {
  const strictOnly = [
    'A friendly ghost lives in the attic.',
    'The old king died last year.',
    'It was a scary night.',
    'The zombie walked slowly.',
    'The frog is poisonous.',
    'He did a big fart.',
    'She gave him a kiss.',
    'The knight drew his sword.',
    'The story is about death.',
    'El fantasma vive en el castillo.',
    'भूत पेड़ पर रहता है।',
  ];

  it.each(strictOnly)('blocks only in strict mode: %s', (text) => {
    expect(localSafetyCheck(text, 'standard').safe).toBe(true);
    expect(localSafetyCheck(text, 'strict').safe).toBe(false);
  });

  it('keeps harmless twins of strict words', () => {
    for (const text of ['Tug of war is a game about forces.', 'The Tasmanian devil is an animal.', 'The dinosaurs died out long ago.', 'Roll one die.']) {
      expect(localSafetyCheck(text, 'strict').safe, text).toBe(true);
    }
  });
});

describe('normalizeForSafety', () => {
  it('folds case and accents but keeps the Spanish ñ', () => {
    expect(normalizeForSafety('CÓMO Está el AÑO')).toBe('como esta el año');
  });

  it('turns digits used as letters back into letters inside words only', () => {
    expect(normalizeForSafety('sh1t')).toBe('shit');
    expect(normalizeForSafety('3 apples and 15 pears')).toBe('3 apples and 15 pears');
  });

  it('ignores an empty or missing text', () => {
    expect(localSafetyCheck('').safe).toBe(true);
    expect(localSafetyCheck(undefined as unknown as string).safe).toBe(true);
  });
});

describe('built-in content passes the strict check', () => {
  it('engine samples and prompt examples', async () => {
    for (const sample of Object.values(SAMPLE_CHALLENGES)) {
      expect(await checkChallengeSafety(sample, 'strict'), sample.title).toEqual({ safe: true, reason: '' });
    }
    for (const raw of Object.values(KIND_EXAMPLES)) {
      const example = ChallengeSchema.parse(raw);
      expect(await checkChallengeSafety(example, 'strict'), example.title).toEqual({ safe: true, reason: '' });
    }
  });

  it('offline challenges for every skill, grade and interaction kind', () => {
    const failures: string[] = [];
    for (const skill of SKILLS) {
      for (const grade of skillGrades(skill)) {
        skill.interactions.forEach((interaction, index) => {
          const modes: ChallengePlan['mode'][] = ['quest', ...skill.modes];
          const plan: ChallengePlan = {
            childId: 'c1',
            skillId: skill.id,
            strand: skill.strand,
            stage: makeStage(grade, 'growing'),
            interaction,
            mode: modes[index % modes.length] ?? 'quest',
            purpose: 'core',
            theme: 'animals',
          };
          const content = pickOfflineChallenge(plan, { seed: index + 1 });
          const result = checkTexts(challengeTexts(content), 'strict');
          if (!result.safe) failures.push(`${skill.id} ${grade} ${interaction} ${plan.mode}: ${content.title} -> ${result.reason}`);
        });
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('offline stories', () => {
    for (const theme of ['space', 'ocean', 'robots', 'dinosaurs', 'fairy tales', 'cooking', 'sports', 'weather']) {
      const story = pickOfflineStory(theme, 5);
      const texts = [story.title, story.ending, ...story.chapters.flatMap((c) => [c.heading, c.narrative, c.illustration])];
      for (const text of texts) expect(localSafetyCheck(text, 'strict'), text).toEqual({ safe: true, reason: '' });
    }
  });
});

describe('challengeTexts', () => {
  it('gathers labels, misconceptions, teach-back, scene text and svg text', () => {
    const c = challenge({
      interaction: {
        kind: 'choice',
        options: [
          { id: 'a', label: 'Alpha label', emoji: '🍎', misconception: 'Alpha misconception' },
          { id: 'b', label: 'Beta label' },
        ],
        correctIds: ['b'],
      },
      teachBack: { prompt: 'Teach prompt', options: [{ id: 'x', label: 'Teach right', correct: true }, { id: 'y', label: 'Teach wrong', correct: false }] },
      funFact: 'Fun fact text',
      scene: {
        theme: 'space',
        objects: [
          { id: 't', type: 'text', text: 'Scene text', x: 10, y: 10, label: 'Scene label' },
          { id: 's', type: 'svg', svg: '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><text>Svg words</text><title>Svg title</title></svg>', x: 50, y: 50 },
        ],
      },
    });
    const texts = challengeTexts(c);
    for (const expected of ['Alpha label', '🍎', 'Alpha misconception', 'Beta label', 'Teach prompt', 'Teach right', 'Teach wrong', 'Fun fact text', 'Scene text', 'Scene label', 'Svg words Svg title']) {
      expect(texts).toContain(expected);
    }
    // The svg namespace is an attribute, not text: it must not count as a link.
    expect(texts.join(' ')).not.toContain('http');
  });

  it('reads svg text without tags', () => {
    expect(svgTextContent('<svg><!-- note --><g><text x="1">Hi &amp; there</text></g></svg>')).toBe('Hi there');
  });
});

describe('checkChallengeSafety', () => {
  it('rejects unsafe text anywhere in the challenge', async () => {
    const inHint = challenge({ hints: ['Count slowly.', 'Shoot them with a gun.'] });
    expect((await checkChallengeSafety(inHint, 'standard')).safe).toBe(false);

    const inSvg = challenge({
      scene: { theme: 'space', objects: [{ id: 's', type: 'svg', svg: '<svg viewBox="0 0 10 10"><text>what the fuck</text></svg>', x: 5, y: 5 }] },
    });
    expect((await checkChallengeSafety(inSvg, 'standard')).safe).toBe(false);

    const inEmoji = challenge({ scene: { theme: 'space', objects: [{ id: 'g', type: 'emoji', emoji: '🔫', x: 5, y: 5 }] } });
    expect((await checkChallengeSafety(inEmoji, 'standard')).safe).toBe(false);
  });

  it('does not call the network in demo mode', async () => {
    expect(await checkChallengeSafety(challenge(), 'strict')).toEqual({ safe: true, reason: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the moderation endpoint when an AI service is configured, without spending the budget', async () => {
    world.settings = settingsFor('direct');
    fetchMock.mockResolvedValueOnce(fakeResponse({ results: [{ flagged: false, categories: {}, category_scores: { violence: 0.01 } }] }));
    expect(await checkChallengeSafety(challenge(), 'strict')).toEqual({ safe: true, reason: '' });

    const sent = sentRequest(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.url).toBe('https://ai.test/v1/moderations');
    expect(sent.headers.Authorization).toBe('Bearer sk-test');
    expect(String(sent.body.input)).toContain('How many stars can you see?');
    expect(world.usage).toEqual([]);
    expect(world.budgetChecks).toBe(0);
  });

  it('rejects what the moderation endpoint flags', async () => {
    world.settings = settingsFor('direct');
    fetchMock.mockResolvedValueOnce(fakeResponse({ results: [{ flagged: true, categories: { violence: true, hate: false } }] }));
    const result = await checkChallengeSafety(challenge(), 'standard');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('violence');
  });

  it('is stricter about scores in strict mode', async () => {
    world.settings = settingsFor('direct');
    const body = { results: [{ flagged: false, categories: {}, category_scores: { harassment: 0.55 } }] };
    fetchMock.mockResolvedValueOnce(fakeResponse(body));
    expect((await checkChallengeSafety(challenge(), 'standard')).safe).toBe(true);
    fetchMock.mockResolvedValueOnce(fakeResponse(body));
    expect((await checkChallengeSafety(challenge(), 'strict')).safe).toBe(false);
  });

  it('remembers an endpoint without moderation and stops asking', async () => {
    world.settings = settingsFor('direct');
    fetchMock.mockResolvedValueOnce(fakeResponse('Not found', { status: 404 }));
    expect((await checkChallengeSafety(challenge(), 'strict')).safe).toBe(true);
    expect((await checkChallengeSafety(challenge(), 'strict')).safe).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails open to the local verdict when moderation is down, and asks again next time', async () => {
    world.settings = settingsFor('direct');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await checkChallengeSafety(challenge(), 'strict')).safe).toBe(true);
    fetchMock.mockResolvedValueOnce(fakeResponse('boom', { status: 500 }));
    expect((await checkChallengeSafety(challenge(), 'strict')).safe).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips moderation when the local check already failed', async () => {
    world.settings = settingsFor('direct');
    const unsafe = challenge({ title: 'Guns and bombs' });
    expect((await checkChallengeSafety(unsafe, 'standard')).safe).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
