/**
 * School-grade stage displays, shared by the child and parent areas.
 * A stage is "grade + step": e.g. Grade 3, Strong (step 3 of 4).
 */
import type { HTMLAttributes } from 'react';
import { stageGrade, stageStep, STEPS_PER_GRADE } from '@/core/grades';
import { STAGE_STEPS, type StageValue } from '@/core/types';
import { gradeName, gradeShortName, stageName, stepName, useT } from '@/i18n';
import { Badge, type BadgeTone } from './Chip';
import { clamp, cx } from './cx';
import './strings';

const STEP_TONE: readonly BadgeTone[] = ['neutral', 'info', 'brand', 'success'];
const STEP_EMOJI: readonly string[] = ['🌱', '🌿', '🌳', '🚀'];

export interface StageBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  stage: StageValue;
  /** "G3" instead of "Grade 3, Strong". The full name stays available to screen readers. */
  short?: boolean;
  size?: 'sm' | 'md';
}

/** A pill that names a stage: "🌳 Grade 3, Strong". The colour follows the step. */
export function StageBadge({ stage, short = false, size = 'sm', ...rest }: StageBadgeProps) {
  useT(); // re-render on locale change
  const stepIndex = STAGE_STEPS.indexOf(stageStep(stage));
  const full = stageName(stage);
  return (
    <Badge tone={STEP_TONE[stepIndex] ?? 'neutral'} emoji={STEP_EMOJI[stepIndex]} size={size} title={short ? full : undefined} {...rest}>
      {short ? (
        <>
          <span aria-hidden="true">{gradeShortName(stageGrade(stage))}</span>
          <span className="sr-only">{full}</span>
        </>
      ) : (
        full
      )}
    </Badge>
  );
}

export interface StageStepsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  stage: StageValue;
  /** 0-100 progress inside the current step. Fills the current block partly. */
  mastery?: number;
  /** Show the grade and step names above the blocks. Default true. */
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const BLOCK = { sm: 'h-2', md: 'h-3', lg: 'h-5' } as const;

/**
 * The four steps of a grade as blocks: finished steps are full, the current
 * one fills with mastery, later ones are empty. Reads as
 * "Grade 3, Strong. Step 3 of 4".
 */
export function StageSteps({ stage, mastery, showLabel = true, size = 'md', className, ...rest }: StageStepsProps) {
  const t = useT();
  const grade = stageGrade(stage);
  const step = stageStep(stage);
  const stepIndex = STAGE_STEPS.indexOf(step);
  const share = mastery === undefined ? 1 : clamp(mastery, 0, 100) / 100;
  const spoken = `${stageName(stage)}. ${t('ui.stepOf', { index: stepIndex + 1, total: STEPS_PER_GRADE })}`;
  return (
    <div role="img" aria-label={spoken} {...rest} className={cx('w-full', className)}>
      {showLabel && (
        <div aria-hidden="true" className="mb-1 flex items-baseline justify-between gap-3 text-sm font-bold">
          <span>{gradeName(grade)}</span>
          <span className="font-semibold opacity-80">
            {STEP_EMOJI[stepIndex]} {stepName(step)}
          </span>
        </div>
      )}
      <div aria-hidden="true" className={cx('flex w-full gap-1', BLOCK[size])}>
        {STAGE_STEPS.map((name, index) => {
          const fill = index < stepIndex ? 1 : index === stepIndex ? Math.max(share, 0.12) : 0;
          return (
            <div key={name} className="h-full flex-1 overflow-hidden rounded-full border border-ink-200 bg-ink-100">
              <div
                className={cx('h-full rounded-full transition-[width] duration-500 ease-out', index === STAGE_STEPS.length - 1 ? 'bg-leaf-600' : 'bg-brand-500')}
                style={{ width: `${Math.round(fill * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
