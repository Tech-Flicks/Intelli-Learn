/**
 * Pip's motion engine: everything that moves without React.
 *
 * One `requestAnimationFrame` loop per mascot drives
 * - the arms: each arm eases towards the pose of the current state and sways around it
 *   (ported from the kinematics engine of `design/pip-mascot-sandbox.html`),
 * - the mouth: `--mouth-open` follows a speech-like rhythm or the level the caller gives,
 * - the eyes: `--gaze-x` / `--gaze-y` look at the pointer or at a point.
 * Blinking runs on its own random timer.
 *
 * The loop only writes attributes and custom properties through element references, so
 * React never re-renders for a frame. It stops while the page is hidden, while the mascot
 * is scrolled out of view, with reduced motion (`still`), and for good in `destroy()`.
 */
import { ARM_POSE_TABLE, ARM_SIDES, armGeometry, type ArmPosition, type ArmSide, type HandStyle } from './poses';
import { readPointer, retainPointer } from './pointer';
import { SpeechRhythm } from './rhythm';
import type { PipState } from './states';

/** A point in viewport (client) pixels, the pointer, or straight ahead. */
export type PipLookAt = { x: number; y: number } | 'pointer' | null;

export interface PipEngineInput {
  state: PipState;
  /** The mouth moves with a speech rhythm. */
  speaking: boolean;
  /** 0..1 replaces the rhythm (for a caller that knows the real loudness). */
  mouthLevel: number | null;
  lookAt: PipLookAt;
  /** Reduced motion: no loop, no timers, a resting pose. */
  still: boolean;
}

export interface PipEngineOptions {
  /** Random source for blinking and the speech rhythm. Tests pass a fixed one. */
  random?: () => number;
}

/** The design's motion was tuned per frame at 60 frames per second. */
const FRAME_MS = 1000 / 60;
const ARM_EASE_PER_FRAME = 0.18;
/** A frame after a hiccup must not fling the arms. */
const MAX_FRAME_MS = 100;

const GAZE_MAX_SHIFT = 4.2;
/** With an unchanged target, the mascot's own position is measured again this often. */
const GAZE_REFRESH_MS = 250;

const BLINK_MIN_MS = 2400;
const BLINK_SPREAD_MS = 2800;
const BLINK_CLOSED_MS = 140;
const DOUBLE_BLINK_CHANCE = 0.18;
const DOUBLE_BLINK_GAP_MS = 230;

const MOUTH_OPEN_TAU_MS = 38;
const MOUTH_CLOSE_TAU_MS = 70;
const MOUTH_SHUT_BELOW = 0.012;
/** With reduced motion a talking Pip shows one calm, half-open mouth. */
const STILL_TALKING_LEVEL = 0.45;

const POP_MS = 480;

interface ArmDom {
  tubes: SVGElement[];
  band1: SVGElement;
  band2: SVGElement;
  hand: SVGElement;
  open: SVGElement;
  curled: SVGElement;
}

