/** Geometry shared by the renderer, the hit test and the accessible buttons. Pure logic. */
import type { Scene, SceneObject, ShapeName } from '@/core/schemas';
import { animPose, type AnimPose } from './anim';

export interface StageSize {
  width: number;
  height: number;
}

export interface Placement {
  id: string;
  /** Centre in CSS pixels, animation included. */
  cx: number;
  cy: number;
  /** Half width and half height of the drawn object in CSS pixels. */
  hw: number;
  hh: number;
  sizePx: number;
  pose: AnimPose;
}

/** Smallest tap radius in CSS pixels: about a child's fingertip. */
export const MIN_TAP_RADIUS = 30;

/** Width and height of a shape relative to the object size. */
export function shapeBox(shape: ShapeName | undefined): { w: number; h: number } {
  switch (shape) {
    case 'rect':
      return { w: 1, h: 0.62 };
    case 'oval':
      return { w: 1, h: 0.68 };
    case 'arrow':
      return { w: 1, h: 0.62 };
    case 'cloud':
      return { w: 1, h: 0.64 };
    default:
      return { w: 1, h: 1 };
  }
}

export function objectSizePx(obj: Pick<SceneObject, 'size'>, stage: StageSize): number {
  return (Math.max(2, Math.min(80, obj.size)) / 100) * Math.min(stage.width, stage.height);
}

/** Font size and approximate width of a text object, shrunk to stay inside the stage. */
export function textMetrics(text: string, sizePx: number, stage: StageSize): { fontPx: number; width: number } {
  const chars = Math.max(1, Array.from(text).length);
  const maxWidth = stage.width * 0.92;
  let fontPx = sizePx;
  const estimate = (px: number): number => chars * px * 0.58;
  if (estimate(fontPx) > maxWidth) fontPx = maxWidth / (chars * 0.58);
  return { fontPx: Math.max(8, fontPx), width: estimate(Math.max(8, fontPx)) };
}

export function placeObject(obj: SceneObject, t: number, stage: StageSize, reducedMotion: boolean): Placement {
  const sizePx = objectSizePx(obj, stage);
  const pose = animPose(obj.anim, t, { x: obj.x, y: obj.y, sizePx, stageWidth: stage.width, stageHeight: stage.height }, reducedMotion);
  let hw = sizePx / 2;
  let hh = sizePx / 2;
  if (obj.type === 'shape') {
    const box = shapeBox(obj.shape);
    hw = (sizePx * box.w) / 2;
    hh = (sizePx * box.h) / 2;
  } else if (obj.type === 'text') {
    const m = textMetrics(obj.text ?? '', sizePx, stage);
    hw = m.width / 2;
    hh = m.fontPx * 0.6;
  }
  return {
    id: obj.id,
    cx: (obj.x / 100) * stage.width + pose.dx,
    cy: (obj.y / 100) * stage.height + pose.dy,
    hw: hw * pose.scale,
    hh: hh * pose.scale,
    sizePx,
    pose,
  };
}

/** Objects in drawing order: lowest z first, later objects on top of earlier ones. */
export function drawOrder(scene: Scene): SceneObject[] {
  return scene.objects
    .map((obj, index) => ({ obj, index }))
    .sort((a, b) => a.obj.z - b.obj.z || a.index - b.index)
    .map((entry) => entry.obj);
}

/**
 * Id of the tappable object at (px, py), or null.
 *
 * A direct hit on the topmost object wins. Otherwise a near miss within a
 * fingertip-sized radius counts, and the nearest object is chosen.
 */
export function hitTest(
  scene: Scene,
  px: number,
  py: number,
  t: number,
  stage: StageSize,
  reducedMotion = false,
  minRadius = MIN_TAP_RADIUS,
): string | null {
  const candidates = drawOrder(scene)
    .filter((obj) => obj.tappable)
    .reverse(); // topmost first
  let near: { id: string; distance: number } | null = null;
  const placements = candidates.map((obj) => placeObject(obj, t, stage, reducedMotion));
  for (const place of placements) {
    const dx = Math.abs(px - place.cx);
    const dy = Math.abs(py - place.cy);
    if (dx <= place.hw && dy <= place.hh) return place.id;
  }
  for (const place of placements) {
    const rx = Math.max(place.hw + 8, minRadius);
    const ry = Math.max(place.hh + 8, minRadius);
    const nx = (px - place.cx) / rx;
    const ny = (py - place.cy) / ry;
    const distance = nx * nx + ny * ny;
    if (distance <= 1 && (!near || distance < near.distance)) near = { id: place.id, distance };
  }
  return near ? near.id : null;
}

const COLOR_NAMES: [string, [number, number, number]][] = [
  ['red', [230, 50, 50]],
  ['orange', [245, 140, 40]],
  ['yellow', [250, 215, 60]],
  ['green', [70, 180, 90]],
  ['blue', [60, 120, 230]],
  ['purple', [140, 80, 200]],
  ['pink', [245, 130, 180]],
  ['brown', [140, 90, 50]],
  ['black', [20, 20, 20]],
  ['gray', [140, 140, 140]],
  ['white', [250, 250, 250]],
];

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const body = m[1] as string;
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** Plain colour word for a hex colour, for screen-reader names like "red triangle". */
export function colorName(hex: string | undefined): string {
  const rgb = hex ? parseHex(hex) : null;
  if (!rgb) return '';
  let best = '';
  let bestDistance = Infinity;
  for (const [name, [r, g, b]] of COLOR_NAMES) {
    const distance = (rgb[0] - r) ** 2 + (rgb[1] - g) ** 2 + (rgb[2] - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

/** Lighter (amount > 0) or darker (amount < 0) version of a hex colour. */
export function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const mix = (c: number): number => {
    const target = amount >= 0 ? 255 : 0;
    return Math.round(c + (target - c) * Math.min(1, Math.abs(amount)));
  };
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
}

/** Spoken name of one object: its label, text, emoji, or "red triangle". */
export function objectName(obj: SceneObject): string {
  if (obj.label && obj.label.trim()) return obj.label.trim();
  if (obj.type === 'text' && obj.text) return obj.text;
  if (obj.type === 'emoji' && obj.emoji) return obj.emoji;
  if (obj.type === 'shape' && obj.shape) return `${colorName(obj.color)} ${obj.shape}`.trim();
  return 'picture';
}

/** Unique spoken names for a list of objects: repeated names get a number ("🍎 2"). */
export function accessibleNames(objects: readonly SceneObject[]): Map<string, string> {
  const totals = new Map<string, number>();
  for (const obj of objects) totals.set(objectName(obj), (totals.get(objectName(obj)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const obj of objects) {
    const name = objectName(obj);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    out.set(obj.id, (totals.get(name) ?? 0) > 1 ? `${name} ${n}` : name);
  }
  return out;
}

/** Short description of a scene for role="img" when the caller gives none. */
export function describeScene(scene: Scene): string {
  const names = scene.objects.filter((o) => o.type !== 'text' || o.text).map(objectName);
  const unique = [...new Set(names)].slice(0, 6);
  const place = scene.theme === 'plain' ? 'Picture' : `${scene.theme} picture`;
  return unique.length > 0 ? `${place}: ${unique.join(', ')}` : place;
}
