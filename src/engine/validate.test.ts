import { describe, expect, it } from 'vitest';
import type { Challenge } from '@/core/schemas';
import { BUILD, CHOICE, makeChallenge, MATCH, NUMBER, ORDER, ROBOT, SORT, TAP, TAP_SCENE } from './testing/fixtures';
import { checkAnswer } from './check';
import { numbersInText, validateChallengeContent } from './validate';

function problemsOf(c: Challenge): string {
  return validateChallengeContent(c).join(' | ');
}

describe('validateChallengeContent: valid content', () => {
  it.each([
    ['choice', makeChallenge(CHOICE)],
    ['tap', makeChallenge(TAP, { scene: TAP_SCENE })],
    ['sort', makeChallenge(SORT)],
    ['match', makeChallenge(MATCH)],
    ['order', makeChallenge(ORDER)],
    ['number', makeChallenge(NUMBER)],
    ['robot', makeChallenge(ROBOT)],
    ['build', makeChallenge(BUILD)],
  ])('accepts a sound %s challenge', (_kind, challenge) => {
    expect(validateChallengeContent(challenge)).toEqual([]);
  });

  it('never throws on malformed content', () => {
    const broken = { ...makeChallenge(CHOICE), scene: undefined } as unknown as Challenge;
    expect(() => validateChallengeContent(broken)).not.toThrow();
    expect(validateChallengeContent(broken).length).toBeGreaterThan(0);
  });
});

describe('validateChallengeContent: scene', () => {
  it('reports duplicate object ids', () => {
    const c = makeChallenge(CHOICE, {
      scene: {
        objects: [
          { id: 'x', type: 'emoji', emoji: '🍎', x: 1, y: 1 },
          { id: 'x', type: 'emoji', emoji: '🍐', x: 2, y: 2 },
        ],
      },
    });
    expect(problemsOf(c)).toContain('scene object ids must be unique');
  });

  it('reports objects whose type lacks its field', () => {
    const c = makeChallenge(CHOICE, {
      scene: {
        objects: [
          { id: 'e', type: 'emoji', x: 1, y: 1 },
          { id: 's', type: 'shape', x: 1, y: 1 },
          { id: 't', type: 'text', x: 1, y: 1 },
          { id: 'v', type: 'svg', x: 1, y: 1 },
          { id: 'ok', type: 'shape', shape: 'star', x: 1, y: 1 },
        ],
      },
    });
    const text = problemsOf(c);
    expect(text).toContain('"e" has type emoji but no emoji');
    expect(text).toContain('"s" has type shape but no shape');
    expect(text).toContain('"t" has type text but no text');
    expect(text).toContain('"v" has type svg but no svg');
    expect(text).not.toContain('"ok"');
  });

  it('reports an svg that does not survive sanitizing and accepts a clean one', () => {
    const bad = makeChallenge(CHOICE, {
      scene: { objects: [{ id: 'v', type: 'svg', svg: '<svg><script>alert(1)</script></svg>', x: 1, y: 1 }] },
    });
    expect(problemsOf(bad)).toContain('"v" has an svg drawing that is not a single safe <svg>');
    const good = makeChallenge(CHOICE, {
      scene: {
        objects: [{ id: 'v', type: 'svg', svg: '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>', x: 1, y: 1 }],
      },
    });
    expect(validateChallengeContent(good)).toEqual([]);
  });

  it('reports a move animation with nowhere to go', () => {
    const c = makeChallenge(CHOICE, {
      scene: { objects: [{ id: 'm', type: 'emoji', emoji: '🚗', x: 1, y: 1, anim: { kind: 'move' } }] },
    });
    expect(problemsOf(c)).toContain('move animation without toX or toY');
  });
});

