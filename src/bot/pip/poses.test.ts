import { describe, expect, it } from 'vitest';
import { ARM_POSE_TABLE, SHOULDERS, armGeometry, computeBandPath, restingArms } from './poses';
import { PIP_STATES, isPipState } from './states';

describe('PIP_STATES', () => {
  it('lists the 20 states of the design file, in its order', () => {
    expect(PIP_STATES).toEqual([
      'idle',
      'listening',
      'thinking',
      'talking',
      'singing',
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
      'teaching',
      'reading',
      'storytelling',
      'celebrating',
    ]);
    expect(new Set(PIP_STATES).size).toBe(20);
  });

  it('recognises a state id', () => {
    expect(isPipState('jump_scared')).toBe(true);
    expect(isPipState('jumping')).toBe(false);
    expect(isPipState(3)).toBe(false);
  });
});

describe('ARM_POSE_TABLE', () => {
  it('has a pose for both arms in every state, and no other entries', () => {
    expect(Object.keys(ARM_POSE_TABLE).sort()).toEqual([...PIP_STATES].sort());
    for (const state of PIP_STATES) {
      for (const side of ['left', 'right'] as const) {
        const pose = ARM_POSE_TABLE[state][side];
        for (const value of [pose.cx, pose.cy, pose.wx, pose.wy, pose.angle, pose.bobX, pose.bobY, pose.rotAmp]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(pose.speed).toBeGreaterThan(0);
        expect(['open', 'curled']).toContain(pose.style);
      }
    }
  });

  it('keeps every hand within reach of the picture', () => {
    for (const state of PIP_STATES) {
      for (const side of ['left', 'right'] as const) {
        const pose = ARM_POSE_TABLE[state][side];
        expect(pose.wx).toBeGreaterThan(30);
        expect(pose.wx).toBeLessThan(350);
        expect(pose.wy).toBeGreaterThan(100);
        expect(pose.wy).toBeLessThan(320);
      }
    }
  });

  it('holds the poses of the design: happy waves with the left arm, reading grips the book with both', () => {
    expect(ARM_POSE_TABLE.happy.left).toMatchObject({ cx: 70, cy: 210, wx: 68, wy: 158, angle: -24, style: 'open' });
    expect(ARM_POSE_TABLE.reading.left).toMatchObject({ wx: 126, wy: 274, angle: 78, style: 'curled' });
    expect(ARM_POSE_TABLE.reading.right).toMatchObject({ wx: 254, wy: 274, angle: -78, style: 'curled' });
  });
});

describe('arm geometry', () => {
  it('draws the tube from the fixed shoulder through the elbow to the wrist', () => {
    const geometry = armGeometry('left', { cx: 70, cy: 210, wx: 68, wy: 158, angle: -24 });
    expect(geometry.tube).toBe('M 126 232 Q 70.0 210.0 68.0 158.0');
    expect(geometry.hand).toBe('translate(68.0, 158.0) rotate(-24.0)');
    expect(armGeometry('right', { cx: 296, cy: 230, wx: 306, wy: 220, angle: 76 }).tube).toBe(
      `M ${SHOULDERS.right.x} ${SHOULDERS.right.y} Q 296.0 230.0 306.0 220.0`,
    );
  });

  it('puts a ring across the tube: centred on the curve and at a right angle to it', () => {
    // A straight, horizontal arm from (0,0) to (100,0): the ring at the middle is vertical.
    expect(computeBandPath(0, 0, 50, 0, 100, 0, 0.5, 10)).toBe('M 50.0 -10.0 Q 52.5 0.0 50.0 10.0');
    // A straight arm pointing down: the ring is horizontal.
    expect(computeBandPath(0, 0, 0, 50, 0, 100, 0.5, 10)).toBe('M 10.0 50.0 Q 0.0 52.5 -10.0 50.0');
  });

  it('survives an arm of no length', () => {
    expect(computeBandPath(5, 5, 5, 5, 5, 5, 0.38, 9.5)).not.toContain('NaN');
  });

  it('gives the resting picture of a state, with the hand style', () => {
    const arms = restingArms('giggle');
    expect(arms.left.style).toBe('curled');
    expect(arms.right.style).toBe('open');
    expect(arms.left.hand).toBe('translate(174.0, 180.0) rotate(30.0)');
    expect(arms.left.band1).toMatch(/^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
    expect(arms.left.band1).not.toBe(arms.left.band2);
  });
});
