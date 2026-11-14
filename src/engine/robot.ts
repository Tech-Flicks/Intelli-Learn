/**
 * Robot Coder simulation, solver and program helpers. Pure logic.
 *
 * Grid: (0,0) is the top-left cell, x grows to the right, y grows downwards.
 */
import type { RobotInteraction } from '@/core/schemas';
import type { RobotProgram, RobotStep } from './types';

export type RobotDir = 'up' | 'right' | 'down' | 'left';
export type RobotMove = 'forward' | 'left' | 'right';

export const ROBOT_DIRS: readonly RobotDir[] = ['up', 'right', 'down', 'left'];
export const REPEAT_MIN = 2;
export const REPEAT_MAX = 5;

/** Hard cap on executed moves so a hostile or huge program can never hang the UI. */
export const MAX_EXECUTED_MOVES = 2000;
/** Hard cap on repeat nesting when a program comes from outside the widget. */
const MAX_DEPTH = 6;

const DELTA: Record<RobotDir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
};

export interface RobotPose {
  x: number;
  y: number;
  dir: RobotDir;
}

/** One executed move, for step-by-step animation. */
export interface RobotTraceEntry {
  cmd: RobotMove;
  from: RobotPose;
  to: RobotPose;
  /** The move ran into a wall or the edge. `to` equals `from`. */
  crashed: boolean;
  /** Index into `interaction.gems` picked up by this move, or null. */
  gemIndex: number | null;
}

export interface RobotRun {
  reached: boolean;
  crashed: boolean;
  gems: number;
  /** Pose after every executed move; steps[0] is the start pose. */
  steps: { x: number; y: number; dir: string }[];
  commandCount: number;
}

export interface RobotRunDetail extends RobotRun {
  trace: RobotTraceEntry[];
  /** False when the program uses a block that is not in `allowed` or is malformed. */
  usedOnlyAllowed: boolean;
  /** True when the run was cut short by the safety cap on executed moves. */
  truncated: boolean;
}

export function turnLeft(dir: RobotDir): RobotDir {
  return ROBOT_DIRS[(ROBOT_DIRS.indexOf(dir) + 3) % 4] as RobotDir;
}

