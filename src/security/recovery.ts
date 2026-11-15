/**
 * The way back in after a forgotten password: a full reset of the device, behind a wait.
 *
 * A reset needs no password (that is its point), so it must not be something a child can do
 * in one sitting. Asking for it only starts a waiting period of 24 hours. Until that is over
 * nothing can be deleted, the request is shown on the profile picker and in the gate where a
 * parent will see it, and the right password cancels it. A request cannot be started while
 * the gate is locked after wrong tries.
 *
 * The request lives in `db.kv` (never in a backup; a reset removes it with everything else).
 */
import { db } from '@/data';
import { getLockoutState, RESET_REQUEST_KEY } from './password';

/** How long a forgotten-password reset has to wait after it was asked for. */
export const RESET_WAIT_MS = 24 * 60 * 60_000;

export { RESET_REQUEST_KEY };

export interface ResetRequest {
  /** Epoch ms when the reset was asked for. */
  requestedAt: number;
  /** Epoch ms from which the reset may be carried out. */
  readyAt: number;
}

function parse(value: unknown): ResetRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const requestedAt = (value as { requestedAt?: unknown }).requestedAt;
  if (typeof requestedAt !== 'number' || !Number.isFinite(requestedAt)) return null;
  // The wait is always counted from the stored start, never read from the record.
  return { requestedAt, readyAt: requestedAt + RESET_WAIT_MS };
}

/** The pending request, or null. Read-only: safe inside a live query. */
export async function getResetRequest(): Promise<ResetRequest | null> {
  return parse((await db.kv.get(RESET_REQUEST_KEY))?.value);
}

/**
 * True once the waiting period of the request is over. A clock that was set back to before
 * the request does not count as waiting.
 */
export function resetIsReady(request: ResetRequest | null, now: number = Date.now()): boolean {
  return request !== null && now >= request.readyAt && now >= request.requestedAt;
}

export interface ResetRequestResult {
  /** False when the gate is locked after wrong tries: nothing was started. */
  ok: boolean;
  request: ResetRequest | null;
  lockedUntil: number | null;
}

/**
 * Starts the waiting period, or returns the one that is already running (asking again never
 * restarts or shortens it). Refused while the gate is locked after wrong tries.
 */
export async function requestReset(now: number = Date.now()): Promise<ResetRequestResult> {
  const lockout = await getLockoutState(now);
  if (lockout.lockedUntil !== null) return { ok: false, request: await getResetRequest(), lockedUntil: lockout.lockedUntil };
  const request = await db.transaction('rw', db.kv, async () => {
    const existing = parse((await db.kv.get(RESET_REQUEST_KEY))?.value);
    // A request from the future (the clock was changed) is replaced, so it cannot block for ever.
    if (existing && existing.requestedAt <= now) return existing;
    await db.kv.put({ key: RESET_REQUEST_KEY, value: { requestedAt: now } });
    return { requestedAt: now, readyAt: now + RESET_WAIT_MS };
  });
  return { ok: true, request, lockedUntil: null };
}

/** Drops the pending request. Called when the right password is entered. */
export async function cancelResetRequest(): Promise<void> {
  await db.kv.delete(RESET_REQUEST_KEY);
}

/**
 * Whether the forgotten-password reset may delete the device now: the waiting period is over
 * and the gate is not locked after wrong tries.
 */
export async function resetAllowed(now: number = Date.now()): Promise<boolean> {
  if (!resetIsReady(await getResetRequest(), now)) return false;
  return (await getLockoutState(now)).lockedUntil === null;
}
