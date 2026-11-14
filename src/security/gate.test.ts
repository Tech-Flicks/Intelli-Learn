import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifyResult } from './password';

const verifyAdminPassword = vi.hoisted(() => vi.fn<(password: string) => Promise<VerifyResult>>());
vi.mock('./password', () => ({ verifyAdminPassword }));

import { PARENT_HIDDEN_LOCK_MS, PARENT_IDLE_LOCK_MS, useParentGate } from './gate';

const OK: VerifyResult = { ok: true, lockedUntil: null, attemptsLeft: 5 };
const gate = () => useParentGate.getState();

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 14, 16, 0, 0));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  visibility = 'visible';
  verifyAdminPassword.mockReset();
  verifyAdminPassword.mockResolvedValue(OK);
  gate().lock();
});

afterEach(() => {
  gate().lock();
  vi.useRealTimers();
});

describe('useParentGate', () => {
  it('starts locked', () => {
    expect(gate().unlocked).toBe(false);
  });

  it('idle time is 5 minutes and the background limit is 60 seconds', () => {
    expect(PARENT_IDLE_LOCK_MS).toBe(5 * 60 * 1000);
    expect(PARENT_HIDDEN_LOCK_MS).toBe(60 * 1000);
  });

  it('unlocks with the right password and returns the verify result', async () => {
    const result = await gate().unlock('open sesame');

    expect(verifyAdminPassword).toHaveBeenCalledWith('open sesame');
    expect(result).toEqual(OK);
    expect(gate().unlocked).toBe(true);
  });

  it('stays locked with a wrong password and passes the lockout details on', async () => {
    const refused: VerifyResult = { ok: false, lockedUntil: 12345, attemptsLeft: 0 };
    verifyAdminPassword.mockResolvedValue(refused);

    expect(await gate().unlock('guess')).toEqual(refused);
    expect(gate().unlocked).toBe(false);
  });

  it('does not lock an open gate when a later attempt is wrong', async () => {
    await gate().unlock('open sesame');
    verifyAdminPassword.mockResolvedValue({ ok: false, lockedUntil: null, attemptsLeft: 4 });
    await gate().unlock('guess');
    expect(gate().unlocked).toBe(true);
  });

  it('locks on request', async () => {
    await gate().unlock('open sesame');
    gate().lock();
    expect(gate().unlocked).toBe(false);
  });

  it('notifies subscribers', async () => {
    const seen: boolean[] = [];
    const unsubscribe = useParentGate.subscribe((state) => seen.push(state.unlocked));
    await gate().unlock('open sesame');
    gate().lock();
    gate().lock();
    unsubscribe();
    expect(seen).toEqual([true, false]);
  });

  it('keeps nothing in browser storage', async () => {
    await gate().unlock('open sesame');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  describe('idle lock', () => {
    it('locks after 5 idle minutes', async () => {
      await gate().unlock('open sesame');

      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 1);
      expect(gate().unlocked).toBe(true);
      vi.advanceTimersByTime(1);
      expect(gate().unlocked).toBe(false);
    });

    it('touch() restarts the countdown', async () => {
      await gate().unlock('open sesame');

      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 1000);
      gate().touch();
      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 1000);
      expect(gate().unlocked).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(gate().unlocked).toBe(false);
    });

    it('touch() never unlocks a locked gate', () => {
      gate().touch();
      expect(gate().unlocked).toBe(false);
      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS * 2);
      expect(gate().unlocked).toBe(false);
    });

    it('locks on a late touch when the timer could not fire (device asleep)', async () => {
      await gate().unlock('open sesame');
      // The clock moves on, but no timer runs: what happens while a device sleeps.
      vi.setSystemTime(Date.now() + PARENT_IDLE_LOCK_MS + 1000);

      gate().touch();

      expect(gate().unlocked).toBe(false);
    });

    it('a fresh unlock gets a full countdown', async () => {
      await gate().unlock('open sesame');
      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS);
      expect(gate().unlocked).toBe(false);

      await gate().unlock('open sesame');
      vi.advanceTimersByTime(PARENT_IDLE_LOCK_MS - 1);
      expect(gate().unlocked).toBe(true);
    });

    it('lock() cancels the countdown', async () => {
      await gate().unlock('open sesame');
      gate().lock();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('background lock', () => {
    it('locks when the page has been hidden for more than 60 seconds', async () => {
      await gate().unlock('open sesame');
      setVisibility('hidden');

      vi.advanceTimersByTime(PARENT_HIDDEN_LOCK_MS - 1);
      expect(gate().unlocked).toBe(true);
      vi.advanceTimersByTime(1);
      expect(gate().unlocked).toBe(false);
    });

    it('stays unlocked when the page comes back within 60 seconds', async () => {
      await gate().unlock('open sesame');
      setVisibility('hidden');
      vi.advanceTimersByTime(PARENT_HIDDEN_LOCK_MS - 5000);
      setVisibility('visible');

      vi.advanceTimersByTime(PARENT_HIDDEN_LOCK_MS);
      expect(gate().unlocked).toBe(true);
    });

    it('locks on return when the timer could not fire while hidden', async () => {
      await gate().unlock('open sesame');
      setVisibility('hidden');
      vi.setSystemTime(Date.now() + PARENT_HIDDEN_LOCK_MS + 1000);

      setVisibility('visible');

      expect(gate().unlocked).toBe(false);
    });

    it('each time in the background is measured on its own', async () => {
      await gate().unlock('open sesame');
      for (let i = 0; i < 3; i += 1) {
        setVisibility('hidden');
        vi.advanceTimersByTime(PARENT_HIDDEN_LOCK_MS - 20_000);
        setVisibility('visible');
        gate().touch();
      }
      expect(gate().unlocked).toBe(true);
    });

    it('ignores visibility changes while locked', () => {
      setVisibility('hidden');
      vi.advanceTimersByTime(PARENT_HIDDEN_LOCK_MS * 2);
      setVisibility('visible');
      expect(gate().unlocked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