describe('validateChallengeContent: choice', () => {
  it('reports correct ids that are not options', () => {
    expect(problemsOf(makeChallenge({ ...CHOICE, correctIds: ['zzz'] }))).toContain('correctIds are not options: zzz');
  });
  it('reports several correct ids when multi is false', () => {
    expect(problemsOf(makeChallenge({ ...CHOICE, correctIds: ['a', 'b'] }))).toContain('multi is false');
    expect(validateChallengeContent(makeChallenge({ ...CHOICE, multi: true, correctIds: ['a', 'b'] }))).toEqual([]);
  });
  it('reports duplicate option ids and duplicate correct ids', () => {
    const c = makeChallenge({
      ...CHOICE,
      options: [...CHOICE.options, { id: 'a', label: 'Six' }],
      correctIds: ['b', 'b'],
    });
    const text = problemsOf(c);
    expect(text).toContain('choice option ids must be unique');
    expect(text).toContain('choice correctIds must be unique');
  });
  it('reports a question where every option is correct, and twin options', () => {
    expect(problemsOf(makeChallenge({ ...CHOICE, multi: true, correctIds: ['a', 'b', 'c'] }))).toContain(
      'every choice option is correct',
    );
    const twins = makeChallenge({
      ...CHOICE,
      options: [
        { id: 'a', label: 'Four' },
        { id: 'b', label: 'four ' },
        { id: 'c', label: 'Five' },
      ],
    });
    expect(problemsOf(twins)).toContain('look exactly the same');
  });
});

describe('validateChallengeContent: tap', () => {
  it('reports targets missing from the scene', () => {
    const c = makeChallenge({ kind: 'tap', targetIds: ['apple1', 'ghost'] }, { scene: TAP_SCENE });
    expect(problemsOf(c)).toContain('tap target "ghost" is not an object in the scene');
  });
  it('reports targets that are not tappable', () => {
    const c = makeChallenge({ kind: 'tap', targetIds: ['sun'] }, { scene: TAP_SCENE });
    expect(problemsOf(c)).toContain('tap target "sun" is not tappable');
  });
  it('reports duplicate target ids', () => {
    const c = makeChallenge({ kind: 'tap', targetIds: ['apple1', 'apple1'] }, { scene: TAP_SCENE });
    expect(problemsOf(c)).toContain('tap targetIds must be unique');
  });
});

describe('validateChallengeContent: tap targets a child cannot tell apart', () => {
  const apple = (id: string, patch: Record<string, unknown> = {}) => ({ id, type: 'emoji', emoji: '🍎', x: 10, y: 50, size: 10, tappable: true, ...patch });
  const apples = (patches: Record<string, unknown>[]) => ({ theme: 'farm', objects: patches.map((patch, index) => apple(`a${index + 1}`, { x: 10 + index * 15, ...patch })) });

  it('reports a target that looks exactly like a tappable object that is not a target', () => {
    // "Tap 3 apples": five identical apples, three of them the answer. Tapping another three is marked wrong.
    const c = makeChallenge({ kind: 'tap', targetIds: ['a1', 'a2', 'a3'] }, { scene: apples([{}, {}, {}, {}, {}]) });
    expect(problemsOf(c)).toContain('looks exactly like');
    expect(checkAnswer(c.interaction, ['a3', 'a4', 'a5']).correct).toBe(false);
  });

  it('accepts look-alikes when all of them are targets, or the others cannot be tapped', () => {
    const all = makeChallenge({ kind: 'tap', targetIds: ['a1', 'a2', 'a3'] }, { scene: apples([{}, {}, {}, { emoji: '🍐' }]) });
    expect(validateChallengeContent(all)).toEqual([]);
    const decoration = makeChallenge({ kind: 'tap', targetIds: ['a1'] }, { scene: apples([{}, { tappable: false }, { emoji: '🍐' }]) });
    expect(validateChallengeContent(decoration)).toEqual([]);
  });

  it('accepts objects that differ in something a child can see', () => {
    for (const patch of [{ size: 20 }, { color: '#ff0000' }, { label: 'ripe' }, { rotation: 90 }, { emoji: '🍏' }]) {
      const c = makeChallenge({ kind: 'tap', targetIds: ['a1'] }, { scene: apples([patch, {}, {}]) });
      expect(validateChallengeContent(c), JSON.stringify(patch)).toEqual([]);
    }
  });
});

