import type { JSX } from 'react';
import { motion } from 'motion/react';
import type { BuildInteraction } from '@/core/schemas';
import { buildTotals } from '../build';
import type { WidgetProps } from './ChoiceWidget';
import { cx, fill, FOCUS_RING, hasLongWord, HINT_GLOW } from './common';
import { formatNumber } from './draft';

interface MeterProps {
  icon: string;
  label: string;
  value: number;
  max: number;
  /** True when the meter is in a good state (target reached / inside the budget). */
  good: boolean;
  note: string;
  /** For the budget: going past `max` is the thing to avoid. */
  limit?: boolean;
  reducedMotion: boolean;
}

function Meter({ icon, label, value, max, good, note, limit = false, reducedMotion }: MeterProps): JSX.Element {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const over = limit && !good;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-base font-bold text-ink-700">
        <span>
          <span aria-hidden="true">{icon} </span>
          {label}
        </span>
        <span className="tabular-nums">
          <span className="text-xl font-extrabold text-ink-900">{formatNumber(value)}</span> / {formatNumber(max)}
        </span>
      </div>
      <div
        className="relative h-5 overflow-hidden rounded-full bg-brand-100"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-valuetext={`${formatNumber(value)} / ${formatNumber(max)}. ${note}`}
      >
        <motion.div
          className={cx('h-full rounded-full', over ? 'bg-coral-400' : good ? 'bg-leaf-400' : 'bg-sun-400')}
          initial={false}
          animate={{ width: `${share * 100}%` }}
          transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 26 }}
        />
        {over ? (
          <span aria-hidden="true" className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_8px,rgba(255,255,255,0.45)_8px_16px)]" />
        ) : null}
      </div>
      <p className={cx('text-sm font-bold', over ? 'text-coral-600' : good ? 'text-leaf-600' : 'text-ink-500')} role="status">
        {good && !limit ? <span aria-hidden="true">✓ </span> : null}
        {note}
      </p>
    </div>
  );
}

/** Part cards with power and cost, and live meters for power vs target and cost vs budget. */
export function BuildWidget({ interaction, value, onChange, disabled, reducedMotion, highlight, labels }: WidgetProps<BuildInteraction, string[]>): JSX.Element {
  const totals = buildTotals(interaction, value);
  const toggle = (id: string): void => {
    if (disabled) return;
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  const missing = Math.max(0, interaction.target - totals.power);
  const spare = interaction.budget - totals.cost;

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-2xl bg-brand-50 px-3 py-2 text-lg font-bold text-brand-700">
        <span aria-hidden="true">🎯 </span>
        {fill(labels.buildGoal, { goal: interaction.goalLabel })}
      </p>
      <div className="grid gap-3 rounded-3xl bg-white p-3 shadow-sm sm:grid-cols-2">
        <Meter
          icon="⚡"
          label={interaction.powerLabel}
          value={totals.power}
          max={interaction.target}
          good={totals.meetsTarget}
          note={totals.meetsTarget ? labels.enough : fill(labels.needMore, { n: formatNumber(missing) })}
          reducedMotion={reducedMotion}
        />
        <Meter
          icon="🪙"
          label={interaction.costLabel}
          value={totals.cost}
          max={interaction.budget}
          good={totals.withinBudget}
          limit
          note={
            totals.withinBudget
              ? fill(labels.withinBudget, { n: formatNumber(spare) })
              : fill(labels.overBudget, { n: formatNumber(-spare) })
          }
          reducedMotion={reducedMotion}
        />
      </div>
      <div className={cx('grid gap-3', hasLongWord(interaction.parts.map((part) => part.label)) ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2')}>
        {interaction.parts.map((part) => {
          const picked = value.includes(part.id);
          return (
            <motion.button
              key={part.id}
              type="button"
              whileTap={disabled ? undefined : { scale: 0.96 }}
              animate={{ y: picked ? -4 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              disabled={disabled}
              aria-pressed={picked}
              aria-label={`${part.label}. ${interaction.powerLabel} ${formatNumber(part.power)}, ${interaction.costLabel} ${formatNumber(part.cost)}`}
              onClick={() => toggle(part.id)}
              className={cx(
                'relative flex min-h-24 min-w-0 flex-col items-center justify-center gap-1 rounded-3xl border-4 px-2 py-2 text-center text-lg font-bold shadow-sm transition-colors',
                picked ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-brand-100 bg-white text-ink-900',
                disabled && 'opacity-70',
                highlight.has(part.id) && HINT_GLOW,
                FOCUS_RING,
              )}
            >
              {part.emoji ? (
                <span aria-hidden="true" className="text-3xl leading-none">
                  {part.emoji}
                </span>
              ) : null}
              <span className="max-w-full min-w-0 wrap-anywhere">{part.label}</span>
              <span className="flex flex-wrap justify-center gap-2 text-base font-extrabold" aria-hidden="true">
                <span className="rounded-full bg-leaf-400/25 px-2 text-leaf-600">⚡ {formatNumber(part.power)}</span>
                <span className="rounded-full bg-sun-300/60 px-2 text-ink-700">🪙 {formatNumber(part.cost)}</span>
              </span>
              {picked ? (
                <span
                  aria-hidden="true"
                  className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-base text-white"
                >
                  ✓
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
