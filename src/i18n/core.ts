/**
 * A tiny, dependency-free i18n runtime.
 *
 * - Strings are registered per module with `registerStrings`, at import time,
 *   so no module ever edits a shared dictionary file.
 * - `t(key, vars)` looks the key up in the active locale, then English, then
 *   returns the key itself. `{name}` parts are filled from `vars`.
 * - React components use `useT()` so they re-render when the locale changes.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { LOCALES, type Locale } from '@/core/types';

export type TranslateVars = Record<string, string | number>;
export type StringBundle = Partial<Record<Locale, Record<string, string>>>;
export type Translate = (key: string, vars?: TranslateVars) => string;

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's own name, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  hi: 'हिन्दी',
};

const dictionaries: Record<Locale, Map<string, string>> = {
  en: new Map(),
  es: new Map(),
  hi: new Map(),
};

let currentLocale: Locale = DEFAULT_LOCALE;
/** Bumped on every locale change and every registration. This is the store snapshot. */
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Adds strings to the dictionaries. Call it at module import time:
 *
 *   registerStrings({ en: { 'play.check': 'Check' }, es: { 'play.check': 'Comprobar' } });
 *
 * Prefix keys with the module name. A key registered twice keeps the latest text.
 */
export function registerStrings(bundle: StringBundle): void {
  let changed = false;
  for (const locale of LOCALES) {
    const strings = bundle[locale];
    if (!strings) continue;
    const dictionary = dictionaries[locale];
    for (const [key, text] of Object.entries(strings)) {
      if (typeof text !== 'string' || dictionary.get(key) === text) continue;
      dictionary.set(key, text);
      changed = true;
    }
  }
  if (changed) emit();
}

function interpolate(text: string, vars: TranslateVars | undefined): string {
  if (!vars || !text.includes('{')) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

function translateIn(locale: Locale, key: string, vars?: TranslateVars): string {
  const text = dictionaries[locale].get(key) ?? dictionaries[DEFAULT_LOCALE].get(key) ?? key;
  return interpolate(text, vars);
}

/** Text for `key` in the active locale. Falls back to English, then to the key itself. */
export function t(key: string, vars?: TranslateVars): string {
  return translateIn(currentLocale, key, vars);
}

/** True when the key has text in the given locale (default: the active one) or in English. */
export function hasString(key: string, locale: Locale = currentLocale): boolean {
  return dictionaries[locale].has(key) || dictionaries[DEFAULT_LOCALE].has(key);
}

const pluralRules = new Map<Locale, Intl.PluralRules | null>();

function isSingular(locale: Locale, count: number): boolean {
  let rules = pluralRules.get(locale);
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = null;
    }
    pluralRules.set(locale, rules);
  }
  return rules ? rules.select(count) === 'one' : count === 1;
}

/**
 * Simple plural helper: picks `keyOne` or `keyOther` for `count` by the locale's
 * plural rule and fills `{count}` (plus any extra vars).
 *
 *   tn('shelf.star', 'shelf.stars', 3) // "3 stars"
 */
export function tn(keyOne: string, keyOther: string, count: number, vars?: TranslateVars): string {
  const key = isSingular(currentLocale, count) ? keyOne : keyOther;
  return t(key, { count, ...vars });
}

/** Switches the interface language and updates `<html lang>`. Unknown values fall back to English. */
export function setLocale(locale: Locale): void {
  const next = isLocale(locale) ? locale : DEFAULT_LOCALE;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (next === currentLocale) return;
  currentLocale = next;
  emit();
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Subscribes to locale changes and new registrations. Returns the unsubscribe function. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/**
 * `t` for React components. The returned function changes identity when the
 * locale (or the dictionary) changes, so it is safe in dependency arrays.
 */
export function useT(): Translate {
  const snapshot = useSyncExternalStore(subscribeLocale, getVersion, getVersion);
  // `snapshot` is the only dependency on purpose: a new version means new text.
  return useMemo<Translate>(() => (key, vars) => t(key, vars), [snapshot]);
}

/** The active locale as React state. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
