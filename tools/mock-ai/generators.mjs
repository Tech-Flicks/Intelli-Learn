/**
 * Content generators for the Intelli-Learn mock AI server.
 *
 * Everything here is pure and deterministic: the same (kind, grade, mode,
 * theme, seq) always produces the same output, and consecutive `seq` values
 * produce different content. Outputs follow the zod schemas in
 * `src/core/schemas.ts`; `tools/mock-ai/generators.test.mjs` checks that
 * against the real schemas.
 *
 * Zero dependencies on purpose, so `node tools/mock-ai/server.mjs` runs
 * without a build step.
 */

export const GRADES = ['PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8'];
export const INTERACTION_KINDS = ['choice', 'tap', 'sort', 'match', 'order', 'number', 'robot', 'build'];
export const MODES = [
  'quest',
  'story',
  'experiment',
  'robot',
  'detective',
  'fixbot',
  'invention',
  'wonder',
  'studio',
  'mission',
];
export const TASKS = ['challenge', 'tutor', 'story', 'notes', 'report', 'safety', 'ping'];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded pseudo-random helpers (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Integer in [min, max], both inclusive. */
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = (items) => items[Math.floor(next() * items.length)];
  const shuffle = (items) => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  /** `count` different items, in random order. */
  const sample = (items, count) => shuffle(items).slice(0, count);
  /** `count` different integers in [min, max]. */
  const distinctInts = (count, min, max) => {
    const all = [];
    for (let n = min; n <= max; n += 1) all.push(n);
    return sample(all, Math.min(count, all.length));
  };
  return { next, int, pick, shuffle, sample, distinctInts };
}

