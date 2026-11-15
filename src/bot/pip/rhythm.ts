/**
 * A mouth rhythm that looks like speech.
 *
 * The browser's text-to-speech gives no audio samples to analyse, so the mouth cannot follow
 * the real sound. Instead this makes up a believable stream: syllables of varying length and
 * loudness grouped into words, a short closing of the mouth between words, and a breath after
 * each phrase. `song` holds each note longer and adds a little vibrato.
 *
 * It is plain arithmetic on the elapsed time, so the caller decides the clock (one call per
 * animation frame) and tests can pass their own random source.
 */
export type RhythmMode = 'speech' | 'song';

interface Segment {
  sound: boolean;
  duration: number;
  /** Loudest opening of this sound, 0..1. Unused for a gap. */
  peak: number;
  /** How far the mouth stays open where this sound joins its neighbours in the same word. */
  floorIn: number;
  floorOut: number;
}

interface Timing {
  sound: readonly [number, number];
  wordGap: readonly [number, number];
  phraseGap: readonly [number, number];
  soundsPerWord: readonly [number, number];
  wordsPerPhrase: readonly [number, number];
}

const TIMING: Record<RhythmMode, Timing> = {
  speech: { sound: [105, 215], wordGap: [45, 95], phraseGap: [260, 520], soundsPerWord: [1, 4], wordsPerPhrase: [3, 7] },
  song: { sound: [280, 640], wordGap: [70, 130], phraseGap: [320, 520], soundsPerWord: [1, 3], wordsPerPhrase: [3, 6] },
};

/** The mouth never shuts completely between the syllables of one word. */
const JOIN_FLOOR = 0.22;
/** Vibrato of a held note: about 5.5 waves per second. */
const VIBRATO_RADIANS_PER_MS = (2 * Math.PI * 5.5) / 1000;

export class SpeechRhythm {
  private readonly random: () => number;
  private mode: RhythmMode;
  private segment: Segment | null = null;
  private elapsed = 0;
  private clock = 0;
  private soundsLeftInWord = 0;
  private wordsLeftInPhrase = 0;

  constructor(random: () => number = Math.random, mode: RhythmMode = 'speech') {
    this.random = random;
    this.mode = mode;
  }

  setMode(mode: RhythmMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.reset();
  }

  /** Forget where we were: the next `advance` starts a new phrase. */
  reset(): void {
    this.segment = null;
    this.elapsed = 0;
    this.soundsLeftInWord = 0;
    this.wordsLeftInPhrase = 0;
  }

  /** Moves the rhythm on by `dtMs` and returns how far the mouth is open now, 0..1. */
  advance(dtMs: number): number {
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    this.clock += dt;
    this.elapsed += dt;
    let segment = this.segment ?? this.startWord();
    // A long frame can step over several short segments.
    let guard = 0;
    while (this.elapsed >= segment.duration && guard < 64) {
      this.elapsed -= segment.duration;
      segment = this.following(segment);
      guard += 1;
    }
    this.segment = segment;
    return this.levelOf(segment, this.elapsed / segment.duration);
  }

  private levelOf(segment: Segment, progress: number): number {
    if (!segment.sound) return 0;
    const p = Math.min(1, Math.max(0, progress));
    const arch = Math.sin(Math.PI * p);
    const floor = p < 0.5 ? segment.floorIn : segment.floorOut;
    let shape: number;
    if (this.mode === 'song') {
      // Open quickly, hold the note, close quickly.
      shape = Math.min(1, arch * 1.7) + 0.05 * Math.sin(this.clock * VIBRATO_RADIANS_PER_MS);
    } else {
      shape = arch ** 0.75;
    }
    const level = segment.peak * (floor + (1 - floor) * shape);
    return Math.min(1, Math.max(0, level));
  }

  private between(range: readonly [number, number]): number {
    return range[0] + this.random() * (range[1] - range[0]);
  }

  private count(range: readonly [number, number]): number {
    return Math.min(range[1], range[0] + Math.floor(this.random() * (range[1] - range[0] + 1)));
  }

  private startWord(): Segment {
    const timing = TIMING[this.mode];
    if (this.wordsLeftInPhrase <= 0) this.wordsLeftInPhrase = this.count(timing.wordsPerPhrase);
    this.soundsLeftInWord = this.count(timing.soundsPerWord);
    return this.nextSound(true);
  }

  private nextSound(first: boolean): Segment {
    const timing = TIMING[this.mode];
    this.soundsLeftInWord -= 1;
    const last = this.soundsLeftInWord <= 0;
    // The first syllable of a word carries the stress.
    const peak = first ? 0.66 + this.random() * 0.34 : 0.42 + this.random() * 0.43;
    return {
      sound: true,
      duration: this.between(timing.sound),
      peak: this.mode === 'song' ? Math.max(peak, 0.6) : peak,
      floorIn: first ? 0 : JOIN_FLOOR,
      floorOut: last ? 0 : JOIN_FLOOR,
    };
  }

  private following(previous: Segment): Segment {
    if (!previous.sound) return this.startWord();
    if (this.soundsLeftInWord > 0) return this.nextSound(false);
    const timing = TIMING[this.mode];
    this.wordsLeftInPhrase -= 1;
    const endOfPhrase = this.wordsLeftInPhrase <= 0;
    return {
      sound: false,
      duration: this.between(endOfPhrase ? timing.phraseGap : timing.wordGap),
      peak: 0,
      floorIn: 0,
      floorOut: 0,
    };
  }
}
