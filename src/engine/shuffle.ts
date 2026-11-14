/** Deterministic shuffling so a challenge looks the same every time it is opened. */

/** FNV-1a 32-bit hash. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded pseudo-random generator (mulberry32). Returns values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle with a seeded generator. Returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

export interface Labelled {
  id: string;
  label: string;
  emoji?: string | undefined;
}

/** What the child sees. Two items with the same signature are interchangeable. */
export function signatureOf(item: { label: string; emoji?: string | undefined }): string {
  return `${item.emoji ?? ''}\u0000${item.label.trim().toLowerCase()}`;
}

/**
 * Shuffles items deterministically from their ids. The result never shows the
 * same sequence as the input (compared by what the child sees), unless every
 * arrangement looks the same.
 */
export function shuffleAwayFrom<T extends Labelled>(items: readonly T[], salt = ''): T[] {
  if (items.length < 2) return items.slice();
  const seed = hashString(`${salt}|${items.map((item) => item.id).join('|')}`);
  const looksSame = (candidate: readonly T[]): boolean =>
    candidate.every((item, index) => signatureOf(item) === signatureOf(items[index] as T));
  let out = seededShuffle(items, seed);
  for (let turn = 0; turn < items.length && looksSame(out); turn += 1) {
    out = [...out.slice(1), out[0] as T]; // rotate until it differs
  }
  if (looksSame(out)) {
    // Rotations can all look alike (e.g. A B A B). Try a few more seeds.
    for (let extra = 1; extra <= 8 && looksSame(out); extra += 1) {
      out = seededShuffle(items, seed + extra * 7919);
    }
  }
  return out;
}

/** Shuffled ids for the order widget: never starts already solved. */
export function shuffledOrderIds(items: readonly Labelled[]): string[] {
  return shuffleAwayFrom(items, 'order').map((item) => item.id);
}
