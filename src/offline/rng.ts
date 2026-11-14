/** Small seeded pseudo-random generator (mulberry32) with the helpers the generators need. */
export interface Rng {
  /** A value in [0, 1). */
  next(): number;
  /** A whole number between min and max, both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** Up to `count` different items in random order. */
  sample<T>(items: readonly T[], count: number): T[];
  chance(probability: number): boolean;
}

export function createRng(seed: number): Rng {
  let a = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(next() * (hi - lo + 1));
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const held = out[i] as T;
      out[i] = out[j] as T;
      out[j] = held;
    }
    return out;
  };
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('cannot pick from an empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle,
    sample: <T>(items: readonly T[], count: number): T[] => shuffle(items).slice(0, Math.max(0, count)),
    chance: (probability: number): boolean => next() < probability,
  };
}

/** A fresh seed for callers that do not need repeatable content. */
export function defaultSeed(): number {
  return Math.floor(Date.now() + Math.random() * 0xffffffff) >>> 0;
}

/** FNV-1a hash, used to mix a plan into the seed so different plans differ even with one seed. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
