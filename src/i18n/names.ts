/** Localized names for the shared domain enumerations. Everything goes through `t()`. */
import './common';
import { stageGrade, stageStep } from '@/core/grades';
import type { AgeGroup, Grade, Mode, StageStep, StageValue, Strand } from '@/core/types';
import { t, tn } from './core';

/** "Grade 3", "Tercer grado", "कक्षा 3" */
export function gradeName(grade: Grade): string {
  return t(`grade.${grade}`);
}

/** Compact grade name for chips and badges: "G3", "3.º". */
export function gradeShortName(grade: Grade): string {
  return t(`grade.short.${grade}`);
}

/** "Starting", "Growing", "Strong", "Ready for next grade" */
export function stepName(step: StageStep): string {
  return t(`step.${step}`);
}

/** One sentence that explains the step to a parent. */
export function stepBlurb(step: StageStep): string {
  return t(`step.${step}.blurb`);
}

/** Full stage name from a stage value, e.g. "Grade 3, Strong". */
export function stageName(stage: StageValue): string {
  return t('stage.label', { grade: gradeName(stageGrade(stage)), step: stepName(stageStep(stage)) });
}

export function strandName(strand: Strand): string {
  return t(`strand.${strand}`);
}

export function ageGroupName(age: AgeGroup): string {
  return t(`age.${age}`);
}

export function modeName(mode: Mode): string {
  return t(`mode.${mode}`);
}

/** One child-friendly line that says what happens in the mode. */
export function modeBlurb(mode: Mode): string {
  return t(`mode.${mode}.blurb`);
}

/** "1 star", "3 stars" in the active locale. */
export function starCountText(count: number): string {
  return tn('common.star', 'common.stars', count);
}
