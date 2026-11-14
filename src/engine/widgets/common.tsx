/** Small pieces shared by the interaction widgets. */
import { useCallback, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

/** Joins class names, skipping empty values. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Visible keyboard focus, the same on every widget control. */
export const FOCUS_RING =
  'outline-none focus-visible:ring-4 focus-visible:ring-sun-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

/** Gentle glow for items the helper bot points at. */
export const HINT_GLOW = 'ring-4 ring-sun-400 animate-pulse motion-reduce:animate-none group-data-[calm=true]/stage:animate-none';

/**
 * Every string the engine shows or speaks. English defaults; pass localized
 * text through `ChallengeStage`'s `labels`. `{name}` parts are filled in.
 */
export interface StageLabels {
  check: string;
  clear: string;
  run: string;
  stop: string;
  pickOne: string;
  pickMany: string;
  tapHint: string;
  selected: string;
  sortHint: string;
  sortTray: string;
  sortPicked: string;
  putIn: string;
  takeOut: string;
  matchHint: string;
  matchLeft: string;
  matchRight: string;
  matched: string;
  orderHint: string;
  moveEarlier: string;
  moveLater: string;
  position: string;
  yourAnswer: string;
  backspace: string;
  decimalPoint: string;
  minus: string;
  robotBoard: string;
  palette: string;
  program: string;
  blocksUsed: string;
  forward: string;
  turnLeft: string;
  turnRight: string;
  repeat: string;
  times: string;
  more: string;
  fewer: string;
  addHere: string;
  addToEnd: string;
  remove: string;
  drag: string;
  emptyProgram: string;
  robotCrash: string;
  robotShort: string;
  robotGems: string;
  robotDone: string;
  gems: string;
  buildGoal: string;
  needMore: string;
  enough: string;
  overBudget: string;
  withinBudget: string;
  picked: string;
}

export const DEFAULT_LABELS: StageLabels = {
  check: 'Check',
  clear: 'Clear',
  run: 'Run',
  stop: 'Stop',
  pickOne: 'Pick one.',
  pickMany: 'Pick all that fit.',
  tapHint: 'Tap the picture to choose.',
  selected: '{n} selected',
  sortHint: 'Drag each card into its box. Or tap a card, then tap a box.',
  sortTray: 'Cards to sort',
  sortPicked: 'Holding {item}. Now choose a box.',
  putIn: 'Put in {bin}',
  takeOut: 'Back to the cards',
  matchHint: 'Tap one on the left, then its partner on the right.',
  matchLeft: 'Left side',
  matchRight: 'Right side',
  matched: 'matched with {item}',
  orderHint: 'Drag the cards or tap the arrows to put them in order.',
  moveEarlier: 'Move {item} earlier',
  moveLater: 'Move {item} later',
  position: 'Position {n} of {total}',
  yourAnswer: 'Your answer',
  backspace: 'Delete',
  decimalPoint: 'Decimal point',
  minus: 'Minus',
  robotBoard: 'Robot map',
  palette: 'Blocks',
  program: 'Your program',
  blocksUsed: '{n} of {max} blocks',
  forward: 'Forward',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  repeat: 'Repeat',
  times: 'times',
  more: 'More times',
  fewer: 'Fewer times',
  addHere: 'Add blocks here',
  addToEnd: 'Add blocks to the end',
  remove: 'Remove {item}',
  drag: 'Drag to move {item}',
  emptyProgram: 'Tap a block to start your program.',
  robotCrash: 'Bonk! The robot bumped into something. Change your blocks and try again.',
  robotShort: 'Not there yet. Where should the robot go next?',
  robotGems: 'So close! There are still gems to collect.',
  robotDone: 'The robot made it! Press Check.',
  gems: 'Gems: {n} of {total}',
  buildGoal: 'Goal: {goal}',
  needMore: 'Need {n} more',
  enough: 'Enough!',
  overBudget: '{n} too many',
  withinBudget: '{n} left',
  picked: 'picked',
};

/** Fills `{name}` placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Visually hidden text that screen readers still read. */
export function SrOnly({ children, live }: { children: React.ReactNode; live?: boolean }): JSX.Element {
  return (
    <span
      className="absolute -m-px h-px w-px overflow-hidden border-0 p-0 whitespace-nowrap"
      style={{ clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)' }}
      aria-live={live ? 'polite' : undefined}
      role={live ? 'status' : undefined}
    >
      {children}
    </span>
  );
}

/** Emoji next to (or above) a text label. The emoji is decoration; the text is the name. */
export function EmojiLabel({ emoji, label, stacked = false }: { emoji?: string | undefined; label: string; stacked?: boolean }): JSX.Element {
  return (
    <span className={cx('flex min-w-0 items-center gap-2', stacked && 'flex-col gap-1 text-center')}>
      {emoji ? (
        <span aria-hidden="true" className={cx('shrink-0 leading-none', stacked ? 'text-4xl' : 'text-2xl')}>
          {emoji}
        </span>
      ) : null}
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}

const DRAG_THRESHOLD = 8;

export interface DragState {
  id: string;
  dx: number;
  dy: number;
  /** Drop zone currently under the pointer. */
  over: string | null;
}

/** Drop-zone id at a point: the nearest ancestor with `data-dropzone`, skipping the dragged element. */
export function zoneAtPoint(x: number, y: number, ignore: Element | null): string | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  for (const el of document.elementsFromPoint(x, y)) {
    if (ignore && (el === ignore || ignore.contains(el))) continue;
    const zone = el.closest<HTMLElement>('[data-dropzone]');
    if (zone) return zone.dataset.dropzone ?? null;
  }
  return null;
}

/**
 * Pointer dragging for cards that can be dropped on `[data-dropzone]` elements.
 *
 * A press that moves less than a few pixels is left alone so the element's
 * ordinary click (tap-to-pick, also what Enter and Space trigger) still fires.
 * After a real drag the following click is swallowed.
 */
export function useDragToZone(onDrop: (id: string, zone: string | null) => void, disabled = false) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const start = useRef<{ id: string; x: number; y: number; pointerId: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  const handlersFor = useCallback(
    (id: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
        start.current = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false };
        swallowClick.current = false;
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is a nicety; dragging still works without it while the pointer stays on the card.
        }
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const s = start.current;
        if (!s || s.id !== id || s.pointerId !== event.pointerId) return;
        const dx = event.clientX - s.x;
        const dy = event.clientY - s.y;
        if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        s.moved = true;
        setDrag({ id, dx, dy, over: zoneAtPoint(event.clientX, event.clientY, event.currentTarget) });
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        const s = start.current;
        start.current = null;
        if (!s || s.id !== id) return;
        if (s.moved) {
          swallowClick.current = true;
          const zone = zoneAtPoint(event.clientX, event.clientY, event.currentTarget);
          setDrag(null);
          onDrop(id, zone);
        }
      },
      onPointerCancel: () => {
        start.current = null;
        setDrag(null);
      },
    }),
    [disabled, onDrop],
  );

  /** Call first in the card's onClick; true means "this click ended a drag, ignore it". */
  const consumeClick = useCallback((): boolean => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return true;
    }
    return false;
  }, []);

  return { drag, handlersFor, consumeClick };
}
