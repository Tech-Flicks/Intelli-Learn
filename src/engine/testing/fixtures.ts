/** Test helpers shared by the engine's unit tests. Not exported from the module root. */
import { ChallengeSchema, type Challenge } from '@/core/schemas';

const BASE = {
  title: 'Test challenge',
  intro: 'A friendly robot needs your help.',
  question: 'What should we do?',
  readAloud: 'A friendly robot needs your help. What should we do?',
  hints: ['Look closely at the picture.', 'Try counting each one slowly.'],
  walkthrough: ['Look at the first one.', 'Then look at the next one.'],
  explanation: 'That works because we checked each one.',
  scene: { theme: 'plain', objects: [] },
};

/** Builds a schema-valid challenge around the given interaction (and optional overrides). */
export function makeChallenge(interaction: unknown, overrides: Record<string, unknown> = {}): Challenge {
  return ChallengeSchema.parse({ ...BASE, ...overrides, interaction });
}

export const CHOICE = {
  kind: 'choice',
  options: [
    { id: 'a', label: 'Three', emoji: '3️⃣', misconception: 'You missed one.' },
    { id: 'b', label: 'Four', emoji: '4️⃣' },
    { id: 'c', label: 'Five', emoji: '5️⃣' },
  ],
  correctIds: ['b'],
};

export const SORT = {
  kind: 'sort',
  bins: [
    { id: 'land', label: 'Land', emoji: '🌳' },
    { id: 'water', label: 'Water', emoji: '🌊' },
  ],
  items: [
    { id: 'fish', label: 'Fish', emoji: '🐟', binId: 'water' },
    { id: 'cow', label: 'Cow', emoji: '🐄', binId: 'land' },
    { id: 'whale', label: 'Whale', emoji: '🐋', binId: 'water' },
  ],
};

export const MATCH = {
  kind: 'match',
  pairs: [
    { id: 'p1', left: { label: 'Dog' }, right: { label: 'Puppy' } },
    { id: 'p2', left: { label: 'Cat' }, right: { label: 'Kitten' } },
    { id: 'p3', left: { label: 'Cow' }, right: { label: 'Calf' } },
  ],
};

export const ORDER = {
  kind: 'order',
  items: [
    { id: 'o1', label: 'Egg', emoji: '🥚' },
    { id: 'o2', label: 'Caterpillar', emoji: '🐛' },
    { id: 'o3', label: 'Cocoon', emoji: '🟤' },
    { id: 'o4', label: 'Butterfly', emoji: '🦋' },
  ],
  startLabel: 'first',
  endLabel: 'last',
};

export const NUMBER = { kind: 'number', answer: 12, unit: 'apples' };

export const ROBOT = {
  kind: 'robot',
  cols: 4,
  rows: 3,
  start: { x: 0, y: 0, dir: 'right' },
  goal: { x: 3, y: 0 },
  allowed: ['forward', 'left', 'right', 'repeat'],
  maxCommands: 6,
};

export const BUILD = {
  kind: 'build',
  goalLabel: 'a bridge that holds 10 kg',
  powerLabel: 'strength',
  costLabel: 'coins',
  target: 10,
  budget: 8,
  parts: [
    { id: 'wood', label: 'Wood', emoji: '🪵', power: 4, cost: 3 },
    { id: 'steel', label: 'Steel', emoji: '🔩', power: 8, cost: 6 },
    { id: 'rope', label: 'Rope', emoji: '🪢', power: 2, cost: 1 },
    { id: 'paper', label: 'Paper', emoji: '📄', power: 1, cost: 1 },
  ],
};

export const TAP_SCENE = {
  theme: 'farm',
  objects: [
    { id: 'apple1', type: 'emoji', emoji: '🍎', x: 20, y: 40, tappable: true },
    { id: 'apple2', type: 'emoji', emoji: '🍎', x: 50, y: 40, tappable: true },
    { id: 'pear', type: 'emoji', emoji: '🍐', x: 80, y: 40, tappable: true },
    { id: 'sun', type: 'emoji', emoji: '☀️', x: 85, y: 12 },
  ],
};

export const TAP = { kind: 'tap', targetIds: ['apple1', 'apple2'] };
