/**
 * Semantic checks on a finished challenge: everything the schema cannot express but a child
 * would notice. Used as a safety net when picking offline content, and by the tests.
 */
import type { BuildInteraction, Challenge, RobotInteraction } from '@/core/schemas';
import { numberWords } from './speak';

type Move = 'forward' | 'left' | 'right';
const DIRS = ['up', 'right', 'down', 'left'] as const;
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/**
 * Shortest program of plain moves that collects every gem and ends on the goal, using only the
 * plain moves in `allowed`. Null when there is none. Breadth-first search.
 */
export function solveMaze(i: RobotInteraction): Move[] | null {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < i.cols && y < i.rows;
  const walls = new Set(i.walls.map((w) => `${w.x},${w.y}`));
  if (!inside(i.start.x, i.start.y) || !inside(i.goal.x, i.goal.y)) return null;
  if (walls.has(`${i.start.x},${i.start.y}`) || walls.has(`${i.goal.x},${i.goal.y}`)) return null;
  const gemBit = new Map<string, number>();
  for (const gem of i.gems) {
    const key = `${gem.x},${gem.y}`;
    if (!inside(gem.x, gem.y) || walls.has(key)) return null;
    if (!gemBit.has(key)) gemBit.set(key, gemBit.size);
  }
  const full = (1 << gemBit.size) - 1;
  const can = { forward: i.allowed.includes('forward'), left: i.allowed.includes('left'), right: i.allowed.includes('right') };
  const startMask = (() => {
    const bit = gemBit.get(`${i.start.x},${i.start.y}`);
    return bit === undefined ? 0 : 1 << bit;
  })();
  interface Node { x: number; y: number; d: number; mask: number; prev: number; move: Move | null }
  const nodes: Node[] = [{ x: i.start.x, y: i.start.y, d: DIRS.indexOf(i.start.dir), mask: startMask, prev: -1, move: null }];
  const seen = new Set<string>([`${i.start.x},${i.start.y},${nodes[0]?.d},${startMask}`]);
  for (let head = 0; head < nodes.length; head += 1) {
    const node = nodes[head] as Node;
    if (node.x === i.goal.x && node.y === i.goal.y && node.mask === full) {
      const out: Move[] = [];
      let cursor: Node | undefined = node;
      while (cursor && cursor.move) {
        out.push(cursor.move);
        cursor = nodes[cursor.prev];
      }
      return out.reverse();
    }
    const push = (x: number, y: number, d: number, mask: number, move: Move): void => {
      const key = `${x},${y},${d},${mask}`;
      if (seen.has(key)) return;
      seen.add(key);
      nodes.push({ x, y, d, mask, prev: head, move });
    };
    if (can.forward) {
      const nx = node.x + (DX[node.d] as number);
      const ny = node.y + (DY[node.d] as number);
      if (inside(nx, ny) && !walls.has(`${nx},${ny}`)) {
        const bit = gemBit.get(`${nx},${ny}`);
        push(nx, ny, node.d, bit === undefined ? node.mask : node.mask | (1 << bit), 'forward');
      }
    }
    if (can.left) push(node.x, node.y, (node.d + 3) % 4, node.mask, 'left');
    if (can.right) push(node.x, node.y, (node.d + 1) % 4, node.mask, 'right');
  }
  return null;
}

/** Selections of parts (as id lists) that reach the target within the budget. */
export function buildSolutions(i: BuildInteraction): string[][] {
  const out: string[][] = [];
  const n = i.parts.length;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let power = 0;
    let cost = 0;
    for (let b = 0; b < n; b += 1) {
      if (mask & (1 << b)) {
        power += i.parts[b]?.power ?? 0;
        cost += i.parts[b]?.cost ?? 0;
      }
    }
    if (power >= i.target - 1e-9 && cost <= i.budget + 1e-9) {
      out.push(i.parts.filter((_p, b) => (mask & (1 << b)) !== 0).map((p) => p.id));
    }
  }
  return out;
}

