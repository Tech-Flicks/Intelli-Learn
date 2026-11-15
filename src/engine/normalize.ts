/**
 * Safe fix-ups for a challenge that already passed the zod schema (or was read
 * back from storage). Never invents content; only repairs what has one obvious
 * repair. Returns a new object and leaves the input untouched.
 */
import { MAX_SCENE_OBJECTS, SHAPES } from '@/core/schemas';
import type { Challenge, Interaction, RobotInteraction, Scene, SceneAnim, SceneObject } from '@/core/schemas';
import { cellKey } from './robot';
import { sanitizeSvg } from './svg';

/** Stand-in for a tap target whose own drawing had to be dropped. */
export const NEUTRAL_EMOJI = '🔵';
const MAX_ID_LENGTH = 40;
const MAX_TAP_TARGETS = 20;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

function deepCopy<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, MAX_ID_LENGTH - 5)}-${taken.size}`;
}

function normalizeAnim(anim: SceneAnim | undefined): SceneAnim | undefined {
  if (!anim || anim.kind === 'none') return undefined;
  const out: SceneAnim = {
    kind: anim.kind,
    duration: clamp(anim.duration, 0.2, 30, 2),
    delay: clamp(anim.delay, 0, 30, 0),
    loop: typeof anim.loop === 'boolean' ? anim.loop : true,
  };
  if (typeof anim.toX === 'number' && Number.isFinite(anim.toX)) out.toX = clamp(anim.toX, -20, 120, 50);
  if (typeof anim.toY === 'number' && Number.isFinite(anim.toY)) out.toY = clamp(anim.toY, -20, 120, 50);
  // A move with nowhere to go is not an animation.
  if (out.kind === 'move' && out.toX === undefined && out.toY === undefined) return undefined;
  return out;
}

/**
 * Makes one object drawable, or returns null when it has nothing to draw.
 * `mustKeep` objects (tap targets) get a neutral stand-in instead of vanishing.
 */
function normalizeObject(obj: SceneObject, mustKeep: boolean): SceneObject | null {
  const out: SceneObject = {
    ...obj,
    x: clamp(obj.x, 0, 100, 50),
    y: clamp(obj.y, 0, 100, 50),
    size: clamp(obj.size, 2, 80, 12),
    rotation: clamp(obj.rotation, -360, 360, 0),
    opacity: clamp(obj.opacity, 0.1, 1, 1),
    z: clamp(obj.z, 0, 100, 1),
    tappable: obj.tappable === true,
  };
  const anim = normalizeAnim(obj.anim);
  if (anim) out.anim = anim;
  else delete out.anim;
  if (typeof out.label === 'string' && out.label.trim() === '') delete out.label;

  const hasEmoji = typeof out.emoji === 'string' && out.emoji.trim() !== '';
  const hasShape = typeof out.shape === 'string' && (SHAPES as readonly string[]).includes(out.shape);
  const hasText = typeof out.text === 'string' && out.text.trim() !== '';

  let drawable = false;
  if (out.type === 'svg') {
    const clean = typeof out.svg === 'string' ? sanitizeSvg(out.svg) : null;
    if (clean) {
      out.svg = clean; // store the sanitized drawing, never the raw one
      drawable = true;
    } else {
      delete out.svg;
    }
  } else {
    // Only an svg object may carry svg markup.
    delete out.svg;
    drawable = (out.type === 'emoji' && hasEmoji) || (out.type === 'shape' && hasShape) || (out.type === 'text' && hasText);
  }

  if (!drawable) {
    // The declared type has no content. Use another field the object already carries.
    if (hasEmoji) out.type = 'emoji';
    else if (hasShape) out.type = 'shape';
    else if (hasText && out.type !== 'svg') out.type = 'text';
    else if (mustKeep) {
      out.type = 'emoji';
      out.emoji = NEUTRAL_EMOJI;
    } else return null;
  }
  return out;
}

function normalizeScene(scene: Scene, interaction: Interaction): { scene: Scene; interaction: Interaction } {
  const isTap = interaction.kind === 'tap';
  let targetIds = isTap ? [...new Set(interaction.targetIds)] : [];
  const originalTargets = new Set(targetIds);

  // 1. Unique ids. A repeated id that is a tap target stays a target ("tap all the apples").
  const taken = new Set<string>();
  const objects: SceneObject[] = [];
  for (const raw of Array.isArray(scene.objects) ? scene.objects : []) {
    const id = uniqueId(raw.id, taken);
    taken.add(id);
    if (id !== raw.id && originalTargets.has(raw.id) && targetIds.length < MAX_TAP_TARGETS) targetIds.push(id);
    objects.push({ ...raw, id });
  }

  // 2. Drawable objects only; unsafe svg is dropped (or replaced when it is a tap target).
  const targets = new Set(targetIds);
  let cleaned: SceneObject[] = [];
  for (const obj of objects) {
    const fixed = normalizeObject(obj, targets.has(obj.id));
    if (fixed) cleaned.push(fixed);
  }

  // 3. Trim to the limit, never dropping a tap target: decoration goes first.
  if (cleaned.length > MAX_SCENE_OBJECTS) {
    const rank = (o: SceneObject): number => (targets.has(o.id) ? 0 : o.tappable ? 1 : 2);
    const keep = new Set(
      cleaned
        .map((o, index) => ({ o, index }))
        .sort((a, b) => rank(a.o) - rank(b.o) || a.index - b.index)
        .slice(0, MAX_SCENE_OBJECTS)
        .map((entry) => entry.o.id),
    );
    cleaned = cleaned.filter((o) => keep.has(o.id));
  }

  // 4. Tap: targets are tappable, and there are distractors to choose between where the scene has any.
  if (isTap) {
    for (const obj of cleaned) if (targets.has(obj.id)) obj.tappable = true;
    const targetCount = cleaned.filter((o) => targets.has(o.id)).length;
    let distractors = cleaned.filter((o) => o.tappable && !targets.has(o.id)).length;
    // Only a scene with no distractor at all is repaired. When the author already marked some
    // objects as wrong choices, the rest is decoration on purpose: promoting it could turn a
    // decoration that happens to fit the question (a fruit in "tap every fruit") into a trap.
    if (distractors === 0) {
      // Promote existing objects, pictures before text, biggest first. Nothing is invented.
      const candidates = cleaned
        .filter((o) => !o.tappable && !targets.has(o.id))
        .sort((a, b) => Number(a.type === 'text') - Number(b.type === 'text') || b.size - a.size);
      for (const obj of candidates) {
        if (distractors >= targetCount) break;
        obj.tappable = true;
        distractors += 1;
      }
    }
    targetIds = targetIds.slice(0, MAX_TAP_TARGETS);
  }

  const outScene: Scene = { ...scene, objects: cleaned };
  const outInteraction: Interaction = isTap ? { ...interaction, targetIds } : interaction;
  return { scene: outScene, interaction: outInteraction };
}

function normalizeRobot(i: RobotInteraction): RobotInteraction {
  const inside = (c: { x: number; y: number }): boolean => c.x >= 0 && c.y >= 0 && c.x < i.cols && c.y < i.rows;
  const seenWalls = new Set<string>();
  const reserved = new Set([cellKey(i.start.x, i.start.y), cellKey(i.goal.x, i.goal.y)]);
  const walls = i.walls.filter((w) => {
    const key = cellKey(w.x, w.y);
    // A wall outside the grid cannot be drawn, and the robot and goal need their own cells.
    if (!inside(w) || seenWalls.has(key) || reserved.has(key)) return false;
    seenWalls.add(key);
    return true;
  });
  const seenGems = new Set<string>();
  const gems = i.gems.filter((g) => {
    const key = cellKey(g.x, g.y);
    if (seenGems.has(key)) return false;
    seenGems.add(key);
    return true;
  });
  return { ...i, walls, gems, allowed: [...new Set(i.allowed)] };
}

function normalizeInteraction(i: Interaction): Interaction {
  switch (i.kind) {
    case 'choice':
      return { ...i, correctIds: [...new Set(i.correctIds)] };
    case 'number': {
      const tolerance = Number.isFinite(i.tolerance) && i.tolerance > 0 ? i.tolerance : 0;
      if (!Number.isFinite(i.answer)) return { ...i, tolerance };
      // The keypad must be able to type the answer.
      const needsMinus = i.answer < 0;
      const needsPoint = !Number.isInteger(i.answer);
      return {
        ...i,
        tolerance,
        allowNegative: i.allowNegative || needsMinus,
        allowDecimal: i.allowDecimal || needsPoint,
      };
    }
    case 'robot':
      return normalizeRobot(i);
    default:
      return i;
  }
}

/**
 * Safe fix-ups: unique scene object ids, tap targets marked tappable (with
 * distractors where the scene offers any), positions and sizes clamped,
 * unsafe svg dropped, scene trimmed to the object limit, keypad able to type
 * the answer, robot walls cleaned up. Returns a new object.
 */
export function normalizeChallenge(c: Challenge): Challenge {
  const copy = deepCopy(c);
  const sceneIn: Scene = copy.scene ?? { theme: 'plain', objects: [] };
  const fixed = normalizeScene(sceneIn, normalizeInteraction(copy.interaction));
  return { ...copy, scene: fixed.scene, interaction: fixed.interaction };
}
