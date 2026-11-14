import { describe, expect, it } from 'vitest';
import { RobotInteractionSchema, type RobotInteraction } from '@/core/schemas';
import {
  compressWithRepeat,
  countBlocks,
  expandProgram,
  isRobotProgram,
  robotFitsBudget,
  runRobot,
  runRobotDetailed,
  solveRobot,
  turnLeft,
  turnRight,
} from './robot';
import type { RobotProgram, RobotStep } from './types';

function maze(partial: Partial<RobotInteraction> = {}): RobotInteraction {
  return RobotInteractionSchema.parse({
    kind: 'robot',
    cols: 4,
    rows: 4,
    start: { x: 0, y: 0, dir: 'right' },
    goal: { x: 3, y: 0 },
    allowed: ['forward', 'left', 'right', 'repeat'],
    maxCommands: 10,
    ...partial,
  });
}

const F: RobotStep = { cmd: 'forward' };
const L: RobotStep = { cmd: 'left' };
const R: RobotStep = { cmd: 'right' };
const rep = (times: number, body: RobotStep[]): RobotStep => ({ cmd: 'repeat', times, body });

describe('turning', () => {
  it('turns left and right around the compass', () => {
    expect(turnLeft('up')).toBe('left');
    expect(turnLeft('left')).toBe('down');
    expect(turnRight('up')).toBe('right');
    expect(turnRight('left')).toBe('up');
  });
});

describe('countBlocks and expandProgram', () => {
  it('counts a repeat block as 1 plus its body', () => {
    expect(countBlocks([])).toBe(0);
    expect(countBlocks([F, F, L])).toBe(3);
    expect(countBlocks([rep(3, [F])])).toBe(2);
    expect(countBlocks([F, rep(2, [F, rep(2, [L, F])]), R])).toBe(7);
  });

  it('expands repeat bodies, including nested ones', () => {
    expect(expandProgram([rep(3, [F])]).moves).toEqual(['forward', 'forward', 'forward']);
    expect(expandProgram([rep(2, [F, rep(2, [L])])]).moves).toEqual([
      'forward',
      'left',
      'left',
      'forward',
      'left',
      'left',
    ]);
  });

  it('clamps repeat times into 2..5', () => {
    expect(expandProgram([rep(1, [F])]).moves).toHaveLength(2);
    expect(expandProgram([rep(0, [F])]).moves).toHaveLength(2);
    expect(expandProgram([rep(99, [F])]).moves).toHaveLength(5);
    expect(expandProgram([rep(Number.NaN, [F])]).moves).toHaveLength(2);
    expect(expandProgram([rep(2.6, [F])]).moves).toHaveLength(3);
  });

  it('stops expanding at the safety cap', () => {
    const deep = rep(5, [rep(5, [rep(5, [rep(5, [rep(5, [F])])])])]);
    const out = expandProgram([deep], 100);
    expect(out.moves).toHaveLength(100);
    expect(out.truncated).toBe(true);
  });
});

describe('isRobotProgram', () => {
  it('accepts programs and rejects other shapes', () => {
    expect(isRobotProgram([])).toBe(true);
    expect(isRobotProgram([F, rep(2, [L])])).toBe(true);
    expect(isRobotProgram('forward')).toBe(false);
    expect(isRobotProgram([{ cmd: 'jump' }])).toBe(false);
    expect(isRobotProgram([{ cmd: 'repeat', times: 2 }])).toBe(false);
    expect(isRobotProgram([{ cmd: 'repeat', times: '2', body: [] }])).toBe(false);
    expect(isRobotProgram([null])).toBe(false);
    expect(isRobotProgram(['a', 'b'])).toBe(false);
  });
});

