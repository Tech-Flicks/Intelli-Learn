/**
 * Stand-in for `@/bot/pip` in the child module's tests: the real mascot runs an animation
 * loop that jsdom has no use for. Use it with
 * `vi.mock('@/bot/pip', () => import('./testing/pipMock'))`.
 */
import type { JSX } from 'react';

export function Pip(props: { state?: string; onTap?: () => void; ariaLabel?: string }): JSX.Element {
  return <div data-testid="pip" data-state={props.state ?? 'idle'} role="img" aria-label={props.ariaLabel ?? 'Pip'} />;
}

export function usePipMood(base: string): [string, () => void, () => void] {
  return [base, () => undefined, () => undefined];
}

export const PIP_STATES: readonly string[] = [];
