/**
 * Chooses or generates one offline challenge for a plan. It never fails: when the preferred
 * sources have nothing, the search widens, and a simple built-in challenge is the last resort.
 */
import type { Challenge } from '@/core/schemas';
import { gradeIndex } from '@/core/grades';
import { getSkill, skillExistsAt } from '@/core/skills';
import type { ChallengePlan, Grade, InteractionKind } from '@/core/types';
import { assemble } from './assemble';
import { problemsOf } from './check';
import { makeCtx, type Ctx } from './context';
import { CURATED } from './curated';
import { buildChallenge } from './gen/build';
import { fixbotChallenge, patternChallenge } from './gen/extras';
import { MATH_MAKERS_A } from './gen/mathProblems';
import { MATH_MAKERS_B } from './gen/mathProblems2';
import { mathSets } from './gen/mathSets';
import { robotChallenge } from './gen/robot';
import { STEM_MAKERS } from './gen/stemProblems';
import { choiceFromProblem, numberFromProblem, type ProblemMaker } from './problem';
import { reasoningVariants, variantsOf, type Variant } from './render';
import { defaultSeed, hashText, type Rng } from './rng';
import { cardScene, stackScene } from './scene';
import { ALL_SETS, setsForStrand, type KnowledgeSet } from './sets';

export interface OfflinePickOptions {
  /** Titles the child has seen recently; another challenge is chosen when possible. */
  avoidTitles?: string[];
  /** Fixes the random choices, so the same plan and seed always give the same challenge. */
  seed?: number;
}

const normalize = (title: string): string => title.trim().toLowerCase();
const inGrades = (grades: readonly [Grade, Grade], g: number): boolean => gradeIndex(grades[0]) <= g && g <= gradeIndex(grades[1]);
const GENERIC_MODES = new Set(['quest', 'story', 'studio']);

const PROBLEM_MAKERS: Record<string, readonly ProblemMaker[]> = {
  ...Object.fromEntries(Object.entries({ ...MATH_MAKERS_A, ...MATH_MAKERS_B }).map(([skillId, maker]) => [skillId, [maker]])),
  ...STEM_MAKERS,
};

/** A hand-written item that fits the plan, or null. */
function curatedFor(ctx: Ctx, avoid: ReadonlySet<string>): Challenge | null {
  const { plan, g, rng } = ctx;
  const fits = CURATED.filter((item) => item.challenge.interaction.kind === plan.interaction && inGrades(item.grades, g) && !avoid.has(normalize(item.challenge.title)));
  if (fits.length === 0) return null;
  const sameMode = fits.filter((item) => item.mode === plan.mode);
  const exact = sameMode.filter((item) => item.skillId === plan.skillId);
  const byStrand = sameMode.filter((item) => item.strand === plan.strand);
  // A mission is only ever served as a mission; other items also suit the open-ended modes.
  const bySkill = GENERIC_MODES.has(plan.mode) ? fits.filter((item) => item.skillId === plan.skillId && item.mode !== 'mission') : [];
  const chosen = exact.length > 0 ? rng.pick(exact) : byStrand.length > 0 ? rng.pick(byStrand) : bySkill.length > 0 && rng.chance(0.4) ? rng.pick(bySkill) : undefined;
  // A copy, so that callers can never change the bank.
  return chosen ? (JSON.parse(JSON.stringify(chosen.challenge)) as Challenge) : null;
}

