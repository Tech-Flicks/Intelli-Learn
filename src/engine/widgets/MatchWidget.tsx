import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { MatchInteraction } from '@/core/schemas';
import { shuffleAwayFrom } from '../shuffle';
import type { WidgetProps } from './ChoiceWidget';
import { cx, fill, FOCUS_RING, HINT_GLOW, TOUCH_HOLD_MS, useTouchScrollLock } from './common';

/** One colour and one number per connection, so colour is never the only cue. */
const LINK_COLORS = ['#5b4bdb', '#d9483a', '#1f8f5c', '#c98a00', '#0f7fb5', '#b0368f'] as const;

interface Line {
  leftId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Two columns. Tap a card on the left, then its partner on the right (or drag
 * from left to right). Tap a connected card again to undo. Lines are drawn in
 * an SVG overlay that ignores the pointer.
 *
 * Under a finger a line is drawn by dragging sideways; a swipe up or down that
 * starts on a card scrolls the page.
 */
export function MatchWidget({ interaction, value, onChange, disabled, highlight, labels }: WidgetProps<MatchInteraction, Record<string, string>>): JSX.Element {
  const [activeLeft, setActiveLeft] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [rubber, setRubber] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRefs = useRef(new Map<string, HTMLButtonElement>());
  const rightRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragFrom = useRef<{ id: string; x: number; y: number; moved: boolean; touch: boolean; held: boolean } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowClick = useRef(false);
  // While a line is being drawn (or the finger rests on a card, about to draw one), its moves do not scroll the page.
  const lockFor = useTouchScrollLock(() => dragFrom.current !== null && dragFrom.current.touch && (dragFrom.current.moved || dragFrom.current.held));

  const endDrag = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    dragFrom.current = null;
  }, []);
  useEffect(() => endDrag, [endDrag]);

  /** The right column is shown in a stable, mixed-up order. */
  const rights = useMemo(
    () => shuffleAwayFrom(interaction.pairs.map((pair) => ({ id: pair.id, label: pair.right.label, emoji: pair.right.emoji })), 'match'),
    [interaction.pairs],
  );

  const leftOfRight = useMemo(() => {
    const map = new Map<string, string>();
    for (const [leftId, rightId] of Object.entries(value)) map.set(rightId, leftId);
    return map;
  }, [value]);

  /** Connection number (1-based) by left id, in the order of the left column. */
  const linkIndex = useMemo(() => {
    const map = new Map<string, number>();
    interaction.pairs.forEach((pair, index) => {
      if (value[pair.id] !== undefined) map.set(pair.id, index);
    });
    return map;
  }, [interaction.pairs, value]);

  const connect = useCallback(
    (leftId: string, rightId: string) => {
      if (disabled) return;
      const next: Record<string, string> = {};
      for (const [l, r] of Object.entries(value)) {
        if (l !== leftId && r !== rightId) next[l] = r; // each card joins at most one line
      }
      next[leftId] = rightId;
      onChange(next);
      setActiveLeft(null);
    },
    [disabled, onChange, value],
  );

  const disconnectLeft = useCallback(
    (leftId: string) => {
      const next = { ...value };
      delete next[leftId];
      onChange(next);
    },
    [onChange, value],
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const out: Line[] = [];
    for (const [leftId, rightId] of Object.entries(value)) {
      const l = leftRefs.current.get(leftId)?.getBoundingClientRect();
      const r = rightRefs.current.get(rightId)?.getBoundingClientRect();
      if (!l || !r) continue;
      out.push({
        leftId,
        x1: l.right - box.left,
        y1: l.top + l.height / 2 - box.top,
        x2: r.left - box.left,
        y2: r.top + r.height / 2 - box.top,
      });
    }
    setLines((previous) => (JSON.stringify(previous) === JSON.stringify(out) ? previous : out));
  }, [value]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  const onLeftClick = (leftId: string): void => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (disabled) return;
    if (value[leftId] !== undefined) {
      disconnectLeft(leftId); // tap again to undo
      setActiveLeft(leftId);
      return;
    }
    setActiveLeft(activeLeft === leftId ? null : leftId);
  };

  const onRightClick = (rightId: string): void => {
    if (disabled) return;
    if (activeLeft) {
      connect(activeLeft, rightId);
      return;
    }
    const owner = leftOfRight.get(rightId);
    if (owner) disconnectLeft(owner); // tap again to undo
  };

  // Dragging a line from a left card to a right card.
  const onLeftPointerDown = (leftId: string, event: ReactPointerEvent<HTMLButtonElement>): void => {
    // A touch drag is followed by no click, so a flag left over from the last drag would
    // swallow this press: every press starts clean.
    swallowClick.current = false;
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    endDrag();
    const touch = event.pointerType === 'touch';
    const from = { id: leftId, x: event.clientX, y: event.clientY, moved: false, touch, held: !touch };
    dragFrom.current = from;
    if (touch) {
      // A finger that rests on the card for a moment is about to draw a line, in any direction.
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (dragFrom.current === from) from.held = true;
      }, TOUCH_HOLD_MS);
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Without capture the drag still works while the pointer stays inside the widget.
    }
  };

  const onLeftPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const from = dragFrom.current;
    const container = containerRef.current;
    if (!from || !container) return;
    if (!from.moved) {
      const dx = Math.abs(event.clientX - from.x);
      const dy = Math.abs(event.clientY - from.y);
      if (Math.hypot(dx, dy) < 8) return;
      // A finger that sets off up or down at once is scrolling the page, not drawing a line.
      if (!from.held && dy > dx) {
        endDrag();
        return;
      }
    }
    from.moved = true;
    const box = container.getBoundingClientRect();
    const l = event.currentTarget.getBoundingClientRect();
    setRubber({
      x1: l.right - box.left,
      y1: l.top + l.height / 2 - box.top,
      x2: event.clientX - box.left,
      y2: event.clientY - box.top,
    });
  };

  const onLeftPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const from = dragFrom.current;
    endDrag();
    setRubber(null);
    if (!from || !from.moved) return;
    swallowClick.current = true;
    if (typeof document.elementsFromPoint !== 'function') return;
    for (const el of document.elementsFromPoint(event.clientX, event.clientY)) {
      const target = el.closest<HTMLElement>('[data-match-right]');
      if (target?.dataset.matchRight) {
        connect(from.id, target.dataset.matchRight);
        return;
      }
    }
  };

  // The number of a connection sits on the card's corner: it takes no room from the label.
  const badge = (index: number): JSX.Element => (
    <span
      aria-hidden="true"
      data-match-badge=""
      className="absolute -top-2.5 -left-2.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold text-white ring-2 ring-white"
      style={{ backgroundColor: LINK_COLORS[index % LINK_COLORS.length] }}
    >
      {index + 1}
    </span>
  );

  // On a phone the picture sits above the word, so a short word is never broken in two.
  const face = (emoji: string | undefined, label: string): JSX.Element => (
    <span className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 sm:text-left">
      {emoji ? (
        <span aria-hidden="true" className="shrink-0 text-2xl leading-none">
          {emoji}
        </span>
      ) : null}
      <span data-match-label="" className="max-w-full min-w-0 wrap-anywhere">
        {label}
      </span>
    </span>
  );

  const cardClass = (linked: boolean, active: boolean, glow: boolean): string =>
    cx(
      'relative flex min-h-16 w-full items-center gap-2 rounded-2xl border-4 bg-white px-2 py-2 text-left text-lg font-bold text-ink-900 shadow-sm transition-colors sm:px-3',
      active ? 'border-brand-500 bg-brand-100' : linked ? 'border-leaf-400' : 'border-brand-100',
      glow && HINT_GLOW,
      FOCUS_RING,
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold text-ink-500">{labels.matchHint}</p>
      <div ref={containerRef} className="relative grid grid-cols-2 gap-x-8 gap-y-3 sm:gap-x-16">
        <ul className="flex list-none flex-col gap-3 p-0" aria-label={labels.matchLeft}>
          {interaction.pairs.map((pair) => {
            const rightId = value[pair.id];
            const partner = rightId !== undefined ? interaction.pairs.find((p) => p.id === rightId)?.right.label : undefined;
            const index = linkIndex.get(pair.id);
            return (
              <li key={pair.id}>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) leftRefs.current.set(pair.id, el);
                    else leftRefs.current.delete(pair.id);
                    lockFor(pair.id)(el);
                  }}
                  disabled={disabled}
                  aria-pressed={activeLeft === pair.id}
                  aria-label={partner ? `${pair.left.label}, ${fill(labels.matched, { item: partner })}` : pair.left.label}
                  onClick={() => onLeftClick(pair.id)}
                  onPointerDown={(event) => onLeftPointerDown(pair.id, event)}
                  onPointerMove={onLeftPointerMove}
                  onPointerUp={onLeftPointerUp}
                  onPointerCancel={() => {
                    endDrag();
                    setRubber(null);
                  }}
                  // Sideways the finger draws a line; up and down it scrolls the page.
                  style={{ touchAction: 'pan-y' }}
                  className={cx(cardClass(rightId !== undefined, activeLeft === pair.id, highlight.has(pair.id)), 'select-none [-webkit-touch-callout:none]')}
                >
                  {index !== undefined ? badge(index) : null}
                  {face(pair.left.emoji, pair.left.label)}
                </button>
              </li>
            );
          })}
        </ul>
        <ul className="flex list-none flex-col gap-3 p-0" aria-label={labels.matchRight}>
          {rights.map((right) => {
            const owner = leftOfRight.get(right.id);
            const ownerLabel = owner ? interaction.pairs.find((p) => p.id === owner)?.left.label : undefined;
            const index = owner ? linkIndex.get(owner) : undefined;
            return (
              <li key={right.id}>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) rightRefs.current.set(right.id, el);
                    else rightRefs.current.delete(right.id);
                  }}
                  data-match-right={right.id}
                  disabled={disabled}
                  aria-label={ownerLabel ? `${right.label}, ${fill(labels.matched, { item: ownerLabel })}` : right.label}
                  onClick={() => onRightClick(right.id)}
                  className={cardClass(owner !== undefined, false, false)}
                >
                  {index !== undefined ? badge(index) : null}
                  {face(right.emoji, right.label)}
                </button>
              </li>
            );
          })}
        </ul>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {lines.map((line) => {
            const color = LINK_COLORS[(linkIndex.get(line.leftId) ?? 0) % LINK_COLORS.length];
            return (
              <g key={line.leftId}>
                <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#ffffff" strokeWidth={9} strokeLinecap="round" />
                <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={color} strokeWidth={5} strokeLinecap="round" />
              </g>
            );
          })}
          {rubber ? (
            <line
              x1={rubber.x1}
              y1={rubber.y1}
              x2={rubber.x2}
              y2={rubber.y2}
              stroke="#5b4bdb"
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray="4 10"
            />
          ) : null}
        </svg>
      </div>
    </div>
  );
}
