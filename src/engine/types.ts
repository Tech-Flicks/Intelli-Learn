/**
 * Answer shapes produced by the interaction widgets and understood by
 * `checkAnswer`. See the table in docs/ARCHITECTURE.md.
 */
export type RobotStep =
  | { cmd: 'forward' | 'left' | 'right' }
  | { cmd: 'repeat'; times: number; body: RobotStep[] };

export type RobotProgram = RobotStep[];

export type Answer = string[] | Record<string, string> | number | RobotProgram;

export interface CheckResult {
  correct: boolean;
  /** Kind feedback for a wrong answer when known (e.g. the chosen option's misconception). */
  misconception: string | null;
  /** 0..1 share of the answer that was right, for partial-credit style feedback. */
  progress: number;
}
