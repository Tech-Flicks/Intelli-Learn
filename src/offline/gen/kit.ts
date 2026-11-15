/** Small helpers shared by the procedural problem makers. */
import type { ShapeName } from '@/core/schemas';
import type { Teach } from '../assemble';
import type { Ctx } from '../context';
import type { Mistake, Problem, TextOption } from '../problem';
import { cardScene, stackScene, type Card, type SceneInput } from '../scene';
import type { Thing } from '../themes';

export const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_v, i) => from + i);
export const titleOf = (ctx: Ctx, name: string): string => `${ctx.theme.label} ${name}`;
export const thingOf = (ctx: Ctx): Thing => ctx.rng.pick(ctx.theme.things);

/** Groups of the same emoji, at most 13 in all. */
export function thingScene(ctx: Ctx, groups: readonly { emoji: string; count: number }[]): SceneInput {
  const cards: Card[] = [];
  groups.forEach((group, groupIndex) => {
    for (let i = 0; i < group.count && cards.length < 13; i += 1) cards.push({ id: `g${groupIndex + 1}n${i + 1}`, emoji: group.emoji });
  });
  return cardScene(ctx.theme.scene, cards);
}

/** The sum, rule or little program on a board, with the theme's hero beside it. */
export function boardScene(ctx: Ctx, lines: readonly string[]): SceneInput {
  return stackScene(ctx.theme.scene, lines, ctx.theme.hero);
}

const SHAPE_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#eab308'] as const;

/** A row or grid of colored shapes. */
export function shapeScene(ctx: Ctx, shapes: readonly ShapeName[]): SceneInput {
  return cardScene(
    ctx.theme.scene,
    shapes.slice(0, 13).map((shape, index) => ({ shape, color: SHAPE_COLORS[index % SHAPE_COLORS.length] as string })),
  );
}

/** Compact problem description used by the makers. */
export interface Spec {
  name: string;
  intro: string;
  q: string;
  a: number;
  unit?: string;
  h: readonly [string, string];
  steps: readonly string[];
  why: string;
  /** [wrong value, kind explanation] */
  wrong: readonly (readonly [number, string])[];
  teach: Teach;
  fun?: string;
  /** Lines for the board scene; ignored when `scene` is given. */
  lines?: readonly string[];
  scene?: SceneInput;
  dec?: boolean;
  neg?: boolean;
  options?: { right: TextOption; wrong: readonly TextOption[] };
  choiceOnly?: boolean;
  numberOnly?: boolean;
}

export function problem(ctx: Ctx, s: Spec): Problem {
  const mistakes: Mistake[] = s.wrong.map(([value, why]) => ({ value, why }));
  return {
    title: titleOf(ctx, s.name),
    intro: s.intro,
    question: s.q,
    answer: s.a,
    hints: s.h,
    steps: s.steps,
    explain: s.why,
    mistakes,
    teach: s.teach,
    scene: s.scene ?? boardScene(ctx, s.lines ?? [s.q.slice(0, 40)]),
    ...(s.unit ? { unit: s.unit } : {}),
    ...(s.fun ? { fun: s.fun } : {}),
    ...(s.dec ? { allowDecimal: true } : {}),
    ...(s.neg ? { allowNegative: true } : {}),
    ...(s.options ? { options: s.options } : {}),
    ...(s.choiceOnly ? { choiceOnly: true } : {}),
    ...(s.numberOnly ? { numberOnly: true } : {}),
  };
}

/** Rounds away floating point noise: 0.1 + 0.2 -> 0.3. */
export const tidy = (value: number): number => Math.round(value * 1000) / 1000;
