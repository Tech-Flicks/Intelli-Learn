/** What the challenge prompt tells a real model so that its first reply passes the app's checks. */
import { describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { ChallengeSchema } from '@/core/schemas';
import type { ChallengePlan } from '@/core/types';
import { localSafetyCheck } from '../safety';
import type { ChildContext, GenerateChallengeRequest } from '../types';
import { buildChallengePrompt, buildRemixPrompt, buildTutorPrompt, KIND_EXAMPLES, KIND_SHAPES } from './index';

const child: ChildContext = { ageGroup: '6-8', grade: '2', interests: ['space'], locale: 'en', strictness: 'strict' };
const plan: ChallengePlan = {
  childId: 'c1',
  skillId: 'math-addition-subtraction',
  strand: 'math',
  stage: makeStage('2', 'growing'),
  interaction: 'number',
  mode: 'quest',
  purpose: 'core',
  theme: 'space',
};
const request: GenerateChallengeRequest = { plan, child, expectation: { grade: '2', text: 'Add and subtract within 100' }, skillName: 'Addition' };

describe('the challenge prompt states the rules the app enforces', () => {
  it('names the word families the word filter rejects, so the model does not learn them from rejections', () => {
    const strict = buildChallengePrompt(request).system;
    expect(strict).toContain('# Word filter');
    for (const word of ['killing', 'alcohol', 'drugs', 'medicine', 'our secret']) expect(strict).toContain(word);
    expect(strict).toMatch(/Extra-gentle mode also rejects: died/);
    const standard = buildChallengePrompt({ ...request, child: { ...child, strictness: 'standard' } }).system;
    expect(standard).toContain('# Word filter');
    expect(standard).not.toMatch(/also rejects: died/);
    // The replacements it suggests pass the filter themselves.
    for (const text of ['Soap kills germs.', 'The dinosaurs died out.', 'The dinosaurs went extinct.', 'The plant wilted.', 'These berries are harmful to eat.', 'Some medicine is made from plants.']) {
      expect(localSafetyCheck(text, 'strict').safe, text).toBe(true);
    }
  });

  it('keeps that list out of the tutor prompt, which is sent with every hint', () => {
    const challenge = ChallengeSchema.parse(KIND_EXAMPLES.number);
    const tutor = buildTutorPrompt({ child, challenge, intent: 'hint', hintLevel: 1, openChat: false });
    expect(tutor.system).not.toContain('# Word filter');
  });

  it('says what a number hint may and may not do', () => {
    expect(KIND_SHAPES.number.join('\n')).toMatch(/may repeat a number that the question gives/);
    expect(buildChallengePrompt(request).system).toMatch(/must not state the result/);
  });
});

describe('the challenge prompt for a slow endpoint', () => {
  it('asks for a small scene without an svg drawing', () => {
    const usual = buildChallengePrompt(request).system;
    const compact = buildChallengePrompt(request, { compact: true }).system;
    expect(usual).toMatch(/4 to 14 objects/);
    expect(usual).toMatch(/At most ONE object may be of type "svg"/);
    expect(compact).toMatch(/3 to 6 objects/);
    expect(compact).toMatch(/Do not use objects of type "svg"/);
    expect(compact).not.toMatch(/4 to 14 objects/);
    expect(compact.length).toBeLessThan(usual.length);
    // Everything else is the same prompt.
    expect(buildChallengePrompt(request, { compact: true }).user).toBe(buildChallengePrompt(request).user);
  });

  it('does the same for a remix', () => {
    const original = ChallengeSchema.parse(KIND_EXAMPLES.number);
    const compact = buildRemixPrompt({ original, plan, child, expectation: request.expectation, skillName: 'Addition' }, { compact: true });
    expect(compact.system).toMatch(/3 to 6 objects/);
  });
});
