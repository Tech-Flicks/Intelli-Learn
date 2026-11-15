/**
 * Procedural problems for science, technology, engineering and logic: questions with one numeric
 * answer that is computed here, together with the typical mistakes. A maker returns null when
 * it has nothing suitable for the grade.
 */
import { cap, lead, say } from '../context';
import type { ProblemMaker } from '../problem';
import { bandScene, cardScene } from '../scene';
import { problem, range, thingOf, thingScene, tidy } from './kit';

// ---------------------------------------------------------------------------
// Technology
// ---------------------------------------------------------------------------

const loops: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g <= 1) {
    const times = rng.int(2, 3);
    return problem(ctx, {
      name: 'Robot Hops',
      intro: `The robot hops 2 times, and does that ${times} times over.`,
      q: 'How many hops is that?',
      a: 2 * times,
      h: ['Act it out with your fingers.', 'Count every hop.'],
      steps: [`It hops 2 times, ${times} times over.`, `Count: ${range(1, times).map((i) => i * 2).join(', ')}.`],
      why: 'A loop does the same thing again and again.',
      wrong: [[2, 'That is only one round.'], [2 + times, 'Count every round of hops.']],
      teach: ['What does a loop do?', 'It repeats steps.', 'It stops the robot.', 'It makes a sound.'],
      fun: 'Computers can repeat a step millions of times without getting tired.',
      lines: [`repeat ${times} times:`, '   hop, hop'],
    });
  }
  const times = rng.int(2, g <= 3 ? 5 : 9);
  const each = rng.int(2, g <= 3 ? 5 : 9);
  if (g <= 5) {
    return problem(ctx, {
      name: 'Loop Count',
      intro: say(lead(ctx), `A program tells a robot: repeat ${times} times, move ${each} steps.`),
      q: 'How many steps does the robot move in all?',
      a: times * each,
      unit: 'steps',
      h: ['The robot does the same move again and again.', 'Multiply the steps in one round by the number of rounds.'],
      steps: [`One round is ${each} steps.`, `The loop runs ${times} times.`, `${times} × ${each} = ${times * each}.`],
      why: `A loop repeats its steps, so the robot moves ${times} × ${each} = ${times * each} steps.`,
      wrong: [[times + each, 'A loop repeats, so multiply.'], [each, 'That is only one round.'], [times, 'That is the number of rounds.']],
      teach: ['Why do programmers use loops?', 'To repeat steps without writing them again and again.', 'To make programs longer.', 'To slow the computer down.'],
      fun: 'Computers can repeat a step millions of times without getting tired.',
      lines: [`repeat ${times} times:`, `   move ${each} steps`],
    });
  }
  const inner = rng.int(2, 5);
  const extra = rng.int(1, 9);
  return problem(ctx, {
    name: 'Nested Loops',
    intro: say(lead(ctx), `A program runs an outer loop ${times} times. Inside it, an inner loop beeps ${inner} times. After both loops finish, it beeps ${extra} more times.`),
    q: 'How many beeps are there in all?',
    a: times * inner + extra,
    unit: 'beeps',
    h: ['The inner loop runs completely each time the outer loop runs.', 'Multiply the two loop counts, then add the beeps after the loops.'],
    steps: [`Each outer round makes ${inner} beeps.`, `${times} × ${inner} = ${times * inner}.`, `${times * inner} + ${extra} = ${times * inner + extra}.`],
    why: `Nested loops multiply: ${times} × ${inner} = ${times * inner}, plus ${extra} at the end.`,
    wrong: [[times + inner + extra, 'Nested loops multiply.'], [times * inner, 'Do not forget the beeps after the loops.'], [times * (inner + extra), 'The extra beeps happen only once, after the loops.']],
    teach: ['What happens with a loop inside a loop?', 'The inner loop runs fully for every round of the outer loop.', 'Only the outer loop runs.', 'They run at the same time.'],
    lines: [`repeat ${times} times:`, `   repeat ${inner} times: beep`, `repeat ${extra} times: beep`],
  });
};

const variables: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 3) return null;
  const start = rng.int(2, 9);
  const add = rng.int(2, 9);
  if (g <= 4) {
    const add2 = rng.int(1, 6);
    return problem(ctx, {
      name: 'Score Keeper',
      intro: say(lead(ctx), `A game stores points in a box called score. It starts at ${start}. Then the game adds ${add}, and then adds ${add2}.`),
      q: 'What number is in score now?',
      a: start + add + add2,
      h: ['A variable keeps its newest value.', 'Follow the changes one line at a time.'],
      steps: [`Start: ${start}.`, `${start} + ${add} = ${start + add}.`, `${start + add} + ${add2} = ${start + add + add2}.`],
      why: `Each line changes the value that is already stored, so score ends at ${start + add + add2}.`,
      wrong: [[add + add2, 'Do not forget the starting value.'], [start + add, 'There is one more line.'], [add2, 'The new points are added to what is already there.']],
      teach: ['What is a variable?', 'A named box that stores a value.', 'A kind of loop.', 'A broken program.'],
      lines: [`score = ${start}`, `score = score + ${add}`, `score = score + ${add2}`],
    });
  }
  const mul = rng.int(2, 4);
  if (g <= 6) {
    return problem(ctx, {
      name: 'Trace the Code',
      intro: say(lead(ctx), `A program sets x to ${start}. Next it adds ${add} to x. Then it multiplies x by ${mul}.`),
      q: 'What is the value of x at the end?',
      a: (start + add) * mul,
      h: ['Run the lines in order, from top to bottom.', 'Write down the new value after each line.'],
      steps: [`x starts at ${start}.`, `${start} + ${add} = ${start + add}.`, `${start + add} × ${mul} = ${(start + add) * mul}.`],
      why: `The lines run in order, so x becomes ${start + add} and then ${(start + add) * mul}.`,
      wrong: [[start + add * mul, 'The lines run in order, so add first.'], [start + add, 'There is one more line.'], [start * mul, 'The addition line was skipped.']],
      teach: ['In what order does a computer run a program?', 'One line at a time, from the top.', 'The biggest numbers first.', 'In a random order.'],
      lines: [`x = ${start}`, `x = x + ${add}`, `x = x × ${mul}`],
    });
  }
  const limit = rng.int(12, 24);
  const value = (start + add) * mul;
  const cut = rng.int(3, 9);
  const end = value > limit ? value - cut : value + cut;
  return problem(ctx, {
    name: 'Trace the Code',
    intro: say(lead(ctx), `A program sets x to ${start}, adds ${add}, then multiplies x by ${mul}. Last, if x is greater than ${limit} it subtracts ${cut}; otherwise it adds ${cut}.`),
    q: 'What is the value of x at the end?',
    a: end,
    h: ['Trace the value line by line.', 'Test the condition with the value x has at that moment.'],
    steps: [`${start} + ${add} = ${start + add}.`, `${start + add} × ${mul} = ${value}.`, `${value} is ${value > limit ? '' : 'not '}greater than ${limit}.`, `So x becomes ${end}.`],
    why: `x is ${value} when the condition is tested, so the program ${value > limit ? 'subtracts' : 'adds'} ${cut} and ends with ${end}.`,
    wrong: [[value > limit ? value + cut : value - cut, 'Check which branch of the condition runs.'], [value, 'The last line still changes x.'], [start + add * mul, 'The lines run in order.']],
    teach: ['What does an if statement do?', 'It runs some code only when a condition is true.', 'It repeats code forever.', 'It deletes a variable.'],
    lines: [`x = ${start}`, `x = (x + ${add}) × ${mul}`, `if x > ${limit}: x = x − ${cut}`, `else: x = x + ${cut}`],
  });
};

