import { describe, expect, it } from 'vitest';
import { InteractionSchema, type Interaction } from '@/core/schemas';
import { buildIsSolvable, buildIsTrivial, buildSolutions, buildTotals } from './build';
import { checkAnswer } from './check';
import type { Answer } from './types';
import type { BuildInteraction } from '@/core/schemas';

const parse = (raw: unknown): Interaction => InteractionSchema.parse(raw);

describe('checkAnswer: choice', () => {
  const single = parse({
    kind: 'choice',
    options: [
      { id: 'a', label: '5', misconception: 'You counted one twice.' },
      { id: 'b', label: '4' },
      { id: 'c', label: '3', misconception: 'You missed one.' },
    ],
    correctIds: ['b'],
  });
  const multi = parse({
    kind: 'choice',
    multi: true,
    options: [
      { id: 'a', label: 'cat' },
      { id: 'b', label: 'rock', misconception: 'Rocks do not grow.' },
      { id: 'c', label: 'tree' },
      { id: 'd', label: 'car' },
    ],
    correctIds: ['a', 'c'],
  });

  it('accepts the right option', () => {
    expect(checkAnswer(single, ['b'])).toEqual({ correct: true, misconception: null, progress: 1 });
  });

  it('returns the misconception of the chosen wrong option', () => {
    expect(checkAnswer(single, ['a'])).toEqual({ correct: false, misconception: 'You counted one twice.', progress: 0 });
    expect(checkAnswer(single, ['c']).misconception).toBe('You missed one.');
  });

  it('compares multi-select answers as sets', () => {
    expect(checkAnswer(multi, ['c', 'a']).correct).toBe(true);
    expect(checkAnswer(multi, ['a', 'a', 'c']).correct).toBe(true);
    const partial = checkAnswer(multi, ['a']);
    expect(partial.correct).toBe(false);
    expect(partial.progress).toBeCloseTo(0.5);
    expect(partial.misconception).toBeNull();
  });

  it('uses the first chosen wrong option for the misconception', () => {
    const result = checkAnswer(multi, ['a', 'd', 'b']);
    expect(result.correct).toBe(false);
    expect(result.misconception).toBeNull(); // 'd' is the first wrong pick and has none
    expect(checkAnswer(multi, ['a', 'b', 'd']).misconception).toBe('Rocks do not grow.');
  });

  it('is wrong for extra picks, unknown ids, nothing picked and wrong shapes', () => {
    expect(checkAnswer(multi, ['a', 'c', 'd']).correct).toBe(false);
    expect(checkAnswer(multi, ['a', 'c', 'zzz']).correct).toBe(false);
    expect(checkAnswer(multi, ['a', 'c', 'zzz']).progress).toBeLessThan(1);
    expect(checkAnswer(single, []).correct).toBe(false);
    expect(checkAnswer(single, 4).correct).toBe(false);
    expect(checkAnswer(single, { b: 'b' }).correct).toBe(false);
  });
});

describe('checkAnswer: tap', () => {
  const tap = parse({ kind: 'tap', targetIds: ['t1', 't2', 't3'] });
  it('needs exactly the targets', () => {
    expect(checkAnswer(tap, ['t3', 't1', 't2'])).toEqual({ correct: true, misconception: null, progress: 1 });
    expect(checkAnswer(tap, ['t1', 't2']).correct).toBe(false);
    expect(checkAnswer(tap, ['t1', 't2']).progress).toBeCloseTo(2 / 3);
    const extra = checkAnswer(tap, ['t1', 't2', 't3', 'x']);
    expect(extra.correct).toBe(false);
    expect(extra.progress).toBeCloseTo(3 / 4);
    expect(checkAnswer(tap, []).progress).toBe(0);
  });
});

