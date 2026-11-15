/**
 * Pure helpers for the parent area: dates and numbers in the interface language, week
 * arithmetic, and a readable form of what a child answered.
 */
import { dayKey } from '@/core/grades';
import type { Challenge, Interaction, SceneObject } from '@/core/schemas';
import type { Locale } from '@/core/types';
import type { Translate } from '@/i18n';

// ---------------------------------------------------------------------------
// Intl
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function dateFormatter(locale: Locale, name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale}|${name}`;
  let found = formatters.get(key) as Intl.DateTimeFormat | undefined;
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}

function numberFormatter(locale: Locale, name: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale}|${name}`;
  let found = formatters.get(key) as Intl.NumberFormat | undefined;
  if (!found) {
    found = new Intl.NumberFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}

/** "Nov 15, 2026" */
export function formatDate(at: number, locale: Locale): string {
  return dateFormatter(locale, 'date', { dateStyle: 'medium' }).format(at);
}

/** "Nov 15, 2026, 4:05 PM" */
export function formatDateTime(at: number, locale: Locale): string {
  return dateFormatter(locale, 'dateTime', { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

/** "Nov 15" */
export function formatShortDate(at: number, locale: Locale): string {
  return dateFormatter(locale, 'short', { month: 'short', day: 'numeric' }).format(at);
}

export function formatNumber(value: number, locale: Locale): string {
  return numberFormatter(locale, 'plain', { maximumFractionDigits: 2 }).format(value);
}

/** A share 0..1 as a whole percentage: "67%". */
export function formatPercent(share: number, locale: Locale): string {
  const safe = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  return numberFormatter(locale, 'percent', { style: 'percent', maximumFractionDigits: 0 }).format(safe);
}

/** An hour of the day (0..24) the way the locale writes clock times: "7:00 AM", "20:00". */
export function formatHour(hour: number, locale: Locale): string {
  const safe = ((Math.round(hour) % 24) + 24) % 24;
  return dateFormatter(locale, 'hour', { hour: 'numeric', minute: '2-digit' }).format(new Date(2024, 0, 1, safe, 0, 0));
}

/** Time spent on one challenge: "45 s", "3 min 20 s", "1 h 5 min". */
export function formatDuration(ms: number, locale: Locale, t: Translate): string {
  const totalSeconds = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const n = (value: number) => formatNumber(value, locale);
  if (totalSeconds < 60) return t('parent.duration.s', { s: n(totalSeconds) });
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? t('parent.duration.m', { m: n(minutes) }) : t('parent.duration.ms', { m: n(minutes), s: n(seconds) });
  }
  return t('parent.duration.hm', { h: n(Math.floor(minutes / 60)), m: n(minutes % 60) });
}

// ---------------------------------------------------------------------------
// Days and weeks (local time)
// ---------------------------------------------------------------------------

/** Local midnight at the start of a `YYYY-MM-DD` day, or null when the text is not a day. */
export function dayStart(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** The day `offset` days after `day` (negative goes back), as `YYYY-MM-DD`. */
export function addDays(day: string, offset: number): string {
  const start = dayStart(day);
  if (start === null) return day;
  const date = new Date(start);
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));
}

/** The Mondays of the most recent `count` weeks, newest first, starting at `currentWeekStart`. */
export function recentWeeks(currentWeekStart: string, count: number): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => addDays(currentWeekStart, -7 * index));
}

/** "Nov 9 – Nov 15, 2026" for the week that starts on `weekStart`. */
export function weekRangeLabel(weekStart: string, locale: Locale): string {
  const from = dayStart(weekStart);
  const to = dayStart(addDays(weekStart, 6));
  if (from === null || to === null) return weekStart;
  return `${formatShortDate(from, locale)} – ${formatDate(to, locale)}`;
}

// ---------------------------------------------------------------------------
// Answers in readable form
// ---------------------------------------------------------------------------

function withEmoji(item: { label: string; emoji?: string | undefined }): string {
  return item.emoji ? `${item.emoji} ${item.label}` : item.label;
}

