import type { JSX, KeyboardEvent } from 'react';
import { Reorder } from 'motion/react';
import type { OrderInteraction } from '@/core/schemas';
import type { WidgetProps } from './ChoiceWidget';
import { cx, EmojiLabel, fill, FOCUS_RING, HINT_GLOW } from './common';

/**
 * A column of cards between the "start" and "end" labels. Reorder by dragging
 * a card, by tapping its arrows, or with the arrow keys while an arrow button
 * has focus.
 */
export function OrderWidget({ interaction, value, onChange, disabled, highlight, labels }: WidgetProps<OrderInteraction, string[]>): JSX.Element {
  const byId = new Map(interaction.items.map((item) => [item.id, item]));
  // Tolerate a stale draft: show every item exactly once.
  const known = value.filter((id, index) => byId.has(id) && value.indexOf(id) === index);
  const ids = [...known, ...interaction.items.map((item) => item.id).filter((id) => !known.includes(id))];

  const move = (id: string, delta: -1 | 1): void => {
    if (disabled) return;
    const index = ids.indexOf(id);
    const next = index + delta;
    if (index === -1 || next < 0 || next >= ids.length) return;
    const out = ids.slice();
    out[index] = ids[next] as string;
    out[next] = id;
    onChange(out);
  };

  const onKey = (id: string, event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(id, -1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(id, 1);
    }
  };

  const arrowClass = (off: boolean): string =>
    cx(
      'flex h-14 w-12 items-center justify-center rounded-xl border-2 border-brand-100 bg-brand-50 text-2xl font-black text-brand-700',
      off && 'opacity-30',
      FOCUS_RING,
    );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-semibold text-ink-500">{labels.orderHint}</p>
      <p className="text-center text-sm font-extrabold tracking-wide text-brand-700 uppercase" aria-hidden="true">
        ▲ {interaction.startLabel}
      </p>
      <Reorder.Group
        axis="y"
        values={ids}
        onReorder={(next: string[]) => {
          if (!disabled) onChange(next);
        }}
        className="m-0 flex list-none flex-col gap-2 p-0"
        aria-label={`${interaction.startLabel} → ${interaction.endLabel}`}
      >
        {ids.map((id, index) => {
          const item = byId.get(id);
          if (!item) return null;
          const first = index === 0;
          const last = index === ids.length - 1;
          return (
            <Reorder.Item
              key={id}
              value={id}
              drag={disabled ? false : 'y'}
              whileDrag={{ scale: 1.04, boxShadow: '0 12px 24px rgba(31, 26, 61, 0.25)' }}
              className={cx(
                'flex min-h-16 cursor-grab items-center gap-2 rounded-2xl border-4 border-brand-100 bg-white px-2 py-1 text-lg font-bold text-ink-900 shadow-sm active:cursor-grabbing',
                highlight.has(id) && HINT_GLOW,
              )}
              aria-label={`${item.label}. ${fill(labels.position, { n: index + 1, total: ids.length })}`}
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sun-300 text-base font-extrabold text-ink-900"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <EmojiLabel emoji={item.emoji} label={item.label} />
              </span>
              <button
                type="button"
                aria-label={fill(labels.moveEarlier, { item: item.label })}
                aria-disabled={first || disabled}
                onClick={() => move(id, -1)}
                onKeyDown={(event) => onKey(id, event)}
                onPointerDown={(event) => event.stopPropagation()}
                className={arrowClass(first || disabled)}
              >
                <span aria-hidden="true">▲</span>
              </button>
              <button
                type="button"
                aria-label={fill(labels.moveLater, { item: item.label })}
                aria-disabled={last || disabled}
                onClick={() => move(id, 1)}
                onKeyDown={(event) => onKey(id, event)}
                onPointerDown={(event) => event.stopPropagation()}
                className={arrowClass(last || disabled)}
              >
                <span aria-hidden="true">▼</span>
              </button>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      <p className="text-center text-sm font-extrabold tracking-wide text-brand-700 uppercase" aria-hidden="true">
        ▼ {interaction.endLabel}
      </p>
    </div>
  );
}
