/**
 * Admin (parent) password.
 *
 * The password is never stored. `settings.auth` holds a PBKDF2-SHA256 hash, a
 * random salt, the iteration count and the lockout counters.
 *
 * Lockout: every 5th wrong attempt in a row locks the gate. The first lock
 * lasts 30 s and each further one doubles (60 s, 2 min, ...) up to 15 min.
 * While locked, attempts are refused without being checked, even with the
 * right password. A correct password clears the counters.
 */
import type { AdminAuth, Settings } from '@/core/types';
import { getSettings, updateSettings } from '@/data';
import { base64ToBytes, bytesToBase64, constantTimeEqual, randomBytes } from './encoding';

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
export const PBKDF2_ITERATIONS = 210_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_BASE_MS = 30_000;
export const LOCKOUT_MAX_MS = 15 * 60_000;

const SALT_BYTES = 16;
const HASH_BITS = 256;

export interface VerifyResult {
  ok: boolean;
  /** Epoch ms until which attempts are refused, or null when not locked. */
  lockedUntil: number | null;
  /** Wrong attempts left before the next lockout. 0 while locked. */
  attemptsLeft: number;
}

/** Returns a parent-readable problem with the password, or null when it is acceptable. */
export function passwordProblems(password: string): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Enter a password.';
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (password.trim().length === 0) return 'A password cannot be only spaces.';
  return null;
}

/** Length of the lockout that follows the given number of consecutive wrong attempts (0 when none starts). */
export function lockoutDurationMs(failedAttempts: number): number {
  if (failedAttempts <= 0 || failedAttempts % MAX_FAILED_ATTEMPTS !== 0) return 0;
  const lockoutNumber = failedAttempts / MAX_FAILED_ATTEMPTS; // 1, 2, 3, ...
  // The cap is reached at the 6th lockout; the exponent is bounded so the shift cannot overflow.
  return Math.min(LOCKOUT_MAX_MS, LOCKOUT_BASE_MS * 2 ** Math.min(lockoutNumber - 1, 20));
}

function attemptsLeftAfter(failedAttempts: number): number {
  return MAX_FAILED_ATTEMPTS - (failedAttempts % MAX_FAILED_ATTEMPTS);
}

function isLocked(auth: AdminAuth, now: number): boolean {
  return auth.lockedUntil !== null && now < auth.lockedUntil;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  // NFKC so the same password typed on different keyboards or devices gives the same bytes.
  const material = new TextEncoder().encode(password.normalize('NFKC'));
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/**
 * Fewer than PBKDF2_ITERATIONS is honoured only by the unit-test build, to
 * keep test suites fast. Everywhere else the full count is the floor.
 */
function effectiveIterations(requested: number | undefined): number {
  if (requested === undefined || !Number.isInteger(requested) || requested < 1) return PBKDF2_ITERATIONS;
  if (requested >= PBKDF2_ITERATIONS) return requested;
  return import.meta.env.MODE === 'test' ? requested : PBKDF2_ITERATIONS;
}

/**
 * Sets (or replaces) the admin password and clears the lockout counters.
 * Throws when `passwordProblems(password)` reports a problem.
 *
 * `opts.iterations` exists for unit tests only; see `effectiveIterations`.
 */
export async function setAdminPassword(password: string, opts: { iterations?: number } = {}): Promise<void> {
  const problem = passwordProblems(password);
  if (problem) throw new Error(problem);
  const iterations = effectiveIterations(opts.iterations);
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, iterations);
  const auth: AdminAuth = {
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
    iterations,
    failedAttempts: 0,
    lockedUntil: null,
  };
  await updateSettings((current) => ({ ...current, auth }));
}

/** True once a password has been set. */
export async function hasAdminPassword(): Promise<boolean> {
  return (await getSettings()).auth !== null;
}

/** The lockout state right now, without making an attempt. For showing a countdown. */
export async function getLockoutState(now: number = Date.now()): Promise<{ lockedUntil: number | null; attemptsLeft: number }> {
  const auth = (await getSettings()).auth;
  if (!auth) return { lockedUntil: null, attemptsLeft: MAX_FAILED_ATTEMPTS };
  if (isLocked(auth, now)) return { lockedUntil: auth.lockedUntil, attemptsLeft: 0 };
  return { lockedUntil: null, attemptsLeft: attemptsLeftAfter(auth.failedAttempts) };
}

/**
 * Attempts run one after another. Without this, many attempts fired at the
 * same moment would all be checked before the first failure was counted.
 */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function matches(password: string, auth: AdminAuth): Promise<boolean> {
  try {
    const expected = base64ToBytes(auth.hash);
    const actual = await derive(password, base64ToBytes(auth.salt), auth.iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    // A damaged auth record (bad base64, impossible iteration count) can match nothing.
    return false;
  }
}

async function verifyNow(password: string, now: number): Promise<VerifyResult> {
  const auth = (await getSettings()).auth;
  if (!auth) return { ok: false, lockedUntil: null, attemptsLeft: MAX_FAILED_ATTEMPTS };
  if (isLocked(auth, now)) return { ok: false, lockedUntil: auth.lockedUntil, attemptsLeft: 0 };

  const ok = typeof password === 'string' && (await matches(password, auth));

  // The counters are updated from the record as it is at write time, and only
  // if it still holds the password that was checked.
  const samePassword = (current: Settings): current is Settings & { auth: AdminAuth } =>
    current.auth !== null && current.auth.hash === auth.hash && current.auth.salt === auth.salt;

  if (ok) {
    await updateSettings((current) =>
      samePassword(current) ? { ...current, auth: { ...current.auth, failedAttempts: 0, lockedUntil: null } } : current,
    );
    return { ok: true, lockedUntil: null, attemptsLeft: MAX_FAILED_ATTEMPTS };
  }

  const saved = await updateSettings((current) => {
    if (!samePassword(current)) return current;
    const failedAttempts = current.auth.failedAttempts + 1;
    const lockMs = lockoutDurationMs(failedAttempts);
    return {
      ...current,
      auth: { ...current.auth, failedAttempts, lockedUntil: lockMs > 0 ? now + lockMs : null },
    };
  });
  const after = saved.auth;
  if (!after) return { ok: false, lockedUntil: null, attemptsLeft: MAX_FAILED_ATTEMPTS };
  if (isLocked(after, now)) return { ok: false, lockedUntil: after.lockedUntil, attemptsLeft: 0 };
  return { ok: false, lockedUntil: null, attemptsLeft: attemptsLeftAfter(after.failedAttempts) };
}

/**
 * Checks a password attempt and updates the lockout counters in settings.auth.
 * Never throws for a wrong password. With no password set it returns `ok: false`.
 */
export function verifyAdminPassword(password: string, now: number = Date.now()): Promise<VerifyResult> {
  return inTurn(() => verifyNow(password, now));
}

/**
 * Replaces the password after checking the current one. Returns false when
 * the current password is wrong or the gate is locked (the attempt counts
 * toward the lockout like any other).
 * Throws when the new password is not acceptable; check `passwordProblems(next)` first.
 */
export async function changeAdminPassword(
  current: string,
  next: string,
  opts: { iterations?: number; now?: number } = {},
): Promise<boolean> {
  const problem = passwordProblems(next);
  if (problem) throw new Error(problem);
  const result = await verifyAdminPassword(current, opts.now ?? Date.now());
  if (!result.ok) return false;
  await setAdminPassword(next, { iterations: opts.iterations });
  return true;
}
