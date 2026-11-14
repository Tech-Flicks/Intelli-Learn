/** Declarative scene builders: tidy grids of emoji, shapes and text cards with gentle animation. */
import type { z } from 'zod';
import type { SceneObjectSchema, SceneSchema, SceneTheme, ShapeName } from '@/core/schemas';

export type SceneObjectInput = z.input<typeof SceneObjectSchema>;
export type SceneInput = z.input<typeof SceneSchema>;

export interface Card {
  id?: string;
  emoji?: string;
  shape?: ShapeName;
  color?: string;
  /** For text cards. */
  text?: string;
  /** Caption under an emoji or shape. */
  label?: string;
  tappable?: boolean;
  /** Relative size, 1 = normal. */
  scale?: number;
  rotation?: number;
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const MAIN_BOX: Box = { x0: 8, x1: 92, y0: 20, y1: 82 };
const GENTLE = ['float', 'pulse', 'bounce', 'wiggle'] as const;

const DECOR: Record<SceneTheme, readonly [string, string]> = {
  space: ['✨', '🌙'],
  ocean: ['🌊', '🐚'],
  forest: ['🌲', '🍄'],
  lab: ['🧪', '🔬'],
  city: ['🏙️', '🚦'],
  farm: ['🌾', '🚜'],
  sky: ['☁️', '🌤️'],
  desert: ['🌵', '☀️'],
  arctic: ['❄️', '🧊'],
  workshop: ['🔧', '⚙️'],
  jungle: ['🌴', '🦜'],
  castle: ['🏰', '🚩'],
  kitchen: ['🍳', '🥄'],
  playground: ['🎈', '🌳'],
  plain: ['✨', '⭐'],
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function rowsFor(count: number): number {
  if (count <= 5) return 1;
  if (count <= 10) return 2;
  return 3;
}

/** Centre points and a size for `count` objects laid out in rows that never overlap. */
export function gridSlots(count: number, box: Box = MAIN_BOX, forceRows?: number): { x: number; y: number; cellW: number; cellH: number }[] {
  const rows = forceRows ?? rowsFor(count);
  const cols = Math.ceil(count / rows);
  const cellW = (box.x1 - box.x0) / cols;
  const cellH = (box.y1 - box.y0) / rows;
  const out: { x: number; y: number; cellW: number; cellH: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / cols);
    const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols;
    const col = index - row * cols;
    const offset = ((cols - inRow) * cellW) / 2;
    out.push({
      x: round1(box.x0 + offset + cellW * (col + 0.5)),
      y: round1(box.y0 + cellH * (row + 0.5)),
      cellW,
      cellH,
    });
  }
  return out;
}

function textSize(text: string, cellW: number): number {
  const chars = Math.max(1, Array.from(text).length);
  return round1(clamp((cellW * 0.9) / (chars * 0.58), 3.5, 11));
}

/** Two small, faint decorations in the top corners. */
export function decor(theme: SceneTheme): SceneObjectInput[] {
  const [left, right] = DECOR[theme];
  return [
    { id: 'decor-left', type: 'emoji', emoji: left, x: 7, y: 9, size: 8, opacity: 0.7, z: 0, anim: { kind: 'float', duration: 5, delay: 0, loop: true } },
    { id: 'decor-right', type: 'emoji', emoji: right, x: 93, y: 9, size: 8, opacity: 0.7, z: 0, anim: { kind: 'float', duration: 6, delay: 1, loop: true } },
  ];
}

function placeCards(cards: readonly Card[], box: Box, calm: boolean, forceRows?: number, idPrefix = 'obj'): SceneObjectInput[] {
  const slots = gridSlots(cards.length, box, forceRows);
  return cards.map((card, index) => {
    const slot = slots[index] as { x: number; y: number; cellW: number; cellH: number };
    const id = card.id ?? `${idPrefix}${index + 1}`;
    const tappable = card.tappable === true;
    const anim = calm
      ? undefined
      : { kind: GENTLE[index % GENTLE.length] as (typeof GENTLE)[number], duration: 2.6 + (index % 4) * 0.4, delay: round1((index % 5) * 0.25), loop: true };
    const label = card.label ? card.label.slice(0, 24) : undefined;
    if (card.text !== undefined && card.emoji === undefined && card.shape === undefined) {
      return {
        id,
        type: 'text' as const,
        text: card.text.slice(0, 60),
        x: slot.x,
        y: slot.y,
        size: round1(Math.min(textSize(card.text, slot.cellW), slot.cellH * 0.5) * (card.scale ?? 1)),
        tappable,
        z: 2,
        ...(card.color ? { color: card.color } : {}),
        ...(anim ? { anim: { ...anim, kind: 'pulse' as const, duration: 3.5 } } : {}),
      };
    }
    const size = round1(clamp(Math.min(slot.cellW * 0.72, slot.cellH * (label ? 0.52 : 0.62)), 6, 20) * (card.scale ?? 1));
    return {
      id,
      type: card.shape ? ('shape' as const) : ('emoji' as const),
      ...(card.shape ? { shape: card.shape } : { emoji: card.emoji ?? '⭐' }),
      ...(card.color ? { color: card.color } : {}),
      ...(label ? { label } : {}),
      ...(card.rotation ? { rotation: card.rotation } : {}),
      x: slot.x,
      y: slot.y,
      size: clamp(size, 4, 30),
      tappable,
      z: 2,
      ...(anim ? { anim } : {}),
    };
  });
}

function withDecor(theme: SceneTheme, objects: SceneObjectInput[]): SceneInput {
  for (const extra of decor(theme)) {
    if (objects.length < 15 && (objects.length < 13 || objects.length < 3)) objects.push(extra);
  }
  return { theme, objects };
}

/**
 * A scene with the cards in a tidy grid. Decorations are added while there is room, so a scene
 * always has at least 3 and at most 15 objects.
 */
export function cardScene(theme: SceneTheme, cards: readonly Card[], opts: { box?: Box; calm?: boolean } = {}): SceneInput {
  const shown = cards.slice(0, 13);
  // Long text cards get at most two per row so that they never run into each other.
  const longText = shown.some((card) => card.text !== undefined && card.emoji === undefined && card.shape === undefined && Array.from(card.text).length > 9);
  const rows = longText && shown.length > 2 ? Math.ceil(Math.min(shown.length, 10) / 2) : undefined;
  return withDecor(theme, placeCards(longText ? shown.slice(0, 10) : shown, opts.box ?? MAIN_BOX, opts.calm === true, rows));
}

/** A small illustrative scene: a few emoji in a row, for challenges whose answer is given in a widget. */
export function pictureScene(theme: SceneTheme, emojis: readonly string[], labels: readonly (string | undefined)[] = []): SceneInput {
  const cards: Card[] = emojis.slice(0, 8).map((emoji, index) => {
    const label = labels[index];
    return label ? { emoji, label } : { emoji };
  });
  if (cards.length === 0) cards.push({ emoji: '⭐' });
  return cardScene(theme, cards);
}

/**
 * Several rows of cards, each in its own horizontal band. Used when a scene has two parts,
 * such as a pattern on top and the answer choices below.
 */
export function bandScene(theme: SceneTheme, bands: readonly (readonly Card[])[], opts: { calm?: boolean } = {}): SceneInput {
  const rows = bands.filter((band) => band.length > 0);
  const top = 20;
  const bottom = 86;
  const height = (bottom - top) / Math.max(1, rows.length);
  const objects: SceneObjectInput[] = [];
  rows.forEach((band, rowIndex) => {
    const box: Box = { x0: 6, x1: 94, y0: top + height * rowIndex, y1: top + height * (rowIndex + 1) };
    objects.push(...placeCards(band.slice(0, 8), box, opts.calm === true, 1, `r${rowIndex + 1}c`));
  });
  return withDecor(theme, objects.slice(0, 13));
}

/** Lines of text stacked like a note or a little program, with an optional emoji beside them. */
export function stackScene(theme: SceneTheme, lines: readonly string[], sideEmoji?: string): SceneInput {
  const shown = lines.slice(0, 8).map((line) => line.slice(0, 60));
  const longest = Math.max(1, ...shown.map((line) => Array.from(line).length));
  const width = sideEmoji ? 62 : 80;
  const size = round1(clamp(width / (longest * 0.58), 3.2, 8));
  const top = 24;
  const gap = Math.min(11, 58 / Math.max(1, shown.length));
  const objects: SceneObjectInput[] = shown.map((line, index) => ({
    id: `line${index + 1}`,
    type: 'text' as const,
    text: line,
    x: sideEmoji ? 42 : 50,
    y: round1(top + gap * index + gap / 2),
    size,
    z: 2,
    anim: { kind: 'fade-in' as const, duration: 0.8, delay: round1(index * 0.3), loop: false },
  }));
  if (sideEmoji) {
    objects.push({ id: 'side', type: 'emoji', emoji: sideEmoji, x: 86, y: 50, size: 16, z: 2, anim: { kind: 'float', duration: 4, delay: 0, loop: true } });
  }
  return withDecor(theme, objects);
}
