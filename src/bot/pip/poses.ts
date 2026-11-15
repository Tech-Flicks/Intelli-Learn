/**
 * Arm poses and arm geometry, ported from the design file's kinematics engine.
 *
 * Each arm is a quadratic Bezier tube from a fixed shoulder, through an elbow control point
 * (`cx`, `cy`), to the wrist (`wx`, `wy`). The hand is drawn at the wrist, rotated by `angle`
 * degrees (0 = fingers up). All numbers are in the 380 x 380 view box of the artwork.
 *
 * "left" and "right" are the sides of the picture, as in the design file: the left arm of the
 * picture is Pip's own right arm.
 */
import type { PipState } from './states';

export type ArmSide = 'left' | 'right';
export const ARM_SIDES: readonly ArmSide[] = ['left', 'right'];

/** 'open' = fanned fingers and thumb, 'curled' = a soft fist that grips or rests. */
export type HandStyle = 'open' | 'curled';

/** Where one arm is right now. */
export interface ArmPosition {
  cx: number;
  cy: number;
  wx: number;
  wy: number;
  angle: number;
}

/** The resting pose of one arm in one state, and how it sways around that pose. */
export interface ArmPose extends ArmPosition {
  style: HandStyle;
  /** Sway of the wrist in view-box units. */
  bobX: number;
  bobY: number;
  /** Sway of the hand angle in degrees. */
  rotAmp: number;
  /** Sway speed in radians per second. */
  speed: number;
}

export const SHOULDERS: Readonly<Record<ArmSide, { readonly x: number; readonly y: number }>> = {
  left: { x: 126, y: 232 },
  right: { x: 254, y: 232 },
};

