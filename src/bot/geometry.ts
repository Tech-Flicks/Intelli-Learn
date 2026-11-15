/**
 * Where the helper floats: plain geometry, no DOM.
 *
 * Pip lives in a round bubble that the child can drag anywhere inside the
 * viewport, below the top bar and inside the safe areas. His home ("dock") is
 * the top right corner of the question card: far from the Check button, which
 * is always the last thing on the page.
 */
import type { PipState } from './pip';

export interface Size {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Top-left corner of Pip's bubble, in viewport pixels. */
export interface Point {
  x: number;
  y: number;
}

/** The corner positions Pip's bubble may take. */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A position as a share of the free space, so it survives rotation and other screen sizes. */
export interface Fraction {
  fx: number;
  fy: number;
}

export const BOT = {
  /** Bubble size on phones and on larger screens (both well above the 56 px touch target). */
  sizeSmall: 72,
  sizeLarge: 92,
  /** Gap kept to the viewport edges and the top bar. */
  margin: 8,
  /** Height assumed for the top bar when it cannot be measured. */
  topBarFallback: 76,
  /** Arrow keys move Pip this far; with Shift, further. */
  keyStep: 24,
  keyStepBig: 96,
  /** Dropped this close to home, Pip snaps back into his dock. */
  dockSnap: 40,
  /** At home Pip sits this far inside the question card's top right corner. */
  dockInset: 8,
  dockDrop: 6,
  /** A pointer that moved less than this was a tap, not a drag. */
  tapSlop: 8,
  /** Two taps inside this time make Pip giggle. */
  doubleTapMs: 420,
  /** Widest speech bubble and help panel. */
  bubbleWidth: 304,
  panelWidth: 400,
  /** Below this viewport width the help panel is a sheet at the bottom. */
  sheetBelow: 640,
} as const;

export function botSize(viewport: Size): number {
  return viewport.width < 640 || viewport.height < 520 ? BOT.sizeSmall : BOT.sizeLarge;
}

/** Where the bubble may be: inside the safe areas and below the top bar (`top` is the top bar's bottom edge). */
export function boundsFor(viewport: Size, insets: Insets, size: number, top: number): Bounds {
  const minX = insets.left + BOT.margin;
  const minY = Math.max(insets.top, top) + BOT.margin;
  return {
    minX,
    maxX: Math.max(minX, viewport.width - insets.right - BOT.margin - size),
    minY,
    maxY: Math.max(minY, viewport.height - insets.bottom - BOT.margin - size),
  };
}

export function clampPoint(point: Point, bounds: Bounds): Point {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
  };
}

/**
 * Pip's home: the top right corner of the question card, just below the top
 * bar. `columnRight` is the right edge of the column the card sits in; without
 * it (nothing measured yet) home is the top right corner of the screen.
 */
export function dockPoint(bounds: Bounds, size: number, columnRight: number | null): Point {
  const wanted = columnRight === null ? bounds.maxX : columnRight - BOT.dockInset - size;
  return clampPoint({ x: wanted, y: bounds.minY + BOT.dockDrop }, bounds);
}

export function isNearDock(point: Point, dock: Point): boolean {
  return Math.hypot(point.x - dock.x, point.y - dock.y) <= BOT.dockSnap;
}

function share(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function toFraction(point: Point, bounds: Bounds): Fraction {
  return { fx: share(point.x, bounds.minX, bounds.maxX), fy: share(point.y, bounds.minY, bounds.maxY) };
}

export function fromFraction(fraction: Fraction, bounds: Bounds): Point {
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) * fraction.fx,
    y: bounds.minY + (bounds.maxY - bounds.minY) * fraction.fy,
  };
}

/** The key the position is remembered under in `db.kv` (a per-child key: it ends with the child's id). */
export function positionKey(childId: string): string {
  return `bot-position:${childId}`;
}

/** What is stored under `positionKey`. */
export interface StoredPosition {
  v: 1;
  fx: number;
  fy: number;
}

/** Reads a stored position. Anything that is not a clean pair of shares means "at home". */
export function parseStoredPosition(value: unknown): Fraction | null {
  if (typeof value !== 'object' || value === null) return null;
  const { v, fx, fy } = value as Partial<StoredPosition>;
  if (v !== 1 || typeof fx !== 'number' || typeof fy !== 'number') return null;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return { fx: Math.min(1, Math.max(0, fx)), fy: Math.min(1, Math.max(0, fy)) };
}

/** Where a box that belongs to Pip (speech bubble, help panel) goes. */
export interface Anchored {
  /** Below Pip when he is in the upper half of the screen, above him otherwise. */
  side: 'below' | 'above';
  left: number;
  width: number;
  /** Set for `below`. */
  top: number | null;
  /** Set for `above`: distance from the bottom of the viewport. */
  bottom: number | null;
  maxHeight: number;
  /** Where the little tail points at Pip, from the box's left edge. */
  tailLeft: number;
}

/**
 * Places a box of at most `maxWidth` next to Pip: on his side of the screen,
 * towards the middle, never off the screen.
 */
export function anchorBox(point: Point, size: number, viewport: Size, maxWidth: number, gap = 10): Anchored {
  const edge = 12;
  const width = Math.max(120, Math.min(maxWidth, viewport.width - edge * 2));
  const centerX = point.x + size / 2;
  const onRight = centerX > viewport.width / 2;
  const wanted = onRight ? point.x + size - width : point.x;
  const left = Math.min(viewport.width - edge - width, Math.max(edge, wanted));
  const below = point.y + size / 2 <= viewport.height / 2;
  const top = below ? point.y + size + gap : null;
  const bottom = below ? null : viewport.height - point.y + gap;
  const room = below ? viewport.height - (point.y + size + gap) - edge : point.y - gap - edge;
  return {
    side: below ? 'below' : 'above',
    left,
    width,
    top,
    bottom,
    maxHeight: Math.max(96, room),
    tailLeft: Math.min(width - 28, Math.max(28, centerX - left)),
  };
}

/** The help panel is a bottom sheet on narrow screens and a box next to Pip otherwise. */
export function panelIsSheet(viewport: Size): boolean {
  return viewport.width < BOT.sheetBelow || viewport.height < 520;
}

// ---------------------------------------------------------------------------
// Pip's face
// ---------------------------------------------------------------------------

/** Moods that already say what is going on and are kept while Pip speaks. */
const KEEPS_WHILE_SPEAKING: readonly PipState[] = ['teaching', 'storytelling', 'celebrating', 'proud', 'reading'];

/**
 * The state shown on Pip: what the play session says (`base`), with listening,
 * talking and reading on top. Giggles are a short reaction added by the component.
 */
export function pipStateFor(input: {
  base: PipState;
  speaking: boolean;
  listening: boolean;
  /** The challenge text is being read aloud. */
  reading: boolean;
  /** A story chapter is being told. */
  story: boolean;
}): PipState {
  if (input.listening) return 'listening';
  // A wrong try never gets an angry or startled face, whatever was asked for.
  const base: PipState = input.base === 'angry' ? 'curious' : input.base;
  if (!input.speaking) return base;
  if (KEEPS_WHILE_SPEAKING.includes(base)) return base;
  if (input.reading) return input.story ? 'storytelling' : 'reading';
  return 'talking';
}

/** How long a bubble line stays before it fades by itself. */
export function lineLifetimeMs(text: string): number {
  return Math.min(16_000, Math.max(5000, Array.from(text).length * 75));
}
