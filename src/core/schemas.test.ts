import { describe, expect, it } from 'vitest';
import { ChallengeSchema } from './schemas';

const base = {
  title: 'Rocket Count',
  intro: 'Three rockets are ready to launch!',
  question: 'How many rockets do you see?',
  readAloud: 'Three rockets are ready to launch! How many rockets do you see?',
  hints: ['Point at each rocket as you count.', 'Count slowly: one, two...'],
  walkthrough: ['Touch the first rocket and say one.', 'Touch the next and say two.', 'The last one makes three.'],
  explanation: 'There are three rockets because we counted one, two, three.',
  scene: {
    theme: 'space',
    objects: [{ id: 'r1', type: 'emoji', emoji: '🚀', x: 20, y: 50 }],
  },
};

describe('ChallengeSchema', () => {
  it('accepts a valid number challenge and applies defaults', () => {
    const parsed = ChallengeSchema.parse({ ...base, interaction: { kind: 'number', answer: 3 } });
    expect(parsed.interaction.kind).toBe('number');
    expect(parsed.scene.objects[0]?.size).toBe(12);
    expect(parsed.scene.objects[0]?.tappable).toBe(false);
  });
  it('rejects an unknown interaction kind', () => {
    const result = ChallengeSchema.safeParse({ ...base, interaction: { kind: 'essay' } });
    expect(result.success).toBe(false);
  });
  it('rejects non-hex colors and unsafe ids', () => {
    const bad = {
      ...base,
      interaction: { kind: 'number', answer: 3 },
      scene: { theme: 'space', objects: [{ id: 'a b<script>', type: 'shape', shape: 'circle', x: 1, y: 1, color: 'red' }] },
    };
    expect(ChallengeSchema.safeParse(bad).success).toBe(false);
  });
});