describe('checkAnswer: sort', () => {
  const sort = parse({
    kind: 'sort',
    bins: [
      { id: 'hot', label: 'Hot' },
      { id: 'cold', label: 'Cold' },
    ],
    items: [
      { id: 'sun', label: 'Sun', binId: 'hot' },
      { id: 'ice', label: 'Ice', binId: 'cold' },
      { id: 'fire', label: 'Fire', binId: 'hot' },
      { id: 'snow', label: 'Snow', binId: 'cold' },
    ],
  });
  it('needs every item in its own bin', () => {
    expect(checkAnswer(sort, { sun: 'hot', ice: 'cold', fire: 'hot', snow: 'cold' }).correct).toBe(true);
    const some = checkAnswer(sort, { sun: 'hot', ice: 'hot', fire: 'hot', snow: 'cold' });
    expect(some.correct).toBe(false);
    expect(some.progress).toBe(0.75);
    expect(checkAnswer(sort, { sun: 'hot' }).progress).toBe(0.25);
    expect(checkAnswer(sort, {}).progress).toBe(0);
    expect(checkAnswer(sort, ['sun']).correct).toBe(false);
  });
});

describe('checkAnswer: match', () => {
  const match = parse({
    kind: 'match',
    pairs: [
      { id: 'p1', left: { label: '2 + 2' }, right: { label: '4' } },
      { id: 'p2', left: { label: '3 + 3' }, right: { label: '6' } },
      { id: 'p3', left: { label: '1 + 3' }, right: { label: '4' } },
    ],
  });
  it('needs every left matched to its own right', () => {
    expect(checkAnswer(match, { p1: 'p1', p2: 'p2', p3: 'p3' }).correct).toBe(true);
    const swapped = checkAnswer(match, { p1: 'p2', p2: 'p1', p3: 'p3' });
    expect(swapped.correct).toBe(false);
    expect(swapped.progress).toBeCloseTo(1 / 3);
  });
  it('treats right cards that look identical as interchangeable', () => {
    expect(checkAnswer(match, { p1: 'p3', p2: 'p2', p3: 'p1' }).correct).toBe(true);
  });
  it('does not let one right card serve two lefts', () => {
    const result = checkAnswer(match, { p1: 'p1', p2: 'p2', p3: 'p1' });
    expect(result.correct).toBe(false);
    expect(result.progress).toBeCloseTo(2 / 3);
  });
  it('is wrong when incomplete or pointing at unknown pairs', () => {
    expect(checkAnswer(match, { p1: 'p1' }).correct).toBe(false);
    expect(checkAnswer(match, { p1: 'p1', p2: 'p2', p3: 'nope' }).correct).toBe(false);
  });
});

describe('checkAnswer: order', () => {
  const order = parse({
    kind: 'order',
    items: [
      { id: 'a', label: 'seed' },
      { id: 'b', label: 'sprout' },
      { id: 'c', label: 'flower' },
      { id: 'd', label: 'fruit' },
    ],
  });
  it('needs the schema order', () => {
    expect(checkAnswer(order, ['a', 'b', 'c', 'd'])).toEqual({ correct: true, misconception: null, progress: 1 });
    const swapped = checkAnswer(order, ['a', 'c', 'b', 'd']);
    expect(swapped.correct).toBe(false);
    expect(swapped.progress).toBe(0.5);
    expect(checkAnswer(order, ['d', 'c', 'b', 'a']).progress).toBe(0);
  });
  it('rejects answers that are not a full arrangement', () => {
    expect(checkAnswer(order, ['a', 'b', 'c']).correct).toBe(false);
    expect(checkAnswer(order, ['a', 'b', 'c', 'c']).correct).toBe(false);
    expect(checkAnswer(order, ['a', 'b', 'c', 'd', 'e']).correct).toBe(false);
    expect(checkAnswer(order, ['a', 'b', 'c', 'd', 'e']).progress).toBeLessThan(1);
    expect(checkAnswer(order, 3).correct).toBe(false);
  });
  it('lets items that look the same swap places', () => {
    const twins = parse({
      kind: 'order',
      items: [
        { id: 'n1', label: '3' },
        { id: 'n2', label: '5' },
        { id: 'n3', label: '5' },
        { id: 'n4', label: '8' },
      ],
    });
    expect(checkAnswer(twins, ['n1', 'n3', 'n2', 'n4']).correct).toBe(true);
    expect(checkAnswer(twins, ['n3', 'n1', 'n2', 'n4']).correct).toBe(false);
  });
});

