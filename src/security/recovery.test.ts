import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data';
import { setAdminPassword, verifyAdminPassword } from './password';
import {
  cancelResetRequest,
  getResetRequest,
  requestReset,
  resetAllowed,
  resetIsReady,
  RESET_REQUEST_KEY,
  RESET_WAIT_MS,
} from './recovery';

const FAST = { iterations: 1000 };
const T0 = 1_800_000_000_000;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setAdminPassword('open sesame', FAST);
});

describe('forgotten-password reset: the waiting period', () => {
  it('waits 24 hours', () => {
    expect(RESET_WAIT_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('has no request to begin with, and nothing may be deleted', async () => {
    expect(await getResetRequest()).toBeNull();
    expect(resetIsReady(null, T0)).toBe(false);
    expect(await resetAllowed(T0)).toBe(false);
  });

  it('asking only starts the wait: the reset is not allowed until it is over', async () => {
    const result = await requestReset(T0);
    expect(result).toEqual({ ok: true, request: { requestedAt: T0, readyAt: T0 + RESET_WAIT_MS }, lockedUntil: null });
    expect(await getResetRequest()).toEqual({ requestedAt: T0, readyAt: T0 + RESET_WAIT_MS });

    expect(await resetAllowed(T0)).toBe(false);
    expect(await resetAllowed(T0 + RESET_WAIT_MS - 1)).toBe(false);
    expect(await resetAllowed(T0 + RESET_WAIT_MS)).toBe(true);
  });

  it('asking again neither restarts nor shortens the wait', async () => {
    await requestReset(T0);
    const again = await requestReset(T0 + 60_000);
    expect(again.request).toEqual({ requestedAt: T0, readyAt: T0 + RESET_WAIT_MS });
    expect(await resetAllowed(T0 + RESET_WAIT_MS)).toBe(true);
  });

  it('does not count a clock that was set back as waiting, and replaces a request from the future', async () => {
    await requestReset(T0);
    expect(resetIsReady(await getResetRequest(), T0 - 5 * RESET_WAIT_MS)).toBe(false);

    const earlier = T0 - 1000;
    expect((await requestReset(earlier)).request).toEqual({ requestedAt: earlier, readyAt: earlier + RESET_WAIT_MS });
  });

  it('never trusts a stored end time', async () => {
    await db.kv.put({ key: RESET_REQUEST_KEY, value: { requestedAt: T0, readyAt: T0 } });
    expect(await resetAllowed(T0 + 1)).toBe(false);
    await db.kv.put({ key: RESET_REQUEST_KEY, value: 'yes please' });
    expect(await getResetRequest()).toBeNull();
  });

  it('cannot be started while the gate is locked after wrong tries', async () => {
    for (let i = 0; i < 5; i += 1) await verifyAdminPassword('wrong-password', T0);
    const result = await requestReset(T0 + 1);
    expect(result.ok).toBe(false);
    expect(result.lockedUntil).toBe(T0 + 30_000);
    expect(await getResetRequest()).toBeNull();

    expect((await requestReset(T0 + 30_000)).ok).toBe(true);
  });

  it('is not allowed while the gate is locked, even after the wait', async () => {
    await requestReset(T0);
    const later = T0 + RESET_WAIT_MS + 1;
    for (let i = 0; i < 5; i += 1) await verifyAdminPassword('wrong-password', later);
    expect(await resetAllowed(later + 1)).toBe(false);
    expect(await resetAllowed(later + 30_000)).toBe(true);
  });

  it('is cancelled by the right password, and only by that', async () => {
    await requestReset(T0);
    await verifyAdminPassword('wrong-password', T0 + 1);
    expect(await getResetRequest()).not.toBeNull();

    expect((await verifyAdminPassword('open sesame', T0 + 2)).ok).toBe(true);
    expect(await getResetRequest()).toBeNull();
    expect(await resetAllowed(T0 + RESET_WAIT_MS)).toBe(false);
  });

  it('can be dropped', async () => {
    await requestReset(T0);
    await cancelResetRequest();
    expect(await getResetRequest()).toBeNull();
  });
});