export function turnRight(dir: RobotDir): RobotDir {
  return ROBOT_DIRS[(ROBOT_DIRS.indexOf(dir) + 1) % 4] as RobotDir;
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function inBounds(i: RobotInteraction, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < i.cols && y < i.rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Type guard for a program that came from storage or another module. */
export function isRobotProgram(value: unknown, depth = 0): value is RobotProgram {
  if (!Array.isArray(value) || depth > MAX_DEPTH) return false;
  return value.every((step: unknown) => {
    if (!isRecord(step)) return false;
    if (step.cmd === 'forward' || step.cmd === 'left' || step.cmd === 'right') return true;
    if (step.cmd === 'repeat') {
      return typeof step.times === 'number' && isRobotProgram(step.body, depth + 1);
    }
    return false;
  });
}

/** Blocks written: every block counts 1; a repeat block counts 1 plus its body. */
export function countBlocks(program: RobotProgram): number {
  let total = 0;
  for (const step of program) {
    total += 1;
    if (step.cmd === 'repeat') total += countBlocks(step.body);
  }
  return total;
}

export function clampRepeatTimes(times: number): number {
  if (!Number.isFinite(times)) return REPEAT_MIN;
  return Math.max(REPEAT_MIN, Math.min(REPEAT_MAX, Math.round(times)));
}

/** Set of command names used anywhere in the program. */
export function commandsUsed(program: RobotProgram, into: Set<string> = new Set()): Set<string> {
  for (const step of program) {
    into.add(step.cmd);
    if (step.cmd === 'repeat') commandsUsed(step.body, into);
  }
  return into;
}

/**
 * Flattens a program into plain moves. Repeat bodies are expanded `times`
 * (clamped to 2..5) times. Stops at `limit` moves.
 */
export function expandProgram(program: RobotProgram, limit = MAX_EXECUTED_MOVES): { moves: RobotMove[]; truncated: boolean } {
  const moves: RobotMove[] = [];
  let truncated = false;
  const walk = (steps: RobotProgram, depth: number): void => {
    for (const step of steps) {
      if (moves.length >= limit) {
        truncated = true;
        return;
      }
      if (step.cmd === 'repeat') {
        if (depth >= MAX_DEPTH) {
          truncated = true;
          return;
        }
        const times = clampRepeatTimes(step.times);
        for (let n = 0; n < times; n += 1) {
          walk(step.body, depth + 1);
          if (truncated) return;
        }
      } else {
        moves.push(step.cmd);
      }
    }
  };
  walk(program, 0);
  return { moves, truncated };
}

/** Full simulation with a per-move trace for animation. */
export function runRobotDetailed(i: RobotInteraction, program: RobotProgram): RobotRunDetail {
  const safeProgram: RobotProgram = isRobotProgram(program) ? program : [];
  const wellFormed = safeProgram === program;
  const walls = new Set(i.walls.map((w) => cellKey(w.x, w.y)));
  const gemIndexByCell = new Map<string, number>();
  i.gems.forEach((g, index) => {
    const key = cellKey(g.x, g.y);
    if (!gemIndexByCell.has(key)) gemIndexByCell.set(key, index);
  });
  const uniqueGemCount = gemIndexByCell.size;
  const collected = new Set<number>();

  let pose: RobotPose = { x: i.start.x, y: i.start.y, dir: i.start.dir };
  const startGem = gemIndexByCell.get(cellKey(pose.x, pose.y));
  if (startGem !== undefined) collected.add(startGem);

  const steps: RobotRun['steps'] = [{ ...pose }];
  const trace: RobotTraceEntry[] = [];
  const { moves, truncated } = expandProgram(safeProgram);
  let crashed = false;

  for (const cmd of moves) {
    const from = pose;
    if (cmd === 'left') {
      pose = { ...pose, dir: turnLeft(pose.dir) };
      trace.push({ cmd, from, to: pose, crashed: false, gemIndex: null });
    } else if (cmd === 'right') {
      pose = { ...pose, dir: turnRight(pose.dir) };
      trace.push({ cmd, from, to: pose, crashed: false, gemIndex: null });
    } else {
      const d = DELTA[pose.dir];
      const nx = pose.x + d.dx;
      const ny = pose.y + d.dy;
      if (!inBounds(i, nx, ny) || walls.has(cellKey(nx, ny))) {
        crashed = true;
        trace.push({ cmd, from, to: from, crashed: true, gemIndex: null });
        steps.push({ ...pose });
        break;
      }
      pose = { ...pose, x: nx, y: ny };
      const gem = gemIndexByCell.get(cellKey(nx, ny));
      const fresh = gem !== undefined && !collected.has(gem);
      if (gem !== undefined) collected.add(gem);
      trace.push({ cmd, from, to: pose, crashed: false, gemIndex: fresh ? (gem as number) : null });
    }
    steps.push({ ...pose });
  }

  const commandCount = countBlocks(safeProgram);
  const allowed = new Set<string>(i.allowed);
  let usedOnlyAllowed = wellFormed;
  for (const cmd of commandsUsed(safeProgram)) {
    if (!allowed.has(cmd)) usedOnlyAllowed = false;
  }

  const onGoal = pose.x === i.goal.x && pose.y === i.goal.y;
  const reached =
    !crashed &&
    !truncated &&
    onGoal &&
    collected.size === uniqueGemCount &&
    commandCount <= i.maxCommands &&
    usedOnlyAllowed;

  return { reached, crashed, gems: collected.size, steps, commandCount, trace, usedOnlyAllowed, truncated };
}

/**
 * Simulates a program. `reached` is true only when the robot ends on the goal
 * with every gem collected, without crashing, within `maxCommands` blocks and
 * using only allowed blocks.
 */
export function runRobot(i: RobotInteraction, program: RobotProgram): RobotRun {
  const { reached, crashed, gems, steps, commandCount } = runRobotDetailed(i, program);
  return { reached, crashed, gems, steps, commandCount };
}

/**
 * Shortest plain (forward / left / right) program that collects every gem and
 * ends on the goal, or null when there is none. Breadth-first search over
 * (x, y, direction, collected-gems bitmask). Ignores `allowed` and
 * `maxCommands`; see `robotFitsBudget` for those.
 */
export function solveRobot(i: RobotInteraction): RobotProgram | null {
  const moves = solveRobotMoves(i, ['forward', 'left', 'right']);
  return moves ? moves.map((cmd) => ({ cmd })) : null;
}

/** Like `solveRobot` but restricted to the given plain moves. */
export function solveRobotMoves(i: RobotInteraction, usable: readonly RobotMove[]): RobotMove[] | null {
  const walls = new Set(i.walls.map((w) => cellKey(w.x, w.y)));
  if (!inBounds(i, i.start.x, i.start.y) || !inBounds(i, i.goal.x, i.goal.y)) return null;
  if (walls.has(cellKey(i.start.x, i.start.y)) || walls.has(cellKey(i.goal.x, i.goal.y))) return null;

  const gemBit = new Map<string, number>();
  for (const g of i.gems) {
    const key = cellKey(g.x, g.y);
    if (!inBounds(i, g.x, g.y) || walls.has(key)) return null; // a gem nobody can reach
    if (!gemBit.has(key)) gemBit.set(key, gemBit.size);
  }
  const fullMask = (1 << gemBit.size) - 1;
  const masks = fullMask + 1;
  const cells = i.cols * i.rows;
  const encode = (x: number, y: number, dir: number, mask: number): number =>
    ((y * i.cols + x) * 4 + dir) * masks + mask;

  const total = cells * 4 * masks;
  const prev = new Int32Array(total).fill(-2);
  const via = new Uint8Array(total);

  const startBit = gemBit.get(cellKey(i.start.x, i.start.y));
  const startMask = startBit === undefined ? 0 : 1 << startBit;
  const startState = encode(i.start.x, i.start.y, ROBOT_DIRS.indexOf(i.start.dir), startMask);
  prev[startState] = -1;
  const queue: number[] = [startState];
  const canForward = usable.includes('forward');
  const canLeft = usable.includes('left');
  const canRight = usable.includes('right');

  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head] as number;
    const mask = state % masks;
    const rest = (state - mask) / masks;
    const dir = rest % 4;
    const cellIndex = (rest - dir) / 4;
    const x = cellIndex % i.cols;
    const y = (cellIndex - x) / i.cols;

    if (x === i.goal.x && y === i.goal.y && mask === fullMask) {
      const out: RobotMove[] = [];
      let cursor = state;
      while ((prev[cursor] as number) >= 0) {
        out.push((['forward', 'left', 'right'] as const)[via[cursor] as number] as RobotMove);
        cursor = prev[cursor] as number;
      }
      return out.reverse();
    }

    const visit = (next: number, move: number): void => {
      if (prev[next] === -2) {
        prev[next] = state;
        via[next] = move;
        queue.push(next);
      }
    };

    if (canForward) {
      const d = DELTA[ROBOT_DIRS[dir] as RobotDir];
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (inBounds(i, nx, ny) && !walls.has(cellKey(nx, ny))) {
        const bit = gemBit.get(cellKey(nx, ny));
        visit(encode(nx, ny, dir, bit === undefined ? mask : mask | (1 << bit)), 0);
      }
    }
    if (canLeft) visit(encode(x, y, (dir + 3) % 4, mask), 1);
    if (canRight) visit(encode(x, y, (dir + 1) % 4, mask), 2);
  }
  return null;
}