export const ARM_POSE_TABLE: Readonly<Record<PipState, Readonly<Record<ArmSide, ArmPose>>>> = {
  idle: {
    left: { cx: 78, cy: 230, wx: 76, wy: 196, angle: -26, style: 'open', bobX: 2, bobY: 5, rotAmp: 8, speed: 2.2 },
    right: { cx: 294, cy: 236, wx: 304, wy: 244, angle: 116, style: 'open', bobX: 2, bobY: 4, rotAmp: 6, speed: 2.2 },
  },
  happy: {
    left: { cx: 70, cy: 210, wx: 68, wy: 158, angle: -24, style: 'open', bobX: 5, bobY: 4, rotAmp: 18, speed: 7.5 },
    right: { cx: 296, cy: 230, wx: 306, wy: 220, angle: 76, style: 'open', bobX: 3, bobY: 5, rotAmp: 10, speed: 3.8 },
  },
  giggle: {
    left: { cx: 92, cy: 242, wx: 174, wy: 180, angle: 30, style: 'curled', bobX: 1.5, bobY: 4.5, rotAmp: 5, speed: 15 },
    right: { cx: 294, cy: 232, wx: 302, wy: 228, angle: 82, style: 'open', bobX: 3, bobY: 5, rotAmp: 12, speed: 15 },
  },
  sad: {
    left: { cx: 94, cy: 256, wx: 98, wy: 284, angle: -162, style: 'open', bobX: 1, bobY: 2.5, rotAmp: 3, speed: 1.5 },
    right: { cx: 286, cy: 256, wx: 282, wy: 284, angle: 162, style: 'open', bobX: -1, bobY: 2.5, rotAmp: 3, speed: 1.5 },
  },
  angry: {
    left: { cx: 76, cy: 248, wx: 132, wy: 276, angle: 112, style: 'curled', bobX: 2, bobY: 1.5, rotAmp: 4, speed: 18 },
    right: { cx: 304, cy: 248, wx: 248, wy: 276, angle: -112, style: 'curled', bobX: -2, bobY: 1.5, rotAmp: 4, speed: 18 },
  },
  tired: {
    left: { cx: 92, cy: 240, wx: 176, wy: 182, angle: 28, style: 'curled', bobX: 1, bobY: 3, rotAmp: 4, speed: 2.0 },
    right: { cx: 286, cy: 256, wx: 292, wy: 284, angle: 158, style: 'open', bobX: 1, bobY: 2, rotAmp: 3, speed: 1.6 },
  },
  sleeping: {
    left: { cx: 88, cy: 238, wx: 146, wy: 210, angle: 34, style: 'curled', bobX: 1, bobY: 2, rotAmp: 2, speed: 1.6 },
    right: { cx: 262, cy: 258, wx: 182, wy: 214, angle: -28, style: 'curled', bobX: 1, bobY: 2, rotAmp: 2, speed: 1.6 },
  },
  waiting: {
    left: { cx: 112, cy: 288, wx: 146, wy: 204, angle: 18, style: 'curled', bobX: 0.5, bobY: 1, rotAmp: 1.5, speed: 1.5 },
    right: { cx: 290, cy: 266, wx: 242, wy: 284, angle: -82, style: 'curled', bobX: 1, bobY: 4, rotAmp: 8, speed: 6.5 },
  },
  jump_scared: {
    left: { cx: 76, cy: 202, wx: 62, wy: 146, angle: -32, style: 'open', bobX: 3, bobY: 3, rotAmp: 10, speed: 22 },
    right: { cx: 304, cy: 202, wx: 318, wy: 146, angle: 32, style: 'open', bobX: -3, bobY: 3, rotAmp: 10, speed: 22 },
  },
  teaching: {
    left: { cx: 84, cy: 248, wx: 106, wy: 262, angle: 122, style: 'curled', bobX: 1, bobY: 2, rotAmp: 3, speed: 2.2 },
    right: { cx: 276, cy: 246, wx: 298, wy: 210, angle: 38, style: 'curled', bobX: 3, bobY: 4, rotAmp: 7, speed: 3.6 },
  },
  reading: {
    left: { cx: 86, cy: 254, wx: 126, wy: 274, angle: 78, style: 'curled', bobX: 1, bobY: 2, rotAmp: 3, speed: 2.0 },
    right: { cx: 294, cy: 254, wx: 254, wy: 274, angle: -78, style: 'curled', bobX: -1, bobY: 2, rotAmp: 3, speed: 2.0 },
  },
  storytelling: {
    left: { cx: 78, cy: 220, wx: 70, wy: 180, angle: -28, style: 'open', bobX: 4, bobY: 6, rotAmp: 12, speed: 2.8 },
    right: { cx: 302, cy: 220, wx: 310, wy: 180, angle: 28, style: 'open', bobX: -4, bobY: 6, rotAmp: 12, speed: 2.8 },
  },
  celebrating: {
    left: { cx: 80, cy: 194, wx: 72, wy: 136, angle: -26, style: 'open', bobX: 5, bobY: 6, rotAmp: 16, speed: 8.5 },
    right: { cx: 300, cy: 194, wx: 308, wy: 136, angle: 26, style: 'open', bobX: -5, bobY: 6, rotAmp: 16, speed: 8.5 },
  },
  listening: {
    left: { cx: 72, cy: 208, wx: 90, wy: 156, angle: 18, style: 'open', bobX: 1.5, bobY: 3, rotAmp: 5, speed: 2.6 },
    right: { cx: 292, cy: 238, wx: 298, wy: 244, angle: 114, style: 'open', bobX: 1.5, bobY: 3, rotAmp: 4, speed: 2.2 },
  },
  thinking: {
    left: { cx: 98, cy: 256, wx: 168, wy: 196, angle: 34, style: 'curled', bobX: 1.5, bobY: 3, rotAmp: 6, speed: 4.2 },
    right: { cx: 290, cy: 254, wx: 236, wy: 258, angle: -78, style: 'curled', bobX: 1, bobY: 1.5, rotAmp: 2, speed: 2.0 },
  },
  talking: {
    left: { cx: 82, cy: 238, wx: 84, wy: 212, angle: -20, style: 'open', bobX: 4, bobY: 6, rotAmp: 14, speed: 6.2 },
    right: { cx: 298, cy: 238, wx: 296, wy: 212, angle: 20, style: 'open', bobX: -4, bobY: 6, rotAmp: 14, speed: 5.6 },
  },
  singing: {
    left: { cx: 76, cy: 214, wx: 72, wy: 168, angle: -24, style: 'open', bobX: 5, bobY: 6, rotAmp: 14, speed: 5.2 },
    right: { cx: 286, cy: 248, wx: 214, wy: 194, angle: -32, style: 'curled', bobX: 2, bobY: 2.5, rotAmp: 4, speed: 5.2 },
  },
  curious: {
    left: { cx: 78, cy: 222, wx: 108, wy: 176, angle: 22, style: 'curled', bobX: 1.5, bobY: 2.5, rotAmp: 3, speed: 2.2 },
    right: { cx: 292, cy: 238, wx: 300, wy: 244, angle: 112, style: 'open', bobX: 2, bobY: 3, rotAmp: 5, speed: 2.2 },
  },
  proud: {
    left: { cx: 76, cy: 236, wx: 126, wy: 268, angle: 112, style: 'curled', bobX: 1, bobY: 2, rotAmp: 2.5, speed: 2.0 },
    right: { cx: 304, cy: 236, wx: 254, wy: 268, angle: -112, style: 'curled', bobX: -1, bobY: 2, rotAmp: 2.5, speed: 2.0 },
  },
  shy: {
    left: { cx: 96, cy: 258, wx: 168, wy: 256, angle: 82, style: 'curled', bobX: 4, bobY: 1.5, rotAmp: 6, speed: 5.5 },
    right: { cx: 284, cy: 258, wx: 212, wy: 256, angle: -82, style: 'curled', bobX: -4, bobY: 1.5, rotAmp: 6, speed: 5.5 },
  },
};

