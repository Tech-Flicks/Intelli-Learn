import { beforeEach, describe, expect, it } from 'vitest';
import { liveQuery } from 'dexie';
import type { Settings } from '@/core/types';
import { db, getSettings, updateSettings } from './db';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** Collects what a live query emits until `stop()` is called. */
function watch<T>(querier: () => Promise<T>): { values: T[]; errors: unknown[]; stop: () => void } {
  const values: T[] = [];
  const errors: unknown[] = [];
  const subscription = liveQuery(querier).subscribe({
    next: (value) => values.push(value),
    error: (error) => errors.push(error),
  });
  return { values, errors, stop: () => subscription.unsubscribe() };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
}

describe('getSettings', () => {
  it('creates the record with defaults on first use and returns the stored one afterwards', async () => {
    expect(await db.settings.count()).toBe(0);
    const first = await getSettings();
    expect(first).toMatchObject({ id: 'app', setupComplete: false, auth: null });
    expect(await db.settings.get('app')).toEqual(first);
    expect(await getSettings()).toEqual(first);
  });

  it('works inside a live query on a device without settings, where writing is not allowed', async () => {
    const seen = watch<Settings>(() => getSettings());
    await until(() => seen.values.length + seen.errors.length > 0);
    expect(seen.errors).toEqual([]);
    expect(seen.values[0]).toMatchObject({ id: 'app', setupComplete: false });
    // The live query could not store anything.
    expect(await db.settings.count()).toBe(0);

    // Once the record is written outside the query, the query runs again with the stored value.
    await updateSettings({ setupComplete: true });
    await until(() => seen.values.some((value) => value.setupComplete));
    expect(seen.errors).toEqual([]);
    seen.stop();
  });

  it('still reports real database errors', async () => {
    db.close();
    await expect(getSettings()).rejects.toThrow();
    await db.open();
  });
});

describe('updateSettings', () => {
  it('starts from the defaults when nothing is stored, and keeps the id', async () => {
    const saved = await updateSettings((current) => ({ ...current, locale: 'es', id: 'other' as 'app' }));
    expect(saved).toMatchObject({ id: 'app', locale: 'es' });
    expect((await getSettings()).locale).toBe('es');
  });
});
