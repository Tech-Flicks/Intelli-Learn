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
 *
 * The repairs, by kind of slip:
 * - a wrapper (`{"challenge": {...}}`), `null` or `""` for an optional field;
 * - ids that are numbers or have spaces or accents, rewritten the same way
 *   wherever they are referred to (correctIds, binId, targetIds);
 * - enum values in another capitalisation or under a usual other name
 *   ("Rectangle", "east", "multiple_choice");
 * - numbers as text ("8", "22%"), robot cells as [x, y] pairs, booleans as text;
 * - coordinates written as fractions of 1 instead of percentages;
 * - one walkthrough step or teach-back option too many, a unit or a title
 *   that is a little too long;
 * - a teach-back question that cannot be used (it is optional: the challenge
 *   is kept without it).
 */
import { ANIMATIONS, MAX_SCENE_OBJECTS, SCENE_THEMES, TeachBackSchema } from '@/core/schemas';

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

/** A number, also when it was written as text ("8", " 22% "). */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/.exec(value);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** Turns a number that was written as text into a number. Anything else is left for the schema. */
function numberField(target: Json, ...keys: string[]): void {
  for (const key of keys) {
    if (typeof target[key] !== 'string') continue;
    const n = toNumber(target[key]);
    if (n !== undefined) target[key] = n;
  }
}

/** Removes optional fields that hold an empty string. */
function dropEmpty(target: Json, ...keys: string[]): void {
  for (const key of keys) {
    if (typeof target[key] === 'string' && (target[key] as string).trim() === '') delete target[key];
  }
}

/** Lower case and trimmed, and mapped to the schema's name when the value is a usual other name for it. */
function enumField(target: Json, key: string, aliases: Record<string, string> = {}): void {
  const value = target[key];
  if (typeof value !== 'string') return;
  const plain = value.trim().toLowerCase();
  target[key] = aliases[plain] ?? aliases[plain.replace(/[\s_-]+/g, '')] ?? plain;
}

const KIND_ALIASES: Record<string, string> = {
  multiplechoice: 'choice', singlechoice: 'choice', mcq: 'choice', select: 'choice',
  sorting: 'sort', matching: 'match', ordering: 'order', sequence: 'order', numeric: 'number', numerical: 'number',
};
const SHAPE_ALIASES: Record<string, string> = {
  rectangle: 'rect', ellipse: 'oval', rhombus: 'diamond', box: 'square', dot: 'circle', disc: 'circle', disk: 'circle',
};
const DIR_ALIASES: Record<string, string> = { east: 'right', west: 'left', north: 'up', south: 'down', e: 'right', w: 'left', n: 'up', s: 'down' };
const COMMAND_ALIASES: Record<string, string> = {
  moveforward: 'forward', move: 'forward', turnleft: 'left', turnright: 'right', loop: 'repeat',
};
const ANIM_ALIASES: Record<string, string> = { fadein: 'fade-in', slidein: 'slide-in', rotate: 'spin', shake: 'wiggle', hover: 'float' };

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const MAX_ID_LENGTH = 40;

/**
 * Rewrites the ids of one list so that they pass the schema (letters, digits, "_" and "-"):
 * numbers become text, accents are dropped, anything else becomes "-". Returns the function
 * that rewrites a reference to one of those ids the same way. Two different ids never become
 * the same id.
 */
