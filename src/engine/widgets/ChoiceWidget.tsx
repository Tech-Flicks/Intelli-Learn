import type { JSX } from 'react';
import { motion } from 'motion/react';
import type { ChoiceInteraction } from '@/core/schemas';
import { cx, FOCUS_RING, hasLongWord, HINT_GLOW, type StageLabels } from './common';

export interface WidgetProps<I, V> {
  interaction: I;
  value: V;
  onChange: (next: V) => void;
  disabled: boolean;
  reducedMotion: boolean;
  /** Ids the helper bot is pointing at. */
  highlight: ReadonlySet<string>;
  labels: StageLabels;
}

/** Large option cards. One choice, or several when `multi` is true. */
export function ChoiceWidget({ interaction, value, onChange, disabled, highlight, labels }: WidgetProps<ChoiceInteraction, string[]>): JSX.Element {
  const toggle = (id: string): void => {
    if (disabled) return;
    if (interaction.multi) {
      onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    } else {
      onChange(value.includes(id) ? [] : [id]);
    }
  };
  // Two columns, unless there are only two options or a label holds a word too long for half a phone screen.
  const roomy = interaction.options.length <= 2 || hasLongWord(interaction.options.map((option) => option.label));
  const columns = roomy ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold text-ink-500">{interaction.multi ? labels.pickMany : labels.pickOne}</p>
      <div className={cx('grid gap-3', columns)} role="group" aria-label={interaction.multi ? labels.pickMany : labels.pickOne}>
        {interaction.options.map((option) => {
          const picked = value.includes(option.id);
          return (
            <motion.button
              key={option.id}
              type="button"
              whileTap={disabled ? undefined : { scale: 0.96 }}
              animate={{ scale: picked ? 1.03 : 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              disabled={disabled}
              aria-pressed={picked}
              onClick={() => toggle(option.id)}
              className={cx(
                'relative flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-3xl border-4 px-3 py-3 text-center text-xl font-bold shadow-sm transition-colors',
                picked ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-brand-100 bg-white text-ink-900 hover:border-brand-300',
                disabled && 'opacity-70',
                highlight.has(option.id) && HINT_GLOW,
                FOCUS_RING,
              )}
            >
              {option.emoji ? (
                <span aria-hidden="true" className="text-4xl leading-none">
                  {option.emoji}
                </span>
              ) : null}
              {/* A word that is wider than the card breaks inside it; it never runs out of the card. */}
              <span className="max-w-full min-w-0 wrap-anywhere">{option.label}</span>
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