const dataRep: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  const thing = thingOf(ctx);
  if (g <= 1) {
    const n = rng.int(2, g === 0 ? 4 : 6);
    const other = rng.pick(ctx.theme.things.filter((t) => t.emoji !== thing.emoji));
    return problem(ctx, {
      name: 'Picture Chart',
      intro: `The chart shows ${thing.many} and ${other.many}.`,
      q: `How many ${thing.many} are on the chart?`,
      a: n,
      h: [`Look only at the ${thing.many}.`, 'Touch each one as you count.'],
      steps: [`Find every ${thing.one}.`, `Count: ${range(1, n).join(', ')}.`],
      why: 'A chart shows how many there are of each kind.',
      wrong: [[n + 2, `Do not count the ${other.many}.`], [n - 1, 'You missed one.']],
      teach: ['What does a chart show?', 'How many of each kind.', 'A funny story.', 'Only colors.'],
      scene: thingScene(ctx, [{ emoji: thing.emoji, count: n }, { emoji: other.emoji, count: 2 }]),
    });
  }
  if (g <= 3) {
    // Grade 1 reads how many, Grade 2 how many more or fewer: one star is one vote. A key comes in Grade 3.
    const other = rng.pick(ctx.theme.things.filter((t) => t.emoji !== thing.emoji));
    const [few, many] = rng.sample([1, 2, 3, 4, 5, 6], 2).sort((a, b) => a - b) as [number, number];
    const mine = rng.chance(0.5) ? many : few;
    const theirs = mine === many ? few : many;
    // One row for each choice, as on a real picture graph.
    const scene = bandScene(ctx.theme.scene, [range(1, mine).map(() => ({ emoji: thing.emoji })), range(1, theirs).map(() => ({ emoji: other.emoji }))], { calm: true });
    if (g === 2) {
      return problem(ctx, {
        name: 'Picture Graph',
        intro: say(lead(ctx), `On this picture graph, each picture is one vote. There are votes for ${thing.many} and for ${other.many}.`),
        q: `How many votes did ${thing.many} get?`,
        a: mine,
        unit: 'votes',
        h: [`Look only at the ${thing.many}.`, 'Count one vote for each picture.'],
        steps: [`Find every ${thing.one} on the graph.`, `Count them: ${range(1, mine).join(', ')}.`],
        why: `There are ${mine} pictures of ${thing.many}, and each picture is one vote.`,
        wrong: [[theirs, `That is the number of votes for ${other.many}.`], [mine + theirs, `Count only the ${thing.many}.`], [mine + 1, 'Count each picture only once.']],
        teach: ['What does one picture on a picture graph show?', 'One vote.', 'One page.', 'One color.'],
        scene,
      });
    }
    const more = mine > theirs;
    return problem(ctx, {
      name: 'Picture Graph',
      intro: say(lead(ctx), `On this picture graph, each picture is one vote. One row shows the votes for ${thing.many}, the other the votes for ${other.many}.`),
      q: `How many ${more ? 'more' : 'fewer'} votes did ${thing.many} get than ${other.many}?`,
      a: many - few,
      unit: 'votes',
      h: ['Count the pictures in each row first.', 'Subtract the smaller number from the bigger one.'],
      steps: [`${cap(thing.many)}: ${mine} ${mine === 1 ? 'vote' : 'votes'}.`, `${cap(other.many)}: ${theirs} ${theirs === 1 ? 'vote' : 'votes'}.`, `${many} − ${few} = ${many - few}.`],
      why: `${many} − ${few} = ${many - few}, so ${thing.many} got ${many - few} ${more ? 'more' : 'fewer'} ${many - few === 1 ? 'vote' : 'votes'}.`,
      wrong: [[many + few, 'How many more or fewer asks for the difference, not the total.'], [mine, `That is how many votes ${thing.many} got.`], [theirs, `That is how many votes ${other.many} got.`]],
      teach: ['How do you find how many more?', 'Subtract the smaller number from the bigger one.', 'Add the two numbers.', 'Pick the bigger number.'],
      scene,
    });
  }
  if (g === 4) {
    const per = rng.pick([2, 5, 10]);
    const stars = rng.int(2, 6);
    return problem(ctx, {
      name: 'Picture Graph',
      intro: say(lead(ctx), `On a picture graph, each star stands for ${per} votes. The row for ${thing.many} has ${stars} stars.`),
      q: `How many votes did ${thing.many} get?`,
      a: per * stars,
      unit: 'votes',
      h: ['Check the key: one picture can stand for more than one vote.', 'Skip-count once for each star.'],
      steps: [`Each star is ${per} votes.`, `Skip-count ${stars} times: ${range(1, stars).map((i) => i * per).join(', ')}.`],
      why: `${stars} stars worth ${per} votes each make ${per * stars} votes.`,
      wrong: [[stars, `Each star stands for ${per} votes, not one.`], [per + stars, 'Skip-count for each star.'], [per * stars + per, 'That is one star too many.']],
      teach: ['What does the key of a picture graph tell you?', 'How much each picture stands for.', 'Who made the graph.', 'What color to use.'],
      scene: cardScene(ctx.theme.scene, [...range(1, stars).map(() => ({ emoji: '⭐' })), { text: `⭐ = ${per} votes` }]),
    });
  }
  const bits = g <= 5 ? 3 : g <= 7 ? 4 : rng.int(5, 6);
  const value = rng.int(2 ** (bits - 1) + 1, 2 ** bits - 1);
  const binary = value.toString(2);
  const places = range(0, bits - 1).map((i) => 2 ** (bits - 1 - i));
  const used = places.filter((_p, i) => binary[i] === '1');
  return problem(ctx, {
    name: 'Binary Code',
    intro: say(lead(ctx), `Computers store numbers with only the digits 0 and 1. From right to left, the places are worth ${[...places].reverse().join(', ')}.`),
    q: `Which number does the binary code ${binary.split('').join(' ')} stand for?`,
    a: value,
    h: ['Write the place values above the digits.', 'Add the place values that have a 1 under them.'],
    steps: [`The places are worth ${places.join(', ')}.`, `The 1s sit under ${used.join(' and ')}.`, `${used.join(' + ')} = ${value}.`],
    why: `Adding the place values under each 1 gives ${used.join(' + ')} = ${value}.`,
    wrong: [[used.length, 'That counts the 1s. Add their place values instead.'], [Number(binary), 'Binary digits have place values of 1, 2, 4, 8 and so on, not tens.'], [value + 1, 'Add the place values once more.']],
    teach: ['What is each binary place worth?', 'Twice as much as the place to its right.', 'Ten times as much as the place to its right.', 'The same as every other place.'],
    fun: 'The word "bit" is short for "binary digit".',
    lines: [places.join('  '), binary.split('').join('  ')],
  });
};

const conditionals: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 3) return null;
  const input = rng.int(3, g <= 5 ? 20 : 60);
  const add = rng.int(2, 9);
  const even = input % 2 === 0;
  const hard = g >= 6;
  const out = even ? (hard ? input / 2 : input + add) : hard ? input * 3 + 1 : input - 1;
  return problem(ctx, {
    name: 'If This, Then That',
    intro: say(lead(ctx), `A number machine follows a rule. If the number is even, it ${hard ? 'halves it' : `adds ${add}`}. Otherwise, it ${hard ? 'multiplies it by 3 and adds 1' : 'subtracts 1'}.`),
    q: `What comes out when ${input} goes in?`,
    a: out,
    h: ['First decide whether the number is even or odd.', 'Then follow only the branch that fits.'],
    steps: [`${input} is ${even ? 'even' : 'odd'}.`, `So the machine ${even ? (hard ? 'halves it' : `adds ${add}`) : hard ? 'multiplies by 3 and adds 1' : 'subtracts 1'}.`, `The result is ${out}.`],
    why: `${input} is ${even ? 'even' : 'odd'}, so only the ${even ? 'first' : 'second'} branch runs and gives ${out}.`,
    wrong: [[even ? (hard ? input * 3 + 1 : input - 1) : hard ? Math.floor(input / 2) : input + add, 'That is the other branch.'], [input, 'The machine always changes the number.'], [out + 1, 'Check the arithmetic in the branch.']],
    teach: ['How does a computer choose between two branches?', 'It tests a condition that is true or false.', 'It picks one at random.', 'It always runs both.'],
    lines: [`if even: ${hard ? 'n ÷ 2' : `n + ${add}`}`, `else: ${hard ? 'n × 3 + 1' : 'n − 1'}`, `n = ${input}`],
  });
};

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

