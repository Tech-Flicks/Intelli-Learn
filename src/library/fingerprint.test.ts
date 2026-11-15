import { describe, expect, it } from 'vitest';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { INTERACTION_KINDS } from '@/core/types';
import { SAMPLE_CHALLENGES } from '@/engine';
import { answerKeyOf, fingerprintOf } from './fingerprint';

const base = {
  title: 'Apple Count',
  intro: 'Mia picks apples in the orchard.',
  question: 'Which basket has the most apples?',
  readAloud: 'Mia picks apples in the orchard. Which basket has the most apples?',
  hints: ['Count each basket.', 'Compare the numbers.'],
  walkthrough: ['Count the first basket.', 'Count the others and compare.'],
  explanation: 'The basket with seven apples has the most.',
  scene: { theme: 'farm', objects: [{ id: 'tree', type: 'emoji', emoji: '🌳', x: 10, y: 20 }] },
};

function choice(patch: Record<string, unknown> = {}): Challenge {
  return ChallengeSchema.parse({
    ...base,
    interaction: {
      kind: 'choice',
      options: [
        { id: 'a', label: 'The red basket' },
        { id: 'b', label: 'The blue basket' },
        { id: 'c', label: 'The green basket' },
      ],
      correctIds: ['b'],
    },
    ...patch,
  });
}

function number(answer: number, patch: Record<string, unknown> = {}): Challenge {
  return ChallengeSchema.parse({ ...base, question: 'How many apples are there?', interaction: { kind: 'number', answer }, ...patch });
}

