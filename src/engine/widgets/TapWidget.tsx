import type { JSX } from 'react';
import type { TapInteraction } from '@/core/schemas';
import type { WidgetProps } from './ChoiceWidget';
import { cx, fill, FOCUS_RING } from './common';

/** Selection happens on the canvas. This shows the count and a way to start over. */
export function TapWidget({ value, onChange, disabled, labels }: WidgetProps<TapInteraction, string[]>): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-white p-3 shadow-sm">
      <div className="flex min-w-0 flex-col">
        <p className="text-base font-semibold text-ink-500">
          <span aria-hidden="true">👆 </span>
          {labels.tapHint}
        </p>
        <p className="text-2xl font-extrabold text-brand-700" role="status" aria-live="polite">
          {fill(labels.selected, { n: value.length })}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled || value.length === 0}
        onClick={() => onChange([])}
        className={cx(
          'min-h-14 rounded-2xl border-4 border-brand-100 bg-white px-5 text-lg font-bold text-ink-700',
          'disabled:opacity-40',
          FOCUS_RING,
        )}
      >
        {labels.clear}
      </button>
    </div>
  );
}
