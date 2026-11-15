/**
 * Procedural math problems for every math skill and grade. Each maker returns a problem with a
 * checked answer, worked steps and the typical mistakes for that kind of question.
 */
import type { Teach } from '../assemble';
import { cap, lead, say, type Ctx } from '../context';
import { fmt, type Mistake, type ProblemMaker } from '../problem';
import { cardScene, stackScene, type Card, type SceneInput } from '../scene';
import type { Thing } from '../themes';

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_v, i) => from + i);
const title = (ctx: Ctx, name: string): string => `${ctx.theme.label} ${name}`;
const thingOf = (ctx: Ctx): Thing => ctx.rng.pick(ctx.theme.things);

function thingScene(ctx: Ctx, groups: readonly { emoji: string; count: number }[]): SceneInput {
  const cards: Card[] = [];
  groups.forEach((group, groupIndex) => {
    for (let i = 0; i < group.count && cards.length < 13; i += 1) cards.push({ id: `g${groupIndex + 1}n${i + 1}`, emoji: group.emoji });
  });
  return cardScene(ctx.theme.scene, cards);
}

/** The sum or equation on a board, with the theme's hero beside it. */
function boardScene(ctx: Ctx, lines: readonly string[]): SceneInput {
  return stackScene(ctx.theme.scene, lines, ctx.theme.hero);
}

const FUN = {
  count: 'We count in tens because people first counted on their ten fingers.',
  plus: 'The plus sign has been used for more than 500 years.',
  zero: 'The zero was invented long ago to show an empty place in a number.',
  times: 'The multiplication sign was first used in a book almost 400 years ago.',
  fraction: 'The word fraction comes from a Latin word that means "broken".',
  geometry: 'The word geometry means "measuring the Earth".',
  honeycomb: 'Bees build their honeycomb out of hexagons.',
  day: 'There are 86,400 seconds in one day.',
  algebra: 'The word algebra comes from an Arabic book written about 1,200 years ago.',
  percent: 'Percent means "out of one hundred".',
  rope: 'Builders long ago used a rope with 3, 4 and 5 equal parts to make perfectly square corners.',
  prime: 'There is no largest prime number. They go on forever.',
  mean: 'The mean is what everyone would get if the total were shared out equally.',
  negative: 'Negative numbers were used in China about 2,000 years ago to keep track of debts.',
  pi: 'The digits of pi go on forever without repeating.',
} as const;

const TEACH = {
  count: ['How do you count things?', 'Say one number for each thing.', 'Say numbers very fast.', 'Skip the small ones.'],
  add: ['Why can you start with the bigger number when you add?', 'The order does not change the total.', 'Bigger numbers are easier to see.', 'You must always start with the smaller number.'],
  sub: ['How can you check a subtraction?', 'Add the answer to the number you took away.', 'Subtract again.', 'Count the letters.'],
  addYoung: ['What does adding do?', 'It puts groups together.', 'It takes some away.', 'It makes things small.'],
  subYoung: ['What does taking away do?', 'It makes the group smaller.', 'It makes the group bigger.', 'It changes the color.'],
} satisfies Record<string, Teach>;

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

