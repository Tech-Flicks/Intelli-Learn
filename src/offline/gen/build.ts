/**
 * Invention Workshop challenges. Part numbers are generated around a hidden valid selection,
 * plus one strong part that costs too much on its own (the tempting mistake) and weaker fillers.
 */
import type { BuildInteraction, Challenge, SceneTheme } from '@/core/schemas';
import type { Strand } from '@/core/types';
import { assemble } from '../assemble';
import { buildHasTemptingMistake, buildSolutions } from '../check';
import { cap, lead, listOf, say, type Ctx } from '../context';
import { fmt } from '../problem';
import { cardScene, type Card } from '../scene';
import { item, type Item } from '../sets/types';

interface Scenario {
  key: string;
  /** Themes (plan.theme keys) this scenario suits. */
  themes: readonly string[];
  strands: readonly Strand[];
  skills?: readonly string[];
  /** "a bridge" */
  thing: string;
  /** Goal label with {n} for the target, e.g. "a bridge with {n} strength points". */
  goal: string;
  power: string;
  cost: string;
  intro: string;
  /** Parts from weakest to strongest. */
  parts: readonly Item[];
  scene: SceneTheme;
  icon: string;
  fun: string;
}

const parts = (text: string): Item[] => text.split(';').map((part) => item(part));

const SCENARIOS: readonly Scenario[] = [
  {
    key: 'bridge', themes: ['building', 'cars and trains'], strands: ['engineering'], skills: ['engineering-structures', 'engineering-design-constraints', 'engineering-materials'],
    thing: 'a bridge', goal: 'a bridge with {n} strength points', power: 'strength', cost: 'coins',
    intro: 'The river needs a new bridge.', scene: 'city', icon: '🌉',
    parts: parts('rope|🧵; bamboo pole|🎋; wooden plank; brick pillar|🧱; stone arch; iron chain|⛓️; steel beam|🔩'),
    fun: 'Triangles make bridges strong because a triangle cannot change shape unless a side breaks.',
  },
  {
    key: 'rocket', themes: ['space'], strands: ['engineering', 'science'],
    thing: 'a rocket', goal: 'a rocket with {n} thrust points', power: 'thrust', cost: 'coins',
    intro: 'The launch pad is ready for a new rocket.', scene: 'space', icon: '🚀',
    parts: parts('balloon jet|🎈; small booster; fuel tank|🛢️; side booster; rocket engine|🚀; twin engine; giant engine|🔥'),
    fun: 'A rocket must reach about 28,000 kilometers per hour to stay in orbit around Earth.',
  },
  {
    key: 'robot', themes: ['robots', 'video games'], strands: ['technology'],
    thing: 'a robot', goal: 'a robot with {n} power points', power: 'power', cost: 'coins',
    intro: 'A new robot is waiting for its parts.', scene: 'workshop', icon: '🤖',
    parts: parts('tiny battery|🔋; solar cell|☀️; small motor|⚙️; power pack|🔌; turbo motor|🌀; super battery|⚡; mega core|💠'),
    fun: 'The word "robot" was first used in a play written in 1920.',
  },
  {
    key: 'garden', themes: ['nature', 'animals', 'garden', 'farm'], strands: ['science'],
    thing: 'a bee garden', goal: 'a garden that feeds {n} bees', power: 'bees fed', cost: 'coins',
    intro: 'The bees need a garden full of flowers.', scene: 'farm', icon: '🐝',
    parts: parts('daisy|🌼; tulip|🌷; rose|🌹; herb pot|🌿; sunflower|🌻; cherry tree|🌸; apple tree|🌳'),
    fun: 'Bees and other pollinators help grow about one third of the food people eat.',
  },
  {
    key: 'party', themes: ['toys', 'art', 'fairy tales', 'music'], strands: ['math'],
    thing: 'a party bag', goal: 'a party bag with {n} fun points', power: 'fun points', cost: 'coins',
    intro: 'It is time to fill a party bag.', scene: 'playground', icon: '🎁',
    parts: parts('sticker|⭐; balloon|🎈; bouncy ball|⚽; crayons|🖍️; puzzle|🧩; kite|🪁; teddy bear|🧸'),
    fun: 'Deciding what to buy with a fixed amount of money is called budgeting.',
  },
  {
    key: 'backpack', themes: ['sports', 'superheroes', 'dinosaurs'], strands: ['logic'],
    thing: 'an explorer backpack', goal: 'a backpack with {n} usefulness points', power: 'usefulness', cost: 'kilograms',
    intro: 'An explorer can only carry so much weight.', scene: 'forest', icon: '🎒',
    parts: parts('whistle; map|🗺️; flashlight|🔦; water bottle|💧; rope; first-aid kit; tent|⛺'),
    fun: 'Choosing the best things to pack under a weight limit is a famous puzzle called the knapsack problem.',
  },
  {
    key: 'boat', themes: ['ocean'], strands: ['engineering'],
    thing: 'a fleet of boats', goal: 'boats that carry {n} sailors', power: 'sailors carried', cost: 'coins',
    intro: 'The sailors need a way across the bay.', scene: 'ocean', icon: '⛵',
    parts: parts('log; barrel raft|🛢️; canoe|🛶; rowboat|🚣; sailboat|⛵; ferry|⛴️; ship|🚢'),
    fun: 'A steel ship floats because its hollow shape pushes aside a lot of water.',
  },
  {
    key: 'lunch', themes: ['cooking'], strands: ['science', 'math'],
    thing: 'a lunch', goal: 'a lunch with {n} energy points', power: 'energy', cost: 'coins',
    intro: 'The cook is planning a lunch that gives plenty of energy.', scene: 'kitchen', icon: '🍽️',
    parts: parts('carrot|🥕; apple|🍎; egg|🥚; cheese|🧀; sandwich|🥪; rice bowl|🍚; pasta|🍝'),
    fun: 'The energy in food is measured in calories.',
  },
  {
    key: 'power', themes: ['weather'], strands: ['engineering', 'science', 'technology'], skills: ['engineering-energy-systems'],
    thing: 'a power station', goal: 'a power station that makes {n} energy units', power: 'energy', cost: 'coins',
    intro: 'A small town needs clean electricity.', scene: 'sky', icon: '⚡',
    parts: parts('small battery|🔋; solar panel|☀️; water wheel|💧; wind turbine|🌬️; solar roof|🏠; river dam|🌊; wind farm|🌀'),
    fun: 'A single large wind turbine can power more than a thousand homes.',
  },
];