const numberPatterns: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 3) return null;
  let seq: number[];
  let rule: string;
  if (g <= 5) {
    const step = rng.int(2, g === 3 ? 5 : 12);
    const start = rng.int(1, 20);
    const down = g >= 4 && rng.chance(0.3);
    seq = range(0, 4).map((i) => (down ? start + step * (6 - i) : start + step * i));
    rule = down ? `subtract ${step} each time` : `add ${step} each time`;
  } else if (g <= 7) {
    if (rng.chance(0.5)) {
      const factor = rng.pick([2, 3]);
      const start = rng.int(1, 5);
      seq = range(0, 4).map((i) => start * factor ** i);
      rule = `multiply by ${factor} each time`;
    } else {
      const start = rng.int(1, 9);
      const first = rng.int(1, 3);
      seq = [start];
      for (let i = 0; i < 4; i += 1) seq.push((seq[i] as number) + first + i);
      rule = 'the jumps grow by 1 each time';
    }
  } else if (rng.chance(0.5)) {
    const first = rng.int(1, 4);
    seq = range(first, first + 4).map((n) => n * n);
    rule = 'these are square numbers';
  } else {
    const a = rng.int(1, 4);
    const b = rng.int(1, 5);
    seq = [a, b];
    for (let i = 2; i < 5; i += 1) seq.push((seq[i - 1] as number) + (seq[i - 2] as number));
    rule = 'each number is the sum of the two before it';
  }
  const shown = seq.slice(0, 4);
  const answer = seq[4] as number;
  const last = shown[3] as number;
  const prevJump = last - (shown[2] as number);
  return problem(ctx, {
    name: 'Pattern Code',
    intro: say(lead(ctx), 'A secret code follows a number pattern.'),
    q: `${shown.join(', ')}, __. What number comes next?`,
    a: answer,
    h: ['Look at how you get from each number to the next.', 'Check that your rule works for every step, then use it once more.'],
    steps: [`Compare neighbors: ${shown.join(', ')}.`, `The rule: ${rule}.`, `So the next number is ${answer}.`],
    why: `The rule is: ${rule}. That makes the next number ${answer}.`,
    wrong: [[last + prevJump === answer ? answer + 1 : last + prevJump, 'The pattern does not use the same jump every time.'], [last + 1 === answer ? answer + 2 : last + 1, 'Look at the size of the jumps.'], [answer + (prevJump || 2), 'That goes one step too far.']],
    teach: ['How do you find the rule of a number pattern?', 'Compare each number with the one before it.', 'Look only at the first number.', 'Add all the numbers.'],
    fun: 'Number patterns appear in pine cones and sunflowers.',
    lines: [`${shown.join(', ')}, ?`],
  });
};

const strategy: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  if (g <= 3) {
    const x = rng.int(2, 9);
    const add = rng.int(2, 8);
    return problem(ctx, {
      name: 'Think Backward',
      intro: say(lead(ctx), `I am thinking of a number. When I add ${add} to it, I get ${x + add}.`),
      q: 'What is my number?',
      a: x,
      h: ['Work backward from the end.', 'Undo the adding.'],
      steps: [`The end number is ${x + add}.`, `Undo "add ${add}" by subtracting ${add}.`, `${x + add} − ${add} = ${x}.`],
      why: `Subtracting undoes adding: ${x + add} − ${add} = ${x}.`,
      wrong: [[x + 2 * add, 'Go backward: subtract instead of adding.'], [x + add, 'That is the end number.'], [add, 'That is the number that was added.']],
      teach: ['How do you work backward?', 'Undo each step, starting from the end.', 'Do every step twice.', 'Start again from zero.'],
      lines: [`? + ${add} = ${x + add}`],
    });
  }
  if (g <= 5) {
    if (rng.chance(0.5)) {
      const tops = rng.int(2, 5);
      const bottoms = rng.int(2, 4);
      return problem(ctx, {
        name: 'Outfit Puzzle',
        intro: say(lead(ctx), `A costume box holds ${tops} different hats and ${bottoms} different capes.`),
        q: 'How many different outfits with one hat and one cape can you make?',
        a: tops * bottoms,
        unit: 'outfits',
        h: ['Every hat can go with every cape.', 'Make an organized list, hat by hat.'],
        steps: [`The first hat goes with ${bottoms} capes.`, `That is true for each of the ${tops} hats.`, `${tops} × ${bottoms} = ${tops * bottoms}.`],
        why: `Each of the ${tops} hats pairs with ${bottoms} capes, so there are ${tops * bottoms} outfits.`,
        wrong: [[tops + bottoms, 'Each hat pairs with every cape, so multiply.'], [tops, 'Each hat can be worn with several capes.'], [tops * bottoms * 2, 'Hat with cape is the same outfit as cape with hat.']],
        teach: ['Why does an organized list help?', 'You find every possibility and count none twice.', 'It makes the list longer.', 'It is faster to guess.'],
        scene: cardScene(ctx.theme.scene, [...range(1, tops).map(() => ({ emoji: '🎩' })), ...range(1, bottoms).map(() => ({ emoji: '🧣' }))]),
      });
    }
    const x = rng.int(3, 12);
    const add = rng.int(2, 9);
    return problem(ctx, {
      name: 'Think Backward',
      intro: say(lead(ctx), `I think of a number, double it, and then add ${add}. I end up with ${2 * x + add}.`),
      q: 'What number did I start with?',
      a: x,
      h: ['Start from the end and undo the last step first.', 'After undoing the adding, undo the doubling.'],
      steps: [`Undo "add ${add}": ${2 * x + add} − ${add} = ${2 * x}.`, `Undo "double": ${2 * x} ÷ 2 = ${x}.`, `Check: ${x} × 2 + ${add} = ${2 * x + add}.`],
      why: `Working backward: ${2 * x + add} − ${add} = ${2 * x}, and half of ${2 * x} is ${x}.`,
      wrong: [[2 * x, 'One more step: undo the doubling.'], [(2 * x + add) * 2 + add, 'Go backward, undoing each step.'], [x + add, 'Undo the last step first.']],
      teach: ['How do you work backward?', 'Undo each step in reverse order.', 'Repeat each step.', 'Start from zero.'],
      lines: [`? × 2 + ${add} = ${2 * x + add}`],
    });
  }
  if (g <= 7) {
    const cows = rng.int(1, 5);
    const hens = rng.int(2, 6);
    const heads = cows + hens;
    const legs = cows * 4 + hens * 2;
    return problem(ctx, {
      name: 'Heads and Legs',
      intro: say(lead(ctx), `A farmer counts ${heads} heads and ${legs} legs among her cows and hens. A cow has 4 legs and a hen has 2.`),
      q: 'How many cows are there?',
      a: cows,
      unit: 'cows',
      h: ['Pretend every animal is a hen and count the legs you would have.', 'Each cow adds two extra legs to that count.'],
      steps: [`If all ${heads} were hens: ${heads} × 2 = ${heads * 2} legs.`, `Extra legs: ${legs} − ${heads * 2} = ${legs - heads * 2}.`, `Each cow adds 2 extra legs: ${legs - heads * 2} ÷ 2 = ${cows}.`],
      why: `${cows} cows and ${hens} hens have ${cows * 4} + ${hens * 2} = ${legs} legs and ${heads} heads.`,
      wrong: [[hens, 'That is the number of hens.'], [heads, 'That is all the animals.'], [legs - heads * 2, 'Each cow has two extra legs, so halve this.']],
      teach: ['Why is "suppose they are all hens" a useful strategy?', 'It gives a simple starting point that you can adjust.', 'It is always the answer.', 'Cows do not count.'],
      scene: cardScene(ctx.theme.scene, [{ emoji: '🐄' }, { emoji: '🐔' }, { text: `${heads} heads, ${legs} legs` }]),
    });
  }
  const n = rng.int(4, 9);
  return problem(ctx, {
    name: 'Handshakes',
    intro: say(lead(ctx), `${n} inventors meet. Each one shakes hands exactly once with every other inventor.`),
    q: 'How many handshakes happen?',
    a: (n * (n - 1)) / 2,
    unit: 'handshakes',
    h: ['Start with a smaller group and look for a pattern.', 'Each handshake involves two people, so be careful not to count it twice.'],
    steps: [`Each of the ${n} people shakes ${n - 1} hands.`, `${n} × ${n - 1} = ${n * (n - 1)}, but that counts every handshake twice.`, `${n * (n - 1)} ÷ 2 = ${(n * (n - 1)) / 2}.`],
    why: `Every pair shakes once: ${n} × ${n - 1} ÷ 2 = ${(n * (n - 1)) / 2}.`,
    wrong: [[n * (n - 1), 'That counts each handshake twice.'], [n * n, 'Nobody shakes their own hand.'], [n, 'Each person shakes more than one hand.']],
    teach: ['Why divide by 2 in the handshake puzzle?', 'Each handshake was counted once for each of its two people.', 'Half the people are missing.', 'Hands come in pairs.'],
    scene: cardScene(ctx.theme.scene, [{ emoji: '🤝', scale: 1.3 }, { text: `${n} people` }]),
  });
};

