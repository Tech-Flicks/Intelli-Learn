/** Invention Workshop helpers. Pure logic. */
import type { BuildInteraction } from '@/core/schemas';

/** Guard against floating point noise when comparing sums like 0.1 + 0.2. */
const EPS = 1e-9;

export interface BuildTotals {
  power: number;
  cost: number;
  meetsTarget: boolean;
  withinBudget: boolean;
}

/** Totals for a selection of part ids. Unknown and repeated ids are ignored. */
export function buildTotals(i: BuildInteraction, partIds: readonly string[]): BuildTotals {
  const chosen = new Set(partIds);
  let power = 0;
  let cost = 0;
  for (const part of i.parts) {
    if (chosen.has(part.id)) {
      power += part.power;
      cost += part.cost;
    }
  }
  return {
    power,
    cost,
    meetsTarget: power >= i.target - EPS,
    withinBudget: cost <= i.budget + EPS,
  };
}

/** Every subset of parts (as id lists) that meets the target within the budget. */
export function buildSolutions(i: BuildInteraction, limit = Infinity): string[][] {
  const parts = i.parts;
  const n = Math.min(parts.length, 16); // schema allows at most 8; cap to keep the search tiny
  const out: string[][] = [];
  for (let mask = 1; mask < 1 << n && out.length < limit; mask += 1) {
    let power = 0;
    let cost = 0;
    for (let b = 0; b < n; b += 1) {
      if (mask & (1 << b)) {
        const part = parts[b];
        if (part) {
          power += part.power;
          cost += part.cost;
        }
      }
    }
    if (power >= i.target - EPS && cost <= i.budget + EPS) {
      out.push(parts.filter((_, b) => b < n && (mask & (1 << b)) !== 0).map((p) => p.id));
    }
  }
  return out;
}

/** True when at least one selection of parts reaches the target within the budget. */
export function buildIsSolvable(i: BuildInteraction): boolean {
  return buildSolutions(i, 1).length > 0;
}

/** True when simply picking every part works: there is no decision to make. */
export function buildIsTrivial(i: BuildInteraction): boolean {
  const all = buildTotals(
    i,
    i.parts.map((p) => p.id),
  );
  return all.meetsTarget && all.withinBudget;
}
