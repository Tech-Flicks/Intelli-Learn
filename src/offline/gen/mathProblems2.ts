/**
 * Procedural math problems, part two: fractions and decimals, geometry, measurement and data,
 * algebra and ratios. Every branch computes its own answer and names the typical mistakes.
 */
import type { ShapeName } from '@/core/schemas';
import type { Teach } from '../assemble';
import { lead, say } from '../context';
import { fmt, type ProblemMaker } from '../problem';
import { cardScene, type Card } from '../scene';
import { problem, range, shapeScene, thingOf, thingScene, tidy } from './kit';

const FUN = {
  fraction: 'The word fraction comes from a Latin word that means "broken".',
  percent: 'Percent means "out of one hundred".',
  geometry: 'The word geometry means "measuring the Earth".',
  honeycomb: 'Bees build their honeycomb out of hexagons.',
  day: 'There are 86,400 seconds in one day.',
  algebra: 'The word algebra comes from an Arabic book written about 1,200 years ago.',
  rope: 'Builders long ago used a rope with 3, 4 and 5 equal parts to make perfectly square corners.',
  mean: 'The mean is what everyone would get if the total were shared out equally.',
  pi: 'The digits of pi go on forever without repeating.',
  meter: 'The meter was first defined using the distance from the North Pole to the equator.',
  equals: 'The equals sign was invented in 1557. Its two lines are the same length.',
  clock: 'Clocks count to 60 because people in ancient Babylon counted in sixties.',
  light: 'Light takes about 8 minutes to travel from the Sun to Earth.',
} as const;

const T = {
  half: ['What does one half mean?', 'One of two equal parts.', 'Any two parts.', 'The bigger part.'],
  unit: ['How do you find one fourth of a number?', 'Split it into 4 equal groups.', 'Take 4 away.', 'Add 4 to it.'],
  equiv: ['Why are 1/2 and 2/4 equal?', 'They cover the same amount of the whole.', 'They use the same digits.', 'A bigger bottom number means a bigger fraction.'],
  like: ['When the parts are the same size, how do you add fractions?', 'Add the top numbers and keep the bottom number.', 'Add the top and the bottom numbers.', 'Multiply everything.'],
  decimal: ['Why do you line up the decimal points?', 'So tenths are added to tenths and ones to ones.', 'It looks neat.', 'So the answer has no decimal point.'],
  percent: ['What does 25% mean?', '25 out of every 100.', '25 times as much.', '25 less than the number.'],
  sci: ['What does multiplying by 10^3 do?', 'It makes the number 1,000 times as big.', 'It adds 3.', 'It multiplies by 30.'],
  sides: ['How do you count the sides of a shape?', 'Count each straight edge once.', 'Count the corners twice.', 'Guess from the color.'],
  perimeter: ['What is perimeter?', 'The distance all the way around a shape.', 'The space inside a shape.', 'The longest side.'],
  area: ['What does area measure?', 'How much flat space a shape covers.', 'The distance around a shape.', 'How tall a shape is.'],
  volume: ['What does volume measure?', 'How much space a solid takes up.', 'The distance around it.', 'How heavy it is.'],
  angle: ['Why can you find a missing angle of a triangle?', 'The three angles always add up to 180°.', 'All angles are equal.', 'The angles add up to 100°.'],
  pyth: ['When does the rule a² + b² = c² work?', 'Only in right triangles.', 'In every triangle.', 'Only in squares.'],
  measure: ['How do you measure with blocks?', 'Line them up with no gaps.', 'Leave big gaps.', 'Stack them up high.'],
  time: ['How many minutes are in one hour?', '60 minutes.', '100 minutes.', '30 minutes.'],
  convert: ['Why do you multiply when you change to a smaller unit?', 'It takes more small units to cover the same amount.', 'Small units are worth more.', 'You always multiply in math.'],
  mean: ['How do you find the mean?', 'Add all the values and divide by how many there are.', 'Pick the biggest value.', 'Pick the middle value without ordering.'],
  chance: ['What does a probability of one fourth tell you?', 'About one in every four tries should work out that way.', 'Exactly every fourth try works.', 'It never happens.'],
  missing: ['How can you find a missing factor?', 'Divide the product by the factor you know.', 'Add the two numbers.', 'Guess any number.'],
  order: ['Which do you do first: add or multiply?', 'Multiply, unless parentheses say otherwise.', 'Always add first.', 'Always work left to right.'],
  equation: ['What keeps an equation balanced?', 'Doing the same thing to both sides.', 'Changing only one side.', 'Swapping the numbers.'],
  ratio: ['What does a ratio of 2 to 3 mean?', 'For every 2 of one thing there are 3 of the other.', 'There are 2 more of one thing.', 'There are 23 things.'],
  slope: ['What does slope tell you?', 'How much a line rises for each step to the right.', 'Where the line starts.', 'How long the line is.'],
} satisfies Record<string, Teach>;

// ---------------------------------------------------------------------------
// Fractions and decimals (Grade 1 to Grade 8)
// ---------------------------------------------------------------------------

const DEN_NAME: Record<number, [string, string]> = { 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['fourth', 'fourths'], 5: ['fifth', 'fifths'], 6: ['sixth', 'sixths'], 8: ['eighth', 'eighths'], 10: ['tenth', 'tenths'] };

