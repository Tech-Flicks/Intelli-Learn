import { describe, expect, it } from 'vitest';
import { MAX_STAGE, clampStage, makeStage, stageGrade, stageLabel, stageStep, ageGroupForGrade } from './grades';

describe('grades', () => {
  it('encodes grade and step into one stage value', () => {
    expect(makeStage('PK', 'starting')).toBe(0);
    expect(makeStage('3', 'strong')).toBe(4 * 4 + 2);
    expect(makeStage('8', 'ready')).toBe(MAX_STAGE);
  });
  it('decodes a stage value', () => {
    const s = makeStage('3', 'strong');
    expect(stageGrade(s)).toBe('3');
    expect(stageStep(s)).toBe('strong');
    expect(stageLabel(s)).toBe('Grade 3, Strong');
  });
  it('clamps out-of-range stages', () => {
    expect(clampStage(-5)).toBe(0);
    expect(clampStage(999)).toBe(MAX_STAGE);
  });
  it('suggests an age group for a grade', () => {
    expect(ageGroupForGrade('K')).toBe('3-5');
    expect(ageGroupForGrade('2')).toBe('6-8');
    expect(ageGroupForGrade('5')).toBe('9-11');
    expect(ageGroupForGrade('8')).toBe('12-14');
  });
});
