import { describe, expect, it } from 'vitest';
import { ChallengeSchema } from '@/core/schemas';
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

  it('never flags kinds whose answer cannot be said in a word', () => {
    for (const kind of ['tap', 'sort', 'match', 'order', 'robot', 'build'] as const) {
      const challenge = ChallengeSchema.parse(KIND_EXAMPLES[kind]);
      expect(revealsAnswer(challenge, `${challenge.explanation} ${challenge.walkthrough.join(' ')}`, 'en')).toBe(false);
    }
  });

  it('the prompt examples do not give their own answers away in the hints', () => {
    for (const raw of Object.values(KIND_EXAMPLES)) {
      const challenge = ChallengeSchema.parse(raw);
      for (const hint of challenge.hints) expect(revealsAnswer(challenge, hint, 'en'), hint).toBe(false);
    }
  });
});