interface Numbers {
  count: number;
  unit: number;
  power: [number, number];
  cost: [number, number];
  solution: [number, number];
}

/** Number ranges per grade, Pre-K to Grade 8. Budgets stay within what the grade can add. */
const NUMBERS: readonly Numbers[] = [
  { count: 3, unit: 1, power: [1, 2], cost: [1, 1], solution: [2, 2] },
  { count: 4, unit: 1, power: [1, 3], cost: [1, 2], solution: [2, 2] },
  { count: 4, unit: 1, power: [2, 5], cost: [1, 4], solution: [2, 2] },
  { count: 5, unit: 1, power: [2, 9], cost: [2, 9], solution: [2, 2] },
  { count: 5, unit: 5, power: [2, 8], cost: [2, 9], solution: [2, 2] },
  { count: 5, unit: 10, power: [2, 9], cost: [2, 9], solution: [2, 3] },
  { count: 6, unit: 5, power: [4, 30], cost: [4, 30], solution: [2, 3] },
  { count: 6, unit: 1, power: [12, 60], cost: [12, 60], solution: [2, 3] },
  { count: 6, unit: 1, power: [15, 95], cost: [15, 95], solution: [3, 3] },
  { count: 7, unit: 1, power: [25, 180], cost: [25, 180], solution: [3, 3] },
];

function chooseScenario(ctx: Ctx): Scenario {
  const bySkill = SCENARIOS.filter((s) => s.skills?.includes(ctx.plan.skillId));
  const byTheme = SCENARIOS.filter((s) => s.themes.includes(ctx.theme.key));
  const byStrand = SCENARIOS.filter((s) => s.strands.includes(ctx.plan.strand));
  if (ctx.themed && byTheme.length > 0 && ctx.rng.chance(0.7)) return ctx.rng.pick(byTheme);
  if (bySkill.length > 0 && ctx.rng.chance(0.6)) return ctx.rng.pick(bySkill);
  if (byStrand.length > 0) return ctx.rng.pick(byStrand);
  return ctx.rng.pick(SCENARIOS);
}

interface Spec {
  power: number;
  cost: number;
  role: 'solution' | 'strong' | 'pricey' | 'weak';
}

function numbersFor(ctx: Ctx): { specs: Spec[]; target: number; budget: number } | null {
  const n = NUMBERS[ctx.g] ?? (NUMBERS[NUMBERS.length - 1] as Numbers);
  const { rng } = ctx;
  const k = rng.int(n.solution[0], n.solution[1]);
  const specs: Spec[] = [];
  for (let i = 0; i < k; i += 1) {
    specs.push({ power: n.unit * rng.int(n.power[0], n.power[1]), cost: n.unit * rng.int(n.cost[0], n.cost[1]), role: 'solution' });
  }
  const target = specs.reduce((sum, s) => sum + s.power, 0);
  const budget = specs.reduce((sum, s) => sum + s.cost, 0);
  // One part that reaches the target alone but costs just too much.
  specs.push({ power: target + n.unit * rng.int(0, 1), cost: budget + n.unit * rng.int(1, 2), role: 'strong' });
  // A part as good as one of the solution parts, but more expensive.
  const twin = specs[0] as Spec;
  if (specs.length < n.count) specs.push({ power: twin.power, cost: twin.cost + n.unit * rng.int(1, 2), role: 'pricey' });
  while (specs.length < n.count) {
    const weakPower = n.unit * rng.int(Math.max(1, n.power[0] - 1), Math.max(1, Math.floor((n.power[0] + n.power[1]) / 3)));
    specs.push({ power: weakPower, cost: n.unit * rng.int(n.cost[0], Math.max(n.cost[0], Math.ceil((n.cost[0] + n.cost[1]) / 2))), role: 'weak' });
  }
  if (target < 1 || budget < 1 || target > 10000 || budget > 10000) return null;
  return { specs, target, budget };
}

