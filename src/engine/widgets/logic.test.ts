import { describe, expect, it } from 'vitest';
import { InteractionSchema, type Interaction } from '@/core/schemas';
import { INTERACTION_KINDS } from '@/core/types';
import { checkAnswer } from '../check';
import { expandProgram, robotFitsBudget, runRobot } from '../robot';
import { SAMPLE_CHALLENGES } from '../samples';
import { BUILD, CHOICE, MATCH, NUMBER, ORDER, ROBOT, SORT, TAP } from '../testing/fixtures';
import type { RobotProgram } from '../types';
import { validateChallengeContent } from '../validate';
import { DEFAULT_LABELS, fill } from './common';
import { draftToAnswer, formatNumber, initialDraft, parseNumberText, pressKey, sanitizeNumberText } from './draft';
import {
  addBlock,
  countBlockTree,
  depthOf,
  expandWithSource,
  findBlock,
  fromProgram,
  makeBlock,
  moveBlock,
  parentOf,
  removeBlock,
  reorderList,
  setTimes,
  toProgram,
  type Block,
} from './robotBlocks';

const parse = (raw: unknown): Interaction => InteractionSchema.parse(raw);

describe('samples', () => {
  it('has one valid sample per interaction kind', () => {
    for (const kind of INTERACTION_KINDS) {
      const sample = SAMPLE_CHALLENGES[kind];
      expect(sample.interaction.kind).toBe(kind);
      expect(validateChallengeContent(sample)).toEqual([]);
    }
  });

  it('the robot sample is solvable inside its block budget', () => {
    const robot = SAMPLE_CHALLENGES.robot.interaction;
    if (robot.kind !== 'robot') throw new Error('wrong sample');
    const report = robotFitsBudget(robot);
    expect(report.fits).toBe(true);
    expect(runRobot(robot, report.program as RobotProgram).reached).toBe(true);
  });
});

describe('labels', () => {
  it('fills placeholders and leaves unknown ones alone', () => {
    expect(fill('{n} of {max} blocks', { n: 3, max: 8 })).toBe('3 of 8 blocks');
    expect(fill('Hello {who}', {})).toBe('Hello {who}');
    expect(fill(DEFAULT_LABELS.selected, { n: 2 })).toBe('2 selected');
  });
});

describe('number keypad', () => {
  const plain = { allowDecimal: false, allowNegative: false };
  const full = { allowDecimal: true, allowNegative: true };

  it('parses only complete numbers', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('-')).toBeNull();
    expect(parseNumberText('.')).toBeNull();
    expect(parseNumberText('12')).toBe(12);
    expect(parseNumberText('12.')).toBe(12);
    expect(parseNumberText('-0.5')).toBe(-0.5);
    expect(parseNumberText('.5')).toBe(0.5);
    expect(parseNumberText('1e5')).toBeNull();
    expect(parseNumberText('12abc')).toBeNull();
    expect(parseNumberText('3,5')).toBe(3.5);
  });

  it('types digits and deletes them', () => {
    let text = '';
    for (const key of ['1', '2', '3'] as const) text = pressKey(text, key, plain);
    expect(text).toBe('123');
    expect(pressKey(text, 'back', plain)).toBe('12');
    expect(pressKey(text, 'clear', plain)).toBe('');
    expect(pressKey('', 'back', plain)).toBe('');
  });

  it('ignores the decimal point and minus when not allowed', () => {
    expect(pressKey('12', '.', plain)).toBe('12');
    expect(pressKey('12', '-', plain)).toBe('12');
  });

  it('allows one decimal point and toggles the minus sign', () => {
    expect(pressKey('12', '.', full)).toBe('12.');
    expect(pressKey('12.', '.', full)).toBe('12.');
    expect(pressKey('', '.', full)).toBe('0.');
    expect(pressKey('-', '.', full)).toBe('-0.');
    expect(pressKey('12', '-', full)).toBe('-12');
    expect(pressKey('-12', '-', full)).toBe('12');
    expect(pressKey('', '-', full)).toBe('-');
  });

  it('does not build leading zeros or endless numbers', () => {
    expect(pressKey('0', '5', plain)).toBe('5');
    expect(pressKey('-0', '5', full)).toBe('-5');
    expect(pressKey('0', '0', plain)).toBe('0');
    expect(pressKey('0.', '5', full)).toBe('0.5');
    expect(pressKey('123456789', '1', plain)).toBe('123456789');
  });

  it('cleans typed or pasted text', () => {
    expect(sanitizeNumberText('12abc', plain)).toBe('12');
    expect(sanitizeNumberText('-3.5', plain)).toBe('35');
    expect(sanitizeNumberText('-3.5', full)).toBe('-3.5');
    expect(sanitizeNumberText('3,5', full)).toBe('3.5');
    expect(sanitizeNumberText('1.2.3', full)).toBe('1.23');
    expect(sanitizeNumberText('4-2', full)).toBe('42');
    expect(sanitizeNumberText('<script>', full)).toBe('');
  });

  it('formats numbers the way a child writes them', () => {
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(1 / 3)).toBe('0.33');
    expect(formatNumber(Number.NaN)).toBe('');
  });
});