describe('runRobot', () => {
  it('reaches the goal on a straight line', () => {
    const run = runRobot(maze(), [F, F, F]);
    expect(run.reached).toBe(true);
    expect(run.crashed).toBe(false);
    expect(run.commandCount).toBe(3);
    expect(run.steps).toEqual([
      { x: 0, y: 0, dir: 'right' },
      { x: 1, y: 0, dir: 'right' },
      { x: 2, y: 0, dir: 'right' },
      { x: 3, y: 0, dir: 'right' },
    ]);
  });

  it('does not count as reached when the robot stops short or drives past', () => {
    expect(runRobot(maze(), [F, F]).reached).toBe(false);
    const past = runRobot(maze({ goal: { x: 2, y: 0 } }), [F, F, F]);
    expect(past.reached).toBe(false);
    expect(past.crashed).toBe(false);
  });

  it('an empty program stays at the start', () => {
    const run = runRobot(maze(), []);
    expect(run.reached).toBe(false);
    expect(run.steps).toHaveLength(1);
    expect(run.commandCount).toBe(0);
  });

  it('crashes on the grid edge and stops the run', () => {
    const run = runRobot(maze(), [F, F, F, F, L, F]);
    expect(run.crashed).toBe(true);
    expect(run.reached).toBe(false);
    // start + 3 moves + the crash frame; nothing after the crash runs
    expect(run.steps).toHaveLength(5);
    expect(run.steps[4]).toEqual({ x: 3, y: 0, dir: 'right' });
  });

  it('crashes on a wall', () => {
    const run = runRobot(maze({ walls: [{ x: 2, y: 0 }] }), [F, F, F]);
    expect(run.crashed).toBe(true);
    expect(run.steps[run.steps.length - 1]).toEqual({ x: 1, y: 0, dir: 'right' });
  });

  it('turns in place', () => {
    const run = runRobot(maze({ goal: { x: 0, y: 2 } }), [R, F, F]);
    expect(run.reached).toBe(true);
    expect(run.steps[1]).toEqual({ x: 0, y: 0, dir: 'down' });
  });

  it('runs repeat blocks and nested repeat blocks', () => {
    const i = maze({ goal: { x: 3, y: 3 }, maxCommands: 6 });
    // (forward x3, turn right) twice = across the top, then down the right side
    const program: RobotProgram = [rep(2, [rep(3, [F]), R])];
    const run = runRobot(i, program);
    expect(run.commandCount).toBe(4);
    expect(run.reached).toBe(true);
    expect(run.steps[run.steps.length - 1]).toEqual({ x: 3, y: 3, dir: 'left' });
  });

  it('requires every gem', () => {
    const i = maze({ gems: [{ x: 1, y: 1 }], maxCommands: 12 });
    expect(runRobot(i, [F, F, F]).reached).toBe(false);
    expect(runRobot(i, [F, F, F]).gems).toBe(0);
    const viaGem = runRobot(i, [F, R, F, L, F, F, L, F]);
    expect(viaGem.gems).toBe(1);
    expect(viaGem.reached).toBe(true);
  });

  it('counts a gem once even when visited twice, and a gem on the start cell', () => {
    const i = maze({ gems: [{ x: 0, y: 0 }, { x: 1, y: 0 }], goal: { x: 1, y: 0 } });
    const run = runRobot(i, [F, L, L, F, L, L, F]);
    expect(run.gems).toBe(2);
    expect(run.reached).toBe(true);
  });

  it('reports which move picked up a gem in the detailed trace', () => {
    const i = maze({ gems: [{ x: 2, y: 0 }] });
    const run = runRobotDetailed(i, [F, F, F]);
    expect(run.trace.map((t) => t.gemIndex)).toEqual([null, 0, null]);
    expect(run.trace.every((t) => !t.crashed)).toBe(true);
  });

  it('refuses a program longer than maxCommands even when it arrives', () => {
    const i = maze({ maxCommands: 2 });
    const run = runRobot(i, [F, F, F]);
    expect(run.steps[run.steps.length - 1]).toMatchObject({ x: 3, y: 0 });
    expect(run.reached).toBe(false);
    expect(runRobot(i, [rep(3, [F])]).reached).toBe(true);
  });

  it('refuses blocks that are not allowed', () => {
    const i = maze({ allowed: ['forward', 'left', 'right'] });
    expect(runRobot(i, [rep(3, [F])]).reached).toBe(false);
    expect(runRobotDetailed(i, [rep(3, [F])]).usedOnlyAllowed).toBe(false);
    expect(runRobot(i, [F, F, F]).reached).toBe(true);
    const noTurns = maze({ allowed: ['forward'], goal: { x: 0, y: 1 } });
    expect(runRobot(noTurns, [R, F]).reached).toBe(false);
  });

  it('treats a malformed program as an empty one', () => {
    const run = runRobot(maze(), 'nope' as unknown as RobotProgram);
    expect(run.reached).toBe(false);
    expect(run.commandCount).toBe(0);
  });

  it('never loops forever on a giant program', () => {
    const big: RobotProgram = Array.from({ length: 5000 }, () => L);
    const run = runRobotDetailed(maze(), big);
    expect(run.truncated).toBe(true);
    expect(run.reached).toBe(false);
  });
});