const deduction: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  const names = rng.sample(['Mia', 'Leo', 'Sam', 'Zoe', 'Kai', 'Ava', 'Ben', 'Noor'], 3) as [string, string, string];
  const base = rng.int(4, 9);
  const d1 = rng.int(1, 4);
  const d2 = rng.int(1, 4);
  const hard = g >= 5;
  const [a, b, c] = names;
  const ageB = base + d1;
  const ageA = hard ? ageB * 2 - d2 : ageB + d2;
  return problem(ctx, {
    name: 'Age Detective',
    intro: say(lead(ctx), `${c} is ${base} years old. ${b} is ${d1} ${d1 === 1 ? 'year' : 'years'} older than ${c}. ${a} is ${hard ? `${d2} ${d2 === 1 ? 'year' : 'years'} younger than twice ${b}'s age` : `${d2} ${d2 === 1 ? 'year' : 'years'} older than ${b}`}.`),
    q: `How old is ${a}?`,
    a: ageA,
    unit: 'years',
    h: ['Start with the fact you know for sure.', `Work out the age of ${b} before the age of ${a}.`],
    steps: [`${c} is ${base}.`, `${b}: ${base} + ${d1} = ${ageB}.`, hard ? `${a}: ${ageB} × 2 − ${d2} = ${ageA}.` : `${a}: ${ageB} + ${d2} = ${ageA}.`],
    why: `Each clue builds on the one before: ${b} is ${ageB}, so ${a} is ${ageA}.`,
    wrong: [[ageB, `That is the age of ${b}.`], [hard ? base * 2 - d2 : base + d2, `Use the age of ${b}, not ${c}.`], [ageA + 1, 'Check each clue again.']],
    teach: ['How do you solve a puzzle with several clues?', 'Use what you know for sure to work out the next fact.', 'Guess and stop.', 'Use only the last clue.'],
    scene: cardScene(ctx.theme.scene, [{ emoji: '🧒', label: c }, { emoji: '👧', label: b }, { emoji: '🧑', label: a }]),
  });
};

const SOLIDS = [
  { name: 'cube', faces: 6, edges: 12, corners: 8 },
  { name: 'square pyramid', faces: 5, edges: 8, corners: 5 },
  { name: 'triangular prism', faces: 5, edges: 9, corners: 6 },
  { name: 'triangular pyramid', faces: 4, edges: 6, corners: 4 },
] as const;

const spatial: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  if (g <= 3) {
    const top = rng.int(1, 6);
    return problem(ctx, {
      name: 'Dice Secret',
      intro: say(lead(ctx), `On a dice, the dots on opposite faces always add up to 7. The top face shows ${top} ${top === 1 ? 'dot' : 'dots'}.`),
      q: 'How many dots are on the bottom face?',
      a: 7 - top,
      unit: 'dots',
      h: ['The top and the bottom are opposite faces.', 'Find the number that makes seven together with the top.'],
      steps: ['Top and bottom add up to 7.', `${top} + ? = 7.`, `7 − ${top} = ${7 - top}.`],
      why: `Opposite faces total 7, and ${top} + ${7 - top} = 7.`,
      wrong: [[top, 'Opposite faces show different numbers.'], [7, 'Seven is the total of both faces.'], [7 - top === 6 ? 5 : 7 - top + 1, 'Check the total again.']],
      teach: ['What do opposite faces of a dice add up to?', 'Seven.', 'Six.', 'Twelve.'],
      fun: 'People have played with dice for more than 4,000 years.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '🎲', scale: 1.4 }, { text: `top: ${top}` }]),
    });
  }
  if (g <= 6) {
    const solid = rng.pick(g === 4 ? SOLIDS.slice(0, 2) : SOLIDS);
    const what = rng.pick(['faces', 'edges', 'corners'] as const);
    return problem(ctx, {
      name: 'Solid Shapes',
      intro: say(lead(ctx), `Picture a ${solid.name} in your mind and turn it around.`),
      q: `How many ${what} does a ${solid.name} have?`,
      a: solid[what],
      unit: what,
      h: [what === 'faces' ? 'Faces are the flat sides. Remember the bottom.' : what === 'edges' ? 'Edges are the lines where two faces meet.' : 'Corners are the points where edges meet.', 'Count the ones on the bottom first, then the rest.'],
      steps: [`Imagine the ${solid.name} standing on a table.`, `Count its ${what} in an organized way.`, `There are ${solid[what]}.`],
      why: `A ${solid.name} has ${solid.faces} faces, ${solid.edges} edges and ${solid.corners} corners.`,
      wrong: [[solid[what] - 1, what === 'faces' ? 'Remember the face on the bottom.' : 'One is hidden at the back.'], [what === 'edges' ? solid.faces : solid.edges, 'That counts a different part of the solid.'], [solid[what] + 2, 'Some were counted twice.']],
      teach: ['What is an edge of a solid?', 'A line where two faces meet.', 'A flat side.', 'A pointy corner.'],
      scene: cardScene(ctx.theme.scene, [{ emoji: '🧊', scale: 1.3 }, { text: solid.name }]),
    });
  }
  const [l, w, h] = [rng.int(3, 5), rng.int(3, 4), rng.int(3, 4)];
  const inner = (l - 2) * (w - 2) * (h - 2);
  return problem(ctx, {
    name: 'Painted Block',
    intro: say(lead(ctx), `A block made of ${l} × ${w} × ${h} small cubes is dipped in paint, so its whole outside is painted.`),
    q: 'How many small cubes have no paint on them at all?',
    a: inner,
    unit: 'cubes',
    h: ['Only the cubes hidden inside stay clean.', 'Peel one layer off every side and see what block is left.'],
    steps: [`Removing the outer layer takes 2 off each measurement.`, `The inside block is ${l - 2} × ${w - 2} × ${h - 2}.`, `That is ${inner} ${inner === 1 ? 'cube' : 'cubes'}.`],
    why: `The unpainted cubes form an inner block of ${l - 2} × ${w - 2} × ${h - 2} = ${inner}.`,
    wrong: [[l * w * h, 'That is every cube, painted or not.'], [l * w * h - inner, 'That is the number of painted cubes.'], [(l - 1) * (w - 1) * (h - 1), 'A layer comes off both ends of each measurement.']],
    teach: ['Which cubes of a painted block stay unpainted?', 'The ones completely inside.', 'The ones at the corners.', 'The ones on top.'],
    scene: cardScene(ctx.theme.scene, [{ emoji: '🧊', scale: 1.3 }, { text: `${l} × ${w} × ${h}` }]),
  });
};

// ---------------------------------------------------------------------------
// Engineering
// ---------------------------------------------------------------------------

const budget: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  const part = rng.pick([['wheels', '⚙️'], ['beams', '🏗️'], ['bolts', '🔩'], ['panels', '🧱']] as const);
  const n = rng.int(2, g <= 3 ? 5 : 9);
  const cost = rng.int(2, g <= 3 ? 5 : g <= 6 ? 12 : 25);
  const left = rng.int(1, g <= 3 ? 9 : 30);
  const total = n * cost + left;
  const simple = g <= 3;
  return problem(ctx, {
    name: 'Build Budget',
    intro: say(lead(ctx), simple ? `You have ${total} coins. You buy ${part[0]} for ${n * cost} coins.` : `You have ${total} coins for a build. You need ${n} ${part[0]} that cost ${cost} coins each.`),
    q: 'How many coins are left?',
    a: left,
    unit: 'coins',
    h: [simple ? 'Money you spend is taken away.' : 'First find the cost of all the parts.', 'Subtract what you spend from what you have.'],
    steps: simple ? [`${total} − ${n * cost} = ${left}.`, `${left} coins are left.`] : [`${n} × ${cost} = ${n * cost} coins for the ${part[0]}.`, `${total} − ${n * cost} = ${left}.`],
    why: `The ${part[0]} cost ${n * cost} coins, and ${total} − ${n * cost} = ${left}.`,
    wrong: [[n * cost, 'That is what you spend, not what is left.'], [total - cost, simple ? 'Check the subtraction.' : `You need ${n} of them, not one.`], [total + n * cost, 'Spending makes the amount smaller.']],
    teach: ['What is a budget?', 'A limit on how much you can spend.', 'A kind of tool.', 'The name of the design.'],
    fun: 'Engineers almost always have to work within a budget.',
    scene: cardScene(ctx.theme.scene, [{ emoji: part[1], scale: 1.2 }, { emoji: '💰' }, { text: `${total} coins` }]),
  });
};