describe('checkAnswer: number', () => {
  it('needs the exact number when tolerance is 0', () => {
    const exact = parse({ kind: 'number', answer: 12 });
    expect(checkAnswer(exact, 12)).toEqual({ correct: true, misconception: null, progress: 1 });
    expect(checkAnswer(exact, 13)).toEqual({ correct: false, misconception: null, progress: 0 });
    expect(checkAnswer(exact, 12.0000001).correct).toBe(false);
  });
  it('accepts answers within the tolerance, both ways, inclusive', () => {
    const loose = parse({ kind: 'number', answer: 3.5, tolerance: 0.5, allowDecimal: true });
    expect(checkAnswer(loose, 3).correct).toBe(true);
    expect(checkAnswer(loose, 4).correct).toBe(true);
    expect(checkAnswer(loose, 4.01).correct).toBe(false);
    expect(checkAnswer(loose, 2.99).correct).toBe(false);
  });
  it('forgives floating point noise', () => {
    const decimal = parse({ kind: 'number', answer: 0.3, allowDecimal: true });
    expect(checkAnswer(decimal, 0.1 + 0.2).correct).toBe(true);
  });
  it('handles negatives and rejects non-numbers', () => {
    const negative = parse({ kind: 'number', answer: -4, allowNegative: true });
    expect(checkAnswer(negative, -4).correct).toBe(true);
    expect(checkAnswer(negative, 4).correct).toBe(false);
    expect(checkAnswer(negative, Number.NaN).correct).toBe(false);
    expect(checkAnswer(negative, Number.POSITIVE_INFINITY).correct).toBe(false);
    expect(checkAnswer(negative, ['-4']).correct).toBe(false);
    expect(checkAnswer(negative, '-4' as unknown as Answer).correct).toBe(false);
  });
});

describe('checkAnswer: robot', () => {
  const robot = parse({
    kind: 'robot',
    cols: 4,
    rows: 4,
    start: { x: 0, y: 0, dir: 'right' },
    goal: { x: 3, y: 0 },
    gems: [{ x: 1, y: 1 }],
    allowed: ['forward', 'left', 'right', 'repeat'],
    maxCommands: 8,
  });
  it('is correct when the run reaches the goal with all gems', () => {
    const program: Answer = [
      { cmd: 'forward' },
      { cmd: 'right' },
      { cmd: 'forward' },
      { cmd: 'left' },
      { cmd: 'repeat', times: 2, body: [{ cmd: 'forward' }] },
      { cmd: 'left' },
      { cmd: 'forward' },
    ];
    expect(checkAnswer(robot, program)).toEqual({ correct: true, misconception: null, progress: 1 });
  });
  it('gives partial progress per milestone and never 1 when wrong', () => {
    const straight = checkAnswer(robot, [{ cmd: 'forward' }, { cmd: 'forward' }, { cmd: 'forward' }]);
    expect(straight.correct).toBe(false);
    expect(straight.progress).toBeCloseTo(0.5); // on the goal, gem missing
    const gemOnly = checkAnswer(robot, [{ cmd: 'forward' }, { cmd: 'right' }, { cmd: 'forward' }]);
    expect(gemOnly.progress).toBeCloseTo(0.5);
    expect(checkAnswer(robot, [{ cmd: 'left' }, { cmd: 'forward' }]).progress).toBe(0); // crash
    expect(checkAnswer(robot, []).progress).toBe(0);
  });
  it('is wrong when it arrives with too many blocks', () => {
    const tight = parse({
      kind: 'robot',
      cols: 4,
      rows: 3,
      start: { x: 0, y: 0, dir: 'right' },
      goal: { x: 3, y: 0 },
      allowed: ['forward', 'repeat'],
      maxCommands: 2,
    });
    const long = checkAnswer(tight, [{ cmd: 'forward' }, { cmd: 'forward' }, { cmd: 'forward' }]);
    expect(long.correct).toBe(false);
    expect(long.progress).toBeLessThan(1);
    expect(checkAnswer(tight, [{ cmd: 'repeat', times: 3, body: [{ cmd: 'forward' }] }]).correct).toBe(true);
  });
  it('rejects answers of the wrong shape', () => {
    expect(checkAnswer(robot, ['forward', 'forward']).correct).toBe(false);
    expect(checkAnswer(robot, 3).correct).toBe(false);
    expect(checkAnswer(robot, { a: 'b' }).correct).toBe(false);
  });
});

