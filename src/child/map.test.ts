import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROLS } from '@/core/defaults';
import { makeStage } from '@/core/grades';
import type { StrandStage } from '@/core/types';
import { TRAIL_POINTS, buildWorld, buildWorlds, enabledStrands, trailPath } from './map';

const allOn = { strands: { ...DEFAULT_CONTROLS.strands } };

describe('enabledStrands', () => {
  it('lists the strands a parent left on, in the fixed order', () => {
    expect(enabledStrands(allOn)).toEqual(['math', 'science', 'technology', 'engineering', 'logic']);
    expect(enabledStrands({ strands: { ...allOn.strands, science: false, logic: false } })).toEqual([
      'math',
      'technology',
      'engineering',
    ]);
  });

  it('never leaves a child without a world', () => {
    const allOff = { strands: { math: false, science: false, technology: false, engineering: false, logic: false } };
    expect(enabledStrands(allOff)).toHaveLength(5);
  });
});

describe('buildWorld', () => {
  it('lights the steps behind, puts the child on the current step and ends at the gate to the next grade', () => {
    const world = buildWorld('math', makeStage('3', 'strong'), '2');
    expect(world).toMatchObject({ strand: 'math', explored: true, grade: '3', nextGrade: '4' });
    expect(world.stops.map((stop) => `${stop.kind}:${stop.state}`)).toEqual([
      'step:done',
      'step:done',
      'step:current',
      'step:ahead',
      'gate:ahead',
    ]);
    expect(world.stops.map((stop) => stop.step)).toEqual(['starting', 'growing', 'strong', 'ready', null]);
  });

  it('starts a world nobody has played at the first step of the enrolled grade', () => {
    const world = buildWorld('logic', null, 'K');
    expect(world).toMatchObject({ explored: false, grade: 'K', stage: makeStage('K', 'starting'), nextGrade: '1' });
    expect(world.stops[0]).toMatchObject({ state: 'current' });
    expect(world.stops.filter((stop) => stop.state === 'done')).toHaveLength(0);
  });

  it('has no next grade at the top of the map', () => {
    const world = buildWorld('science', makeStage('8', 'ready'), '8');
    expect(world.nextGrade).toBeNull();
    expect(world.stops.map((stop) => stop.state)).toEqual(['done', 'done', 'done', 'current', 'ahead']);
  });

  it('always has exactly one current stop and as many stops as trail points', () => {
    for (let stage = 0; stage <= 39; stage += 1) {
      const world = buildWorld('math', stage, 'PK');
      expect(world.stops.filter((stop) => stop.state === 'current')).toHaveLength(1);
      expect(world.stops).toHaveLength(TRAIL_POINTS.length);
    }
  });
});

describe('buildWorlds', () => {
  it('makes one world per enabled strand and uses the strand stage where there is one', () => {
    const stages: StrandStage[] = [
      { strand: 'math', stage: makeStage('1', 'growing'), practisedSkills: 2 },
      { strand: 'science', stage: null, practisedSkills: 0 },
    ];
    const worlds = buildWorlds({ strands: { ...allOn.strands, logic: false } }, stages, '2');
    expect(worlds.map((world) => world.strand)).toEqual(['math', 'science', 'technology', 'engineering']);
    expect(worlds[0]).toMatchObject({ grade: '1', explored: true });
    expect(worlds[1]).toMatchObject({ grade: '2', explored: false });
    expect(worlds[2]).toMatchObject({ grade: '2', explored: false });
  });
});

describe('trailPath', () => {
  it('draws one curve between each pair of stops', () => {
    const path = trailPath();
    expect(path.startsWith(`M ${TRAIL_POINTS[0]?.x} ${TRAIL_POINTS[0]?.y}`)).toBe(true);
    expect(path.match(/C /g)).toHaveLength(TRAIL_POINTS.length - 1);
    expect(trailPath([])).toBe('');
  });
});