const machines: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 5) return null;
  if (g <= 6 || rng.chance(0.4)) {
    const small = rng.pick([8, 10, 12]);
    const ratio = rng.int(2, 5);
    return problem(ctx, {
      name: 'Gear Train',
      intro: say(lead(ctx), `A big gear with ${small * ratio} teeth turns a small gear with ${small} teeth.`),
      q: 'How many times does the small gear turn when the big gear turns once?',
      a: ratio,
      unit: 'turns',
      h: ['Every tooth of the big gear pushes one tooth of the small gear.', 'Find how many times the small tooth count fits into the big one.'],
      steps: [`One turn of the big gear moves ${small * ratio} teeth.`, `${small * ratio} ÷ ${small} = ${ratio}.`],
      why: `The small gear must turn ${ratio} times to keep up with ${small * ratio} teeth.`,
      wrong: [[1, 'The small gear has fewer teeth, so it spins faster.'], [small * ratio - small, 'Divide the tooth counts.'], [ratio + 1, 'Check the division.']],
      teach: ['Which gear turns faster when two gears mesh?', 'The smaller one.', 'The bigger one.', 'They always turn at the same speed.'],
      fun: 'Bicycles use gears to make pedaling uphill easier.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '⚙️', scale: 1.5, label: `${small * ratio} teeth` }, { emoji: '⚙️', scale: 0.8, label: `${small} teeth` }]),
    });
  }
  const w2 = rng.int(2, 6) * 10;
  const d2 = rng.int(1, 3);
  const d1 = d2 * rng.int(2, 3);
  const w1 = (w2 * d2) / d1;
  if (!Number.isInteger(w1)) return null;
  return problem(ctx, {
    name: 'Lever Balance',
    intro: say(lead(ctx), `A lever balances when weight × distance is the same on both sides. A ${w2} kg crate sits ${d2} m from the pivot.`),
    q: `How many kilograms balance it from ${d1} m away on the other side?`,
    a: w1,
    unit: 'kg',
    h: ['Work out weight times distance for the side you know.', 'The other side must give the same product.'],
    steps: [`Known side: ${w2} × ${d2} = ${w2 * d2}.`, `Other side: weight × ${d1} = ${w2 * d2}.`, `${w2 * d2} ÷ ${d1} = ${w1}.`],
    why: `${w1} × ${d1} = ${w2 * d2}, the same as ${w2} × ${d2}, so the lever balances.`,
    wrong: [[w2, 'Farther from the pivot, less weight is needed.'], [w2 * d2, 'Divide by the distance on the other side.'], [w2 * d1, 'More distance means less weight, not more.']],
    teach: ['Why can a small weight balance a big one on a lever?', 'It sits farther from the pivot.', 'It is made of metal.', 'Levers ignore weight.'],
    fun: 'A seesaw, a crowbar and a pair of scissors are all levers.',
    scene: cardScene(ctx.theme.scene, [{ emoji: '⚖️', scale: 1.4 }, { text: `${w2} kg at ${d2} m` }]),
  });
};

const trials: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  if (g <= 4) {
    const first = rng.int(3, 12);
    const more = rng.int(2, 9);
    return problem(ctx, {
      name: 'Test and Improve',
      intro: say(lead(ctx), `Your first tower held ${first} books. After you made the base wider, it held ${first + more} books.`),
      q: 'How many more books did the new tower hold?',
      a: more,
      unit: 'books',
      h: ['Compare the two test results.', 'Find the difference between them.'],
      steps: [`New result: ${first + more}. Old result: ${first}.`, `${first + more} − ${first} = ${more}.`],
      why: `The improvement is the difference: ${first + more} − ${first} = ${more} books.`,
      wrong: [[first + more, 'That is the new result, not the improvement.'], [first + first + more, 'Find the difference, not the total.'], [first, 'That is the old result.']],
      teach: ['Why do engineers test a design again after changing it?', 'To see whether the change made it better.', 'To use up materials.', 'Because the first test never counts.'],
      fun: 'Engineers often test dozens of versions before a design works well.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '📚', label: `${first}` }, { emoji: '📚', scale: 1.3, label: `${first + more}` }, { emoji: '🏗️' }]),
    });
  }
  const mean = rng.int(12, 40);
  const [d1, d2] = [rng.int(1, 5), rng.int(1, 5)];
  const values = [mean - d1, mean + d1 + d2, mean - d2];
  return problem(ctx, {
    name: 'Fair Test',
    intro: say(lead(ctx), `A paper plane is tested three times. It flies ${values.join(' m, ')} m.`),
    q: 'What is the mean distance in meters?',
    a: mean,
    unit: 'm',
    h: ['One test can be lucky or unlucky, so engineers average several.', 'Add the three distances, then divide by three.'],
    steps: [`${values.join(' + ')} = ${mean * 3}.`, `${mean * 3} ÷ 3 = ${mean}.`],
    why: `The three flights total ${mean * 3} m, and ${mean * 3} ÷ 3 = ${mean} m.`,
    wrong: [[mean * 3, 'That is the total. Divide it by the number of tests.'], [Math.max(...values), 'That is the best flight, not the mean.'], [Math.min(...values), 'That is the shortest flight.']],
    teach: ['Why repeat a test several times?', 'One result could be a fluke.', 'To make the test longer.', 'The first test is always wrong.'],
    scene: cardScene(ctx.theme.scene, [{ emoji: '✈️', scale: 1.2 }, { text: `${values.join(', ')} m` }]),
  });
};

const models: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 4) return null;
  const scale = rng.pick(g <= 6 ? [2, 5, 10] : [20, 50, 100]);
  const cm = rng.int(3, 12);
  const big = g >= 7;
  return problem(ctx, {
    name: 'Scale Plan',
    intro: say(lead(ctx), big ? `A model is built at a scale of 1 to ${scale}. A part of the model is ${cm} cm long.` : `On a building plan, 1 cm stands for ${scale} m. A wall is ${cm} cm long on the plan.`),
    q: big ? 'How many centimeters long is the real part?' : 'How many meters long is the real wall?',
    a: cm * scale,
    unit: big ? 'cm' : 'm',
    h: ['The scale tells how many times bigger the real thing is.', 'Multiply the length on the plan by the scale number.'],
    steps: [`Scale: 1 to ${scale}.`, `${cm} × ${scale} = ${cm * scale}.`],
    why: `Every centimeter on the ${big ? 'model' : 'plan'} stands for ${scale} ${big ? 'cm' : 'm'}, so the real length is ${cm * scale}.`,
    wrong: [[cm + scale, 'Scale works by multiplying.'], [cm, 'The real thing is bigger than the drawing.'], [scale, 'That is the scale, not the length.']],
    teach: ['What does the scale of a plan tell you?', 'How drawing lengths compare with real lengths.', 'How heavy the building is.', 'Who drew the plan.'],
    fun: 'Architects build small scale models before a real building is made.',
    scene: cardScene(ctx.theme.scene, [{ emoji: '📐', scale: 1.2 }, { text: `1 : ${scale}` }, { emoji: '🏠' }]),
  });
};

const energySystems: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 4) return null;
  if (g <= 7) {
    const each = rng.pick([5, 10, 20, 25]);
    const n = rng.int(3, 9);
    return problem(ctx, {
      name: 'Solar Power',
      intro: say(lead(ctx), `One solar panel makes ${each} watts in bright sun. A water pump needs ${each * n} watts.`),
      q: 'How many panels does the pump need?',
      a: n,
      unit: 'panels',
      h: ['Each panel adds the same amount of power.', 'Find how many panel-sized amounts fit into what the pump needs.'],
      steps: [`Need: ${each * n} watts. One panel: ${each} watts.`, `${each * n} ÷ ${each} = ${n}.`],
      why: `${n} panels × ${each} watts = ${each * n} watts, exactly what the pump needs.`,
      wrong: [[each * n - each, 'Divide the power needed by the power of one panel.'], [n - 1, 'That would not give quite enough power.'], [each, 'That is the power of one panel.']],
      teach: ['What does a solar panel do?', 'It turns sunlight into electricity.', 'It stores water.', 'It makes sunlight.'],
      fun: 'In about one hour, more energy from the Sun reaches Earth than all people use in a year.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '☀️' }, { emoji: '🔋', scale: 1.2 }, { text: `${each} W each` }]),
    });
  }
  const input = rng.pick([200, 400, 500, 800]);
  const pct = rng.pick([25, 40, 50, 60, 75, 80]);
  const useful = (input * pct) / 100;
  return problem(ctx, {
    name: 'Efficiency',
    intro: say(lead(ctx), `A motor takes in ${input} joules of electrical energy and turns ${useful} joules into useful motion. The rest becomes heat.`),
    q: 'What is the efficiency of the motor, in percent?',
    a: pct,
    unit: '%',
    h: ['Efficiency compares the useful energy out with the total energy in.', 'Divide useful by total, then multiply by one hundred.'],
    steps: [`${useful} ÷ ${input} = ${tidy(useful / input)}.`, `${tidy(useful / input)} × 100 = ${pct}.`],
    why: `Efficiency = useful output ÷ input = ${useful} ÷ ${input} = ${pct}%.`,
    wrong: [[100 - pct, 'That is the share that is wasted as heat.'], [input - useful > 100 ? pct + 10 : input - useful, 'Efficiency is a ratio, not a difference.'], [pct === 50 ? 20 : 50, 'Divide useful energy by total energy.']],
    teach: ['Why is no machine 100% efficient?', 'Some energy always spreads out as heat.', 'Machines destroy energy.', 'Machines are lazy.'],
    scene: cardScene(ctx.theme.scene, [{ emoji: '⚡' }, { emoji: '⚙️', scale: 1.2 }, { text: `${input} J in, ${useful} J out` }]),
  });
};

