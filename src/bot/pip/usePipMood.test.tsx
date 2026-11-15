import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipState } from './states';
import { PIP_REACTION_MS, usePipMood } from './usePipMood';

describe('usePipMood', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the base state until something happens', () => {
    const { result } = renderHook(() => usePipMood('idle'));
    expect(result.current[0]).toBe('idle');
  });

  it('shows a reaction for the given time and then returns to the base state', () => {
    const { result } = renderHook(() => usePipMood('idle'));
    act(() => result.current[1]('giggle', 1200));
    expect(result.current[0]).toBe('giggle');
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(result.current[0]).toBe('giggle');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe('idle');
  });

  it('uses the default time when none is given', () => {
    const { result } = renderHook(() => usePipMood('idle'));
    act(() => result.current[1]('celebrating'));
    act(() => {
      vi.advanceTimersByTime(PIP_REACTION_MS - 1);
    });
    expect(result.current[0]).toBe('celebrating');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe('idle');
  });

  it('takes the default time from the options', () => {
    const { result } = renderHook(() => usePipMood('idle', { defaultMs: 300 }));
    act(() => result.current[1]('jump_scared'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current[0]).toBe('idle');
  });

  it('lets a new reaction replace a running one and restart the clock', () => {
    const { result } = renderHook(() => usePipMood('idle'));
    act(() => result.current[1]('giggle', 1000));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => result.current[1]('celebrating', 1000));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // The first timer would have ended by now.
    expect(result.current[0]).toBe('celebrating');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current[0]).toBe('idle');
  });

  it('returns to the base state of that moment, and lets a reaction play out over a base change', () => {
    const { result, rerender } = renderHook(({ base }: { base: PipState }) => usePipMood(base), {
      initialProps: { base: 'thinking' as PipState },
    });
    act(() => result.current[1]('celebrating', 1000));
    rerender({ base: 'talking' });
    expect(result.current[0]).toBe('celebrating');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current[0]).toBe('talking');
  });

  it('can end a reaction at once when the base state changes', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: PipState }) => usePipMood(base, { resetOnBaseChange: true }),
      { initialProps: { base: 'idle' as PipState } },
    );
    act(() => result.current[1]('giggle', 5000));
    expect(result.current[0]).toBe('giggle');
    rerender({ base: 'listening' });
    expect(result.current[0]).toBe('listening');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends a reaction early with settle', () => {
    const { result } = renderHook(() => usePipMood('idle'));
    act(() => result.current[1]('sad', 5000));
    act(() => result.current[2]());
    expect(result.current[0]).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the same react function between renders', () => {
    const { result, rerender } = renderHook(() => usePipMood('idle'));
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
  });

  it('leaves no timer behind when the component goes away', () => {
    const { result, unmount } = renderHook(() => usePipMood('idle'));
    act(() => result.current[1]('giggle', 5000));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats a time that is not a number as the default, and a negative time as zero', () => {
    const { result } = renderHook(() => usePipMood('idle'));
    act(() => result.current[1]('giggle', Number.NaN));
    act(() => {
      vi.advanceTimersByTime(PIP_REACTION_MS);
    });
    expect(result.current[0]).toBe('idle');
    act(() => result.current[1]('giggle', -50));
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current[0]).toBe('idle');
  });
});