const counting: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  const thing = thingOf(ctx);
  if (g <= 1) {
    const n = g === 0 ? rng.int(2, 5) : rng.int(5 + ctx.step, 9 + ctx.step);
    return {
      title: title(ctx, 'Count'),
      intro: `Look at the ${thing.many}.`,
      question: `How many ${thing.many} can you see?`,
      answer: n,
      hints: ['Touch each one as you count.', 'Say one number for each one.'],
      steps: [`Point to each ${thing.one} once.`, `Count: ${range(1, n).join(', ')}.`, `There are ${n}.`],
      explain: 'The last number you say tells how many there are.',
      mistakes: [
        { value: n - 1, why: 'You missed one. Count again slowly.' },
        { value: n + 1, why: 'You counted one twice.' },
      ],
      teach: TEACH.count,
      fun: FUN.count,
      scene: thingScene(ctx, [{ emoji: thing.emoji, count: n }]),
    };
  }
  if (g === 2) {
    const a = rng.int(18, 115);
    return {
      title: title(ctx, 'Count On'),
      intro: say(lead(ctx), `The ${thing.many} are numbered in order.`),
      question: `Count on: ${a}, ${a + 1}, ${a + 2}, __. What number comes next?`,
      answer: a + 3,
      hints: ['Each number is one more than the number before it.', 'Look at the last digit. It goes up by one each time.'],
      steps: ['The numbers go up one at a time.', `After ${a + 2} comes ${a + 3}.`],
      explain: `Counting on means adding one each time, so ${a + 3} comes after ${a + 2}.`,
      mistakes: [
        { value: a + 4, why: 'That skips a number.' },
        { value: a + 2, why: 'That number is already in the list.' },
        { value: a + 13, why: 'Only the ones go up by one here.' },
      ],
      teach: ['What does counting on mean?', 'Saying the next number each time.', 'Starting again from one.', 'Skipping every other number.'],
      fun: FUN.count,
      scene: boardScene(ctx, [`${a}, ${a + 1}, ${a + 2}, ?`]),
    };
  }
  if (g === 3) {
    const jump = rng.pick([2, 5, 10, 100]);
    const start = jump * rng.int(1, jump === 100 ? 5 : 9);
    const seq = [start, start + jump, start + 2 * jump];
    const answer = start + 3 * jump;
    return {
      title: title(ctx, 'Skip Count'),
      intro: say(lead(ctx), `The ${thing.many} are counted in equal jumps.`),
      question: `Skip-count: ${seq.join(', ')}, __. What number comes next?`,
      answer,
      hints: ['How much bigger is each number than the one before?', 'Make the same jump one more time.'],
      steps: [`From ${seq[0]} to ${seq[1]} is a jump of ${jump}.`, `Every jump is ${jump}.`, `${seq[2]} + ${jump} = ${answer}.`],
      explain: `The numbers go up by ${jump} each time, so the next one is ${answer}.`,
      mistakes: [
        { value: (seq[2] as number) + 1, why: 'The jumps are bigger than one.' },
        { value: answer + jump, why: 'That is one jump too far.' },
        { value: seq[2] as number, why: 'That number is already in the list.' },
      ],
      teach: ['What is skip-counting?', 'Counting in equal jumps.', 'Counting backward.', 'Counting only odd numbers.'],
      fun: FUN.count,
      scene: boardScene(ctx, [`${seq.join(', ')}, ?`]),
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Addition and subtraction
// ---------------------------------------------------------------------------

function columnSteps(a: number, b: number, add: boolean): string[] {
  const names = ['ones', 'tens', 'hundreds', 'thousands', 'ten thousands', 'hundred thousands'];
  const steps: string[] = [];
  let carry = 0;
  const places = Math.max(String(a).length, String(b).length);
  for (let place = 0; place < places; place += 1) {
    const da = Math.floor(a / 10 ** place) % 10;
    const db = Math.floor(b / 10 ** place) % 10;
    const name = cap(names[place] ?? 'next place');
    if (add) {
      const total = da + db + carry;
      const before = carry > 0 ? `${da} + ${db} + ${carry}` : `${da} + ${db}`;
      carry = total >= 10 ? 1 : 0;
      steps.push(`${name}: ${before} = ${total}.${carry ? ` Write ${total % 10} and carry 1.` : ''}`);
    } else {
      let top = da - carry;
      const borrowed = carry;
      carry = top < db ? 1 : 0;
      if (carry) top += 10;
      steps.push(`${name}: ${carry ? 'trade from the next place, so ' : ''}${top}${borrowed && !carry ? '' : ''} − ${db} = ${top - db}.`);
    }
  }
  return steps;
}

const addSub: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  const thing = thingOf(ctx);
  if (g === 0) {
    const n = rng.int(1, 4);
    return {
      title: title(ctx, 'One More'),
      intro: `There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? thing.one : thing.many}.`,
      question: 'How many are there with one more?',
      answer: n + 1,
      hints: ['Count them, then count one more.', 'Say the next number.'],
      steps: [`Count the ${thing.many}: ${n}.`, `One more makes ${n + 1}.`],
      explain: 'One more means the next number when you count.',
      mistakes: [
        { value: n, why: 'That is how many there were before one more came.' },
        { value: n + 2, why: 'Only one more came.' },
      ],
      teach: TEACH.addYoung,
      fun: FUN.count,
      scene: thingScene(ctx, [{ emoji: thing.emoji, count: n }]),
    };
  }
  const adding = rng.chance(0.55);
  if (g === 1) {
    if (adding) {
      const a = rng.int(1, 4);
      const b = rng.int(1, 5 - a);
      return {
        title: title(ctx, 'Add'),
        intro: `${cap(String(a))} ${a === 1 ? thing.one : thing.many} ${a === 1 ? 'is' : 'are'} here.`,
        question: `How many are there after ${b} more ${b === 1 ? 'comes' : 'come'}?`,
        answer: a + b,
        hints: ['Count all of them together.', 'Start at the first number and count on.'],
        steps: [`Start with ${a}.`, `Count on ${b} more.`, `${a} and ${b} make ${a + b}.`],
        explain: 'Adding puts the groups together.',
        mistakes: [
          { value: a, why: 'More came, so there are more now.' },
          { value: a + b + 1, why: 'Count again slowly.' },
        ],
        teach: TEACH.addYoung,
        fun: FUN.plus,
        scene: thingScene(ctx, [{ emoji: thing.emoji, count: a }, { emoji: thing.emoji, count: b }]),
      };
    }
    const a = rng.int(2, 5);
    const b = rng.int(1, a - 1);
    return {
      title: title(ctx, 'Take Away'),
      intro: `${cap(String(a))} ${thing.many} are here.`,
      question: `How many are left after ${b} ${b === 1 ? 'goes' : 'go'} away?`,
      answer: a - b,
      hints: ['Take some away, then count the rest.', 'Count back from the first number.'],
      steps: [`Start with ${a}.`, `Take away ${b}.`, `${a} take away ${b} leaves ${a - b}.`],
      explain: 'Taking away makes the group smaller.',
      mistakes: [
        { value: a, why: 'Some went away, so there are fewer now.' },
        { value: a + b, why: 'They went away. They did not come.' },
      ],
      teach: TEACH.subYoung,
      fun: FUN.plus,
      scene: thingScene(ctx, [{ emoji: thing.emoji, count: a }]),
    };
  }
  // Grades 1-4: word problems scaled by grade.
  let a: number;
  let b: number;
  if (g === 2) {
    if (adding) {
      a = rng.int(4, 12);
      b = rng.int(3, Math.min(9, 20 - a));
    } else {
      a = rng.int(9, 20);
      b = rng.int(3, a - 2);
    }
  } else if (g === 3) {
    if (adding) {
      a = rng.int(14, 68);
      b = rng.int(12, 99 - a);
    } else {
      a = rng.int(35, 99);
      b = rng.int(12, a - 11);
    }
  } else if (g === 4) {
    if (adding) {
      a = rng.int(125, 720);
      b = rng.int(108, 999 - a);
    } else {
      a = rng.int(320, 999);
      b = rng.int(108, a - 105);
    }
  } else {
    if (adding) {
      a = rng.int(1250, 58000);
      b = rng.int(1100, 39000);
    } else {
      a = rng.int(5200, 98000);
      b = rng.int(1100, a - 1005);
    }
  }
  const answer = adding ? a + b : a - b;
  const big = Math.max(a, b);
  const steps =
    g === 2
      ? adding
        ? [`Start at ${big}.`, `Count on ${Math.min(a, b)} more.`, `${a} + ${b} = ${answer}.`]
        : [`Start at ${a}.`, `Count back ${b}.`, `${a} − ${b} = ${answer}.`]
      : [...columnSteps(a, b, adding), `So ${fmt(a)} ${adding ? '+' : '−'} ${fmt(b)} = ${fmt(answer)}.`];
  const hints: [string, string] =
    g === 2
      ? adding
        ? ['Start with the bigger number and count on.', 'Try making a ten first, then add what is left.']
        : ['Count back from the bigger number.', 'Or count up from the smaller number to the bigger one.']
      : adding
        ? ['Line the numbers up by place value and start with the ones.', 'When a column makes ten or more, carry one to the next column.']
        : ['Line the numbers up by place value and start with the ones.', 'When the top digit is too small, trade one from the next column.'];
  const mistakes: Mistake[] = adding
    ? [
        { value: answer - 10, why: 'It looks like a carried ten was forgotten.' },
        { value: Math.abs(a - b), why: 'That is the difference. The question asks for the total.' },
        { value: answer + 1, why: 'Close. Check the ones column again.' },
      ]
    : [
        { value: answer + 10, why: 'It looks like a traded ten was forgotten.' },
        { value: a + b, why: 'That is the total. The question asks how many are left.' },
        { value: answer - 1, why: 'Close. Check the ones column again.' },
      ];
  return {
    title: title(ctx, adding ? 'Sums' : 'Take Away'),
    intro: adding
      ? say(lead(ctx), `One box holds ${fmt(a)} ${thing.many} and another box holds ${fmt(b)}.`)
      : say(lead(ctx), `There were ${fmt(a)} ${thing.many}. Then ${fmt(b)} of them were given away.`),
    question: adding ? `How many ${thing.many} are there altogether?` : `How many ${thing.many} are left?`,
    answer,
    hints,
    steps,
    explain: adding
      ? `Adding puts the two groups together: ${fmt(a)} + ${fmt(b)} = ${fmt(answer)}.`
      : `Subtracting finds what is left: ${fmt(a)} − ${fmt(b)} = ${fmt(answer)}.`,
    mistakes,
    teach: adding ? TEACH.add : TEACH.sub,
    fun: FUN.plus,
    scene: boardScene(ctx, [`${fmt(a)} ${adding ? '+' : '−'} ${fmt(b)} = ?`]),
  };
};

// ---------------------------------------------------------------------------
// Place value and comparing
// ---------------------------------------------------------------------------

const placeValue: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g === 0) {
    const [first, second] = rng.sample(ctx.theme.things, 2) as [Thing, Thing];
    const a = rng.int(1, 5);
    let b = rng.int(1, 5);
    if (b === a) b = a === 5 ? 3 : a + 1;
    const more = a > b ? first : second;
    const fewer = a > b ? second : first;
    return {
      title: title(ctx, 'More'),
      intro: `Look at the two groups.`,
      question: 'Which group has more?',
      answer: Math.max(a, b),
      choiceOnly: true,
      options: { right: { label: cap(more.many), emoji: more.emoji }, wrong: [{ label: cap(fewer.many), emoji: fewer.emoji, why: `There are fewer ${fewer.many}.` }] },
      hints: ['Count each group.', 'The bigger number means more.'],
      steps: [`Count the ${first.many}: ${a}.`, `Count the ${second.many}: ${b}.`, `${Math.max(a, b)} is more than ${Math.min(a, b)}.`],
      explain: `There are more ${more.many}.`,
      mistakes: [],
      teach: ['How do you know which group has more?', 'Count both and pick the bigger number.', 'Pick the one on the left.', 'Pick your favorite.'],
      fun: FUN.count,
      scene: thingScene(ctx, [{ emoji: first.emoji, count: a }, { emoji: second.emoji, count: b }]),
    };
  }
  if (g === 1) {
    const a = rng.int(1, 10);
    let b = rng.int(1, 10);
    if (b === a) b = a === 10 ? 4 : a + 1;
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return {
      title: title(ctx, 'Greater'),
      intro: `Here are two numbers.`,
      question: `Which number is greater: ${a} or ${b}?`,
      answer: hi,
      hints: ['Count up from one.', 'The number you say later is greater.'],
      steps: [`Count up: ${lo} comes before ${hi}.`, `So ${hi} is greater.`],
      explain: 'When you count, the greater number comes later.',
      mistakes: [{ value: lo, why: `${lo} comes first when you count, so it is smaller.` }],
      options: { right: { label: String(hi) }, wrong: [{ label: String(lo), why: `${lo} comes first when you count, so it is smaller.` }] },
      teach: ['Which number is greater when you count?', 'The one you say later.', 'The one you say first.', 'They are always the same.'],
      fun: FUN.count,
      scene: cardScene(ctx.theme.scene, [{ text: String(a), scale: 1.4 }, { text: String(b), scale: 1.4 }]),
    };
  }
  if (g === 2) {
    const tens = rng.int(2, 9);
    const ones = rng.int(1, 9);
    const n = tens * 10 + ones;
    if (rng.chance(0.5)) {
      return {
        title: title(ctx, 'Tens and Ones'),
        intro: say(lead(ctx), `A number is built from ${tens} tens and ${ones} ones.`),
        question: 'What number is it?',
        answer: n,
        hints: ['Each ten is worth ten ones.', 'Count the tens by tens first, then add the ones.'],
        steps: [`${tens} tens are ${tens * 10}.`, `${ones} ones are ${ones}.`, `${tens * 10} + ${ones} = ${n}.`],
        explain: `${tens} tens and ${ones} ones make ${n}.`,
        mistakes: [
          { value: ones * 10 + tens, why: 'The tens digit goes on the left.' },
          { value: tens + ones, why: 'Each ten is worth ten, so do not just add the digits.' },
        ],
        teach: ['What does the left digit of a two-digit number show?', 'How many tens there are.', 'How many ones there are.', 'How big the paper is.'],
        fun: FUN.zero,
        scene: boardScene(ctx, [`${tens} tens + ${ones} ones`]),
      };
    }
    return {
      title: title(ctx, 'Tens and Ones'),
      intro: say(lead(ctx), `Look closely at the number ${n}.`),
      question: `How many tens are in ${n}?`,
      answer: tens,
      hints: ['One of the two digits shows the tens.', 'The digit on the left shows the tens.'],
      steps: [`${n} has two digits.`, 'The left digit shows the tens.', `So ${n} has ${tens} tens and ${ones} ones.`],
      explain: `In ${n}, the left digit is ${tens}, so there are ${tens} tens.`,
      mistakes: [
        ...(ones !== tens ? [{ value: ones, why: 'That digit shows the ones.' }] : []),
        { value: n, why: 'That is the whole number, not the number of tens.' },
      ],
      teach: ['What does the right digit of a two-digit number show?', 'How many ones there are.', 'How many tens there are.', 'Nothing at all.'],
      fun: FUN.zero,
      scene: boardScene(ctx, [String(n)]),
    };
  }
  if (g === 3) {
    const digits = rng.sample([1, 2, 3, 4, 5, 6, 7, 8, 9], 3) as [number, number, number];
    const n = digits[0] * 100 + digits[1] * 10 + digits[2];
    const place = rng.int(0, 1);
    const digit = digits[place] as number;
    const value = place === 0 ? digit * 100 : digit * 10;
    return {
      title: title(ctx, 'Digit Value'),
      intro: say(lead(ctx), `Look closely at the number ${n}.`),
      question: `What is the value of the digit ${digit} in ${n}?`,
      answer: value,
      hints: ['Which place is the digit in: hundreds, tens or ones?', `A digit in the ${place === 0 ? 'hundreds' : 'tens'} place is worth that many ${place === 0 ? 'hundreds' : 'tens'}.`],
      steps: [`The digit ${digit} is in the ${place === 0 ? 'hundreds' : 'tens'} place.`, `${digit} ${place === 0 ? 'hundreds' : 'tens'} are worth ${value}.`],
      explain: `The place of a digit decides its value. Here ${digit} stands for ${value}.`,
      mistakes: [
        { value: digit, why: 'That is the digit. Its value depends on its place.' },
        { value: place === 0 ? digit * 10 : digit * 100, why: 'Check which place the digit is in.' },
      ],
      teach: ['Why is the 4 in 400 worth more than the 4 in 40?', 'It is in the hundreds place.', 'It is written bigger.', 'It comes last.'],
      fun: FUN.zero,
      scene: boardScene(ctx, [String(n)]),
    };
  }
  if (g === 4 || g === 5) {
    const toPlace = g === 4 ? rng.pick([10, 100]) : rng.pick([1000, 10000]);
    let n = g === 4 ? rng.int(112, 987) : rng.int(12050, 987000);
    if (n % toPlace === 0 || (n % toPlace) * 2 === toPlace) n += toPlace === 10 ? 3 : 7;
    const lo = Math.floor(n / toPlace) * toPlace;
    const hi = lo + toPlace;
    const answer = n - lo >= toPlace / 2 ? hi : lo;
    const digitRight = Math.floor((n % toPlace) / (toPlace / 10));
    const placeName = toPlace === 10 ? 'ten' : toPlace === 100 ? 'hundred' : toPlace === 1000 ? 'thousand' : 'ten thousand';
    return {
      title: title(ctx, 'Rounding'),
      intro: say(lead(ctx), `A counter shows ${fmt(n)}.`),
      question: `Round ${fmt(n)} to the nearest ${placeName}.`,
      answer,
      hints: [`Which two ${placeName}s is the number between?`, 'Look at the digit just to the right of the rounding place. Five or more rounds up.'],
      steps: [
        `${fmt(n)} is between ${fmt(lo)} and ${fmt(hi)}.`,
        `The digit to the right of the rounding place is ${digitRight}.`,
        digitRight >= 5 ? 'Five or more means round up.' : 'Less than five means round down.',
        `So ${fmt(n)} rounds to ${fmt(answer)}.`,
      ],
      explain: `${fmt(n)} is closer to ${fmt(answer)} than to ${fmt(answer === lo ? hi : lo)}.`,
      mistakes: [
        { value: answer === lo ? hi : lo, why: 'Check the digit to the right of the rounding place.' },
        { value: Math.round(n / (toPlace / 10)) * (toPlace / 10), why: 'That is rounded to a smaller place than the question asks for.' },
      ],
      teach: ['When do you round up?', 'When the next digit is five or more.', 'Always.', 'When the number is even.'],
      fun: FUN.zero,
      scene: boardScene(ctx, [fmt(n)]),
    };
  }
  if (g === 6) {
    const whole = rng.int(1, 9);
    const tenth = rng.int(1, 9);
    const x = Number(`${whole}.${tenth}`);
    const times = rng.chance(0.6);
    const answer = times ? whole * 10 + tenth : Number(`0.${whole}${tenth}`);
    return {
      title: title(ctx, 'Ten Times'),
      intro: say(lead(ctx), 'Each place in a number is worth ten times the place to its right.'),
      question: times ? `What is ${x} × 10?` : `What is ${x} ÷ 10?`,
      answer,
      allowDecimal: true,
      hints: [
        times ? 'Multiplying by ten moves every digit one place to the left.' : 'Dividing by ten moves every digit one place to the right.',
        times ? 'Each digit becomes worth ten times as much.' : 'Each digit becomes worth one tenth as much.',
      ],
      steps: times
        ? [`${whole} ones become ${whole} tens.`, `${tenth} tenths become ${tenth} ones.`, `So ${x} × 10 = ${answer}.`]
        : [`${whole} ones become ${whole} tenths.`, `${tenth} tenths become ${tenth} hundredths.`, `So ${x} ÷ 10 = ${answer}.`],
      explain: times ? `Multiplying by 10 shifts each digit one place to the left: ${x} becomes ${answer}.` : `Dividing by 10 shifts each digit one place to the right: ${x} becomes ${answer}.`,
      mistakes: [
        { value: times ? Math.round((x + 10) * 10) / 10 : Math.round((x - 1) * 10) / 10, why: times ? 'Multiplying by ten is not the same as adding ten.' : 'Dividing by ten is not the same as subtracting.' },
        { value: times ? Number(`0.${whole}${tenth}`) : whole * 10 + tenth, why: 'The digits moved the wrong way.' },
        { value: times ? (whole * 10 + tenth) * 10 : Number(`0.0${whole}${tenth}`), why: 'The digits moved one place too far.' },
      ],
      teach: ['What happens to a digit when you multiply by ten?', 'It moves one place to the left and is worth ten times as much.', 'It disappears.', 'It stays where it is.'],
      fun: FUN.zero,
      scene: boardScene(ctx, [times ? `${x} × 10 = ?` : `${x} ÷ 10 = ?`]),
    };
  }
  if (g === 7) {
    const a = -rng.int(2, 12);
    const b = rng.int(2, 12);
    const answer = b - a;
    return {
      title: title(ctx, 'Number Line'),
      intro: say(lead(ctx), `Two markers sit on a number line at ${a} and ${b}.`),
      question: `How far apart are ${a} and ${b} on the number line?`,
      answer,
      hints: ['Find how far each number is from zero.', 'The numbers are on opposite sides of zero, so add the two distances.'],
      steps: [`${a} is ${-a} away from zero.`, `${b} is ${b} away from zero.`, `${-a} + ${b} = ${answer}.`],
      explain: `The distance from zero is the absolute value. ${a} and ${b} are ${-a} and ${b} from zero, so they are ${answer} apart.`,
      mistakes: [
        { value: Math.abs(b + a), why: 'The numbers are on opposite sides of zero, so their distances add.' },
        { value: b, why: 'That is only the distance from zero to the positive number.' },
        { value: -a, why: 'That is only the distance from zero to the negative number.' },
      ],
      teach: ['What is the absolute value of a number?', 'Its distance from zero.', 'The number with a minus sign.', 'Twice the number.'],
      fun: FUN.negative,
      scene: boardScene(ctx, [`${a}  ...  0  ...  ${b}`]),
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Multiplication, division and powers
// ---------------------------------------------------------------------------

const multDiv: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  const thing = thingOf(ctx);
  if (g === 3) {
    const rows = rng.int(2, 4);
    const cols = rng.int(2, rows === 4 ? 3 : 4);
    const total = rows * cols;
    return {
      title: title(ctx, 'Equal Groups'),
      intro: say(lead(ctx), `The ${thing.many} stand in ${rows} rows with ${cols} in each row.`),
      question: `How many ${thing.many} are there in all?`,
      answer: total,
      hints: ['Add the same number once for each row.', 'Skip-count by the number in one row.'],
      steps: [`Each row has ${cols}.`, `Add ${cols} once for each row: ${Array.from({ length: rows }, () => cols).join(' + ')}.`, `That makes ${total}.`],
      explain: `${rows} equal rows of ${cols} make ${total}.`,
      mistakes: [
        { value: rows + cols, why: 'You added the two numbers. Count every row.' },
        { value: total - cols, why: 'One row is missing.' },
        { value: total + cols, why: 'That is one row too many.' },
      ],
      teach: ['What do equal groups mean?', 'Every group has the same number.', 'Every group is a different size.', 'There is only one group.'],
      fun: FUN.times,
      scene: thingScene(ctx, [{ emoji: thing.emoji, count: total }]),
    };
  }
  if (g === 4) {
    const a = rng.int(3, 9);
    const b = rng.int(3, 10);
    const product = a * b;
    if (rng.chance(0.55)) {
      return {
        title: title(ctx, 'Times'),
        intro: say(lead(ctx), `There are ${a} bags with ${b} ${thing.many} in each bag.`),
        question: `How many ${thing.many} are there in all?`,
        answer: product,
        hints: ['Think of equal groups.', 'Use a fact you know and build from it, such as doubling.'],
        steps: [`${a} groups of ${b} means ${a} × ${b}.`, `Skip-count by ${b}: ${range(1, Math.min(a, 5)).map((k) => k * b).join(', ')}${a > 5 ? ' and so on' : ''}.`, `${a} × ${b} = ${product}.`],
        explain: `${a} equal groups of ${b} make ${a} × ${b} = ${product}.`,
        mistakes: [
          { value: a + b, why: 'You added. Equal groups need multiplying.' },
          { value: product - b, why: 'That is one group too few.' },
          { value: product + a, why: 'Close. Check the fact once more.' },
        ],
        teach: ['What does 4 × 6 mean?', 'Four equal groups of six.', 'Four plus six.', 'Six take away four.'],
        fun: FUN.times,
        scene: boardScene(ctx, [`${a} × ${b} = ?`]),
      };
    }
    return {
      title: title(ctx, 'Sharing'),
      intro: say(lead(ctx), `${product} ${thing.many} are shared equally among ${a} friends.`),
      question: `How many ${thing.many} does each friend get?`,
      answer: b,
      hints: ['Think: what number times the number of friends makes the total?', 'Use the matching multiplication fact.'],
      steps: [`Sharing equally means dividing: ${product} ÷ ${a}.`, `${a} × ${b} = ${product}.`, `So ${product} ÷ ${a} = ${b}.`],
      explain: `Division undoes multiplication. Since ${a} × ${b} = ${product}, each friend gets ${b}.`,
      mistakes: [
        { value: product - a, why: 'You subtracted. Sharing equally needs dividing.' },
        { value: b + 1, why: 'Close. Check with multiplication.' },
        { value: b - 1, why: 'Close. Check with multiplication.' },
      ],
      teach: ['How can you check a division?', 'Multiply the answer by the number you divided by.', 'Add the two numbers.', 'Divide again.'],
      fun: FUN.times,
      scene: boardScene(ctx, [`${product} ÷ ${a} = ?`]),
    };
  }
  if (g === 5) {
    if (rng.chance(0.55)) {
      const n = rng.int(112, 899);
      const d = rng.int(3, 9);
      const h = Math.floor(n / 100) * 100;
      const t = Math.floor((n % 100) / 10) * 10;
      const o = n % 10;
      const answer = n * d;
      const parts = [h, t, o].filter((part) => part > 0);
      return {
        title: title(ctx, 'Big Times'),
        intro: say(lead(ctx), `Each of ${d} crates holds ${n} ${thing.many}.`),
        question: `How many ${thing.many} are there in all?`,
        answer,
        hints: ['Split the big number into hundreds, tens and ones.', 'Multiply each part, then add the parts.'],
        steps: [`Split ${n} into ${parts.join(' + ')}.`, ...parts.map((part) => `${d} × ${part} = ${fmt(d * part)}.`), `Add the parts: ${parts.map((part) => fmt(d * part)).join(' + ')} = ${fmt(answer)}.`],
        explain: `Multiplying each place and adding the parts gives ${d} × ${n} = ${fmt(answer)}.`,
        mistakes: [
          { value: d * h + t + o, why: 'Every part of the number must be multiplied, not only the hundreds.' },
          { value: answer - d * 10, why: 'It looks like a ten was lost while adding the parts.' },
          { value: n + d, why: 'You added. Equal groups need multiplying.' },
        ],
        teach: ['Why can you split a number before multiplying?', 'Multiplying each part and adding gives the same total.', 'Splitting makes the number smaller.', 'It only works for even numbers.'],
        fun: FUN.times,
        scene: boardScene(ctx, [`${d} × ${n} = ?`]),
      };
    }
    const d = rng.int(3, 9);
    const q = rng.int(12, 60);
    const r = rng.int(1, d - 1);
    const n = d * q + r;
    return {
      title: title(ctx, 'Leftovers'),
      intro: say(lead(ctx), `${n} ${thing.many} are packed into boxes of ${d}.`),
      question: `How many ${thing.many} are left over after the full boxes are packed?`,
      answer: r,
      hints: ['Find how many full boxes can be packed.', 'The leftover is the total minus everything in the full boxes.'],
      steps: [`${d} × ${q} = ${d * q}, which fits into ${n}.`, `${d} × ${q + 1} = ${d * (q + 1)}, which is too many.`, `${n} − ${d * q} = ${r} left over.`],
      explain: `${n} ÷ ${d} = ${q} with a remainder of ${r}, because ${d} × ${q} = ${d * q}.`,
      mistakes: [
        { value: q, why: 'That is the number of full boxes, not the leftover.' },
        { value: d - r, why: 'That is how many more are needed to fill another box.' },
        { value: 0, why: `${n} is not a multiple of ${d}, so something is left over.` },
      ],
      teach: ['What is a remainder?', 'What is left after making equal groups.', 'The number of groups.', 'The biggest number in the problem.'],
      fun: FUN.times,
      scene: boardScene(ctx, [`${n} ÷ ${d} = ? remainder ?`]),
    };
  }
  if (g === 6) {
    if (rng.chance(0.5)) {
      const a = rng.int(12, 48);
      const tens = rng.int(1, 3) * 10;
      const ones = rng.int(1, 9);
      const b = tens + ones;
      const answer = a * b;
      return {
        title: title(ctx, 'Two-Digit Times'),
        intro: say(lead(ctx), `A hall has ${b} rows with ${a} seats in each row.`),
        question: 'How many seats are there in all?',
        answer,
        hints: ['Split one number into tens and ones.', 'Multiply by the tens, multiply by the ones, then add.'],
        steps: [`Split ${b} into ${tens} + ${ones}.`, `${a} × ${tens} = ${fmt(a * tens)}.`, `${a} × ${ones} = ${fmt(a * ones)}.`, `${fmt(a * tens)} + ${fmt(a * ones)} = ${fmt(answer)}.`],
        explain: `Using partial products, ${a} × ${b} = ${fmt(a * tens)} + ${fmt(a * ones)} = ${fmt(answer)}.`,
        mistakes: [
          { value: a * (tens / 10) + a * ones, why: 'The tens digit stands for tens, so that partial product needs a zero.' },
          { value: a * tens, why: 'The ones part still has to be multiplied and added.' },
          { value: answer + a, why: 'Close. Check the partial products.' },
        ],
        teach: ['What is a partial product?', 'The product of one part of a number.', 'Half of the answer.', 'A product that is wrong.'],
        fun: FUN.times,
        scene: boardScene(ctx, [`${a} × ${b} = ?`]),
      };
    }
    const dv = rng.int(12, 36);
    const q = rng.int(6, 24);
    const n = dv * q;
    return {
      title: title(ctx, 'Long Division'),
      intro: say(lead(ctx), `${fmt(n)} ${thing.many} are packed equally into ${dv} boxes.`),
      question: `How many ${thing.many} go in each box?`,
      answer: q,
      hints: ['Estimate first: about how many times does the divisor fit?', 'Check your estimate by multiplying, then adjust.'],
      steps: [`Think: ${dv} × ? = ${fmt(n)}.`, `${dv} × ${Math.floor(q / 10) * 10 || q} = ${fmt(dv * (Math.floor(q / 10) * 10 || q))}.`, `${dv} × ${q} = ${fmt(n)}.`, `So ${fmt(n)} ÷ ${dv} = ${q}.`],
      explain: `${fmt(n)} ÷ ${dv} = ${q}, because ${dv} × ${q} = ${fmt(n)}.`,
      mistakes: [
        { value: q + 1, why: 'Close. Multiply back to check.' },
        { value: q - 1, why: 'Close. Multiply back to check.' },
        { value: q * 10, why: 'Check the place value of your answer.' },
      ],
      teach: ['How can you check a division?', 'Multiply the answer by the divisor.', 'Add the divisor to the answer.', 'Divide the answer by two.'],
      fun: FUN.times,
      scene: boardScene(ctx, [`${fmt(n)} ÷ ${dv} = ?`]),
    };
  }
  if (g === 7) {
    const kind = rng.pick(['gcf', 'lcm', 'power'] as const);
    if (kind === 'power') {
      const [base, exp] = rng.pick([[2, 3], [2, 4], [2, 5], [3, 3], [3, 4], [4, 3], [5, 3], [10, 3], [10, 4], [6, 2], [7, 2]] as const);
      const answer = base ** exp;
      const running = range(2, exp).map((k) => `${base ** (k - 1)} × ${base} = ${fmt(base ** k)}`);
      return {
        title: title(ctx, 'Powers'),
        intro: say(lead(ctx), 'An exponent is a short way to write repeated multiplication.'),
        question: `What is ${base} to the power of ${exp}?`,
        answer,
        hints: ['The exponent tells how many times the base is used as a factor.', 'Multiply the base by itself, one step at a time.'],
        steps: [`It means ${Array.from({ length: exp }, () => base).join(' × ')}.`, ...running.map((line) => `${line}.`)],
        explain: `${base} to the power of ${exp} means ${exp} factors of ${base} multiplied together, which is ${fmt(answer)}.`,
        mistakes: [
          { value: base * exp, why: 'The exponent says how many times to multiply the base by itself. It is not a factor.' },
          { value: base + exp, why: 'A power is repeated multiplication, not addition.' },
          { value: base ** (exp - 1), why: 'One factor is missing.' },
        ],
        teach: ['What does an exponent tell you?', 'How many times the base is multiplied by itself.', 'What to add to the base.', 'What to multiply the base by.'],
        fun: FUN.times,
        scene: boardScene(ctx, [`${base}^${exp} = ?`]),
      };
    }
    const common = rng.int(2, 9);
    const [m, n] = rng.pick([[2, 3], [3, 4], [2, 5], [3, 5], [4, 5], [1, 2], [1, 3], [2, 7]] as const);
    const a = common * m;
    const b = common * n;
    const factors = (x: number): number[] => range(1, x).filter((f) => x % f === 0);
    if (kind === 'gcf') {
      return {
        title: title(ctx, 'Common Factor'),
        intro: say(lead(ctx), `${a} red tiles and ${b} blue tiles must be put into equal rows of one color.`),
        question: `What is the greatest common factor of ${a} and ${b}?`,
        answer: common,
        hints: ['List the factors of each number.', 'Look for the biggest number that is in both lists.'],
        steps: [`Factors of ${a}: ${factors(a).join(', ')}.`, `Factors of ${b}: ${factors(b).join(', ')}.`, `The biggest number in both lists is ${common}.`],
        explain: `${common} is the largest number that divides both ${a} and ${b} exactly.`,
        mistakes: [
          { value: 1, why: 'One is a common factor, but it is not the greatest.' },
          { value: a * n, why: 'That is the least common multiple, not the greatest common factor.' },
          { value: Math.min(a, b), why: 'The smaller number is not always a factor of the bigger one.' },
        ],
        teach: ['What is a common factor?', 'A number that divides both numbers exactly.', 'A number bigger than both.', 'The sum of both numbers.'],
        fun: FUN.prime,
        scene: boardScene(ctx, [`GCF of ${a} and ${b} = ?`]),
      };
    }
    const lcm = common * m * n;
    const multiples = (x: number): string => range(1, Math.min(8, Math.ceil(lcm / x))).map((k) => k * x).join(', ');
    return {
      title: title(ctx, 'Common Multiple'),
      intro: say(lead(ctx), `One light blinks every ${a} seconds and another every ${b} seconds. They start together.`),
      question: 'After how many seconds do they next blink together?',
      answer: lcm,
      hints: ['List the multiples of each number.', 'Look for the first number that is in both lists.'],
      steps: [`Multiples of ${a}: ${multiples(a)}.`, `Multiples of ${b}: ${multiples(b)}.`, `The first number in both lists is ${lcm}.`],
      explain: `${lcm} is the least common multiple of ${a} and ${b}: the smallest number both divide into exactly.`,
      mistakes: [
        { value: a * b, why: 'That is a common multiple, but not always the smallest one.' },
        { value: common, why: 'That is the greatest common factor, not the least common multiple.' },
        { value: a + b, why: 'Adding the numbers does not give a common multiple.' },
      ].filter((mistake) => mistake.value !== lcm),
      teach: ['What is a common multiple?', 'A number that both numbers divide into exactly.', 'A number smaller than both.', 'The difference of the numbers.'],
      fun: FUN.prime,
      scene: boardScene(ctx, [`LCM of ${a} and ${b} = ?`]),
    };
  }
  if (g === 8) {
    const a = rng.int(2, 12) * (rng.chance(0.7) ? -1 : 1);
    const b = rng.int(2, 12) * (a > 0 || rng.chance(0.5) ? -1 : 1);
    const dividing = rng.chance(0.4);
    const product = a * b;
    const answer = dividing ? b : product;
    const sameSigns = (dividing ? product * a : a * b) > 0;
    return {
      title: title(ctx, 'Signs'),
      intro: say(lead(ctx), 'Positive and negative numbers follow a simple sign rule when you multiply or divide.'),
      question: dividing ? `What is ${product} ÷ ${a < 0 ? `(${a})` : a}?` : `What is ${a} × ${b < 0 ? `(${b})` : b}?`,
      answer,
      allowNegative: true,
      hints: ['Work out the answer without the signs first.', 'Then decide the sign: same signs give a positive answer, different signs give a negative answer.'],
      steps: [
        dividing ? `Without signs: ${Math.abs(product)} ÷ ${Math.abs(a)} = ${Math.abs(b)}.` : `Without signs: ${Math.abs(a)} × ${Math.abs(b)} = ${Math.abs(product)}.`,
        sameSigns ? 'The two numbers have the same sign, so the answer is positive.' : 'The two numbers have different signs, so the answer is negative.',
        `The answer is ${answer}.`,
      ],
      explain: 'Same signs give a positive result and different signs give a negative result.',
      mistakes: [
        { value: -answer, why: 'The size is right, but check the sign rule.' },
        { value: dividing ? product - a : a + b, why: dividing ? 'You subtracted. The question asks you to divide.' : 'You added. The question asks you to multiply.' },
      ],
      teach: ['What is the sign of a negative number times a negative number?', 'Positive.', 'Negative.', 'Zero.'],
      fun: FUN.negative,
      scene: boardScene(ctx, [dividing ? `${product} ÷ (${a}) = ?` : `${a} × (${b}) = ?`]),
    };
  }
  if (g === 9) {
    const kind = rng.pick(['sqrt', 'cbrt', 'rule'] as const);
    if (kind === 'rule') {
      const base = rng.pick([2, 3, 5, 10]);
      const m = rng.int(2, 6);
      const n = rng.int(2, 6);
      return {
        title: title(ctx, 'Exponent Rule'),
        intro: say(lead(ctx), 'When you multiply powers of the same base, there is a shortcut.'),
        question: `${base}^${m} × ${base}^${n} equals ${base} to which power?`,
        answer: m + n,
        hints: ['Write out how many factors each power stands for.', 'Count all the factors together.'],
        steps: [`${base}^${m} has ${m} factors of ${base}.`, `${base}^${n} has ${n} factors of ${base}.`, `Together there are ${m} + ${n} = ${m + n} factors.`],
        explain: `Multiplying powers of the same base adds the exponents: ${base}^${m} × ${base}^${n} = ${base}^${m + n}.`,
        mistakes: [
          { value: m * n, why: 'The exponents are added, not multiplied, when the powers are multiplied.' },
          { value: Math.abs(m - n), why: 'Subtracting exponents is for dividing powers.' },
        ].filter((mistake) => mistake.value !== m + n),
        teach: ['Why do the exponents add?', 'The factors of both powers are counted together.', 'Bigger numbers always add.', 'It is just a trick with no reason.'],
        fun: FUN.times,
        scene: boardScene(ctx, [`${base}^${m} × ${base}^${n} = ${base}^?`]),
      };
    }
    if (kind === 'cbrt') {
      const n = rng.int(2, 6);
      const cube = n ** 3;
      return {
        title: title(ctx, 'Cube Root'),
        intro: say(lead(ctx), `A cube-shaped box is built from ${cube} small unit cubes.`),
        question: `What is the cube root of ${cube}?`,
        answer: n,
        hints: ['Which whole number, used as a factor three times, gives this number?', 'Try small whole numbers one at a time.'],
        steps: [`Look for a number that multiplied by itself three times gives ${cube}.`, `${n} × ${n} = ${n * n}.`, `${n * n} × ${n} = ${cube}.`, `So the cube root is ${n}.`],
        explain: `${n} × ${n} × ${n} = ${cube}, so the cube root of ${cube} is ${n}.`,
        mistakes: [
          { value: Math.round(cube / 3), why: 'Dividing by three is not the same as taking a cube root.' },
          { value: n + 1, why: 'Check by multiplying it by itself three times.' },
          { value: n * n, why: 'That is the square of the answer.' },
        ].filter((mistake) => mistake.value !== n),
        teach: ['What is a cube root?', 'The number that multiplied by itself three times gives the cube.', 'One third of the number.', 'The number times three.'],
        fun: FUN.geometry,
        scene: boardScene(ctx, [`cube root of ${cube} = ?`]),
      };
    }
    const n = rng.int(4, 15);
    const square = n * n;
    return {
      title: title(ctx, 'Square Root'),
      intro: say(lead(ctx), `A square floor is covered by ${square} square tiles.`),
      question: `What is the square root of ${square}?`,
      answer: n,
      hints: ['Which whole number multiplied by itself gives this number?', 'Try whole numbers near a square you already know.'],
      steps: [`Look for a number that times itself is ${square}.`, `${n} × ${n} = ${square}.`, `So the square root is ${n}.`],
      explain: `${n} × ${n} = ${square}, so the square root of ${square} is ${n}.`,
      mistakes: [
        { value: square / 2, why: 'Halving is not the same as taking a square root.' },
        { value: n + 1, why: 'Check by multiplying it by itself.' },
        { value: n - 1, why: 'Check by multiplying it by itself.' },
      ].filter((mistake) => Number.isInteger(mistake.value)),
      teach: ['What is a square root?', 'The number that multiplied by itself gives the square.', 'Half of the number.', 'The number times two.'],
      fun: FUN.rope,
      scene: boardScene(ctx, [`√${square} = ?`]),
    };
  }
  return null;
};

export const MATH_MAKERS_A: Record<string, ProblemMaker> = {
  'math-counting-cardinality': counting,
  'math-addition-subtraction': addSub,
  'math-place-value': placeValue,
  'math-multiplication-division': multDiv,
};