describe('build helpers and checkAnswer: build', () => {
  const build = parse({
    kind: 'build',
    goalLabel: 'a bridge that holds 10 kg',
    powerLabel: 'strength',
    costLabel: 'coins',
    target: 10,
    budget: 8,
    parts: [
      { id: 'wood', label: 'Wood', power: 4, cost: 3 },
      { id: 'steel', label: 'Steel', power: 8, cost: 6 },
      { id: 'rope', label: 'Rope', power: 2, cost: 1 },
      { id: 'paper', label: 'Paper', power: 1, cost: 1 },
    ],
  }) as BuildInteraction;

  it('adds up power and cost, ignoring unknown and repeated ids', () => {
    expect(buildTotals(build, ['wood', 'rope', 'rope', 'ghost'])).toEqual({
      power: 6,
      cost: 4,
      meetsTarget: false,
      withinBudget: true,
    });
  });

  it('is correct when power reaches the target within budget', () => {
    expect(checkAnswer(build, ['steel', 'rope'])).toEqual({ correct: true, misconception: null, progress: 1 });
  });

  it('is wrong and partial when under power or over budget', () => {
    const weak = checkAnswer(build, ['wood', 'rope']);
    expect(weak.correct).toBe(false);
    expect(weak.progress).toBeCloseTo(0.6);
    const pricey = checkAnswer(build, ['wood', 'steel']);
    expect(pricey.correct).toBe(false);
    expect(pricey.progress).toBeCloseTo(8 / 9);
    expect(checkAnswer(build, []).progress).toBe(0);
    expect(checkAnswer(build, { wood: 'x' }).correct).toBe(false);
  });

  it('finds whether a solution exists', () => {
    expect(buildIsSolvable(build)).toBe(true);
    expect(buildSolutions(build)).toEqual(
      expect.arrayContaining([
        ['steel', 'rope'],
        ['steel', 'rope', 'paper'],
      ]),
    );
    expect(buildIsSolvable({ ...build, budget: 5 })).toBe(false);
    expect(buildIsSolvable({ ...build, target: 16 })).toBe(false);
    expect(buildIsSolvable({ ...build, target: 15, budget: 11 })).toBe(true);
  });

  it('knows when picking everything works', () => {
    expect(buildIsTrivial(build)).toBe(false);
    expect(buildIsTrivial({ ...build, budget: 11 })).toBe(true);
  });

  it('does not trip over decimal sums', () => {
    const decimal: BuildInteraction = {
      ...build,
      target: 0.3,
      budget: 0.3,
      parts: [
        { id: 'a', label: 'A', power: 0.1, cost: 0.1 },
        { id: 'b', label: 'B', power: 0.2, cost: 0.2 },
        { id: 'c', label: 'C', power: 0.05, cost: 5 },
      ],
    };
    expect(buildIsSolvable(decimal)).toBe(true);
    expect(checkAnswer(decimal, ['a', 'b']).correct).toBe(true);
  });
});