/** Generators to try, most fitting group first. */
export function candidateTiers(ctx: Ctx): Variant[][] {
  const { plan, g, grade } = ctx;
  const kind = plan.interaction;
  const first: Variant[] = [];
  const second: Variant[] = [];
  const third: Variant[] = [];

  if (kind === 'robot') first.push({ weight: 1, make: robotChallenge });
  if (kind === 'build') first.push({ weight: 1, make: buildChallenge });
  if (kind === 'choice') {
    if (plan.mode === 'fixbot' && (plan.strand === 'math' || plan.strand === 'technology')) {
      first.push({ weight: 8, make: fixbotChallenge, borrowed: plan.skillId !== 'technology-debugging' });
    } else if (plan.skillId === 'technology-debugging') first.push({ weight: 3, make: fixbotChallenge });
  }
  if (kind === 'choice' || kind === 'tap') {
    if (plan.skillId === 'logic-patterns' && g <= 4) first.push({ weight: 6, make: patternChallenge });
    else if (plan.strand === 'logic' && g <= 2) second.push({ weight: 1, make: patternChallenge });
  }

  if (kind === 'number' || kind === 'choice') {
    const render = kind === 'number' ? numberFromProblem : choiceFromProblem;
    for (const [skillId, makers] of Object.entries(PROBLEM_MAKERS)) {
      const skill = getSkill(skillId);
      if (!skill || skill.strand !== plan.strand || !skillExistsAt(skill, grade)) continue;
      for (const maker of makers) {
        const make = (c: Ctx): Challenge | null => {
          const made = maker(c);
          return made ? render(c, made) : null;
        };
        if (skillId === plan.skillId) first.push({ weight: 5, make });
        else second.push({ weight: 1, make });
      }
    }
  }

  const atGrade = (set: KnowledgeSet): boolean => inGrades(set.grades, g);
  const generatedMath = mathSets(ctx);
  const own = plan.strand === 'math' ? generatedMath : setsForStrand(plan.strand).filter(atGrade);
  // A skill with its own number problems does not need "count the ones that fit" questions first.
  const countingIsSecondBest = kind === 'number' && first.length > 0;
  for (const set of own) {
    const target = set.skills.includes(plan.skillId) && !countingIsSecondBest ? first : second;
    target.push(...variantsOf(set, kind));
  }
  const others = [...ALL_SETS.filter((set) => set.strand !== plan.strand && atGrade(set)), ...(plan.strand === 'math' ? [] : generatedMath)];
  if (plan.skillId === 'logic-odd-one-out') {
    for (const set of [...own, ...others]) first.push(...reasoningVariants(set, kind));
  }
  for (const set of others) third.push(...variantsOf(set, kind));
  return [first, second, third];
}

function weightedOrder(rng: Rng, variants: readonly Variant[]): Variant[] {
  const pool = [...variants];
  const out: Variant[] = [];
  while (pool.length > 0) {
    const total = pool.reduce((sum, v) => sum + Math.max(0.01, v.weight), 0);
    let roll = rng.next() * total;
    let index = 0;
    for (; index < pool.length - 1; index += 1) {
      roll -= Math.max(0.01, (pool[index] as Variant).weight);
      if (roll <= 0) break;
    }
    out.push(...pool.splice(index, 1));
  }
  return out;
}

function sound(challenge: Challenge | null, kind: InteractionKind): challenge is Challenge {
  return challenge !== null && challenge.interaction.kind === kind && problemsOf(challenge).length === 0;
}

/** The first sound challenge whose title is new; a sound one with a seen title is kept as a spare. */
function generate(ctx: Ctx, avoid: ReadonlySet<string>): { fresh?: Challenge; spare?: Challenge } {
  const kind = ctx.plan.interaction;
  let spare: Challenge | undefined;
  const fromBank = curatedFor(ctx, avoid);
  if (sound(fromBank, kind)) return { fresh: fromBank };
  for (const tier of candidateTiers(ctx)) {
    for (const variant of weightedOrder(ctx.rng, tier).slice(0, 14)) {
      let made: Challenge | null = null;
      try {
        made = variant.make(ctx);
      } catch {
        // A generator that cannot build a valid challenge from this draw is skipped.
        made = null;
      }
      if (!sound(made, kind)) continue;
      if (!avoid.has(normalize(made.title))) return spare ? { fresh: made, spare } : { fresh: made };
      spare ??= made;
    }
  }
  return spare ? { spare } : {};
}

export interface OwnSkillOptions extends OfflinePickOptions {
  /** Leaves a candidate out, for example one the child has already solved. */
  accept?: (challenge: Challenge) => boolean;
}

/** Hand-written items of the plan's own skill that suit its kind, grade and mode. */
function ownCurated(ctx: Ctx): Challenge[] {
  const { plan, g } = ctx;
  return CURATED.filter(
    (item) =>
      item.skillId === plan.skillId &&
      item.challenge.interaction.kind === plan.interaction &&
      inGrades(item.grades, g) &&
      (item.mode === plan.mode || (GENERIC_MODES.has(plan.mode) && item.mode !== 'mission')),
  ).map((item) => JSON.parse(JSON.stringify(item.challenge)) as Challenge);
}

