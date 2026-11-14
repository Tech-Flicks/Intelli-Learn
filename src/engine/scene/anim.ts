/**
 * Scene object animation as a pure function of time. The renderer and the hit
 * test both call `animPose`, so what the child sees is what the child can tap.
 */
import type { SceneAnim } from '@/core/schemas';

export interface AnimPose {
  /** Offset from the object's own position, in CSS pixels. */
  dx: number;
  dy: number;
  /** Uniform scale multiplier. */
  scale: number;
  /** Extra rotation in radians. */
  rotation: number;
  /** Opacity multiplier 0..1. */
  alpha: number;
}

export interface AnimContext {
  /** Object position in stage percent. */
  x: number;
  y: number;
  /** Object size in CSS pixels. */
  sizePx: number;
  stageWidth: number;
  stageHeight: number;
}

export const REST_POSE: AnimPose = Object.freeze({ dx: 0, dy: 0, scale: 1, rotation: 0, alpha: 1 });

const TAU = Math.PI * 2;

export function easeInOutSine(p: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(p));
}

export function easeOutCubic(p: number): number {
  const q = 1 - clamp01(p);
  return 1 - q * q * q;
}

/** Overshoots a little past 1 before settling: a friendly "pop". */
export function easeOutBack(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const q = clamp01(p) - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(1, p));
}

/**
 * Pose of an object `t` seconds after the scene appeared.
 *
 * - Before `delay`, entrance animations (fade-in, slide-in, grow) hold their
 *   starting pose and all others rest.
 * - With `loop` false, the animation plays once and ends in the rest pose
 *   ('move' ends at its target).
 * - With `reducedMotion`, everything is shown in its final, still pose.
 */
export function animPose(anim: SceneAnim | undefined, t: number, ctx: AnimContext, reducedMotion = false): AnimPose {
  if (!anim || anim.kind === 'none') return REST_POSE;
  const toX = anim.toX ?? ctx.x;
  const toY = anim.toY ?? ctx.y;
  const moveDx = ((toX - ctx.x) / 100) * ctx.stageWidth;
  const moveDy = ((toY - ctx.y) / 100) * ctx.stageHeight;

  if (reducedMotion) {
    // A one-way move is shown where it ends; everything else rests.
    if (anim.kind === 'move' && !anim.loop) return { ...REST_POSE, dx: moveDx, dy: moveDy };
    return REST_POSE;
  }

  const duration = anim.duration > 0 ? anim.duration : 2;
  const local = t - (anim.delay > 0 ? anim.delay : 0);
  const started = local >= 0;
  const raw = started ? local / duration : 0;
  const p = anim.loop ? raw - Math.floor(raw) : Math.min(1, raw);
  const size = ctx.sizePx;

  switch (anim.kind) {
    case 'bounce': {
      if (!started) return REST_POSE;
      const lift = Math.abs(Math.sin(Math.PI * p));
      return { ...REST_POSE, dy: -lift * size * 0.4 };
    }
    case 'spin':
      if (!started) return REST_POSE;
      return { ...REST_POSE, rotation: TAU * (anim.loop ? p : easeInOutSine(p)) };
    case 'float':
      if (!started) return REST_POSE;
      return { ...REST_POSE, dy: Math.sin(TAU * p) * size * 0.14 };
    case 'pulse':
      if (!started) return REST_POSE;
      return { ...REST_POSE, scale: 1 + 0.12 * Math.sin(TAU * p) };
    case 'wiggle':
      if (!started) return REST_POSE;
      return { ...REST_POSE, rotation: Math.sin(TAU * p) * 0.22 };
    case 'grow':
      if (anim.loop) {
        // Breathes between small and full size so it never vanishes.
        return started ? { ...REST_POSE, scale: 0.6 + 0.4 * easeInOutSine(p < 0.5 ? p * 2 : 2 - p * 2) } : { ...REST_POSE, scale: 0.6 };
      }
      return { ...REST_POSE, scale: started ? Math.max(0, easeOutBack(p)) : 0 };
    case 'fade-in':
      if (anim.loop) {
        return started ? { ...REST_POSE, alpha: 0.35 + 0.65 * easeInOutSine(p < 0.5 ? p * 2 : 2 - p * 2) } : { ...REST_POSE, alpha: 0.35 };
      }
      return { ...REST_POSE, alpha: started ? easeOutCubic(p) : 0 };
    case 'slide-in': {
      // Slides in from the nearer side of the stage.
      const fromLeft = ctx.x <= 50;
      const travel = fromLeft ? -((ctx.x / 100) * ctx.stageWidth + size) : (1 - ctx.x / 100) * ctx.stageWidth + size;
      // Looping: slide in during the first half of each cycle, then wait.
      const k = started ? easeOutCubic(anim.loop ? Math.min(1, p * 2) : p) : 0;
      return { ...REST_POSE, dx: travel * (1 - k) };
    }
    case 'move': {
      if (!started) return REST_POSE;
      // Looping: there and back again.
      const k = anim.loop ? easeInOutSine(p < 0.5 ? p * 2 : 2 - p * 2) : easeInOutSine(p);
      return { ...REST_POSE, dx: moveDx * k, dy: moveDy * k };
    }
    case 'orbit': {
      if (!started) return REST_POSE;
      const radius = size * 0.6;
      // Circles around its own start point. A single orbit spirals out and back home.
      const ramp = anim.loop ? 1 : Math.sin(Math.PI * p);
      return { ...REST_POSE, dx: Math.cos(TAU * p) * radius * ramp, dy: Math.sin(TAU * p) * radius * ramp };
    }
    default:
      return REST_POSE;
  }
}

/** Squash-and-stretch reaction after a tap. `age` is seconds since the tap. */
export function tapSquash(age: number, reducedMotion = false): { sx: number; sy: number } {
  const length = 0.42;
  if (reducedMotion || age < 0 || age >= length) return { sx: 1, sy: 1 };
  const k = age / length;
  const wobble = Math.sin(k * Math.PI * 3) * (1 - k) * 0.22;
  return { sx: 1 + wobble, sy: 1 - wobble };
}
