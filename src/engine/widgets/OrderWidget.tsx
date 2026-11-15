import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import type { OrderInteraction } from '@/core/schemas';
import type { WidgetProps } from './ChoiceWidget';
import { cx, EmojiLabel, fill, FOCUS_RING, HINT_GLOW } from './common';

/**
 * One card of the column. A mouse drags it anywhere; a finger drags it by the grip on its left
 * (the dots and the number). The rest of the card is left to the browser, so a swipe that starts
 * on a card scrolls the page: on a phone the cards fill the screen, and a child who swipes to
 * reach Check must not reorder them by accident.
 */
function OrderCard(props: {
  id: string;
  position: number;
  disabled: boolean;
  glow: boolean;
  label: string;
  gripTitle: string;
  children: ReactNode;
}): JSX.Element {
  const { id, position, disabled, glow, label, gripTitle, children } = props;
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      drag={disabled ? false : 'y'}
      dragListener={false}
      dragControls={controls}
      onPointerDown={(event) => {
        if (!disabled && event.pointerType !== 'touch') controls.start(event);
      }}
      whileDrag={{ scale: 1.04, boxShadow: '0 12px 24px rgba(31, 26, 61, 0.25)' }}
      className={cx(
        'flex min-h-16 cursor-grab items-center gap-2 rounded-2xl border-4 border-brand-100 bg-white py-1 pr-2 pl-1 text-lg font-bold text-ink-900 shadow-sm active:cursor-grabbing',
        glow && HINT_GLOW,
      )}
      aria-label={label}
    >
      <span
        aria-hidden="true"
        data-order-grip=""
        title={gripTitle}
        onPointerDown={(event) => {
          // The card's own handler must not start the same drag a second time.
          event.stopPropagation();
          if (!disabled) controls.start(event);
        }}
        style={{ touchAction: 'none' }}
        className="flex h-14 shrink-0 select-none items-center gap-1 rounded-xl pr-1 pl-1.5 [-webkit-touch-callout:none]"
      >
        <span className="text-xl leading-none text-ink-500">⠿</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sun-300 text-base font-extrabold text-ink-900">{position}</span>
      </span>
      {children}
    </Reorder.Item>
  );
}

/**
 * A column of cards between the "start" and "end" labels. Reorder by dragging
 * a card (under a finger: by its grip), by tapping its arrows, or with the
 * arrow keys while an arrow button has focus.
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
      'flex h-14 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-brand-100 bg-brand-50 text-2xl font-black text-brand-700',
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
            <OrderCard
              key={id}
              id={id}
              position={index + 1}
              disabled={disabled}
              glow={highlight.has(id)}
              label={`${item.label}. ${fill(labels.position, { n: index + 1, total: ids.length })}`}
              gripTitle={fill(labels.drag, { item: item.label })}
            >
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
            </OrderCard>
          );
        })}
      </Reorder.Group>
      <p className="text-center text-sm font-extrabold tracking-wide text-brand-700 uppercase" aria-hidden="true">
        ▼ {interaction.endLabel}
      </p>
    </div>
  );
}