/**
 * A challenge that was made for the plan's own skill: a hand-written item of that skill, or one
 * from the skill's own generators. Unlike `pickOfflineChallenge` it never widens the search to a
 * neighbouring skill or another strand, so it can come back empty: null means the bank has
 * nothing for this skill at this grade in this kind (or nothing that `accept` takes).
 *
 * Use it where the content has to be about the skill itself: a concept check that raises the
 * skill's stage must not be a challenge about something else.
 */
export function pickOwnSkillChallenge(plan: ChallengePlan, opts: OwnSkillOptions = {}): Challenge | null {
  const seed = (opts.seed ?? defaultSeed()) ^ hashText(`${plan.skillId}|${plan.interaction}|${plan.stage}|${plan.mode}`);
  const avoid = new Set((opts.avoidTitles ?? []).map(normalize));
  const accept = opts.accept ?? (() => true);
  const kind = plan.interaction;
  let spare: Challenge | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ctx = makeCtx(plan, seed + attempt * 7919);
    const own = (candidateTiers(ctx)[0] ?? []).filter((variant) => variant.borrowed !== true);
    const makers: (() => Challenge | null)[] = [
      ...ctx.rng.shuffle(ownCurated(ctx)).map((challenge) => () => challenge),
      ...weightedOrder(ctx.rng, own).slice(0, 14).map((variant) => () => variant.make(ctx)),
    ];
    for (const make of makers) {
      let made: Challenge | null = null;
      try {
        made = make();
      } catch {
        made = null;
      }
      if (!sound(made, kind) || !accept(made)) continue;
      if (!avoid.has(normalize(made.title))) return made;
      spare ??= made;
    }
  }
  return spare;
}

