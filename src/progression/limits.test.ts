import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/defaults';
import { dayKey } from '@/core/grades';
import { db, updateSettings } from '@/data';
import {
  allowanceFor,
  effectiveControls,
  enabledStrands,
  endSession,
  getPlayAllowance,
  isWithinHours,
  startSession,
  tickSession,
} from './limits';
import { addChild, childProfile, controls, DAY, HOUR, MONDAY, resetDb } from './testing';

const MIN = 60_000;
const at = (hour: number, minute = 0) => new Date(2026, 10, 9, hour, minute, 0).getTime();

describe('effectiveControls', () => {
  it('returns the device controls when the child has no overrides', () => {
    const settings = defaultSettings();
    expect(effectiveControls(settings, childProfile())).toEqual(settings.controls);
  });

  it('applies the child overrides on top', () => {
    const settings = defaultSettings();
    const child = childProfile({ controlsOverride: { dailyMinutes: 45, openChat: true, allowedEndHour: 18 } });
    const merged = effectiveControls(settings, child);
    expect(merged.dailyMinutes).toBe(45);
    expect(merged.openChat).toBe(true);
    expect(merged.allowedEndHour).toBe(18);
    expect(merged.allowedStartHour).toBe(settings.controls.allowedStartHour);
    expect(merged.strictness).toBe(settings.controls.strictness);
  });

  it('merges strand overrides strand by strand', () => {
    const settings = defaultSettings();
    settings.controls.strands.logic = false;
    const child = childProfile({
      controlsOverride: { strands: { science: false } as never },
    });
    const merged = effectiveControls(settings, child);
    expect(merged.strands).toEqual({ math: true, science: false, technology: true, engineering: true, logic: false });
  });

  it('ignores undefined overrides and does not change the settings', () => {
    const settings = defaultSettings();
    const before = structuredClone(settings);
    const child = childProfile({ controlsOverride: { dailyMinutes: undefined, strands: { ...settings.controls.strands, math: false } } });
    const merged = effectiveControls(settings, child);
    expect(merged.dailyMinutes).toBe(before.controls.dailyMinutes);
    expect(merged.strands.math).toBe(false);
    expect(settings).toEqual(before);
  });

  it('lists the enabled strands, and all of them when every one is switched off', () => {
    const some = controls({ strands: { math: false, science: true, technology: false, engineering: false, logic: true } });
    expect(enabledStrands(some)).toEqual(['science', 'logic']);
    const none = controls({ strands: { math: false, science: false, technology: false, engineering: false, logic: false } });
    expect(enabledStrands(none)).toHaveLength(5);
  });
});

describe('allowed hours', () => {
  it('includes the start hour and excludes the end hour', () => {
    expect(isWithinHours(7, 7, 20)).toBe(true);
    expect(isWithinHours(19, 7, 20)).toBe(true);
    expect(isWithinHours(20, 7, 20)).toBe(false);
    expect(isWithinHours(6, 7, 20)).toBe(false);
    expect(isWithinHours(23, 0, 24)).toBe(true);
  });

  it('supports a window that wraps past midnight', () => {
    expect(isWithinHours(23, 20, 7)).toBe(true);
    expect(isWithinHours(3, 20, 7)).toBe(true);
    expect(isWithinHours(12, 20, 7)).toBe(false);
  });

  it('treats an empty window as the whole day', () => {
    expect(isWithinHours(3, 8, 8)).toBe(true);
  });
});

