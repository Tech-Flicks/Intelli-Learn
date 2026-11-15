/** What the child did today, for the rest screen. */
import { db } from '@/data';

export interface TodaySummary {
  /** Challenges solved today. */
  items: number;
  /** Stars earned today. Stars spent in the shop do not count against it. */
  stars: number;
}

/** Reads only: safe inside a live query. */
export async function getTodaySummary(childId: string, now: number = Date.now()): Promise<TodaySummary> {
  const day = new Date(now);
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const attempts = await db.attempts
    .where('[childId+completedAt]')
    .between([childId, from], [childId, to], true, false)
    .toArray();
  return {
    items: attempts.length,
    stars: attempts.reduce((sum, attempt) => sum + Math.max(0, attempt.starsEarned), 0),
  };
}

/** A clock time for a whole hour in the given language, e.g. "7:00 AM". */
export function formatHour(hour: number, locale: string): string {
  const safe = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 0;
  const at = new Date(2020, 0, 1, safe, 0, 0, 0);
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);
  } catch {
    return `${safe}:00`;
  }
}
