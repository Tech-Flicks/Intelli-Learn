/**
 * Procedural knowledge sets for math, so that math can also be practised by sorting, matching,
 * ordering and tapping. The sets are built fresh for each request from the seeded generator.
 */
import type { Teach } from '../assemble';
import type { Ctx } from '../context';
import type { CatBin, CatSet, Item, KnowledgeSet, Pair, PairSet, SeqSet } from '../sets/types';
import { fmt } from '../problem';
import { range, titleOf } from './kit';
import { moreMathSets } from './mathSets2';

const num = (n: number): Item => ({ label: fmt(n) });
const text = (label: string): Item => ({ label });

function base(ctx: Ctx, id: string, skills: readonly string[]) {
  return { id: `math-${id}-${ctx.g}`, strand: 'math' as const, skills, grades: [ctx.grade, ctx.grade] as const, scene: ctx.theme.scene };
}

function sampleWhere(ctx: Ctx, lo: number, hi: number, keep: (n: number) => boolean, count: number): number[] {
  return ctx.rng.sample(range(lo, hi).filter(keep), count);
}

/** `count` different whole numbers from lo to hi, drawn without building the whole range (it can span a million numbers). */
function distinctInts(ctx: Ctx, lo: number, hi: number, count: number): number[] {
  const picked = new Set<number>();
  const want = Math.min(count, hi - lo + 1);
  while (picked.size < want) picked.add(ctx.rng.int(lo, hi));
  return [...picked];
}

const isPrime = (n: number): boolean => n >= 2 && range(2, Math.floor(Math.sqrt(n))).every((d) => n % d !== 0);

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function twoBins(ctx: Ctx, id: string, skills: readonly string[], name: string, intro: string, hint: string, explain: string, teach: Teach, a: CatBin, b: CatBin, fun?: string): CatSet {
  return { ...base(ctx, id, skills), type: 'cat', title: titleOf(ctx, name), intro, hint, explain, teach, bins: [a, b], ...(fun ? { fun } : {}) };
}