describe('solveRobot', () => {
  it('finds the shortest plain program', () => {
    expect(solveRobot(maze())).toEqual([F, F, F]);
  });

  it('includes the turns it needs', () => {
    const i = maze({ start: { x: 0, y: 0, dir: 'up' }, goal: { x: 2, y: 0 } });
    expect(solveRobot(i)).toEqual([R, F, F]);
  });

  it('returns a program that really solves a maze with walls and gems', () => {
    const i = maze({
      cols: 5,
      rows: 5,
      start: { x: 0, y: 4, dir: 'up' },
      goal: { x: 4, y: 0 },
      walls: [
        { x: 1, y: 3 },
        { x: 1, y: 2 },
        { x: 3, y: 1 },
        { x: 3, y: 2 },
      ],
      gems: [
        { x: 2, y: 4 },
        { x: 0, y: 0 },
      ],
      maxCommands: 24,
    });
    const program = solveRobot(i);
    expect(program).not.toBeNull();
    const run = runRobot(i, program as RobotProgram);
    expect(run.reached).toBe(true);
    expect(run.gems).toBe(2);
    expect((program as RobotProgram).every((s) => s.cmd !== 'repeat')).toBe(true);
  });

  it('returns an empty program when the robot already stands on the goal', () => {
    expect(solveRobot(maze({ goal: { x: 0, y: 0 } }))).toEqual([]);
  });

  it('returns null for a walled-in goal', () => {
    const i = maze({
      goal: { x: 3, y: 3 },
      walls: [
        { x: 2, y: 3 },
        { x: 3, y: 2 },
      ],
    });
    expect(solveRobot(i)).toBeNull();
  });

  it('returns null when a gem is unreachable, on a wall, or outside the grid', () => {
    const boxed = maze({
      gems: [{ x: 0, y: 3 }],
      walls: [
        { x: 0, y: 2 },
        { x: 1, y: 3 },
      ],
    });
    expect(solveRobot(boxed)).toBeNull();
    expect(solveRobot(maze({ gems: [{ x: 1, y: 1 }], walls: [{ x: 1, y: 1 }] }))).toBeNull();
    expect(solveRobot(maze({ cols: 3, rows: 3, goal: { x: 2, y: 0 }, gems: [{ x: 7, y: 7 }] }))).toBeNull();
  });

  it('returns null when start or goal is on a wall or outside the grid', () => {
    expect(solveRobot(maze({ walls: [{ x: 0, y: 0 }] }))).toBeNull();
    expect(solveRobot(maze({ walls: [{ x: 3, y: 0 }] }))).toBeNull();
    expect(solveRobot(maze({ cols: 3, rows: 3, goal: { x: 5, y: 5 } }))).toBeNull();
  });

  it('handles the largest grid with six gems quickly', () => {
    const i = maze({
      cols: 8,
      rows: 8,
      goal: { x: 7, y: 7 },
      gems: [
        { x: 7, y: 0 },
        { x: 0, y: 7 },
        { x: 3, y: 3 },
        { x: 5, y: 2 },
        { x: 2, y: 5 },
        { x: 6, y: 6 },
      ],
      maxCommands: 24,
    });
    const program = solveRobot(i) as RobotProgram;
    expect(runRobot({ ...i, maxCommands: 24 }, program).gems).toBe(6);
  });
});

describe('compressWithRepeat and robotFitsBudget', () => {
  it('wraps runs of the same block', () => {
    expect(compressWithRepeat([F, F, F])).toEqual([rep(3, [F])]);
    expect(compressWithRepeat([F, F])).toEqual([F, F]); // no saving: repeat + body = 2 blocks
    expect(compressWithRepeat([F, L, F, L, F, L])).toEqual([rep(3, [F, L])]);
  });

  it('splits runs longer than five', () => {
    const seven = Array.from({ length: 7 }, () => F);
    const out = compressWithRepeat(seven);
    expect(expandProgram(out).moves).toHaveLength(7);
    expect(countBlocks(out)).toBeLessThan(7);
  });

  it('behaves exactly like the original program', () => {
    const i = maze({ cols: 6, rows: 6, goal: { x: 5, y: 5 }, maxCommands: 24 });
    const plain = solveRobot(i) as RobotProgram;
    const packed = compressWithRepeat(plain);
    expect(expandProgram(packed).moves).toEqual(expandProgram(plain).moves);
    expect(countBlocks(packed)).toBeLessThan(countBlocks(plain));
    expect(runRobot(i, packed).reached).toBe(true);
  });

  it('accepts a compressed solution only when repeat is allowed', () => {
    const base = { cols: 6, rows: 3, goal: { x: 5, y: 0 }, maxCommands: 2 } as const;
    const withRepeat = robotFitsBudget(maze({ ...base }));
    expect(withRepeat).toMatchObject({ solvable: true, fits: true, blocks: 2 });
    const without = robotFitsBudget(maze({ ...base, allowed: ['forward', 'left', 'right'] }));
    expect(without).toMatchObject({ solvable: true, fits: false, blocks: 5 });
  });

  it('respects the allowed turns', () => {
    // The goal is to the left of a robot facing right: needs a turn.
    const i = maze({ start: { x: 2, y: 0, dir: 'right' }, goal: { x: 0, y: 0 }, allowed: ['forward'] });
    expect(robotFitsBudget(i).solvable).toBe(false);
    const onlyRight = robotFitsBudget(maze({ start: { x: 2, y: 1, dir: 'right' }, goal: { x: 0, y: 1 }, allowed: ['forward', 'right'] }));
    expect(onlyRight.solvable).toBe(true);
    expect(onlyRight.blocks).toBe(4); // right, right, forward, forward
  });
});
