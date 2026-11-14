/** Draws one frame of a scene onto a 2D canvas context. */
import type { Scene, SceneObject } from '@/core/schemas';
import { tapSquash } from './anim';
import { drawBackground, themeIsDark } from './backgrounds';
import { drawOrder, placeObject, shade, textMetrics, type Placement, type StageSize } from './layout';
import { drawParticles, drawStaticBurst, type Particle } from './particles';
import { defaultShapeColor, roundedRectPath, traceShape } from './shapes';
import type { SvgImageCache } from './svgImages';

export const EMOJI_FONT_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif';
export const TEXT_FONT_STACK = '"Baloo 2", "Nunito", ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif';

const COLOR_HIGHLIGHT = '#ffd54a';
const COLOR_SELECTED = '#1f8f5c';
const COLOR_FOCUS = '#5b4bdb';
const COLOR_INK = '#1f1a3d';

export interface FrameInput {
  scene: Scene;
  width: number;
  height: number;
  /** Seconds since the scene appeared (drives object and background animation). */
  t: number;
  reducedMotion: boolean;
  highlightIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  focusedId: string | null;
  /** Scene time of the latest tap per object id, for the squash reaction. */
  tapTimes: ReadonlyMap<string, number>;
  images: SvgImageCache | null;
  particles: readonly Particle[];
  staticBurst: boolean;
}

