import { useCallback, useState, type JSX } from 'react';
import { motion } from 'motion/react';
import type { SortInteraction } from '@/core/schemas';
import type { WidgetProps } from './ChoiceWidget';
import { cx, EmojiLabel, fill, FOCUS_RING, HINT_GLOW, SrOnly, useDragToZone } from './common';

const TRAY = '__tray__';

type Item = SortInteraction['items'][number];

/**
 * Item cards and bin drop zones. Three ways to sort, all equal:
 * drag a card onto a box, tap a card then tap a box, or use the keyboard
 * (cards and boxes are buttons). Under a finger a card is picked up after a
 * short hold, so a swipe that starts on a card scrolls the page.
 */
export function SortWidget({ interaction, value, onChange, disabled, highlight, labels }: WidgetProps<SortInteraction, Record<string, string>>): JSX.Element {
  const [pickedId, setPickedId] = useState<string | null>(null);

  const place = useCallback(
    (itemId: string, zone: string | null) => {
      if (disabled || zone === null) return;
      const next = { ...value };
      if (zone === TRAY) delete next[itemId];
      else if (interaction.bins.some((bin) => bin.id === zone)) next[itemId] = zone;
      else return;
      onChange(next);
      setPickedId(null);
    },
    [disabled, interaction.bins, onChange, value],
  );

  const { drag, handlersFor, consumeClick } = useDragToZone(place, disabled);

  const picked = pickedId ? interaction.items.find((item) => item.id === pickedId) : undefined;

  const renderCard = (item: Item): JSX.Element => {
    const dragging = drag?.id === item.id;
    const isPicked = pickedId === item.id;
    return (
      <motion.button
        key={item.id}
        layout={!dragging}
        layoutId={`sort-${item.id}`}
        type="button"
        disabled={disabled}
        aria-pressed={isPicked}
        {...handlersFor(item.id)}
        onClick={(event) => {
          event.stopPropagation(); // the box around the card must not also react
          if (consumeClick() || disabled) return;
          setPickedId(isPicked ? null : item.id);
        }}
        // A swipe that starts on a card scrolls the page; a finger that rests on it picks it up (see `useDragToZone`).
        style={dragging ? { x: drag.dx, y: drag.dy, zIndex: 30, touchAction: 'pan-y' } : { touchAction: 'pan-y' }}
        className={cx(
          'relative flex min-h-14 max-w-full cursor-grab select-none items-center rounded-2xl border-4 bg-white px-3 py-2 text-lg font-bold text-ink-900 shadow-sm [-webkit-touch-callout:none] active:cursor-grabbing',
          isPicked ? 'border-brand-500 bg-brand-100' : 'border-sun-300',
          dragging && 'shadow-xl ring-4 ring-brand-300',
          highlight.has(item.id) && HINT_GLOW,
          FOCUS_RING,
        )}
      >
        <EmojiLabel emoji={item.emoji} label={item.label} />
      </motion.button>
    );
  };

  const unplaced = interaction.items.filter((item) => value[item.id] === undefined);
  const binColumns = interaction.bins.length >= 3 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold text-ink-500">{labels.sortHint}</p>
      <SrOnly live>{picked ? fill(labels.sortPicked, { item: picked.label }) : ''}</SrOnly>

      <div
        data-dropzone={TRAY}
        onClick={() => {
          if (pickedId && value[pickedId] !== undefined) place(pickedId, TRAY);
        }}
        className={cx(
          'flex min-h-20 flex-wrap items-center gap-2 rounded-3xl border-4 border-dashed p-3 transition-colors',
          drag?.over === TRAY ? 'border-brand-500 bg-brand-50' : 'border-brand-100 bg-white',
        )}
        role="group"
        aria-label={labels.sortTray}
      >
        {unplaced.map(renderCard)}
        {pickedId && value[pickedId] !== undefined ? (
          <button
            type="button"
            className={cx('min-h-14 rounded-2xl border-4 border-dashed border-brand-300 px-4 text-base font-bold text-brand-700', FOCUS_RING)}
          >
            {labels.takeOut}
          </button>
        ) : null}
      </div>

      <div className={cx('grid gap-3', binColumns)}>
        {interaction.bins.map((bin) => {
          const inside = interaction.items.filter((item) => value[item.id] === bin.id);
          const hovered = drag?.over === bin.id;
          return (
            <div
              key={bin.id}
              data-dropzone={bin.id}
              onClick={() => {
                if (pickedId) place(pickedId, bin.id);
              }}
              className={cx(
                'flex min-h-36 flex-col gap-2 rounded-3xl border-4 p-2 transition-colors',
                hovered || (pickedId && !disabled) ? 'border-brand-500 bg-brand-50' : 'border-brand-100 bg-white',
                hovered && 'scale-[1.02]',
                highlight.has(bin.id) && HINT_GLOW,
              )}
              role="group"
              aria-label={bin.label}
            >
              <button
                type="button"
                disabled={disabled}
                aria-label={picked ? `${fill(labels.putIn, { bin: bin.label })}: ${picked.label}` : bin.label}
                className={cx(
                  'flex min-h-14 items-center justify-center rounded-2xl bg-brand-500 px-2 py-1 text-lg font-extrabold text-white',
                  FOCUS_RING,
                )}
              >
                <EmojiLabel emoji={bin.emoji} label={bin.label} />
              </button>
              <div className="flex flex-1 flex-wrap content-start gap-2">{inside.map(renderCard)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