interface ArmWritten {
  tube: string;
  band1: string;
  band2: string;
  hand: string;
  style: HandStyle | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findArm(svg: SVGSVGElement, side: ArmSide): ArmDom | null {
  const part = (name: string) => svg.querySelector<SVGElement>(`.pip-${name}`);
  const outline = part(`arm-${side}-outline`);
  const fill = part(`arm-${side}-fill`);
  const shine = part(`arm-${side}-shine`);
  const band1 = part(`arm-${side}-band1`);
  const band2 = part(`arm-${side}-band2`);
  const hand = part(`hand-${side}-group`);
  const open = part(`hand-${side}-open`);
  const curled = part(`hand-${side}-curled`);
  if (!outline || !fill || !shine || !band1 || !band2 || !hand || !open || !curled) return null;
  return { tubes: [outline, fill, shine], band1, band2, hand, open, curled };
}

function restingPosition(state: PipState, side: ArmSide): ArmPosition {
  const { cx, cy, wx, wy, angle } = ARM_POSE_TABLE[state][side];
  return { cx, cy, wx, wy, angle };
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export class PipEngine {
  private readonly svg: SVGSVGElement;
  private readonly random: () => number;
  private readonly rhythm: SpeechRhythm;
  private readonly dom: Record<ArmSide, ArmDom> | null;
  private readonly arms: Record<ArmSide, ArmPosition>;
  private readonly written: Record<ArmSide, ArmWritten> = {
    left: { tube: '', band1: '', band2: '', hand: '', style: null },
    right: { tube: '', band1: '', band2: '', hand: '', style: null },
  };
  private readonly flags = new Map<string, boolean>();
  private readonly observer: IntersectionObserver | null = null;

  private input: PipEngineInput;
  private destroyed = false;
  private running = false;
  private onScreen = true;
  private frameHandle: number | null = null;
  private lastFrameAt: number | null = null;

  private mouthOpen = 0;
  private writtenMouth = '';

  private writtenGazeX = '';
  private writtenGazeY = '';
  private gazeTargetX = Number.NaN;
  private gazeTargetY = Number.NaN;
  private gazeMeasuredAt = 0;
  private releasePointer: (() => void) | null = null;

  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private popTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(svg: SVGSVGElement, input: PipEngineInput, options: PipEngineOptions = {}) {
    this.svg = svg;
    this.input = input;
    this.random = options.random ?? Math.random;
    this.rhythm = new SpeechRhythm(this.random, input.state === 'singing' ? 'song' : 'speech');

    const left = findArm(svg, 'left');
    const right = findArm(svg, 'right');
    this.dom = left && right ? { left, right } : null;
    this.arms = { left: restingPosition(input.state, 'left'), right: restingPosition(input.state, 'right') };

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.handleVisibility);
    if (typeof IntersectionObserver === 'function') {
      // The margin starts the motion a moment before the mascot scrolls into view.
      this.observer = new IntersectionObserver(this.handleIntersection, { rootMargin: '48px' });
      this.observer.observe(svg);
    }
    this.apply();
  }

  /** Call whenever a prop of the mascot changed. */
  update(input: PipEngineInput): void {
    if (this.destroyed) return;
    const startedSpeaking = input.speaking && !this.input.speaking;
    this.input = input;
    this.rhythm.setMode(input.state === 'singing' ? 'song' : 'speech');
    if (startedSpeaking) this.rhythm.reset();
    this.apply();
  }

  /** The squash-and-stretch bounce of a tap. Nothing happens with reduced motion. */
  pop(): void {
    if (this.destroyed || this.input.still) return;
    if (this.popTimer !== null) clearTimeout(this.popTimer);
    // Taking the attribute away, letting the browser notice, and setting it again restarts the animation.
    this.svg.removeAttribute('data-pop');
    void this.svg.getBoundingClientRect();
    this.svg.setAttribute('data-pop', '');
    this.popTimer = setTimeout(() => {
      this.popTimer = null;
      this.svg.removeAttribute('data-pop');
    }, POP_MS);
  }

  /** Stops the loop and every timer and listener. The engine cannot be used afterwards. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sync();
    this.observer?.disconnect();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.handleVisibility);
    this.releasePointer?.();
    this.releasePointer = null;
    if (this.popTimer !== null) clearTimeout(this.popTimer);
    this.popTimer = null;
    this.svg.removeAttribute('data-pop');
  }

  /** True while the animation loop is scheduled. */
  isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Start and stop
  // -------------------------------------------------------------------------

  private apply(): void {
    const followsPointer = !this.destroyed && !this.input.still && this.input.lookAt === 'pointer';
    if (followsPointer && !this.releasePointer) this.releasePointer = retainPointer();
    if (!followsPointer && this.releasePointer) {
      this.releasePointer();
      this.releasePointer = null;
    }
    // A new target is measured on the next frame, not after the refresh interval.
    this.gazeTargetX = Number.NaN;
    this.sync();
    if (this.input.still) this.renderStill();
  }

  private sync(): void {
    const shouldRun = !this.destroyed && !this.input.still && this.onScreen && pageVisible();
    if (shouldRun === this.running) return;
    this.running = shouldRun;
    if (shouldRun) {
      this.lastFrameAt = null;
      this.frameHandle = requestAnimationFrame(this.tick);
      this.scheduleBlink();
    } else {
      if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
      this.clearBlink();
    }
  }

  private readonly handleVisibility = (): void => {
    this.sync();
  };

  private readonly handleIntersection = (entries: IntersectionObserverEntry[]): void => {
    const latest = entries[entries.length - 1];
    if (!latest) return;
    this.onScreen = latest.isIntersecting;
    this.sync();
  };

  private readonly tick = (now: number): void => {
    this.frameHandle = null;
    if (!this.running) return;
    const dt = this.lastFrameAt === null ? FRAME_MS : clamp(now - this.lastFrameAt, 0, MAX_FRAME_MS);
    this.lastFrameAt = now;
    this.stepMouth(dt);
    this.stepArms(now, dt);
    this.stepGaze(now);
    if (this.running) this.frameHandle = requestAnimationFrame(this.tick);
  };

  // -------------------------------------------------------------------------
  // Reduced motion: one resting picture per state
  // -------------------------------------------------------------------------

  private renderStill(): void {
    const { state, speaking, mouthLevel, lookAt } = this.input;
    for (const side of ARM_SIDES) {
      Object.assign(this.arms[side], restingPosition(state, side));
      this.writeArm(side, ARM_POSE_TABLE[state][side].style);
    }
    this.mouthOpen = mouthLevel ?? (speaking ? STILL_TALKING_LEVEL : 0);
    this.writeMouth();
    this.setFlag('data-speaking', speaking || this.mouthOpen > 0);
    this.setFlag('data-blink', false);
    if (lookAt !== null && lookAt !== 'pointer') this.lookTowards(lookAt.x, lookAt.y);
    else this.writeGaze(0, 0);
  }

  // -------------------------------------------------------------------------
  // Arms
  // -------------------------------------------------------------------------

  private stepArms(now: number, dt: number): void {
    const { state } = this.input;
    const pose = ARM_POSE_TABLE[state];
    const seconds = now * 0.001;
    // While Pip talks or sings, the hands lift and wave with the voice.
    const speechBoost = state === 'talking' || state === 'singing' ? this.mouthOpen * 10 : 0;
    const ease = 1 - Math.pow(1 - ARM_EASE_PER_FRAME, dt / FRAME_MS);

    ARM_SIDES.forEach((side, index) => {
      const arm = this.arms[side];
      const target = pose[side];
      const phase = index * 1.35;
      const sWave = Math.sin(seconds * target.speed + phase);
      const cWave = Math.cos(seconds * target.speed + phase);

      const goalWx = target.wx + sWave * target.bobX;
      const goalWy = target.wy + cWave * target.bobY - speechBoost * 0.8;
      const goalCx = target.cx + sWave * (target.bobX * 0.6);
      const goalCy = target.cy + cWave * (target.bobY * 0.6);
      const goalAngle = target.angle + sWave * (target.rotAmp + speechBoost * 0.9);

      arm.wx += (goalWx - arm.wx) * ease;
      arm.wy += (goalWy - arm.wy) * ease;
      arm.cx += (goalCx - arm.cx) * ease;
      arm.cy += (goalCy - arm.cy) * ease;
      arm.angle += (goalAngle - arm.angle) * ease;

      this.writeArm(side, target.style);
    });
  }

  private writeArm(side: ArmSide, style: HandStyle): void {
    const dom = this.dom?.[side];
    if (!dom) return;
    const written = this.written[side];
    const geometry = armGeometry(side, this.arms[side]);
    if (geometry.tube !== written.tube) {
      written.tube = geometry.tube;
      for (const tube of dom.tubes) tube.setAttribute('d', geometry.tube);
    }
    if (geometry.band1 !== written.band1) {
      written.band1 = geometry.band1;
      dom.band1.setAttribute('d', geometry.band1);
    }
    if (geometry.band2 !== written.band2) {
      written.band2 = geometry.band2;
      dom.band2.setAttribute('d', geometry.band2);
    }
    if (geometry.hand !== written.hand) {
      written.hand = geometry.hand;
      dom.hand.setAttribute('transform', geometry.hand);
    }
    if (style !== written.style) {
      written.style = style;
      const [shown, hidden] = style === 'open' ? [dom.open, dom.curled] : [dom.curled, dom.open];
      shown.removeAttribute('display');
      hidden.setAttribute('display', 'none');
    }
  }

  // -------------------------------------------------------------------------
  // Mouth
  // -------------------------------------------------------------------------

  private stepMouth(dt: number): void {
    const { speaking, mouthLevel } = this.input;
    let target = 0;
    if (mouthLevel !== null) target = mouthLevel;
    else if (speaking) target = this.rhythm.advance(dt);

    const tau = target > this.mouthOpen ? MOUTH_OPEN_TAU_MS : MOUTH_CLOSE_TAU_MS;
    this.mouthOpen += (target - this.mouthOpen) * (1 - Math.exp(-dt / tau));
    if (target === 0 && this.mouthOpen < MOUTH_SHUT_BELOW) this.mouthOpen = 0;
    this.writeMouth();
    // The talking mouth stays on screen until it has closed, then the state's own mouth returns.
    this.setFlag('data-speaking', speaking || target > 0 || this.mouthOpen > 0);
  }

  private writeMouth(): void {
    const value = clamp(this.mouthOpen, 0, 1).toFixed(3);
    if (value === this.writtenMouth) return;
    this.writtenMouth = value;
    this.svg.style.setProperty('--mouth-open', value);
  }

  // -------------------------------------------------------------------------
  // Eyes
  // -------------------------------------------------------------------------

  private stepGaze(now: number): void {
    const { lookAt } = this.input;
    let x: number;
    let y: number;
    if (lookAt === null) {
      this.writeGaze(0, 0);
      return;
    }
    if (lookAt === 'pointer') {
      const pointer = readPointer();
      if (pointer.version === 0) {
        this.writeGaze(0, 0);
        return;
      }
      x = pointer.x;
      y = pointer.y;
    } else {
      x = lookAt.x;
      y = lookAt.y;
    }
    if (x === this.gazeTargetX && y === this.gazeTargetY && now - this.gazeMeasuredAt < GAZE_REFRESH_MS) return;
    this.gazeTargetX = x;
    this.gazeTargetY = y;
    this.gazeMeasuredAt = now;
    this.lookTowards(x, y);
  }

  /** Turns the pupils towards a point of the viewport, as far as the eyes allow. */
  private lookTowards(x: number, y: number): void {
    const rect = this.svg.getBoundingClientRect();
    const viewWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
    const viewHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y) || rect.width <= 0 || rect.height <= 0 || viewWidth <= 0 || viewHeight <= 0) {
      this.writeGaze(0, 0);
      return;
    }
    // The face sits in the upper part of the picture.
    const faceX = rect.left + rect.width / 2;
    const faceY = rect.top + rect.height * 0.36;
    const nx = clamp((x - faceX) / (viewWidth * 0.45), -1, 1);
    const ny = clamp((y - faceY) / (viewHeight * 0.45), -1, 1);
    this.writeGaze(nx * GAZE_MAX_SHIFT, ny * GAZE_MAX_SHIFT);
  }

  private writeGaze(x: number, y: number): void {
    const gx = `${x.toFixed(2)}px`;
    const gy = `${y.toFixed(2)}px`;
    if (gx !== this.writtenGazeX) {
      this.writtenGazeX = gx;
      this.svg.style.setProperty('--gaze-x', gx);
    }
    if (gy !== this.writtenGazeY) {
      this.writtenGazeY = gy;
      this.svg.style.setProperty('--gaze-y', gy);
    }
  }

  // -------------------------------------------------------------------------
  // Blinking
  // -------------------------------------------------------------------------

  private scheduleBlink(): void {
    this.clearBlink();
    const delay = BLINK_MIN_MS + this.random() * BLINK_SPREAD_MS;
    this.blinkTimer = setTimeout(() => this.blink(this.random() < DOUBLE_BLINK_CHANCE ? 2 : 1), delay);
  }

  private blink(times: number): void {
    this.setFlag('data-blink', true);
    this.blinkTimer = setTimeout(() => {
      this.setFlag('data-blink', false);
      if (times > 1) this.blinkTimer = setTimeout(() => this.blink(times - 1), DOUBLE_BLINK_GAP_MS);
      else this.scheduleBlink();
    }, BLINK_CLOSED_MS);
  }

  private clearBlink(): void {
    if (this.blinkTimer !== null) clearTimeout(this.blinkTimer);
    this.blinkTimer = null;
    this.setFlag('data-blink', false);
  }

  /** A presence attribute on the root that the stylesheet reacts to. */
  private setFlag(name: string, on: boolean): void {
    if (this.flags.get(name) === on) return;
    this.flags.set(name, on);
    if (on) this.svg.setAttribute(name, '');
    else this.svg.removeAttribute(name);
  }
}
