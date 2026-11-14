import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';

// ---------------------------------------------------------------------------
// Chip: a small selectable button (interests, filters, quick choices)
// ---------------------------------------------------------------------------

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** When set, the chip is a toggle and reports its state with `aria-pressed`. */
  selected?: boolean;
  /** Decorative emoji before the label. */
  emoji?: string;
  /** 'lg' is 56 px tall for the child area. */
  size?: 'md' | 'lg';
  ref?: Ref<HTMLButtonElement>;
}

export function Chip({ selected, emoji, size = 'md', type = 'button', className, children, ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      {...rest}
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-full border-2 font-bold',
        'transition-[background-color,border-color,transform] duration-150 active:scale-[0.96]',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        size === 'lg' ? 'min-h-14 px-5 text-lg' : 'min-h-11 px-4 text-sm',
        selected
          ? 'border-brand-500 bg-brand-500 text-white hover:bg-brand-600'
          : 'border-ink-400 bg-white text-ink-900 hover:border-brand-500 hover:bg-brand-50',
        className,
      )}
    >
      {emoji !== undefined && <span aria-hidden="true">{emoji}</span>}
      {children}
      {selected && (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badge: a small, static label
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

/** Every pair is AA: the 700 shade on its 100 tint. */
const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'border-ink-200 bg-ink-100 text-ink-700',
  brand: 'border-brand-200 bg-brand-100 text-brand-700',
  success: 'border-leaf-600 bg-leaf-100 text-leaf-700',
  warning: 'border-sun-500 bg-sun-100 text-sun-700',
  danger: 'border-coral-600 bg-coral-100 text-coral-800',
  info: 'border-sky-600 bg-sky-100 text-sky-700',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  emoji?: string;
  size?: 'sm' | 'md';
  ref?: Ref<HTMLSpanElement>;
}

export function Badge({ tone = 'neutral', emoji, size = 'sm', className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-bold',
        size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs',
        BADGE_TONE[tone],
        className,
      )}
    >
      {emoji !== undefined && <span aria-hidden="true">{emoji}</span>}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat: a label and a value for dashboards
// ---------------------------------------------------------------------------

export interface StatProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode;
  value: ReactNode;
  /** Small supporting text under the value, e.g. "this week". */
  hint?: ReactNode;
  emoji?: string;
  tone?: 'plain' | 'tinted';
}

export function Stat({ label, value, hint, emoji, tone = 'plain', className, ...rest }: StatProps) {
  return (
    <div
      {...rest}
      className={cx(
        'flex min-w-0 flex-col gap-0.5 rounded-2xl border p-4 text-ink-900',
        tone === 'tinted' ? 'border-brand-200 bg-brand-50' : 'border-ink-200 bg-white',
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-500">
        {emoji !== undefined && <span aria-hidden="true">{emoji}</span>}
        {label}
      </p>
      <p className="font-display text-3xl font-bold leading-tight tabular-nums">{value}</p>
      {hint !== undefined && <p className="text-sm text-ink-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Big friendly picture. */
  emoji?: string;
  title: ReactNode;
  description?: ReactNode;
  /** A button or link that fixes the emptiness. */
  action?: ReactNode;
  /** Child-area look: bigger and bouncier. */
  playful?: boolean;
}

export function EmptyState({ emoji, title, description, action, playful = false, className, children, ...rest }: EmptyStateProps) {
  return (
    <div {...rest} className={cx('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      {emoji !== undefined && (
        <span aria-hidden="true" className={cx('leading-none', playful ? 'animate-float text-7xl' : 'text-5xl')}>
          {emoji}
        </span>
      )}
      <h2 className={cx('font-display font-bold leading-tight', playful ? 'text-3xl' : 'text-xl')}>{title}</h2>
      {description !== undefined && (
        <p className={cx('max-w-md opacity-80', playful ? 'text-lg' : 'text-base')}>{description}</p>
      )}
      {children}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