describe('validateChallengeContent: sort, match, order', () => {
  it('reports sort items that look the same but belong in different bins', () => {
    const c = makeChallenge({
      kind: 'sort',
      bins: [{ id: 'even', label: 'Even' }, { id: 'odd', label: 'Odd' }],
      items: [{ id: 'i1', label: '4', binId: 'even' }, { id: 'i2', label: '4', binId: 'odd' }, { id: 'i3', label: '7', binId: 'odd' }],
    });
    expect(problemsOf(c)).toContain('look exactly the same but belong in different bins');
    // Twins in the same bin are fine: either card may go there.
    const twins = makeChallenge({
      kind: 'sort',
      bins: [{ id: 'even', label: 'Even' }, { id: 'odd', label: 'Odd' }],
      items: [{ id: 'i1', label: '4', binId: 'even' }, { id: 'i2', label: '4', binId: 'even' }, { id: 'i3', label: '7', binId: 'odd' }],
    });
    expect(validateChallengeContent(twins)).toEqual([]);
  });

  it('reports items that point at unknown bins', () => {
    const c = makeChallenge({ ...SORT, items: [...SORT.items, { id: 'bird', label: 'Bird', binId: 'sky' }] });
    expect(problemsOf(c)).toContain('unknown bins: bird -> sky');
  });
  it('accepts an empty bin but not everything in one bin', () => {
    const threeBins = makeChallenge({ ...SORT, bins: [...SORT.bins, { id: 'sky', label: 'Sky' }] });
    expect(validateChallengeContent(threeBins)).toEqual([]);
    const oneBin = makeChallenge({ ...SORT, items: SORT.items.map((item) => ({ ...item, binId: 'water' })) });
    expect(problemsOf(oneBin)).toContain('same bin');
  });
  it('reports duplicate sort ids', () => {
    const c = makeChallenge({
      ...SORT,
      bins: [...SORT.bins, { id: 'land', label: 'Land again' }],
      items: [...SORT.items, { id: 'fish', label: 'Another fish', binId: 'water' }],
    });
    const text = problemsOf(c);
    expect(text).toContain('sort bin ids must be unique');
    expect(text).toContain('sort item ids must be unique');
  });
  it('reports duplicate match pair ids', () => {
    const c = makeChallenge({
      ...MATCH,
      pairs: [...MATCH.pairs, { id: 'p1', left: { label: 'Hen' }, right: { label: 'Chick' } }],
    });
    expect(problemsOf(c)).toContain('match pair ids must be unique');
  });
  it('reports identical left cards with different partners, but accepts identical right cards', () => {
    const sameLeft = makeChallenge({
      ...MATCH,
      pairs: [...MATCH.pairs, { id: 'p4', left: { label: 'Dog' }, right: { label: 'Bone' } }],
    });
    expect(problemsOf(sameLeft)).toContain('same left side');
    const sameRight = makeChallenge({
      kind: 'match',
      pairs: [
        { id: 'p1', left: { label: '2 + 2' }, right: { label: '4' } },
        { id: 'p2', left: { label: '1 + 3' }, right: { label: '4' } },
      ],
    });
    expect(validateChallengeContent(sameRight)).toEqual([]);
  });
  it('reports duplicate order ids and items that all look the same', () => {
    const dup = makeChallenge({ ...ORDER, items: [...ORDER.items, { id: 'o1', label: 'Again' }] });
    expect(problemsOf(dup)).toContain('order item ids must be unique');
    const same = makeChallenge({
      kind: 'order',
      items: [
        { id: 'a', label: 'x' },
        { id: 'b', label: 'x' },
        { id: 'c', label: 'x' },
      ],
    });
    expect(problemsOf(same)).toContain('nothing to arrange');
  });
});

