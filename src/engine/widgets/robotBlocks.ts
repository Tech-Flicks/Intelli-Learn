/**
 * Editing model for the Robot Coder program strip. Pure logic.
 *
 * The widget edits a tree of blocks that each carry a stable `uid` (for React
 * keys, drag-reorder and "which block is running" highlighting). The answer
 * handed to `checkAnswer` is the same tree without the uids.
 */
import { clampRepeatTimes, MAX_EXECUTED_MOVES, type RobotMove } from '../robot';
import type { RobotProgram, RobotStep } from '../types';

export type BlockCmd = 'forward' | 'left' | 'right' | 'repeat';

export interface Block {
  uid: string;
  cmd: BlockCmd;
  /** Only meaningful for repeat blocks. */
  times: number;
  body: Block[];
}

/** A repeat may sit inside a repeat, but no deeper: enough power, still readable. */
export const MAX_BLOCK_DEPTH = 2;

let counter = 0;
export function newUid(): string {
  counter += 1;
  return `b${counter.toString(36)}`;
}

export function makeBlock(cmd: BlockCmd, uid: string = newUid()): Block {
  return { uid, cmd, times: 2, body: [] };
}

export function toProgram(blocks: readonly Block[]): RobotProgram {
  return blocks.map(
    (block): RobotStep =>
      block.cmd === 'repeat'
        ? { cmd: 'repeat', times: clampRepeatTimes(block.times), body: toProgram(block.body) }
        : { cmd: block.cmd },
  );
}

export function fromProgram(program: RobotProgram): Block[] {
  return program.map((step) =>
    step.cmd === 'repeat'
      ? { uid: newUid(), cmd: 'repeat', times: clampRepeatTimes(step.times), body: fromProgram(step.body) }
      : makeBlock(step.cmd),
  );
}

export function countBlockTree(blocks: readonly Block[]): number {
  let total = 0;
  for (const block of blocks) total += 1 + (block.cmd === 'repeat' ? countBlockTree(block.body) : 0);
  return total;
}

export function findBlock(blocks: readonly Block[], uid: string): Block | null {
  for (const block of blocks) {
    if (block.uid === uid) return block;
    const inner = findBlock(block.body, uid);
    if (inner) return inner;
  }
  return null;
}

/** Nesting depth of the list a block lives in: 0 for the main program, 1 inside a repeat, ... or -1. */
export function depthOf(blocks: readonly Block[], uid: string, depth = 0): number {
  for (const block of blocks) {
    if (block.uid === uid) return depth;
    const inner = depthOf(block.body, uid, depth + 1);
    if (inner !== -1) return inner;
  }
  return -1;
}

/** Applies `edit` to the list that is the body of `parentUid` (or the main program for null). */
function editList(blocks: readonly Block[], parentUid: string | null, edit: (list: Block[]) => Block[]): Block[] {
  if (parentUid === null) return edit(blocks.slice());
  return blocks.map((block) => {
    if (block.uid === parentUid) return { ...block, body: edit(block.body.slice()) };
    if (block.body.length === 0) return block;
    return { ...block, body: editList(block.body, parentUid, edit) };
  });
}

/** uid of the repeat block that contains `uid`, null for the main program, undefined when not found. */
export function parentOf(blocks: readonly Block[], uid: string, parent: string | null = null): string | null | undefined {
  for (const block of blocks) {
    if (block.uid === uid) return parent;
    const inner = parentOf(block.body, uid, block.uid);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/**
 * Appends a block to the main program (targetUid null) or to a repeat's body.
 * Returns the input unchanged when the target is gone, or when a repeat would
 * nest too deep.
 */
export function addBlock(blocks: readonly Block[], targetUid: string | null, block: Block): Block[] {
  if (targetUid !== null) {
    const target = findBlock(blocks, targetUid);
    if (!target || target.cmd !== 'repeat') return blocks.slice();
    const targetDepth = depthOf(blocks, targetUid) + 1; // depth of the body list
    if (block.cmd === 'repeat' && targetDepth >= MAX_BLOCK_DEPTH) return blocks.slice();
  }
  return editList(blocks, targetUid, (list) => [...list, block]);
}

export function removeBlock(blocks: readonly Block[], uid: string): Block[] {
  return blocks.filter((block) => block.uid !== uid).map((block) => (block.body.length ? { ...block, body: removeBlock(block.body, uid) } : block));
}

/** Moves a block earlier (-1) or later (+1) inside its own list. */
export function moveBlock(blocks: readonly Block[], uid: string, delta: -1 | 1): Block[] {
  const parent = parentOf(blocks, uid);
  if (parent === undefined) return blocks.slice();
  return editList(blocks, parent, (list) => {
    const index = list.findIndex((block) => block.uid === uid);
    const next = index + delta;
    if (index === -1 || next < 0 || next >= list.length) return list;
    const moved = list[index] as Block;
    list[index] = list[next] as Block;
    list[next] = moved;
    return list;
  });
}

export function setTimes(blocks: readonly Block[], uid: string, times: number): Block[] {
  return blocks.map((block) => {
    if (block.uid === uid) return { ...block, times: clampRepeatTimes(times) };
    return block.body.length ? { ...block, body: setTimes(block.body, uid, times) } : block;
  });
}

/** Replaces the order of one list (after a drag) with `ordered`, which must hold the same blocks. */
export function reorderList(blocks: readonly Block[], parentUid: string | null, ordered: readonly Block[]): Block[] {
  return editList(blocks, parentUid, (list) => {
    const same = list.length === ordered.length && ordered.every((b) => list.some((l) => l.uid === b.uid));
    return same ? ordered.map((b) => list.find((l) => l.uid === b.uid) as Block) : list;
  });
}

export interface SourcedMove {
  cmd: RobotMove;
  /** uid of the block that produced this move. */
  uid: string;
}

/** The moves the program will run, each tagged with the block it came from (same order as runRobot). */
export function expandWithSource(blocks: readonly Block[], limit = MAX_EXECUTED_MOVES): SourcedMove[] {
  const out: SourcedMove[] = [];
  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      if (out.length >= limit) return;
      if (block.cmd === 'repeat') {
        const times = clampRepeatTimes(block.times);
        for (let n = 0; n < times && out.length < limit; n += 1) walk(block.body);
      } else {
        out.push({ cmd: block.cmd, uid: block.uid });
      }
    }
  };
  walk(blocks);
  return out;
}