const truss: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 4) return null;
  const n = rng.int(3, g <= 6 ? 6 : 12);
  return problem(ctx, {
    name: 'Truss Builder',
    intro: say(lead(ctx), 'A bridge truss is a row of triangles made of straws. The first triangle needs 3 straws. Each extra triangle shares one side, so it needs only 2 more.'),
    q: `How many straws make a row of ${n} triangles?`,
    a: 2 * n + 1,
    unit: 'straws',
    h: ['Draw the first few triangles and count the straws.', 'After the first triangle, each new one adds the same number of straws.'],
    steps: ['First triangle: 3 straws.', `${n - 1} more triangles: ${n - 1} × 2 = ${2 * (n - 1)} straws.`, `3 + ${2 * (n - 1)} = ${2 * n + 1}.`],
    why: `Sharing sides saves straws: 3 + 2 × ${n - 1} = ${2 * n + 1}.`,
    wrong: [[3 * n, 'Neighboring triangles share a side.'], [2 * n, 'The first triangle needs one extra straw.'], [2 * n + 3, 'Count the first triangle only once.']],
    teach: ['Why do bridges use triangles?', 'A triangle keeps its shape when pushed.', 'Triangles are the cheapest shape.', 'Triangles look nice.'],
    fun: 'A triangle is the only straw shape that cannot be squashed without bending a side.',
    scene: cardScene(ctx.theme.scene, [{ shape: 'triangle', color: '#f97316' }, { shape: 'triangle', color: '#3b82f6', rotation: 180 }, { shape: 'triangle', color: '#f97316' }]),
  });
};

// ---------------------------------------------------------------------------
// Science
// ---------------------------------------------------------------------------

const LEGS = [
  ['bird', 'birds', '🐦', 2],
  ['cat', 'cats', '🐱', 4],
  ['dog', 'dogs', '🐶', 4],
  ['bee', 'bees', '🐝', 6],
  ['ant', 'ants', '🐜', 6],
  ['spider', 'spiders', '🕷️', 8],
] as const;

const legs: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g > 6) return null;
  const [one, many, emoji, count] = rng.pick(g <= 1 ? LEGS.slice(0, 3) : LEGS);
  if (g <= 1) {
    return problem(ctx, {
      name: 'Animal Legs',
      intro: `Look at the ${one}.`,
      q: `How many legs does a ${one} have?`,
      a: count,
      h: ['Think of a real one walking.', 'Count the legs on both sides.'],
      steps: [`Picture a ${one}.`, `It walks on ${count} legs.`],
      why: `A ${one} has ${count} legs.`,
      wrong: [[count + 2, 'That is too many legs.'], [count === 2 ? 1 : count - 2, 'That is too few legs.']],
      teach: ['Why do animals have legs?', 'To move around.', 'To see better.', 'To hear better.'],
      scene: cardScene(ctx.theme.scene, [{ emoji, scale: 1.5 }]),
    });
  }
  const n = rng.int(2, g <= 3 ? 4 : 9);
  return problem(ctx, {
    name: 'Leg Count',
    intro: say(lead(ctx), `${count === 6 ? 'Every insect has 6 legs.' : count === 8 ? 'Every spider has 8 legs.' : `A ${one} has ${count} legs.`} A scientist is watching ${n} ${many}.`),
    q: `How many legs do the ${n} ${many} have altogether?`,
    a: n * count,
    unit: 'legs',
    h: ['Every animal of this kind has the same number of legs.', 'Add the legs once for each animal, or multiply.'],
    steps: [`One ${one}: ${count} legs.`, `${n} ${many}: ${n} × ${count} = ${n * count}.`],
    why: `${n} groups of ${count} legs make ${n * count} legs.`,
    wrong: [[n + count, 'Each animal has its own set of legs, so multiply.'], [count, 'That is only one animal.'], [n * count + count, 'That is one animal too many.']],
    teach: ['How can you tell an insect from a spider?', 'An insect has 6 legs and a spider has 8.', 'Insects are always bigger.', 'Spiders can fly.'],
    fun: 'Spiders are not insects. They belong to a group called arachnids.',
    scene: thingScene(ctx, [{ emoji, count: n }]),
  });
};

const motion: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 4) return null;
  if (g <= 7) {
    const speed = rng.int(2, 12) * (g <= 5 ? 1 : 5);
    const time = rng.int(2, 9);
    const findSpeed = g >= 6 && rng.chance(0.5);
    return problem(ctx, {
      name: 'Speed Check',
      intro: say(lead(ctx), findSpeed ? `A rover travels ${speed * time} meters in ${time} seconds at a steady speed.` : `A rover rolls at a steady ${speed} meters every second.`),
      q: findSpeed ? 'How many meters does it travel each second?' : `How many meters does it travel in ${time} seconds?`,
      a: findSpeed ? speed : speed * time,
      unit: 'm',
      h: [findSpeed ? 'Speed tells the distance for one unit of time.' : 'A steady speed means the same distance every second.', findSpeed ? 'Divide the distance by the time.' : 'Multiply the speed by the time.'],
      steps: findSpeed ? ['Speed = distance ÷ time.', `${speed * time} ÷ ${time} = ${speed}.`] : ['Distance = speed × time.', `${speed} × ${time} = ${speed * time}.`],
      why: findSpeed ? `${speed * time} meters shared over ${time} seconds is ${speed} meters each second.` : `${speed} meters each second for ${time} seconds is ${speed * time} meters.`,
      wrong: [[speed + time, 'Speed and time are multiplied or divided, not added.'], [findSpeed ? speed * time : speed, 'That number is already in the question.'], [findSpeed ? speed + 1 : speed * time + speed, 'Check the calculation.']],
      teach: ['What does speed tell you?', 'How far something moves in a certain time.', 'How heavy something is.', 'How big something is.'],
      fun: 'A cheetah can sprint about 30 meters in one second.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '🚙', scale: 1.2 }, { emoji: '⏱️' }, { text: findSpeed ? `${speed * time} m in ${time} s` : `${speed} m each second` }]),
    });
  }
  const mass = rng.int(2, 12);
  const acc = rng.int(2, 9);
  return problem(ctx, {
    name: 'Force Finder',
    intro: say(lead(ctx), `Force equals mass times acceleration. A cart with a mass of ${mass} kg speeds up at ${acc} meters per second squared.`),
    q: 'How many newtons of force are pushing it?',
    a: mass * acc,
    unit: 'N',
    h: ['Use the second law of motion.', 'Multiply the mass by the acceleration.'],
    steps: ['F = m × a.', `${mass} × ${acc} = ${mass * acc}.`],
    why: `Force = mass × acceleration = ${mass} × ${acc} = ${mass * acc} newtons.`,
    wrong: [[mass + acc, 'Multiply mass and acceleration.'], [mass, 'That is the mass alone.'], [mass * acc * 2, 'There is no doubling in the formula.']],
    teach: ['What happens when you push a heavier cart with the same force?', 'It speeds up less.', 'It speeds up more.', 'Nothing changes.'],
    fun: 'The unit of force, the newton, is named after Isaac Newton.',
    scene: cardScene(ctx.theme.scene, [{ emoji: '🛒', scale: 1.2 }, { text: `${mass} kg` }, { emoji: '➡️' }]),
  });
};

