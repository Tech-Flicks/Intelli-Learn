/** Turns a strand's `StageChange` rows into the points of a small step chart. Pure. */
import { MAX_STAGE, MIN_STAGE } from '@/core/grades';
import type { StageChange, StageValue } from '@/core/types';

export interface StagePoint {
  at: number;
  stage: StageValue;
}

/**
 * The stage over time for one strand: where it started, every change, and where it is
 * now. `current` is the live value from `getStrandStages`, which may differ from the last
 * stored row by one step. Empty when nothing has been practised.
 */
export function stageSeries(changes: readonly StageChange[], current: StageValue | null, now: number): StagePoint[] {
  const sorted = [...changes].sort((a, b) => a.at - b.at);
  const points: StagePoint[] = [];
  const first = sorted[0];
  if (first) points.push({ at: first.at, stage: first.from });
  for (const change of sorted) points.push({ at: change.at, stage: change.to });
  if (current !== null) {
    const last = points[points.length - 1];
    points.push({ at: Math.max(now, last?.at ?? now), stage: current });
  }
  return points;
}

export interface ChartGeometry {
  /** SVG path of the step line. */
  path: string;
  /** Where each point sits, in the same order as the input. */
  dots: { x: number; y: number }[];
}

/**
 * Lays the points out as a step line inside a `width` x `height` box with `pad` around it.
 * The stage axis always spans at least one whole grade (four steps), so a single step up
 * does not look like a leap.
 */
export function chartGeometry(points: readonly StagePoint[], width: number, height: number, pad: number): ChartGeometry {
  if (points.length === 0) return { path: '', dots: [] };
  const stages = points.map((point) => point.stage);
  let low = Math.min(...stages);
  let high = Math.max(...stages);
  while (high - low < 4) {
    if (low > MIN_STAGE) low -= 1;
    if (high - low < 4 && high < MAX_STAGE) high += 1;
    if (low === MIN_STAGE && high === MAX_STAGE) break;
  }
  const firstAt = points[0]?.at ?? 0;
  const lastAt = points[points.length - 1]?.at ?? firstAt;
  const span = lastAt - firstAt;
  const x = (at: number) => (span <= 0 ? width / 2 : pad + ((at - firstAt) / span) * (width - 2 * pad));
  const y = (stage: number) => height - pad - ((stage - low) / Math.max(1, high - low)) * (height - 2 * pad);
  const round = (value: number) => Math.round(value * 10) / 10;

  const dots = points.map((point) => ({ x: round(x(point.at)), y: round(y(point.stage)) }));
  let path = '';
  dots.forEach((dot, index) => {
    if (index === 0) {
      path = `M${dot.x} ${dot.y}`;
      return;
    }
    const previous = dots[index - 1];
    // A step chart: the level holds until the moment it changes.
    if (previous && previous.y !== dot.y && previous.x !== dot.x) path += ` L${dot.x} ${previous.y}`;
    path += ` L${dot.x} ${dot.y}`;
  });
  return { path, dots };
}
