/**
 * The grade-mapped skill map: about 40 skills across the five strands, each with a concrete
 * expectation for every school grade (Pre-K to Grade 8) where the skill is taught.
 */
import { clampStage, gradeIndex, makeStage, stageGradeIndex } from '../grades';
import { GRADES, type Grade, type SkillDef, type StageValue, type Strand } from '../types';
import { ENGINEERING_SKILLS } from './engineering';
import { LOGIC_SKILLS } from './logic';
import { MATH_SKILLS } from './math';
import { SCIENCE_SKILLS } from './science';
import { TECHNOLOGY_SKILLS } from './technology';

export const SKILLS: SkillDef[] = [
  ...MATH_SKILLS,
  ...SCIENCE_SKILLS,
  ...TECHNOLOGY_SKILLS,
  ...ENGINEERING_SKILLS,
  ...LOGIC_SKILLS,
];

const BY_ID = new Map<string, SkillDef>(SKILLS.map((skill) => [skill.id, skill]));

export function getSkill(id: string): SkillDef | undefined {
  return BY_ID.get(id);
}

export function skillsForStrand(strand: Strand): SkillDef[] {
  return SKILLS.filter((skill) => skill.strand === strand);
}

/** Grades where the skill exists, ascending. */
export function skillGrades(skill: SkillDef): Grade[] {
  return GRADES.filter((grade) => typeof skill.gradeExpectations[grade] === 'string');
}

export function skillExistsAt(skill: SkillDef, grade: Grade): boolean {
  return typeof skill.gradeExpectations[grade] === 'string';
}

/**
 * The grade where the skill exists that is closest to the given grade index.
 * A tie goes to the lower grade, so a child is never pushed ahead by a gap.
 */
function nearestSkillGrade(skill: SkillDef, index: number): Grade | undefined {
  let best: Grade | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const grade of skillGrades(skill)) {
    const distance = Math.abs(gradeIndex(grade) - index);
    if (distance < bestDistance) {
      best = grade;
      bestDistance = distance;
    }
  }
  return best;
}

/** Expectation text for the stage's grade, or the nearest grade where the skill exists. */
export function expectationAt(skill: SkillDef, stage: StageValue): { grade: Grade; text: string } {
  const index = stageGradeIndex(stage);
  const grade = nearestSkillGrade(skill, index) ?? (GRADES[index] as Grade);
  return { grade, text: skill.gradeExpectations[grade] ?? skill.description };
}

/**
 * Clamp a stage into the range of grades where the skill exists. A stage below the range becomes
 * the first step of the skill's lowest grade, a stage above it the last step of its highest
 * grade. A stage that is already at a grade of the skill is returned unchanged.
 */
export function clampStageToSkill(skill: SkillDef, stage: StageValue): StageValue {
  const clamped = clampStage(stage);
  const index = stageGradeIndex(clamped);
  const nearest = nearestSkillGrade(skill, index);
  if (nearest === undefined) return clamped;
  const nearestIndex = gradeIndex(nearest);
  if (nearestIndex === index) return clamped;
  return nearestIndex > index ? makeStage(nearest, 'starting') : makeStage(nearest, 'ready');
}
