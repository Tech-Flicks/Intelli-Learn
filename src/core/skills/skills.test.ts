import { describe, expect, it } from 'vitest';
import { makeStage, stageGrade, stageGradeIndex, stageStep } from '../grades';
import { GRADES, INTERACTION_KINDS, MODES, STRANDS, type Grade, type SkillDef } from '../types';
import {
  SKILLS,
  clampStageToSkill,
  expectationAt,
  getSkill,
  skillExistsAt,
  skillGrades,
  skillsForStrand,
} from './index';

const fake = (grades: Grade[]): SkillDef => ({
  id: 'logic-fake',
  strand: 'logic',
  name: 'Fake',
  description: 'A skill for tests.',
  gradeExpectations: Object.fromEntries(grades.map((g) => [g, `Expectation for ${g}`])),
  interactions: ['choice', 'sort'],
  modes: [],
  prerequisites: [],
});

describe('skill map data', () => {
  it('has about 40 skills, 8 per strand', () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(38);
    expect(SKILLS.length).toBeLessThanOrEqual(44);
    for (const strand of STRANDS) expect(skillsForStrand(strand)).toHaveLength(8);
  });

  it('uses unique kebab-case ids that start with the strand', () => {
    const ids = SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const skill of SKILLS) {
      expect(skill.id).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
      expect(skill.id.startsWith(`${skill.strand}-`)).toBe(true);
      expect(skill.name.trim().length).toBeGreaterThan(2);
      expect(skill.description.trim().length).toBeGreaterThan(10);
    }
  });

  it('offers at least 4 skills per strand at every grade', () => {
    for (const strand of STRANDS) {
      for (const grade of GRADES) {
        const count = skillsForStrand(strand).filter((s) => skillExistsAt(s, grade)).length;
        expect(count, `${strand} at ${grade}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('gives every skill a run of consecutive grades with concrete one-sentence expectations', () => {
    for (const skill of SKILLS) {
      const grades = skillGrades(skill);
      expect(grades.length, skill.id).toBeGreaterThanOrEqual(4);
      const indexes = grades.map((g) => GRADES.indexOf(g));
      indexes.forEach((value, i) => {
        if (i > 0) expect(value, `${skill.id} has a gap`).toBe((indexes[i - 1] as number) + 1);
      });
      for (const key of Object.keys(skill.gradeExpectations)) {
        expect(GRADES as readonly string[]).toContain(key);
      }
      for (const grade of grades) {
        const text = skill.gradeExpectations[grade] as string;
        expect(text.length, `${skill.id} ${grade}`).toBeGreaterThanOrEqual(20);
        expect(text.length, `${skill.id} ${grade}`).toBeLessThanOrEqual(140);
        expect(text, `${skill.id} ${grade}`).toMatch(/^[A-Z]/);
        expect(text.endsWith('.'), `${skill.id} ${grade} should not end with a full stop`).toBe(false);
      }
    }
  });

  it('lists at least two valid, distinct interaction kinds per skill', () => {
    for (const skill of SKILLS) {
      expect(skill.interactions.length, skill.id).toBeGreaterThanOrEqual(2);
      expect(new Set(skill.interactions).size).toBe(skill.interactions.length);
      for (const kind of skill.interactions) expect(INTERACTION_KINDS as readonly string[]).toContain(kind);
    }
  });

  it('lists valid modes, never quest, and only modes whose mechanic the skill supports', () => {
    for (const skill of SKILLS) {
      expect(new Set(skill.modes).size).toBe(skill.modes.length);
      for (const mode of skill.modes) {
        expect(MODES as readonly string[]).toContain(mode);
        expect(mode).not.toBe('quest');
      }
      if (skill.modes.includes('robot')) expect(skill.interactions, skill.id).toContain('robot');
      if (skill.modes.includes('invention')) expect(skill.interactions, skill.id).toContain('build');
      const reports = skill.interactions.includes('choice') || skill.interactions.includes('number');
      if (skill.modes.includes('mission')) expect(reports, `${skill.id} mission needs choice or number`).toBe(true);
    }
  });

  it('offers every mode on at least 4 skills, and story and studio on at least 10', () => {
    for (const mode of MODES) {
      if (mode === 'quest') continue;
      const count = SKILLS.filter((s) => s.modes.includes(mode)).length;
      expect(count, mode).toBeGreaterThanOrEqual(mode === 'story' || mode === 'studio' ? 10 : 4);
    }
  });

  it('has only known prerequisites in the same strand and no cycles', () => {
    for (const skill of SKILLS) {
      for (const id of skill.prerequisites) {
        const pre = getSkill(id);
        expect(pre, `${skill.id} -> ${id}`).toBeDefined();
        expect(id).not.toBe(skill.id);
      }
    }
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === 'done') return;
      if (state.get(id) === 'visiting') throw new Error(`prerequisite cycle: ${[...trail, id].join(' -> ')}`);
      state.set(id, 'visiting');
      for (const next of getSkill(id)?.prerequisites ?? []) visit(next, [...trail, id]);
      state.set(id, 'done');
    };
    expect(() => SKILLS.forEach((s) => visit(s.id, []))).not.toThrow();
  });

  it('never needs a prerequisite that starts later than the skill itself', () => {
    for (const skill of SKILLS) {
      const first = GRADES.indexOf(skillGrades(skill)[0] as Grade);
      for (const id of skill.prerequisites) {
        const pre = getSkill(id) as SkillDef;
        expect(GRADES.indexOf(skillGrades(pre)[0] as Grade), `${skill.id} -> ${id}`).toBeLessThanOrEqual(first);
      }
    }
  });
});

describe('skill map helpers', () => {
  it('finds skills by id and strand', () => {
    expect(getSkill('math-addition-subtraction')?.strand).toBe('math');
    expect(getSkill('nope')).toBeUndefined();
    expect(skillsForStrand('science').every((s) => s.strand === 'science')).toBe(true);
  });

  it('lists the grades of a skill in ascending order', () => {
    const skill = getSkill('math-addition-subtraction') as SkillDef;
    expect(skillGrades(skill)).toEqual(['PK', 'K', '1', '2', '3', '4']);
    expect(skillExistsAt(skill, '4')).toBe(true);
    expect(skillExistsAt(skill, '5')).toBe(false);
    expect(skillGrades(fake(['5', '3', '4']))).toEqual(['3', '4', '5']);
  });

  it('returns the expectation of the stage grade when the skill exists there', () => {
    const skill = getSkill('math-addition-subtraction') as SkillDef;
    expect(expectationAt(skill, makeStage('1', 'strong'))).toEqual({ grade: '1', text: 'Add and subtract within 20' });
  });

  it('falls back to the nearest grade of the skill', () => {
    const skill = fake(['3', '4', '5']);
    expect(expectationAt(skill, makeStage('PK')).grade).toBe('3');
    expect(expectationAt(skill, makeStage('8', 'ready')).grade).toBe('5');
    expect(expectationAt(skill, makeStage('8', 'ready')).text).toBe('Expectation for 5');
    const gappy = fake(['1', '5']);
    expect(expectationAt(gappy, makeStage('2')).grade).toBe('1');
    expect(expectationAt(gappy, makeStage('4')).grade).toBe('5');
    expect(expectationAt(gappy, makeStage('3')).grade).toBe('1'); // a tie goes to the lower grade
  });

  it('clamps a stage into the grade range of the skill', () => {
    const skill = fake(['3', '4', '5']);
    expect(clampStageToSkill(skill, makeStage('4', 'growing'))).toBe(makeStage('4', 'growing'));
    expect(clampStageToSkill(skill, makeStage('K', 'strong'))).toBe(makeStage('3', 'starting'));
    expect(clampStageToSkill(skill, makeStage('8', 'starting'))).toBe(makeStage('5', 'ready'));
    expect(clampStageToSkill(skill, -5)).toBe(makeStage('3', 'starting'));
    expect(clampStageToSkill(skill, 999)).toBe(makeStage('5', 'ready'));
  });

  it('clamps a stage inside a gap to the nearest grade of the skill', () => {
    const gappy = fake(['1', '5']);
    expect(clampStageToSkill(gappy, makeStage('2', 'strong'))).toBe(makeStage('1', 'ready'));
    expect(clampStageToSkill(gappy, makeStage('4', 'strong'))).toBe(makeStage('5', 'starting'));
  });

  it('always lands on a grade where the skill exists, for every real skill and stage', () => {
    for (const skill of SKILLS) {
      for (let stage = 0; stage < GRADES.length * 4; stage += 1) {
        const out = clampStageToSkill(skill, stage);
        expect(skillExistsAt(skill, stageGrade(out)), `${skill.id} @ ${stage}`).toBe(true);
        if (skillExistsAt(skill, stageGrade(stage))) expect(out).toBe(stage);
        expect(expectationAt(skill, out).grade).toBe(stageGrade(out));
        expect(stageGradeIndex(out)).toBeGreaterThanOrEqual(0);
        expect(['starting', 'growing', 'strong', 'ready']).toContain(stageStep(out));
      }
    }
  });

  it('copes with a skill that has no grades at all', () => {
    const empty = fake([]);
    expect(clampStageToSkill(empty, 17)).toBe(17);
    expect(expectationAt(empty, 17).text).toBe('A skill for tests.');
  });
});
