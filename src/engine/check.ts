/** Deterministic answer checking for every interaction kind. Pure logic. */
import type {
  BuildInteraction,
  ChoiceInteraction,
  Interaction,
  MatchInteraction,
  NumberInteraction,
  OrderInteraction,
  RobotInteraction,
  SortInteraction,
  TapInteraction,
} from '@/core/schemas';
import { buildTotals } from './build';
import { isRobotProgram, runRobotDetailed } from './robot';
import { signatureOf } from './shuffle';
import type { Answer, CheckResult } from './types';

const WRONG: CheckResult = { correct: false, misconception: null, progress: 0 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

/** Share of overlap between what was picked and what should be picked. */
function setScore(picked: readonly string[], wanted: readonly string[]): { correct: boolean; progress: number } {
  const pickedSet = new Set(picked);
  const wantedSet = new Set(wanted);
  let hits = 0;
  for (const id of pickedSet) if (wantedSet.has(id)) hits += 1;
  const union = pickedSet.size + wantedSet.size - hits;
  const correct = wantedSet.size > 0 && hits === wantedSet.size && pickedSet.size === wantedSet.size;
  return { correct, progress: union === 0 ? 0 : hits / union };
}

function checkChoice(i: ChoiceInteraction, answer: Answer): CheckResult {
  if (!isStringArray(answer)) return WRONG;
  const known = new Set(i.options.map((o) => o.id));
  const picked = answer.filter((id) => known.has(id));
  const hasUnknown = picked.length !== answer.length;
  const score = setScore(picked, i.correctIds);
  const correct = score.correct && !hasUnknown;
  let misconception: string | null = null;
  if (!correct) {
    const right = new Set(i.correctIds);
    for (const id of picked) {
      if (!right.has(id)) {
        const text = i.options.find((o) => o.id === id)?.misconception?.trim();
        misconception = text ? text : null;
        break; // the first chosen wrong option decides
      }
    }
  }
  return { correct, misconception, progress: correct ? 1 : Math.min(score.progress, 0.99) };
}

function checkTap(i: TapInteraction, answer: Answer): CheckResult {
  if (!isStringArray(answer)) return WRONG;
  const score = setScore(answer, i.targetIds);
  return { correct: score.correct, misconception: null, progress: score.progress };
}

function checkSort(i: SortInteraction, answer: Answer): CheckResult {
  if (!isStringRecord(answer)) return WRONG;
  let right = 0;
  for (const item of i.items) {
    if (answer[item.id] === item.binId) right += 1;
  }
  const total = i.items.length;
  return { correct: total > 0 && right === total, misconception: null, progress: total ? right / total : 0 };
}

function checkMatch(i: MatchInteraction, answer: Answer): CheckResult {
  if (!isStringRecord(answer)) return WRONG;
  const byId = new Map(i.pairs.map((p) => [p.id, p]));
  const usedRights = new Set<string>();
  let right = 0;
  for (const pair of i.pairs) {
    const chosenId = answer[pair.id];
    if (chosenId === undefined || usedRights.has(chosenId)) continue; // each right side may be used once
    const chosen = byId.get(chosenId);
    if (!chosen) continue;
    usedRights.add(chosenId);
    // Two right-hand cards that look identical are interchangeable.
    if (chosenId === pair.id || signatureOf(chosen.right) === signatureOf(pair.right)) right += 1;
  }
  const total = i.pairs.length;
  return { correct: total > 0 && right === total, misconception: null, progress: total ? right / total : 0 };
}

function checkOrder(i: OrderInteraction, answer: Answer): CheckResult {
  if (!isStringArray(answer)) return WRONG;
  const byId = new Map(i.items.map((item) => [item.id, item]));
  const total = i.items.length;
  const isPermutation =
    answer.length === total && new Set(answer).size === total && answer.every((id) => byId.has(id));
  let right = 0;
  i.items.forEach((item, index) => {
    const placedId = answer[index];
    const placed = placedId === undefined ? undefined : byId.get(placedId);
    // Items that look identical (e.g. two cards showing "5") may swap places.
    if (placed && (placed.id === item.id || signatureOf(placed) === signatureOf(item))) right += 1;
  });
  const correct = isPermutation && right === total;
  const progress = total ? right / total : 0;
  return { correct, misconception: null, progress: correct ? 1 : Math.min(progress, isPermutation ? 1 : 0.99) };
}

function checkNumber(i: NumberInteraction, answer: Answer): CheckResult {
  if (typeof answer !== 'number' || !Number.isFinite(answer) || !Number.isFinite(i.answer)) return WRONG;
  const tolerance = Number.isFinite(i.tolerance) && i.tolerance > 0 ? i.tolerance : 0;
  // A tiny relative epsilon so 0.1 + 0.2 style answers are not marked wrong.
  const eps = 1e-9 * Math.max(1, Math.abs(i.answer), Math.abs(answer));
  const correct = Math.abs(answer - i.answer) <= tolerance + eps;
  return { correct, misconception: null, progress: correct ? 1 : 0 };
}

function checkRobot(i: RobotInteraction, answer: Answer): CheckResult {
  if (!isRobotProgram(answer)) return WRONG;
  const run = runRobotDetailed(i, answer);
  if (run.reached) return { correct: true, misconception: null, progress: 1 };
  const last = run.steps[run.steps.length - 1];
  const onGoal = !run.crashed && last !== undefined && last.x === i.goal.x && last.y === i.goal.y;
  const uniqueGems = new Set(i.gems.map((g) => `${g.x},${g.y}`)).size;
  // Each gem and the goal are one milestone each. A run that is not correct never shows as complete.
  const progress = (run.gems + (onGoal ? 1 : 0)) / (uniqueGems + 1);
  return { correct: false, misconception: null, progress: Math.min(clamp01(progress), 0.9) };
}

function checkBuild(i: BuildInteraction, answer: Answer): CheckResult {
  if (!isStringArray(answer)) return WRONG;
  const totals = buildTotals(i, answer);
  const correct = totals.meetsTarget && totals.withinBudget && answer.length > 0;
  if (correct) return { correct: true, misconception: null, progress: 1 };
  const powerShare = i.target > 0 ? clamp01(totals.power / i.target) : 1;
  const costShare = totals.withinBudget || totals.cost <= 0 ? 1 : clamp01(i.budget / totals.cost);
  return { correct: false, misconception: null, progress: Math.min(powerShare * costShare, 0.99) };
}

/**
 * Checks an answer. Never throws: an answer of the wrong shape is simply not
 * correct. `progress` is the share of the answer that was right.
 */
export function checkAnswer(interaction: Interaction, answer: Answer): CheckResult {
  switch (interaction.kind) {
    case 'choice':
      return checkChoice(interaction, answer);
    case 'tap':
      return checkTap(interaction, answer);
    case 'sort':
      return checkSort(interaction, answer);
    case 'match':
      return checkMatch(interaction, answer);
    case 'order':
      return checkOrder(interaction, answer);
    case 'number':
      return checkNumber(interaction, answer);
    case 'robot':
      return checkRobot(interaction, answer);
    case 'build':
      return checkBuild(interaction, answer);
    default:
      return WRONG;
  }
}