describe('fingerprintOf', () => {
  it('is 16 hex digits and the same every time', () => {
    const fp = fingerprintOf(choice());
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf(choice())).toBe(fp);
    expect(fingerprintOf(JSON.parse(JSON.stringify(number(3))) as Challenge)).toBe(fingerprintOf(number(3)));
    // A pinned value: fingerprints are stored on devices and in backups, so the recipe must never drift.
    expect(fingerprintOf(number(3))).toBe('d82ce71ce2476435');
  });

  it('ignores the scene decoration, title, intro, hints and explanation', () => {
    const plain = choice();
    const dressedUp = choice({
      title: 'Orchard Morning',
      intro: 'A sunny day at the farm.',
      hints: ['Look closely.', 'Count twice.'],
      explanation: 'Seven is more than five and three.',
      funFact: 'Apples float in water.',
      scene: {
        theme: 'forest',
        gradient: ['#112233', '#445566'],
        objects: [
          { id: 'bird', type: 'emoji', emoji: '🐦', x: 80, y: 10, anim: { kind: 'float' } },
          { id: 'sun', type: 'shape', shape: 'circle', x: 50, y: 5, color: '#ffcc00' },
        ],
      },
    });
    expect(fingerprintOf(dressedUp)).toBe(fingerprintOf(plain));
  });

  it('ignores case, spacing and closing punctuation of the question', () => {
    expect(fingerprintOf(choice({ question: '  which basket has the MOST   apples ' }))).toBe(fingerprintOf(choice()));
    expect(fingerprintOf(choice({ question: '¿Which basket has the most apples?!' }))).toBe(fingerprintOf(choice()));
  });

  it('keeps the symbols and decimal points that change a question', () => {
    const plus = number(7, { question: 'What is 3 + 4?' });
    const minus = number(7, { question: 'What is 3 - 4?' });
    expect(fingerprintOf(plus)).not.toBe(fingerprintOf(minus));
    const decimal = number(7, { question: 'Round 6.5 to the nearest whole number.' });
    const whole = number(7, { question: 'Round 65 to the nearest whole number.' });
    expect(fingerprintOf(decimal)).not.toBe(fingerprintOf(whole));
  });

  it('does not depend on option ids or on the order the options are listed in', () => {
    const renamed = ChallengeSchema.parse({
      ...base,
      interaction: {
        kind: 'choice',
        options: [
          { id: 'opt-3', label: 'The green basket' },
          { id: 'opt-1', label: 'The red basket' },
          { id: 'opt-2', label: 'the  BLUE basket' },
        ],
        correctIds: ['opt-2'],
      },
    });
    expect(fingerprintOf(renamed)).toBe(fingerprintOf(choice()));
  });

  it('changes with the answer key', () => {
    const other = ChallengeSchema.parse({
      ...base,
      interaction: { ...choice().interaction, correctIds: ['c'] },
    });
    expect(fingerprintOf(other)).not.toBe(fingerprintOf(choice()));
    expect(fingerprintOf(number(3))).not.toBe(fingerprintOf(number(4)));
    expect(fingerprintOf(number(3, { interaction: { kind: 'number', answer: 3, unit: 'kg' } }))).not.toBe(fingerprintOf(number(3)));
  });

  it('changes with the question and with the interaction kind', () => {
    expect(fingerprintOf(choice({ question: 'Which basket has the fewest apples?' }))).not.toBe(fingerprintOf(choice()));
    const asOrder = ChallengeSchema.parse({
      ...base,
      interaction: { kind: 'order', items: [{ id: 'a', label: '1' }, { id: 'b', label: '2' }, { id: 'c', label: '3' }] },
    });
    const asSort = ChallengeSchema.parse({
      ...base,
      interaction: {
        kind: 'sort',
        bins: [{ id: 'x', label: 'Small' }, { id: 'y', label: 'Big' }],
        items: [{ id: 'a', label: '1', binId: 'x' }, { id: 'b', label: '2', binId: 'x' }, { id: 'c', label: '3', binId: 'y' }],
      },
    });
    expect(fingerprintOf(asOrder)).not.toBe(fingerprintOf(asSort));
  });

  it('reads tap targets by what they show, not by id or position', () => {
    const tap = (objects: unknown[], targetIds: string[]): Challenge =>
      ChallengeSchema.parse({ ...base, question: 'Tap every star.', interaction: { kind: 'tap', targetIds }, scene: { theme: 'space', objects } });
    const first = tap(
      [
        { id: 's1', type: 'emoji', emoji: '⭐', x: 10, y: 10, tappable: true },
        { id: 's2', type: 'emoji', emoji: '⭐', x: 30, y: 10, tappable: true },
        { id: 'm', type: 'emoji', emoji: '🌙', x: 60, y: 10, tappable: true },
      ],
      ['s1', 's2'],
    );
    const moved = tap(
      [
        { id: 'moon', type: 'emoji', emoji: '🌙', x: 5, y: 80, tappable: true },
        { id: 'star-b', type: 'emoji', emoji: '⭐', x: 70, y: 40, size: 20, tappable: true },
        { id: 'star-a', type: 'emoji', emoji: '⭐', x: 90, y: 60, tappable: true, anim: { kind: 'pulse' } },
      ],
      ['star-a', 'star-b'],
    );
    const wrongTarget = tap(
      [
        { id: 's1', type: 'emoji', emoji: '⭐', x: 10, y: 10, tappable: true },
        { id: 's2', type: 'emoji', emoji: '⭐', x: 30, y: 10, tappable: true },
        { id: 'm', type: 'emoji', emoji: '🌙', x: 60, y: 10, tappable: true },
      ],
      ['s1', 'm'],
    );
    expect(fingerprintOf(moved)).toBe(fingerprintOf(first));
    expect(fingerprintOf(wrongTarget)).not.toBe(fingerprintOf(first));
  });

  it('treats an order challenge as its sequence and a match as its pairs', () => {
    const order = (labels: string[]): Challenge =>
      ChallengeSchema.parse({ ...base, interaction: { kind: 'order', items: labels.map((label, i) => ({ id: `i${i}`, label })) } });
    expect(fingerprintOf(order(['seed', 'sprout', 'flower']))).not.toBe(fingerprintOf(order(['flower', 'sprout', 'seed'])));

    const match = (pairs: [string, string][]): Challenge =>
      ChallengeSchema.parse({
        ...base,
        interaction: { kind: 'match', pairs: pairs.map(([left, right], i) => ({ id: `p${i}`, left: { label: left }, right: { label: right } })) },
      });
    expect(fingerprintOf(match([['cat', 'kitten'], ['dog', 'puppy']]))).toBe(fingerprintOf(match([['dog', 'puppy'], ['cat', 'kitten']])));
    expect(fingerprintOf(match([['cat', 'kitten'], ['dog', 'puppy']]))).not.toBe(fingerprintOf(match([['cat', 'puppy'], ['dog', 'kitten']])));
  });

  it('gives every interaction kind a non-empty answer key and a distinct fingerprint', () => {
    const prints = new Set<string>();
    for (const kind of INTERACTION_KINDS) {
      const sample = SAMPLE_CHALLENGES[kind];
      expect(answerKeyOf(sample.interaction, sample.scene), kind).not.toBe('');
      prints.add(fingerprintOf(sample));
    }
    expect(prints.size).toBe(INTERACTION_KINDS.length);
  });

  it('tells a robot maze from another one and a build from another budget', () => {
    const robot = SAMPLE_CHALLENGES.robot;
    if (robot.interaction.kind !== 'robot') throw new Error('sample is not a robot challenge');
    const otherGoal: Challenge = {
      ...robot,
      interaction: { ...robot.interaction, maxCommands: robot.interaction.maxCommands + 1 },
    };
    expect(fingerprintOf(otherGoal)).not.toBe(fingerprintOf(robot));

    const build = SAMPLE_CHALLENGES.build;
    if (build.interaction.kind !== 'build') throw new Error('sample is not a build challenge');
    const otherBudget: Challenge = { ...build, interaction: { ...build.interaction, budget: build.interaction.budget + 1 } };
    expect(fingerprintOf(otherBudget)).not.toBe(fingerprintOf(build));
  });

  it('works for Hindi and Spanish text', () => {
    const hindi = number(3, { question: 'कितने सेब हैं?' });
    const hindiOther = number(3, { question: 'कितने केले हैं?' });
    expect(fingerprintOf(hindi)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf(hindi)).not.toBe(fingerprintOf(hindiOther));
    expect(fingerprintOf(number(3, { question: 'कितने सेब हैं।' }))).toBe(fingerprintOf(hindi));
  });
});
