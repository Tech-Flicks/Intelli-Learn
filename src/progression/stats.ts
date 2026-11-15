/**
 * Read-only views for the home screen and the parent dashboard.
 */
import Dexie from 'dexie';
import { dayKey } from '@/core/grades';
import { STRANDS } from '@/core/types';
import type { StrandStage, WeeklyReport } from '@/core/types';
import { db } from '@/data';
import { aggregateStrandStage } from './mastery';

/** The aggregated working stage of every strand, in the fixed strand order. */
export async function getStrandStages(childId: string): Promise<StrandStage[]> {
  const states = await db.skillStates.where('childId').equals(childId).toArray();
  return STRANDS.map((strand) => {
    const { stage, practisedSkills } = aggregateStrandStage(states, strand);
    return { strand, stage, practisedSkills };
  });
}

/** YYYY-MM-DD of the Monday that starts the local week containing `now`. */
export function weekStartOf(now: number = Date.now()): string {
  const date = new Date(now);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday));
}

function parseDay(day: string): { year: number; month: number; date: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Not a YYYY-MM-DD day: ${day}`);
  return { year: Number(match[1]), month: Number(match[2]) - 1, date: Number(match[3]) };
}

/**
 * Numbers for the weekly report: the seven local days starting at `weekStart`.
 * - minutes: active play time
 * - completed: challenges solved
 * - independentShare: share solved without help (first try or after trying again), 0..1
 * - stageUps: times a strand's level went up through learning (placement and parent changes do not count)
 */
export async function weekStats(childId: string, weekStart: string): Promise<WeeklyReport['stats']> {
  const { year, month, date } = parseDay(weekStart);
  const from = new Date(year, month, date).getTime();
  const to = new Date(year, month, date + 7).getTime();
  const days = Array.from({ length: 7 }, (_, offset) => dayKey(new Date(year, month, date + offset)));

  const sessions = await db.sessions
    .where('[childId+day]')
    .anyOf(days.map((day) => [childId, day]))
    .toArray();
  const activeMs = sessions.reduce((sum, session) => sum + Math.max(0, session.activeMs), 0);

  const attempts = await db.attempts
    .where('[childId+completedAt]')
    .between([childId, from], [childId, to], true, false)
    .toArray();
  const alone = attempts.filter((a) => a.outcome === 'independent' || a.outcome === 'second-try').length;

  const stageUps = await db.stageChanges
    .where('[childId+strand]')
    .between([childId, Dexie.minKey], [childId, Dexie.maxKey])
    .filter(
      (change) =>
        change.skillId === null &&
        change.reason === 'mastery' &&
        change.to > change.from &&
        change.at >= from &&
        change.at < to,
    )
    .count();

  return {
    minutes: Math.round(activeMs / 60_000),
    completed: attempts.length,
    independentShare: attempts.length === 0 ? 0 : alone / attempts.length,
    stageUps,
  };
}