describe('allowanceFor', () => {
  const c = controls({ dailyMinutes: 30, allowedStartHour: 7, allowedEndHour: 20 });

  it('allows play inside the hours with time left', () => {
    expect(allowanceFor(c, 10 * MIN, at(10))).toEqual({
      allowed: true,
      reason: 'ok',
      minutesLeft: 20,
      minutesUsedToday: 10,
    });
  });

  it('refuses before the start hour and from the end hour on', () => {
    expect(allowanceFor(c, 0, at(6, 59))).toMatchObject({ allowed: false, reason: 'outside-hours', minutesLeft: 0 });
    expect(allowanceFor(c, 0, at(20))).toMatchObject({ allowed: false, reason: 'outside-hours', minutesLeft: 0 });
    expect(allowanceFor(c, 0, at(7))).toMatchObject({ allowed: true, reason: 'ok' });
  });

  it('refuses once the daily minutes are used', () => {
    expect(allowanceFor(c, 30 * MIN, at(10))).toEqual({
      allowed: false,
      reason: 'daily-limit',
      minutesLeft: 0,
      minutesUsedToday: 30,
    });
    expect(allowanceFor(c, 29 * MIN + 30_000, at(10))).toMatchObject({ allowed: true, minutesLeft: 1 });
  });

  it('reports outside-hours before daily-limit', () => {
    expect(allowanceFor(c, 99 * MIN, at(22)).reason).toBe('outside-hours');
  });

  it('never promises more minutes than are left before the hours end', () => {
    expect(allowanceFor(c, 0, at(19, 50)).minutesLeft).toBe(10);
  });

  it('treats 0 daily minutes as unlimited: only the hours end the day', () => {
    const unlimited = controls({ dailyMinutes: 0, allowedStartHour: 7, allowedEndHour: 20 });
    expect(allowanceFor(unlimited, 500 * MIN, at(18))).toEqual({
      allowed: true,
      reason: 'ok',
      minutesLeft: 120,
      minutesUsedToday: 500,
    });
    expect(allowanceFor(unlimited, 0, at(21)).reason).toBe('outside-hours');
  });

  it('counts minutes to the end of a window that wraps past midnight', () => {
    const night = controls({ dailyMinutes: 0, allowedStartHour: 20, allowedEndHour: 7 });
    expect(allowanceFor(night, 0, at(23)).minutesLeft).toBe(8 * 60);
    expect(allowanceFor(night, 0, at(5)).minutesLeft).toBe(2 * 60);
  });
});

describe('getPlayAllowance', () => {
  beforeEach(resetDb);

  it('sums the active time of today only, for this child only', async () => {
    const child = await addChild();
    const sibling = await addChild();
    const session = (id: string, childId: string, day: string, activeMs: number) =>
      db.sessions.put({ id, childId, day, startedAt: MONDAY, endedAt: null, activeMs, itemsCompleted: 0 });
    await session('a', child.id, dayKey(at(10)), 6 * MIN);
    await session('b', child.id, dayKey(at(10)), 9 * MIN + 59_000);
    await session('c', child.id, dayKey(at(10) - DAY), 25 * MIN);
    await session('d', sibling.id, dayKey(at(10)), 25 * MIN);

    expect(await getPlayAllowance(child.id, at(10))).toEqual({
      allowed: true,
      reason: 'ok',
      minutesLeft: 15,
      minutesUsedToday: 15,
    });
  });

  it('uses the device settings and the child override', async () => {
    await updateSettings((s) => ({ ...s, controls: { ...s.controls, dailyMinutes: 10 } }));
    const child = await addChild();
    const allowedLonger = await addChild({ controlsOverride: { dailyMinutes: 60 } });
    for (const id of [child.id, allowedLonger.id]) {
      await db.sessions.put({
        id: `s-${id}`,
        childId: id,
        day: dayKey(at(10)),
        startedAt: at(9),
        endedAt: null,
        activeMs: 12 * MIN,
        itemsCompleted: 0,
      });
    }
    expect((await getPlayAllowance(child.id, at(10))).reason).toBe('daily-limit');
    expect(await getPlayAllowance(allowedLonger.id, at(10))).toMatchObject({ allowed: true, minutesLeft: 48 });
  });

  it('is outside-hours at night', async () => {
    const child = await addChild();
    expect((await getPlayAllowance(child.id, at(21))).reason).toBe('outside-hours');
  });

  it('throws for an unknown child', async () => {
    await expect(getPlayAllowance('nobody', at(10))).rejects.toThrow(/not found/);
  });
});