/** Where the two dark rings sit along the arm tube (0 = shoulder, 1 = wrist), and their half length. */
const BAND_POSITIONS = [0.38, 0.7] as const;
const BAND_HALF_WIDTH = 9.5;

/**
 * A short curved stroke across the arm tube at `t`: the point of the Bezier at `t`, extended
 * `halfWidth` to both sides along the normal, bowed a little along the tangent so that the
 * ring looks round.
 */
export function computeBandPath(
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  wx: number,
  wy: number,
  t: number,
  halfWidth: number,
): string {
  const mt = 1 - t;
  const px = mt * mt * sx + 2 * mt * t * cx + t * t * wx;
  const py = mt * mt * sy + 2 * mt * t * cy + t * t * wy;

  const tx = 2 * mt * (cx - sx) + 2 * t * (wx - cx);
  const ty = 2 * mt * (cy - sy) + 2 * t * (wy - cy);
  const length = Math.hypot(tx, ty) || 1;
  const ux = tx / length;
  const uy = ty / length;
  const nx = -uy;
  const ny = ux;

  const x1 = px - nx * halfWidth;
  const y1 = py - ny * halfWidth;
  const x2 = px + nx * halfWidth;
  const y2 = py + ny * halfWidth;
  const qx = px + ux * 2.5;
  const qy = py + uy * 2.5;

  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** The attribute values that draw one arm: the tube, its two rings and the hand transform. */
export interface ArmGeometry {
  tube: string;
  band1: string;
  band2: string;
  hand: string;
}

export function armGeometry(side: ArmSide, arm: ArmPosition): ArmGeometry {
  const shoulder = SHOULDERS[side];
  const { cx, cy, wx, wy } = arm;
  return {
    tube: `M ${shoulder.x} ${shoulder.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${wx.toFixed(1)} ${wy.toFixed(1)}`,
    band1: computeBandPath(shoulder.x, shoulder.y, cx, cy, wx, wy, BAND_POSITIONS[0], BAND_HALF_WIDTH),
    band2: computeBandPath(shoulder.x, shoulder.y, cx, cy, wx, wy, BAND_POSITIONS[1], BAND_HALF_WIDTH),
    hand: `translate(${wx.toFixed(1)}, ${wy.toFixed(1)}) rotate(${arm.angle.toFixed(1)})`,
  };
}

/** One arm of a state at rest: what is drawn first, and all that is drawn with reduced motion. */
export interface RestingArm extends ArmGeometry {
  style: HandStyle;
}

export function restingArms(state: PipState): Record<ArmSide, RestingArm> {
  const pose = ARM_POSE_TABLE[state];
  return {
    left: { ...armGeometry('left', pose.left), style: pose.left.style },
    right: { ...armGeometry('right', pose.right), style: pose.right.style },
  };
}
