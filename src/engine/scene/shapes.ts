/** Canvas paths for every shape in SHAPES, centred on the origin. */
import type { ShapeName } from '@/core/schemas';
import { shapeBox } from './layout';

/** The subset of the 2D context the path builders need (easy to fake in tests). */
export type PathContext = Pick<
  CanvasRenderingContext2D,
  'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'ellipse' | 'closePath' | 'bezierCurveTo' | 'quadraticCurveTo'
>;

export function roundedRectPath(ctx: PathContext, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function polygonPath(ctx: PathContext, sides: number, radius: number, startAngle = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const a = startAngle + (i * Math.PI * 2) / sides;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function starPath(ctx: PathContext, radius: number, points = 5, inner = 0.45): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? radius : radius * inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Traces the outline of `shape` for an object of `size` pixels. The caller fills and strokes. */
export function traceShape(ctx: PathContext, shape: ShapeName, size: number): void {
  const box = shapeBox(shape);
  const w = size * box.w;
  const h = size * box.h;
  const r = size / 2;
  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'square':
      roundedRectPath(ctx, -w / 2, -h / 2, w, h, size * 0.08);
      break;
    case 'rect':
      roundedRectPath(ctx, -w / 2, -h / 2, w, h, size * 0.07);
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, r * 0.86);
      ctx.lineTo(-r, r * 0.86);
      ctx.closePath();
      break;
    case 'star':
      starPath(ctx, r);
      break;
    case 'hexagon':
      polygonPath(ctx, 6, r, 0);
      break;
    case 'pentagon':
      polygonPath(ctx, 5, r);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.72, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.72, 0);
      ctx.closePath();
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(0, r * 0.9);
      ctx.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.75, -r * 1.15, 0, -r * 0.4);
      ctx.bezierCurveTo(r * 0.75, -r * 1.15, r * 1.5, -r * 0.1, 0, r * 0.9);
      ctx.closePath();
      break;
    case 'oval':
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      break;
    case 'arrow': {
      const shaft = h * 0.22;
      const head = w * 0.1;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -shaft);
      ctx.lineTo(head, -shaft);
      ctx.lineTo(head, -h / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(head, h / 2);
      ctx.lineTo(head, shaft);
      ctx.lineTo(-w / 2, shaft);
      ctx.closePath();
      break;
    }
    case 'cloud':
      cloudPath(ctx, 0, 0, w, h);
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.closePath();
  }
}

/** A puffy cloud that fits the box (w, h) centred on (cx, cy). */
export function cloudPath(ctx: PathContext, cx: number, cy: number, w: number, h: number): void {
  const base = cy + h * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.36, base);
  ctx.arc(cx - w * 0.3, cy + h * 0.14, h * 0.36, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(cx - w * 0.08, cy - h * 0.12, h * 0.38, Math.PI * 1.1, Math.PI * 1.9);
  ctx.arc(cx + w * 0.18, cy - h * 0.02, h * 0.34, Math.PI * 1.3, Math.PI * 0.1);
  ctx.arc(cx + w * 0.32, cy + h * 0.2, h * 0.3, Math.PI * 1.5, Math.PI * 0.5);
  ctx.lineTo(cx - w * 0.36, base);
  ctx.closePath();
}

/** Friendly default colours for shapes the AI did not colour. */
export const SHAPE_PALETTE = ['#ff8a7a', '#ffd54a', '#4cc38a', '#5b9bff', '#a99cf5', '#ff9ecb', '#ffa94d', '#5fd0d6'] as const;

export function defaultShapeColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SHAPE_PALETTE[h % SHAPE_PALETTE.length] as string;
}
