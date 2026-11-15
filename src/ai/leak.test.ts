import { describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { SKILLS, skillGrades } from '@/core/skills';
import type { ChallengePlan } from '@/core/types';
import { CURATED, pickOfflineChallenge } from '@/offline';
import { SAMPLE_CHALLENGES } from '@/engine';
import { mentionsNumber, revealsAnswer } from './leak';
import { KIND_EXAMPLES } from './prompts';

describe('mentionsNumber', () => {
  it('finds the number in digits, with separators and in Devanagari digits', () => {
    expect(mentionsNumber('The answer is 5.', 5)).toBe(true);
    expect(mentionsNumber('About 1,250 steps.', 1250)).toBe(true);
    expect(mentionsNumber('उत्तर ५ है', 5)).toBe(true);
    expect(mentionsNumber('It is 3.5 metres.', 3.5)).toBe(true);
    expect(mentionsNumber('It is minus 4.', -4)).toBe(true);
  });

  it('does not match a different number that contains the digits', () => {
    expect(mentionsNumber('There are 15 apples and 50 pears.', 5)).toBe(false);
    expect(mentionsNumber('Start at 8 and count back.', 5)).toBe(false);
  });

  it('finds common number words in the given language', () => {
    expect(mentionsNumber('It is five, of course.', 5, 'en')).toBe(true);
    expect(mentionsNumber('Son cinco manzanas.', 5, 'es')).toBe(true);
    expect(mentionsNumber('जवाब पाँच है।', 5, 'hi')).toBe(true);
    expect(mentionsNumber('Dieciséis.', 16, 'es')).toBe(true);
  });

  it('does not confuse words across languages or inside other words', () => {
    expect(mentionsNumber('Once more, look closely.', 11, 'en')).toBe(false);
    expect(mentionsNumber('Listen to the question.', 10, 'en')).toBe(false);
    expect(mentionsNumber('That is often true.', 10, 'en')).toBe(false);
  });
});

describe('revealsAnswer', () => {
  const number = ChallengeSchema.parse(KIND_EXAMPLES.number);
  const choice = ChallengeSchema.parse({
    ...(KIND_EXAMPLES.choice as object),
    interaction: {
      kind: 'choice',
      options: [
        { id: 'a', label: 'Triangle' },
        { id: 'b', label: 'Square', misconception: 'Count the sides again.' },
        { id: 'c', label: 'Circle', misconception: 'A circle has no straight sides.' },
      ],
      correctIds: ['a'],
    },
  });

  it('flags a number answer in digits or words', () => {
    expect(revealsAnswer(number, 'There are 5 left.', 'en')).toBe(true);
    expect(revealsAnswer(number, 'Five are left!', 'en')).toBe(true);
    expect(revealsAnswer(number, 'Start at 8 and count back 3.', 'en')).toBe(false);
  });

  it('flags a choice answer that is singled out, but not a comparison of options', () => {
    expect(revealsAnswer(choice, 'It is the triangle.', 'en')).toBe(true);
    expect(revealsAnswer(choice, 'Is it the triangle or the square? Count the sides.', 'en')).toBe(false);
    expect(revealsAnswer(choice, 'Count the straight sides of each shape.', 'en')).toBe(false);
  });

  it('treats numeric choice labels as numbers', () => {
    const numeric = ChallengeSchema.parse(KIND_EXAMPLES.choice);
    expect(revealsAnswer(numeric, 'Each astronaut gets four.', 'en')).toBe(true);
    expect(revealsAnswer(numeric, 'Make three equal piles from the twelve cookies.', 'en')).toBe(false);
  });

  it('never flags kinds whose answer cannot be said in words', () => {
    for (const kind of ['tap', 'robot', 'build'] as const) {
      const challenge = ChallengeSchema.parse(KIND_EXAMPLES[kind]);
      expect(revealsAnswer(challenge, `${challenge.explanation} ${challenge.walkthrough.join(' ')}`, 'en')).toBe(false);
    }
  });

  it('flags an order answer that lists the items in the order of the key', () => {
    const order = ChallengeSchema.parse(SAMPLE_CHALLENGES.order); // Seed, Sprout, Leafy plant, Flower
    expect(revealsAnswer(order, 'Here you go: "Seed", then "Sprout", then "Leafy plant", then "Flower"', 'en')).toBe(true);
    expect(revealsAnswer(order, 'First the seed, next the sprout and after that the leafy plant.', 'en')).toBe(true);
    expect(revealsAnswer(order, order.explanation, 'en')).toBe(true);
    // Help that points at one step, or compares two, is not the answer.
    for (const hint of order.hints) expect(revealsAnswer(order, hint, 'en'), hint).toBe(false);
    expect(revealsAnswer(order, 'A sprout comes after the seed.', 'en')).toBe(false);
    expect(revealsAnswer(order, 'Think about the flower, the seed and the sprout: which is the youngest?', 'en')).toBe(false);
    expect(revealsAnswer(order, order.walkthrough[0] ?? '', 'en')).toBe(false);
  });

  it('flags a sort answer that puts things in their groups', () => {
    const sort = ChallengeSchema.parse(SAMPLE_CHALLENGES.sort);
    expect(revealsAnswer(sort, '"Rubber duck" goes in "Floats"; "Rock" goes in "Sinks"; "Leaf" goes in "Floats"', 'en')).toBe(true);
    expect(revealsAnswer(sort, 'The rock sinks. The key sinks too.', 'en')).toBe(true);
    for (const text of [...sort.hints, ...sort.walkthrough, sort.explanation]) expect(revealsAnswer(sort, text, 'en'), text).toBe(false);
    expect(revealsAnswer(sort, 'Does the rock belong with Floats or with Sinks? What about the key: Floats or Sinks?', 'en')).toBe(false);
    expect(revealsAnswer(sort, 'Look at the rubber duck and the rock. Which one is heavy for its size?', 'en')).toBe(false);
  });

  it('flags a match answer that names pairs', () => {
    const match = ChallengeSchema.parse(SAMPLE_CHALLENGES.match);
    expect(revealsAnswer(match, '"Bee" with "Hive"; "Bird" with "Nest"; "Fish" with "Pond"', 'en')).toBe(true);
    expect(revealsAnswer(match, 'The bee goes to the hive and the bird goes to the nest.', 'en')).toBe(true);
    for (const hint of match.hints) expect(revealsAnswer(match, hint, 'en'), hint).toBe(false);
    expect(revealsAnswer(match, 'Where would you look for a bee: a hive, a nest or a pond?', 'en')).toBe(false);
    expect(revealsAnswer(match, 'Think about the bee and the bird. Which of them can swim?', 'en')).toBe(false);
  });

  it('flags the answer 1 when it is given as the word, but not every "one"', () => {
    const one = ChallengeSchema.parse({ ...(KIND_EXAMPLES.number as object), interaction: { kind: 'number', answer: 1, min: 0, max: 10 } });
    expect(revealsAnswer(one, 'The answer is one.', 'en')).toBe(true);
    expect(revealsAnswer(one, 'There is only one left!', 'en')).toBe(true);
    expect(revealsAnswer(one, 'It is 1.', 'en')).toBe(true);
    expect(revealsAnswer(one, 'Try one more time and look at each one.', 'en')).toBe(false);
    expect(revealsAnswer(one, 'This is one way to count them. Which one is left over?', 'en')).toBe(false);
  });

  it('flags compound number words', () => {
    expect(mentionsNumber('It is twenty-one.', 21, 'en')).toBe(true);
    expect(mentionsNumber('That makes twenty one cookies.', 21, 'en')).toBe(true);
    expect(mentionsNumber('Ninety-nine!', 99, 'en')).toBe(true);
    expect(mentionsNumber('Son veintiuno.', 21, 'es')).toBe(true);
    expect(mentionsNumber('Son treinta y dos.', 32, 'es')).toBe(true);
    expect(mentionsNumber('Count on from twenty.', 21, 'en')).toBe(false);
    expect(mentionsNumber('One cookie for each of the twenty children.', 21, 'en')).toBe(false);
  });

  it('flags a short correct label when the text presents it as the answer', () => {
    const animals = ChallengeSchema.parse({
      ...(KIND_EXAMPLES.choice as object),
      interaction: {
        kind: 'choice',
        options: [
          { id: 'a', label: 'Cat' },
          { id: 'b', label: 'Dog', misconception: 'A dog barks.' },
          { id: 'c', label: 'Cow', misconception: 'A cow moos.' },
        ],
        correctIds: ['a'],
      },
    });
    expect(revealsAnswer(animals, 'The answer is cat.', 'en')).toBe(true);
    expect(revealsAnswer(animals, 'Pick the cat!', 'en')).toBe(true);
    expect(revealsAnswer(animals, "It's the cat.", 'en')).toBe(true);
    expect(revealsAnswer(animals, 'Which one purrs: a cat, a dog or a cow?', 'en')).toBe(false);
    expect(revealsAnswer(animals, 'Think about which animal says meow.', 'en')).toBe(false);
    expect(revealsAnswer(animals, 'A cat is a pet. So is one of the others.', 'en')).toBe(false);
  });

  it('the prompt examples do not give their own answers away in the hints', () => {
    for (const raw of Object.values(KIND_EXAMPLES)) {
      const challenge = ChallengeSchema.parse(raw);
      for (const hint of challenge.hints) expect(revealsAnswer(challenge, hint, 'en'), hint).toBe(false);
    }
  });

  it('does not hold the built-in hints of order, sort and match challenges against them', () => {
    const flagged: string[] = [];
    const seen = (challenge: Challenge, where: string): void => {
      if (!['order', 'sort', 'match'].includes(challenge.interaction.kind)) return;
      for (const hint of challenge.hints) {
        if (revealsAnswer(challenge, hint, 'en')) flagged.push(`${where}: ${challenge.title} -> ${hint}`);
      }
    };
    for (const item of CURATED) seen(item.challenge, `curated ${item.id}`);
    for (const skill of SKILLS) {
      for (const grade of skillGrades(skill)) {
        for (const interaction of skill.interactions) {
          for (const seed of [1, 2, 3]) {
            const plan: ChallengePlan = {
              childId: 'c1',
              skillId: skill.id,
              strand: skill.strand,
              stage: makeStage(grade, 'growing'),
              interaction,
              mode: 'quest',
              purpose: 'core',
              theme: 'animals',
            };
            seen(pickOfflineChallenge(plan, { seed }), `${skill.id} ${grade} ${interaction} seed ${seed}`);
          }
        }
      }
    }
    expect(flagged).toEqual([]);
  }, 60_000);
});