describe('sessions', () => {
  beforeEach(resetDb);

  it('starts a session on the local day with nothing counted yet', async () => {
    const session = await startSession('c1', at(10));
    expect(session).toMatchObject({
      childId: 'c1',
      day: dayKey(at(10)),
      startedAt: at(10),
      endedAt: null,
      activeMs: 0,
      itemsCompleted: 0,
    });
    expect(await db.sessions.get(session.id)).toEqual(session);
  });

  it('adds active time on each tick', async () => {
    const session = await startSession('c1', at(10));
    await tickSession(session.id, 5_000, at(10) + 5_000);
    await tickSession(session.id, 10_000, at(10) + 15_000);
    expect((await db.sessions.get(session.id))?.activeMs).toBe(15_000);
  });

  it('counts a single tick for at most one minute, so a sleeping tab is ignored', async () => {
    const session = await startSession('c1', at(10));
    await tickSession(session.id, 3 * HOUR, at(13));
    expect((await db.sessions.get(session.id))?.activeMs).toBe(60_000);
  });

  it('ignores zero, negative and non-numeric ticks, and unknown sessions', async () => {
    const session = await startSession('c1', at(10));
    await tickSession(session.id, 0, at(10));
    await tickSession(session.id, -5_000, at(10));
    await tickSession(session.id, Number.NaN, at(10));
    await tickSession('missing', 5_000, at(10));
    expect((await db.sessions.get(session.id))?.activeMs).toBe(0);
    expect(await db.sessions.count()).toBe(1);
  });

  it('ends a session once and stops counting afterwards', async () => {
    const session = await startSession('c1', at(10));
    await tickSession(session.id, 30_000, at(10) + 30_000);
    await endSession(session.id, at(10, 5));
    await endSession(session.id, at(11));
    await tickSession(session.id, 30_000, at(11));
    expect(await db.sessions.get(session.id)).toMatchObject({ endedAt: at(10, 5), activeMs: 30_000 });
  });

  it('keeps counting play time after a second tab opened a session for the same child', async () => {
    const child = await addChild({ controlsOverride: { allowedStartHour: 0, allowedEndHour: 24, dailyMinutes: 30 } });
    const tabA = await startSession(child.id, at(10));
    // The play screen is opened in a second tab, which is then left in the background.
    const tabB = await startSession(child.id, at(10, 1));
    expect((await db.sessions.get(tabA.id))?.endedAt).not.toBeNull();

    // The child goes on playing in the first tab: 100 minutes of ticks.
    for (let i = 1; i <= 400; i += 1) expect(await tickSession(tabA.id, 15_000, at(10, 1) + i * 15_000)).toBe(true);

    const allowance = await getPlayAllowance(child.id, at(11, 45));
    expect(allowance.minutesUsedToday).toBe(100);
    expect(allowance).toMatchObject({ allowed: false, reason: 'daily-limit', minutesLeft: 0 });
    // The time went to the session that is open, not into a closed record.
    expect((await db.sessions.get(tabB.id))?.activeMs).toBe(100 * MIN);
    expect((await db.sessions.get(tabA.id))?.activeMs).toBe(0);
  });

  it('says so when a tick could not be counted, so the caller can open a new session', async () => {
    const session = await startSession('c1', at(10));
    expect(await tickSession(session.id, 15_000, at(10) + 15_000)).toBe(true);
    await endSession(session.id, at(10, 5));
    expect(await tickSession(session.id, 15_000, at(10, 6))).toBe(false);
    expect(await tickSession('missing', 15_000, at(10, 6))).toBe(false);
    expect(await tickSession(session.id, 0, at(10, 6))).toBe(false);
    // Another child's open session is never credited.
    await startSession('c2', at(10, 7));
    expect(await tickSession(session.id, 15_000, at(10, 8))).toBe(false);
    expect((await db.sessions.where('childId').equals('c2').first())?.activeMs).toBe(0);
  });

  it('closes a session that was left open when a new one starts', async () => {
    const stale = await startSession('c1', at(8));
    await tickSession(stale.id, 40_000, at(8) + 40_000);
    const other = await startSession('c2', at(8));
    const fresh = await startSession('c1', at(10));
    expect((await db.sessions.get(stale.id))?.endedAt).toBe(at(8) + 40_000);
    expect((await db.sessions.get(other.id))?.endedAt).toBeNull();
    expect((await db.sessions.get(fresh.id))?.endedAt).toBeNull();
  });

  it('counts time after midnight on the new day', async () => {
    const child = await addChild({ controlsOverride: { allowedStartHour: 0, allowedEndHour: 24, dailyMinutes: 30 } });
    const session = await startSession(child.id, at(23, 50));
    await tickSession(session.id, 60_000, at(23, 51));
    const afterMidnight = at(23, 59) + 2 * MIN;
    await tickSession(session.id, 60_000, afterMidnight);
    await tickSession(session.id, 60_000, afterMidnight + MIN);

    expect((await db.sessions.get(session.id))?.activeMs).toBe(60_000);
    expect((await getPlayAllowance(child.id, afterMidnight + MIN)).minutesUsedToday).toBe(2);
    expect((await getPlayAllowance(child.id, at(23, 55))).minutesUsedToday).toBe(1);

    await endSession(session.id, afterMidnight + 2 * MIN);
    const rows = await db.sessions.where('childId').equals(child.id).toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.endedAt === afterMidnight + 2 * MIN)).toBe(true);
  });
});
