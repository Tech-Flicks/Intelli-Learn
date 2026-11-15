/**
 * Two small generators with their own look: picture patterns (for the youngest pattern
 * spotters) and "Fix the Bot", where a helper robot shows its work and one step is wrong.
 */
import type { Challenge } from '@/core/schemas';
import { assemble } from '../assemble';
import { lead, say, type Ctx } from '../context';
import { bandScene, stackScene, type Card } from '../scene';
import { range, titleOf } from './kit';

const UNITS: readonly (readonly number[])[] = [[0, 1], [0, 0, 1], [0, 1, 1], [0, 1, 2], [0, 1, 2, 1]];
const UNIT_NAMES = ['A B', 'A A B', 'A B B', 'A B C', 'A B C B'];

/** "🔴 🔵 🔴 🔵 ?" as a choice or a tap challenge. */
export function patternChallenge(ctx: Ctx): Challenge | null {
  const kind = ctx.plan.interaction;
  if (kind !== 'choice' && kind !== 'tap') return null;
  const { rng, g } = ctx;
  const unitIndex = g === 0 ? 0 : g <= 2 ? rng.int(0, 2) : rng.int(1, 4);
  const unit = UNITS[unitIndex] as readonly number[];
  const pool = ctx.theme.things.length >= 3 ? ctx.theme.things : [...ctx.theme.things, { emoji: '⭐', one: 'star', many: 'stars' }, { emoji: '🔵', one: 'ball', many: 'balls' }];
  const things = rng.sample(pool, 3);
  const shown = Math.min(7, unit.length * 2 + rng.int(0, unit.length - 1));
  const sequence = range(0, shown).map((i) => unit[i % unit.length] as number);
  const answerIndex = sequence[shown] as number;
  const answer = things[answerIndex];
  if (!answer || things.length < 3) return null;
  const row: Card[] = sequence.slice(0, shown).map((t, i) => ({ id: `p${i + 1}`, emoji: (things[t] as { emoji: string }).emoji }));
  row.push({ id: 'gap', text: '?' });
  const optionOrder = rng.shuffle([0, 1, 2]);
  const intro = ctx.young ? 'Look at the pattern.' : say(lead(ctx), 'The pictures follow a repeating pattern.');
  const question = kind === 'tap' ? (ctx.young ? 'Tap the one that comes next.' : 'Tap the picture below that comes next in the pattern.') : ctx.young ? 'What comes next?' : 'Which picture comes next in the pattern?';
  const unitText = unit.map((t) => (things[t] as { one: string }).one).join(', ');
  const common = {
    title: titleOf(ctx, 'Pattern'),
    intro,
    question,
    hints: ['Say the pattern out loud.', ctx.young ? 'Find the part that repeats.' : 'Find the group that repeats, then see where the pattern stops.'] as const,
    walkthrough: ctx.young
      ? ['Say the names of the pictures.', `The next one is the ${answer.one}.`]
      : [`The repeating part is: ${unitText}.`, 'Say the pattern from the start and keep going.', `The next picture is the ${answer.one}.`],
    explanation: ctx.young ? 'A pattern repeats again and again.' : `The pattern repeats the group "${unitText}" (${UNIT_NAMES[unitIndex] as string}), so the ${answer.one} comes next.`,
    teach: (ctx.young
      ? ['What does a pattern do?', 'It repeats.', 'It stops.', 'It hides.']
      : ['How do you continue a repeating pattern?', 'Find the part that repeats and keep it going.', 'Pick your favorite picture.', 'Always repeat the last picture.']) as readonly [string, string, string, string],
    funFact: 'Zebra stripes and honeycombs are patterns in nature.',
  };
  if (kind === 'tap') {
    const choices: Card[] = optionOrder.map((t) => ({ id: `pick${t + 1}`, emoji: (things[t] as { emoji: string }).emoji, tappable: true }));
    return assemble(ctx, {
      ...common,
      interaction: { kind: 'tap', targetIds: [`pick${answerIndex + 1}`] },
      scene: bandScene(ctx.theme.scene, [row, choices], { calm: true }),
    });
  }
  const ids = ['a', 'b', 'c'] as const;
  return assemble(ctx, {
    ...common,
    interaction: {
      kind: 'choice',
      multi: false,
      options: optionOrder.map((t, i) => {
        const thing = things[t] as { emoji: string; one: string };
        return { id: ids[i] as string, label: thing.one, emoji: thing.emoji, ...(t === answerIndex ? {} : { misconception: 'Say the pattern from the start and listen for what repeats.' }) };
      }),
      correctIds: [ids[optionOrder.indexOf(answerIndex)] as string],
    },
    scene: bandScene(ctx.theme.scene, [row], { calm: true }),
  });
}

const BOTS = ['Bolt', 'Pixel', 'Gizmo', 'Widget', 'Sprocket'] as const;