function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, sizePx: number): void {
  ctx.font = `${sizePx}px ${EMOJI_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(20, 15, 50, 0.22)';
  ctx.shadowBlur = sizePx * 0.1;
  ctx.shadowOffsetY = sizePx * 0.05;
  ctx.fillStyle = '#000000';
  // Emoji glyphs sit a touch high on the middle baseline.
  ctx.fillText(emoji, 0, sizePx * 0.06);
}

function drawShape(ctx: CanvasRenderingContext2D, obj: SceneObject, sizePx: number): void {
  const color = obj.color ?? defaultShapeColor(obj.id);
  ctx.shadowColor = 'rgba(20, 15, 50, 0.25)';
  ctx.shadowBlur = sizePx * 0.12;
  ctx.shadowOffsetY = sizePx * 0.05;
  traceShape(ctx, obj.shape ?? 'circle', sizePx);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, sizePx * 0.05);
  ctx.strokeStyle = shade(color, -0.28);
  ctx.stroke();
  // A soft shine across the top half.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.ellipse(-sizePx * 0.12, -sizePx * 0.3, sizePx * 0.45, sizePx * 0.26, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, obj: SceneObject, sizePx: number, stage: StageSize, dark: boolean): void {
  const text = obj.text ?? '';
  const { fontPx } = textMetrics(text, sizePx, stage);
  ctx.font = `800 ${fontPx}px ${TEXT_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const fill = obj.color ?? (dark ? '#ffffff' : COLOR_INK);
  // The outline contrasts with the fill so the words read on any background.
  const rgb = /^#/.test(fill) ? fill : COLOR_INK;
  const light = isLightColor(rgb);
  ctx.strokeStyle = light ? 'rgba(31, 26, 61, 0.9)' : 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(3, fontPx * 0.18);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
}

function isLightColor(hex: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const body = m[1] as string;
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

function drawSvg(ctx: CanvasRenderingContext2D, obj: SceneObject, sizePx: number, images: SvgImageCache | null): void {
  if (!obj.svg || !images) return;
  const loaded = images.get(obj.svg);
  if (!loaded) return; // not decoded yet, or not usable: draw nothing
  const w = loaded.aspect >= 1 ? sizePx : sizePx * loaded.aspect;
  const h = loaded.aspect >= 1 ? sizePx / loaded.aspect : sizePx;
  try {
    ctx.drawImage(loaded.image, -w / 2, -h / 2, w, h);
  } catch {
    // A broken image must never stop the frame.
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, label: string, place: Placement, stage: StageSize): void {
  const fontPx = Math.max(11, Math.min(18, Math.min(stage.width, stage.height) * 0.042));
  ctx.font = `700 ${fontPx}px ${TEXT_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = Math.min(stage.width * 0.6, ctx.measureText(label).width + fontPx);
  const height = fontPx * 1.5;
  const x = Math.max(width / 2 + 2, Math.min(stage.width - width / 2 - 2, place.cx));
  const y = Math.min(stage.height - height / 2 - 2, place.cy + place.hh + height * 0.7);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  roundedRectPath(ctx, x - width / 2, y - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = COLOR_INK;
  ctx.fillText(label, x, y + fontPx * 0.05, width - fontPx * 0.5);
}

function ringRadius(place: Placement): number {
  return Math.max(place.hw, place.hh) + Math.max(6, place.sizePx * 0.14);
}

function drawHighlight(ctx: CanvasRenderingContext2D, place: Placement, t: number, reduced: boolean): void {
  const radius = ringRadius(place);
  const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4.2);
  ctx.save();
  ctx.shadowColor = COLOR_HIGHLIGHT;
  ctx.shadowBlur = 10 + pulse * 14;
  ctx.strokeStyle = COLOR_HIGHLIGHT;
  ctx.lineWidth = 4 + pulse * 2;
  ctx.beginPath();
  ctx.arc(place.cx, place.cy, radius + pulse * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  if (!reduced) {
    // A second ring that ripples outwards.
    const ripple = (t * 0.9) % 1;
    ctx.save();
    ctx.globalAlpha = (1 - ripple) * 0.6;
    ctx.strokeStyle = COLOR_HIGHLIGHT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(place.cx, place.cy, radius + ripple * radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSelected(ctx: CanvasRenderingContext2D, place: Placement): void {
  const radius = ringRadius(place);
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(place.cx, place.cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COLOR_SELECTED;
  ctx.lineWidth = 4;
  ctx.stroke();
  // Check-mark badge on the upper right.
  const badge = Math.max(11, Math.min(18, radius * 0.38));
  const bx = place.cx + radius * 0.72;
  const by = place.cy - radius * 0.72;
  ctx.fillStyle = COLOR_SELECTED;
  ctx.beginPath();
  ctx.arc(bx, by, badge, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineWidth = Math.max(2.5, badge * 0.24);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(bx - badge * 0.45, by + badge * 0.02);
  ctx.lineTo(bx - badge * 0.12, by + badge * 0.36);
  ctx.lineTo(bx + badge * 0.48, by - badge * 0.32);
  ctx.stroke();
  ctx.restore();
}

function drawFocus(ctx: CanvasRenderingContext2D, place: Placement): void {
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(place.cx, place.cy, ringRadius(place) + 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COLOR_FOCUS;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.restore();
}

/** Clears the canvas (in CSS pixel space) and paints background, objects, markers and particles. */
export function renderFrame(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const stage: StageSize = { width: f.width, height: f.height };
  const backgroundTime = f.reducedMotion ? 0 : f.t;
  ctx.clearRect(0, 0, f.width, f.height);
  drawBackground(ctx, f.scene, f.width, f.height, backgroundTime);

  const dark = themeIsDark(f.scene.theme);
  const ordered = drawOrder(f.scene);
  const placements = new Map<string, Placement>();

  for (const obj of ordered) {
    const place = placeObject(obj, f.t, stage, f.reducedMotion);
    placements.set(obj.id, place);
    const tappedAt = f.tapTimes.get(obj.id);
    const squash = tappedAt === undefined ? { sx: 1, sy: 1 } : tapSquash(f.t - tappedAt, f.reducedMotion);
    const alpha = Math.max(0, Math.min(1, obj.opacity * place.pose.alpha));
    if (alpha <= 0 || place.pose.scale <= 0) continue;
    ctx.save();
    ctx.translate(place.cx, place.cy);
    ctx.rotate((obj.rotation * Math.PI) / 180 + place.pose.rotation);
    ctx.scale(place.pose.scale * squash.sx, place.pose.scale * squash.sy);
    ctx.globalAlpha = alpha;
    switch (obj.type) {
      case 'emoji':
        if (obj.emoji) drawEmoji(ctx, obj.emoji, place.sizePx);
        break;
      case 'shape':
        drawShape(ctx, obj, place.sizePx);
        break;
      case 'text':
        if (obj.text) drawText(ctx, obj, place.sizePx, stage, dark);
        break;
      case 'svg':
        drawSvg(ctx, obj, place.sizePx, f.images);
        break;
      default:
        break;
    }
    ctx.restore();
  }

  // Captions and markers sit above every object so nothing hides them.
  for (const obj of ordered) {
    const place = placements.get(obj.id);
    if (!place) continue;
    if (obj.label && place.pose.alpha > 0.3 && place.pose.scale > 0.3) drawLabel(ctx, obj.label, place, stage);
  }
  for (const obj of ordered) {
    const place = placements.get(obj.id);
    if (!place) continue;
    if (f.highlightIds.has(obj.id)) drawHighlight(ctx, place, f.t, f.reducedMotion);
    if (f.selectedIds.has(obj.id)) drawSelected(ctx, place);
    if (f.focusedId === obj.id) drawFocus(ctx, place);
  }

  if (f.staticBurst) drawStaticBurst(ctx, f.width, f.height);
  if (f.particles.length > 0) drawParticles(ctx, f.particles);
}