function sameStep(a: RobotStep, b: RobotStep): boolean {
  if (a.cmd !== b.cmd) return false;
  if (a.cmd === 'repeat' && b.cmd === 'repeat') {
    return a.times === b.times && a.body.length === b.body.length && a.body.every((s, k) => sameStep(s, b.body[k] as RobotStep));
  }
  return true;
}

/**
 * Simple, greedy compression of a plain program with repeat blocks: at every
 * position it wraps the run of consecutive identical chunks (2..5 times) that
 * saves the most blocks. Never nests. The result behaves exactly like the input.
 */
export function compressWithRepeat(program: RobotProgram): RobotProgram {
  const out: RobotProgram = [];
  let index = 0;
  while (index < program.length) {
    let best: { len: number; times: number; saving: number } | null = null;
    const maxLen = Math.floor((program.length - index) / 2);
    for (let len = 1; len <= maxLen; len += 1) {
      let times = 1;
      while (
        times < REPEAT_MAX &&
        index + (times + 1) * len <= program.length &&
        program
          .slice(index, index + len)
          .every((step, k) => sameStep(step, program[index + times * len + k] as RobotStep))
      ) {
        times += 1;
      }
      if (times >= REPEAT_MIN) {
        const saving = times * len - (1 + len);
        if (saving > 0 && (!best || saving > best.saving)) best = { len, times, saving };
      }
    }
    if (best) {
      out.push({ cmd: 'repeat', times: best.times, body: program.slice(index, index + best.len) });
      index += best.len * best.times;
    } else {
      out.push(program[index] as RobotStep);
      index += 1;
    }
  }
  return out;
}

export interface RobotBudgetReport {
  solvable: boolean;
  /** Shortest program found that respects `allowed`, or null. */
  program: RobotProgram | null;
  /** Blocks that program needs. */
  blocks: number;
  fits: boolean;
}

/**
 * Whether the maze can be solved with the allowed blocks inside `maxCommands`.
 * When 'repeat' is allowed, a solution compressed with repeat blocks counts.
 */
export function robotFitsBudget(i: RobotInteraction): RobotBudgetReport {
  const usable = (['forward', 'left', 'right'] as const).filter((cmd) => i.allowed.includes(cmd));
  const moves = solveRobotMoves(i, usable);
  if (!moves) return { solvable: false, program: null, blocks: 0, fits: false };
  let program: RobotProgram = moves.map((cmd) => ({ cmd }));
  if (i.allowed.includes('repeat')) {
    const compressed = compressWithRepeat(program);
    if (countBlocks(compressed) < countBlocks(program)) program = compressed;
  }
  const blocks = countBlocks(program);
  return { solvable: true, program, blocks, fits: blocks <= i.maxCommands };
}