export function buildChallenge(ctx: Ctx): Challenge | null {
  const scenario = chooseScenario(ctx);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const numbers = numbersFor(ctx);
    if (!numbers) continue;
    const { specs, target, budget } = numbers;
    // Stronger parts get the names of stronger things; equal strength is told apart by name anyway.
    const names = ctx.rng.sample(scenario.parts.map((p, index) => ({ p, index })), specs.length).sort((a, b) => a.index - b.index);
    const ranked = specs.map((spec, index) => ({ spec, index })).sort((a, b) => a.spec.power - b.spec.power || a.spec.cost - b.spec.cost);
    const named = ranked.map((entry, rank) => ({ ...entry.spec, name: (names[rank] as { p: Item }).p }));
    const shown = ctx.rng.shuffle(named);
    const interaction: BuildInteraction = {
      kind: 'build',
      goalLabel: scenario.goal.replace('{n}', fmt(target)),
      powerLabel: scenario.power,
      costLabel: scenario.cost,
      target,
      budget,
      parts: shown.map((part, index) => ({
        id: `part${index + 1}`,
        label: cap(part.name.label),
        ...(part.name.emoji ? { emoji: part.name.emoji } : {}),
        power: part.power,
        cost: part.cost,
      })),
    };
    const solutions = buildSolutions(interaction);
    if (solutions.length === 0 || solutions.some((s) => s.length === interaction.parts.length) || !buildHasTemptingMistake(interaction)) continue;

    const solutionParts = shown.filter((part) => part.role === 'solution');
    const strong = shown.find((part) => part.role === 'strong');
    if (!strong || solutionParts.length === 0) continue;
    const solNames = listOf(solutionParts.map((part) => part.name.label));
    const solPower = solutionParts.reduce((sum, part) => sum + part.power, 0);
    const solCost = solutionParts.reduce((sum, part) => sum + part.cost, 0);
    const cards: Card[] = [
      { id: 'goal', emoji: scenario.icon, scale: 1.2 },
      ...shown.filter((part) => part.name.emoji).slice(0, 6).map((part, index) => ({ id: `pic${index + 1}`, emoji: part.name.emoji as string, label: cap(part.name.label) })),
    ];
    const scene = cardScene(scenario.scene, cards);
    const teach = ['Why not just pick the strongest part?', 'It costs more than the budget allows.', 'It is the wrong color.', 'Strong parts are never useful.'] as const;
    const title = `${scenario.thing.replace(/^an? /, '').split(' ').map((word) => (word === 'of' ? word : cap(word))).join(' ')} Builder`;

    if (ctx.young) {
      return assemble(ctx, {
        title,
        intro: `Let us build ${scenario.thing}.`,
        question: `Reach ${target} ${scenario.power} with ${budget} ${scenario.cost} or less.`,
        interaction,
        hints: ['Add the numbers on your parts.', 'The biggest part costs too much.'],
        walkthrough: [`You need ${target} ${scenario.power}.`, `${cap(solNames)} make ${solPower}.`, `They cost ${solCost}.`],
        explanation: 'These parts reach the goal and do not cost too much.',
        teach,
        funFact: scenario.fun,
        scene,
      });
    }
    return assemble(ctx, {
      title,
      intro: say(lead(ctx), scenario.intro),
      question: `Choose parts so that the ${scenario.power} adds up to at least ${fmt(target)}, without spending more than ${fmt(budget)} ${scenario.cost}.`,
      interaction,
      hints: [
        `Add up the ${scenario.power} of the parts you pick. Then add up what they cost.`,
        `The strongest part reaches the target alone but costs more than the budget. Try combining smaller parts.`,
      ],
      walkthrough: [
        `You need at least ${fmt(target)} ${scenario.power} and may spend at most ${fmt(budget)} ${scenario.cost}.`,
        `${cap(strong.name.label)} alone gives ${fmt(strong.power)} but costs ${fmt(strong.cost)}, which is too much.`,
        `${cap(solNames)} give ${fmt(solPower)} ${scenario.power} together.`,
        `They cost ${fmt(solCost)} ${scenario.cost}, which fits the budget.`,
      ],
      explanation: `A good design reaches the goal and stays inside the budget. ${cap(solNames)} give ${fmt(solPower)} ${scenario.power} for ${fmt(solCost)} ${scenario.cost}.`,
      teach,
      funFact: scenario.fun,
      scene,
    });
  }
  return null;
}
