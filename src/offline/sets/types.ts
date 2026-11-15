/**
 * Knowledge sets: small, fact-checked collections that the renderers in `../render` can turn
 * into many different challenges (sort, tap, choice, match, order, count).
 *
 * Writing rules for the data files:
 * - Labels are written the way they read inside a sentence ("polar bear", "Mars"); cards
 *   capitalize them.
 * - A set whose grade range includes Pre-K or K uses one very short sentence for every text.
 * - `hint` nudges without naming an answer. `rule` texts state the idea, never a specific item.
 */
import type { SceneTheme } from '@/core/schemas';
import type { Grade, Strand } from '@/core/types';
import type { Teach } from '../assemble';

export interface Item {
  label: string;
  emoji?: string;
  /** The emoji is a row of several pictures ("🔴🔴🔷") that a child counts: it is drawn as one wide card. */
  wide?: boolean;
}

interface SetBase {
  id: string;
  strand: Strand;
  /** Skill ids this set practises. */
  skills: readonly string[];
  /** Lowest and highest grade the set suits. */
  grades: readonly [Grade, Grade];
  title: string;
  /** One sentence that sets the scene. */
  intro: string;
  hint: string;
  explain: string;
  fun?: string;
  teach: Teach;
  scene: SceneTheme;
  /** Emoji drawn when the items themselves have none. */
  icons?: readonly string[];
}

export interface CatBin {
  label: string;
  emoji?: string;
  /** "a living thing" */
  one: string;
  /** "living things" */
  many: string;
  /** The idea behind the group, as one sentence. */
  rule: string;
  items: readonly Item[];
}

/** Things that belong in groups. */
export interface CatSet extends SetBase {
  type: 'cat';
  bins: readonly CatBin[];
}

export interface Pair {
  left: Item;
  right: Item;
  why?: string;
}

/** Things that go together one to one. */
export interface PairSet extends SetBase {
  type: 'pair';
  /** The match task, e.g. "Match each animal to its home." */
  ask: string;
  /** A question about one left item, with {x} for its label: "Where does the {x} live?" */
  q: string;
  /** The same as a tap task: "Tap the home of the {x}." */
  tapQ: string;
  /** What links left and right, e.g. "an animal and its home". Enables analogy questions. */
  link?: string;
  pairs: readonly Pair[];
}

/** Things with one correct order. */
export interface SeqSet extends SetBase {
  type: 'seq';
  /** The order task, worded so it also fits a part of the sequence. */
  ask: string;
  items: readonly Item[];
  /** Words for the two ends: ['first', 'last'] or superlatives such as ['smallest', 'biggest']. */
  ends: readonly [string, string];
  /** For orders by size or amount: comparison words, e.g. ['smaller than', 'bigger than']. */
  rel?: readonly [string, string];
  /** Article put before an item label in a comparison: 'the' (default), 'a', or ''. */
  article?: string;
  /** Always use every item, never a part of the sequence. */
  whole?: boolean;
}

/** One hand-written multiple-choice question. */
export interface QuizSet extends SetBase {
  type: 'quiz';
  q: string;
  right: Item;
  wrong: readonly { label: string; emoji?: string; why?: string }[];
  hint2: string;
  steps: readonly string[];
}

export type KnowledgeSet = CatSet | PairSet | SeqSet | QuizSet;

/** "dog|🐶" -> { label: 'dog', emoji: '🐶' } */
export function item(text: string): Item {
  const [label = '', emoji] = text.split('|').map((part) => part.trim());
  return emoji ? { label, emoji } : { label };
}

/** "dog|🐶; tree|🌳" -> items */
export function items(text: string): Item[] {
  return text
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(item);
}

/** bin('Living|🌱', 'a living thing', 'living things', 'Living things grow.', 'dog|🐶; tree|🌳') */
export function bin(label: string, one: string, many: string, rule: string, itemText: string): CatBin {
  const head = item(label);
  return { ...head, one, many, rule, items: items(itemText) };
}

/** "penguin|🐧 > ice and snow|❄️ > Penguins have thick fat to stay warm." */
export function pairs(lines: readonly string[]): Pair[] {
  return lines.map((line) => {
    const [left = '', right = '', why] = line.split('>').map((part) => part.trim());
    return why ? { left: item(left), right: item(right), why } : { left: item(left), right: item(right) };
  });
}
