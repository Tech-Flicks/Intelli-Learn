/**
 * The parent gate: whether the parent area is unlocked right now.
 *
 * In memory only. Nothing here is persisted, so a reload or a new tab always
 * starts locked. The gate locks itself again after 5 idle minutes, and when
 * the app has been in the background for more than a minute, so a child who
 * picks up the device later does not land in the parent area.
 */
import { create } from 'zustand';
import { verifyAdminPassword } from './password';
import type { VerifyResult } from './password';

/** The gate locks after this long without a `touch()`. */
export const PARENT_IDLE_LOCK_MS = 5 * 60_000;
/** The gate locks when the page has been hidden for longer than this. */
export const PARENT_HIDDEN_LOCK_MS = 60_000;

export interface ParentGateState {
  unlocked: boolean;
  unlock(password: string): Promise<VerifyResult>;
  lock(): void;
  /** Call on parent-area activity. Restarts the idle countdown, or locks when it already ran out. */
  touch(): void;
}

type Timer = ReturnType<typeof setTimeout>;

let idleTimer: Timer | null = null;
let hiddenTimer: Timer | null = null;
let lastActivityAt = 0;
let hiddenSince: number | null = null;

function clearTimers(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  if (hiddenTimer !== null) clearTimeout(hiddenTimer);
  idleTimer = null;
  hiddenTimer = null;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function startIdleCountdown(): void {
  lastActivityAt = Date.now();
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => useParentGate.getState().lock(), PARENT_IDLE_LOCK_MS);
}

function startHiddenCountdown(): void {
  hiddenSince = Date.now();
  if (hiddenTimer !== null) clearTimeout(hiddenTimer);
  hiddenTimer = setTimeout(() => useParentGate.getState().lock(), PARENT_HIDDEN_LOCK_MS);
}

export const useParentGate = create<ParentGateState>()((set, get) => ({
  unlocked: false,

  async unlock(password) {
    const result = await verifyAdminPassword(password);
    if (result.ok) {
      set({ unlocked: true });
      startIdleCountdown();
      if (isHidden()) startHiddenCountdown();
    }
    return result;
  },

  lock() {
    clearTimers();
    hiddenSince = null;
    if (get().unlocked) set({ unlocked: false });
  },

  touch() {
    if (!get().unlocked) return;
    // Timers are paused while a device sleeps and slowed in background tabs,
    // so the clock is checked as well: late activity locks instead of extending.
    if (Date.now() - lastActivityAt >= PARENT_IDLE_LOCK_MS) {
      get().lock();
      return;
    }
    startIdleCountdown();
  },
}));

function onVisibilityChange(): void {
  const gate = useParentGate.getState();
  if (!gate.unlocked) return;
  if (isHidden()) {
    startHiddenCountdown();
    return;
  }
  // Visible again: the timers may not have fired while hidden, so compare clocks.
  const now = Date.now();
  const hiddenTooLong = hiddenSince !== null && now - hiddenSince > PARENT_HIDDEN_LOCK_MS;
  const idleTooLong = now - lastActivityAt >= PARENT_IDLE_LOCK_MS;
  if (hiddenTimer !== null) clearTimeout(hiddenTimer);
  hiddenTimer = null;
  hiddenSince = null;
  if (hiddenTooLong || idleTooLong) gate.lock();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onVisibilityChange);
}
