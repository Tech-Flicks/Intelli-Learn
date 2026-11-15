/**
 * Test helpers for the Pip tests: a hand-cranked `requestAnimationFrame`, so a test decides
 * when a frame happens and what time it is.
 */
import { vi } from 'vitest';

export interface FrameClock {
  /** Frames that were requested and not cancelled or run yet. */
  pending(): number;
  /** How many times `requestAnimationFrame` was called. */
  requested(): number;
  /** Runs `count` frames, `stepMs` apart. A frame runs only if one is pending. */
  run(count?: number, stepMs?: number): void;
  now(): number;
}

export function installFrameClock(): FrameClock {
  let nextHandle = 1;
  let requested = 0;
  let now = 1000;
  const queue = new Map<number, FrameRequestCallback>();

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    requested += 1;
    const handle = nextHandle;
    nextHandle += 1;
    queue.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    queue.delete(handle);
  });

  return {
    pending: () => queue.size,
    requested: () => requested,
    now: () => now,
    run(count = 1, stepMs = 1000 / 60) {
      for (let i = 0; i < count; i += 1) {
        now += stepMs;
        const callbacks = [...queue.values()];
        queue.clear();
        for (const callback of callbacks) callback(now);
      }
    },
  };
}

/** Makes the page look hidden or visible and tells the listeners. */
export function setPageHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Reads `translate(x, y) rotate(a)` back into numbers. */
export function parseHand(transform: string | null): { x: number; y: number; angle: number } {
  const match = /^translate\(([-\d.]+), ([-\d.]+)\) rotate\(([-\d.]+)\)$/.exec(transform ?? '');
  if (!match) throw new Error(`not a hand transform: ${String(transform)}`);
  return { x: Number(match[1]), y: Number(match[2]), angle: Number(match[3]) };
}
