/**
 * Stand-in for `@/bot/pip` in the play and helper tests: the real mascot runs an animation
 * loop that jsdom has no use for. Use it with
 * `vi.mock('@/bot/pip', () => import('@/play/testing/pipMock'))`.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

export const PIP_STATES: readonly string[] = [];

export function isPipState(value: unknown): boolean {
  return typeof value === 'string';
}

export function Pip(props: { state?: string; talking?: boolean; ariaLabel?: string }): JSX.Element {
  return <span data-testid="pip" data-state={props.state ?? 'idle'} data-talking={props.talking ? 'true' : 'false'} aria-hidden="true" />;
}

export function PipGallery(): JSX.Element {
  return <div />;
}

/** Like the real hook: the base state, unless a short reaction is running. */
export function usePipMood(base: string): [string, (state: string, ms?: number) => void, () => void] {
  const [reaction, setReaction] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const react = (state: string, ms = 1200): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setReaction(state);
    timer.current = setTimeout(() => setReaction(null), ms);
  };
  return [reaction ?? base, react, () => setReaction(null)];
}
