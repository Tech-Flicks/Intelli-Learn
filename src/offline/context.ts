/** Everything a generator needs to know about one request. */
import { getSkill } from '@/core/skills';
import { stageGrade, stageGradeIndex, STEPS_PER_GRADE, clampStage } from '@/core/grades';
import type { ChallengePlan, Grade, SkillDef } from '@/core/types';
import type { Challenge } from '@/core/schemas';
import { createRng, type Rng } from './rng';
import { resolveTheme, type ThemeInfo } from './themes';

/** Grade bands used to pitch content: 0 = Pre-K and K, 1 = Grades 1-2, 2 = Grades 3-5, 3 = Grades 6-8. */
export type Band = 0 | 1 | 2 | 3;

export interface Ctx {
  plan: ChallengePlan;
  rng: Rng;
  grade: Grade;
  /** Grade index: 0 = Pre-K ... 9 = Grade 8. */
  g: number;
  band: Band;
  /** Step inside the grade, 0 (starting) .. 3 (ready). */
  step: number;
  /** Pre-K and Kindergarten: every text is one very short sentence. */
  young: boolean;
  theme: ThemeInfo;
  /** True when plan.theme was recognised, so it may be named in the text. */
  themed: boolean;
  skill: SkillDef | undefined;
}

export type Generator = (ctx: Ctx) => Challenge | null;

export function bandOf(g: number): Band {
  if (g <= 1) return 0;
  if (g <= 3) return 1;
  if (g <= 6) return 2;
  return 3;
}

export function makeCtx(plan: ChallengePlan, seed: number): Ctx {
  const rng = createRng(seed);
  const g = stageGradeIndex(plan.stage);
  const theme = resolveTheme(plan.theme ?? '', rng);
  return {
    plan,
    rng,
    grade: stageGrade(plan.stage),
    g,
    band: bandOf(g),
    step: clampStage(plan.stage) % STEPS_PER_GRADE,
    young: g <= 1,
    theme: theme.info,
    themed: theme.known,
    skill: getSkill(plan.skillId),
  };
}

/** A story opener for readers; nothing for Pre-K and K, where every text stays one short sentence. */
export function lead(ctx: Ctx): string {
  return ctx.young ? '' : ctx.rng.pick(ctx.theme.leads);
}

/** Joins sentences, skipping empty ones. */
export function say(...parts: (string | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(' ');
}

export function cap(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a, b and c" */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0] as string} and ${items[1] as string}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

/** Cuts a text at a word boundary so it fits a schema limit. Content is written to fit; this is a safety net. */
export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}.`;
}
