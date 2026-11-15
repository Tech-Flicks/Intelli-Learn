import { describe, expect, it } from 'vitest';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { revealsAnswer } from './leak';
import { KIND_EXAMPLES } from './prompts';

function numberChallenge(answer: number): Challenge {
  const base = ChallengeSchema.parse(KIND_EXAMPLES.number);
  return { ...base, interaction: { kind: 'number', answer, tolerance: 0, allowDecimal: false, allowNegative: false } };
}

function choiceChallenge(): Challenge {
  return ChallengeSchema.parse(KIND_EXAMPLES.choice);
}

/** A hint may repeat what the question gives; it must not state the result. */
describe('revealsAnswer: numbers and words the question itself gives', () => {
  const birds = (): Challenge => ({
    ...numberChallenge(4),
    intro: 'Birds sit on a wire.',
    question: 'There are 8 birds on a wire. 4 fly away. How many are left?',
  });

  it('does not flag a hint that restates a given number which happens to equal the answer', () => {
    expect(revealsAnswer(birds(), 'Start with 8 birds and take away 4, one at a time.', 'en')).toBe(false);
    expect(revealsAnswer(birds(), 'Cross out the 4 birds that fly away.', 'en')).toBe(false);
    expect(revealsAnswer(birds(), 'You had 8 birds and 4 flew away. Try crossing out 4 of them!', 'en')).toBe(false);
    const share = { ...numberChallenge(2), question: 'Share 4 apples between 2 friends. How many does each friend get?' };
    expect(revealsAnswer(share, 'Deal the apples out to the 2 friends, one at a time.', 'en')).toBe(false);
    const words = { ...numberChallenge(2), question: 'Two friends share four apples. How many does each friend get?' };
    expect(revealsAnswer(words, 'Deal the apples out to the two friends.', 'en')).toBe(false);
  });

  it('still flags a hint that states the given number as the result', () => {
    expect(revealsAnswer(birds(), '8 take away 4 leaves 4.', 'en')).toBe(true);
    expect(revealsAnswer(birds(), 'Work out 8 - 4 = 4.', 'en')).toBe(true);
    expect(revealsAnswer(birds(), 'The answer is 4.', 'en')).toBe(true);
    expect(revealsAnswer(birds(), 'Count them: 4 are left.', 'en')).toBe(true);
    expect(revealsAnswer(birds(), 'Eight take away four makes four.', 'en')).toBe(true);
    expect(revealsAnswer({ ...birds(), question: 'Hay 8 pájaros. 4 se van volando. ¿Cuántos quedan?' }, 'Ocho menos cuatro es igual a 4.', 'es')).toBe(true);
  });

  it('still flags the answer when the question does not give that number', () => {
    const shells = { ...numberChallenge(10), question: 'You have 7 shells and find 3 more. How many shells now?' };
    expect(revealsAnswer(shells, 'Count on from 7 until you reach 10.', 'en')).toBe(true);
    expect(revealsAnswer(shells, 'Start at 7 and count on 3 more.', 'en')).toBe(false);
  });

  it('does not flag a correct choice label that is a word of the question, unless it is presented as the answer', () => {
    const trueFalse = {
      ...choiceChallenge(),
      question: 'True or false: a plant can grow without any light?',
      interaction: {
        kind: 'choice' as const,
        multi: false,
        options: [
          { id: 'a', label: 'True', misconception: 'Think about a plant in a dark cupboard.' },
          { id: 'b', label: 'False' },
        ],
        correctIds: ['b'],
      },
    };
    expect(revealsAnswer(trueFalse, 'Think about a plant in a dark cupboard. Would the sentence be false there?', 'en')).toBe(false);
    expect(revealsAnswer(trueFalse, 'It is false.', 'en')).toBe(true);
    expect(revealsAnswer(trueFalse, 'Pick false.', 'en')).toBe(true);

    const sun = {
      ...trueFalse,
      question: 'What does a plant use to make its food?',
      interaction: { ...trueFalse.interaction, options: [{ id: 'a', label: 'Moonlight' }, { id: 'b', label: 'Sunlight' }] },
    };
    // The question does not use the word, so naming it gives the answer away.
    expect(revealsAnswer(sun, 'Leaves soak up sunlight all day.', 'en')).toBe(true);
  });
});