function fixIds(items: unknown, key = 'id'): (reference: unknown) => unknown {
  const renamed = new Map<string, string>();
  const taken = new Set<string>();
  const slug = (text: string): string =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_ID_LENGTH);
  const list = Array.isArray(items) ? items : [];
  list.forEach((item, index) => {
    if (!isObject(item)) return;
    const raw = item[key];
    if (typeof raw !== 'string' && typeof raw !== 'number') return;
    const original = String(raw).trim();
    // The same id twice stays the same id twice: duplicates are the validators' business.
    let id = renamed.get(original);
    if (id === undefined) {
      const base = slug(original) || `id${index + 1}`;
      id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base.slice(0, MAX_ID_LENGTH - 3)}-${n}`;
      renamed.set(original, id);
      taken.add(id);
    }
    item[key] = id;
  });
  return (reference) => {
    if (typeof reference !== 'string' && typeof reference !== 'number') return reference;
    const original = String(reference).trim();
    return renamed.get(original) ?? original;
  };
}

function fixReferences(target: Json, key: string, rename: (reference: unknown) => unknown): void {
  const value = target[key];
  // One id where a list was asked for.
  if (typeof value === 'string' || typeof value === 'number') target[key] = [rename(value)];
  else if (Array.isArray(value)) target[key] = value.map(rename);
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

/** Cuts a title that is too long after a whole word, and not after a dangling "and the". */
function clipAtWord(target: Json, key: string, max: number): void {
  const value = target[key];
  if (typeof value !== 'string' || value.trim().length <= max) return;
  const words = value.trim().slice(0, max + 1).split(/\s+/);
  words.pop(); // the word the limit runs through (or the one after it)
  while (words.length > 2 && [...(words[words.length - 1] ?? '')].length <= 3) words.pop();
  const cut = words.join(' ').replace(/[\s,;:&-]+$/, '');
  if (cut !== '') target[key] = cut;
}

/** Cuts a text that is too long after its last whole sentence that fits. Without one it is left for the schema. */
function clipAtSentence(target: Json, key: string, max: number): void {
  const value = target[key];
  if (typeof value !== 'string' || value.trim().length <= max) return;
  const head = value.trim().slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('। '));
  if (end > 0) target[key] = head.slice(0, end + 1);
}

function fixBoolean(target: Json, key: string): void {
  const value = target[key];
  if (value === 'true') target[key] = true;
  else if (value === 'false') target[key] = false;
}

function fixAnim(object: Json): void {
  const anim = object.anim;
  if (anim === undefined) return;
  if (isObject(anim)) enumField(anim, 'kind', ANIM_ALIASES);
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
  enumField(object, 'type');
  dropEmpty(object, 'emoji', 'shape', 'text', 'svg', 'label');
  enumField(object, 'shape', SHAPE_ALIASES);
  // (A shape under a name the app does not know is left for the schema: a stand-in could change the task.)
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

/**
 * Coordinates written as fractions of the stage (0.22, 0.42) instead of percentages: every object
 * of the scene lies within 0..1 and at least one value is a fraction. Left as it is, the whole
 * scene would be drawn as one heap in the top-left corner.
 */
function fixFractions(objects: unknown[]): void {
  const placed = objects.filter(isObject);
  const position = (object: Json): [number | undefined, number | undefined] => [toNumber(object.x), toNumber(object.y)];
  const inUnit = (n: number | undefined): n is number => n !== undefined && n >= 0 && n <= 1;
  if (placed.length < 2 || !placed.every((object) => position(object).every(inUnit))) return;
  if (!placed.some((object) => position(object).some((n) => n !== undefined && !Number.isInteger(n)))) return;
  const scale = (target: Json, key: string): void => {
    const n = toNumber(target[key]);
    if (n !== undefined && n >= 0 && n <= 1) target[key] = Math.round(n * 1000) / 10;
  };
  for (const object of placed) {
    scale(object, 'x');
    scale(object, 'y');
    const size = toNumber(object.size);
    if (size !== undefined && size > 0 && size < 1) scale(object, 'size');
    if (isObject(object.anim)) {
      scale(object.anim, 'toX');
      scale(object.anim, 'toY');
    }
  }
}

function fixScene(scene: Json, tapTargets: ReadonlySet<string>): void {
  enumField(scene, 'theme');
  if (typeof scene.theme === 'string' && !(SCENE_THEMES as readonly string[]).includes(scene.theme)) delete scene.theme;
  if ('gradient' in scene) {
    const gradient = Array.isArray(scene.gradient) ? scene.gradient.map(toHexColor) : [];
    if (gradient.length === 2 && gradient.every((color) => color !== undefined)) scene.gradient = gradient;
    else delete scene.gradient;
  }
  if (!Array.isArray(scene.objects)) return;
  let objects = scene.objects as unknown[];
  fixFractions(objects);
  for (const object of objects) if (isObject(object)) fixSceneObject(object);
  if (objects.length > MAX_SCENE_OBJECTS) {
    // Too many: decoration goes first, tap targets stay.
    const isTarget = (object: unknown): boolean => isObject(object) && typeof object.id === 'string' && tapTargets.has(object.id);
    const keep = new Set([...objects.filter(isTarget), ...objects.filter((object) => !isTarget(object))].slice(0, MAX_SCENE_OBJECTS));
    objects = objects.filter((object) => keep.has(object));
  }
  scene.objects = objects;
}

/** `{ "x": 1, "y": 2 }` for a cell that was written as `[1, 2]`, with numbers that were written as text. */
function fixCell(cell: unknown): unknown {
  if (Array.isArray(cell) && cell.length === 2) {
    const [x, y] = cell.map(toNumber);
    if (x !== undefined && y !== undefined) return { x, y };
  }
  if (isObject(cell)) numberField(cell, 'x', 'y');
  return cell;
}

function fixLabelled(items: unknown): void {
  if (!Array.isArray(items)) return;
  for (const item of items) if (isObject(item)) dropEmpty(item, 'emoji');
}

/** The unit is a short keypad label (max 16). One that does not fit is dropped: the question names the unit anyway. */
const MAX_UNIT_LENGTH = 16;

function fixInteraction(interaction: Json, scene: Json | undefined): void {
  enumField(interaction, 'kind', KIND_ALIASES);
  if (interaction.kind === 'number') {
    const answer = toNumber(interaction.answer);
    if (answer !== undefined) interaction.answer = answer;
    const tolerance = toNumber(interaction.tolerance);
    if (tolerance !== undefined) interaction.tolerance = Math.max(0, tolerance);
    fixBoolean(interaction, 'allowDecimal');
    fixBoolean(interaction, 'allowNegative');
    dropEmpty(interaction, 'unit');
    if (typeof interaction.unit === 'string' && interaction.unit.trim().length > MAX_UNIT_LENGTH) delete interaction.unit;
  }
  if (interaction.kind === 'choice') {
    fixBoolean(interaction, 'multi');
    fixLabelled(interaction.options);
    for (const option of Array.isArray(interaction.options) ? interaction.options : []) {
      if (!isObject(option)) continue;
      dropEmpty(option, 'misconception');
      clipAtSentence(option, 'misconception', 200);
    }
    fixReferences(interaction, 'correctIds', fixIds(interaction.options));
  }
  if (interaction.kind === 'tap') fixReferences(interaction, 'targetIds', fixIds(scene?.objects));
  else fixIds(scene?.objects);
  if (interaction.kind === 'sort') {
    fixLabelled(interaction.bins);
    fixLabelled(interaction.items);
    const rename = fixIds(interaction.bins);
    fixIds(interaction.items);
    for (const item of Array.isArray(interaction.items) ? interaction.items : []) {
      if (isObject(item) && 'binId' in item) item.binId = rename(item.binId);
    }
  }
  if (interaction.kind === 'match') {
    fixIds(interaction.pairs);
    for (const pair of Array.isArray(interaction.pairs) ? interaction.pairs : []) {
      if (isObject(pair)) fixLabelled([pair.left, pair.right]);
    }
  }
  if (interaction.kind === 'order') {
    fixLabelled(interaction.items);
    fixIds(interaction.items);
    dropEmpty(interaction, 'startLabel', 'endLabel');
    clip(interaction, 'startLabel', 24);
    clip(interaction, 'endLabel', 24);
  }
  if (interaction.kind === 'robot') {
    numberField(interaction, 'cols', 'rows', 'maxCommands');
    if (isObject(interaction.start)) {
      numberField(interaction.start, 'x', 'y');
      enumField(interaction.start, 'dir', DIR_ALIASES);
    }
    interaction.goal = fixCell(interaction.goal);
    if (Array.isArray(interaction.walls)) interaction.walls = interaction.walls.map(fixCell);
    if (Array.isArray(interaction.gems)) interaction.gems = interaction.gems.map(fixCell);
    if (Array.isArray(interaction.allowed)) {
      interaction.allowed = interaction.allowed.map((command: unknown) => {
        const holder: Json = { command };
        enumField(holder, 'command', COMMAND_ALIASES);
        return holder.command;
      });
    }
    dropEmpty(interaction, 'robotEmoji', 'goalEmoji');
  }
  if (interaction.kind === 'build') {
    numberField(interaction, 'target', 'budget');
    fixLabelled(interaction.parts);
    fixIds(interaction.parts);
    for (const part of Array.isArray(interaction.parts) ? interaction.parts : []) if (isObject(part)) numberField(part, 'power', 'cost');
  }
}

const MAX_WALKTHROUGH_STEPS = 6;
const MAX_STEP_LENGTH = 240;

/**
 * A walkthrough with a step or two too many: the two shortest neighbouring steps become one,
 * so no step is lost. The last step is never merged: it is the one that hands over to the child.
 */
function fixWalkthrough(out: Json): void {
  if (!Array.isArray(out.walkthrough) || !out.walkthrough.every((step) => typeof step === 'string')) return;
  const steps = (out.walkthrough as string[]).map((step) => step.trim());
  while (steps.length > MAX_WALKTHROUGH_STEPS) {
    let best = -1;
    for (let i = 0; i < steps.length - 2; i += 1) {
      const joined = (steps[i]?.length ?? 0) + (steps[i + 1]?.length ?? 0) + 1;
      if (joined <= MAX_STEP_LENGTH && (best < 0 || joined < (steps[best]?.length ?? 0) + (steps[best + 1]?.length ?? 0) + 1)) best = i;
    }
    if (best < 0) return; // nothing can be merged: the schema reports it
    steps.splice(best, 2, `${steps[best]} ${steps[best + 1]}`);
  }
  out.walkthrough = steps;
}

const MAX_TEACHBACK_OPTIONS = 3;

/**
 * The teach-back question is optional. Its small slips are repaired (booleans as text, ids, one
 * option too many); one that still cannot be used is given up, and the challenge is kept.
 */
function fixTeachBack(out: Json): void {
  if (!('teachBack' in out)) return;
  const teachBack = out.teachBack;
  if (isObject(teachBack) && Array.isArray(teachBack.options)) {
    for (const option of teachBack.options) if (isObject(option)) fixBoolean(option, 'correct');
    fixIds(teachBack.options);
    const options = teachBack.options.filter(isObject);
    const right = options.filter((option) => option.correct === true);
    if (right.length === 1 && options.length > MAX_TEACHBACK_OPTIONS) {
      const wrong = options.filter((option) => option.correct !== true).slice(0, MAX_TEACHBACK_OPTIONS - 1);
      teachBack.options = options.filter((option) => option === right[0] || wrong.includes(option));
    }
    const parsed = TeachBackSchema.safeParse(teachBack);
    if (parsed.success && parsed.data.options.filter((option) => option.correct).length === 1) return;
  }
  delete out.teachBack;
}

/** The challenge itself when the model wrapped it in one outer key (`{"challenge": {...}}`). */
function unwrap(raw: Json): Json {
  const keys = Object.keys(raw);
  const inner = keys.length === 1 ? raw[keys[0] as string] : undefined;
  return isObject(inner) && 'interaction' in inner && 'title' in inner ? inner : raw;
}

/** Repairs harmless slips in raw challenge JSON. Returns a new object; never throws. */
export function relaxChallengeJson(raw: Record<string, unknown>): Record<string, unknown> {
  try {
    const out = withoutNulls(unwrap(raw)) as Json;
    if (Array.isArray(out.hints) && out.hints.length > 2) out.hints = out.hints.slice(0, 2);
    if (typeof out.funFact === 'string' && out.funFact.trim() === '') delete out.funFact;
    clipAtWord(out, 'title', 60);
    fixWalkthrough(out);
    fixTeachBack(out);
    const interaction = isObject(out.interaction) ? out.interaction : undefined;
    if (interaction) fixInteraction(interaction, isObject(out.scene) ? out.scene : undefined);
    else if (isObject(out.scene)) fixIds(out.scene.objects);
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