const fractions: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  const thing = thingOf(ctx);
  if (g <= 2) {
    const half = rng.int(2, 6);
    return problem(ctx, {
      name: 'Halves',
      intro: say(lead(ctx), `Two friends share ${half * 2} ${thing.many} equally.`),
      q: `How many ${thing.many} are in one half?`,
      a: half,
      h: ['A half is one of two equal groups.', 'Deal them out one by one into two piles.'],
      steps: ['Make two equal groups.', `Deal out all ${half * 2} ${thing.many}.`, `Each group gets ${half}.`],
      why: `${half} and ${half} make ${half * 2}, so one half of ${half * 2} is ${half}.`,
      wrong: [[half * 2, 'That is the whole group, not one half.'], [2, 'That is the number of groups.'], [half + 1, 'The two halves must be equal.']],
      teach: T.half,
      fun: FUN.fraction,
      scene: thingScene(ctx, [{ emoji: thing.emoji, count: half * 2 }]),
    });
  }
  if (g <= 4) {
    const den = g === 3 ? rng.pick([2, 3, 4]) : rng.pick([3, 4, 5, 6, 8]);
    const part = rng.int(2, g === 3 ? 5 : 9);
    const total = den * part;
    const [one] = DEN_NAME[den] as [string, string];
    return problem(ctx, {
      name: 'Fair Shares',
      intro: say(lead(ctx), `There are ${total} ${thing.many} to share.`),
      q: `What is one ${one} of ${total}?`,
      a: part,
      h: [`One ${one} means one of the equal groups.`, 'Think of the matching times-table fact.'],
      steps: [`Split ${total} into ${den} equal groups.`, `${total} ÷ ${den} = ${part}.`, `One ${one} of ${total} is ${part}.`],
      why: `${den} groups of ${part} make ${total}, so one ${one} of ${total} is ${part}.`,
      wrong: [[total - den, `Subtracting ${den} is not the same as sharing into ${den} groups.`], [den, 'That is the number of groups, not the size of one group.'], [total, 'That is the whole amount.']],
      teach: T.unit,
      fun: FUN.fraction,
      lines: [`1/${den} of ${total} = ?`],
    });
  }
  if (g === 5) {
    if (rng.chance(0.5)) {
      const den = rng.pick([2, 3, 4, 5]);
      const k = rng.int(2, 4);
      const num = rng.int(1, den - 1);
      const [, many] = DEN_NAME[den * k] ?? ['part', `parts out of ${den * k}`];
      return problem(ctx, {
        name: 'Equal Fractions',
        intro: say(lead(ctx), `A strip is cut into ${den} equal parts, then each part is cut into ${k} smaller parts.`),
        q: `${num}/${den} of the strip is the same as how many ${many}?`,
        a: num * k,
        h: ['Each old part became several smaller parts.', 'Multiply the top number by the same number as the bottom number.'],
        steps: [`${den} × ${k} = ${den * k}, so the bottom number was multiplied by ${k}.`, `Do the same to the top: ${num} × ${k} = ${num * k}.`, `${num}/${den} = ${num * k}/${den * k}.`],
        why: 'Multiplying the top and bottom by the same number names the same amount with smaller parts.',
        wrong: [[num, 'The parts are smaller now, so you need more of them.'], [num + k, 'Multiply instead of adding.'], [den * k, 'That would be the whole strip.']],
        teach: T.equiv,
        fun: FUN.fraction,
        lines: [`${num}/${den} = ?/${den * k}`],
      });
    }
    const den = rng.pick([5, 6, 8, 10]);
    const a = rng.int(1, den - 3);
    const b = rng.int(1, den - a - 1);
    const [, many] = DEN_NAME[den] as [string, string];
    return problem(ctx, {
      name: 'Fraction Sums',
      intro: say(lead(ctx), `A pizza is cut into ${den} equal slices. One friend eats ${a} and another eats ${b}.`),
      q: `${a}/${den} + ${b}/${den} makes how many ${many}?`,
      a: a + b,
      h: ['The slices are all the same size.', 'Add the top numbers. The bottom number stays the same.'],
      steps: [`Both fractions count ${many}.`, `${a} + ${b} = ${a + b}.`, `So the sum is ${a + b}/${den}.`],
      why: `When the parts are the same size you only add how many parts there are: ${a + b} ${many}.`,
      wrong: [[a + b + den * 2, 'Do not add the bottom numbers.'], [a * b, 'This is adding, not multiplying.'], [den, 'That would be the whole pizza.']],
      teach: T.like,
      fun: FUN.fraction,
      lines: [`${a}/${den} + ${b}/${den} = ?/${den}`],
    });
  }
  if (g === 6) {
    if (rng.chance(0.5)) {
      const den = rng.pick([3, 4, 5, 8]);
      const num = rng.int(2, den - 1);
      const part = rng.int(2, 9);
      const total = den * part;
      return problem(ctx, {
        name: 'Fraction Of',
        intro: say(lead(ctx), `${cap1(ctx.theme.crew)} has ${total} ${thing.many}.`),
        q: `What is ${num}/${den} of ${total}?`,
        a: num * part,
        h: [`First find one of the ${den} equal parts.`, 'Then take as many parts as the top number says.'],
        steps: [`${total} ÷ ${den} = ${part}, so one part is ${part}.`, `Take ${num} parts: ${num} × ${part} = ${num * part}.`],
        why: `Divide by the bottom number to find one part, then multiply by the top number: ${num * part}.`,
        wrong: [[part, 'That is only one part.'], [total - num, 'Find equal parts instead of subtracting.'], [total * num, 'Divide by the bottom number first.']],
        teach: T.unit,
        fun: FUN.fraction,
        lines: [`${num}/${den} of ${total} = ?`],
      });
    }
    const a = rng.int(11, 69) / 10;
    const b = rng.int(105, 495) / 100;
    const sum = tidy(a + b);
    return problem(ctx, {
      name: 'Decimal Sums',
      intro: say(lead(ctx), `Two ribbons are ${a} m and ${b} m long.`),
      q: `What is ${a} + ${b}?`,
      a: sum,
      unit: 'm',
      dec: true,
      h: ['Line up the decimal points first.', 'Add hundredths, then tenths, then ones.'],
      steps: [`Write ${a} as ${a.toFixed(2)} so both numbers have two decimal places.`, `${a.toFixed(2)} + ${b.toFixed(2)} = ${sum}.`],
      why: `Lining up the decimal points keeps tenths with tenths: ${a} + ${b} = ${sum}.`,
      wrong: [[tidy(Math.round(a * 10) / 100 + b), 'The decimal points were not lined up.'], [tidy(sum + 1), 'Check the ones.'], [tidy(sum - 0.1), 'Check the tenths.']],
      teach: T.decimal,
      lines: [`${a.toFixed(2)}`, `+ ${b.toFixed(2)}`],
    });
  }
  if (g === 7) {
    if (rng.chance(0.5)) {
      const pct = rng.pick([10, 20, 25, 50, 75]);
      const base = (pct === 25 || pct === 75 ? 4 : 10) * rng.int(2, 12);
      const ans = (base * pct) / 100;
      return problem(ctx, {
        name: 'Percent Power',
        intro: say(lead(ctx), `A battery holds ${base} units of energy when it is full.`),
        q: `What is ${pct}% of ${base}?`,
        a: ans,
        h: ['Percent means out of one hundred.', 'Turn the percent into a simple fraction of the whole.'],
        steps: [`${pct}% is ${pct}/100.`, `${base} × ${pct} ÷ 100 = ${ans}.`],
        why: `${pct}% means ${pct} out of every 100, and ${pct}/100 of ${base} is ${ans}.`,
        wrong: [[base - pct, 'Percent is a part of the number, not something to subtract.'], [pct, 'That is the percent, not the part.'], [base - ans, 'That is the part that is left over.']],
        teach: T.percent,
        fun: FUN.percent,
        lines: [`${pct}% of ${base} = ?`],
      });
    }
    const whole = rng.int(2, 9);
    const den = rng.pick([2, 3, 4, 5]);
    return problem(ctx, {
      name: 'Fraction Division',
      intro: say(lead(ctx), `${whole} pies are cut into pieces of 1/${den} of a pie each.`),
      q: `What is ${whole} ÷ 1/${den}?`,
      a: whole * den,
      h: ['Ask: how many of these pieces fit in one whole?', 'Then count the pieces in all the wholes.'],
      steps: [`One whole holds ${den} pieces of 1/${den}.`, `${whole} wholes hold ${whole} × ${den} = ${whole * den} pieces.`],
      why: `Dividing by 1/${den} asks how many pieces fit, which is the same as multiplying by ${den}.`,
      wrong: [[whole, 'Each pie is cut into more than one piece.'], [whole + den, 'Multiply the number of pies by the pieces in each pie.'], [den, 'That is the number of pieces in just one pie.']],
      teach: ['Why does dividing by a unit fraction give a bigger number?', 'Many small pieces fit into each whole.', 'Division always makes numbers bigger.', 'Fractions are bigger than whole numbers.'],
      fun: FUN.fraction,
      lines: [`${whole} ÷ 1/${den} = ?`],
    });
  }
  if (g === 8) {
    const pct = rng.pick([10, 20, 25, 30, 40, 50]);
    const price = (pct === 25 ? 20 : 10) * rng.int(2, 9);
    const off = (price * pct) / 100;
    return problem(ctx, {
      name: 'Sale Price',
      intro: say(lead(ctx), `A kit costs ${price} dollars. Today it is ${pct}% off.`),
      q: 'What is the sale price in dollars?',
      a: price - off,
      unit: 'dollars',
      h: ['First work out how much money comes off.', 'Then subtract that amount from the full price.'],
      steps: [`${pct}% of ${price} is ${off}.`, `${price} − ${off} = ${price - off}.`],
      why: `The discount is ${off} dollars, so the sale price is ${price - off} dollars.`,
      wrong: [[off, 'That is the discount, not the price you pay.'], [price - pct, 'Take off a percent of the price, not that many dollars.'], [price + off, 'A discount makes the price lower.']],
      teach: T.percent,
      fun: FUN.percent,
      lines: [`${price} dollars`, `${pct}% off`],
    });
  }
  const mantissa = rng.int(11, 99) / 10;
  const power = rng.int(2, 5);
  const value = Math.round(mantissa * 10 ** power);
  return problem(ctx, {
    name: 'Big Numbers',
    intro: say(lead(ctx), 'Scientists write very large numbers in scientific notation.'),
    q: `Write ${mantissa} × 10^${power} as an ordinary number.`,
    a: value,
    h: ['Each power of ten moves the digits one place to the left.', 'Count the places, and fill empty places with zeros.'],
    steps: [`10^${power} is 1 followed by ${power} zeros.`, `Move the digits of ${mantissa} ${power} places to the left.`, `${mantissa} × 10^${power} = ${fmt(value)}.`],
    why: `Multiplying by 10^${power} shifts every digit ${power} places, which gives ${fmt(value)}.`,
    wrong: [[value / 10, 'The digits moved one place too few.'], [value * 10, 'The digits moved one place too many.'], [Math.round(mantissa * 10 * power), 'A power of ten is not the same as multiplying by the exponent.']],
    teach: T.sci,
    fun: FUN.light,
    lines: [`${mantissa} × 10^${power} = ?`],
  });
};

