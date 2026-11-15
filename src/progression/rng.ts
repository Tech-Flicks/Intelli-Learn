/**
 * All randomness in the progression service goes through one injectable source,
 * so item selection is reproducible in tests.
 */

/** Returns a number in [0, 1), like `Math.random`. */
export type Rng = () => number;

let currentRng: Rng = Math.random;

/** Replaces the module-level random source. Pass `null` to go back to `Math.random`. */
export function setRng(rng: Rng | null): void {
  currentRng = rng ?? Math.random;
}

export function getRng(): Rng {
  return currentRng;
}

/** Small deterministic generator (mulberry32) for tests and reproducible plans. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value of the rng forced into [0, 1), whatever an injected source returns. */
function unit(rng: Rng): number {
  const value = rng();
  if (!Number.isFinite(value) || value < 0) return 0;
  return value >= 1 ? 0.999999 : value;
}

export function chance(rng: Rng, probability: number): boolean {
  return unit(rng) < probability;
}

export function pickOne<T>(rng: Rng, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(unit(rng) * items.length)];
}

/**
 * Picks an item with a preference for the ones at the front of the list:
 * the weights are n, n-1, ..., 1, so the first of four is chosen 40% of the time.
 */
export function pickFrontWeighted<T>(rng: Rng, items: readonly T[]): T | undefined {
  const n = items.length;
  if (n === 0) return undefined;
  const total = (n * (n + 1)) / 2;
  let roll = unit(rng) * total;
  for (let i = 0; i < n; i += 1) {
    roll -= n - i;
    if (roll < 0) return items[i];
  }
  return items[n - 1];
}