const temperature: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  if (g <= 6) {
    const low = rng.int(2, 15);
    const rise = rng.int(3, 12);
    return problem(ctx, {
      name: 'Weather Watch',
      intro: say(lead(ctx), `In the morning it was ${low}°C. By the afternoon it was ${low + rise}°C.`),
      q: 'How many degrees warmer did it get?',
      a: rise,
      unit: '°',
      h: ['Compare the two thermometer readings.', 'Subtract the morning reading from the afternoon reading.'],
      steps: [`Afternoon: ${low + rise}. Morning: ${low}.`, `${low + rise} − ${low} = ${rise}.`],
      why: `The temperature rose from ${low}°C to ${low + rise}°C, a change of ${rise} degrees.`,
      wrong: [[low + rise, 'That is the afternoon temperature.'], [low + low + rise, 'Find the difference, not the total.'], [low, 'That is the morning temperature.']],
      teach: ['What does a thermometer measure?', 'How hot or cold something is.', 'How fast the wind blows.', 'How much rain fell.'],
      fun: 'Water freezes at 0°C and boils at 100°C at sea level.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '🌡️', label: `${low}°C` }, { emoji: '☀️' }, { emoji: '🌡️', scale: 1.2, label: `${low + rise}°C` }]),
    });
  }
  const below = rng.int(2, 12);
  const above = rng.int(1, 12);
  return problem(ctx, {
    name: 'Weather Watch',
    intro: say(lead(ctx), `At night the temperature was ${below} degrees below zero. By noon it was ${above}°C above zero.`),
    q: 'By how many degrees did the temperature rise?',
    a: below + above,
    unit: '°',
    h: ['Picture a thermometer as a number line with zero in the middle.', 'Count the steps up to zero, then the steps above zero.'],
    steps: [`From ${below} below zero up to zero is ${below} degrees.`, `From zero up to ${above} is ${above} more.`, `${below} + ${above} = ${below + above}.`],
    why: `The distance from -${below} to ${above} on the number line is ${below} + ${above} = ${below + above} degrees.`,
    wrong: [[Math.abs(above - below) || 1, 'The readings are on opposite sides of zero, so add the distances.'], [above, 'Do not forget the part below zero.'], [below, 'Do not forget the part above zero.']],
    teach: ['How do you find the change between a temperature below zero and one above zero?', 'Add the distance to zero on each side.', 'Subtract the smaller number.', 'Ignore the part below zero.'],
    scene: cardScene(ctx.theme.scene, [{ emoji: '🌙', label: `${below} below zero` }, { emoji: '🌡️', scale: 1.2 }, { emoji: '☀️', label: `${above}°C` }]),
  });
};

const cells: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 4) return null;
  if (g >= 8 && rng.chance(0.5)) {
    return problem(ctx, {
      name: 'Punnett Square',
      intro: say(lead(ctx), 'A pea plant with the genes T t is crossed with a plant with the genes t t. A Punnett square for the cross has 4 boxes.'),
      q: 'How many of the 4 boxes show t t?',
      a: 2,
      unit: 'boxes',
      h: ['Each box gets one gene from each parent.', 'Fill in the square, then count the boxes that match.'],
      steps: ['The first parent can pass on T or t.', 'The second parent always passes on t.', 'The boxes read: T t, T t, t t, t t.'],
      why: 'Half of the boxes get the small t from the first parent, so they show t t.',
      wrong: [[4, 'Some boxes get the big T from the first parent.'], [1, 'Fill in every box of the square.'], [0, 'The first parent can pass on a small t.']],
      teach: ['What does a Punnett square show?', 'The possible gene pairs of the offspring.', 'The age of a plant.', 'How tall a plant is right now.'],
      fun: 'Gregor Mendel discovered the rules of heredity by growing pea plants.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '🌱', label: 'T t' }, { emoji: '✖️' }, { emoji: '🌱', label: 't t' }]),
    });
  }
  const rounds = rng.int(3, g <= 5 ? 4 : 7);
  return problem(ctx, {
    name: 'Cell Division',
    intro: say(lead(ctx), `One cell splits into two cells. Then every cell splits again, and so on, for ${rounds} rounds in all.`),
    q: `How many cells are there after ${rounds} rounds?`,
    a: 2 ** rounds,
    unit: 'cells',
    h: ['The number of cells doubles in every round.', 'Start at one and keep doubling, once for each round.'],
    steps: [`Doubling: ${range(1, rounds).map((i) => 2 ** i).join(', ')}.`, `After ${rounds} rounds there are ${2 ** rounds} cells.`],
    why: `Doubling ${rounds} times from one cell gives ${2 ** rounds} cells.`,
    wrong: [[2 * rounds, 'Doubling is not the same as adding two each time.'], [2 ** (rounds - 1), 'That is one round too few.'], [2 ** (rounds + 1), 'That is one round too many.']],
    teach: ['How do living things grow?', 'Their cells divide to make more cells.', 'Their cells swell like balloons.', 'They collect cells from food.'],
    fun: 'Your body is made of trillions of cells.',
    scene: cardScene(ctx.theme.scene, [{ emoji: '🦠' }, { emoji: '➡️' }, { emoji: '🦠' }, { emoji: '🦠' }]),
  });
};

const matter: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 4) return null;
  if (g <= 6) {
    const temp = rng.int(4, 18) * 5;
    return problem(ctx, {
      name: 'Boiling Point',
      intro: say(lead(ctx), `At sea level, water boils at 100°C. A pot of water is at ${temp}°C.`),
      q: 'How many more degrees until it boils?',
      a: 100 - temp,
      unit: '°',
      h: ['Compare the temperature now with the boiling point.', 'Find the difference between the two.'],
      steps: ['The boiling point is 100°C.', `100 − ${temp} = ${100 - temp}.`],
      why: `The water must warm up from ${temp}°C to 100°C, which is ${100 - temp} degrees.`,
      wrong: [[100 + temp, 'Find the difference, not the sum.'], [temp, 'That is the temperature now.'], [100, 'That is the boiling point itself.']],
      teach: ['What happens to water when it boils?', 'It turns into a gas called water vapor.', 'It turns into ice.', 'It disappears forever.'],
      fun: 'On a high mountain, water boils at a lower temperature than at sea level.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '🍲', scale: 1.2 }, { emoji: '🌡️', label: `${temp}°C` }, { emoji: '🔥' }]),
    });
  }
  const density = rng.pick([2, 3, 4, 5, 8]);
  const volume = rng.int(2, 12);
  return problem(ctx, {
    name: 'Density Lab',
    intro: say(lead(ctx), `Density is mass divided by volume. A metal block has a mass of ${density * volume} g and a volume of ${volume} cubic centimeters.`),
    q: 'What is its density, in grams per cubic centimeter?',
    a: density,
    h: ['Density tells how much mass is packed into each unit of volume.', 'Divide the mass by the volume.'],
    steps: ['Density = mass ÷ volume.', `${density * volume} ÷ ${volume} = ${density}.`],
    why: `${density * volume} g ÷ ${volume} cubic centimeters = ${density} grams per cubic centimeter.`,
    wrong: [[density * volume * volume, 'Divide mass by volume instead of multiplying.'], [density * volume - volume, 'Density is a division.'], [density * volume, 'That is the mass.']],
    teach: ['Why does a steel ball sink in water?', 'Steel is denser than water.', 'Steel is shiny.', 'Water pushes it down.'],
    fun: 'Ice floats because it is less dense than liquid water.',
    scene: cardScene(ctx.theme.scene, [{ emoji: '⚖️', scale: 1.2 }, { text: `${density * volume} g` }, { emoji: '🧊' }]),
  });
};