function cap1(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Geometry (Pre-K to Grade 8)
// ---------------------------------------------------------------------------

const POLY: readonly { shape: ShapeName; name: string; sides: number }[] = [
  { shape: 'triangle', name: 'triangle', sides: 3 },
  { shape: 'square', name: 'square', sides: 4 },
  { shape: 'rect', name: 'rectangle', sides: 4 },
  { shape: 'pentagon', name: 'pentagon', sides: 5 },
  { shape: 'hexagon', name: 'hexagon', sides: 6 },
];

const geometry: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g <= 1) {
    const poly = rng.pick(g === 0 ? POLY.slice(0, 2) : POLY);
    const corners = g === 1 && rng.chance(0.5);
    return problem(ctx, {
      name: 'Shapes',
      intro: `Look at the ${poly.name}.`,
      q: `How many ${corners ? 'corners' : 'sides'} does it have?`,
      a: poly.sides,
      h: [corners ? 'Touch each pointy corner.' : 'Trace each straight side.', 'Count each one only once.'],
      steps: [corners ? 'Put a finger on one corner.' : 'Put a finger on one side.', `Go around and count: ${range(1, poly.sides).join(', ')}.`],
      why: `A ${poly.name} has ${poly.sides} sides and ${poly.sides} corners.`,
      wrong: [[poly.sides + 1, 'You counted one twice.'], [poly.sides - 1, 'You missed one.']],
      teach: T.sides,
      fun: FUN.honeycomb,
      scene: cardScene(ctx.theme.scene, [{ shape: poly.shape, color: '#3b82f6', scale: 1.5 }]),
    });
  }
  if (g <= 3) {
    const poly = rng.pick(POLY.filter((p) => p.shape !== 'rect'));
    const n = rng.int(2, g === 2 ? 3 : 5);
    const other = rng.pick(POLY.filter((p) => p.shape !== poly.shape && p.shape !== 'rect'));
    const shapes: ShapeName[] = rng.shuffle([...range(1, n).map(() => poly.shape), other.shape]);
    return problem(ctx, {
      name: 'Shape Sides',
      intro: say(lead(ctx), `The picture shows ${n} ${poly.name}s and one ${other.name}.`),
      q: `How many sides do the ${n} ${poly.name}s have altogether?`,
      a: n * poly.sides,
      h: [`First count the sides of one ${poly.name}.`, `Then add that number once for each ${poly.name}.`],
      steps: [`One ${poly.name} has ${poly.sides} sides.`, `${range(1, n).map(() => poly.sides).join(' + ')} = ${n * poly.sides}.`],
      why: `${n} ${poly.name}s with ${poly.sides} sides each have ${n * poly.sides} sides.`,
      wrong: [[n * poly.sides + other.sides, `The ${other.name} does not count.`], [poly.sides, 'That is only one shape.'], [n, 'That is the number of shapes, not sides.']],
      teach: T.sides,
      fun: FUN.honeycomb,
      scene: shapeScene(ctx, shapes),
    });
  }
  if (g === 4) {
    const w = rng.int(3, 9);
    const h = rng.int(2, w - 1);
    if (rng.chance(0.5)) {
      return problem(ctx, {
        name: 'Fence Builder',
        intro: say(lead(ctx), `A rectangular garden is ${w} m long and ${h} m wide.`),
        q: 'How many meters of fence go all the way around it?',
        a: 2 * (w + h),
        unit: 'm',
        h: ['A rectangle has two long sides and two short sides.', 'Add all four sides.'],
        steps: [`The sides are ${w}, ${h}, ${w} and ${h}.`, `${w} + ${h} + ${w} + ${h} = ${2 * (w + h)}.`],
        why: `Perimeter is the distance around: two sides of ${w} and two sides of ${h} make ${2 * (w + h)} m.`,
        wrong: [[w + h, 'That is only two of the four sides.'], [w * h, 'That is the area inside, not the distance around.'], [2 * w + h, 'One short side is missing.']],
        teach: T.perimeter,
        fun: FUN.geometry,
        lines: [`${w} m long`, `${h} m wide`],
      });
    }
    return problem(ctx, {
      name: 'Tile Floor',
      intro: say(lead(ctx), `A floor has ${h} rows of square tiles with ${w} tiles in each row.`),
      q: 'How many square tiles cover the floor?',
      a: w * h,
      unit: 'tiles',
      h: ['Each row has the same number of tiles.', 'Multiply the rows by the tiles in one row.'],
      steps: [`There are ${h} rows of ${w}.`, `${h} × ${w} = ${w * h}.`],
      why: `Area counts the unit squares: ${h} rows of ${w} make ${w * h} squares.`,
      wrong: [[2 * (w + h), 'That is the distance around, not the squares inside.'], [w + h, 'Multiply rows by columns.'], [w * h + w, 'That is one row too many.']],
      teach: T.area,
      fun: FUN.geometry,
      lines: [`${h} rows`, `${w} tiles in each row`],
    });
  }
  if (g === 5) {
    if (rng.chance(0.5)) {
      const part = rng.int(2, 16) * 5;
      const whole = rng.pick([90, 180]);
      if (part >= whole) return null;
      return problem(ctx, {
        name: 'Angle Finder',
        intro: say(lead(ctx), `A ${whole === 90 ? 'right angle' : 'straight line'} is split into two angles. One of them is ${part}°.`),
        q: 'How many degrees is the other angle?',
        a: whole - part,
        unit: '°',
        h: [`A ${whole === 90 ? 'right angle is a square corner' : 'straight line is a half turn'}. Remember how many degrees that is.`, 'Subtract the angle you know from the whole.'],
        steps: [`A ${whole === 90 ? 'right angle' : 'straight line'} measures ${whole}°.`, `${whole} − ${part} = ${whole - part}.`],
        why: `The two angles together make ${whole}°, so the other angle is ${whole - part}°.`,
        wrong: [[(whole === 90 ? 180 : 90) - part, whole === 90 ? 'A right angle is 90°, not 180°.' : 'A straight line is 180°, not 90°.'], [whole + part, 'Subtract to find the missing part.'], [part, 'The two parts are not equal here.']],
        teach: ['How many degrees are in a right angle?', '90 degrees.', '100 degrees.', '45 degrees.'],
        fun: FUN.geometry,
        lines: [`${part}° + ? = ${whole}°`],
      });
    }
    const w = rng.int(6, 15);
    const h = rng.int(3, 9);
    return problem(ctx, {
      name: 'Area Plan',
      intro: say(lead(ctx), `A rectangular play area is ${w} m long and ${h} m wide.`),
      q: 'What is its area in square meters?',
      a: w * h,
      unit: 'square meters',
      h: ['Area of a rectangle is length times width.', 'Picture rows of one-meter squares.'],
      steps: ['Area = length × width.', `${w} × ${h} = ${w * h}.`],
      why: `${h} rows of ${w} one-meter squares cover ${w * h} square meters.`,
      wrong: [[2 * (w + h), 'That is the perimeter.'], [w + h, 'Multiply the sides.'], [w * h * 2, 'There is no need to double it.']],
      teach: T.area,
      fun: FUN.geometry,
      lines: [`${w} m × ${h} m`],
    });
  }
  if (g === 6) {
    if (rng.chance(0.5)) {
      const [l, w, h] = [rng.int(2, 6), rng.int(2, 5), rng.int(2, 4)];
      return problem(ctx, {
        name: 'Box Volume',
        intro: say(lead(ctx), `A box is ${l} cm long, ${w} cm wide and ${h} cm tall.`),
        q: 'How many one-centimeter cubes fill the box?',
        a: l * w * h,
        unit: 'cubes',
        h: ['First find how many cubes cover the bottom layer.', 'Then multiply by the number of layers.'],
        steps: [`Bottom layer: ${l} × ${w} = ${l * w} cubes.`, `There are ${h} layers.`, `${l * w} × ${h} = ${l * w * h}.`],
        why: `Volume = length × width × height = ${l * w * h} cubic centimeters.`,
        wrong: [[l + w + h, 'Multiply the three measurements.'], [l * w, 'That is only the bottom layer.'], [2 * (l * w + l * h + w * h), 'That is the surface, not the space inside.']],
        teach: T.volume,
        fun: FUN.geometry,
        lines: [`${l} cm × ${w} cm × ${h} cm`],
      });
    }
    const [x, y, dx, dy] = [rng.int(1, 6), rng.int(1, 6), rng.int(1, 4), rng.int(1, 4)];
    const askX = rng.chance(0.5);
    return problem(ctx, {
      name: 'Grid Trip',
      intro: say(lead(ctx), `A marker sits at the point (${x}, ${y}) on a grid. It moves ${dx} to the right and ${dy} up.`),
      q: `What is its new ${askX ? 'x' : 'y'}-coordinate?`,
      a: askX ? x + dx : y + dy,
      h: ['The first number of a point tells how far right. The second tells how far up.', askX ? 'Moving right changes only the first number.' : 'Moving up changes only the second number.'],
      steps: [`Right ${dx}: x goes from ${x} to ${x + dx}.`, `Up ${dy}: y goes from ${y} to ${y + dy}.`, `The new point is (${x + dx}, ${y + dy}).`],
      why: `Moving right adds to x and moving up adds to y, so the point lands on (${x + dx}, ${y + dy}).`,
      wrong: [[askX ? y + dy : x + dx, 'That is the other coordinate.'], [askX ? x : y, 'That is where it started.'], [askX ? x + dy : y + dx, 'Check which move changes this coordinate.']],
      teach: ['In the point (3, 5), what does the 3 tell you?', 'How far to go right.', 'How far to go up.', 'How many points there are.'],
      lines: [`(${x}, ${y})`, `right ${dx}, up ${dy}`],
    });
  }
  if (g === 7) {
    if (rng.chance(0.5)) {
      const a = rng.int(5, 16) * 5;
      const b = rng.int(4, 14) * 5;
      if (a + b >= 175) return null;
      return problem(ctx, {
        name: 'Triangle Angles',
        intro: say(lead(ctx), `Two angles of a triangle measure ${a}° and ${b}°.`),
        q: 'How many degrees is the third angle?',
        a: 180 - a - b,
        unit: '°',
        h: ['The three angles of any triangle always add up to the same total.', 'Add the two angles you know, then subtract from that total.'],
        steps: [`${a} + ${b} = ${a + b}.`, 'The angles of a triangle add up to 180°.', `180 − ${a + b} = ${180 - a - b}.`],
        why: `The angles of a triangle total 180°, so the third angle is ${180 - a - b}°.`,
        wrong: [[360 - a - b, 'A triangle totals 180°, not 360°.'], [a + b, 'That is the sum of the two known angles.'], [Math.abs(90 - a - b) || 5, 'A triangle totals 180°, not 90°.']],
        teach: T.angle,
        fun: FUN.geometry,
        scene: cardScene(ctx.theme.scene, [{ shape: 'triangle', color: '#22c55e', scale: 1.3 }, { text: `${a}° + ${b}° + ?` }]),
      });
    }
    const base = rng.int(2, 8) * 2;
    const height = rng.int(3, 9);
    return problem(ctx, {
      name: 'Triangle Area',
      intro: say(lead(ctx), `A triangular sail has a base of ${base} m and a height of ${height} m.`),
      q: 'What is its area in square meters?',
      a: (base * height) / 2,
      unit: 'square meters',
      h: ['A triangle is half of a rectangle with the same base and height.', 'Multiply base by height, then halve it.'],
      steps: [`Base × height = ${base} × ${height} = ${base * height}.`, `Half of ${base * height} is ${(base * height) / 2}.`],
      why: `Area of a triangle = base × height ÷ 2 = ${(base * height) / 2} square meters.`,
      wrong: [[base * height, 'That is the whole rectangle. A triangle is half of it.'], [base + height, 'Multiply, then halve.'], [(base * height) / 2 + base, 'Check the halving step.']],
      teach: ['Why do you divide by 2 for the area of a triangle?', 'A triangle is half of a rectangle with the same base and height.', 'Triangles have 2 sides.', 'Area is always halved.'],
      fun: FUN.geometry,
      scene: cardScene(ctx.theme.scene, [{ shape: 'triangle', color: '#f97316', scale: 1.3 }, { text: `base ${base}, height ${height}` }]),
    });
  }
  if (g === 8) {
    const d = rng.pick([2, 3, 4, 5, 6, 8, 10, 20]);
    if (rng.chance(0.5)) {
      const c = tidy(d * 3.14);
      return problem(ctx, {
        name: 'Round Trip',
        intro: say(lead(ctx), `A round table is ${d} m across. Use 3.14 for pi.`),
        q: 'About how many meters is it around the edge?',
        a: c,
        unit: 'm',
        dec: true,
        h: ['The distance around a circle is called the circumference.', 'Multiply the distance across by pi.'],
        steps: ['Circumference = pi × diameter.', `3.14 × ${d} = ${c}.`],
        why: `The circumference is pi times the diameter: 3.14 × ${d} = ${c} m.`,
        wrong: [[tidy(3.14 * (d / 2) * (d / 2)), 'That is the area formula.'], [tidy(d * 2), 'Use pi, not 2.'], [tidy(3.14 * d * 2), 'The distance across is already the diameter.']],
        teach: ['What is pi?', 'The circumference of any circle divided by its diameter.', 'The area of a circle.', 'The radius of a circle.'],
        fun: FUN.pi,
        scene: cardScene(ctx.theme.scene, [{ shape: 'circle', color: '#a855f7', scale: 1.3 }, { text: `${d} m across` }]),
      });
    }
    const a = rng.int(4, 34) * 5;
    return problem(ctx, {
      name: 'Angle Pairs',
      intro: say(lead(ctx), `Two angles sit side by side on a straight line. One measures ${a}°.`),
      q: 'How many degrees is the other angle?',
      a: 180 - a,
      unit: '°',
      h: ['Angles on a straight line are called supplementary.', 'Together they make a half turn.'],
      steps: ['A straight line is 180°.', `180 − ${a} = ${180 - a}.`],
      why: `Supplementary angles add up to 180°, so the other angle is ${180 - a}°.`,
      wrong: [[Math.abs(90 - a) || 10, 'Angles on a straight line total 180°, not 90°.'], [360 - a, 'A straight line is half a full turn.'], [a, 'They are only equal when both are right angles.']],
      teach: ['What do supplementary angles add up to?', '180 degrees.', '90 degrees.', '360 degrees.'],
      fun: FUN.geometry,
      lines: [`${a}° + ? = 180°`],
    });
  }
  const [a, b, c] = rng.pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20]] as const);
  return problem(ctx, {
    name: 'Right Triangle',
    intro: say(lead(ctx), `A ramp forms a right triangle. Its two shorter sides are ${a} m and ${b} m.`),
    q: 'How long is the longest side, in meters?',
    a: c,
    unit: 'm',
    h: ['Use the Pythagorean rule for right triangles.', 'Square both short sides, add them, then take the square root.'],
    steps: [`${a}² = ${a * a} and ${b}² = ${b * b}.`, `${a * a} + ${b * b} = ${c * c}.`, `The square root of ${c * c} is ${c}.`],
    why: `In a right triangle a² + b² = c², and ${a * a} + ${b * b} = ${c * c} = ${c}².`,
    wrong: [[a + b, 'Add the squares, not the sides.'], [c * c, 'Take the square root at the end.'], [b + 1 === c ? b + 2 : b + 1, 'Work through the squares step by step.']],
    teach: T.pyth,
    fun: FUN.rope,
    scene: cardScene(ctx.theme.scene, [{ shape: 'triangle', color: '#ef4444', scale: 1.3 }, { text: `sides ${a} and ${b}` }]),
  });
};