describe('validateChallengeContent: number', () => {
  it('reports an answer that is not finite', () => {
    const c = makeChallenge(NUMBER);
    const broken: Challenge = { ...c, interaction: { ...c.interaction, answer: Number.NaN } as Challenge['interaction'] };
    expect(problemsOf(broken)).toContain('not a finite number');
    const infinite: Challenge = { ...c, interaction: { ...c.interaction, answer: Infinity } as Challenge['interaction'] };
    expect(problemsOf(infinite)).toContain('not a finite number');
  });
  it('reports hints that contain the exact answer', () => {
    const c = makeChallenge(NUMBER, { hints: ['Count the apples in each row.', 'There are 12 apples in total.'] });
    const problems = validateChallengeContent(c);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('hint 2 gives away the exact answer (12)');
  });
  it('lets a hint repeat a number that the question gives, even when it equals the answer', () => {
    const birds = { intro: 'Birds sit on a wire.', question: 'There are 8 birds on a wire. 4 fly away. How many are left?' };
    const restated = makeChallenge({ kind: 'number', answer: 4 }, { ...birds, hints: ['Do you have more or fewer now?', 'Start with 8 birds and take away 4, one at a time.'] });
    expect(validateChallengeContent(restated)).toEqual([]);
    const share = makeChallenge(
      { kind: 'number', answer: 2 },
      { question: 'Share 4 apples between 2 friends. How many does each friend get?', hints: ['Deal them out.', 'Deal the apples out to the 2 friends.'] },
    );
    expect(validateChallengeContent(share)).toEqual([]);
    // Stating it as the result is still a giveaway.
    for (const hint of ['8 - 4 = 4', 'Eight take away four leaves 4.', 'The answer is 4.', 'So 4 are left.']) {
      expect(problemsOf(makeChallenge({ kind: 'number', answer: 4 }, { ...birds, hints: ['Look again.', hint] }))).toContain('hint 2 gives away');
    }
    // And a number the question does not give is one, however it is put.
    const shells = makeChallenge(
      { kind: 'number', answer: 10 },
      { question: 'You have 7 shells and find 3 more. How many shells now?', hints: ['Count on.', 'Use a number line from 0 to 10.'] },
    );
    expect(problemsOf(shells)).toContain('hint 2 gives away the exact answer (10)');
  });
  it('does not confuse the answer with other numbers in a hint', () => {
    const c = makeChallenge(NUMBER, { hints: ['There are 3 rows of 4.', 'Try 120 minus 112, or 1.2 times 10?'] });
    expect(validateChallengeContent(c)).toEqual([]);
  });
  it('catches decimal and negative answers written in hints', () => {
    const decimal = makeChallenge(
      { kind: 'number', answer: 2.5, allowDecimal: true },
      { hints: ['Half of five.', 'It is 2.5, between two and three.'] },
    );
    expect(problemsOf(decimal)).toContain('hint 2 gives away');
    const negative = makeChallenge(
      { kind: 'number', answer: -7, allowNegative: true },
      { hints: ['It is below zero.', 'Try -7.'] },
    );
    expect(problemsOf(negative)).toContain('hint 2 gives away');
  });
  it('reports answers the keypad cannot type', () => {
    expect(problemsOf(makeChallenge({ kind: 'number', answer: -3 }))).toContain('no minus sign');
    expect(problemsOf(makeChallenge({ kind: 'number', answer: 2.5 }))).toContain('no decimal point');
    expect(validateChallengeContent(makeChallenge({ kind: 'number', answer: 2.5, tolerance: 0.5 }))).toEqual([]);
    expect(problemsOf(makeChallenge({ kind: 'number', answer: 12345678901 }))).toContain('too long');
  });
  it('reports a tolerance so wide that a wrong answer is marked right', () => {
    // Answer 12 with tolerance 100: 0 and 99 would both be correct.
    expect(problemsOf(makeChallenge({ kind: 'number', answer: 12, tolerance: 100 }))).toContain('tolerance');
    // A counting answer is exact: "7, give or take 1" marks 6 and 8 right.
    expect(problemsOf(makeChallenge({ kind: 'number', answer: 7, tolerance: 1 }))).toContain('tolerance');
    expect(problemsOf(makeChallenge({ kind: 'number', answer: 3.2, tolerance: 1, allowDecimal: true }))).toContain('tolerance');
  });
  it('accepts a small tolerance for measuring and estimating', () => {
    expect(validateChallengeContent(makeChallenge({ kind: 'number', answer: 250, tolerance: 10 }))).toEqual([]);
    expect(validateChallengeContent(makeChallenge({ kind: 'number', answer: 3.14, tolerance: 0.01, allowDecimal: true }))).toEqual([]);
    expect(validateChallengeContent(makeChallenge({ kind: 'number', answer: 0.3, tolerance: 0.05, allowDecimal: true }))).toEqual([]);
    // Less than one whole number on a keypad without a decimal point changes nothing.
    expect(validateChallengeContent(makeChallenge({ kind: 'number', answer: 7, tolerance: 0.5 }))).toEqual([]);
  });
  it('extracts numbers from text', () => {
    expect(numbersInText('Try 12 and 3.5, then 1,250 or 7.')).toEqual([12, 3.5, 1250, 7]);
    expect(numbersInText('no digits here')).toEqual([]);
  });
});

