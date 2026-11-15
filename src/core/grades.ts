import {
  GRADES,
  STAGE_STEPS,
  type AgeGroup,
  type Grade,
  type StageStep,
  type StageValue,
} from './types';

export const STEPS_PER_GRADE = STAGE_STEPS.length; // 4
export const MIN_STAGE: StageValue = 0;
export const MAX_STAGE: StageValue = GRADES.length * STEPS_PER_GRADE - 1; // 39

export function gradeIndex(grade: Grade): number {
  return GRADES.indexOf(grade);
}

export function gradeAt(index: number): Grade {
  const clamped = Math.max(0, Math.min(GRADES.length - 1, Math.round(index)));
  return GRADES[clamped] as Grade;
}

export function clampStage(stage: number): StageValue {
  return Math.max(MIN_STAGE, Math.min(MAX_STAGE, Math.round(stage)));
}

/**
 * The stage for a grade and a step. A grade or step that is not one of the known values
 * (possible when the value came from storage or an untyped caller) counts as the lowest
 * one, so the result is always a valid stage and never slips into the grade below.
 */
export function makeStage(grade: Grade, step: StageStep = 'starting'): StageValue {
  return Math.max(0, gradeIndex(grade)) * STEPS_PER_GRADE + Math.max(0, STAGE_STEPS.indexOf(step));
}

export function stageGrade(stage: StageValue): Grade {
  return gradeAt(Math.floor(clampStage(stage) / STEPS_PER_GRADE));
}

export function stageGradeIndex(stage: StageValue): number {
  return Math.floor(clampStage(stage) / STEPS_PER_GRADE);
}

export function stageStep(stage: StageValue): StageStep {
  return STAGE_STEPS[clampStage(stage) % STEPS_PER_GRADE] as StageStep;
}

const GRADE_LABELS: Record<Grade, string> = {
  PK: 'Pre-K',
  K: 'Kindergarten',
  '1': 'Grade 1',
  '2': 'Grade 2',
  '3': 'Grade 3',
  '4': 'Grade 4',
  '5': 'Grade 5',
  '6': 'Grade 6',
  '7': 'Grade 7',
  '8': 'Grade 8',
};

const STEP_LABELS: Record<StageStep, string> = {
  starting: 'Starting',
  growing: 'Growing',
  strong: 'Strong',
  ready: 'Ready for next grade',
};

export function gradeLabel(grade: Grade): string {
  return GRADE_LABELS[grade];
}

export function stepLabel(step: StageStep): string {
  return STEP_LABELS[step];
}

/** e.g. "Grade 3, Strong" */
export function stageLabel(stage: StageValue): string {
  return `${gradeLabel(stageGrade(stage))}, ${stepLabel(stageStep(stage))}`;
}

/** Typical age group for a grade. Used to suggest a default in the profile form. */
export function ageGroupForGrade(grade: Grade): AgeGroup {
  const i = gradeIndex(grade);
  if (i <= 1) return '3-5'; // PK, K
  if (i <= 4) return '6-8'; // 1-3
  if (i <= 7) return '9-11'; // 4-6
  return '12-14'; // 7-8
}

/** Typical grade for an age group. Used to suggest a default in the profile form. */
export function defaultGradeForAgeGroup(age: AgeGroup): Grade {
  switch (age) {
    case '3-5':
      return 'PK';
    case '6-8':
      return '1';
    case '9-11':
      return '4';
    case '12-14':
      return '7';
  }
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(at: number | Date = Date.now()): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function newId(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}
