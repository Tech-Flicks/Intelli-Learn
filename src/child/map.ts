/**
 * The adventure map: one world per enabled strand, each a short trail of stops.
 *
 * A trail shows the four steps of the grade the child is working at in that strand, and
 * ends at a gate to the next grade. Pure logic; `AdventureMap.tsx` draws it.
 */
import { gradeAt, makeStage, stageGrade, stageGradeIndex, stageStep } from '@/core/grades';
import { GRADES, STAGE_STEPS } from '@/core/types';
import { enabledStrands } from '@/progression';
import type { Grade, ParentalControls, StageStep, StageValue, Strand, StrandStage } from '@/core/types';

export type StopState = 'done' | 'current' | 'ahead';

export interface MapStop {
  /** A step of the grade, or the gate to the next grade at the end of the trail. */
  kind: 'step' | 'gate';
  state: StopState;
  /** The step this stop stands for. Null for the gate. */
  step: StageStep | null;
}

export interface WorldView {
  strand: Strand;
  /** False until the child has practised something in this strand. */
  explored: boolean;
  /** Where the child stands: the strand's stage, or the start of the enrolled grade in a new world. */
  stage: StageValue;
  grade: Grade;
  /** The grade behind the gate, or null at the top of the map (grade 8). */
  nextGrade: Grade | null;
  /** Four steps and the gate, in walking order. */
  stops: MapStop[];
}

/** The strands the child may play: the rule lives in `@/progression`, which plans by it as well. */
export { enabledStrands };

export function buildWorld(strand: Strand, strandStage: StageValue | null, enrolledGrade: Grade): WorldView {
  const explored = strandStage !== null;
  const stage = strandStage ?? makeStage(enrolledGrade, 'starting');
  const grade = stageGrade(stage);
  const currentStep = STAGE_STEPS.indexOf(stageStep(stage));
  const gradeNumber = stageGradeIndex(stage);
  const nextGrade = gradeNumber < GRADES.length - 1 ? gradeAt(gradeNumber + 1) : null;

  const stops: MapStop[] = STAGE_STEPS.map((step, index) => ({
    kind: 'step',
    step,
    state: index < currentStep ? 'done' : index === currentStep ? 'current' : 'ahead',
  }));
  stops.push({ kind: 'gate', step: null, state: 'ahead' });

  return { strand, explored, stage, grade, nextGrade, stops };
}

/** The worlds of the map for one child: one per enabled strand, in strand order. */
export function buildWorlds(
  controls: Pick<ParentalControls, 'strands'>,
  strandStages: readonly StrandStage[],
  enrolledGrade: Grade,
): WorldView[] {
  return enabledStrands(controls).map((strand) => {
    const found = strandStages.find((entry) => entry.strand === strand);
    return buildWorld(strand, found?.stage ?? null, enrolledGrade);
  });
}

/** Where each of the five stops sits on the trail, in the 320 x 112 drawing of a world. */
export const TRAIL_POINTS: readonly { x: number; y: number }[] = [
  { x: 40, y: 76 },
  { x: 100, y: 44 },
  { x: 160, y: 76 },
  { x: 220, y: 44 },
  { x: 280, y: 76 },
];

export const TRAIL_VIEWBOX = { width: 320, height: 112 } as const;

/** The winding trail through the stops as an SVG path. */
export function trailPath(points: readonly { x: number; y: number }[] = TRAIL_POINTS): string {
  const first = points[0];
  if (!first) return '';
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    const bend = (to.x - from.x) / 2;
    path += ` C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  }
  return path;
}
