/** Applies a child's accessibility settings to the whole page, and reports reduced motion to components. */
import { useSyncExternalStore } from 'react';
import type { AccessibilitySettings } from '@/core/types';

/** Setting -> class on `<html>`. The CSS for these classes lives in `src/index.css`. */
export const A11Y_CLASSES = {
  dyslexiaFont: 'a11y-dyslexia',
  largeText: 'a11y-large',
  highContrast: 'a11y-contrast',
  reducedMotion: 'a11y-calm',
} as const satisfies Partial<Record<keyof AccessibilitySettings, string>>;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Sets or removes the accessibility classes on `<html>`. Pass the active
 * child's settings in the child area, and `null` to clear them (parent area,
 * profile picker).
 */
export function applyAccessibility(settings: AccessibilitySettings | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, className] of Object.entries(A11Y_CLASSES) as [keyof typeof A11Y_CLASSES, string][]) {
    root.classList.toggle(className, Boolean(settings?.[key]));
  }
  notify();
}

function osPrefersReducedMotion(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

/** True when calm mode is on or the operating system asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.classList.contains(A11Y_CLASSES.reducedMotion)) return true;
  return osPrefersReducedMotion()?.matches ?? false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const query = osPrefersReducedMotion();
  query?.addEventListener?.('change', listener);
  return () => {
    listeners.delete(listener);
    query?.removeEventListener?.('change', listener);
  };
}

/**
 * True when the `a11y-calm` class is set OR the OS prefers reduced motion.
 * Use it to switch off JavaScript-driven animation (motion, canvas); CSS
 * animations and transitions are already disabled by the stylesheet.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