describe('drafts', () => {
  it('starts empty for every kind, and shuffled for order', () => {
    expect(initialDraft(parse(CHOICE))).toEqual({ kind: 'choice', ids: [] });
    expect(initialDraft(parse(TAP))).toEqual({ kind: 'tap', ids: [] });
    expect(initialDraft(parse(SORT))).toEqual({ kind: 'sort', placed: {} });
    expect(initialDraft(parse(MATCH))).toEqual({ kind: 'match', links: {} });
    expect(initialDraft(parse(NUMBER))).toEqual({ kind: 'number', text: '' });
    expect(initialDraft(parse(ROBOT))).toEqual({ kind: 'robot', blocks: [] });
    expect(initialDraft(parse(BUILD))).toEqual({ kind: 'build', ids: [] });
    const order = initialDraft(parse(ORDER));
    if (order.kind !== 'order') throw new Error('wrong draft');
    expect(order.ids.slice().sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(order.ids).not.toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(checkAnswer(parse(ORDER), order.ids).correct).toBe(false);
  });

  it('has no answer until the draft is complete', () => {
    expect(draftToAnswer(parse(CHOICE), { kind: 'choice', ids: [] })).toBeNull();
    expect(draftToAnswer(parse(CHOICE), { kind: 'choice', ids: ['b'] })).toEqual(['b']);
    expect(draftToAnswer(parse(TAP), { kind: 'tap', ids: [] })).toBeNull();
    expect(draftToAnswer(parse(BUILD), { kind: 'build', ids: ['wood'] })).toEqual(['wood']);
    expect(draftToAnswer(parse(SORT), { kind: 'sort', placed: { fish: 'water' } })).toBeNull();
    expect(draftToAnswer(parse(SORT), { kind: 'sort', placed: { fish: 'water', cow: 'land', whale: 'land' } })).toEqual({
      fish: 'water',
      cow: 'land',
      whale: 'land',
    });
    expect(draftToAnswer(parse(MATCH), { kind: 'match', links: { p1: 'p1', p2: 'p3' } })).toBeNull();
    expect(draftToAnswer(parse(MATCH), { kind: 'match', links: { p1: 'p1', p2: 'p3', p3: 'p2' } })).toEqual({
      p1: 'p1',
      p2: 'p3',
      p3: 'p2',
    });
    expect(draftToAnswer(parse(ORDER), { kind: 'order', ids: ['o2', 'o1', 'o3', 'o4'] })).toEqual(['o2', 'o1', 'o3', 'o4']);
    expect(draftToAnswer(parse(NUMBER), { kind: 'number', text: '' })).toBeNull();
    expect(draftToAnswer(parse(NUMBER), { kind: 'number', text: '-' })).toBeNull();
    expect(draftToAnswer(parse(NUMBER), { kind: 'number', text: '12' })).toBe(12);
    expect(draftToAnswer(parse(ROBOT), { kind: 'robot', blocks: [] })).toBeNull();
    expect(draftToAnswer(parse(ROBOT), { kind: 'robot', blocks: [makeBlock('forward')] })).toEqual([{ cmd: 'forward' }]);
  });

  it('refuses a draft that belongs to another kind', () => {
    expect(draftToAnswer(parse(NUMBER), { kind: 'choice', ids: ['a'] })).toBeNull();
  });
});

describe('robot block editing', () => {
  const f = (uid: string): Block => makeBlock('forward', uid);
  const l = (uid: string): Block => makeBlock('left', uid);
  const rep = (uid: string, times: number, body: Block[]): Block => ({ uid, cmd: 'repeat', times, body });

  it('gives every new block its own uid', () => {
    expect(makeBlock('forward').uid).not.toBe(makeBlock('forward').uid);
  });

  it('converts to and from the answer shape', () => {
    const blocks = [f('a'), rep('r', 3, [l('b'), rep('q', 9, [f('c')])])];
    const program = toProgram(blocks);
    expect(program).toEqual([
      { cmd: 'forward' },
      { cmd: 'repeat', times: 3, body: [{ cmd: 'left' }, { cmd: 'repeat', times: 5, body: [{ cmd: 'forward' }] }] },
    ]);
    const back = fromProgram(program);
    expect(toProgram(back)).toEqual(program);
    expect(countBlockTree(back)).toBe(5);
    expect(new Set([back[0]?.uid, back[1]?.uid, back[1]?.body[0]?.uid]).size).toBe(3);
  });

  it('finds blocks, their depth and their parent', () => {
    const blocks = [f('a'), rep('r', 2, [l('b'), rep('q', 2, [f('c')])])];
    expect(findBlock(blocks, 'c')?.cmd).toBe('forward');
    expect(findBlock(blocks, 'zzz')).toBeNull();
    expect(depthOf(blocks, 'a')).toBe(0);
    expect(depthOf(blocks, 'b')).toBe(1);
    expect(depthOf(blocks, 'c')).toBe(2);
    expect(depthOf(blocks, 'zzz')).toBe(-1);
    expect(parentOf(blocks, 'a')).toBeNull();
    expect(parentOf(blocks, 'c')).toBe('q');
    expect(parentOf(blocks, 'zzz')).toBeUndefined();
  });

  it('adds to the main program or into a repeat, without changing the input', () => {
    const start = [f('a'), rep('r', 2, [])];
    const main = addBlock(start, null, l('x'));
    expect(main.map((b) => b.uid)).toEqual(['a', 'r', 'x']);
    const inner = addBlock(start, 'r', l('y'));
    expect(inner[1]?.body.map((b) => b.uid)).toEqual(['y']);
    expect(start[1]?.body).toEqual([]);
    expect(start).toHaveLength(2);
  });

  it('refuses to add into a missing or non-repeat target, or to nest too deep', () => {
    const start = [f('a'), rep('r', 2, [rep('q', 2, [])])];
    expect(addBlock(start, 'gone', l('x'))).toEqual(start);
    expect(addBlock(start, 'a', l('x'))).toEqual(start);
    expect(addBlock(start, 'q', rep('deep', 2, []))).toEqual(start);
    expect(addBlock(start, 'q', l('ok'))[1]?.body[0]?.body.map((b) => b.uid)).toEqual(['ok']);
    expect(addBlock(start, 'r', rep('second', 2, []))[1]?.body.map((b) => b.uid)).toEqual(['q', 'second']);
  });

  it('removes a block anywhere in the tree, together with its body', () => {
    const blocks = [f('a'), rep('r', 2, [l('b'), f('c')])];
    expect(removeBlock(blocks, 'b')[1]?.body.map((b) => b.uid)).toEqual(['c']);
    expect(removeBlock(blocks, 'r').map((b) => b.uid)).toEqual(['a']);
    expect(removeBlock(blocks, 'zzz')).toEqual(blocks);
  });

  it('moves a block inside its own list only', () => {
    const blocks = [f('a'), l('b'), rep('r', 2, [f('c'), l('d')])];
    expect(moveBlock(blocks, 'b', -1).map((b) => b.uid)).toEqual(['b', 'a', 'r']);
    expect(moveBlock(blocks, 'a', -1).map((b) => b.uid)).toEqual(['a', 'b', 'r']);
    expect(moveBlock(blocks, 'r', 1).map((b) => b.uid)).toEqual(['a', 'b', 'r']);
    expect(moveBlock(blocks, 'c', 1)[2]?.body.map((b) => b.uid)).toEqual(['d', 'c']);
    expect(moveBlock(blocks, 'zzz', 1)).toEqual(blocks);
  });

  it('sets repeat times inside 2..5', () => {
    const blocks = [rep('r', 2, [rep('q', 2, [])])];
    expect(setTimes(blocks, 'r', 4)[0]?.times).toBe(4);
    expect(setTimes(blocks, 'r', 99)[0]?.times).toBe(5);
    expect(setTimes(blocks, 'q', 0)[0]?.body[0]?.times).toBe(2);
  });

  it('applies a drag reorder to the right list and ignores a mismatched one', () => {
    const blocks = [f('a'), rep('r', 2, [f('c'), l('d')])];
    const body = blocks[1]?.body ?? [];
    const swapped = reorderList(blocks, 'r', [body[1] as Block, body[0] as Block]);
    expect(swapped[1]?.body.map((b) => b.uid)).toEqual(['d', 'c']);
    expect(reorderList(blocks, null, [blocks[1] as Block, blocks[0] as Block]).map((b) => b.uid)).toEqual(['r', 'a']);
    expect(reorderList(blocks, null, [f('stranger')])).toEqual(blocks);
  });

  it('tags each executed move with its source block, in the order runRobot executes', () => {
    const blocks = [f('a'), rep('r', 2, [l('b'), rep('q', 2, [f('c')])])];
    const moves = expandWithSource(blocks);
    expect(moves.map((m) => m.uid)).toEqual(['a', 'b', 'c', 'c', 'b', 'c', 'c']);
    expect(moves.map((m) => m.cmd)).toEqual(expandProgram(toProgram(blocks)).moves);
    expect(expandWithSource(blocks, 3)).toHaveLength(3);
  });
});