function catSets(ctx: Ctx): CatSet[] {
  const { g, rng } = ctx;
  const out: CatSet[] = [];
  const cmp = ['math-counting-cardinality', 'math-place-value'];
  if (g <= 1) {
    out.push({
      ...base(ctx, 'round', ['math-geometry-shapes']),
      type: 'cat',
      title: titleOf(ctx, 'Shapes'),
      intro: 'Some things are round.',
      hint: 'Look for corners.',
      explain: 'Round things have no corners.',
      teach: ['What makes a shape round?', 'It has no corners.', 'It is big.', 'It is red.'],
      fun: 'A circle has no corners at all.',
      bins: [
        { label: 'Round', emoji: '⚪', one: 'a round thing', many: 'round things', rule: 'Round things have no corners.', items: [{ label: 'ball', emoji: '⚽' }, { label: 'moon', emoji: '🌕' }, { label: 'orange', emoji: '🍊' }, { label: 'cookie', emoji: '🍪' }, { label: 'clock', emoji: '🕐' }] },
        { label: 'Has corners', emoji: '⬜', one: 'a thing with corners', many: 'things with corners', rule: 'These things have pointy corners.', items: [{ label: 'box', emoji: '📦' }, { label: 'door', emoji: '🚪' }, { label: 'book', emoji: '📕' }, { label: 'letter', emoji: '✉️' }, { label: 'gift', emoji: '🎁' }] },
      ],
    });
    const small = g === 0 ? [1, 2, 3] : [1, 2, 3, 4];
    const big = g === 0 ? [8, 9, 10] : [6, 7, 8, 9];
    out.push(
      twoBins(ctx, 'smallbig', cmp, 'Numbers', 'Some numbers are small.', 'Count up from one.', 'Small numbers come first when you count.', ['Which numbers come first when you count?', 'The small ones.', 'The big ones.', 'The red ones.'],
        { label: 'Small', emoji: '🐜', one: 'a small number', many: 'small numbers', rule: 'Small numbers come first when you count.', items: small.map(num) },
        { label: 'Big', emoji: '🐘', one: 'a big number', many: 'big numbers', rule: 'Big numbers come later when you count.', items: big.map(num) },
      ),
    );
    return out;
  }
  if (g <= 4) {
    const top = g === 2 ? 20 : g === 3 ? 100 : 999;
    out.push(
      twoBins(ctx, 'evenodd', ['math-counting-cardinality', 'math-multiplication-division', 'math-place-value'], 'Even and Odd', 'Every whole number is either even or odd.', 'Look at the last digit of each number.', 'Even numbers can be split into two equal groups. Odd numbers always have one left over.', ['How can you tell that a number is even?', 'Its last digit is 0, 2, 4, 6 or 8.', 'It has two digits.', 'It is bigger than ten.'],
        { label: 'Even', emoji: '👯', one: 'an even number', many: 'even numbers', rule: 'Even numbers make pairs with nothing left over.', items: sampleWhere(ctx, 2, top, (n) => n % 2 === 0, 5).map(num) },
        { label: 'Odd', emoji: '☝️', one: 'an odd number', many: 'odd numbers', rule: 'Odd numbers always have one left over.', items: sampleWhere(ctx, 1, top, (n) => n % 2 === 1, 5).map(num) },
        'Zero is an even number.',
      ),
    );
    const mid = g === 2 ? 10 : g === 3 ? 50 : 500;
    out.push(
      twoBins(ctx, 'lessmore', cmp, 'Less or More', `The number ${mid} sits in the middle of the number line.`, 'Compare the digit with the biggest place value first.', `Numbers to the left of ${mid} on the number line are less. Numbers to the right are more.`, ['How do you compare two numbers?', 'Start with the biggest place value.', 'Look at the last digit only.', 'Count the digits and stop.'],
        { label: `Less than ${mid}`, emoji: '⬅️', one: `a number less than ${mid}`, many: `numbers less than ${mid}`, rule: 'These numbers come before the middle number.', items: sampleWhere(ctx, 1, mid - 1, () => true, 5).map(num) },
        { label: `More than ${mid}`, emoji: '➡️', one: `a number more than ${mid}`, many: `numbers more than ${mid}`, rule: 'These numbers come after the middle number.', items: sampleWhere(ctx, mid + 1, mid * 2, () => true, 5).map(num) },
      ),
    );
  }
  if (g >= 4 && g <= 6) {
    const k = rng.pick(g === 4 ? [2, 5, 10] : [3, 4, 6, 9]);
    out.push(
      twoBins(ctx, 'multiples', ['math-multiplication-division'], 'Multiples', `Multiples of ${k} are the numbers you say when you skip-count by ${k}.`, 'Skip-count, or try dividing each number.', `A multiple of ${k} can be divided by ${k} with nothing left over.`, ['What is a multiple of a number?', 'A number you reach by skip-counting by it.', 'Any bigger number.', 'A number with the same last digit.'],
        { label: `Multiple of ${k}`, emoji: '✅', one: `a multiple of ${k}`, many: `multiples of ${k}`, rule: 'These numbers divide evenly with nothing left over.', items: rng.sample(range(2, 12), 5).map((n) => num(n * k)) },
        { label: `Not a multiple`, emoji: '❌', one: `a number that is not a multiple of ${k}`, many: `numbers that are not multiples of ${k}`, rule: 'These numbers leave a remainder.', items: sampleWhere(ctx, k + 1, k * 12, (n) => n % k !== 0, 5).map(num) },
      ),
    );
  }
  if (g >= 5 && g <= 7) {
    out.push(
      twoBins(ctx, 'primes', ['math-multiplication-division'], 'Prime Time', 'A prime number has exactly two factors: 1 and itself.', 'Try to divide each number by 2, 3, 5 and 7.', 'Prime numbers cannot be split into equal groups, except groups of one. Composite numbers can.', ['What is a prime number?', 'A number with exactly two factors.', 'Any odd number.', 'A number that ends in 1.'],
        { label: 'Prime', emoji: '💎', one: 'a prime number', many: 'prime numbers', rule: 'A prime has exactly two factors.', items: sampleWhere(ctx, 2, 60, isPrime, 5).map(num) },
        { label: 'Composite', emoji: '🧱', one: 'a composite number', many: 'composite numbers', rule: 'A composite number has more than two factors.', items: sampleWhere(ctx, 4, 60, (n) => !isPrime(n), 5).map(num) },
        'There is no largest prime number. They go on forever.',
      ),
    );
    out.push(
      twoBins(ctx, 'halfmark', ['math-fractions-decimals'], 'Half Mark', 'One half is a handy benchmark for comparing fractions.', 'Compare each top number with half of its bottom number.', 'A fraction is less than one half when its top number is less than half of its bottom number.', ['How can you tell that a fraction is less than one half?', 'Its top number is less than half of its bottom number.', 'Its bottom number is odd.', 'Its top number is 1.'],
        { label: 'Less than 1/2', emoji: '⬇️', one: 'a fraction less than one half', many: 'fractions less than one half', rule: 'The top number is less than half of the bottom number.', items: rng.sample(['1/3', '1/4', '2/5', '3/8', '1/6', '3/10', '2/7'], 4).map(text) },
        { label: 'More than 1/2', emoji: '⬆️', one: 'a fraction more than one half', many: 'fractions more than one half', rule: 'The top number is more than half of the bottom number.', items: rng.sample(['2/3', '3/4', '3/5', '5/8', '5/6', '7/10', '4/7'], 4).map(text) },
      ),
    );
  }
  if (g >= 7) {
    out.push(
      twoBins(ctx, 'squares', ['math-multiplication-division', 'math-algebra-ratios', 'math-geometry-shapes'], 'Perfect Squares', 'A perfect square is a whole number multiplied by itself.', 'Ask: is there a whole number that, times itself, gives this number?', 'Perfect squares such as 49 = 7 × 7 have a whole-number square root.', ['What is a perfect square?', 'A whole number times itself.', 'Any even number.', 'A number with four factors.'],
        { label: 'Perfect square', emoji: '🟩', one: 'a perfect square', many: 'perfect squares', rule: 'It equals a whole number times itself.', items: rng.sample(range(2, 13), 5).map((n) => num(n * n)) },
        { label: 'Not a square', emoji: '🔺', one: 'a number that is not a perfect square', many: 'numbers that are not perfect squares', rule: 'No whole number times itself gives this number.', items: sampleWhere(ctx, 5, 150, (n) => !Number.isInteger(Math.sqrt(n)), 5).map(num) },
      ),
    );
    out.push(
      twoBins(ctx, 'signs', ['math-place-value', 'math-algebra-ratios', 'math-fractions-decimals'], 'Number Line Sides', 'Zero splits the number line into two sides.', 'Look for a minus sign in front of the number.', 'Negative numbers are less than zero and sit to its left. Positive numbers are greater than zero.', ['Where are negative numbers on the number line?', 'To the left of zero.', 'To the right of zero.', 'Exactly on zero.'],
        { label: 'Negative', emoji: '🥶', one: 'a negative number', many: 'negative numbers', rule: 'It is less than zero.', items: rng.sample(['-8', '-3', '-12', '-0.5', '-1/2', '-20', '-4.5'], 5).map(text) },
        { label: 'Positive', emoji: '🌞', one: 'a positive number', many: 'positive numbers', rule: 'It is greater than zero.', items: rng.sample(['7', '15', '0.5', '3/4', '2.5', '40', '9'], 5).map(text) },
        'Negative numbers were used in China about 2,000 years ago to keep track of debts.',
      ),
    );
  }
  if (g >= 9) {
    out.push(
      twoBins(ctx, 'rational', ['math-place-value', 'math-fractions-decimals', 'math-algebra-ratios'], 'Rational or Not', 'A rational number can be written as a fraction of two whole numbers.', 'Square roots of numbers that are not perfect squares never end and never repeat.', 'Rational numbers end or repeat as decimals. Irrational numbers, such as pi, go on forever without a repeating pattern.', ['What makes a number irrational?', 'It cannot be written as a fraction of whole numbers.', 'It is negative.', 'It is very large.'],
        { label: 'Rational', emoji: '🧮', one: 'a rational number', many: 'rational numbers', rule: 'It can be written as a fraction of two whole numbers.', items: rng.sample(['0.5', '3/4', '√16', '-7', '0.25', '√49', '2.6'], 4).map(text) },
        { label: 'Irrational', emoji: '🌀', one: 'an irrational number', many: 'irrational numbers', rule: 'Its decimal goes on forever with no repeating pattern.', items: rng.sample(['√2', 'π', '√3', '√5', '√10', '√7'], 4).map(text) },
        'The digits of pi go on forever without repeating.',
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

function distinctPairs(ctx: Ctx, count: number, make: () => [string, number]): Pair[] {
  const seenLeft = new Set<string>();
  const seenRight = new Set<number>();
  const out: Pair[] = [];
  for (let tries = 0; tries < 200 && out.length < count; tries += 1) {
    const [left, value] = make();
    if (seenLeft.has(left) || seenRight.has(value)) continue;
    seenLeft.add(left);
    seenRight.add(value);
    out.push({ left: text(left), right: num(value), why: `${left} = ${fmt(value)}.` });
  }
  return ctx.rng.shuffle(out);
}

function fixedPairs(ctx: Ctx, rows: readonly (readonly [string, string, string])[], count: number): Pair[] {
  return ctx.rng.sample(rows, count).map(([left, right, why]) => ({ left: text(left), right: text(right), why }));
}

function pairSets(ctx: Ctx): PairSet[] {
  const { g, rng } = ctx;
  const out: PairSet[] = [];
  if (g <= 1) {
    const numbers = rng.sample(g === 0 ? [1, 2, 3, 4, 5] : [3, 4, 5, 6, 7, 8], 4);
    out.push({
      ...base(ctx, 'dots', ['math-counting-cardinality']),
      type: 'pair',
      title: titleOf(ctx, 'Dots'),
      intro: 'Each number has its own dots.',
      hint: 'Count the dots one by one.',
      explain: 'A number tells how many dots there are.',
      teach: ['What does a number tell you?', 'How many there are.', 'What color it is.', 'How big it is.'],
      fun: 'We count in tens because people first counted on their ten fingers.',
      ask: 'Match each number to its dots.',
      q: 'Which dots show {x}?',
      tapQ: 'Tap the dots that show {x}.',
      pairs: numbers.map((n) => ({ left: num(n), right: text('●'.repeat(n)), why: 'Count the dots.' })),
    });
    return out;
  }
  if (g <= 3) {
    const top = g === 2 ? 10 : 50;
    const plus = rng.chance(0.5);
    out.push({
      ...base(ctx, 'sums', ['math-addition-subtraction']),
      type: 'pair',
      title: titleOf(ctx, plus ? 'Sum Match' : 'Difference Match'),
      intro: plus ? 'Every sum has exactly one answer.' : 'Every subtraction has exactly one answer.',
      hint: plus ? 'Start with the bigger number and count on.' : 'Count back, or think of the matching addition.',
      explain: plus ? 'Adding puts two amounts together.' : 'Subtracting finds what is left or the difference.',
      teach: plus ? ['What does adding do?', 'It puts amounts together.', 'It takes some away.', 'It shares equally.'] : ['How can you check a subtraction?', 'Add the answer to the number you took away.', 'Subtract again.', 'Count the digits.'],
      ask: plus ? 'Match each sum to its answer.' : 'Match each subtraction to its answer.',
      q: 'What is {x}?',
      tapQ: 'Tap the answer to {x}.',
      pairs: distinctPairs(ctx, 5, () => {
        const a = rng.int(2, top);
        const b = rng.int(1, top);
        return plus ? [`${a} + ${b}`, a + b] : [`${a + b} − ${b}`, a];
      }),
    });
  }
  if (g >= 4 && g <= 6) {
    const times = rng.chance(0.6);
    out.push({
      ...base(ctx, 'facts', ['math-multiplication-division']),
      type: 'pair',
      title: titleOf(ctx, times ? 'Times Match' : 'Division Match'),
      intro: times ? 'Multiplication is a fast way to add equal groups.' : 'Division shares a number into equal groups.',
      hint: times ? 'Skip-count by one of the numbers.' : 'Think of the matching multiplication fact.',
      explain: times ? 'Each product is the total of equal groups.' : 'Division undoes multiplication.',
      teach: times ? ['What does 4 × 6 mean?', '4 groups of 6.', '4 plus 6.', '46.'] : ['How are multiplying and dividing related?', 'They undo each other.', 'They are the same thing.', 'They are not related.'],
      ask: times ? 'Match each multiplication to its product.' : 'Match each division to its answer.',
      q: 'What is {x}?',
      tapQ: 'Tap the answer to {x}.',
      pairs: distinctPairs(ctx, 5, () => {
        const a = rng.int(2, g === 4 ? 9 : 12);
        const b = rng.int(2, 9);
        return times ? [`${a} × ${b}`, a * b] : [`${a * b} ÷ ${b}`, a];
      }),
    });
  }
  if (g >= 5 && g <= 7) {
    out.push({
      ...base(ctx, 'fracdec', ['math-fractions-decimals']),
      type: 'pair',
      title: titleOf(ctx, 'Fraction Twins'),
      intro: 'A fraction and a decimal can name the same amount.',
      hint: 'Think of money: a quarter of a dollar is 25 cents.',
      explain: 'To turn a fraction into a decimal, divide the top number by the bottom number.',
      teach: ['How do you turn a fraction into a decimal?', 'Divide the top number by the bottom number.', 'Put a point between the two numbers.', 'Add the two numbers.'],
      ask: 'Match each fraction to the decimal with the same value.',
      q: 'Which decimal equals {x}?',
      tapQ: 'Tap the decimal that equals {x}.',
      link: 'a fraction and its decimal',
      pairs: fixedPairs(ctx, [['1/2', '0.5', '1 ÷ 2 = 0.5.'], ['1/4', '0.25', '1 ÷ 4 = 0.25.'], ['3/4', '0.75', '3 ÷ 4 = 0.75.'], ['1/5', '0.2', '1 ÷ 5 = 0.2.'], ['1/10', '0.1', '1 ÷ 10 = 0.1.'], ['2/5', '0.4', '2 ÷ 5 = 0.4.'], ['3/10', '0.3', '3 ÷ 10 = 0.3.']], 5),
    });
  }
  if (g >= 7) {
    out.push({
      ...base(ctx, 'percent', ['math-fractions-decimals', 'math-algebra-ratios']),
      type: 'pair',
      title: titleOf(ctx, 'Percent Twins'),
      intro: 'A fraction and a percent can name the same amount.',
      hint: 'Percent means out of one hundred.',
      explain: 'To turn a fraction into a percent, find the equal fraction with 100 on the bottom.',
      teach: ['What does percent mean?', 'Out of one hundred.', 'Out of ten.', 'Times one hundred and one.'],
      fun: 'Percent means "out of one hundred".',
      ask: 'Match each fraction to the percent with the same value.',
      q: 'Which percent equals {x}?',
      tapQ: 'Tap the percent that equals {x}.',
      link: 'a fraction and its percent',
      pairs: fixedPairs(ctx, [['1/2', '50%', '1/2 = 50/100.'], ['1/4', '25%', '1/4 = 25/100.'], ['3/4', '75%', '3/4 = 75/100.'], ['1/5', '20%', '1/5 = 20/100.'], ['1/10', '10%', '1/10 = 10/100.'], ['3/5', '60%', '3/5 = 60/100.'], ['9/10', '90%', '9/10 = 90/100.']], 5),
    });
    out.push({
      ...base(ctx, 'solve', ['math-algebra-ratios']),
      type: 'pair',
      title: titleOf(ctx, 'Solve and Match'),
      intro: 'Each equation is true for exactly one value of x.',
      hint: 'Undo what was done to x.',
      explain: 'Solving an equation means finding the value that makes both sides equal.',
      teach: ['What keeps an equation balanced?', 'Doing the same thing to both sides.', 'Changing only one side.', 'Swapping the numbers.'],
      ask: 'Match each equation to its solution.',
      q: 'What is x in {x}?',
      tapQ: 'Tap the value of x in {x}.',
      pairs: distinctPairs(ctx, 5, () => {
        const x = rng.int(2, 15);
        const a = rng.int(2, 9);
        const form = rng.int(0, g >= 8 ? 2 : 1);
        if (form === 0) return [`x + ${a} = ${x + a}`, x];
        if (form === 1) return [`${a}x = ${a * x}`, x];
        const b = rng.int(1, 9);
        return [`${a}x + ${b} = ${a * x + b}`, x];
      }).map((p) => ({ ...p, why: 'Put the value back into the equation to check.' })),
    });
  }
  if (g >= 8) {
    out.push({
      ...base(ctx, 'powers', ['math-multiplication-division', 'math-algebra-ratios', 'math-place-value']),
      type: 'pair',
      title: titleOf(ctx, 'Powers and Roots'),
      intro: 'A power is a number multiplied by itself. A root undoes a power.',
      hint: 'Write each power out as a multiplication.',
      explain: 'An exponent tells how many times the base is used as a factor.',
      teach: ['What does 2^3 mean?', '2 × 2 × 2.', '2 × 3.', '2 + 3.'],
      ask: 'Match each expression to its value.',
      q: 'What is the value of {x}?',
      tapQ: 'Tap the value of {x}.',
      pairs: fixedPairs(ctx, [['2^5', '32', '2 × 2 × 2 × 2 × 2 = 32.'], ['√81', '9', '9 × 9 = 81.'], ['3^3', '27', '3 × 3 × 3 = 27.'], ['√144', '12', '12 × 12 = 144.'], ['10^0', '1', 'Any number except zero to the power 0 is 1.'], ['5^2', '25', '5 × 5 = 25.'], ['4^3', '64', '4 × 4 × 4 = 64.']], 5),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function seqSets(ctx: Ctx): SeqSet[] {
  const { g, rng } = ctx;
  let items: Item[];
  let hint = 'Compare the digit with the biggest place value first.';
  let explain = 'On a number line, smaller numbers are on the left and bigger numbers are on the right.';
  let skills: string[] = ['math-place-value', 'math-counting-cardinality'];
  const sorted = (values: number[]): Item[] => [...values].sort((a, b) => a - b).map(num);
  if (g === 0) {
    items = sorted(rng.sample(range(1, 5), 3));
    hint = 'Count up from one.';
    explain = 'Small numbers come first when you count.';
  } else if (g === 1) {
    items = sorted(rng.sample(range(1, 10), 4));
    hint = 'Count up from one.';
    explain = 'Small numbers come first when you count.';
  } else if (g <= 4) {
    items = sorted(distinctInts(ctx, g === 2 ? 11 : 101, g === 2 ? 99 : g === 3 ? 999 : 9999, 5));
  } else if (g === 5) {
    if (rng.chance(0.5)) {
      items = ['1/8', '1/6', '1/4', '1/3', '1/2'].map(text);
      hint = 'When the top numbers are the same, look at the size of the parts.';
      explain = 'The more equal parts a whole is cut into, the smaller each part is.';
      skills = ['math-fractions-decimals'];
    } else {
      items = sorted(distinctInts(ctx, 10000, 999999, 5));
    }
  } else if (g === 6) {
    items = [...rng.sample([0.05, 0.4, 0.45, 0.5, 1.2, 0.09, 0.75, 1.02, 0.8], 5)].sort((a, b) => a - b).map(num);
    hint = 'Line up the decimal points and compare place by place.';
    explain = 'Compare ones first, then tenths, then hundredths.';
    skills = ['math-fractions-decimals', 'math-place-value'];
  } else if (g === 7) {
    const values = rng.sample(range(-12, 12), 5).sort((a, b) => a - b);
    items = values.map((v) => text(String(v)));
    hint = 'Picture a number line. Negative numbers are to the left of zero.';
    explain = 'The farther left a number is on the number line, the smaller it is, so -8 is smaller than -3.';
  } else if (g === 8) {
    items = ['-1.5', '-1/2', '0', '0.25', '3/4', '1.2'].map(text);
    hint = 'Turn every number into a decimal first.';
    explain = 'Writing all the numbers as decimals makes them easy to place on one number line.';
    skills = ['math-fractions-decimals', 'math-place-value'];
  } else {
    items = ['√2', '1.5', '√3', '2', '√5'].map(text);
    hint = 'Each root lies between two whole numbers. Estimate it first.';
    explain = '√2 is about 1.41, √3 is about 1.73 and √5 is about 2.24.';
    skills = ['math-place-value', 'math-multiplication-division', 'math-algebra-ratios'];
  }
  const young = g <= 1;
  return [
    {
      ...base(ctx, 'order', skills),
      type: 'seq',
      title: titleOf(ctx, 'Number Line'),
      intro: young ? 'The numbers are mixed up.' : 'These numbers have fallen off the number line.',
      hint,
      explain,
      teach: young ? ['Which number comes first when you count?', 'The smallest one.', 'The biggest one.', 'Any one.'] : ['Where are smaller numbers on a number line?', 'On the left.', 'On the right.', 'In the middle.'],
      fun: 'The zero was invented long ago to show an empty place in a number.',
      ask: 'Put the numbers in order from smallest to biggest.',
      items,
      ends: ['smallest', 'biggest'],
      rel: ['smaller than', 'bigger than'],
      article: '',
      whole: true,
    },
  ];
}

/** Every math set that suits the grade of this request. */
export function mathSets(ctx: Ctx): KnowledgeSet[] {
  return [...catSets(ctx), ...pairSets(ctx), ...seqSets(ctx), ...moreMathSets(ctx)];
}
