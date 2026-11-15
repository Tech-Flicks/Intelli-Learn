import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getSettings, updateSettings } from '@/data';
import {
  changeAdminPassword,
  getLockoutState,
  hasAdminPassword,
  lockoutDurationMs,
  LOCKOUT_MAX_MS,
  MAX_FAILED_ATTEMPTS,
  passwordProblems,
  PBKDF2_ITERATIONS,
  setAdminPassword,
  verifyAdminPassword,
} from './password';

/** Low iteration count so the suite stays fast. Honoured in the test build only. */
const FAST = { iterations: 1000 };
const T0 = 1_800_000_000_000;

async function failTimes(times: number, now: number): Promise<void> {
  for (let i = 0; i < times; i += 1) await verifyAdminPassword('wrong-password', now);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('passwordProblems', () => {
  it('accepts 6 to 128 characters', () => {
    expect(passwordProblems('abcdef')).toBeNull();
    expect(passwordProblems('a'.repeat(128))).toBeNull();
    expect(passwordProblems('correct horse battery staple')).toBeNull();
  });

  it('rejects passwords that are too short, too long, empty or blank', () => {
    expect(passwordProblems('')).toMatch(/password/i);
    expect(passwordProblems('abcde')).toMatch(/at least 6/);
    expect(passwordProblems('a'.repeat(129))).toMatch(/at most 128/);
    expect(passwordProblems('      ')).toMatch(/spaces/);
    expect(passwordProblems(undefined as unknown as string)).not.toBeNull();
  });

  it('counts characters, not UTF-16 units', () => {
    expect(passwordProblems('🦄🦄🦄')).toMatch(/at least 6/);
    expect(passwordProblems('🦄🦄🦄🦄🦄🦄')).toBeNull();
  });
});

describe('lockoutDurationMs', () => {
  it('starts a lockout on every 5th wrong attempt, doubling up to 15 minutes', () => {
    expect([1, 2, 3, 4, 6, 9, 11].map(lockoutDurationMs)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect([5, 10, 15, 20, 25, 30, 35, 500].map(lockoutDurationMs)).toEqual([
      30_000,
      60_000,
      120_000,
      240_000,
      480_000,
      900_000,
      900_000,
      900_000,
    ]);
    expect(lockoutDurationMs(0)).toBe(0);
    expect(lockoutDurationMs(5 * 5000)).toBe(LOCKOUT_MAX_MS);
  });
});

describe('setAdminPassword', () => {
  it('stores a salted PBKDF2 hash with 600 000 iterations, never the password', async () => {
    await setAdminPassword('open sesame');

    const auth = (await getSettings()).auth;
    expect(auth).not.toBeNull();
    expect(auth?.iterations).toBe(PBKDF2_ITERATIONS);
    // 600,000 is the OWASP figure for PBKDF2-HMAC-SHA256; 210,000 belongs to SHA-512.
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(atob(auth?.salt ?? '')).toHaveLength(16);
    expect(atob(auth?.hash ?? '')).toHaveLength(32);
    expect(auth?.failedAttempts).toBe(0);
    expect(auth?.lockedUntil).toBeNull();
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('open sesame');
  });

  it('matches a known PBKDF2-SHA256 result for the stored salt', async () => {
    await setAdminPassword('open sesame', FAST);
    const auth = (await getSettings()).auth;
    const salt = Uint8Array.from(atob(auth?.salt ?? ''), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('open sesame'), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, key, 256);
    expect(auth?.hash).toBe(btoa(String.fromCharCode(...new Uint8Array(bits))));
  });

  it('uses a new random salt every time', async () => {
    await setAdminPassword('open sesame', FAST);
    const first = (await getSettings()).auth;
    await setAdminPassword('open sesame', FAST);
    const second = (await getSettings()).auth;

    expect(second?.salt).not.toBe(first?.salt);
    expect(second?.hash).not.toBe(first?.hash);
  });

  it('refuses a password with problems', async () => {
    await expect(setAdminPassword('short')).rejects.toThrow(/at least 6/);
    expect(await hasAdminPassword()).toBe(false);
  });

  it('ignores a lower iteration count outside the test build', async () => {
    vi.stubEnv('MODE', 'production');
    await setAdminPassword('open sesame', { iterations: 10 });
    expect((await getSettings()).auth?.iterations).toBe(PBKDF2_ITERATIONS);
  });

  it('accepts a higher iteration count and falls back to the default for nonsense', async () => {
    await setAdminPassword('open sesame', { iterations: PBKDF2_ITERATIONS + 1 });
    expect((await getSettings()).auth?.iterations).toBe(PBKDF2_ITERATIONS + 1);
    await setAdminPassword('open sesame', { iterations: -5 });
    expect((await getSettings()).auth?.iterations).toBe(PBKDF2_ITERATIONS);
  });

  it('leaves the rest of the settings alone', async () => {
    await updateSettings({ setupComplete: true, locale: 'es' });
    await setAdminPassword('open sesame', FAST);
    expect(await getSettings()).toMatchObject({ setupComplete: true, locale: 'es' });
  });
});

describe('verifyAdminPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    await setAdminPassword('open sesame', FAST);

    expect(await verifyAdminPassword('open sesame', T0)).toEqual({ ok: true, lockedUntil: null, attemptsLeft: 5 });
    expect(await verifyAdminPassword('Open sesame', T0)).toEqual({ ok: false, lockedUntil: null, attemptsLeft: 4 });
    expect(await verifyAdminPassword('', T0)).toMatchObject({ ok: false, attemptsLeft: 3 });
  });

  it('works with the full iteration count', async () => {
    await setAdminPassword('open sesame');
    expect((await verifyAdminPassword('open sesame')).ok).toBe(true);
    expect((await verifyAdminPassword('open sesame!')).ok).toBe(false);
  });

  it('returns ok: false when no password has been set', async () => {
    expect(await verifyAdminPassword('anything', T0)).toEqual({ ok: false, lockedUntil: null, attemptsLeft: 5 });
    expect((await getSettings()).auth).toBeNull();
  });

  it('treats the same text in different Unicode forms as the same password', async () => {
    await setAdminPassword('café time', FAST);
    expect((await verifyAdminPassword('café time', T0)).ok).toBe(true);
  });

  it('counts wrong attempts in settings.auth and resets them on success', async () => {
    await setAdminPassword('open sesame', FAST);
    await failTimes(3, T0);
    expect((await getSettings()).auth?.failedAttempts).toBe(3);

    expect(await verifyAdminPassword('open sesame', T0)).toEqual({ ok: true, lockedUntil: null, attemptsLeft: 5 });
    expect((await getSettings()).auth).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('locks for 30 seconds after the 5th wrong attempt', async () => {
    await setAdminPassword('open sesame', FAST);
    await failTimes(4, T0);
    expect(await getLockoutState(T0)).toEqual({ lockedUntil: null, attemptsLeft: 1 });

    const fifth = await verifyAdminPassword('wrong-password', T0);

    expect(fifth).toEqual({ ok: false, lockedUntil: T0 + 30_000, attemptsLeft: 0 });
    expect((await getSettings()).auth).toMatchObject({ failedAttempts: 5, lockedUntil: T0 + 30_000 });
  });

  it('refuses even the right password while locked, without counting the attempt', async () => {
    await setAdminPassword('open sesame', FAST);
    await failTimes(5, T0);

    expect(await verifyAdminPassword('open sesame', T0 + 29_999)).toEqual({
      ok: false,
      lockedUntil: T0 + 30_000,
      attemptsLeft: 0,
    });
    await failTimes(3, T0 + 10_000);
    expect((await getSettings()).auth?.failedAttempts).toBe(5);
  });

  it('accepts the right password again once the lock has run out', async () => {
    await setAdminPassword('open sesame', FAST);
    await failTimes(5, T0);

    expect(await getLockoutState(T0 + 30_000)).toEqual({ lockedUntil: null, attemptsLeft: 5 });
    expect((await verifyAdminPassword('open sesame', T0 + 30_000)).ok).toBe(true);
    expect((await getSettings()).auth).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('doubles the lock each time: 30 s, 60 s, 2 min ... capped at 15 min', async () => {
    await setAdminPassword('open sesame', FAST);
    const expected = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000];
    let now = T0;

    for (const duration of expected) {
      for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
        const result = await verifyAdminPassword('wrong-password', now);
        expect(result).toEqual({ ok: false, lockedUntil: null, attemptsLeft: MAX_FAILED_ATTEMPTS - attempt });
      }
      const locking = await verifyAdminPassword('wrong-password', now);
      expect(locking).toEqual({ ok: false, lockedUntil: now + duration, attemptsLeft: 0 });
      expect((await verifyAdminPassword('open sesame', now + duration - 1)).ok).toBe(false);
      now += duration;
    }

    expect((await verifyAdminPassword('open sesame', now)).ok).toBe(true);
    // A success starts the ladder from the bottom again.
    await failTimes(4, now);
    expect((await verifyAdminPassword('wrong-password', now)).lockedUntil).toBe(now + 30_000);
  });

  it('keeps the lock across a restart (it is stored, not kept in memory)', async () => {
    await setAdminPassword('open sesame', FAST);
    await failTimes(5, T0);
    db.close();
    await db.open();

    expect(await getLockoutState(T0 + 1000)).toEqual({ lockedUntil: T0 + 30_000, attemptsLeft: 0 });
  });

  it('counts attempts made at the same moment one by one', async () => {
    await setAdminPassword('open sesame', FAST);

    const results = await Promise.all(Array.from({ length: 12 }, () => verifyAdminPassword('wrong-password', T0)));

    expect(results.filter((r) => r.lockedUntil === null)).toHaveLength(4);
    expect(results.slice(4).every((r) => r.lockedUntil === T0 + 30_000 && r.attemptsLeft === 0)).toBe(true);
    expect((await getSettings()).auth?.failedAttempts).toBe(5);
  });

  it('cannot be passed with a guess hidden among parallel wrong attempts once locked', async () => {
    await setAdminPassword('open sesame', FAST);
    const attempts = ['a', 'b', 'c', 'd', 'e', 'open sesame'].map((guess) => verifyAdminPassword(guess, T0));
    const results = await Promise.all(attempts);
    expect(results.some((r) => r.ok)).toBe(false);
  });

  it('never matches a damaged auth record, and does not throw', async () => {
    await setAdminPassword('open sesame', FAST);
    await updateSettings((s) => ({ ...s, auth: s.auth && { ...s.auth, hash: '%%% not base64 %%%' } }));

    await expect(verifyAdminPassword('open sesame', T0)).resolves.toMatchObject({ ok: false });
  });

  it('does not throw for a value that is not a string', async () => {
    await setAdminPassword('open sesame', FAST);
    await expect(verifyAdminPassword(undefined as unknown as string, T0)).resolves.toMatchObject({ ok: false });
  });

  it('replaces a hash made with fewer rounds once the right password is entered', async () => {
    // A record as an older version stored it (the test build honours the low count).
    await setAdminPassword('open sesame', { iterations: 2000 });
    const old = (await getSettings()).auth;
    expect(old?.iterations).toBe(2000);

    vi.stubEnv('MODE', 'production');
    expect((await verifyAdminPassword('wrong-password', T0)).ok).toBe(false);
    expect((await getSettings()).auth?.iterations).toBe(2000);

    expect((await verifyAdminPassword('open sesame', T0)).ok).toBe(true);
    const upgraded = (await getSettings()).auth;
    expect(upgraded?.iterations).toBe(PBKDF2_ITERATIONS);
    expect(upgraded?.salt).not.toBe(old?.salt);
    expect(upgraded?.hash).not.toBe(old?.hash);
    expect(upgraded?.failedAttempts).toBe(0);

    // The same password still opens the gate, and the record is left alone from now on.
    expect((await verifyAdminPassword('open sesame', T0)).ok).toBe(true);
    expect((await getSettings()).auth?.hash).toBe(upgraded?.hash);
    expect((await verifyAdminPassword('guess', T0)).ok).toBe(false);
  });
});

describe('changeAdminPassword', () => {
  it('replaces the password when the current one is right', async () => {
    await setAdminPassword('open sesame', FAST);

    expect(await changeAdminPassword('open sesame', 'new secret 42', FAST)).toBe(true);

    expect((await verifyAdminPassword('open sesame', T0)).ok).toBe(false);
    expect((await verifyAdminPassword('new secret 42', T0)).ok).toBe(true);
  });

  it('uses the full iteration count by default', async () => {
    await setAdminPassword('open sesame', FAST);
    await changeAdminPassword('open sesame', 'new secret 42');
    expect((await getSettings()).auth?.iterations).toBe(PBKDF2_ITERATIONS);
  });

  it('returns false and keeps the password when the current one is wrong', async () => {
    await setAdminPassword('open sesame', FAST);
    const before = (await getSettings()).auth;

    expect(await changeAdminPassword('guess', 'new secret 42', { ...FAST, now: T0 })).toBe(false);

    const after = (await getSettings()).auth;
    expect(after?.hash).toBe(before?.hash);
    expect(after?.failedAttempts).toBe(1);
    expect((await verifyAdminPassword('open sesame', T0)).ok).toBe(true);
  });

  it('is refused while locked, even with the right current password', async () => {
    await setAdminPassword('open sesame', FAST);
    await failTimes(5, T0);
    expect(await changeAdminPassword('open sesame', 'new secret 42', { ...FAST, now: T0 + 1 })).toBe(false);
  });

  it('throws for an unacceptable new password without spending an attempt', async () => {
    await setAdminPassword('open sesame', FAST);
    await expect(changeAdminPassword('guess', 'tiny', FAST)).rejects.toThrow(/at least 6/);
    expect((await getSettings()).auth?.failedAttempts).toBe(0);
  });

  it('returns false when no password was ever set', async () => {
    expect(await changeAdminPassword('anything', 'new secret 42', FAST)).toBe(false);
    expect(await hasAdminPassword()).toBe(false);
  });
});