/** A helper bot shows its work. Exactly one step is wrong, and the child finds it. */
export function fixbotChallenge(ctx: Ctx): Challenge | null {
  if (ctx.plan.interaction !== 'choice') return null;
  const { rng, g } = ctx;
  const bot = rng.pick(BOTS);
  if (g <= 1) {
    const start = rng.int(1, g === 0 ? 2 : 5);
    const numbers = range(start, start + 4);
    const skipAt = rng.int(1, 3);
    const missing = numbers[skipAt] as number;
    const said = numbers.filter((_n, i) => i !== skipAt);
    const wrong = rng.shuffle([missing + 1 > (numbers[4] as number) ? missing - 1 : (numbers[4] as number) + 1, start === 1 ? (numbers[4] as number) + 2 : start - 1]);
    const options = rng.shuffle([{ value: missing, right: true }, ...wrong.map((value) => ({ value, right: false }))]).sort((a, b) => a.value - b.value);
    const ids = ['a', 'b', 'c'] as const;
    return assemble(ctx, {
      title: `Fix ${bot} the Bot`,
      intro: `${bot} the bot counts: ${said.join(', ')}.`,
      question: `Which number did ${bot} skip?`,
      interaction: {
        kind: 'choice',
        multi: false,
        options: options.map((o, i) => ({ id: ids[i] as string, label: String(o.value), ...(o.right ? {} : { misconception: `${bot} did not need that number here.` }) })),
        correctIds: [ids[options.findIndex((o) => o.right)] as string],
      },
      hints: ['Count along with the bot.', 'Listen for a jump.'],
      walkthrough: [`Count slowly from ${start}.`, `After ${missing - 1} comes ${missing}.`, `${bot} skipped ${missing}.`],
      explanation: 'When you count, every number gets a turn.',
      teach: ['How do you find a counting mistake?', 'Count again slowly.', 'Count faster.', 'Stop counting.'],
      funFact: 'Finding and fixing mistakes in a program is called debugging.',
      scene: stackScene(ctx.theme.scene, [said.join('  ')], '🤖'),
    });
  }
  // A chain of three calculations; one step holds a typical slip and later steps carry it along.
  let a: number;
  let ops: { sign: string; n: number; apply: (x: number) => number }[];
  if (g <= 3) {
    a = rng.int(3, 9);
    const [b, c, d] = [rng.int(2, 8), rng.int(2, 8), rng.int(1, 5)];
    ops = [{ sign: '+', n: b, apply: (x) => x + b }, { sign: '+', n: c, apply: (x) => x + c }, { sign: '−', n: d, apply: (x) => x - d }];
  } else if (g <= 6) {
    a = rng.int(3, 9);
    const [b, c, d] = [rng.int(3, 9), rng.int(6, 19), rng.int(2, 9)];
    ops = [{ sign: '×', n: b, apply: (x) => x * b }, { sign: '+', n: c, apply: (x) => x + c }, { sign: '−', n: d, apply: (x) => x - d }];
  } else {
    a = rng.int(4, 12);
    const [c, d] = [rng.int(11, 29), rng.pick([2, 3, 5])];
    ops = [{ sign: '×', n: a, apply: (x) => x * x }, { sign: '+', n: c, apply: (x) => x + c }, { sign: '×', n: d, apply: (x) => x * d }];
  }
  const wrongStep = rng.int(0, 2);
  const slip = rng.pick([1, -1, 2, 10]);
  const lines: string[] = [];
  let shown = a;
  let correctLine = '';
  ops.forEach((op, index) => {
    const truth = op.apply(shown);
    const written = index === wrongStep ? Math.max(0, truth + slip) : truth;
    lines.push(`Step ${index + 1}: ${shown} ${op.sign} ${op.n} = ${written}`);
    if (index === wrongStep) correctLine = `${shown} ${op.sign} ${op.n} = ${truth}, not ${written}`;
    shown = written;
  });
  const ids = ['a', 'b', 'c'] as const;
  return assemble(ctx, {
    title: `Fix ${bot} the Bot`,
    intro: say(lead(ctx), `${bot} the helper bot did a calculation in three steps, but one step has a mistake. ${lines.join('. ')}.`),
    question: `Which step did ${bot} get wrong?`,
    interaction: {
      kind: 'choice',
      multi: false,
      options: lines.map((_line, index) => ({
        id: ids[index] as string,
        label: `Step ${index + 1}`,
        ...(index === wrongStep ? {} : { misconception: index > wrongStep ? 'This step uses a wrong number from before, but its own calculation is right.' : 'Work this step out yourself. It is correct.' }),
      })),
      correctIds: [ids[wrongStep] as string],
    },
    hints: ['Check each step on its own, using the number the bot started that step with.', 'A later step can be calculated correctly even when it starts from a wrong number.'],
    walkthrough: ['Redo each step yourself.', `In step ${wrongStep + 1}: ${correctLine}.`, 'The other steps are calculated correctly from the numbers they start with.'],
    explanation: `Step ${wrongStep + 1} is wrong, because ${correctLine}. Checking work step by step is how programmers find bugs.`,
    teach: ['What is a good way to find a mistake in a long calculation?', 'Check one step at a time.', 'Only look at the final answer.', 'Start a different problem.'],
    funFact: 'Finding and fixing mistakes in a program is called debugging.',
    scene: stackScene(ctx.theme.scene, lines, '🤖'),
  });
}
