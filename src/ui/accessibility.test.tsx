import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACCESSIBILITY } from '@/core/defaults';
import { applyAccessibility, prefersReducedMotion, useReducedMotion } from './index';

const root = document.documentElement;

afterEach(() => {
  act(() => applyAccessibility(null));
  vi.unstubAllGlobals();
});

describe('applyAccessibility', () => {
  it('sets one class per enabled setting', () => {
    applyAccessibility({ ...DEFAULT_ACCESSIBILITY, dyslexiaFont: true, highContrast: true });
    expect(root).toHaveClass('a11y-dyslexia', 'a11y-contrast');
    expect(root).not.toHaveClass('a11y-large');
    expect(root).not.toHaveClass('a11y-calm');
  });

  it('removes classes that are switched off again', () => {
    applyAccessibility({ ...DEFAULT_ACCESSIBILITY, largeText: true, reducedMotion: true });
    expect(root).toHaveClass('a11y-large', 'a11y-calm');
    applyAccessibility({ ...DEFAULT_ACCESSIBILITY, largeText: true });
    expect(root).toHaveClass('a11y-large');
    expect(root).not.toHaveClass('a11y-calm');
  });

  it('clears everything with null and leaves other classes alone', () => {
    root.classList.add('some-other-class');
    applyAccessibility({ dyslexiaFont: true, largeText: true, highContrast: true, reducedMotion: true, readAloud: true });
    expect(root).toHaveClass('a11y-dyslexia', 'a11y-large', 'a11y-contrast', 'a11y-calm');
    applyAccessibility(null);
    expect(root.className).toBe('some-other-class');
    root.classList.remove('some-other-class');
  });
});

describe('useReducedMotion', () => {
  it('follows the calm class', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => applyAccessibility({ ...DEFAULT_ACCESSIBILITY, reducedMotion: true }));
    expect(result.current).toBe(true);
    expect(prefersReducedMotion()).toBe(true);
    act(() => applyAccessibility(null));
    expect(result.current).toBe(false);
  });

  it('follows the operating system preference', () => {
    let matches = true;
    const changeListeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        media: query,
        get matches() {
          return matches;
        },
        addEventListener: (_: string, listener: () => void) => changeListeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => changeListeners.delete(listener),
      })),
    );
    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    act(() => {
      matches = false;
      for (const listener of changeListeners) listener();
    });
    expect(result.current).toBe(false);
    unmount();
    expect(changeListeners.size).toBe(0);
  });
});
