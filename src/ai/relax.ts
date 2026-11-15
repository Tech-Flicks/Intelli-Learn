/**
 * Forgiving pre-pass for challenge JSON, applied before the strict schema.
 *
 * Models make the same harmless slips again and again: `null` for an optional
 * field, a colour name instead of a hex code, a coordinate of 104, a caption
 * a few letters too long. Each of those would cost a whole extra request if
 * the schema rejected it. This pass repairs slips that have exactly one
 * sensible repair and touches nothing that carries meaning (texts the child
 * reads, answers, option lists). Whatever is still wrong afterwards is
 * reported back to the model by the schema as before.
 */
import { ANIMATIONS, MAX_SCENE_OBJECTS, SCENE_THEMES } from '@/core/schemas';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A copy without `null` values: optional fields that a model "filled in" with null. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(withoutNulls);
  if (isObject(value)) {
    const out: Json = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null) out[key] = withoutNulls(item);
    }
    return out;
  }
  return value;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return undefined;
}

/** Clamps a numeric field into its range. A value that is not a number is left for the schema to report. */
function clampField(target: Json, key: string, min: number, max: number): void {
  if (!(key in target)) return;
  const n = toNumber(target[key]);
  if (n !== undefined) target[key] = Math.max(min, Math.min(max, n));
}

const NAMED_COLORS: Record<string, string> = {
  red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047', blue: '#1e88e5', purple: '#8e24aa', pink: '#f06292',
  brown: '#8d6e63', black: '#222222', white: '#ffffff', gray: '#9e9e9e', grey: '#9e9e9e', cyan: '#26c6da', teal: '#009688',
  gold: '#ffc107', navy: '#283593', lime: '#c0ca33', magenta: '#d81b60', silver: '#bdbdbd', skyblue: '#81d4fa', violet: '#7e57c2',
};

/** A `#rgb` or `#rrggbb` colour for what the model wrote, or undefined when it cannot be read as one. */
export function toHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(text)) return text;
  if (/^#[0-9a-f]{8}$/.test(text)) return text.slice(0, 7); // drop the alpha channel
  if (/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(text)) return `#${text}`;
  return NAMED_COLORS[text.replace(/[\s_-]/g, '')];
}

function fixColor(target: Json, key: string): void {
  if (!(key in target)) return;
  const hex = toHexColor(target[key]);
  if (hex) target[key] = hex;
  else delete target[key]; // optional everywhere: the app's default colour is used
}

function clip(target: Json, key: string, max: number): void {
  const value = target[key];
  if (typeof value === 'string' && value.trim().length > max) target[key] = value.trim().slice(0, max).trimEnd();
}

function fixBoolean(target: Json, key: string): void {
  const value = target[key];
  if (value === 'true') target[key] = true;
  else if (value === 'false') target[key] = false;
}

function fixAnim(object: Json): void {
  const anim = object.anim;
  if (anim === undefined) return;
  if (!isObject(anim) || typeof anim.kind !== 'string' || !(ANIMATIONS as readonly string[]).includes(anim.kind)) {
    delete object.anim; // an unknown animation is decoration lost, not a reason to reject the scene
    return;
  }
  clampField(anim, 'duration', 0.2, 30);
  clampField(anim, 'delay', 0, 30);
  clampField(anim, 'toX', -20, 120);
  clampField(anim, 'toY', -20, 120);
  fixBoolean(anim, 'loop');
}

function fixSceneObject(object: Json): void {
  clampField(object, 'x', 0, 100);
  clampField(object, 'y', 0, 100);
  clampField(object, 'size', 2, 80);
  clampField(object, 'rotation', -360, 360);
  clampField(object, 'opacity', 0.1, 1);
  clampField(object, 'z', 0, 100);
  fixColor(object, 'color');
  clip(object, 'label', 24);
  clip(object, 'text', 60);
  fixBoolean(object, 'tappable');
  fixAnim(object);
}

function fixScene(scene: Json, tapTargets: ReadonlySet<string>): void {
  if (typeof scene.theme === 'string' && !(SCENE_THEMES as readonly string[]).includes(scene.theme.trim())) delete scene.theme;
  if ('gradient' in scene) {
    const gradient = Array.isArray(scene.gradient) ? scene.gradient.map(toHexColor) : [];
    if (gradient.length === 2 && gradient.every((color) => color !== undefined)) scene.gradient = gradient;
    else delete scene.gradient;
  }
  if (!Array.isArray(scene.objects)) return;
  let objects = scene.objects as unknown[];
  for (const object of objects) if (isObject(object)) fixSceneObject(object);
  if (objects.length > MAX_SCENE_OBJECTS) {
    // Too many: decoration goes first, tap targets stay.
    const isTarget = (object: unknown): boolean => isObject(object) && typeof object.id === 'string' && tapTargets.has(object.id);
    const keep = new Set([...objects.filter(isTarget), ...objects.filter((object) => !isTarget(object))].slice(0, MAX_SCENE_OBJECTS));
    objects = objects.filter((object) => keep.has(object));
  }
  scene.objects = objects;
}

function fixInteraction(interaction: Json): void {
  if (interaction.kind === 'number') {
    const answer = toNumber(interaction.answer);
    if (answer !== undefined) interaction.answer = answer;
    const tolerance = toNumber(interaction.tolerance);
    if (tolerance !== undefined) interaction.tolerance = Math.max(0, tolerance);
    fixBoolean(interaction, 'allowDecimal');
    fixBoolean(interaction, 'allowNegative');
  }
  if (interaction.kind === 'choice') fixBoolean(interaction, 'multi');
  if (interaction.kind === 'order') {
    clip(interaction, 'startLabel', 24);
    clip(interaction, 'endLabel', 24);
  }
}

/** Repairs harmless slips in raw challenge JSON. Returns a new object; never throws. */
export function relaxChallengeJson(raw: Record<string, unknown>): Record<string, unknown> {
  try {
    const out = withoutNulls(raw) as Json;
    if (Array.isArray(out.hints) && out.hints.length > 2) out.hints = out.hints.slice(0, 2);
    if (typeof out.funFact === 'string' && out.funFact.trim() === '') delete out.funFact;
    const interaction = isObject(out.interaction) ? out.interaction : undefined;
    if (interaction) fixInteraction(interaction);
    const targets = new Set(
      interaction?.kind === 'tap' && Array.isArray(interaction.targetIds)
        ? interaction.targetIds.filter((id): id is string => typeof id === 'string')
        : [],
    );
    if (isObject(out.scene)) fixScene(out.scene, targets);
    return out;
  } catch {
    return raw;
  }
}
