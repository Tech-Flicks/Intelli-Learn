/** Small pieces shared by the interaction widgets. */
import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

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

/**
 * A finger has to rest on a card for this long before it picks the card up. A finger that moves on
 * sooner is swiping, and the page scrolls: on a phone the cards fill most of the screen, and a
 * child must be able to scroll past them without changing the answer. A mouse picks up at once.
 */
export const TOUCH_HOLD_MS = 140;

/** A long word in a label this long (or longer) gets a card across the whole width on a phone. */
export const LONG_WORD = 11;

/** True when a label holds a word that does not fit into one of two columns on a phone. */
export function hasLongWord(labels: readonly string[]): boolean {
  return labels.some((label) => label.split(/[\s\-/]+/u).some((word) => Array.from(word).length >= LONG_WORD));
}

/**
 * Keeps the page still under a card that a finger is dragging.
 *
 * Cards that can be dragged leave vertical panning to the browser (`touch-action: pan-y`), so a
 * swipe that starts on one scrolls the page. Once a card is picked up (`locked()` is true), the
 * moves of the finger belong to the card: they are cancelled before the browser pans. The
 * listener has to sit on the element before the touch starts and must not be passive, or the
 * browser does not let it cancel anything. Returns a ref callback per card.
 */
export function useTouchScrollLock(locked: () => boolean): (key: string) => (el: HTMLElement | null) => void {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  return useCallback((key: string) => {
    const known = refs.current.get(key);
    if (known) return known;
    let current: HTMLElement | null = null;
    const onTouchMove = (event: TouchEvent): void => {
      if (lockedRef.current() && event.cancelable) event.preventDefault();
    };
    const ref = (el: HTMLElement | null): void => {
      current?.removeEventListener('touchmove', onTouchMove);
      current = el;
      el?.addEventListener('touchmove', onTouchMove, { passive: false });
    };
    refs.current.set(key, ref);
    return ref;
  }, []);
}

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

interface DragStart {
  id: string;
  x: number;
  y: number;
  pointerId: number;
  moved: boolean;
  touch: boolean;
  /** The card is picked up: at once with a mouse, after `TOUCH_HOLD_MS` under a finger. */
  held: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Pointer dragging for cards that can be dropped on `[data-dropzone]` elements.
 *
 * A press that moves less than a few pixels is left alone so the element's
 * ordinary click (tap-to-pick, also what Enter and Space trigger) still fires.
 * After a real drag the following click is swallowed.
 *
 * Under a finger a card is picked up after a short hold (`TOUCH_HOLD_MS`); a
 * swipe that starts on a card scrolls the page and moves nothing. Give the card
 * `touch-action: pan-y` and spread `handlersFor(id)` on it (it carries a `ref`).
 */
export function useDragToZone(onDrop: (id: string, zone: string | null) => void, disabled = false) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const start = useRef<DragStart | null>(null);
  const swallowClick = useRef(false);
  const lockFor = useTouchScrollLock(() => start.current !== null && start.current.touch && start.current.held);

  const release = useCallback((): DragStart | null => {
    const s = start.current;
    if (s?.timer != null) clearTimeout(s.timer);
    start.current = null;
    return s;
  }, []);
  useEffect(() => () => void release(), [release]);

  const handlersFor = useCallback(
    (id: string) => ({
      ref: lockFor(id),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
        release();
        const touch = event.pointerType === 'touch';
        const s: DragStart = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false, touch, held: !touch, timer: null };
        start.current = s;
        swallowClick.current = false;
        if (touch) {
          s.timer = setTimeout(() => {
            s.timer = null;
            if (start.current !== s) return;
            s.held = true;
            // Lifted: the child sees that the card is theirs to move now.
            setDrag({ id, dx: 0, dy: 0, over: null });
          }, TOUCH_HOLD_MS);
        }
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
        const far = Math.hypot(dx, dy) >= DRAG_THRESHOLD;
        if (!s.held) {
          // The finger moved on before the card was picked up: a swipe. The page scrolls, the card stays.
          if (far) release();
          return;
        }
        if (!s.moved && !far) return;
        s.moved = true;
        setDrag({ id, dx, dy, over: zoneAtPoint(event.clientX, event.clientY, event.currentTarget) });
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        const s = start.current;
        if (!s || s.id !== id) return;
        release();
        if (s.moved) {
          swallowClick.current = true;
          const zone = zoneAtPoint(event.clientX, event.clientY, event.currentTarget);
          setDrag(null);
          onDrop(id, zone);
        } else if (s.touch && s.held) {
          // Picked up and put down in place: the click that follows is an ordinary tap.
          setDrag(null);
        }
      },
      onPointerCancel: () => {
        release();
        setDrag(null);
      },
    }),
    [disabled, lockFor, onDrop, release],
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
