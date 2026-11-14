/**
 * A "problem" is a question with one numeric answer, the typical mistakes, and its teaching
 * texts. It can be asked as a number entry or as a multiple-choice question.
 */
import type { Challenge } from '@/core/schemas';
import { assemble, type InteractionInput, type Teach } from './assemble';
import type { Ctx } from './context';
import type { SceneInput } from './scene';

export interface Mistake {
  value: number;
  /** Kind feedback that explains the likely misunderstanding. */
  why: string;
}

export interface TextOption {
  label: string;
  emoji?: string;
  why?: string;
}

export interface Problem {
  title: string;
  intro: string;
  question: string;
  answer: number;
  unit?: string;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  tolerance?: number;
  hints: readonly [string, string];
  steps: readonly string[];
  explain: string;
  mistakes: readonly Mistake[];
  teach: Teach;
  fun?: string;
  scene: SceneInput;
  /** When the natural choices are not numbers: the correct option and the wrong ones. */
  options?: { right: TextOption; wrong: readonly TextOption[] };
  /** The problem only makes sense as multiple choice. */
  choiceOnly?: boolean;
  /** The problem only makes sense as number entry. */
  numberOnly?: boolean;
}

export type ProblemMaker = (ctx: Ctx) => Problem | null;

const LETTERS = ['a', 'b', 'c', 'd'] as const;

/** 1250 -> "1,250"; keeps decimals as they are. */
export function fmt(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1000) / 1000;
  const [whole = '0', fraction] = String(Math.abs(rounded)).split('.');
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${rounded < 0 ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

function withUnit(value: number, unit: string | undefined): string {
  if (!unit) return fmt(value);
  return unit === '°' || unit === '%' ? `${fmt(value)}${unit}` : `${fmt(value)} ${unit}`;
}

export function numberFromProblem(ctx: Ctx, p: Problem): Challenge | null {
  if (p.choiceOnly) return null;
  return assemble(ctx, {
    title: p.title,
    intro: p.intro,
    question: p.question,
    interaction: {
      kind: 'number',
      answer: p.answer,
      tolerance: p.tolerance ?? 0,
      ...(p.unit ? { unit: p.unit } : {}),
      allowDecimal: p.allowDecimal ?? !Number.isInteger(p.answer),
      allowNegative: p.allowNegative ?? p.answer < 0,
    },
    hints: p.hints,
    walkthrough: p.steps,
    explanation: p.explain,
    teach: p.teach,
    funFact: p.fun,
    scene: p.scene,
  });
}

export function choiceFromProblem(ctx: Ctx, p: Problem): Challenge | null {
  if (p.numberOnly) return null;
  const want = ctx.young ? 2 : 3;
  let right: TextOption;
  let wrong: TextOption[];
  if (p.options) {
    right = p.options.right;
    wrong = ctx.rng.shuffle(p.options.wrong).slice(0, want);
  } else {
    const seen = new Set<number>([p.answer]);
    const picked: Mistake[] = [];
    const usable = (v: number): boolean =>
      Number.isFinite(v) && !seen.has(v) && (v >= 0 || p.allowNegative === true || p.answer < 0) && (Number.isInteger(v) || !Number.isInteger(p.answer) || p.allowDecimal === true);
    for (const m of p.mistakes) {
      if (picked.length < want && usable(m.value)) {
        picked.push(m);
        seen.add(m.value);
      }
    }
    // Fill up with near misses so there are always enough choices.
    const step = Number.isInteger(p.answer) ? 1 : 0.1;
    const fillers = [p.answer + step, p.answer - step, p.answer + 2 * step, p.answer + 10 * step, p.answer - 2 * step, p.answer + 3 * step, p.answer + 4 * step];
    for (const raw of fillers) {
      const v = Math.round(raw * 1000) / 1000;
      if (picked.length < want && usable(v)) {
        picked.push({ value: v, why: 'Close, but check each step once more.' });
        seen.add(v);
      }
    }
    if (picked.length < 2) return null;
    right = { label: withUnit(p.answer, p.unit) };
    wrong = picked.map((m) => ({ label: withUnit(m.value, p.unit), why: m.why }));
  }
  if (wrong.length < 2 && !(ctx.young && wrong.length === 1)) return null;
  const all = ctx.rng.shuffle([{ ...right, right: true }, ...wrong.map((w) => ({ ...w, right: false }))]);
  if (!p.options) all.sort((a, b) => Number(a.label.replace(/[^\d.-]/g, '')) - Number(b.label.replace(/[^\d.-]/g, '')));
  const interaction: InteractionInput = {
    kind: 'choice',
    multi: false,
    options: all.map((o, index) => ({
      id: LETTERS[index] as string,
      label: o.label,
      ...(o.emoji ? { emoji: o.emoji } : {}),
      ...(!o.right && o.why ? { misconception: o.why.slice(0, 200) } : {}),
    })),
    correctIds: [LETTERS[all.findIndex((o) => o.right)] as string],
  };
  return assemble(ctx, {
    title: p.title,
    intro: p.intro,
    question: p.question,
    interaction,
    hints: p.hints,
    walkthrough: p.steps,
    explanation: p.explain,
    teach: p.teach,
    funFact: p.fun,
    scene: p.scene,
  });
}
