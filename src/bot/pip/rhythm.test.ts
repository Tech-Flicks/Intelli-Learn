import { describe, expect, it } from 'vitest';
import { SpeechRhythm } from './rhythm';

/** A small repeatable random source (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(rhythm: SpeechRhythm, seconds: number, frameMs = 1000 / 60): number[] {
  const levels: number[] = [];
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += frameMs) levels.push(rhythm.advance(frameMs));
  return levels;
}

/** Counts the times the mouth opens: rises through `threshold`. */
function openings(levels: number[], threshold = 0.3): number {
  let count = 0;
  for (let i = 1; i < levels.length; i += 1) {
    if ((levels[i - 1] ?? 0) < threshold && (levels[i] ?? 0) >= threshold) count += 1;
  }
  return count;
}

describe('SpeechRhythm', () => {
  it('stays between closed and fully open', () => {
    for (const seed of [1, 2, 3]) {
      for (const mode of ['speech', 'song'] as const) {
        const levels = sample(new SpeechRhythm(seeded(seed), mode), 20);
        expect(Math.min(...levels)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...levels)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('looks like speech: wide openings, closed pauses, a few syllables per second', () => {
    const levels = sample(new SpeechRhythm(seeded(7)), 20);
    expect(Math.max(...levels)).toBeGreaterThan(0.85);
    expect(levels.filter((level) => level < 0.03).length).toBeGreaterThan(levels.length * 0.08);
    const perSecond = openings(levels) / 20;
    expect(perSecond).toBeGreaterThan(2.5);
    expect(perSecond).toBeLessThan(9);
  });

  it('breathes between phrases: some pauses are a quarter of a second or longer', () => {
    const levels = sample(new SpeechRhythm(seeded(11)), 20);
    let longest = 0;
    let run = 0;
    for (const level of levels) {
      run = level === 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect((longest * 1000) / 60).toBeGreaterThanOrEqual(250);
  });

  it('holds the notes of a song longer than the syllables of speech', () => {
    const speech = openings(sample(new SpeechRhythm(seeded(5), 'speech'), 20));
    const song = openings(sample(new SpeechRhythm(seeded(5), 'song'), 20));
    expect(song).toBeLessThan(speech * 0.7);
  });

  it('is the same on every run with the same random source', () => {
    expect(sample(new SpeechRhythm(seeded(42)), 3)).toEqual(sample(new SpeechRhythm(seeded(42)), 3));
  });

  it('starts a new phrase after reset and when the mode changes', () => {
    const rhythm = new SpeechRhythm(seeded(9));
    sample(rhythm, 1);
    rhythm.reset();
    // The first frame of a phrase is the very start of a syllable: nearly closed.
    expect(rhythm.advance(1)).toBeLessThan(0.1);
    sample(rhythm, 1);
    rhythm.setMode('song');
    expect(rhythm.advance(1)).toBeLessThan(0.15);
  });

  it('copes with a very long frame and with nonsense input', () => {
    const rhythm = new SpeechRhythm(seeded(3));
    expect(Number.isFinite(rhythm.advance(5000))).toBe(true);
    expect(Number.isFinite(rhythm.advance(Number.NaN))).toBe(true);
    expect(Number.isFinite(rhythm.advance(-20))).toBe(true);
  });
});