/** True when some selection reaches the target but costs too much: the tempting mistake. */
export function buildHasTemptingMistake(i: BuildInteraction): boolean {
  const n = i.parts.length;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let power = 0;
    let cost = 0;
    for (let b = 0; b < n; b += 1) {
      if (mask & (1 << b)) {
        power += i.parts[b]?.power ?? 0;
        cost += i.parts[b]?.cost ?? 0;
      }
    }
    if (power >= i.target && cost > i.budget) return true;
  }
  return false;
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

const look = (item: { label: string; emoji?: string | undefined }): string => `${item.emoji ?? ''}|${item.label.trim().toLowerCase()}`;

/** Numbers written with digits in a text. "1,250" counts as 1250. */
export function numbersIn(text: string): number[] {
  const cleaned = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return (cleaned.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Problems a child would run into. An empty list means the challenge is sound. */
export function problemsOf(c: Challenge): string[] {
  const problems: string[] = [];
  const dup = (what: string, ids: readonly string[]): void => {
    const d = duplicates(ids);
    if (d.length > 0) problems.push(`${what} repeat: ${d.join(', ')}`);
  };

  dup('scene object ids', c.scene.objects.map((o) => o.id));
  if (c.scene.objects.length < 3 || c.scene.objects.length > 15) problems.push(`the scene has ${c.scene.objects.length} objects`);
  for (const o of c.scene.objects) {
    if (o.type === 'emoji' && !o.emoji) problems.push(`scene object ${o.id} has no emoji`);
    if (o.type === 'shape' && !o.shape) problems.push(`scene object ${o.id} has no shape`);
    if (o.type === 'text' && !o.text) problems.push(`scene object ${o.id} has no text`);
    if (o.type === 'svg') problems.push(`scene object ${o.id} is an svg; offline content does not use svg`);
    if (o.anim?.kind === 'move' && o.anim.toX === undefined && o.anim.toY === undefined) problems.push(`scene object ${o.id} moves nowhere`);
  }

  const i = c.interaction;
  switch (i.kind) {
    case 'choice': {
      const ids = i.options.map((o) => o.id);
      dup('choice option ids', ids);
      dup('choice correct ids', i.correctIds);
      if (i.correctIds.some((id) => !ids.includes(id))) problems.push('a correct id is not an option');
      if (!i.multi && i.correctIds.length !== 1) problems.push('a single-choice question needs exactly one correct id');
      if (new Set(i.correctIds).size >= ids.length) problems.push('every option is correct');
      if (new Set(i.options.map(look)).size !== i.options.length) problems.push('two options look the same');
      for (const o of i.options) {
        if (i.correctIds.includes(o.id) && o.misconception) problems.push('a correct option carries a misconception');
      }
      break;
    }
    case 'tap': {
      dup('tap target ids', i.targetIds);
      const byId = new Map(c.scene.objects.map((o) => [o.id, o]));
      for (const id of i.targetIds) {
        const o = byId.get(id);
        if (!o) problems.push(`tap target ${id} is not in the scene`);
        else if (!o.tappable) problems.push(`tap target ${id} is not tappable`);
      }
      const tappable = c.scene.objects.filter((o) => o.tappable);
      if (tappable.length <= i.targetIds.length) problems.push('there is nothing wrong to tap, so there is nothing to decide');
      break;
    }
    case 'sort': {
      const binIds = i.bins.map((b) => b.id);
      dup('sort bin ids', binIds);
      dup('sort item ids', i.items.map((it) => it.id));
      if (i.items.some((it) => !binIds.includes(it.binId))) problems.push('a sort item points at an unknown bin');
      if (new Set(i.items.map((it) => it.binId)).size < 2) problems.push('every sort item goes in the same bin');
      if (new Set(i.bins.map(look)).size !== i.bins.length) problems.push('two bins look the same');
      const where = new Map<string, string>();
      for (const it of i.items) {
        const seenBin = where.get(look(it));
        if (seenBin !== undefined && seenBin !== it.binId) problems.push(`"${it.label}" appears twice with different bins`);
        where.set(look(it), it.binId);
      }
      break;
    }
    case 'match': {
      dup('match pair ids', i.pairs.map((p) => p.id));
      if (new Set(i.pairs.map((p) => look(p.left))).size !== i.pairs.length) problems.push('two left cards look the same');
      if (new Set(i.pairs.map((p) => look(p.right))).size !== i.pairs.length) problems.push('two right cards look the same');
      break;
    }
    case 'order': {
      dup('order item ids', i.items.map((it) => it.id));
      if (new Set(i.items.map(look)).size !== i.items.length) problems.push('two order items look the same');
      break;
    }
    case 'number': {
      if (!Number.isFinite(i.answer)) problems.push('the number answer is not finite');
      if (i.answer < 0 && !i.allowNegative) problems.push('a negative answer needs allowNegative');
      if (!Number.isInteger(i.answer) && !i.allowDecimal) problems.push('a decimal answer needs allowDecimal');
      if (Math.abs(i.answer) >= 1e9) problems.push('the number answer is too long to type');
      if ((String(i.answer).split('.')[1]?.length ?? 0) > 3) problems.push('the number answer has more than 3 decimal places');
      c.hints.forEach((hint, index) => {
        if (numbersIn(hint).includes(Math.abs(i.answer))) problems.push(`hint ${index + 1} states the answer`);
        // Small numbers such as "one" and "two" are ordinary words, so only bigger answers are checked as words.
        if (Number.isInteger(i.answer) && i.answer >= 3 && i.answer <= 999) {
          const word = numberWords(i.answer).toLowerCase();
          const spoken = ` ${hint.toLowerCase().replace(/[^a-z-]+/g, ' ')} `;
          if (spoken.includes(` ${word} `)) problems.push(`hint ${index + 1} states the answer in words`);
        }
      });
      break;
    }
    case 'robot': {
      const inside = (p: { x: number; y: number }): boolean => p.x >= 0 && p.y >= 0 && p.x < i.cols && p.y < i.rows;
      const walls = new Set(i.walls.map((w) => `${w.x},${w.y}`));
      if (i.walls.some((w) => !inside(w))) problems.push('a wall is outside the grid');
      dup('gem cells', i.gems.map((g) => `${g.x},${g.y}`));
      dup('wall cells', [...i.walls.map((w) => `${w.x},${w.y}`)]);
      if (i.gems.some((g) => g.x === i.start.x && g.y === i.start.y)) problems.push('a gem sits on the start');
      if (i.gems.some((g) => walls.has(`${g.x},${g.y}`))) problems.push('a gem sits on a wall');
      if (i.start.x === i.goal.x && i.start.y === i.goal.y) problems.push('the robot starts on the goal');
      if (!i.allowed.includes('forward')) problems.push('the robot may not move forward');
      const path = solveMaze(i);
      if (!path) problems.push('the maze cannot be solved');
      else if (path.length > i.maxCommands) problems.push(`the shortest path needs ${path.length} commands but only ${i.maxCommands} are allowed`);
      break;
    }
    case 'build': {
      dup('build part ids', i.parts.map((p) => p.id));
      const solutions = buildSolutions(i);
      if (solutions.length === 0) problems.push('no selection of parts reaches the target within the budget');
      if (solutions.some((s) => s.length === i.parts.length)) problems.push('picking every part works');
      if (!buildHasTemptingMistake(i)) problems.push('no selection overspends, so the budget never matters');
      break;
    }
  }

  if (c.teachBack) {
    dup('teach-back option ids', c.teachBack.options.map((o) => o.id));
    const right = c.teachBack.options.filter((o) => o.correct).length;
    if (right !== 1) problems.push(`the teach-back has ${right} correct options`);
    if (new Set(c.teachBack.options.map((o) => o.label.toLowerCase())).size !== c.teachBack.options.length) problems.push('two teach-back options read the same');
  }
  if (/[+=×÷<>%^√°→_*#@|~{}[\]()]|\d/.test(c.readAloud)) problems.push('the read-aloud text contains symbols or digits');
  if (c.hints[0].trim().toLowerCase() === c.hints[1].trim().toLowerCase()) problems.push('both hints are the same');
  return problems;
}
