/** More procedural math sets: measurement, shapes, sums, fraction names and expressions. */
import type { Ctx } from '../context';
import { fmt } from '../problem';
import { bin, items, pairs, type CatSet, type KnowledgeSet, type PairSet, type SeqSet } from '../sets/types';
import { titleOf } from './kit';

function base(ctx: Ctx, id: string, skills: readonly string[]) {
  return { id: `math-${id}-${ctx.g}`, strand: 'math' as const, skills, grades: [ctx.grade, ctx.grade] as const, scene: ctx.theme.scene };
}

const MEASURE = ['math-measurement-data'];
const SHAPES = ['math-geometry-shapes'];

export function moreMathSets(ctx: Ctx): KnowledgeSet[] {
  const { g, rng } = ctx;
  const out: KnowledgeSet[] = [];

  // --- Measurement and data ---
  if (g <= 1) {
    const cat: CatSet = {
      ...base(ctx, 'bigsmall', MEASURE), type: 'cat', title: titleOf(ctx, 'Big or Small'), intro: 'Some things are big.', hint: 'Think of the real thing.', explain: 'Big things take up lots of room.',
      teach: ['Which is bigger?', 'The one that needs more room.', 'The red one.', 'The first one.'],
      bins: [bin('Big|🐘', 'a big thing', 'big things', 'Big things need lots of room.', 'elephant|🐘; bus|🚌; house|🏠; tree|🌳'), bin('Small|🐜', 'a small thing', 'small things', 'Small things fit in your hand.', 'ant|🐜; key|🔑; cherry|🍒; button|🔘')],
    };
    const seq: SeqSet = {
      ...base(ctx, 'sizes', MEASURE), type: 'seq', title: titleOf(ctx, 'Size Line'), intro: 'These animals are different sizes.', hint: 'Find the tiny one first.', explain: 'We can line things up by size.',
      teach: ['How do you order by size?', 'Start with the smallest.', 'Start anywhere.', 'Close your eyes.'],
      ask: 'Put the animals in order from smallest to biggest.', items: items('ant|🐜; cat|🐱; horse|🐴; elephant|🐘'), ends: ['smallest', 'biggest'], rel: ['smaller than', 'bigger than'], article: 'the', whole: true,
    };
    const pair: PairSet = {
      ...base(ctx, 'tools0', MEASURE), type: 'pair', title: titleOf(ctx, 'Measure Match'), intro: 'Tools help us measure.', hint: 'Think about what each tool does.', explain: 'Each tool measures one kind of thing.',
      teach: ['What does a clock tell you?', 'The time.', 'Your height.', 'The weather.'],
      ask: 'Match each tool to what it tells you.', q: 'What does the {x} tell you?', tapQ: 'Tap what the {x} tells you.',
      pairs: pairs(['clock|🕐 > the time|⏰ > A clock shows the time.', 'ruler|📏 > how long|↔️ > A ruler shows how long a thing is.', 'scale|⚖️ > how heavy|🏋️ > A scale shows how heavy a thing is.']),
    };
    out.push(cat, seq, pair);
  } else {
    const young = g <= 4;
    out.push({
      ...base(ctx, 'units', MEASURE), type: 'cat', title: titleOf(ctx, young ? 'Measuring Tools' : 'Unit Sort'),
      intro: young ? 'Different tools measure different things.' : 'Every measurement needs a unit that fits what is being measured.',
      hint: young ? 'Think about what you would use each tool for.' : 'Ask what each unit measures: how long, how heavy or how long it takes.',
      explain: young ? 'Rulers and tape measures measure length. Clocks, stopwatches and calendars measure time.' : 'Meters measure length, grams measure mass and seconds measure time.',
      teach: ['Why do we use standard units?', 'So everyone gets the same measurement.', 'They sound nicer.', 'They make things bigger.'],
      fun: 'The meter was first defined using the distance from the North Pole to the equator.',
      bins: young
        ? [bin('Length|📏', 'a tool for length', 'tools for length', 'These tools show how long something is.', 'ruler|📏; tape measure|📐; meter stick|📏'), bin('Time|⏰', 'a tool for time', 'tools for time', 'These tools show how much time passes.', 'clock|🕐; stopwatch|⏱️; calendar|📅; hourglass|⏳')]
        : [bin('Length|📏', 'a unit of length', 'units of length', 'These units tell how long something is.', 'meter; centimeter; kilometer; millimeter'), bin('Mass|⚖️', 'a unit of mass', 'units of mass', 'These units tell how much matter something has.', 'gram; kilogram; milligram'), bin('Time|⏰', 'a unit of time', 'units of time', 'These units tell how long something takes.', 'second; minute; hour')],
    } satisfies CatSet);
    out.push({
      ...base(ctx, 'convert', MEASURE), type: 'pair', title: titleOf(ctx, young ? 'Tool Match' : 'Equal Measures'),
      intro: young ? 'Each tool measures one kind of thing.' : 'The same amount can be written with different units.',
      hint: young ? 'Think about when you would use each tool.' : 'Think about how many small units fit into one big unit.',
      explain: young ? 'We choose the tool that fits what we want to measure.' : 'A bigger unit is made of many smaller units.',
      teach: young ? ['What does a thermometer measure?', 'Temperature.', 'Length.', 'Time.'] : ['How many meters are in one kilometer?', '1,000.', '100.', '10.'],
      ask: young ? 'Match each tool to what it measures.' : 'Match the measures that are equal.',
      q: young ? 'What does a {x} measure?' : 'Which measure is equal to {x}?',
      tapQ: young ? 'Tap what a {x} measures.' : 'Tap the measure that is equal to {x}.',
      pairs: young
        ? pairs(['ruler|📏 > length > A ruler shows how long something is.', 'clock|🕐 > time > A clock shows the time.', 'scale|⚖️ > weight > A scale shows how heavy something is.', 'thermometer|🌡️ > temperature > A thermometer shows how hot or cold it is.', 'measuring cup|🥛 > volume > A measuring cup shows how much liquid there is.'])
        : rng.sample(pairs(['1 kilometer > 1,000 meters > Kilo means one thousand.', '1 meter > 100 centimeters > Centi means one hundredth.', '1 kilogram > 1,000 grams > Kilo means one thousand.', '1 hour > 60 minutes > An hour has 60 minutes.', '1 liter > 1,000 milliliters > Milli means one thousandth.', '1 minute > 60 seconds > A minute has 60 seconds.', '1 day > 24 hours > A day has 24 hours.']), 5),
    } satisfies PairSet);
    out.push({
      ...base(ctx, 'unitorder', MEASURE), type: 'seq', title: titleOf(ctx, young ? 'Time Line' : 'Length Line'),
      intro: young ? 'Some units of time are short, and some are long.' : 'Units of length range from tiny to huge.',
      hint: young ? 'Think about how many of one unit fit into the next.' : 'Think about what you would measure with each unit.',
      explain: young ? 'Sixty seconds make a minute, sixty minutes make an hour, and twenty-four hours make a day.' : 'Ten millimeters make a centimeter, one hundred centimeters make a meter, and one thousand meters make a kilometer.',
      teach: young ? ['Which is longer: a minute or an hour?', 'An hour.', 'A minute.', 'They are the same.'] : ['Which unit fits the length of a road?', 'Kilometers.', 'Millimeters.', 'Grams.'],
      ask: young ? 'Put the units of time in order from shortest to longest.' : 'Put the units of length in order from shortest to longest.',
      items: items(young ? 'second; minute; hour; day; week' : 'millimeter; centimeter; meter; kilometer'), ends: ['shortest', 'longest'], rel: ['shorter than', 'longer than'], article: 'a', whole: true,
    } satisfies SeqSet);
  }

  // --- Shapes ---
  if (g >= 2) {
    const early = g <= 5;
    out.push({
      ...base(ctx, 'solids', SHAPES), type: 'cat', title: titleOf(ctx, early ? 'Flat or Solid' : 'Four Sides or Not'),
      intro: early ? 'Flat shapes can be drawn on paper. Solid shapes take up space.' : 'A quadrilateral is a flat shape with exactly four straight sides.',
      hint: early ? 'Ask: could you pick it up and hold it in your hands?' : 'Count the straight sides of each shape.',
      explain: early ? 'Flat shapes have only length and width. Solid shapes also have height.' : 'Squares, rectangles, rhombuses and trapezoids all have four straight sides, so they are quadrilaterals.',
      teach: early ? ['What makes a shape solid?', 'It has length, width and height.', 'It is drawn with a thick pen.', 'It is colored in.'] : ['What is a quadrilateral?', 'A shape with four straight sides.', 'A shape with four curves.', 'Any shape with corners.'],
      fun: 'The word geometry means "measuring the Earth".',
      bins: early
        ? [bin('Flat|⬜', 'a flat shape', 'flat shapes', 'Flat shapes have no thickness.', 'circle; square; triangle; rectangle'), bin('Solid|🧊', 'a solid shape', 'solid shapes', 'Solid shapes take up space.', 'cube; sphere; cone; cylinder')]
        : [bin('Quadrilateral|⬜', 'a quadrilateral', 'quadrilaterals', 'It has exactly four straight sides.', 'square; rectangle; rhombus; trapezoid'), bin('Not one|🔺', 'a shape that is not a quadrilateral', 'shapes that are not quadrilaterals', 'It does not have exactly four straight sides.', 'triangle; pentagon; hexagon; circle')],
    } satisfies CatSet);
    out.push({
      ...base(ctx, 'sides', SHAPES), type: 'pair', title: titleOf(ctx, early ? 'Count the Sides' : 'Angle Names'),
      intro: early ? 'Shapes are named after their sides and corners.' : 'Angles are named by their size.',
      hint: early ? 'Picture the shape and trace around it.' : 'Compare each angle with a square corner.',
      explain: early ? 'The number of sides tells you the name of a shape.' : 'A right angle is a square corner. Acute angles are smaller and obtuse angles are bigger.',
      teach: early ? ['How many sides does a hexagon have?', 'Six.', 'Five.', 'Eight.'] : ['What is an acute angle?', 'An angle smaller than a right angle.', 'An angle bigger than a right angle.', 'A straight line.'],
      ask: early ? 'Match each shape to its number of sides.' : 'Match each angle size to its name.',
      q: early ? 'How many sides does a {x} have?' : 'What is an angle of {x} called?',
      tapQ: early ? 'Tap the number of sides of a {x}.' : 'Tap the name for an angle of {x}.',
      pairs: early
        ? pairs(['triangle > 3 sides > Tri means three.', 'square > 4 sides > A square has four equal sides.', 'pentagon > 5 sides > Penta means five.', 'hexagon > 6 sides > Hexa means six.', 'octagon > 8 sides > Octa means eight.'])
        : pairs(['exactly 90° > right angle > A right angle is a square corner.', 'less than 90° > acute angle > Acute angles are sharper than a square corner.', 'between 90° and 180° > obtuse angle > Obtuse angles are wider than a square corner.', 'exactly 180° > straight angle > A straight angle looks like a line.']),
    } satisfies PairSet);
  }

  // --- Sums that make a target ---
  // Pre-K and Kindergarten add with objects: each card shows two small groups of counters, the
  // total is never more than 5, and no sum is written out.
  if (g <= 1) {
    const target = g === 0 ? 3 : 5;
    const groups = Array.from({ length: 4 }, (_a, i) => i + 1).flatMap((a) => Array.from({ length: 5 - a }, (_b, j) => ({ a, b: j + 1 })));
    const card = ({ a, b }: { a: number; b: number }) => ({ label: `${a} plus ${b}`, emoji: `${'🔴'.repeat(a)}${'🔷'.repeat(b)}`, wide: true });
    out.push({
      ...base(ctx, 'makes', ['math-addition-subtraction']), type: 'cat', title: titleOf(ctx, `Make ${target}`),
      intro: `Some cards make ${target}.`,
      hint: 'Count all the shapes on a card.',
      explain: 'Different groups can make the same total.',
      teach: ['What does adding do?', 'It puts groups together.', 'It takes some away.', 'It hides things.'],
      bins: [
        { label: `Makes ${target}`, emoji: '✅', one: `a card that makes ${target}`, many: `cards that make ${target}`, rule: `These cards have ${target} shapes in all.`, items: rng.shuffle(groups.filter(({ a, b }) => a + b === target)).map(card) },
        { label: 'Does not', emoji: '❌', one: `a card that does not make ${target}`, many: `cards that do not make ${target}`, rule: 'These cards have a different number of shapes.', items: rng.sample(groups.filter(({ a, b }) => a + b !== target), 4).map(card) },
      ],
    } satisfies CatSet);
  } else if (g <= 5) {
    const target = g === 2 ? 10 : g === 3 ? 20 : g === 4 ? 100 : 1000;
    const stepSize = target >= 100 ? target / 20 : 1;
    const hits = rng.sample(Array.from({ length: Math.max(2, Math.min(9, target / stepSize - 1)) }, (_v, i) => (i + 1) * stepSize), Math.min(4, target - 1 > 3 ? 4 : 2)).map((a) => `${fmt(a)} + ${fmt(target - a)}`);
    const misses = rng
      .shuffle([1, 2, -1, -2, 3])
      .map((d, i) => {
        const a = ((i % 3) + 1) * stepSize;
        const b = Math.max(stepSize, target - a + d * stepSize);
        return { label: `${fmt(a)} + ${fmt(b)}`, sum: a + b };
      })
      .filter((m, i, all) => m.sum !== target && all.findIndex((other) => other.label === m.label) === i)
      .slice(0, 4)
      .map((m) => m.label);
    out.push({
      ...base(ctx, 'makes', ['math-addition-subtraction']), type: 'cat', title: titleOf(ctx, `Make ${fmt(target)}`),
      intro: `Number partners that make ${fmt(target)} are handy for quick adding.`,
      hint: 'Work out each sum, then compare it with the target.',
      explain: `Many different pairs of numbers add up to ${fmt(target)}.`,
      teach: ['Why learn number partners?', 'They make mental math faster.', 'They make numbers bigger.', 'They are the only sums.'],
      bins: [
        { label: `Makes ${fmt(target)}`, emoji: '✅', one: `a sum that makes ${fmt(target)}`, many: `sums that make ${fmt(target)}`, rule: 'The two numbers add up to the target.', items: hits.map((label) => ({ label })) },
        { label: 'Does not', emoji: '❌', one: `a sum that does not make ${fmt(target)}`, many: `sums that do not make ${fmt(target)}`, rule: 'The two numbers add up to a different total.', items: misses.map((label) => ({ label })) },
      ],
    } satisfies CatSet);
  }

  // --- Fraction names ---
  if (g >= 2 && g <= 5) {
    out.push({
      ...base(ctx, 'fracnames', ['math-fractions-decimals']), type: 'pair', title: titleOf(ctx, 'Fraction Names'),
      intro: 'Every fraction has a name that tells how many equal parts there are.', hint: 'The bottom number tells you into how many equal parts the whole is cut.',
      explain: 'The top number counts the parts you have. The bottom number tells how many equal parts make the whole.',
      teach: ['What does the bottom number of a fraction tell you?', 'How many equal parts make the whole.', 'How many parts you have.', 'How big the number is.'],
      fun: 'The word fraction comes from a Latin word that means "broken".',
      ask: 'Match each fraction to its name.', q: 'What is the name of {x}?', tapQ: 'Tap the name of {x}.',
      pairs: rng.sample(pairs(['1/2 > one half > Two equal parts, and one of them.', '1/3 > one third > Three equal parts, and one of them.', '1/4 > one fourth > Four equal parts, and one of them.', '3/4 > three fourths > Four equal parts, and three of them.', '2/3 > two thirds > Three equal parts, and two of them.', '1/8 > one eighth > Eight equal parts, and one of them.']), g === 2 ? 3 : 5),
    } satisfies PairSet);
    out.push({
      ...base(ctx, 'unitfractions', ['math-fractions-decimals']), type: 'seq', title: titleOf(ctx, 'Pizza Slices'),
      intro: 'A pizza can be cut into 2, 3, 4 or 8 equal slices.', hint: 'The more slices you cut, the smaller each slice is.',
      explain: 'Cutting a whole into more equal parts makes each part smaller, so one eighth is smaller than one half.',
      teach: ['Which is bigger: one half or one fourth of the same pizza?', 'One half.', 'One fourth.', 'They are equal.'],
      ask: 'Put the slices in order from smallest to biggest.', items: items(g === 2 ? 'one fourth; one half; one whole' : 'one eighth; one fourth; one third; one half'), ends: ['smallest', 'biggest'], rel: ['smaller than', 'bigger than'], article: '', whole: true,
    } satisfies SeqSet);
  }

  // --- Expressions by value (algebra) ---
  if (g >= 4) {
    const used = new Set<number>();
    const rows: { label: string; value: number }[] = [];
    for (let tries = 0; tries < 60 && rows.length < 4; tries += 1) {
      const a = rng.int(2, g >= 7 ? 12 : 9);
      const b = rng.int(2, 9);
      const form = rng.int(0, g >= 6 ? 3 : 2);
      const [label, value] = form === 0 ? [`${a} × ${b}`, a * b] : form === 1 ? [`${a * b} + ${a}`, a * b + a] : form === 2 ? [`${a * b + b} − ${b}`, a * b] : [`${a} + ${b} × 2`, a + b * 2];
      if (used.has(value)) continue;
      used.add(value);
      rows.push({ label, value });
    }
    rows.sort((x, y) => x.value - y.value);
    out.push({
      ...base(ctx, 'expressions', ['math-algebra-ratios', 'math-multiplication-division']), type: 'seq', title: titleOf(ctx, 'Value Line'),
      intro: 'Each expression stands for one number: its value.', hint: 'Work out the value of each expression first.',
      explain: `The values are ${rows.map((r) => r.value).join(', ')}. Remember that multiplication comes before addition.`,
      teach: ['What is the value of an expression?', 'The number you get when you work it out.', 'The number of symbols in it.', 'Its first number.'],
      fun: 'The equals sign was invented in 1557. Its two lines are the same length.',
      ask: 'Put the expressions in order from the smallest value to the biggest value.', items: rows.map((r) => ({ label: r.label })), ends: ['smallest', 'biggest'], rel: ['smaller than', 'bigger than'], article: '', whole: true,
    } satisfies SeqSet);
    if (g <= 6) {
      const seen = new Set<number>();
      const eq: string[] = [];
      for (let tries = 0; tries < 60 && eq.length < 5; tries += 1) {
        const x = rng.int(2, 12);
        const a = rng.int(2, 9);
        if (seen.has(x)) continue;
        seen.add(x);
        eq.push(rng.chance(0.5) ? `? + ${a} = ${x + a} > ${x} > ${x + a} − ${a} = ${x}.` : `? × ${a} = ${x * a} > ${x} > ${x * a} ÷ ${a} = ${x}.`);
      }
      out.push({
        ...base(ctx, 'missing', ['math-algebra-ratios']), type: 'pair', title: titleOf(ctx, 'Missing Numbers'),
        intro: 'In each equation, one number is hiding behind a question mark.', hint: 'Use the opposite operation to find the hidden number.',
        explain: 'Subtraction undoes addition, and division undoes multiplication.',
        teach: ['How do you find a missing addend?', 'Subtract the part you know from the total.', 'Add the two numbers.', 'Guess.'],
        ask: 'Match each equation to its missing number.', q: 'Which number is missing in {x}?', tapQ: 'Tap the number that is missing in {x}.',
        pairs: pairs(eq),
      } satisfies PairSet);
    }
  }
  return out;
}
