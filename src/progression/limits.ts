/**
 * Parental limits: which controls apply to a child, how much play time is
 * left today, and the session records that the time is counted in.
 */
import { dayKey, newId } from '@/core/grades';
import { STRANDS } from '@/core/types';
import type { ChildProfile, ParentalControls, PlayAllowance, SessionRecord, Settings, Strand } from '@/core/types';
import { db, getSettings } from '@/data';
import { TUNING } from './tuning';

const MINUTE_MS = 60_000;

/** The device-wide controls with this child's overrides applied on top. */
export function effectiveControls(settings: Settings, child: ChildProfile): ParentalControls {
  const base = settings.controls;
  const override = child.controlsOverride ?? {};
  const merged: ParentalControls = { ...base, strands: { ...base.strands } };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || key === 'strands') continue;
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  if (override.strands) {
    for (const strand of STRANDS) {
      const value = override.strands[strand];
      if (typeof value === 'boolean') merged.strands[strand] = value;
    }
  }
  return merged;
}

/** The strands the child may play, in the fixed strand order. All of them when a parent disabled every one. */
export function enabledStrands(controls: ParentalControls): Strand[] {
  const enabled = STRANDS.filter((strand) => controls.strands[strand] !== false);
  return enabled.length > 0 ? enabled : [...STRANDS];
}

/**
 * Whether `hour` (0-23) is inside the allowed window. The window normally
 * runs from start (inclusive) to end (exclusive). A window that wraps past
 * midnight (start after end) is honoured, and an empty one (start equals end)
 * counts as the whole day so a slip in the settings cannot lock a child out.
 */
export function isWithinHours(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

/** Whole minutes from `now` until the allowed window closes. */
function minutesUntilWindowEnd(now: number, startHour: number, endHour: number): number {
  const date = new Date(now);
  const end = new Date(now);
  const wholeDay = startHour === endHour;
  const closingHour = wholeDay ? 24 : endHour;
  end.setHours(closingHour, 0, 0, 0);
  if (!wholeDay && startHour > endHour && date.getHours() >= startHour) end.setDate(end.getDate() + 1);
  return Math.max(0, Math.floor((end.getTime() - now) / MINUTE_MS));
}

/** Pure allowance rule, given the active milliseconds already played today. */
export function allowanceFor(controls: ParentalControls, activeMsToday: number, now: number): PlayAllowance {
  const minutesUsedToday = Math.floor(Math.max(0, activeMsToday) / MINUTE_MS);
  const hour = new Date(now).getHours();
  if (!isWithinHours(hour, controls.allowedStartHour, controls.allowedEndHour)) {
    return { allowed: false, reason: 'outside-hours', minutesLeft: 0, minutesUsedToday };
  }
  const untilClose = minutesUntilWindowEnd(now, controls.allowedStartHour, controls.allowedEndHour);
  if (controls.dailyMinutes <= 0) {
    // 0 means no daily limit: only the allowed hours end the day.
    return { allowed: true, reason: 'ok', minutesLeft: Math.max(1, untilClose), minutesUsedToday };
  }
  const leftMs = controls.dailyMinutes * MINUTE_MS - Math.max(0, activeMsToday);
  if (leftMs <= 0) return { allowed: false, reason: 'daily-limit', minutesLeft: 0, minutesUsedToday };
  const minutesLeft = Math.min(Math.ceil(leftMs / MINUTE_MS), Math.max(1, untilClose));
  return { allowed: true, reason: 'ok', minutesLeft, minutesUsedToday };
}

export async function getPlayAllowance(childId: string, now: number = Date.now()): Promise<PlayAllowance> {
  const child = await db.children.get(childId);
  if (!child) throw new Error(`Child profile not found: ${childId}`);
  const controls = effectiveControls(await getSettings(), child);
  const sessions = await db.sessions.where('[childId+day]').equals([childId, dayKey(now)]).toArray();
  const activeMs = sessions.reduce((sum, session) => sum + Math.max(0, session.activeMs), 0);
  return allowanceFor(controls, activeMs, now);
}

/** Id of the record that carries a session's play time on a later calendar day. */
function continuationId(sessionId: string, day: string): string {
  return `${sessionId}~${day}`;
}

/**
 * Opens a play session. Sessions the child left open (a closed tab) are ended
 * first, at the last moment they were known to be active.
 */
export async function startSession(childId: string, now: number = Date.now()): Promise<SessionRecord> {
  return db.transaction('rw', db.sessions, async () => {
    await db.sessions
      .where('childId')
      .equals(childId)
      .filter((session) => session.endedAt === null)
      .modify((session) => {
        session.endedAt = Math.min(now, session.startedAt + session.activeMs);
      });
    const session: SessionRecord = {
      id: newId('ses'),
      childId,
      day: dayKey(now),
      startedAt: now,
      endedAt: null,
      activeMs: 0,
      itemsCompleted: 0,
    };
    await db.sessions.add(session);
    return session;
  });
}

/**
 * Adds active play time to a session. One call counts for at most
 * `TUNING.limits.maxTickMs`, so a tab that slept for an hour adds a minute.
 * Time played after midnight is counted on the new day, in a continuation
 * record, so each day's limit sees only that day's minutes.
 */
export async function tickSession(sessionId: string, activeMsDelta: number, now: number = Date.now()): Promise<void> {
  if (!Number.isFinite(activeMsDelta) || activeMsDelta <= 0) return;
  const delta = Math.min(activeMsDelta, TUNING.limits.maxTickMs);
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return;
    const today = dayKey(now);
    if (session.day === today) {
      await db.sessions.update(sessionId, { activeMs: session.activeMs + delta });
      return;
    }
    const id = continuationId(sessionId, today);
    const continuation = await db.sessions.get(id);
    if (continuation) {
      await db.sessions.update(id, { activeMs: continuation.activeMs + delta });
    } else {
      await db.sessions.add({
        id,
        childId: session.childId,
        day: today,
        startedAt: now,
        endedAt: null,
        activeMs: delta,
        itemsCompleted: 0,
      });
    }
  });
}

/** Closes a session (and its after-midnight continuation). Ending twice keeps the first end time. */
export async function endSession(sessionId: string, now: number = Date.now()): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    const open = await db.sessions
      .where('childId')
      .equals(session.childId)
      .filter((row) => row.endedAt === null && (row.id === sessionId || row.id.startsWith(`${sessionId}~`)))
      .toArray();
    for (const row of open) {
      await db.sessions.update(row.id, { endedAt: Math.max(now, row.startedAt) });
    }
  });
}
