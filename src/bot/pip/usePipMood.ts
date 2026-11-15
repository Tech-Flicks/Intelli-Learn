/**
 * Short reactions on top of a base mood.
 *
 *   const [state, react] = usePipMood(busy ? 'thinking' : 'idle');
 *   <Pip state={state} onTap={() => react('giggle', 1200)} />
 *
 * `react('celebrating', 2400)` shows that state for 2.4 seconds and then returns to the base
 * state, whatever the base state is by then.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipState } from './states';

export interface PipMoodOptions {
  /** How long a reaction lasts when `react` is called without a time. Default 1400 ms. */
  defaultMs?: number;
  /** true: a change of the base state ends a running reaction at once. Default false: the reaction plays out. */
  resetOnBaseChange?: boolean;
}

/** Shows `state` for `ms` milliseconds. A new reaction replaces a running one. */
export type PipReact = (state: PipState, ms?: number) => void;

export const PIP_REACTION_MS = 1400;

/**
 * Returns `[state, react, settle]`: the state to give to `<Pip>`, the function that starts a
 * reaction, and a function that ends a running reaction early.
 */
export function usePipMood(base: PipState, opts: PipMoodOptions = {}): [PipState, PipReact, () => void] {
  const { defaultMs = PIP_REACTION_MS, resetOnBaseChange = false } = opts;
  const [reaction, setReaction] = useState<PipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultMsRef = useRef(defaultMs);
  defaultMsRef.current = defaultMs;

  const settle = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setReaction(null);
  }, []);

  const react = useCallback<PipReact>((state, ms) => {
    if (timer.current !== null) clearTimeout(timer.current);
    const duration = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : defaultMsRef.current;
    setReaction(state);
    timer.current = setTimeout(() => {
      timer.current = null;
      setReaction(null);
    }, duration);
  }, []);

  const previousBase = useRef(base);
  useEffect(() => {
    if (previousBase.current === base) return;
    previousBase.current = base;
    if (resetOnBaseChange) settle();
  }, [base, resetOnBaseChange, settle]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return [reaction ?? base, react, settle];
}
