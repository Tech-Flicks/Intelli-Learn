/** Turns the parts a generator produced into a schema-valid Challenge. */
import type { z } from 'zod';
import { ChallengeSchema, type Challenge, type InteractionSchema } from '@/core/schemas';
import { clip, type Ctx } from './context';
import type { SceneInput } from './scene';
import { speakable } from './speak';

/** [question for the child, the correct explanation, one or two wrong ones] */
export type Teach = readonly [prompt: string, right: string, wrong: string, wrongToo?: string];

export type InteractionInput = z.input<typeof InteractionSchema>;

export interface Parts {
  title: string;
  intro: string;
  question: string;
  /** Defaults to the intro and question rewritten for speech. */
  readAloud?: string;
  interaction: InteractionInput;
  hints: readonly [string, string];
  walkthrough: readonly string[];
  explanation: string;
  teach?: Teach | undefined;
  funFact?: string | undefined;
  scene: SceneInput;
}

const OPTION_IDS = ['a', 'b', 'c'] as const;

export function teachBackOf(teach: Teach, order: readonly number[]): { prompt: string; options: { id: string; label: string; correct: boolean }[] } {
  const [prompt, right, ...wrong] = teach;
  const all = [
    { label: right, correct: true },
    ...wrong.filter((w): w is string => typeof w === 'string').map((label) => ({ label, correct: false })),
  ];
  const arranged = order.map((i) => all[i]).filter((o): o is { label: string; correct: boolean } => o !== undefined);
  const options = (arranged.length === all.length ? arranged : all).map((option, index) => ({
    id: OPTION_IDS[index] as string,
    label: clip(option.label, 160),
    correct: option.correct,
  }));
  return { prompt: clip(prompt, 200), options };
}

/** Builds and validates the challenge. Throws when the parts do not form a valid challenge. */
export function assemble(ctx: Ctx, parts: Parts): Challenge {
  const steps = parts.walkthrough.map((s) => s.trim()).filter((s) => s !== '');
  while (steps.length < 2) steps.push('Check your answer one more time.');
  if (steps.length > 6) {
    const tail = steps.splice(5).join(' ');
    steps.push(tail);
  }
  const intro = clip(parts.intro, 400);
  const question = clip(parts.question, 300);
  const teachCount = parts.teach ? parts.teach.filter((x) => typeof x === 'string').length - 1 : 0;
  const draft = {
    title: clip(parts.title, 60),
    intro,
    question,
    readAloud: clip(speakable(parts.readAloud ?? `${intro} ${question}`), 700),
    interaction: parts.interaction,
    hints: [clip(parts.hints[0], 240), clip(parts.hints[1], 300)],
    walkthrough: steps.map((s) => clip(s, 240)),
    explanation: clip(parts.explanation, 400),
    ...(parts.teach
      ? { teachBack: teachBackOf(parts.teach, ctx.rng.shuffle(Array.from({ length: teachCount }, (_v, i) => i))) }
      : {}),
    ...(parts.funFact ? { funFact: clip(parts.funFact, 240) } : {}),
    scene: parts.scene,
  };
  return ChallengeSchema.parse(draft);
}
