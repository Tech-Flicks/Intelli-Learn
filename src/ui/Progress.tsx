import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { starCountText, useT } from '@/i18n';
import { clamp, cx } from './cx';
import './strings';

export type Tone = 'brand' | 'sun' | 'leaf' | 'coral' | 'sky';

const FILL: Record<Tone, string> = {
  brand: 'bg-brand-500',
  sun: 'bg-sun-500',
  leaf: 'bg-leaf-600',
  coral: 'bg-coral-600',
  sky: 'bg-sky-600',
};

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const SPINNER_SIZE = { sm: 'h-4 w-4 border-2', md: 'h-8 w-8 border-[3px]', lg: 'h-12 w-12 border-4' } as const;

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: keyof typeof SPINNER_SIZE;
  /** Accessible name. Defaults to "Loading…". */
  label?: string;
  /** Show the label next to the spinner instead of only reading it to screen readers. */
  showLabel?: boolean;
  /** Use on a coloured background (inside a primary button). */
  onColor?: boolean;
  /** Only the picture: no status role and no label. For places that already say what is loading. */
  decorative?: boolean;
}

export function Spinner({
  size = 'md',
  label,
  showLabel = false,
  onColor = false,
  decorative = false,
  className,
  ...rest
}: SpinnerProps) {
  const t = useT();
  const ring = (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block shrink-0 animate-spin rounded-full',
        SPINNER_SIZE[size],
        onColor ? 'border-white/40 border-t-white' : 'border-brand-100 border-t-brand-500',
        decorative && className,
      )}
    />
  );
  if (decorative) return ring;
  return (
    <span role="status" {...rest} className={cx('inline-flex items-center gap-2', className)}>
      {ring}
      <span className={showLabel ? 'text-sm font-semibold text-ink-700' : 'sr-only'}>{label ?? t('ui.loading')}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

const BAR_SIZE = { sm: 'h-2', md: 'h-3', lg: 'h-5' } as const;

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number;
  max?: number;
  /** Visible label above the bar. Without it, pass `aria-label`. */
  label?: ReactNode;
  /** Show the percentage next to the label. */
  showValue?: boolean;
  /** Spoken value, e.g. "3 of 5 challenges". Defaults to the percentage. */
  valueText?: string;
  tone?: Tone;
  size?: keyof typeof BAR_SIZE;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = false,
  valueText,
  tone = 'brand',
  size = 'md',
  className,
  ...rest
}: ProgressBarProps) {
  const t = useT();
  const labelId = useId();
  const safeMax = max > 0 ? max : 100;
  const now = clamp(Number.isFinite(value) ? value : 0, 0, safeMax);
  const percent = Math.round((now / safeMax) * 100);
  const percentText = t('ui.percent', { value: percent });
  return (
    <div className={cx('w-full', className)}>
      {(label !== undefined || showValue) && (
        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm font-semibold text-ink-700">
          <span id={labelId}>{label}</span>
          {showValue && <span aria-hidden="true">{valueText ?? percentText}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={now}
        aria-valuetext={valueText ?? percentText}
        aria-labelledby={label !== undefined && !rest['aria-label'] ? labelId : undefined}
        {...rest}
        className={cx('w-full overflow-hidden rounded-full border border-ink-200 bg-ink-100', BAR_SIZE[size])}
      >
        <div
          className={cx('h-full rounded-full transition-[width] duration-500 ease-out', FILL[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

export interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number;
  min?: number;
  max?: number;
  /** Draw the meter as this many separate blocks (e.g. 4 for the steps of a grade). */
  segments?: number;
  label?: ReactNode;
  /** Shown at the right of the label and read by screen readers, e.g. "Strong". */
  valueText?: string;
  tone?: Tone;
  size?: keyof typeof BAR_SIZE;
}

/** A static measurement (mastery, a level), as opposed to the progress of a task. */
export function Meter({
  value,
  min = 0,
  max = 100,
  segments,
  label,
  valueText,
  tone = 'brand',
  size = 'md',
  className,
  ...rest
}: MeterProps) {
  const labelId = useId();
  const safeMax = max > min ? max : min + 1;
  const now = clamp(Number.isFinite(value) ? value : min, min, safeMax);
  const share = (now - min) / (safeMax - min);
  const count = segments && segments > 1 ? Math.floor(segments) : 0;
  return (
    <div className={cx('w-full', className)}>
      {(label !== undefined || valueText !== undefined) && (
        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm font-semibold text-ink-700">
          <span id={labelId}>{label}</span>
          {valueText !== undefined && <span aria-hidden="true">{valueText}</span>}
        </div>
      )}
      <div
        role="meter"
        aria-valuemin={min}
        aria-valuemax={safeMax}
        aria-valuenow={now}
        aria-valuetext={valueText}
        aria-labelledby={label !== undefined && !rest['aria-label'] ? labelId : undefined}
        {...rest}
        className={cx('flex w-full gap-1', BAR_SIZE[size])}
      >
        {count > 0 ? (
          Array.from({ length: count }, (_, index) => {
            const fill = clamp(share * count - index, 0, 1);
            return (
              <div key={index} className="h-full flex-1 overflow-hidden rounded-full border border-ink-200 bg-ink-100">
                <div className={cx('h-full rounded-full', FILL[tone])} style={{ width: `${Math.round(fill * 100)}%` }} />
              </div>
            );
          })
        ) : (
          <div className="h-full flex-1 overflow-hidden rounded-full border border-ink-200 bg-ink-100">
            <div className={cx('h-full rounded-full', FILL[tone])} style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StarCount
// ---------------------------------------------------------------------------

const STAR_SIZE = {
  sm: 'gap-1 px-2 py-0.5 text-sm',
  md: 'gap-1.5 px-3 py-1 text-lg',
  lg: 'gap-2 px-4 py-1.5 text-2xl',
} as const;

export interface StarCountProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  count: number;
  size?: keyof typeof STAR_SIZE;
  /** Plain number without the pill background. */
  bare?: boolean;
}

/** The child's star balance. Reads as "12 stars"; the number pops when it changes. */
export function StarCount({ count, size = 'md', bare = false, className, ...rest }: StarCountProps) {
  // Subscribes to locale changes so the spoken label follows the language.
  useT();
  const safe = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  return (
    <span
      role="img"
      aria-label={starCountText(safe)}
      {...rest}
      className={cx(
        'inline-flex items-center rounded-full font-display font-bold text-ink-900',
        STAR_SIZE[size],
        !bare && 'border-2 border-sun-500 bg-sun-100',
        className,
      )}
    >
      <span aria-hidden="true">⭐</span>
      <span key={safe} aria-hidden="true" className="inline-block animate-pop tabular-nums">
        {safe}
      </span>
    </span>
  );
}
