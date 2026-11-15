/**
 * The 20 moods of Pip, with the ids of the design file (`design/pip-mascot-sandbox.html`).
 * The id is written to `data-state` on the root `<svg>` and selects eyes, mouth, props and
 * choreography in `pip.css`, and the arm pose in `poses.ts`.
 */
export const PIP_STATES = [
  // helper pipeline
  'idle',
  'listening',
  'thinking',
  'talking',
  'singing',
  // emotions and touch reactions
  'happy',
  'giggle',
  'sad',
  'angry',
  'tired',
  'sleeping',
  'waiting',
  'jump_scared',
  'curious',
  'proud',
  'shy',
  // learning and play
  'teaching',
  'reading',
  'storytelling',
  'celebrating',
] as const;

export type PipState = (typeof PIP_STATES)[number];

export function isPipState(value: unknown): value is PipState {
  return typeof value === 'string' && (PIP_STATES as readonly string[]).includes(value);
}