/** Simple, always-valid challenges: the last resort for each kind of interaction. */
function lastResort(ctx: Ctx): Challenge {
  const kind = ctx.plan.interaction;
  const young = ctx.young;
  const theme = ctx.theme.scene;
  const hero = ctx.theme.hero;
  const teach = ['How do you compare two numbers?', 'Count up and see which comes later.', 'Pick the one you like.', 'Look at the color.'] as const;
  const base = {
    hints: ['Count up from one.', 'Bigger numbers come later when you count.'] as const,
    walkthrough: ['Count: 1, 2, 3, 4, 5.', 'The number you say last is the biggest.'],
    explanation: 'Numbers get bigger as you count up.',
    teach,
    funFact: 'We count in tens because people first counted on their ten fingers.',
  };
  const numbers = cardScene(theme, [{ text: '2' }, { text: '3' }, { text: '5' }, { emoji: hero }]);
  switch (kind) {
    case 'choice':
      return assemble(ctx, { ...base, title: 'Number Check', intro: 'Look at the numbers.', question: 'Which number is the biggest?', interaction: { kind: 'choice', multi: false, options: [{ id: 'a', label: '2', misconception: 'Count up: 2 comes early.' }, { id: 'b', label: '5' }, { id: 'c', label: '3', misconception: 'Count up: 3 comes before 5.' }], correctIds: ['b'] }, scene: numbers });
    case 'tap':
      return assemble(ctx, { ...base, title: 'Number Tap', intro: 'Look at the numbers.', question: 'Tap the biggest number.', interaction: { kind: 'tap', targetIds: ['n3'] }, scene: cardScene(theme, [{ id: 'n1', text: '2', tappable: true }, { id: 'n2', text: '3', tappable: true }, { id: 'n3', text: '5', tappable: true }]) });
    case 'sort':
      return assemble(ctx, { ...base, title: 'Small and Big', intro: 'Some numbers are small.', question: 'Sort the numbers into small and big.', interaction: { kind: 'sort', bins: [{ id: 'small', label: 'Small', emoji: '🐜' }, { id: 'big', label: 'Big', emoji: '🐘' }], items: [{ id: 'i1', label: '1', binId: 'small' }, { id: 'i2', label: '2', binId: 'small' }, { id: 'i3', label: '9', binId: 'big' }, { id: 'i4', label: '10', binId: 'big' }] }, scene: numbers });
    case 'match':
      return assemble(ctx, { ...base, title: 'Dot Match', intro: 'Each number has its own dots.', question: 'Match each number to its dots.', interaction: { kind: 'match', pairs: [{ id: 'p1', left: { label: '1' }, right: { label: '●' } }, { id: 'p2', left: { label: '2' }, right: { label: '●●' } }, { id: 'p3', left: { label: '3' }, right: { label: '●●●' } }] }, hints: ['Count the dots one by one.', 'Say one number for each dot.'], scene: numbers });
    case 'order':
      return assemble(ctx, { ...base, title: 'Number Line', intro: 'The numbers are mixed up.', question: 'Put the numbers in order from smallest to biggest.', interaction: { kind: 'order', items: [{ id: 'o1', label: '2' }, { id: 'o2', label: '3' }, { id: 'o3', label: '5' }], startLabel: 'smallest', endLabel: 'biggest' }, scene: numbers });
    case 'number':
      return assemble(ctx, { ...base, title: 'Star Count', intro: 'Look at the stars.', question: 'How many stars can you see?', interaction: { kind: 'number', answer: 4, tolerance: 0, allowDecimal: false, allowNegative: false }, hints: ['Touch each star as you count.', 'Say one number for each star.'], walkthrough: ['Point to each star once.', 'Count: 1, 2, 3, 4.'], explanation: 'The last number you say tells how many there are.', scene: cardScene(theme, [{ emoji: '⭐' }, { emoji: '⭐' }, { emoji: '⭐' }, { emoji: '⭐' }]) });
    case 'robot':
      return assemble(ctx, { title: 'Robot Walk', intro: 'The robot wants to reach the flag.', question: young ? 'Help the robot get to the flag.' : 'Build a program that takes the robot to the flag.', interaction: { kind: 'robot', cols: 3, rows: 3, start: { x: 0, y: 1, dir: 'right' }, goal: { x: 2, y: 1 }, walls: [], gems: [], allowed: ['forward'], maxCommands: 4 }, hints: ['Count the squares to the flag.', 'Use one forward block for each square.'], walkthrough: ['The flag is straight ahead.', 'Move forward until the robot reaches it.'], explanation: 'A program is a list of steps in order.', teach: ['What is a program?', 'A list of steps in order.', 'A kind of robot.', 'A flag.'], funFact: 'Robots follow their instructions exactly, one step at a time.', scene: stackScene(theme, ['forward, forward'], '🤖') });
    case 'build':
      return assemble(ctx, { title: 'Tower Builder', intro: young ? 'You have 5 coins for a tower.' : 'You have 5 coins to build a tower that is strong enough.', question: 'Pick parts with a strength of at least 5 for no more than 5 coins.', interaction: { kind: 'build', goalLabel: 'a tower with strength 5', powerLabel: 'strength', costLabel: 'coins', target: 5, budget: 5, parts: [{ id: 'part1', label: 'Wood block', emoji: '🧱', power: 3, cost: 2 }, { id: 'part2', label: 'Stone block', emoji: '⛰️', power: 2, cost: 2 }, { id: 'part3', label: 'Paper', emoji: '📄', power: 0, cost: 1 }, { id: 'part4', label: 'Steel block', emoji: '🏗️', power: 6, cost: 7 }] }, hints: ['Check the price of the strongest part.', 'Two cheaper parts can work together.'], walkthrough: ['The steel block costs too much.', 'Wood block and stone block: strength 3 + 2 = 5.', 'They cost 2 + 2 = 4 coins.'], explanation: 'A good design reaches the goal and stays within the budget.', teach: ['What is a budget?', 'A limit on how much you can spend.', 'A kind of block.', 'The height of the tower.'], funFact: 'Engineers almost always have to work within a budget.', scene: cardScene(theme, [{ emoji: '🧱' }, { emoji: '🏗️' }, { emoji: '💰' }]) });
  }
}

/**
 * Returns a ready-to-play challenge for the plan without any network or AI. The result always
 * passes `ChallengeSchema`, uses `plan.interaction` and is pitched at the grade of `plan.stage`.
 */
export function pickOfflineChallenge(plan: ChallengePlan, opts: OfflinePickOptions = {}): Challenge {
  const seed = (opts.seed ?? defaultSeed()) ^ hashText(`${plan.skillId}|${plan.interaction}|${plan.stage}|${plan.mode}`);
  const avoid = new Set((opts.avoidTitles ?? []).map(normalize));
  let spare: Challenge | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ctx = makeCtx(plan, seed + attempt * 7919);
    const result = generate(ctx, avoid);
    if (result.fresh) return result.fresh;
    spare ??= result.spare;
  }
  return spare ?? lastResort(makeCtx(plan, seed));
}