const waves: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 4) return null;
  if (g <= 6) {
    const secs = rng.int(2, 6);
    return problem(ctx, {
      name: 'Thunder Timer',
      intro: say(lead(ctx), `Sound travels about 340 meters every second in air. You hear thunder ${secs} seconds after you see the lightning.`),
      q: 'About how many meters away was the lightning?',
      a: 340 * secs,
      unit: 'm',
      h: ['The sound traveled the same distance every second.', 'Multiply the distance for one second by the number of seconds.'],
      steps: ['Distance = speed × time.', `340 × ${secs} = ${340 * secs}.`],
      why: `Sound covers about 340 meters each second, so in ${secs} seconds it travels ${340 * secs} meters.`,
      wrong: [[340 + secs, 'Multiply the speed by the time.'], [340, 'That is the distance for one second only.'], [340 * secs + 340, 'That is one second too many.']],
      teach: ['Why do you see lightning before you hear thunder?', 'Light travels much faster than sound.', 'Thunder starts later.', 'Ears are slower than eyes.'],
      fun: 'Light is nearly a million times faster than sound in air.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '⚡', scale: 1.2 }, { emoji: '☁️' }, { emoji: '👂' }]),
    });
  }
  const freq = rng.int(2, 9);
  const length = rng.int(2, 8);
  return problem(ctx, {
    name: 'Wave Speed',
    intro: say(lead(ctx), `Wave speed equals frequency times wavelength. A water wave has a frequency of ${freq} waves per second and a wavelength of ${length} meters.`),
    q: 'How many meters does the wave travel each second?',
    a: freq * length,
    unit: 'm',
    h: ['Each wave that passes moves the pattern forward by one wavelength.', 'Multiply the frequency by the wavelength.'],
    steps: ['Speed = frequency × wavelength.', `${freq} × ${length} = ${freq * length}.`],
    why: `${freq} waves pass each second, and each is ${length} meters long, so the wave moves ${freq * length} meters per second.`,
    wrong: [[freq + length, 'Multiply frequency and wavelength.'], [length, 'That is the length of one wave.'], [freq, 'That is the frequency.']],
    teach: ['What is the wavelength of a wave?', 'The distance from one crest to the next.', 'The height of the wave.', 'How long the wave lasts.'],
    fun: 'Sound, light and ocean waves all carry energy from place to place.',
    scene: cardScene(ctx.theme.scene, [{ emoji: '🌊' }, { emoji: '🌊' }, { emoji: '🌊' }]),
  });
};

const ecosystems: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  if (g <= 6) {
    const owls = rng.int(2, g <= 3 ? 4 : 8);
    const mice = rng.int(2, g <= 3 ? 3 : 6);
    return problem(ctx, {
      name: 'Food Chain',
      intro: say(lead(ctx), `In a forest, each owl catches ${mice} mice every night. ${owls} owls live there.`),
      q: 'How many mice do the owls catch in one night altogether?',
      a: owls * mice,
      unit: 'mice',
      h: ['Every owl catches the same number.', 'Add that number once for each owl, or multiply.'],
      steps: [`One owl: ${mice} mice.`, `${owls} owls: ${owls} × ${mice} = ${owls * mice}.`],
      why: `${owls} owls catching ${mice} mice each makes ${owls * mice} mice.`,
      wrong: [[owls + mice, 'Each owl catches its own mice, so multiply.'], [mice, 'That is only one owl.'], [owls * mice + mice, 'That is one owl too many.']],
      teach: ['What is a food chain?', 'It shows who eats whom.', 'A chain made of food.', 'A list of shops.'],
      fun: 'An owl can turn its head most of the way around.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '🦉', scale: 1.2 }, { emoji: '🐭' }, { emoji: '🌾' }]),
    });
  }
  const plants = rng.pick([1000, 2000, 5000, 10000]);
  const level = rng.int(1, 2);
  const result = plants / 10 ** level;
  return problem(ctx, {
    name: 'Energy Pyramid',
    intro: say(lead(ctx), `In an energy pyramid, only about one tenth of the energy passes from one level to the next. The plants store ${plants} units of energy.`),
    q: level === 1 ? 'About how many units reach the plant-eaters?' : 'About how many units reach the animals that eat the plant-eaters?',
    a: result,
    unit: 'units',
    h: ['Each step up the pyramid keeps only a small share of the energy.', level === 1 ? 'Divide by ten once.' : 'Divide by ten once for each step up.'],
    steps: level === 1 ? [`${plants} ÷ 10 = ${result}.`, `About ${result} units reach the plant-eaters.`] : [`Plant-eaters: ${plants} ÷ 10 = ${plants / 10}.`, `Their predators: ${plants / 10} ÷ 10 = ${result}.`],
    why: `One tenth passes on at each step, so ${result} units arrive ${level === 1 ? 'one level' : 'two levels'} up.`,
    wrong: [[level === 1 ? plants / 100 : plants / 10, 'Count the steps up the pyramid again.'], [plants - 10, 'One tenth means dividing by ten.'], [plants, 'Most of the energy is used up or lost as heat along the way.']],
    teach: ['Why are there fewer predators than plants in an ecosystem?', 'Less energy is available at each higher level.', 'Predators hide better.', 'Plants are smaller.'],
    scene: cardScene(ctx.theme.scene, [{ emoji: '🌿', label: `${plants}` }, { emoji: '🐇' }, { emoji: '🦊' }]),
  });
};

const space: ProblemMaker = (ctx) => {
  const { rng, g } = ctx;
  if (g < 2) return null;
  if (g <= 4) {
    const weeks = rng.int(2, g === 2 ? 3 : 8);
    return problem(ctx, {
      name: 'Day Counter',
      intro: say(lead(ctx), `Earth spins around once every day. A space mission lasts ${weeks} weeks, and a week has 7 days.`),
      q: 'How many times does Earth spin during the mission?',
      a: weeks * 7,
      unit: 'times',
      h: ['One spin of Earth is one day.', 'Count seven days for every week.'],
      steps: ['One week is 7 days, so 7 spins.', `${weeks} weeks: ${weeks} × 7 = ${weeks * 7}.`],
      why: `Earth spins once each day, and ${weeks} weeks have ${weeks * 7} days.`,
      wrong: [[weeks, 'Earth spins once a day, not once a week.'], [weeks + 7, 'Count seven days for each week.'], [weeks * 7 + 7, 'That is one week too many.']],
      teach: ['What causes day and night?', 'Earth spinning around.', 'The Sun switching off.', 'Clouds covering the sky.'],
      fun: 'Earth spins at about 1,600 kilometers per hour at the equator.',
      scene: cardScene(ctx.theme.scene, [{ emoji: '🌍', scale: 1.3 }, { emoji: '☀️' }, { emoji: '🌙' }]),
    });
  }
  const minutes = rng.int(2, 9);
  return problem(ctx, {
    name: 'Light Speed',
    intro: say(lead(ctx), `Light travels about 300,000 kilometers every second. A light signal travels through space for ${minutes} seconds.`),
    q: 'About how many kilometers does it travel?',
    a: 300000 * minutes,
    unit: 'km',
    h: ['The signal covers the same distance every second.', 'Multiply the distance for one second by the number of seconds.'],
    steps: ['Distance = speed × time.', `300,000 × ${minutes} = ${(300000 * minutes).toLocaleString('en-US')}.`],
    why: `In ${minutes} seconds light covers ${minutes} × 300,000 kilometers.`,
    wrong: [[30000 * minutes, 'Check the number of zeros.'], [300000 + minutes, 'Multiply the speed by the time.'], [300000, 'That is the distance for one second only.']],
    teach: ['Why do we see the Sun as it was about 8 minutes ago?', 'Its light needs time to reach us.', 'The Sun is slow.', 'Our eyes are slow.'],
    fun: 'Light from the Sun takes about 8 minutes to reach Earth.',
    scene: cardScene(ctx.theme.scene, [{ emoji: '🛰️' }, { emoji: '💡', scale: 1.2 }, { emoji: '🌍' }]),
  });
};

/** Problem makers by skill id. A skill without an entry is served by the knowledge sets. */
export const STEM_MAKERS: Record<string, readonly ProblemMaker[]> = {
  'technology-loops': [loops],
  'technology-variables-abstraction': [variables],
  'technology-data-representation': [dataRep],
  'technology-conditionals': [conditionals],
  'technology-debugging': [variables],
  'technology-sequencing': [loops],
  'logic-patterns': [numberPatterns],
  'logic-strategy-puzzles': [strategy],
  'logic-deduction': [deduction],
  'logic-spatial-reasoning': [spatial],
  'engineering-design-constraints': [budget],
  'engineering-simple-machines': [machines],
  'engineering-testing-improving': [trials],
  'engineering-tools-models': [models],
  'engineering-energy-systems': [energySystems],
  'engineering-structures': [truss],
  'engineering-design-process': [trials, budget],
  'science-living-things': [legs],
  'science-forces-motion': [motion],
  'science-weather-water': [temperature],
  'science-cells-heredity': [cells],
  'science-matter': [matter],
  'science-energy-waves': [waves],
  'science-ecosystems': [ecosystems],
  'science-earth-space': [space],
};
