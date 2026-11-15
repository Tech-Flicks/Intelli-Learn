/** Data hooks shared by the parent screens. */
import { useEffect, useMemo, useState, type DependencyList } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ChildProfile, Locale, Settings } from '@/core/types';
import { db, getSettings, listChildren } from '@/data';
import { useLocale, useT, type Translate } from '@/i18n';
import { tabId } from '@/ui';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatHour,
  formatNumber,
  formatPercent,
  formatShortDate,
  weekRangeLabel,
} from './format';

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), []);
}

/** Every profile, oldest first. `undefined` while loading. */
export function useChildren(): ChildProfile[] | undefined {
  return useLiveQuery(() => listChildren(), []);
}

/** One profile: `null` when there is no such child, `undefined` while it loads. */
export function useChild(childId: string | undefined): ChildProfile | null | undefined {
  const result = useLiveQuery(
    async () => ({ id: childId, child: childId ? ((await db.children.get(childId)) ?? null) : null }),
    [childId],
  );
  if (!result || result.id !== childId) return undefined;
  return result.child;
}

/**
 * Runs an async read outside a live query and keeps its latest result. For functions that
 * are not guaranteed to be read-only (they must not run inside `useLiveQuery`).
 */
export function useAsync<T>(read: () => Promise<T>, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    read().then(
      (result) => {
        if (alive) setValue(result);
      },
      () => {
        if (alive) setValue(undefined);
      },
    );
    return () => {
      alive = false;
    };
    // The caller lists what the read depends on.
  }, deps);
  return value;
}

/** The current time, refreshed on an interval. Used for countdowns. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

/**
 * Keeps the selected tab of a scrolling tab row in view. On a phone the row is wider than
 * the screen, and a tab opened from a link ("?tab=data") would otherwise sit out of sight.
 * `ready` is false while the row is not rendered yet.
 */
export function useTabInView(idBase: string, tab: string, ready = true): void {
  useEffect(() => {
    if (!ready) return;
    const element = document.getElementById(tabId(idBase, tab));
    if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [idBase, tab, ready]);
}

export interface Formatters {
  locale: Locale;
  t: Translate;
  date: (at: number) => string;
  dateTime: (at: number) => string;
  shortDate: (at: number) => string;
  number: (value: number) => string;
  percent: (share: number) => string;
  hour: (hour: number) => string;
  duration: (ms: number) => string;
  weekRange: (weekStart: string) => string;
}

/** `t` plus Intl formatters bound to the interface language. */
export function useFormat(): Formatters {
  const locale = useLocale();
  const t = useT();
  return useMemo(
    () => ({
      locale,
      t,
      date: (at) => formatDate(at, locale),
      dateTime: (at) => formatDateTime(at, locale),
      shortDate: (at) => formatShortDate(at, locale),
      number: (value) => formatNumber(value, locale),
      percent: (share) => formatPercent(share, locale),
      hour: (hour) => formatHour(hour, locale),
      duration: (ms) => formatDuration(ms, locale, t),
      weekRange: (weekStart) => weekRangeLabel(weekStart, locale),
    }),
    [locale, t],
  );
}