// ---------------------------------------------------------------------------
// Measurement and data (Pre-K to Grade 8)
// ---------------------------------------------------------------------------

const LONGER: readonly [string, string, string, string][] = [
  ['bus', '🚌', 'bike', '🚲'],
  ['train', '🚂', 'car', '🚗'],
  ['giraffe', '🦒', 'mouse', '🐭'],
  ['whale', '🐋', 'fish', '🐟'],
  ['tree', '🌳', 'flower', '🌷'],
];

const measurement: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  const thing = thingOf(ctx);
  if (g <= 1) {
    if (rng.chance(0.4)) {
      const [big, bigE, small, smallE] = rng.pick(LONGER);
      const tall = big === 'giraffe' || big === 'tree';
      return problem(ctx, {
        name: 'Big and Small',
        intro: `Look at the ${big} and the ${small}.`,
        q: `Which one is ${tall ? 'taller' : 'longer'}?`,
        a: 1,
        choiceOnly: true,
        options: { right: { label: big, emoji: bigE }, wrong: [{ label: small, emoji: smallE, why: `The ${small} is ${tall ? 'shorter' : 'smaller'}.` }] },
        h: ['Picture them side by side.', `Which one needs more room?`],
        steps: [`Think of a real ${big}.`, `A ${big} is ${tall ? 'taller' : 'longer'} than a ${small}.`],
        why: `A ${big} is much ${tall ? 'taller' : 'longer'} than a ${small}.`,
        wrong: [],
        teach: ['How do you compare two lengths?', 'Line up one end of each.', 'Look at the colors.', 'Count the letters.'],
        scene: cardScene(ctx.theme.scene, [{ emoji: bigE, scale: 1.3, label: big }, { emoji: smallE, scale: 0.7, label: small }]),
      });
    }
    const n = g === 0 ? rng.int(2, 5) : rng.int(4, 9);
    const cards: Card[] = range(1, n).map((i) => ({ id: `block${i}`, shape: 'square' as const, color: i % 2 === 0 ? '#3b82f6' : '#f97316' }));
    return problem(ctx, {
      name: 'Measure It',
      intro: `The ${thing.one} is as long as the row of blocks.`,
      q: `How many blocks long is the ${thing.one}?`,
      a: n,
      unit: 'blocks',
      h: ['Touch each block as you count.', 'Count from one end to the other.'],
      steps: ['Start at the first block.', `Count: ${range(1, n).join(', ')}.`],
      why: 'The number of blocks tells how long it is.',
      wrong: [[n + 1, 'You counted one block twice.'], [n - 1, 'You missed a block.']],
      teach: T.measure,
      fun: FUN.meter,
      scene: cardScene(ctx.theme.scene, cards),
    });
  }
  if (g === 2) {
    if (rng.chance(0.5)) {
      const hour = rng.int(1, 11);
      return problem(ctx, {
        name: 'Clock Time',
        intro: say(lead(ctx), 'On the clock, the long hand points straight up to 12.'),
        q: `The short hand points to ${numberName(hour)}. What hour is it?`,
        a: hour,
        unit: "o'clock",
        h: ['The short hand shows the hour.', 'When the long hand points straight up, it is exactly on the hour.'],
        steps: ['The long hand at the top means zero minutes past.', 'Read the number the short hand points to.'],
        why: `The short hand tells the hour, so it is ${numberName(hour)} o'clock.`,
        wrong: [[12, 'That is where the long hand points. The short hand shows the hour.'], [hour + 1, 'Read the short hand exactly.'], [hour === 1 ? 3 : hour - 1, 'Read the short hand exactly.']],
        teach: ['Which hand shows the hour?', 'The short hand.', 'The long hand.', 'Both hands together.'],
        fun: FUN.clock,
        scene: cardScene(ctx.theme.scene, [{ emoji: '🕰️', scale: 1.3 }, { text: `short hand: ${numberName(hour)}` }]),
      });
    }
    const long = rng.int(6, 12);
    const short = rng.int(2, long - 2);
    return problem(ctx, {
      name: 'How Much Longer',
      intro: say(lead(ctx), `A rope is ${long} blocks long. A ribbon is ${short} blocks long.`),
      q: 'How many blocks longer is the rope?',
      a: long - short,
      unit: 'blocks',
      h: ['Compare the two lengths.', 'Subtract the shorter length from the longer one.'],
      steps: [`The rope is ${long} and the ribbon is ${short}.`, `${long} − ${short} = ${long - short}.`],
      why: `The difference between ${long} and ${short} is ${long - short} blocks.`,
      wrong: [[long + short, 'How much longer asks for the difference, not the total.'], [long, 'That is the whole rope.'], [short, 'That is the ribbon.']],
      teach: ['What does "how much longer" ask for?', 'The difference between two lengths.', 'Both lengths added.', 'The longer length.'],
      fun: FUN.meter,
      lines: [`rope: ${long}`, `ribbon: ${short}`],
    });
  }
  if (g === 3) {
    const dimes = rng.int(1, 6);
    const nickels = rng.int(0, 3);
    const pennies = rng.int(1, 4);
    const total = dimes * 10 + nickels * 5 + pennies;
    const parts = [`${dimes} dime${dimes === 1 ? '' : 's'}`, ...(nickels > 0 ? [`${nickels} nickel${nickels === 1 ? '' : 's'}`] : []), `${pennies} penn${pennies === 1 ? 'y' : 'ies'}`];
    return problem(ctx, {
      name: 'Coin Count',
      intro: say(lead(ctx), `A piggy bank holds ${parts.join(nickels > 0 ? ', ' : ' and ')}. A dime is 10 cents, a nickel is 5 cents and a penny is 1 cent.`),
      q: 'How many cents is that altogether?',
      a: total,
      unit: 'cents',
      h: ['Start with the coins that are worth the most.', 'Count the dimes by tens, then count on for the other coins.'],
      steps: [`Dimes: ${dimes} × 10 = ${dimes * 10}.`, ...(nickels > 0 ? [`Nickels: ${nickels} × 5 = ${nickels * 5}.`] : []), `Pennies: ${pennies}.`, `Altogether: ${total} cents.`],
      why: `Counting by tens${nickels > 0 ? ', fives' : ''} and ones gives ${total} cents.`,
      wrong: [[dimes + nickels + pennies, 'That is the number of coins, not their value.'], [total + 10, 'Count the dimes again.'], [dimes * 10 + nickels + pennies, 'A nickel is worth 5 cents.']],
      teach: ['Why is a dime worth more than a penny even though it is smaller?', 'Value does not depend on size.', 'Smaller coins are always worth more.', 'A dime is heavier.'],
      scene: cardScene(ctx.theme.scene, [{ emoji: '💰', label: `${dimes} dimes` }, ...(nickels > 0 ? [{ emoji: '💰', label: `${nickels} nickels` }] : []), { emoji: '💰', label: `${pennies} pennies` }, { emoji: '🐷' }]),
    });
  }
  if (g === 4) {
    const hour = rng.int(1, 11);
    const start = rng.pick([0, 5, 10, 15, 20]);
    const length = rng.pick([15, 20, 25, 30, 35]);
    const two = (n: number): string => String(n).padStart(2, '0');
    return problem(ctx, {
      name: 'Time Tracker',
      intro: say(lead(ctx), `Practice starts at ${hour}:${two(start)} and ends at ${hour}:${two(start + length)}.`),
      q: 'How many minutes does practice last?',
      a: length,
      unit: 'minutes',
      h: ['The hour stays the same, so look only at the minutes.', 'Subtract the starting minutes from the ending minutes.'],
      steps: [`It starts at ${start} minutes past and ends at ${start + length} minutes past.`, `${start + length} − ${start} = ${length}.`],
      why: `From ${hour}:${two(start)} to ${hour}:${two(start + length)} is ${length} minutes.`,
      wrong: [[start + length, 'That is the ending time in minutes, not how long it lasted.'], [length + 10, 'Count the minutes again.'], [60 - length, 'Find the difference between the two times.']],
      teach: T.time,
      fun: FUN.clock,
      lines: [`start ${hour}:${two(start)}`, `end ${hour}:${two(start + length)}`],
    });
  }
  if (g === 5 || g === 6) {
    const conv = rng.pick([
      { big: 'meters', small: 'centimeters', factor: 100, emoji: '📏' },
      { big: 'kilograms', small: 'grams', factor: 1000, emoji: '⚖️' },
      { big: 'hours', small: 'minutes', factor: 60, emoji: '⏰' },
      { big: 'liters', small: 'milliliters', factor: 1000, emoji: '🥛' },
      { big: 'kilometers', small: 'meters', factor: 1000, emoji: '🛣️' },
    ] as const);
    const n = g === 5 || conv.factor === 60 ? rng.int(2, 9) : rng.int(12, 95) / 10;
    const ans = tidy(n * conv.factor);
    return problem(ctx, {
      name: 'Unit Switch',
      intro: say(lead(ctx), `There are ${fmt(conv.factor)} ${conv.small} in one ${conv.big.slice(0, -1)}.`),
      q: `How many ${conv.small} are in ${n} ${conv.big}?`,
      a: ans,
      unit: conv.small,
      h: ['The new unit is smaller, so you need more of them.', 'Multiply by the number of small units in one big unit.'],
      steps: [`1 ${conv.big.slice(0, -1)} = ${fmt(conv.factor)} ${conv.small}.`, `${n} × ${fmt(conv.factor)} = ${fmt(ans)}.`],
      why: `Each ${conv.big.slice(0, -1)} holds ${fmt(conv.factor)} ${conv.small}, so ${n} of them hold ${fmt(ans)}.`,
      wrong: [[tidy(n * conv.factor * 10), 'One zero too many.'], [tidy(n + conv.factor), 'Multiply instead of adding.'], [tidy((n * conv.factor) / 10), 'Check how many small units are in one big unit.']],
      teach: T.convert,
      fun: FUN.meter,
      scene: cardScene(ctx.theme.scene, [{ emoji: conv.emoji, scale: 1.2 }, { text: `${n} ${conv.big} = ?` }]),
    });
  }
  if (g === 7) {
    const count = rng.pick([4, 5]);
    const mean = rng.int(6, 20);
    const deltas = count === 4 ? rng.pick([[-3, -1, 1, 3], [-2, -2, 1, 3], [-4, 0, 1, 3]] as const) : rng.pick([[-4, -2, 0, 2, 4], [-3, -1, 0, 1, 3], [-5, -1, 1, 2, 3]] as const);
    const values = rng.shuffle(deltas.map((d) => mean + d));
    const total = mean * count;
    const sorted = [...values].sort((x, y) => x - y);
    const hi = sorted[sorted.length - 1] as number;
    const lo = sorted[0] as number;
    if (rng.chance(0.3)) {
      return problem(ctx, {
        name: 'Data Range',
        intro: say(lead(ctx), `The scores in a game were ${values.join(', ')}.`),
        q: 'What is the range of the scores?',
        a: hi - lo,
        h: ['The range shows how spread out the data are.', 'Subtract the smallest value from the largest value.'],
        steps: [`The largest score is ${hi}.`, `The smallest score is ${lo}.`, `${hi} − ${lo} = ${hi - lo}.`],
        why: `Range = largest − smallest = ${hi - lo}.`,
        wrong: [[mean, 'That is the mean, not the range.'], [hi, 'That is the largest value.'], [hi + lo, 'Subtract the smallest from the largest.']],
        teach: ['What does the range tell you?', 'How far apart the smallest and largest values are.', 'The middle value.', 'The most common value.'],
        fun: FUN.mean,
        lines: [values.join(', ')],
      });
    }
    return problem(ctx, {
      name: 'Mean Machine',
      intro: say(lead(ctx), `The scores in a game were ${values.join(', ')}.`),
      q: 'What is the mean score?',
      a: mean,
      h: ['The mean is the fair share if the total were split equally.', 'Add all the scores, then divide by how many scores there are.'],
      steps: [`${values.join(' + ')} = ${total}.`, `There are ${count} scores.`, `${total} ÷ ${count} = ${mean}.`],
      why: `The scores add up to ${total}, and ${total} ÷ ${count} = ${mean}.`,
      wrong: [[total, 'That is the total. Divide it by the number of scores.'], [hi, 'That is the largest score.'], [hi - lo, 'That is the range.']],
      teach: T.mean,
      fun: FUN.mean,
      lines: [values.join(', ')],
    });
  }
  if (g === 8) {
    const parts = rng.pick([4, 5, 8, 10]);
    const wins = rng.int(1, Math.min(3, parts - 2));
    const spins = parts * rng.int(4, 12);
    const ans = (spins * wins) / parts;
    return problem(ctx, {
      name: 'Spinner Science',
      intro: say(lead(ctx), `A spinner has ${parts} equal parts, and ${wins} of them ${wins === 1 ? 'is' : 'are'} gold.`),
      q: `In ${spins} spins, about how many times do you expect gold?`,
      a: ans,
      unit: 'times',
      h: ['First write the chance of gold as a fraction.', 'Multiply that fraction by the number of spins.'],
      steps: [`The chance of gold is ${wins}/${parts}.`, `${spins} ÷ ${parts} = ${spins / parts}.`, `${spins / parts} × ${wins} = ${ans}.`],
      why: `Gold should come up about ${wins}/${parts} of the time, and ${wins}/${parts} of ${spins} is ${ans}.`,
      wrong: [[spins / parts === ans ? ans + parts : spins / parts, 'Use all the gold parts.'], [wins, 'That is the number of gold parts, not the expected spins.'], [spins - ans, 'That is how often you expect the other colors.']],
      teach: T.chance,
      lines: [`${wins} of ${parts} parts are gold`, `${spins} spins`],
    });
  }
  const m = rng.int(2, 6);
  const b = rng.int(3, 20);
  const x = rng.int(5, 15);
  return problem(ctx, {
    name: 'Trend Line',
    intro: say(lead(ctx), `A line of best fit for plant height is y = ${m}x + ${b}, where x is the number of weeks and y is the height in cm.`),
    q: `What height does the line predict for week ${x}?`,
    a: m * x + b,
    unit: 'cm',
    h: ['Put the week number in place of x.', 'Multiply first, then add.'],
    steps: [`y = ${m} × ${x} + ${b}.`, `${m} × ${x} = ${m * x}.`, `${m * x} + ${b} = ${m * x + b}.`],
    why: `Replacing x with ${x} gives y = ${m * x} + ${b} = ${m * x + b} cm.`,
    wrong: [[m * (x + b), 'Multiply before you add.'], [m * x, 'Do not forget to add the starting height.'], [m + x + b, 'The number next to x multiplies it.']],
    teach: ['What is a line of best fit used for?', 'To describe a trend and make predictions.', 'To connect every single point.', 'To make a graph colorful.'],
    lines: [`y = ${m}x + ${b}`, `x = ${x}`],
  });
};