function clip(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** Rewrites a text for text-to-speech: symbols become words, small whole numbers become number words. */
export function toSpeech(text) {
  return text
    .replace(/\s*\+\s*/g, ' plus ')
    .replace(/\s*×\s*/g, ' times ')
    .replace(/(\d|\bx)\s+-\s+(\d|x\b)/g, '$1 minus $2')
    .replace(/\s*=\s*/g, ' equals ')
    .replace(/\s*%/g, ' percent')
    .replace(/(?<![\d.,])\d+(?![\d.,]*\d)/g, (digits) => {
      const n = Number(digits);
      return n <= 20 ? NUMBER_WORDS[n] : digits;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Numbers written with digits in a text. Mirrors the hint check in the engine's validator. */
function numbersInText(text) {
  const cleaned = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return (cleaned.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Replaces any hint that would give the exact numeric answer away. */
function hintsWithoutAnswer(hints, answer, fallbacks) {
  return hints.map((hint, index) =>
    numbersInText(hint).some((n) => n === Math.abs(answer)) ? fallbacks[index] : hint,
  );
}

export function gradeIndexOf(grade) {
  const index = GRADES.indexOf(String(grade ?? '').trim().toUpperCase());
  return index === -1 ? 3 : index; // unknown grade: pitch at Grade 2
}

/** 0 = PK-K, 1 = grades 1-2, 2 = grades 3-5, 3 = grades 6-8. */
function bandOf(g) {
  if (g <= 1) return 0;
  if (g <= 3) return 1;
  if (g <= 6) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

const CASTS = [
  {
    key: 'space',
    match: /space|rocket|planet|\bstars?\b|astronaut|alien|moon|galax/i,
    scene: 'space',
    place: 'the space station',
    heroes: [['👩‍🚀', 'Captain Nova'], ['👽', 'Zib the alien'], ['🛰️', 'Sat the satellite']],
    item: ['⭐', 'star', 'stars'],
    extras: ['🪐', '🚀', '🌙'],
  },
  {
    key: 'ocean',
    match: /ocean|\bsea\b|fish|shark|whale|mermaid|pirate|beach|water/i,
    scene: 'ocean',
    place: 'the coral reef',
    heroes: [['🐙', 'Ollie the octopus'], ['🐬', 'Dot the dolphin'], ['🦀', 'Coco the crab']],
    item: ['🐚', 'shell', 'shells'],
    extras: ['🐠', '🌊', '🐡'],
  },
  {
    key: 'animals',
    match: /animal|\bpets?\b|dog|\bcats?\b|horse|bird|nature|bug|insect|forest/i,
    scene: 'forest',
    place: 'the quiet forest',
    heroes: [['🦊', 'Fern the fox'], ['🐰', 'Bo the bunny'], ['🦉', 'Olive the owl']],
    item: ['🌰', 'acorn', 'acorns'],
    extras: ['🌳', '🍄', '🦋'],
  },
  {
    key: 'dinosaurs',
    match: /dino|fossil|t-?rex/i,
    scene: 'jungle',
    place: 'the dinosaur valley',
    heroes: [['🦖', 'Rory the T-rex'], ['🦕', 'Lulu the long-neck']],
    item: ['🥚', 'dino egg', 'dino eggs'],
    extras: ['🌴', '🌋', '🦴'],
  },
  {
    key: 'robots',
    match: /robot|machine|computer|video ?game|\bgames?\b|coding|tech|build/i,
    scene: 'workshop',
    place: 'the robot workshop',
    heroes: [['🤖', 'Bolt the robot'], ['🦾', 'Gizmo the helper arm']],
    item: ['⚙️', 'gear', 'gears'],
    extras: ['🔧', '🔋', '💡'],
  },
  {
    key: 'cooking',
    match: /cook|bak(e|ing)|food|kitchen|cake|pizza/i,
    scene: 'kitchen',
    place: 'the busy kitchen',
    heroes: [['👩‍🍳', 'Chef Mina'], ['🐭', 'Pepper the mouse']],
    item: ['🧁', 'cupcake', 'cupcakes'],
    extras: ['🍎', '🥕', '🍪'],
  },
  {
    key: 'sports',
    match: /sport|\bballs?\b|soccer|football|basket|swim|\brun|bike|music|danc/i,
    scene: 'playground',
    place: 'the sunny playground',
    heroes: [['🐸', 'Hops the frog'], ['🐿️', 'Dash the squirrel']],
    item: ['⚽', 'ball', 'balls'],
    extras: ['🏀', '🥅', '🏆'],
  },
  {
    key: 'vehicles',
    match: /\bcars?\b|train|truck|plane|vehicle|\bcity\b/i,
    scene: 'city',
    place: 'the busy city',
    heroes: [['🚂', 'Tilly the train'], ['🚗', 'Zip the little car']],
    item: ['📦', 'box', 'boxes'],
    extras: ['🚦', '🏙️', '🚌'],
  },
  {
    key: 'castle',
    match: /fairy|princess|knight|dragon|castle|magic|superhero|\bhero|unicorn|\bart\b/i,
    scene: 'castle',
    place: 'the old castle',
    heroes: [['🐉', 'Ember the dragon'], ['🦄', 'Luna the unicorn'], ['🧙', 'Wim the wizard']],
    item: ['💎', 'gem', 'gems'],
    extras: ['🏰', '🗝️', '👑'],
  },
  {
    key: 'weather',
    match: /weather|rain|snow|storm|cloud|\bsky\b|wind/i,
    scene: 'sky',
    place: 'the cloud tops',
    heroes: [['🐦', 'Skye the bird'], ['🎈', 'Pop the balloon']],
    item: ['🪁', 'kite', 'kites'],
    extras: ['🌈', '☀️', '☁️'],
  },
  {
    key: 'farm',
    match: /farm|garden|plant|flower|tractor/i,
    scene: 'farm',
    place: 'the sunny farm',
    heroes: [['🐮', 'Daisy the cow'], ['🐔', 'Henny the hen']],
    item: ['🥕', 'carrot', 'carrots'],
    extras: ['🌻', '🚜', '🌾'],
  },
];

/** Keeps a parent-chosen interest readable and harmless: letters, digits, spaces, ' and - only. */
export function cleanTheme(theme) {
  return clip(
    String(theme ?? '')
      .replace(/[^\p{L}\p{N} '-]/gu, ' ')
      .trim(),
    30,
  );
}

function pickCast(theme, seq) {
  const cleaned = cleanTheme(theme);
  const matched = cleaned ? CASTS.find((c) => c.match.test(cleaned)) : undefined;
  const cast = matched ?? CASTS[seq % CASTS.length];
  const hero = cast.heroes[seq % cast.heroes.length];
  return {
    key: cast.key,
    scene: cast.scene,
    place: cast.place,
    hero: { emoji: hero[0], name: hero[1] },
    item: { emoji: cast.item[0], one: cast.item[1], many: cast.item[2] },
    extras: cast.extras,
  };
}

const MODE_OPENERS = {
  quest: (c) => `${c.hero.name} is on a quest in ${c.place}.`,
  story: (c) => `The story goes on in ${c.place}, and ${c.hero.name} needs your help.`,
  experiment: (c) => `${c.hero.name} is trying an experiment in ${c.place}.`,
  robot: (c) => `${c.hero.name} is cheering for a little robot in ${c.place}.`,
  detective: (c) => `A mystery in ${c.place}! ${c.hero.name} has found a clue.`,
  fixbot: (c) => `Pip the helper bot got muddled in ${c.place}. ${c.hero.name} wants you to work it out properly.`,
  invention: (c) => `${c.hero.name} is inventing something new in ${c.place}.`,
  wonder: (c) => `Today's wonder comes from ${c.place}, where ${c.hero.name} noticed something.`,
  studio: (c) => `You imagined it, so here it is: ${c.hero.name} in ${c.place}.`,
  mission: (c) => `${c.hero.name} has a mission for you in ${c.place}.`,
};

function opener(mode, cast) {
  return (MODE_OPENERS[mode] ?? MODE_OPENERS.quest)(cast);
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

const TEXT_COLORS = ['#3b2ea0', '#0b6e4f', '#a23b72', '#1d5fa8', '#8a4b08', '#5b4bdb'];

function clampPos(n) {
  return Math.max(4, Math.min(96, Math.round(n)));
}

function emojiObject(id, emoji, x, y, size, extra = {}) {
  return { id, type: 'emoji', emoji, x: clampPos(x), y: clampPos(y), size, ...extra };
}

function textObject(id, text, x, y, size, color, extra = {}) {
  return { id, type: 'text', text, x: clampPos(x), y: clampPos(y), size, color, ...extra };
}

function heroObject(cast, x = 88, y = 84) {
  return emojiObject('hero', cast.hero.emoji, x, y, 16, { z: 3, anim: { kind: 'bounce', duration: 2.2 } });
}

/** `count` evenly spaced x positions between `from` and `to`. */
function spread(count, from, to) {
  if (count <= 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => from + i * step);
}

/** A row of the same emoji, e.g. things to count. Wraps to a second row above 6. */
function emojiRow(prefix, emoji, count, { from, to, y, size = 11, delayStep = 0.15 }) {
  const perRow = count > 6 ? Math.ceil(count / 2) : count;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const rowIndex = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - rowIndex * perRow);
    const xs = spread(inRow, from, to);
    out.push(
      emojiObject(`${prefix}${i + 1}`, emoji, xs[i - rowIndex * perRow], y + rowIndex * 16, size, {
        anim: { kind: 'float', duration: 3, delay: Number((i * delayStep).toFixed(2)) },
      }),
    );
  }
  return out;
}

/** Up to 12 well separated positions for tappable things. */
function gridPositions(count) {
  const cols = count <= 6 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const xs = spread(cols, 14, 74);
  const ys = spread(rows, 22, rows === 1 ? 22 : 66);
  const out = [];
  for (let i = 0; i < count; i += 1) out.push({ x: xs[i % cols], y: ys[Math.floor(i / cols)] });
  return out;
}

function decor(cast, rng) {
  const places = [
    { x: 8, y: 12 },
    { x: 50, y: 8 },
    { x: 92, y: 14 },
  ];
  return cast.extras.map((emoji, i) =>
    emojiObject(`decor${i + 1}`, emoji, places[i].x, places[i].y, 9, {
      z: 0,
      opacity: 0.8,
      anim: { kind: rng.pick(['float', 'pulse', 'wiggle']), duration: 4 + i },
    }),
  );
}

// ---------------------------------------------------------------------------
// choice
// ---------------------------------------------------------------------------

function optionSet(rng, answer, wrong) {
  const seen = new Set([answer]);
  const picked = [];
  const tryAdd = (value, misconception) => {
    if (picked.length >= 3 || !Number.isFinite(value) || value < 0 || seen.has(value)) return;
    seen.add(value);
    picked.push({ value, misconception });
  };
  for (const [value, misconception] of wrong) tryAdd(value, misconception);
  for (let step = 1; picked.length < 3; step += 1) {
    tryAdd(answer + step, 'Close! Check your counting once more.');
    tryAdd(answer - step, 'Close! Check your counting once more.');
  }
  const ids = ['a', 'b', 'c', 'd'];
  const all = rng.shuffle([{ value: answer, misconception: undefined }, ...picked]);
  let correctId = 'a';
  const options = all.map((entry, index) => {
    const id = ids[index];
    if (entry.value === answer) correctId = id;
    const option = { id, label: String(entry.value) };
    if (entry.misconception) option.misconception = entry.misconception;
    return option;
  });
  return { options, correctIds: [correctId] };
}

function choiceChallenge(ctx) {
  const { rng, g, cast, mode } = ctx;
  const band = bandOf(g);
  const item = cast.item;
  let question;
  let expression;
  let answer;
  let wrong;
  let hints;
  let walkthrough;
  let explanation;
  let kindTitle;
  let teachCorrect;
  const objects = [];

  if (band === 0) {
    const max = g === 0 ? 3 : 5;
    const a = rng.int(1, max);
    const b = rng.int(1, max);
    answer = a + b;
    expression = `${a} + ${b}`;
    kindTitle = 'Add It Up';
    question = `${cast.hero.name} found ${a} ${a === 1 ? item.one : item.many} and then ${b} more. How many ${item.many} are there now?`;
    wrong = [
      [Math.abs(a - b), 'That is the difference. Here the two groups are put together.'],
      [Math.max(a, b), 'That is only one of the groups. Count the other group too.'],
    ];
    hints = [
      `Count the first group of ${item.many}, then keep counting the second group.`,
      'Point at each one and count them all without stopping between the groups.',
    ];
    walkthrough = [
      `Count the first group: ${a}.`,
      `Keep counting on ${b} more.`,
      `You land on ${answer}, so there are ${answer} ${item.many}.`,
    ];
    explanation = `Putting ${a} and ${b} together makes ${answer}.`;
    teachCorrect = `Because ${a} and ${b} put together make ${answer}.`;
    objects.push(
      ...emojiRow('first', item.emoji, a, { from: 10, to: 10 + Math.max(0, a - 1) * 9, y: 40 }),
      ...emojiRow('more', item.emoji, b, { from: 58, to: 58 + Math.max(0, b - 1) * 9, y: 40 }),
      textObject('plus', '+', 50, 40, 12, '#3b2ea0'),
    );
  } else if (band === 1) {
    const limit = g === 2 ? 20 : 100;
    const subtract = rng.next() < 0.5;
    if (subtract) {
      const a = rng.int(Math.floor(limit / 2), limit);
      const b = rng.int(2, Math.floor(limit / 2) - 1);
      answer = a - b;
      expression = `${a} - ${b}`;
      kindTitle = 'Take Away';
      question = `${cast.hero.name} had ${a} ${item.many} and gave ${b} away. How many are left?`;
      wrong = [
        [a + b, 'That is adding. Giving away makes the number smaller.'],
        [answer + 10, 'Check the tens: you took away, so it gets smaller.'],
      ];
      hints = [
        'Giving away means the number gets smaller.',
        `Start at ${a} and count back, or think: what do I add to ${b} to reach ${a}?`,
      ];
      walkthrough = [`Start with ${a}.`, `Take away ${b}.`, `${a} - ${b} = ${answer}.`];
      explanation = `Taking ${b} away from ${a} leaves ${answer}.`;
      teachCorrect = `Because ${a} take away ${b} leaves ${answer}.`;
    } else {
      const a = rng.int(3, Math.floor(limit / 2));
      const b = rng.int(3, Math.floor(limit / 2));
      answer = a + b;
      expression = `${a} + ${b}`;
      kindTitle = 'Add It Up';
      question = `${cast.hero.name} has ${a} ${item.many} and collects ${b} more. How many ${item.many} is that altogether?`;
      wrong = [
        [Math.abs(a - b), 'That is the difference. Altogether means you add.'],
        [answer + 10, 'Check the tens once more.'],
      ];
      hints = [
        'Altogether means you put both groups together.',
        `Start at the bigger number and count on, or add the tens first and then the ones.`,
      ];
      walkthrough = [`Start with ${a}.`, `Add ${b} more.`, `${a} + ${b} = ${answer}.`];
      explanation = `${a} and ${b} together make ${answer}.`;
      teachCorrect = `Because ${a} plus ${b} makes ${answer}.`;
    }
  } else if (band === 2) {
    const a = rng.int(2, g === 4 ? 5 : g === 5 ? 9 : 12);
    const b = rng.int(2, 9);
    answer = a * b;
    expression = `${a} × ${b}`;
    kindTitle = 'Equal Groups';
    question = `There are ${a} baskets with ${b} ${item.many} in each basket. How many ${item.many} are there in total?`;
    wrong = [
      [a + b, 'That is adding the two numbers. Equal groups are multiplied.'],
      [a * (b + 1), 'That is one group too many.'],
      [a * (b - 1), 'That is one group too few.'],
    ];
    hints = [
      'Equal groups mean you can multiply instead of counting one by one.',
      `Skip-count by ${b}, once for every basket.`,
    ];
    walkthrough = [
      `There are ${a} equal groups of ${b}.`,
      `That is ${a} × ${b}.`,
      `${a} × ${b} = ${answer}, so there are ${answer} ${item.many}.`,
    ];
    explanation = `${a} groups of ${b} make ${answer}.`;
    teachCorrect = `Because ${a} equal groups of ${b} is ${a} × ${b} = ${answer}.`;
  } else if (g < 9) {
    const percent = rng.pick([10, 20, 25, 50, 75]);
    const whole = rng.int(1, 10) * 20;
    answer = (percent * whole) / 100;
    expression = `${percent}% of ${whole}`;
    kindTitle = 'Percent Power';
    question = `${cast.hero.name} has ${whole} ${item.many}. ${percent}% of them are painted gold. How many are gold?`;
    wrong = [
      [whole - answer, 'That is the part that is NOT gold.'],
      [percent, 'That is the percent, not the number of things.'],
      [answer * 2, 'That is double the right part.'],
    ];
    hints = [
      'Percent means "out of one hundred".',
      'Turn the percent into a fraction of the whole, then take that fraction of the total.',
    ];
    walkthrough = [
      `${percent}% means ${percent} out of every 100.`,
      `Work out ${percent} ÷ 100 × ${whole}.`,
      `That is ${answer}, so ${answer} ${item.many} are gold.`,
    ];
    explanation = `${percent}% of ${whole} is ${answer}.`;
    teachCorrect = `Because ${percent} out of every 100 of the ${whole} is ${answer}.`;
  } else {
    const x = rng.int(2, 12);
    const a = rng.int(2, 6);
    const b = rng.int(1, 15);
    const c = a * x + b;
    answer = x;
    expression = `${a} × x + ${b} = ${c}`;
    kindTitle = 'Mystery Number';
    question = `${cast.hero.name} wrote a secret rule: ${a} × x + ${b} = ${c}. What number is x?`;
    wrong = [
      [c - b, `That is ${a} × x. Divide by ${a} to find x.`],
      [Math.round(c / a), `Take away ${b} first, then divide.`],
      [x + 1, 'Close! Put your number back into the rule to test it.'],
    ];
    hints = [
      'Undo the steps in reverse order: the adding first, then the multiplying.',
      `Take ${b} away from both sides, then divide both sides by ${a}.`,
    ];
    walkthrough = [
      `Start with ${a} × x + ${b} = ${c}.`,
      `Take ${b} from both sides: ${a} × x = ${c - b}.`,
      `Divide both sides by ${a}: x = ${x}.`,
    ];
    explanation = `x is ${x}, because ${a} × ${x} + ${b} = ${c}.`;
    teachCorrect = `Because ${a} × ${x} + ${b} really equals ${c}.`;
  }

  if (band > 0) {
    objects.push(
      textObject('expr', clip(expression, 60), 46, 34, band === 3 ? 11 : 14, '#3b2ea0', {
        anim: { kind: 'grow', duration: 0.8, loop: false },
      }),
      ...emojiRow('item', item.emoji, 4, { from: 22, to: 70, y: 66, size: 10 }),
    );
  }
  objects.push(heroObject(cast), ...decor(cast, rng));

  return {
    title: `${kindTitle} with ${cast.hero.name}`,
    intro: opener(mode, cast),
    question,
    interaction: { kind: 'choice', multi: false, ...optionSet(rng, answer, wrong) },
    hints,
    walkthrough,
    explanation,
    teachBack: {
      prompt: 'Can you teach Pip why that answer is right?',
      options: rng.shuffle([
        { id: 'because', label: clip(teachCorrect, 160), correct: true },
        { id: 'guess', label: 'Because it is the biggest number on the screen.', correct: false },
      ]),
    },
    funFact: 'People have used counting marks for more than twenty thousand years.',
    scene: { theme: cast.scene, objects },
  };
}

// ---------------------------------------------------------------------------
// tap
// ---------------------------------------------------------------------------

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
const COMPOSITES = [4, 6, 8, 9, 10, 12, 14, 15, 21, 25, 27, 33, 35, 39, 49, 51];

function tapChallenge(ctx) {
  const { rng, g, cast, mode } = ctx;
  const band = bandOf(g);
  const objects = [];
  const targetIds = [];
  let question;
  let hints;
  let walkthrough;
  let explanation;
  let kindTitle;

  if (band === 0) {
    const targetCount = rng.int(2, g === 0 ? 3 : 4);
    const otherCount = rng.int(2, 3);
    const others = cast.extras;
    const things = rng.shuffle([
      ...Array.from({ length: targetCount }, () => ({ emoji: cast.item.emoji, target: true })),
      ...Array.from({ length: otherCount }, (_, i) => ({ emoji: others[i % others.length], target: false })),
    ]);
    const positions = gridPositions(things.length);
    things.forEach((thing, i) => {
      const id = thing.target ? `find${i + 1}` : `other${i + 1}`;
      if (thing.target) targetIds.push(id);
      objects.push(
        emojiObject(id, thing.emoji, positions[i].x, positions[i].y, 15, {
          tappable: true,
          z: 2,
          anim: { kind: rng.pick(['float', 'wiggle', 'pulse']), duration: 2.5 + (i % 3) },
        }),
      );
    });
    kindTitle = `${capitalize(cast.item.one)} Hunt`;
    question = `Tap every ${cast.item.one} ${cast.item.emoji} you can find.`;
    hints = [
      `Look for the things that look exactly like this: ${cast.item.emoji}.`,
      'Check every picture one at a time. Leave the ones that look different.',
    ];
    walkthrough = [
      'Look at one picture at a time.',
      `Is it a ${cast.item.one}? Then tap it.`,
      'Leave the other pictures alone and press Check.',
    ];
    explanation = `You found all the ${cast.item.many} and left the other things alone.`;
  } else {
    let isTarget;
    let targets;
    let others;
    let rule;
    if (band === 1) {
      const even = rng.next() < 0.5;
      const max = g === 2 ? 20 : 99;
      const min = g === 2 ? 1 : 10;
      const pool = rng.distinctInts(max - min + 1, min, max);
      isTarget = (n) => (n % 2 === 0) === even;
      targets = pool.filter(isTarget).slice(0, 3);
      others = pool.filter((n) => !isTarget(n)).slice(0, 3);
      rule = even ? 'even number' : 'odd number';
      kindTitle = even ? 'Even Number Hunt' : 'Odd Number Hunt';
      hints = [
        'Even numbers can be shared into two equal groups. Odd numbers have one left over.',
        'Look only at the last digit of each number.',
      ];
      walkthrough = [
        'Look at the last digit of a number.',
        'If it ends in 0, 2, 4, 6 or 8 the number is even. Otherwise it is odd.',
        `Tap each ${rule} and press Check.`,
      ];
      explanation = `Even numbers end in 0, 2, 4, 6 or 8. Odd numbers end in 1, 3, 5, 7 or 9.`;
    } else if (band === 2) {
      const k = g === 4 ? rng.pick([3, 4, 5]) : rng.pick([6, 7, 8, 9]);
      isTarget = (n) => n % k === 0;
      targets = rng.distinctInts(3, 2, 10).map((m) => m * k);
      others = rng.distinctInts(90, 5, 95).filter((n) => !isTarget(n)).slice(0, 5);
      rule = `multiple of ${k}`;
      kindTitle = `Multiples of ${k}`;
      hints = [
        `A multiple of ${k} is a number you say when you skip-count by ${k}.`,
        `Try dividing each number by ${k}. Multiples leave nothing over.`,
      ];
      walkthrough = [
        `Skip-count by ${k} in your head.`,
        'Each number you say on the way is a multiple.',
        'Tap the numbers you said and press Check.',
      ];
      explanation = `Multiples of ${k} are the numbers in the ${k} times table.`;
    } else {
      isTarget = (n) => PRIMES.includes(n);
      targets = rng.sample(PRIMES, rng.int(3, 4));
      others = rng.sample(COMPOSITES, 4);
      rule = 'prime number';
      kindTitle = 'Prime Number Hunt';
      hints = [
        'A prime number has exactly two factors: one and itself.',
        'Test each number: can it be divided evenly by 2, 3, 5 or 7 (other than by itself)?',
      ];
      walkthrough = [
        'Take one number at a time.',
        'Try dividing it by small numbers such as 2, 3, 5 and 7.',
        'If nothing divides it evenly except 1 and itself, it is prime: tap it.',
      ];
      explanation = 'Prime numbers can only be divided evenly by 1 and by themselves.';
    }
    const numbers = rng.shuffle([...targets, ...others]);
    const positions = gridPositions(numbers.length);
    numbers.forEach((n, i) => {
      const id = `n${n}`;
      if (isTarget(n)) targetIds.push(id);
      objects.push(
        textObject(id, String(n), positions[i].x, positions[i].y, 13, TEXT_COLORS[i % TEXT_COLORS.length], {
          tappable: true,
          z: 2,
          anim: { kind: 'float', duration: 3 + (i % 3), delay: Number((i * 0.2).toFixed(1)) },
        }),
      );
    });
    question = `Tap every ${rule}.`;
  }

  objects.push(heroObject(cast, 90, 86));

  return {
    title: `${kindTitle} with ${cast.hero.name}`,
    intro: opener(mode, cast),
    question,
    interaction: { kind: 'tap', targetIds },
    hints,
    walkthrough,
    explanation,
    scene: { theme: cast.scene, objects },
  };
}

// ---------------------------------------------------------------------------
// sort
// ---------------------------------------------------------------------------

const WATER_ANIMALS = [['🐟', 'Fish'], ['🐙', 'Octopus'], ['🐬', 'Dolphin'], ['🦈', 'Shark'], ['🐳', 'Whale'], ['🦑', 'Squid']];
const LAND_ANIMALS = [['🐘', 'Elephant'], ['🦁', 'Lion'], ['🐄', 'Cow'], ['🐎', 'Horse'], ['🐇', 'Rabbit'], ['🦒', 'Giraffe']];
const BELOW_ZERO = ['-2', '-0.5', '-7', '-1.5', '-3/4'];
const ZERO_TO_ONE = ['0.5', '3/4', '0.25', '1/3', '0.9'];
const ABOVE_ONE = ['1.5', '7/4', '3', '2.25', '5/2'];

function sortChallenge(ctx) {
  const { rng, g, cast, mode } = ctx;
  const band = bandOf(g);
  let bins;
  let items;
  let question;
  let hints;
  let walkthrough;
  let explanation;
  let kindTitle;
  let funFact;

  if (band === 0) {
    const water = rng.sample(WATER_ANIMALS, 2);
    const land = rng.sample(LAND_ANIMALS, g === 0 ? 2 : 3);
    bins = [
      { id: 'water', label: 'Lives in water', emoji: '🌊' },
      { id: 'land', label: 'Lives on land', emoji: '🌳' },
    ];
    items = rng.shuffle([
      ...water.map(([emoji, label]) => ({ id: label.toLowerCase(), label, emoji, binId: 'water' })),
      ...land.map(([emoji, label]) => ({ id: label.toLowerCase(), label, emoji, binId: 'land' })),
    ]);
    kindTitle = 'Water or Land';
    question = 'Where does each animal live? Put it in the right home.';
    hints = [
      'Think about where you would see each animal.',
      'Animals with fins or lots of wavy arms live in water. Animals that walk on legs live on land.',
    ];
    walkthrough = [
      'Pick up one animal.',
      'Does it swim under the water all day, or walk on the ground?',
      'Swimmers go in the water home. Walkers go in the land home.',
    ];
    explanation = 'Sea animals live in water. The others walk around on land.';
    funFact = 'An octopus has three hearts.';
  } else if (band === 1) {
    const max = g === 2 ? 20 : 100;
    const pool = rng.distinctInts(max, 1, max);
    const evens = pool.filter((n) => n % 2 === 0).slice(0, 3);
    const odds = pool.filter((n) => n % 2 === 1).slice(0, 3);
    bins = [
      { id: 'even', label: 'Even', emoji: '👯' },
      { id: 'odd', label: 'Odd', emoji: '☝️' },
    ];
    items = rng
      .shuffle([...evens, ...odds])
      .map((n) => ({ id: `n${n}`, label: String(n), binId: n % 2 === 0 ? 'even' : 'odd' }));
    kindTitle = 'Odd or Even';
    question = 'Sort the numbers: which are even and which are odd?';
    hints = [
      'Even numbers can be split into two equal teams.',
      'Look at the last digit of each number.',
    ];
    walkthrough = [
      'Look at the last digit of the number.',
      'If it is 0, 2, 4, 6 or 8, the number is even.',
      'If it is 1, 3, 5, 7 or 9, the number is odd.',
    ];
    explanation = 'A number is even when its last digit is 0, 2, 4, 6 or 8. All other whole numbers are odd.';
  } else if (band === 2) {
    const k = g === 4 ? rng.pick([3, 4, 5]) : rng.pick([6, 7, 8, 9]);
    const multiples = rng.distinctInts(3, 2, 10).map((m) => m * k);
    const others = rng.distinctInts(90, 5, 95).filter((n) => n % k !== 0).slice(0, 3);
    bins = [
      { id: 'yes', label: `Multiple of ${k}`, emoji: '✅' },
      { id: 'no', label: `Not a multiple of ${k}`, emoji: '❌' },
    ];
    items = rng
      .shuffle([...multiples, ...others])
      .map((n) => ({ id: `n${n}`, label: String(n), binId: n % k === 0 ? 'yes' : 'no' }));
    kindTitle = `In the ${k} Times Table?`;
    question = `Sort the numbers: which ones are multiples of ${k}?`;
    hints = [
      `Multiples of ${k} are the answers in the ${k} times table.`,
      `Divide each number by ${k}. If nothing is left over, it is a multiple.`,
    ];
    walkthrough = [
      `Skip-count by ${k} and listen for the number.`,
      'If you say the number, it is a multiple.',
      'If you jump over it, it is not a multiple.',
    ];
    explanation = `A multiple of ${k} can be divided by ${k} with nothing left over.`;
  } else {
    bins = [
      { id: 'below', label: 'Less than 0', emoji: '🧊' },
      { id: 'middle', label: 'Between 0 and 1', emoji: '🌱' },
      { id: 'above', label: 'Greater than 1', emoji: '🚀' },
    ];
    const entries = [
      ...rng.sample(BELOW_ZERO, 2).map((label) => [label, 'below']),
      ...rng.sample(ZERO_TO_ONE, 2).map((label) => [label, 'middle']),
      ...rng.sample(ABOVE_ONE, 2).map((label) => [label, 'above']),
    ];
    items = rng.shuffle(entries).map(([label, binId], index) => ({ id: `v${index + 1}`, label, binId }));
    kindTitle = 'Number Line Zones';
    question = 'Sort each number into its zone on the number line.';
    hints = [
      'Numbers with a minus sign sit to the left of zero.',
      'For a fraction, compare the top number with the bottom number: is the top smaller or bigger?',
    ];
    walkthrough = [
      'A minus sign means the number is less than 0.',
      'A positive fraction with a smaller top than bottom, or a decimal starting with 0, is between 0 and 1.',
      'Everything bigger than 1 goes in the last zone.',
    ];
    explanation = 'Negative numbers are below 0, proper fractions are between 0 and 1, and the rest are above 1.';
  }

  const objects = [heroObject(cast, 86, 80), ...decor(cast, rng)];
  bins.forEach((bin, index) => {
    const xs = spread(bins.length, 22, 70);
    objects.push(
      emojiObject(`sign-${bin.id}`, bin.emoji, xs[index], 46, 18, {
        label: clip(bin.label, 24),
        anim: { kind: 'pulse', duration: 2.6, delay: index * 0.4 },
      }),
    );
  });

  const out = {
    title: `${kindTitle} with ${cast.hero.name}`,
    intro: opener(mode, cast),
    question,
    interaction: { kind: 'sort', bins, items },
    hints,
    walkthrough,
    explanation,
    scene: { theme: cast.scene, objects },
  };
  if (funFact) out.funFact = funFact;
  return out;
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

const FRACTION_PERCENT = [
  ['1/2', '50%'],
  ['1/4', '25%'],
  ['3/4', '75%'],
  ['1/5', '20%'],
  ['1/10', '10%'],
  ['2/5', '40%'],
  ['3/5', '60%'],
  ['1/20', '5%'],
];

/** `count` pairs [a, b] with different results of `combine(a, b)`. */
function distinctResultPairs(rng, count, min, max, combine) {
  const results = new Set();
  const pairs = [];
  for (let guard = 0; pairs.length < count && guard < 400; guard += 1) {
    const a = rng.int(min, max);
    const b = rng.int(min, max);
    const result = combine(a, b);
    if (results.has(result)) continue;
    results.add(result);
    pairs.push([a, b, result]);
  }
  return pairs;
}

function matchChallenge(ctx) {
  const { rng, g, cast, mode } = ctx;
  const band = bandOf(g);
  let pairs;
  let question;
  let hints;
  let walkthrough;
  let explanation;
  let kindTitle;

  if (band === 0) {
    const counts = rng.distinctInts(g === 0 ? 3 : 4, 1, g === 0 ? 4 : 6);
    pairs = counts.map((n) => ({
      id: `count${n}`,
      left: { label: cast.item.emoji.repeat(n) },
      right: { label: String(n) },
    }));
    kindTitle = 'Count and Match';
    question = `Match each group of ${cast.item.many} to its number.`;
    hints = ['Count the pictures in one group slowly.', 'Touch each picture once while you count, then find that number.'];
    walkthrough = [
      'Pick one group of pictures.',
      'Touch and count each picture once.',
      'Find the number you said last and connect them.',
    ];
    explanation = 'The last number you say when you count tells you how many there are.';
  } else if (band === 1) {
    const max = g === 2 ? 10 : 45;
    const sums = distinctResultPairs(rng, 4, g === 2 ? 1 : 11, max, (a, b) => a + b);
    pairs = sums.map(([a, b, sum]) => ({ id: `sum${sum}`, left: { label: `${a} + ${b}` }, right: { label: String(sum) } }));
    kindTitle = 'Sum Match';
    question = 'Match each addition to its answer.';
    hints = ['Work out one addition at a time.', 'Start with the bigger number and count on, or add the tens first.'];
    walkthrough = ['Choose one addition.', 'Add the two numbers.', 'Connect it to the card that shows your answer.'];
    explanation = 'Each addition has exactly one sum, so every card has one partner.';
  } else if (band === 2) {
    const products = distinctResultPairs(rng, g === 4 ? 4 : 5, 2, g === 4 ? 6 : 9, (a, b) => a * b);
    pairs = products.map(([a, b, product]) => ({
      id: `product${product}`,
      left: { label: `${a} × ${b}` },
      right: { label: String(product) },
    }));
    kindTitle = 'Times Table Match';
    question = 'Match each multiplication to its answer.';
    hints = ['Work out one multiplication at a time.', 'Use skip-counting, or turn the fact around: the order of the numbers does not matter.'];
    walkthrough = ['Choose one multiplication.', 'Skip-count to find the product.', 'Connect it to the card with that product.'];
    explanation = 'Multiplying gives the total of equal groups.';
  } else {
    const chosen = rng.sample(FRACTION_PERCENT, g === 7 ? 4 : 5);
    pairs = chosen.map(([fraction, percent], index) => ({
      id: `pair${index + 1}`,
      left: { label: fraction },
      right: { label: percent },
    }));
    kindTitle = 'Fraction and Percent Match';
    question = 'Match each fraction to the percent that means the same amount.';
    hints = [
      'Percent means "out of one hundred".',
      'Change each fraction so that its bottom number is one hundred, then read the top number.',
    ];
    walkthrough = [
      'Pick a fraction.',
      'Multiply top and bottom by the same number so the bottom becomes 100.',
      'The new top number is the percent.',
    ];
    explanation = 'A percent is a fraction with 100 on the bottom.';
  }

  const objects = [
    heroObject(cast, 50, 62),
    emojiObject('link', '🔗', 50, 30, 14, { anim: { kind: 'spin', duration: 9 } }),
    ...emojiRow('item', cast.item.emoji, 3, { from: 20, to: 80, y: 86, size: 9 }),
    ...decor(cast, rng),
  ];

  return {
    title: `${kindTitle} with ${cast.hero.name}`,
    intro: opener(mode, cast),
    question,
    interaction: { kind: 'match', pairs: rng.shuffle(pairs) },
    hints,
    walkthrough,
    explanation,
    scene: { theme: cast.scene, objects },
  };
}

// ---------------------------------------------------------------------------
// order
// ---------------------------------------------------------------------------

const MIXED_NUMBERS = [
  ['-3', -3],
  ['-1.5', -1.5],
  ['-1/2', -0.5],
  ['0', 0],
  ['1/4', 0.25],
  ['0.3', 0.3],
  ['2/3', 2 / 3],
  ['0.75', 0.75],
  ['1.2', 1.2],
  ['3/2', 1.5],
  ['2', 2],
];

function orderChallenge(ctx) {
  const { rng, g, cast, mode } = ctx;
  const band = bandOf(g);
  let entries; // [label, value]
  let hints;
  let walkthrough;
  let explanation;

  if (band === 0) {
    entries = rng.distinctInts(3, 1, g === 0 ? 5 : 10).map((n) => [String(n), n]);
    hints = ['Which number would you say first when you count?', 'Count out loud from one and listen for each number.'];
    walkthrough = ['Count out loud from one.', 'The number you reach first is the smallest.', 'Keep counting to find the next one, then the biggest.'];
    explanation = 'When you count, smaller numbers come before bigger numbers.';
  } else if (band === 1) {
    entries = rng.distinctInts(4, 1, g === 2 ? 20 : 100).map((n) => [String(n), n]);
    hints = ['Look at the tens first.', 'A number with more tens is bigger. If the tens match, compare the ones.'];
    walkthrough = ['Compare the tens digits.', 'If two numbers have the same tens, compare their ones.', 'Line them up from the smallest to the biggest.'];
    explanation = 'Compare tens first and then ones to see which number is bigger.';
  } else if (band === 2) {
    if (g === 4) {
      entries = rng.distinctInts(5, 100, 999).map((n) => [String(n), n]);
      hints = ['Start with the hundreds digit.', 'If the hundreds are the same, compare the tens, then the ones.'];
      walkthrough = ['Compare the hundreds digits.', 'For a tie, compare the tens, then the ones.', 'Line them up from the smallest to the biggest.'];
      explanation = 'Compare the biggest place value first: hundreds, then tens, then ones.';
    } else {
      entries = rng.distinctInts(5, 5, 250).map((n) => [String(n / 100), n / 100]);
      hints = ['Compare the whole-number part first.', 'Then compare the tenths, and after that the hundredths. You can add a zero at the end to line them up.'];
      walkthrough = ['Compare the digits before the decimal point.', 'For a tie, compare the tenths digit.', 'Still a tie? Compare the hundredths digit.'];
      explanation = 'Decimals are compared place by place, starting from the left.';
    }
  } else {
    entries = rng.sample(MIXED_NUMBERS, 5);
    hints = ['Negative numbers are smaller than zero, and zero is smaller than every positive number.', 'Turn the fractions into decimals so everything can be compared the same way.'];
    walkthrough = ['Put the negative numbers first: the one furthest from zero is the smallest.', 'Change each fraction into a decimal.', 'Line up the positive numbers from the smallest decimal to the biggest.'];
    explanation = 'On a number line, numbers get bigger from left to right, starting with the negatives.';
  }

  entries.sort((a, b) => a[1] - b[1]);
  const items = entries.map(([label], index) => ({ id: `item${index + 1}`, label }));
  const xs = spread(items.length, 14, 76);
  const shown = rng.shuffle(entries.map(([label]) => label));
  const objects = [
    ...shown.map((label, index) =>
      textObject(`card${index + 1}`, label, xs[index], 40, 11, TEXT_COLORS[index % TEXT_COLORS.length], {
        anim: { kind: 'float', duration: 3, delay: Number((index * 0.25).toFixed(2)) },
      }),
    ),
    emojiObject('arrow', '➡️', 46, 66, 14, { anim: { kind: 'move', duration: 3, toX: 60, toY: 66 } }),
    heroObject(cast),
    ...decor(cast, rng),
  ];

  return {
    title: `Number Line-Up with ${cast.hero.name}`,
    intro: opener(mode, cast),
    question: 'Put the numbers in order from the smallest to the biggest.',
    interaction: { kind: 'order', items, startLabel: 'smallest', endLabel: 'biggest' },
    hints,
    walkthrough,
    explanation,
    scene: { theme: cast.scene, objects },
  };
}

// ---------------------------------------------------------------------------
// number
// ---------------------------------------------------------------------------

function numberChallenge(ctx) {
  const { rng, g, cast, mode } = ctx;
  const item = cast.item;
  let answer;
  let question;
  let hints;
  let walkthrough;
  let explanation;
  let kindTitle;
  let unit;
  const objects = [];

  if (g <= 1) {
    answer = rng.int(2, g === 0 ? 5 : 10);
    kindTitle = 'Count Them';
    question = `How many ${item.many} can you count?`;
    unit = item.many;
    hints = ['Touch each one as you count it.', 'Count slowly from the left to the right, and count each one only once.'];
    walkthrough = ['Start on the left.', 'Touch each one and say the next number.', `The last number you say is ${answer}.`];
    explanation = `There are ${answer} ${item.many}. The last number you say is how many there are.`;
    objects.push(...emojiRow('count', item.emoji, answer, { from: 14, to: 74, y: 36, size: 12 }));
  } else if (g <= 3) {
    const limit = g === 2 ? 20 : 100;
    const a = rng.int(Math.floor(limit / 4), Math.floor(limit / 2));
    const b = rng.int(2, Math.floor(limit / 2));
    answer = a + b;
    kindTitle = 'Total Count';
    question = `${cast.hero.name} packed ${a} ${item.many} in the morning and ${b} in the afternoon. How many is that altogether?`;
    unit = item.many;
    hints = ['Altogether means you add the two numbers.', 'Add the tens first, then the ones, and put them together.'];
    walkthrough = [`Start with ${a}.`, `Add ${b}.`, `${a} + ${b} = ${answer}.`];
    explanation = `${a} and ${b} make ${answer} altogether.`;
    objects.push(textObject('expr', `${a} + ${b}`, 46, 36, 14, '#3b2ea0', { anim: { kind: 'grow', duration: 0.8, loop: false } }));
  } else if (g <= 5) {
    const a = g === 4 ? rng.int(2, 9) : rng.int(11, 25);
    const b = rng.int(2, 9);
    answer = a * b;
    kindTitle = 'How Many in All';
    question = `Each shelf holds ${b} ${item.many}. There are ${a} shelves. How many ${item.many} fit in all?`;
    unit = item.many;
    hints = ['Equal groups mean you can multiply.', 'Break the bigger number into tens and ones, multiply each part, then add the parts.'];
    walkthrough = [`There are ${a} equal groups of ${b}.`, `Multiply: ${a} × ${b}.`, `${a} × ${b} = ${answer}.`];
    explanation = `${a} shelves with ${b} each hold ${answer} ${item.many}.`;
    objects.push(textObject('expr', `${a} × ${b}`, 46, 36, 14, '#3b2ea0', { anim: { kind: 'grow', duration: 0.8, loop: false } }));
  } else if (g === 6) {
    const w = rng.int(3, 12);
    const h = rng.int(3, 12);
    answer = w * h;
    kindTitle = 'Area Plan';
    question = `${cast.hero.name} is laying a floor that is ${w} m long and ${h} m wide. What is its area?`;
    unit = 'square m';
    hints = ['Area is the space inside a flat shape.', 'For a rectangle, multiply the length by the width.'];
    walkthrough = ['The floor is a rectangle.', `Area = length × width = ${w} × ${h}.`, `${w} × ${h} = ${answer} square metres.`];
    explanation = `A ${w} m by ${h} m rectangle covers ${answer} square metres.`;
    objects.push(
      { id: 'floor', type: 'shape', shape: 'rect', color: '#ffd54a', x: 44, y: 44, size: 40, z: 0, opacity: 0.9 },
      textObject('len', `${w} m`, 44, 20, 9, '#3b2ea0'),
      textObject('wid', `${h} m`, 78, 44, 9, '#3b2ea0'),
    );
  } else if (g === 7) {
    const percent = rng.pick([10, 20, 25, 50, 75]);
    const whole = rng.int(2, 12) * 20;
    answer = (percent * whole) / 100;
    kindTitle = 'Percent Check';
    question = `A crate holds ${whole} ${item.many}. ${percent}% of them are already sorted. How many are sorted?`;
    unit = item.many;
    hints = ['Percent means "out of one hundred".', 'Find one percent of the total first, then scale it up.'];
    walkthrough = [`${percent}% means ${percent} out of every 100.`, `Work out ${whole} ÷ 100 × ${percent}.`, `That gives ${answer}.`];
    explanation = `${percent}% of ${whole} is ${answer}.`;
    objects.push(textObject('expr', `${percent}% of ${whole}`, 46, 36, 12, '#3b2ea0'));
  } else if (g === 8) {
    const mean = rng.int(6, 30);
    const d1 = rng.int(1, 5);
    const d2 = rng.int(1, 5);
    const values = rng.shuffle([mean - d1, mean + d1, mean - d2, mean + d2]);
    answer = mean;
    kindTitle = 'Find the Mean';
    question = `${cast.hero.name} measured four plants: ${values.join(' cm, ')} cm. What is the mean height?`;
    unit = 'cm';
    hints = ['The mean is the fair share if all heights were made equal.', 'Add all four heights, then divide the total by how many plants there are.'];
    walkthrough = [`Add the heights: the total is ${mean * 4}.`, 'There are 4 plants, so divide the total by 4.', `${mean * 4} ÷ 4 = ${answer}.`];
    explanation = `The four heights add up to ${mean * 4}, and ${mean * 4} ÷ 4 = ${answer}.`;
    objects.push(...emojiRow('plant', '🌱', 4, { from: 18, to: 72, y: 40, size: 14 }));
  } else {
    const x = rng.int(2, 12);
    const a = rng.int(2, 9);
    const b = rng.int(1, 20);
    const c = a * x + b;
    answer = x;
    kindTitle = 'Solve for x';
    question = `Solve the equation ${a} × x + ${b} = ${c}. What is x?`;
    hints = ['Undo the steps in reverse order.', 'Take away the added number from both sides first, then divide both sides.'];
    walkthrough = [`Start with ${a} × x + ${b} = ${c}.`, `Subtract ${b} from both sides: ${a} × x = ${c - b}.`, `Divide both sides by ${a}: x = ${x}.`];
    explanation = `x = ${x}, because ${a} × ${x} + ${b} = ${c}.`;
    objects.push(textObject('expr', `${a} × x + ${b} = ${c}`, 46, 36, 10, '#3b2ea0'));
  }

  objects.push(heroObject(cast), ...decor(cast, rng));
  const interaction = { kind: 'number', answer, tolerance: 0, allowDecimal: false, allowNegative: false };
  if (unit) interaction.unit = clip(unit, 16);

  return {
    title: `${kindTitle} with ${cast.hero.name}`,
    intro: opener(mode, cast),
    question,
    interaction,
    hints: hintsWithoutAnswer(hints, answer, [
      'Read the question once more and decide what you need to find.',
      'Work it out in small steps and check each step.',
    ]),
    walkthrough,
    explanation,
    scene: { theme: cast.scene, objects },
  };
}

// ---------------------------------------------------------------------------
// robot
// ---------------------------------------------------------------------------

const DIRS = ['up', 'right', 'down', 'left'];
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/**
 * Shortest program of plain moves (only those in `interaction.allowed`) that
 * collects every gem and ends on the goal, or null when there is none.
 */
export function solveRobotPlain(interaction) {
  const { cols, rows, start, goal } = interaction;
  const walls = new Set((interaction.walls ?? []).map((w) => `${w.x},${w.y}`));
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  if (!inside(start.x, start.y) || !inside(goal.x, goal.y)) return null;
  if (walls.has(`${start.x},${start.y}`) || walls.has(`${goal.x},${goal.y}`)) return null;

  const gemBit = new Map();
  for (const gem of interaction.gems ?? []) {
    const key = `${gem.x},${gem.y}`;
    if (!inside(gem.x, gem.y) || walls.has(key)) return null;
    if (!gemBit.has(key)) gemBit.set(key, gemBit.size);
  }
  const fullMask = (1 << gemBit.size) - 1;
  const allowed = new Set(interaction.allowed);
  const encode = (x, y, dir, mask) => ((y * cols + x) * 4 + dir) * (fullMask + 1) + mask;

  const startBit = gemBit.get(`${start.x},${start.y}`);
  const first = { x: start.x, y: start.y, dir: DIRS.indexOf(start.dir), mask: startBit === undefined ? 0 : 1 << startBit };
  const cameFrom = new Map([[encode(first.x, first.y, first.dir, first.mask), null]]);
  const queue = [first];

  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head];
    const stateKey = encode(state.x, state.y, state.dir, state.mask);
    if (state.x === goal.x && state.y === goal.y && state.mask === fullMask) {
      const moves = [];
      let cursor = stateKey;
      for (let link = cameFrom.get(cursor); link; link = cameFrom.get(cursor)) {
        moves.push(link.move);
        cursor = link.from;
      }
      return moves.reverse();
    }
    const visit = (next, move) => {
      const key = encode(next.x, next.y, next.dir, next.mask);
      if (cameFrom.has(key)) return;
      cameFrom.set(key, { from: stateKey, move });
      queue.push(next);
    };
    if (allowed.has('forward')) {
      const nx = state.x + DX[state.dir];
      const ny = state.y + DY[state.dir];
      if (inside(nx, ny) && !walls.has(`${nx},${ny}`)) {
        const bit = gemBit.get(`${nx},${ny}`);
        visit({ x: nx, y: ny, dir: state.dir, mask: bit === undefined ? state.mask : state.mask | (1 << bit) }, 'forward');
      }
    }
    if (allowed.has('left')) visit({ ...state, dir: (state.dir + 3) % 4 }, 'left');
    if (allowed.has('right')) visit({ ...state, dir: (state.dir + 1) % 4 }, 'right');
  }
  return null;
}

/** "forward, forward, left" -> ["Go forward 2 squares", "Turn left"]. */
function describeMoves(moves) {
  const phrases = [];
  for (let i = 0; i < moves.length; ) {
    let run = 1;
    while (moves[i + run] === moves[i]) run += 1;
    if (moves[i] === 'forward') phrases.push(`go forward ${run} ${run === 1 ? 'square' : 'squares'}`);
    else phrases.push(run === 1 ? `turn ${moves[i]}` : `turn ${moves[i]} ${run} times`);
    i += run;
  }
  return phrases;
}

/** Packs any number of phrases into 2..6 short walkthrough sentences. */
function phrasesToSteps(phrases) {
  const perStep = Math.max(1, Math.ceil(phrases.length / 5));
  const steps = [];
  for (let i = 0; i < phrases.length; i += perStep) {
    steps.push(clip(`${capitalize(phrases.slice(i, i + perStep).join(', then '))}.`, 240));
  }
  steps.push('Press Run and watch the robot reach the goal.');
  return steps.slice(0, 6);
}

function robotInteraction(rng, g) {
  if (g === 0) {
    // Pre-K: one straight line, forward blocks only.
    const cols = rng.int(3, 4);
    const rows = 3;
    const y = rng.int(0, rows - 1);
    return {
      kind: 'robot',
      cols,
      rows,
      start: { x: 0, y, dir: 'right' },
      goal: { x: cols - 1, y },
      walls: [],
      gems: [],
      allowed: ['forward'],
      maxCommands: cols + 1,
    };
  }
  const size = g === 1 ? 4 : g <= 3 ? rng.int(4, 5) : g <= 6 ? rng.int(5, 6) : rng.int(6, 7);
  const wallRange = g === 1 ? [0, 0] : g <= 3 ? [2, 3] : g <= 6 ? [4, 6] : [6, 9];
  const gemCount = g <= 1 ? 0 : g <= 6 ? 1 : 2;
  const allowed = g <= 3 ? ['forward', 'left', 'right'] : ['forward', 'left', 'right', 'repeat'];
  const minMoves = g === 1 ? 3 : 4;
  const maxMoves = g <= 3 ? 9 : g <= 6 ? 13 : 18;
  const slack = g <= 3 ? 3 : 2;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const cells = [];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) cells.push({ x, y });
    const shuffled = rng.shuffle(cells);
    const start = shuffled[0];
    const goalIndex = shuffled.findIndex(
      (c, index) => index > 0 && Math.abs(c.x - start.x) + Math.abs(c.y - start.y) >= Math.min(size - 1, 3),
    );
    if (goalIndex === -1) continue;
    const goal = shuffled[goalIndex];
    const free = shuffled.filter((_, index) => index !== 0 && index !== goalIndex);
    const gems = free.slice(0, gemCount);
    const walls = free.slice(gemCount, gemCount + rng.int(wallRange[0], wallRange[1]));
    const interaction = {
      kind: 'robot',
      cols: size,
      rows: size,
      start: { ...start, dir: rng.pick(DIRS) },
      goal,
      walls,
      gems,
      allowed,
      maxCommands: 24,
    };
    const moves = solveRobotPlain(interaction);
    if (!moves || moves.length < minMoves || moves.length > maxMoves) continue;
    interaction.maxCommands = Math.min(24, moves.length + slack);
    return interaction;
  }
  // Always-solvable fallback: an open grid with one turn.
  return {
    kind: 'robot',
    cols: size,
    rows: size,
    start: { x: 0, y: size - 1, dir: 'right' },
    goal: { x: size - 1, y: 0 },
    walls: [],
    gems: [],
    allowed,
    maxCommands: 2 * size + 2,
  };
}

function robotChallenge(ctx) {
  const { rng, g, cast, mode } = ctx;
  const interaction = { ...robotInteraction(rng, g), robotEmoji: '🤖', goalEmoji: rng.pick(['🏁', '🏠', '🔋', '⭐']) };
  const moves = solveRobotPlain(interaction) ?? [];
  const gemCount = interaction.gems.length;
  const gemText = gemCount === 0 ? '' : gemCount === 1 ? ' Collect the gem on the way.' : ' Collect every gem on the way.';
  const usesRepeat = interaction.allowed.includes('repeat');

  return {
    title: `Robot Route with ${cast.hero.name}`,
    intro: mode === 'robot' ? `The little robot is lost in ${cast.place}. ${cast.hero.name} asks you to write its program.` : opener(mode, cast),
    question: `Build a program that drives the robot to the goal without bumping into anything.${gemText}`,
    interaction,
    hints: [
      'Look at which way the robot is facing before it moves.',
      usesRepeat
        ? 'Trace the path with your finger first. If the same blocks come several times in a row, a repeat block saves space.'
        : 'Trace the path with your finger first and count the squares before each turn.',
    ],
    walkthrough: phrasesToSteps(describeMoves(moves)),
    explanation: 'A program is a list of steps in the right order. The robot follows them exactly, one after the other.',
    funFact: 'The first robots that explored Mars got their driving steps as a list of commands, a bit like this.',
    scene: {
      theme: cast.scene,
      objects: [
        emojiObject('bot', '🤖', 14, 78, 16, { anim: { kind: 'wiggle', duration: 1.8 } }),
        emojiObject('flag', interaction.goalEmoji, 84, 22, 14, { anim: { kind: 'pulse', duration: 2 } }),
        heroObject(cast, 86, 80),
        ...decor(cast, rng),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

const BUILD_KITS = [
  {
    key: 'rocket',
    match: /space|rocket|planet|star|moon/i,
    goal: (target) => `a rocket with at least ${target} thrust`,
    powerLabel: 'thrust',
    parts: [['🔥', 'Big engine'], ['🚀', 'Booster'], ['🛢️', 'Fuel tank'], ['🪽', 'Wings'], ['🎈', 'Balloon'], ['🌀', 'Fan'], ['🔋', 'Battery pack'], ['🧲', 'Magnet drive']],
  },
  {
    key: 'bridge',
    match: /bridge|river|castle|city|car|train/i,
    goal: (target) => `a bridge with at least ${target} strength`,
    powerLabel: 'strength',
    parts: [['🪵', 'Log beam'], ['🧱', 'Brick pillar'], ['🪢', 'Rope'], ['🔩', 'Steel bolts'], ['🪨', 'Stone block'], ['🎋', 'Bamboo pole'], ['⛓️', 'Chain'], ['📏', 'Plank']],
  },
  {
    key: 'helper',
    match: /robot|machine|computer|game|tech/i,
    goal: (target) => `a helper robot with at least ${target} energy`,
    powerLabel: 'energy',
    parts: [['🔋', 'Battery'], ['☀️', 'Solar panel'], ['⚙️', 'Gear box'], ['💡', 'Lamp'], ['🦾', 'Strong arm'], ['🛞', 'Wheels'], ['📡', 'Antenna'], ['🧠', 'Smart chip']],
  },
];

function buildChallenge(ctx) {
  const { rng, g, cast, mode, theme, seq } = ctx;
  const kit = BUILD_KITS.find((k) => theme && k.match.test(theme)) ?? BUILD_KITS[seq % BUILD_KITS.length];
  const partCount = g <= 1 ? 3 : g <= 3 ? 4 : g <= 6 ? 5 : 6;
  const scale = g <= 3 ? 1 : g <= 6 ? 5 : 10;
  const maxUnit = g <= 1 ? 4 : 9;
  const chosenSize = g <= 3 ? 2 : 3;

  const parts = rng.sample(kit.parts, partCount).map(([emoji, label], index) => ({
    id: `part${index + 1}`,
    label,
    emoji,
    power: rng.int(1, maxUnit) * scale,
    cost: rng.int(1, maxUnit) * scale,
  }));
  // The intended answer is a proper subset, so "pick everything" always breaks the budget.
  const chosen = rng.sample(parts, chosenSize);
  const target = chosen.reduce((sum, p) => sum + p.power, 0);
  const budget = chosen.reduce((sum, p) => sum + p.cost, 0);
  const names = chosen.map((p) => p.label);
  const xs = spread(parts.length, 12, 76);

  return {
    title: `${capitalize(kit.key)} Workshop with ${cast.hero.name}`,
    intro: mode === 'invention' ? `${cast.hero.name} is inventing in ${cast.place} and needs a clever builder.` : opener(mode, cast),
    question: `Pick parts to build ${kit.goal(target)}. You may spend up to ${budget} coins.`,
    interaction: {
      kind: 'build',
      goalLabel: kit.goal(target),
      powerLabel: kit.powerLabel,
      costLabel: 'coins',
      target,
      budget,
      parts,
    },
    hints: [
      'You do not need every part. Keep an eye on the coins.',
      `Look for parts that give a lot of ${kit.powerLabel} for only a few coins.`,
    ],
    walkthrough: [
      `You need at least ${target} ${kit.powerLabel} and may spend ${budget} coins.`,
      `Try these parts: ${names.join(', ')}.`,
      `Together they give ${target} ${kit.powerLabel} and cost ${budget} coins.`,
      'That reaches the goal without going over the budget.',
    ],
    explanation: `Engineers trade off what a part gives against what it costs. ${names.join(' + ')} reach the goal inside the budget.`,
    teachBack: {
      prompt: 'Can you teach Pip why you did not just pick every part?',
      options: rng.shuffle([
        { id: 'budget', label: 'Because all the parts together cost more coins than we have.', correct: true },
        { id: 'colour', label: 'Because some parts are the wrong colour.', correct: false },
      ]),
    },
    scene: {
      theme: cast.scene === 'plain' ? 'workshop' : cast.scene,
      objects: [
        ...parts.map((part, index) =>
          emojiObject(part.id, part.emoji, xs[index], 44, 13, {
            label: clip(part.label, 24),
            anim: { kind: 'bounce', duration: 2.4, delay: Number((index * 0.2).toFixed(1)) },
          }),
        ),
        emojiObject('coins', '🪙', 14, 82, 12, { label: `${budget} coins`, anim: { kind: 'pulse', duration: 2 } }),
        heroObject(cast),
        ...decor(cast, rng),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Public generators
// ---------------------------------------------------------------------------

const CHALLENGE_BUILDERS = {
  choice: choiceChallenge,
  tap: tapChallenge,
  sort: sortChallenge,
  match: matchChallenge,
  order: orderChallenge,
  number: numberChallenge,
  robot: robotChallenge,
  build: buildChallenge,
};

/**
 * A complete Challenge (see ChallengeSchema) of the requested interaction kind.
 * Unknown kinds fall back to `choice`, unknown grades to Grade 2, unknown modes to `quest`.
 */
export function makeChallenge({ kind, grade, mode, theme, seq = 0 } = {}) {
  const safeKind = INTERACTION_KINDS.includes(kind) ? kind : 'choice';
  const safeMode = MODES.includes(mode) ? mode : 'quest';
  const g = gradeIndexOf(grade);
  const cleanedTheme = cleanTheme(theme);
  const rng = makeRng(hashString(`${safeKind}|${g}|${safeMode}|${cleanedTheme}|${seq}`));
  const cast = pickCast(cleanedTheme, seq);
  const draft = CHALLENGE_BUILDERS[safeKind]({ rng, g, cast, mode: safeMode, theme: cleanedTheme, seq });

  const challenge = {
    title: clip(draft.title, 60),
    intro: clip(draft.intro, 400),
    question: clip(draft.question, 300),
    readAloud: clip(toSpeech(`${draft.intro} ${draft.question}`), 700),
    interaction: draft.interaction,
    hints: [clip(draft.hints[0], 240), clip(draft.hints[1], 300)],
    walkthrough: draft.walkthrough.slice(0, 6).map((step) => clip(step, 240)),
    explanation: clip(draft.explanation, 400),
    scene: draft.scene,
  };
  if (draft.teachBack) challenge.teachBack = draft.teachBack;
  if (draft.funFact) challenge.funFact = clip(draft.funFact, 240);
  return challenge;
}

const TUTOR_LINES = {
  nudge: ['Take another look at the picture. What do you notice first?', 'You are close. Read the question once more, slowly.'],
  hint: ['Try breaking it into smaller steps. What could the first step be?', 'Think about what you already know that could help here.'],
  'walkthrough-step': ['Let us do this step together. Watch closely, then you try the next one.', 'Here is the next small step. You are doing the thinking, I am just pointing the way.'],
  'wrong-answer': ['Good try! That is not it yet. What could you check again?', 'Not quite, and that is okay. Mistakes help our brains grow. Try once more.'],
  chat: ['That is a great question! Let us use it to solve this challenge.', 'I like how you are thinking. What does the challenge ask us to find?'],
  praise: ['You did it! I love how you kept going.', 'Brilliant thinking! You solved it yourself.'],
  'teachback-feedback': ['Thank you for teaching me! Now I understand it too.', 'What a clear explanation. You are a great teacher.'],
};

/** TutorReply output. `redirected` is true only when the conversation contains the literal word REDIRECTME. */
export function makeTutorReply({ intent, seq = 0, redirect = false } = {}) {
  if (redirect) {
    return {
      say: 'That is fun to think about! Right now, let us get back to our challenge.',
      highlightIds: [],
      redirected: true,
    };
  }
  const lines = TUTOR_LINES[intent] ?? TUTOR_LINES.nudge;
  return { say: lines[seq % lines.length], highlightIds: [], redirected: false };
}

const STORY_BEATS = [
  ['A Strange Signal', (c) => `${c.hero.name} was tidying up in ${c.place} when something began to blink. It was a map, and the first part was locked with a puzzle. "I cannot open it alone," said ${c.hero.name}.`, (c) => `${c.hero.name} holding a glowing map in ${c.place}`],
  ['The Wobbly Path', (c) => `The map led to a wobbly path covered in ${c.item.many}. To cross safely, ${c.hero.name} had to work out the pattern. One wrong step and the path would shake!`, (c) => `A winding path dotted with ${c.item.many}`],
  ['The Sleepy Guard', (c) => `At the end of the path sat a sleepy guard. "Answer my riddle and you may pass," it yawned. ${c.hero.name} took a deep breath and looked at the riddle.`, (c) => `A friendly, sleepy guard beside a small gate`],
  ['The Locked Door', (c) => `Behind the gate stood a tall door with a number lock. The clues were scratched into the wall next to a pile of ${c.item.many}. ${c.hero.name} needed the right number.`, (c) => `A tall door with a number lock and clues on the wall`],
  ['The Last Step', (c) => `The door creaked open. Inside, the treasure sat on a shelf that was just too high. ${c.hero.name} had to figure out one final problem to reach it.`, (c) => `A bright room with a treasure chest on a high shelf`],
];

/** StoryOutline output with 2 to 5 chapters. */
export function makeStory({ theme, chapters = 3, seq = 0 } = {}) {
  const wanted = Number.isFinite(Number(chapters)) ? Math.round(Number(chapters)) : 3;
  const count = Math.max(2, Math.min(5, wanted));
  const cleaned = cleanTheme(theme);
  const cast = pickCast(cleaned, seq);
  // Keep the opening and the finale, and fill the middle in order.
  const picked = count === 5 ? STORY_BEATS : [...STORY_BEATS.slice(0, count - 1), STORY_BEATS[STORY_BEATS.length - 1]];
  return {
    title: clip(`${cast.hero.name} and the ${cleaned ? `${capitalize(cleaned)} ` : ''}Mystery Map`, 80),
    chapters: picked.map(([heading, narrative, illustration]) => ({
      heading,
      narrative: clip(narrative(cast), 700),
      illustration: clip(illustration(cast), 200),
    })),
    ending: clip(
      `With every puzzle solved, ${cast.hero.name} opened the treasure. Inside were ${cast.item.many} for everyone in ${cast.place}, and a note: "Thank you for thinking so carefully."`,
      500,
    ),
  };
}

/** LearnerNotes output. */
export function makeNotes() {
  return {
    summary:
      'The learner is working steadily and solves most items without help. They do best with hands-on formats and sometimes rush multi-step questions.',
    strengths: ['Counting and comparing quantities', 'Sticking with a problem after a wrong try'],
    struggles: ['Multi-step questions when read quickly'],
    nextFocus: ['Explaining the answer in their own words', 'One more round of mixed review'],
  };
}

/** WeeklyReport output. */
export function makeReport() {
  return {
    headline: 'A steady week of curious problem solving.',
    highlights: [
      'Solved most challenges independently.',
      'Kept trying after wrong answers instead of giving up.',
    ],
    struggles: ['Needed hints on a few multi-step questions.'],
    homeActivities: [
      'Count and sort the cutlery together while setting the table.',
      'Go on a shape hunt around the home and name each shape you find.',
    ],
  };
}

/** SafetyVerdict output. Unsafe only when the checked text contains the literal word FLAGME. */
export function makeSafetyVerdict(flagged = false) {
  return flagged ? { safe: false, reason: 'The mock flag word was found.' } : { safe: true, reason: '' };
}