describe('validateChallengeContent: robot', () => {
  it('reports start or goal on a wall', () => {
    expect(problemsOf(makeChallenge({ ...ROBOT, walls: [{ x: 0, y: 0 }] }))).toContain('start is on a wall');
    expect(problemsOf(makeChallenge({ ...ROBOT, walls: [{ x: 3, y: 0 }] }))).toContain('goal is on a wall');
  });
  it('reports start or goal outside the grid', () => {
    expect(problemsOf(makeChallenge({ ...ROBOT, goal: { x: 6, y: 0 } }))).toContain('goal is outside the grid');
    expect(problemsOf(makeChallenge({ ...ROBOT, start: { x: 0, y: 5, dir: 'up' } }))).toContain(
      'start is outside the grid',
    );
  });
  it('reports an unsolvable maze', () => {
    const c = makeChallenge({
      ...ROBOT,
      walls: [
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
    });
    expect(problemsOf(c)).toContain('cannot be solved');
  });
  it('reports a solution longer than maxCommands, unless repeat makes it fit', () => {
    const tight = { ...ROBOT, cols: 6, goal: { x: 5, y: 0 }, maxCommands: 2 };
    expect(validateChallengeContent(makeChallenge(tight))).toEqual([]);
    const noRepeat = makeChallenge({ ...tight, allowed: ['forward', 'left', 'right'] });
    expect(problemsOf(noRepeat)).toContain('needs 5 blocks but maxCommands is 2');
  });
  it('reports gems on walls or outside the grid, and duplicates', () => {
    expect(problemsOf(makeChallenge({ ...ROBOT, gems: [{ x: 1, y: 1 }], walls: [{ x: 1, y: 1 }] }))).toContain(
      'gem 1 is on a wall',
    );
    expect(problemsOf(makeChallenge({ ...ROBOT, gems: [{ x: 1, y: 7 }] }))).toContain('gem 1 is outside the grid');
    expect(
      problemsOf(
        makeChallenge({
          ...ROBOT,
          gems: [
            { x: 1, y: 1 },
            { x: 1, y: 1 },
          ],
          maxCommands: 12,
        }),
      ),
    ).toContain('robot gem cells must be unique');
  });
  it('reports a maze that is already solved or can never move', () => {
    expect(problemsOf(makeChallenge({ ...ROBOT, goal: { x: 0, y: 0 } }))).toContain('already stands on the goal');
    expect(problemsOf(makeChallenge({ ...ROBOT, allowed: ['left', 'right'] }))).toContain("'forward'");
  });
  it('accepts start on the goal when gems still need collecting', () => {
    const c = makeChallenge({ ...ROBOT, goal: { x: 0, y: 0 }, gems: [{ x: 2, y: 0 }], maxCommands: 8 });
    expect(validateChallengeContent(c)).toEqual([]);
  });
});

describe('validateChallengeContent: build and teachBack', () => {
  it('reports an unsolvable build', () => {
    expect(problemsOf(makeChallenge({ ...BUILD, budget: 2 }))).toContain('no selection of build parts');
  });
  it('reports a build solved by picking everything', () => {
    expect(problemsOf(makeChallenge({ ...BUILD, budget: 20 }))).toContain('no decision to make');
  });
  it('reports duplicate part ids', () => {
    const c = makeChallenge({ ...BUILD, parts: [...BUILD.parts, { id: 'wood', label: 'More wood', power: 1, cost: 9 }] });
    expect(problemsOf(c)).toContain('build part ids must be unique');
  });
  it('needs exactly one correct teachBack option', () => {
    const none = makeChallenge(CHOICE, {
      teachBack: {
        prompt: 'Why?',
        options: [
          { id: 'x', label: 'Because', correct: false },
          { id: 'y', label: 'Just so', correct: false },
        ],
      },
    });
    expect(problemsOf(none)).toContain('exactly one correct option, found 0');
    const two = makeChallenge(CHOICE, {
      teachBack: {
        prompt: 'Why?',
        options: [
          { id: 'x', label: 'Because', correct: true },
          { id: 'y', label: 'Just so', correct: true },
        ],
      },
    });
    expect(problemsOf(two)).toContain('found 2');
    const one = makeChallenge(CHOICE, {
      teachBack: {
        prompt: 'Why?',
        options: [
          { id: 'x', label: 'Because', correct: true },
          { id: 'y', label: 'Just so', correct: false },
        ],
      },
    });
    expect(validateChallengeContent(one)).toEqual([]);
  });
});