const NUMBER_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'] as const;
function numberName(n: number): string {
  return NUMBER_NAMES[n] ?? String(n);
}

// ---------------------------------------------------------------------------
// Algebra and ratios (Grade 3 to Grade 8)
// ---------------------------------------------------------------------------

const algebra: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  const thing = thingOf(ctx);
  if (g <= 4) {
    if (rng.chance(0.5)) {
      const a = rng.int(2, 9);
      const b = rng.int(2, 9);
      return problem(ctx, {
        name: 'Mystery Number',
        intro: say(lead(ctx), `A mystery number of boxes each hold ${a} ${thing.many}. There are ${a * b} ${thing.many} in all.`),
        q: `__ × ${a} = ${a * b}. What is the mystery number?`,
        a: b,
        h: ['Think about which fact family this belongs to.', 'Division undoes multiplication.'],
        steps: [`The product is ${a * b} and one factor is ${a}.`, `${a * b} ÷ ${a} = ${b}.`, `Check: ${b} × ${a} = ${a * b}.`],
        why: `${b} × ${a} = ${a * b}, so the mystery number is ${b}.`,
        wrong: [[a * b - a, 'Subtracting does not undo multiplying.'], [a * b, 'That is the product.'], [b + 1, 'Check with multiplication.']],
        teach: T.missing,
        fun: FUN.equals,
        lines: [`? × ${a} = ${a * b}`],
      });
    }
    const start = rng.int(1, 9);
    const step = rng.int(2, 6);
    const seq = range(0, 3).map((i) => start + i * step);
    return problem(ctx, {
      name: 'Rule Finder',
      intro: say(lead(ctx), `A pattern follows the rule "add ${step}". It begins ${seq.join(', ')}.`),
      q: 'What is the sixth number in the pattern?',
      a: start + 5 * step,
      h: ['Keep using the rule until you reach the sixth number.', 'Write down every number so you do not lose count.'],
      steps: [`Fifth number: ${seq[3]} + ${step} = ${start + 4 * step}.`, `Sixth number: ${start + 4 * step} + ${step} = ${start + 5 * step}.`],
      why: `Adding ${step} each time, the pattern continues ${start + 4 * step}, ${start + 5 * step}.`,
      wrong: [[start + 4 * step, 'That is the fifth number.'], [start + 6 * step, 'That is the seventh number.'], [6 * step, 'The pattern does not start at zero.']],
      teach: ['What is a pattern rule?', 'What you do each time to get the next number.', 'The first number.', 'The biggest number.'],
      lines: [`${seq.join(', ')}, ...`],
    });
  }
  if (g === 5) {
    const [a, b, c] = [rng.int(2, 9), rng.int(2, 9), rng.int(2, 6)];
    return problem(ctx, {
      name: 'Parentheses First',
      intro: say(lead(ctx), `${a} ${thing.many} and ${b} more are packed into each crate, and there are ${c} crates.`),
      q: `What is (${a} + ${b}) × ${c}? The parentheses are around ${a} + ${b}.`,
      a: (a + b) * c,
      h: ['Parentheses tell you what to do first.', 'Work out the sum inside, then multiply.'],
      steps: [`Inside the parentheses: ${a} + ${b} = ${a + b}.`, `${a + b} × ${c} = ${(a + b) * c}.`],
      why: `Parentheses come first: ${a + b} × ${c} = ${(a + b) * c}.`,
      wrong: [[a + b * c, 'The parentheses mean you add first.'], [a + b + c, 'The last step is multiplying.'], [a * c + b, 'Both numbers inside are multiplied.']],
      teach: ['What do parentheses tell you?', 'Do the part inside first.', 'Skip the part inside.', 'Do the part inside last.'],
      fun: FUN.equals,
      lines: [`(${a} + ${b}) × ${c} = ?`],
    });
  }
  if (g === 6) {
    if (rng.chance(0.5)) {
      const [a, b, c] = [rng.int(2, 12), rng.int(2, 9), rng.int(2, 9)];
      return problem(ctx, {
        name: 'Order of Operations',
        intro: say(lead(ctx), 'A code lock opens with the value of an expression.'),
        q: `What is ${a} + ${b} × ${c}?`,
        a: a + b * c,
        h: ['There are no parentheses, so check which operation comes first.', 'Multiply before you add.'],
        steps: [`First multiply: ${b} × ${c} = ${b * c}.`, `Then add: ${a} + ${b * c} = ${a + b * c}.`],
        why: `Multiplication comes before addition, so the value is ${a} + ${b * c} = ${a + b * c}.`,
        wrong: [[(a + b) * c, 'That adds first. Multiplication comes before addition.'], [a + b + c, 'One step is a multiplication.'], [a * b + c, 'Check which numbers are multiplied.']],
        teach: T.order,
        fun: FUN.equals,
        lines: [`${a} + ${b} × ${c} = ?`],
      });
    }
    const [k, n, c] = [rng.int(2, 9), rng.int(2, 9), rng.int(1, 12)];
    return problem(ctx, {
      name: 'Plug It In',
      intro: say(lead(ctx), `A machine uses the rule ${k} × n + ${c}.`),
      q: `What comes out when n = ${n}?`,
      a: k * n + c,
      h: ['Replace the letter with its number.', 'Multiply first, then add.'],
      steps: [`${k} × ${n} + ${c}.`, `${k} × ${n} = ${k * n}.`, `${k * n} + ${c} = ${k * n + c}.`],
      why: `With n = ${n}, the rule gives ${k * n} + ${c} = ${k * n + c}.`,
      wrong: [[k * (n + c), 'Multiply before adding.'], [k + n + c, 'The letter is multiplied.'], [k * n, 'Do not forget to add.']],
      teach: ['What is a variable?', 'A letter that stands for a number.', 'A number that never changes.', 'A kind of plus sign.'],
      fun: FUN.algebra,
      lines: [`${k} × n + ${c}`, `n = ${n}`],
    });
  }
  if (g === 7) {
    const pick = rng.int(0, 2);
    if (pick === 0) {
      const [a, b] = rng.pick([[2, 3], [1, 4], [3, 5], [2, 5], [3, 4]] as const);
      const k = rng.int(2, 8);
      return problem(ctx, {
        name: 'Ratio Recipe',
        intro: say(lead(ctx), `Paint is mixed with ${a} cups of blue for every ${b} cups of yellow.`),
        q: `How many cups of yellow go with ${a * k} cups of blue?`,
        a: b * k,
        unit: 'cups',
        h: ['Find how many times bigger the batch is.', 'Multiply both parts of the ratio by the same number.'],
        steps: [`${a * k} ÷ ${a} = ${k}, so the batch is ${k} times as big.`, `${b} × ${k} = ${b * k}.`],
        why: `Both parts are multiplied by ${k}, so ${a * k} cups of blue need ${b * k} cups of yellow.`,
        wrong: [[a * k + (b - a), 'Ratios scale by multiplying, not by adding.'], [b, 'The batch is bigger now.'], [a * k, 'Blue and yellow are not equal amounts.']],
        teach: T.ratio,
        lines: [`${a} : ${b}`, `${a * k} : ?`],
      });
    }
    if (pick === 1) {
      const x = rng.int(3, 25);
      const a = rng.int(4, 30);
      return problem(ctx, {
        name: 'Balance It',
        intro: say(lead(ctx), 'A balance scale is level when both sides are equal.'),
        q: `Solve x + ${a} = ${x + a}. What is x?`,
        a: x,
        h: ['Undo the addition.', 'Take the same amount away from both sides.'],
        steps: [`Subtract ${a} from both sides.`, `x = ${x + a} − ${a}.`, `x = ${x}.`],
        why: `Taking ${a} from both sides keeps the balance and leaves x = ${x}.`,
        wrong: [[x + 2 * a, 'Subtract on both sides instead of adding.'], [x + a, 'That is the total, not x.'], [a, 'That is the number that was added.']],
        teach: T.equation,
        fun: FUN.algebra,
        lines: [`x + ${a} = ${x + a}`],
      });
    }
    const speed = rng.int(4, 15) * 5;
    const hours = rng.int(2, 6);
    return problem(ctx, {
      name: 'Unit Rate',
      intro: say(lead(ctx), `A train travels ${speed * hours} km in ${hours} hours at a steady speed.`),
      q: 'How many kilometers does it travel in one hour?',
      a: speed,
      unit: 'km',
      h: ['A unit rate tells how much for one.', 'Share the distance equally between the hours.'],
      steps: [`${speed * hours} ÷ ${hours} = ${speed}.`, `The train travels ${speed} km each hour.`],
      why: `Dividing the distance by the time gives the unit rate: ${speed} km per hour.`,
      wrong: [[speed * hours, 'That is the whole trip.'], [speed * hours - hours, 'Divide instead of subtracting.'], [speed + 5, 'Check the division.']],
      teach: ['What is a unit rate?', 'The amount for one unit, such as one hour.', 'The total amount.', 'The biggest number in the problem.'],
      lines: [`${speed * hours} km in ${hours} h`],
    });
  }
  if (g === 8) {
    if (rng.chance(0.5)) {
      const [a, x, b] = [rng.int(2, 9), rng.int(2, 12), rng.int(1, 15)];
      return problem(ctx, {
        name: 'Two Steps',
        intro: say(lead(ctx), 'A lock opens when you find the value of x.'),
        q: `Solve ${a}x + ${b} = ${a * x + b}. What is x?`,
        a: x,
        h: ['Undo the addition first.', 'Then undo the multiplication.'],
        steps: [`Subtract ${b} from both sides: ${a}x = ${a * x}.`, `Divide both sides by ${a}.`, `x = ${x}.`],
        why: `Undoing the steps in reverse order gives x = ${a * x} ÷ ${a} = ${x}.`,
        wrong: [[a * x, `That is ${a}x. Divide by ${a} to finish.`], [a * x + b, 'That is the right-hand side.'], [x + b, 'Subtract before you divide.']],
        teach: T.equation,
        fun: FUN.algebra,
        lines: [`${a}x + ${b} = ${a * x + b}`],
      });
    }
    const each = rng.int(2, 9);
    const n1 = rng.int(3, 6);
    const n2 = n1 + rng.int(2, 6);
    return problem(ctx, {
      name: 'Proportion',
      intro: say(lead(ctx), `${n1} tickets cost ${each * n1} dollars. Every ticket costs the same.`),
      q: `How many dollars do ${n2} tickets cost?`,
      a: each * n2,
      unit: 'dollars',
      h: ['Find the cost of one ticket first.', 'Then multiply by the new number of tickets.'],
      steps: [`One ticket: ${each * n1} ÷ ${n1} = ${each}.`, `${n2} tickets: ${n2} × ${each} = ${each * n2}.`],
      why: `Each ticket costs ${each} dollars, so ${n2} tickets cost ${each * n2} dollars.`,
      wrong: [[each * n1 + (n2 - n1), 'Each extra ticket costs more than one dollar.'], [each, 'That is the cost of one ticket.'], [each * n1, 'That is the cost of the first group.']],
      teach: ['What stays the same in a proportional relationship?', 'The amount for one unit.', 'The total.', 'Nothing.'],
      lines: [`${n1} tickets: ${each * n1} dollars`, `${n2} tickets: ?`],
    });
  }
  if (rng.chance(0.5)) {
    const x = rng.int(2, 9);
    const a = rng.int(4, 9);
    const c = rng.int(1, a - 2);
    const b = rng.int(1, 12);
    const d = (a - c) * x - b;
    const right = d >= 0 ? `${c}x + ${d}` : `${c}x − ${-d}`;
    return problem(ctx, {
      name: 'Both Sides',
      intro: say(lead(ctx), 'Two plans cost the same for a certain number of months, x.'),
      q: `Solve ${a}x − ${b} = ${right}. What is x?`,
      a: x,
      h: ['Collect the x terms on one side.', 'Then collect the plain numbers on the other side.'],
      steps: [`Subtract ${c}x from both sides: ${a - c}x − ${b} = ${d}.`, `Add ${b} to both sides: ${a - c}x = ${d + b}.`, `Divide by ${a - c}: x = ${x}.`],
      why: `Keeping both sides balanced leads to ${a - c}x = ${d + b}, so x = ${x}.`,
      wrong: [[d + b, `That is ${a - c}x. Divide to finish.`], [x + 1, 'Check by putting your value back into both sides.'], [x * 2, 'Check by putting your value back into both sides.']],
      teach: T.equation,
      fun: FUN.algebra,
      lines: [`${a}x − ${b} = ${right}`],
    });
  }
  const [x1, y1] = [rng.int(0, 4), rng.int(0, 6)];
  const slope = rng.int(2, 5);
  const run = rng.int(2, 4);
  const [x2, y2] = [x1 + run, y1 + slope * run];
  return problem(ctx, {
    name: 'Slope Finder',
    intro: say(lead(ctx), `A straight ramp on a graph passes through the points (${x1}, ${y1}) and (${x2}, ${y2}).`),
    q: 'What is the slope of the line?',
    a: slope,
    h: ['Slope is rise divided by run.', 'Find the change in y, then divide it by the change in x.'],
    steps: [`Rise: ${y2} − ${y1} = ${slope * run}.`, `Run: ${x2} − ${x1} = ${run}.`, `${slope * run} ÷ ${run} = ${slope}.`],
    why: `The line rises ${slope * run} while it runs ${run}, so the slope is ${slope}.`,
    wrong: [[slope * run, 'That is the rise. Divide it by the run.'], [run, 'That is the run.'], [slope * run - run, 'Divide the rise by the run.']],
    teach: T.slope,
    lines: [`(${x1}, ${y1})`, `(${x2}, ${y2})`],
  });
};

export const MATH_MAKERS_B: Record<string, ProblemMaker> = {
  'math-fractions-decimals': fractions,
  'math-geometry-shapes': geometry,
  'math-measurement-data': measurement,
  'math-algebra-ratios': algebra,
};