function sceneObjectName(object: SceneObject | undefined, id: string): string {
  if (!object) return id;
  const picture = object.type === 'emoji' ? object.emoji : object.type === 'text' ? object.text : undefined;
  const parts = [picture, object.label].filter((part): part is string => typeof part === 'string' && part !== '');
  return parts.length > 0 ? parts.join(' ') : id;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function robotSteps(value: unknown, t: Translate, depth = 0): string | null {
  if (!Array.isArray(value) || depth > 3) return null;
  const parts: string[] = [];
  for (const step of value) {
    if (typeof step !== 'object' || step === null) return null;
    const { cmd, times, body } = step as { cmd?: unknown; times?: unknown; body?: unknown };
    if (cmd === 'forward' || cmd === 'left' || cmd === 'right') {
      parts.push(t(`parent.answer.robot.${cmd}`));
    } else if (cmd === 'repeat') {
      const inner = robotSteps(body, t, depth + 1);
      if (inner === null) return null;
      parts.push(t('parent.answer.robot.repeat', { times: typeof times === 'number' ? times : 2, body: inner }));
    } else {
      return null;
    }
  }
  return parts.join(', ');
}

function fallback(answer: unknown, t: Translate): string {
  if (answer === null || answer === undefined) return t('parent.answer.none');
  if (typeof answer === 'string' || typeof answer === 'number') return String(answer);
  try {
    return JSON.stringify(answer);
  } catch {
    return t('parent.answer.none');
  }
}

/**
 * What the child answered, in words a parent can read: option labels instead of ids,
 * "item → bin" for sorting, the robot program as a list of moves. Stored answers are
 * untrusted (`unknown`), so anything that does not fit the interaction is shown as it is.
 */
export function describeAnswer(challenge: Challenge, answer: unknown, locale: Locale, t: Translate): string {
  const interaction: Interaction = challenge.interaction;
  const list = (parts: string[]) => (parts.length > 0 ? parts.join(', ') : t('parent.answer.none'));
  switch (interaction.kind) {
    case 'choice': {
      if (!isStringArray(answer)) return fallback(answer, t);
      return list(answer.map((id) => {
        const option = interaction.options.find((entry) => entry.id === id);
        return option ? withEmoji(option) : id;
      }));
    }
    case 'tap': {
      if (!isStringArray(answer)) return fallback(answer, t);
      return list(answer.map((id) => sceneObjectName(challenge.scene.objects.find((object) => object.id === id), id)));
    }
    case 'sort': {
      if (!isStringRecord(answer)) return fallback(answer, t);
      return list(
        Object.entries(answer).map(([itemId, binId]) => {
          const item = interaction.items.find((entry) => entry.id === itemId);
          const bin = interaction.bins.find((entry) => entry.id === binId);
          return `${item ? withEmoji(item) : itemId} → ${bin ? withEmoji(bin) : binId}`;
        }),
      );
    }
    case 'match': {
      if (!isStringRecord(answer)) return fallback(answer, t);
      return list(
        Object.entries(answer).map(([leftId, rightId]) => {
          const left = interaction.pairs.find((entry) => entry.id === leftId);
          const right = interaction.pairs.find((entry) => entry.id === rightId);
          return `${left ? withEmoji(left.left) : leftId} ↔ ${right ? withEmoji(right.right) : rightId}`;
        }),
      );
    }
    case 'order': {
      if (!isStringArray(answer)) return fallback(answer, t);
      return answer.length === 0
        ? t('parent.answer.none')
        : answer
            .map((id) => {
              const item = interaction.items.find((entry) => entry.id === id);
              return item ? withEmoji(item) : id;
            })
            .join(' → ');
    }
    case 'number': {
      if (typeof answer !== 'number' || !Number.isFinite(answer)) return fallback(answer, t);
      const text = numberFormatter(locale, 'answer', { maximumFractionDigits: 6 }).format(answer);
      return interaction.unit ? `${text} ${interaction.unit}` : text;
    }
    case 'robot': {
      const steps = robotSteps(answer, t);
      if (steps === null) return fallback(answer, t);
      return steps === '' ? t('parent.answer.none') : steps;
    }
    case 'build': {
      if (!isStringArray(answer)) return fallback(answer, t);
      return list(answer.map((id) => {
        const part = interaction.parts.find((entry) => entry.id === id);
        return part ? withEmoji(part) : id;
      }));
    }
  }
}

/** The answer key of a challenge in the same readable form, for the parent's replay view. */
export function describeSolution(challenge: Challenge, locale: Locale, t: Translate): string | null {
  const interaction = challenge.interaction;
  switch (interaction.kind) {
    case 'choice':
      return describeAnswer(challenge, interaction.correctIds, locale, t);
    case 'tap':
      return describeAnswer(challenge, interaction.targetIds, locale, t);
    case 'sort':
      return describeAnswer(challenge, Object.fromEntries(interaction.items.map((item) => [item.id, item.binId])), locale, t);
    case 'match':
      return describeAnswer(challenge, Object.fromEntries(interaction.pairs.map((pair) => [pair.id, pair.id])), locale, t);
    case 'order':
      return describeAnswer(challenge, interaction.items.map((item) => item.id), locale, t);
    case 'number':
      return describeAnswer(challenge, interaction.answer, locale, t);
    case 'robot':
    case 'build':
      // Many programs and many part sets are right; the walkthrough explains one of them.
      return null;
  }
}
