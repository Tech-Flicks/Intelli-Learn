/** Compact notation for the hand-written challenges in the curated bank. */
import { ChallengeSchema, type Challenge, type SceneTheme } from '@/core/schemas';
import { getSkill } from '@/core/skills';
import type { Grade, Mode, Strand } from '@/core/types';
import type { InteractionInput, Teach } from '../assemble';
import { teachBackOf } from '../assemble';
import { hashText } from '../rng';
import { cardScene, pictureScene, type Card, type SceneInput } from '../scene';
import { speakable } from '../speak';

export interface CuratedItem {
  id: string;
  skillId: string;
  strand: Strand;
  /** Lowest and highest grade the item suits. */
  grades: readonly [Grade, Grade];
  mode: Mode;
  challenge: Challenge;
}

/** How the child answers, in short form. Text parts use "label|emoji|extra". */
export type Answer =
  /** First entry is correct; wrong entries are "label|emoji|kind feedback". */
  | { choice: readonly string[] }
  | { number: number; unit?: string }
  /** bins: "label|emoji"; items: "label|emoji|bin number starting at 1". */
  | { sort: { bins: readonly string[]; items: readonly string[] } }
  /** Items in the correct order. */
  | { order: readonly string[]; ends?: readonly [string, string] }
  /** "left|emoji > right|emoji" */
  | { match: readonly string[] }
  /** cards: "emoji|label|x" where x marks a card to tap. */
  | { tap: readonly string[] }
  /** parts: "label|emoji|power|cost" */
  | { build: { goal: string; power: string; cost: string; target: number; budget: number; parts: readonly string[] } };

export interface Draft {
  title: string;
  intro: string;
  q: string;
  answer: Answer;
  hints: readonly [string, string];
  steps: readonly string[];
  why: string;
  teach: Teach;
  fun?: string;
  theme: SceneTheme;
  /** Emoji for the picture, each optionally with a caption: "🧊|ice". Not used for tap answers. */
  pic?: readonly string[];
}

const split = (text: string): string[] => text.split('|').map((part) => part.trim());
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;

function labelled(text: string): { label: string; emoji?: string } {
  const [label = '', emoji] = split(text);
  return emoji ? { label, emoji } : { label };
}

function interactionOf(draft: Draft): { interaction: InteractionInput; scene?: SceneInput } {
  const a = draft.answer;
  if ('choice' in a) {
    const turn = hashText(draft.title) % a.choice.length;
    const arranged = a.choice.map((text, index) => ({ text, right: index === 0 }));
    const rotated = [...arranged.slice(turn), ...arranged.slice(0, turn)];
    return {
      interaction: {
        kind: 'choice',
        multi: false,
        options: rotated.map((option, index) => {
          const parts = split(option.text);
          // "label|feedback" is allowed as a short form of "label||feedback".
          const second = parts[1] ?? '';
          const isText = /\s/.test(second) || Array.from(second).length > 7;
          const label = parts[0] ?? '';
          const emoji = isText ? '' : second;
          const why = isText ? second : parts[2];
          return { id: LETTERS[index] as string, label, ...(emoji ? { emoji } : {}), ...(!option.right && why ? { misconception: why } : {}) };
        }),
        correctIds: [LETTERS[rotated.findIndex((o) => o.right)] as string],
      },
    };
  }
  if ('number' in a) {
    return { interaction: { kind: 'number', answer: a.number, tolerance: 0, ...(a.unit ? { unit: a.unit } : {}), allowDecimal: !Number.isInteger(a.number), allowNegative: a.number < 0 } };
  }
  if ('sort' in a) {
    return {
      interaction: {
        kind: 'sort',
        bins: a.sort.bins.map((text, index) => ({ id: `bin${index + 1}`, ...labelled(text) })),
        items: a.sort.items.map((text, index) => {
          const [label = '', emoji, binNumber = '1'] = split(text);
          return { id: `item${index + 1}`, label, ...(emoji ? { emoji } : {}), binId: `bin${binNumber}` };
        }),
      },
    };
  }
  if ('order' in a) {
    return { interaction: { kind: 'order', items: a.order.map((text, index) => ({ id: `step${index + 1}`, ...labelled(text) })), startLabel: a.ends?.[0] ?? 'first', endLabel: a.ends?.[1] ?? 'last' } };
  }
  if ('match' in a) {
    return {
      interaction: {
        kind: 'match',
        pairs: a.match.map((line, index) => {
          const [left = '', right = ''] = line.split('>');
          return { id: `pair${index + 1}`, left: labelled(left), right: labelled(right) };
        }),
      },
    };
  }
  if ('tap' in a) {
    const cards: Card[] = [];
    const targets: string[] = [];
    a.tap.forEach((text, index) => {
      const [emoji = '⭐', label, mark] = split(text);
      const id = `card${index + 1}`;
      cards.push({ id, emoji, tappable: true, ...(label ? { label } : {}) });
      if (mark === 'x') targets.push(id);
    });
    return { interaction: { kind: 'tap', targetIds: targets }, scene: cardScene(draft.theme, cards) };
  }
  return {
    interaction: {
      kind: 'build',
      goalLabel: a.build.goal,
      powerLabel: a.build.power,
      costLabel: a.build.cost,
      target: a.build.target,
      budget: a.build.budget,
      parts: a.build.parts.map((text, index) => {
        const [label = '', emoji, power = '0', cost = '0'] = split(text);
        return { id: `part${index + 1}`, label, ...(emoji ? { emoji } : {}), power: Number(power), cost: Number(cost) };
      }),
    },
  };
}

/** Builds one curated item. Throws at load time when the text does not form a valid challenge. */
export function curated(id: string, skillId: string, grades: readonly [Grade, Grade], mode: Mode, draft: Draft): CuratedItem {
  const skill = getSkill(skillId);
  if (!skill) throw new Error(`Curated item ${id} names the unknown skill ${skillId}`);
  const { interaction, scene } = interactionOf(draft);
  const pic = (draft.pic ?? ['⭐']).map(split);
  const order = [0, 1, 2].map((i) => (i + hashText(draft.title)) % 3);
  const teachCount = draft.teach.filter((x) => typeof x === 'string').length - 1;
  const challenge = ChallengeSchema.parse({
    title: draft.title,
    intro: draft.intro,
    question: draft.q,
    readAloud: speakable(`${draft.intro} ${draft.q}`),
    interaction,
    hints: [...draft.hints],
    walkthrough: [...draft.steps],
    explanation: draft.why,
    teachBack: teachBackOf(draft.teach, teachCount === 3 ? order : [hashText(draft.title) % 2, (hashText(draft.title) + 1) % 2]),
    ...(draft.fun ? { funFact: draft.fun } : {}),
    scene: scene ?? pictureScene(draft.theme, pic.map((p) => p[0] ?? '⭐'), pic.map((p) => p[1])),
  });
  return { id, skillId, strand: skill.strand, grades, mode, challenge };
}
