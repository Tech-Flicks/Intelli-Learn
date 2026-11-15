import { describe, expect, it } from 'vitest';
import { RobotInteractionSchema, BuildInteractionSchema, type Challenge } from '@/core/schemas';
import { buildHasTemptingMistake, buildSolutions, numbersIn, problemsOf, solveMaze } from './check';
import { CURATED } from './curated';
import { createRng, hashText } from './rng';
import { cardScene, gridSlots, pictureScene, stackScene } from './scene';

const robot = (over: object = {}) =>
  RobotInteractionSchema.parse({ kind: 'robot', cols: 3, rows: 3, start: { x: 0, y: 0, dir: 'right' }, goal: { x: 2, y: 2 }, walls: [{ x: 1, y: 1 }], gems: [{ x: 2, y: 0 }], allowed: ['forward', 'left', 'right'], maxCommands: 8, ...over });

const sample = (id: string): Challenge => {
  const item = CURATED.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing curated item ${id}`);
  return JSON.parse(JSON.stringify(item.challenge)) as Challenge;
};

describe('solveMaze', () => {
  it('finds the shortest program that collects every gem', () => {
    expect(solveMaze(robot())).toEqual(['forward', 'forward', 'right', 'forward', 'forward']);
  });

  it('reports mazes that cannot be solved', () => {
    expect(solveMaze(robot({ walls: [{ x: 1, y: 0 }, { x: 0, y: 1 }] }))).toBeNull();
    expect(solveMaze(robot({ allowed: ['forward'] }))).toBeNull();
  });
});

describe('build checks', () => {
  const build = BuildInteractionSchema.parse({ kind: 'build', goalLabel: 'a strong bridge', powerLabel: 'strength', costLabel: 'coins', target: 5, budget: 4, parts: [{ id: 'a', label: 'Ramp', power: 3, cost: 2 }, { id: 'b', label: 'Rope', power: 2, cost: 2 }, { id: 'c', label: 'Crane', power: 6, cost: 6 }] });

  it('lists every selection that reaches the target within the budget', () => {
    expect(buildSolutions(build)).toEqual([['a', 'b']]);
    expect(buildHasTemptingMistake(build)).toBe(true);
    expect(buildSolutions({ ...build, budget: 1 })).toEqual([]);
  });
});

describe('problemsOf', () => {
  it('accepts sound challenges', () => {
    expect(problemsOf(sample('exp-ice'))).toEqual([]);
    expect(problemsOf(sample('inv-bridge'))).toEqual([]);
  });

  it('catches a hint that states the answer, in digits or in words', () => {
    const digits = sample('won-octopus');
    digits.hints[1] = 'The answer is 12.';
    expect(problemsOf(digits).join(' ')).toContain('states the answer');
    const spoken = sample('won-octopus');
    spoken.hints[0] = 'Could it be twelve?';
    expect(problemsOf(spoken).join(' ')).toContain('in words');
  });

  it('catches broken tap, choice, sort and build challenges', () => {
    const tap = sample('det-fruit');
    if (tap.interaction.kind === 'tap') tap.interaction.targetIds = ['nowhere'];
    expect(problemsOf(tap).join(' ')).toContain('not in the scene');

    const choice = sample('exp-ice');
    if (choice.interaction.kind === 'choice') choice.interaction.correctIds = ['z'];
    expect(problemsOf(choice).join(' ')).toContain('not an option');

    const sort = sample('exp-float');
    if (sort.interaction.kind === 'sort') sort.interaction.items.forEach((item) => (item.binId = 'bin1'));
    expect(problemsOf(sort).join(' ')).toContain('same bin');

    const build = sample('inv-bridge');
    if (build.interaction.kind === 'build') build.interaction.budget = 100;
    expect(problemsOf(build).join(' ')).toContain('every part');
  });

  it('catches symbols in the read-aloud text and a teach-back without one right answer', () => {
    const c = sample('exp-ice');
    c.readAloud = '2 + 2 = 4';
    c.teachBack?.options.forEach((option) => (option.correct = true));
    const problems = problemsOf(c).join(' ');
    expect(problems).toContain('read-aloud');
    expect(problems).toContain('teach-back');
  });
});

describe('numbersIn', () => {
  it('reads numbers with thousands separators and decimals', () => {
    expect(numbersIn('about 1,250 steps and 3.5 km')).toEqual([1250, 3.5]);
  });
});

describe('createRng', () => {
  it('is deterministic and stays inside its bounds', () => {
    const a = createRng(123);
    const b = createRng(123);
    const drawsA = Array.from({ length: 20 }, () => a.int(3, 9));
    const drawsB = Array.from({ length: 20 }, () => b.int(3, 9));
    expect(drawsA).toEqual(drawsB);
    expect(drawsA.every((n) => Number.isInteger(n) && n >= 3 && n <= 9)).toBe(true);
    expect(createRng(124).next()).not.toBe(createRng(123).next());
  });

  it('shuffles and samples without losing or repeating items', () => {
    const rng = createRng(7);
    const list = [1, 2, 3, 4, 5, 6];
    expect([...rng.shuffle(list)].sort()).toEqual(list);
    const picked = rng.sample(list, 4);
    expect(new Set(picked).size).toBe(4);
    expect(rng.sample(list, 99).length).toBe(6);
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('scenes', () => {
  it('lays cards out inside the scene without overlap', () => {
    for (const count of [1, 4, 7, 10, 13]) {
      const slots = gridSlots(count);
      expect(slots.length).toBe(count);
      for (const slot of slots) {
        expect(slot.x).toBeGreaterThan(0);
        expect(slot.x).toBeLessThan(100);
        expect(slot.y).toBeGreaterThan(0);
        expect(slot.y).toBeLessThan(100);
      }
      expect(new Set(slots.map((slot) => `${slot.x},${slot.y}`)).size).toBe(count);
    }
  });

  it('never decorates a scene with the thing the scene shows, so a count stays right', () => {
    const emojiCount = (objects: readonly { emoji?: string | undefined }[], emoji: string): number => objects.filter((o) => o.emoji === emoji).length;
    // The ocean decoration is a shell, the forest one a mushroom, the plain one a star.
    for (const count of [1, 2, 4, 9]) {
      expect(emojiCount(cardScene('ocean', Array.from({ length: count }, () => ({ emoji: '🐚' }))).objects ?? [], '🐚')).toBe(count);
      expect(emojiCount(cardScene('forest', Array.from({ length: count }, () => ({ emoji: '🍄' }))).objects ?? [], '🍄')).toBe(count);
      expect(emojiCount(cardScene('plain', Array.from({ length: count }, () => ({ emoji: '⭐' }))).objects ?? [], '⭐')).toBe(count);
      // A picture scene shows at most eight things.
      expect(emojiCount(pictureScene('ocean', Array.from({ length: count }, () => '🌊')).objects ?? [], '🌊')).toBe(Math.min(count, 8));
    }
    // The scene is still decorated, with something else.
    const one = cardScene('plain', [{ emoji: '⭐' }]).objects ?? [];
    expect(one.length).toBeGreaterThanOrEqual(3);
    expect(new Set(one.map((o) => o.emoji)).size).toBe(one.length);
  });

  it('always builds scenes with 3 to 15 objects and unique ids', () => {
    for (const count of [1, 2, 5, 13, 20]) {
      const objects = cardScene('ocean', Array.from({ length: count }, () => ({ emoji: '🐟' }))).objects ?? [];
      expect(objects.length).toBeGreaterThanOrEqual(3);
      expect(objects.length).toBeLessThanOrEqual(15);
      expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length);
    }
    const board = stackScene('lab', ['x = 3', 'x = x + 2'], '🤖').objects ?? [];
    expect(board.filter((o) => o.type === 'text').length).toBe(2);
    expect(board.length).toBeGreaterThanOrEqual(3);
  });
});
