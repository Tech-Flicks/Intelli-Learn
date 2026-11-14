/**
 * Zod schemas for everything the AI is allowed to return.
 *
 * The AI describes; the app draws. Nothing in these schemas is executable.
 * Every AI response is parsed with one of these schemas before it is stored
 * or shown, and rejected (then retried or replaced by offline content) when it
 * does not match.
 *
 * Coordinates are percentages of the stage: x 0 (left) .. 100 (right),
 * y 0 (top) .. 100 (bottom). Sizes are a percentage of the smaller stage side.
 */
import { z } from 'zod';

const shortText = (max: number) => z.string().trim().min(1).max(max);
const emoji = z.string().trim().min(1).max(16);
const idText = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'ids may only contain letters, digits, _ and -');
const color = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'colors must be hex like #ff8800');

// ---------------------------------------------------------------------------
// Scene: declarative canvas artwork and animation
// ---------------------------------------------------------------------------

export const SCENE_THEMES = [
  'space',
  'ocean',
  'forest',
  'lab',
  'city',
  'farm',
  'sky',
  'desert',
  'arctic',
  'workshop',
  'jungle',
  'castle',
  'kitchen',
  'playground',
  'plain',
] as const;
export type SceneTheme = (typeof SCENE_THEMES)[number];

export const SHAPES = [
  'circle',
  'square',
  'rect',
  'triangle',
  'star',
  'hexagon',
  'pentagon',
  'diamond',
  'heart',
  'oval',
  'arrow',
  'cloud',
] as const;
export type ShapeName = (typeof SHAPES)[number];

export const ANIMATIONS = [
  'none',
  'bounce',
  'spin',
  'float',
  'pulse',
  'wiggle',
  'grow',
  'fade-in',
  'slide-in',
  'move', // moves to (toX, toY) and back when loop is true
  'orbit', // circles around its own start point
] as const;
export type AnimationName = (typeof ANIMATIONS)[number];

export const SceneAnimSchema = z.object({
  kind: z.enum(ANIMATIONS),
  /** seconds for one cycle */
  duration: z.number().min(0.2).max(30).default(2),
  /** seconds before the animation starts */
  delay: z.number().min(0).max(30).default(0),
  loop: z.boolean().default(true),
  toX: z.number().min(-20).max(120).optional(),
  toY: z.number().min(-20).max(120).optional(),
});
export type SceneAnim = z.infer<typeof SceneAnimSchema>;

/** Maximum length of an AI-written SVG drawing, in characters. */
export const MAX_SVG_LENGTH = 6000;

export const SceneObjectSchema = z.object({
  id: idText,
  type: z.enum(['emoji', 'shape', 'text', 'svg']),
  /** type = emoji */
  emoji: emoji.optional(),
  /** type = shape */
  shape: z.enum(SHAPES).optional(),
  /** type = text */
  text: z.string().trim().max(60).optional(),
  /**
   * type = svg: one complete, self-contained `<svg viewBox=...>` element.
   * It is sanitized before drawing: scripts, event handlers, external
   * references and foreignObject are removed.
   */
  svg: z.string().max(MAX_SVG_LENGTH).optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  size: z.number().min(2).max(80).default(12),
  color: color.optional(),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0.1).max(1).default(1),
  /** draw order; higher is on top */
  z: z.number().min(0).max(100).default(1),
  /** short caption drawn under the object */
  label: z.string().trim().max(24).optional(),
  tappable: z.boolean().default(false),
  anim: SceneAnimSchema.optional(),
});
export type SceneObject = z.infer<typeof SceneObjectSchema>;

export const MAX_SCENE_OBJECTS = 30;

export const SceneSchema = z.object({
  theme: z.enum(SCENE_THEMES).default('plain'),
  /** optional two-color vertical gradient that replaces the theme background colors */
  gradient: z.tuple([color, color]).optional(),
  objects: z.array(SceneObjectSchema).max(MAX_SCENE_OBJECTS).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------------------------------------------------------------------------
// Interactions: how the child answers. Each has a deterministic checker.
// ---------------------------------------------------------------------------

const labelled = {
  label: shortText(80),
  emoji: emoji.optional(),
};

/** Pick one option (or several when `multi` is true). */
export const ChoiceInteractionSchema = z.object({
  kind: z.literal('choice'),
  multi: z.boolean().default(false),
  options: z
    .array(
      z.object({
        id: idText,
        ...labelled,
        /** For wrong options: the likely misunderstanding behind choosing it, as kind feedback to the child. */
        misconception: z.string().trim().max(200).optional(),
      }),
    )
    .min(2)
    .max(6),
  correctIds: z.array(idText).min(1).max(6),
});

/** Tap every scene object listed in targetIds. Those objects must exist in the scene with tappable = true. */
export const TapInteractionSchema = z.object({
  kind: z.literal('tap'),
  targetIds: z.array(idText).min(1).max(20),
});

/** Drag each item into the right bin. */
export const SortInteractionSchema = z.object({
  kind: z.literal('sort'),
  bins: z.array(z.object({ id: idText, ...labelled })).min(2).max(4),
  items: z
    .array(z.object({ id: idText, ...labelled, binId: idText }))
    .min(2)
    .max(10),
});

/** Connect each left item with its right partner. */
export const MatchInteractionSchema = z.object({
  kind: z.literal('match'),
  pairs: z
    .array(
      z.object({
        id: idText,
        left: z.object(labelled),
        right: z.object(labelled),
      }),
    )
    .min(2)
    .max(6),
});

/** Put the items in order. `items` is given in the CORRECT order; the app shuffles them. */
export const OrderInteractionSchema = z.object({
  kind: z.literal('order'),
  items: z.array(z.object({ id: idText, ...labelled })).min(3).max(7),
  /** Labels shown at the two ends, e.g. "first" / "last" or "smallest" / "biggest". */
  startLabel: z.string().trim().max(24).default('first'),
  endLabel: z.string().trim().max(24).default('last'),
});

/** Type a number. */
export const NumberInteractionSchema = z.object({
  kind: z.literal('number'),
  answer: z.number().finite(),
  /** Accept answers within +/- tolerance. 0 for exact. */
  tolerance: z.number().min(0).default(0),
  unit: z.string().trim().max(16).optional(),
  /** Whether the keypad offers a decimal point and a minus sign. */
  allowDecimal: z.boolean().default(false),
  allowNegative: z.boolean().default(false),
});

const cell = z.object({ x: z.number().int().min(0).max(7), y: z.number().int().min(0).max(7) });

export const ROBOT_COMMANDS = ['forward', 'left', 'right', 'repeat'] as const;
export type RobotCommand = (typeof ROBOT_COMMANDS)[number];

/**
 * Robot Coder. The child arranges commands to drive the robot from start to
 * goal without hitting walls, collecting every gem on the way. Any program
 * that achieves this within maxCommands is correct. (0,0) is the top-left
 * cell. dir is the direction the robot faces at the start.
 */
export const RobotInteractionSchema = z.object({
  kind: z.literal('robot'),
  cols: z.number().int().min(3).max(8),
  rows: z.number().int().min(3).max(8),
  start: cell.extend({ dir: z.enum(['up', 'right', 'down', 'left']) }),
  goal: cell,
  walls: z.array(cell).max(30).default([]),
  gems: z.array(cell).max(6).default([]),
  /** Which blocks the child may use. 'repeat' wraps a block and repeats it 2-5 times. */
  allowed: z.array(z.enum(ROBOT_COMMANDS)).min(1).max(4),
  maxCommands: z.number().int().min(2).max(24),
  robotEmoji: emoji.default('🤖'),
  goalEmoji: emoji.default('🏁'),
});

/**
 * Invention Workshop. The child picks parts. A selection is correct when the
 * summed `power` is at least `target` and the summed `cost` is at most `budget`.
 */
export const BuildInteractionSchema = z.object({
  kind: z.literal('build'),
  /** e.g. "a bridge that holds 10 kg" */
  goalLabel: shortText(100),
  /** e.g. "strength" */
  powerLabel: shortText(24),
  /** e.g. "coins" */
  costLabel: shortText(24),
  target: z.number().min(1).max(10000),
  budget: z.number().min(1).max(10000),
  parts: z
    .array(
      z.object({
        id: idText,
        ...labelled,
        power: z.number().min(0).max(10000),
        cost: z.number().min(0).max(10000),
      }),
    )
    .min(3)
    .max(8),
});

export const InteractionSchema = z.discriminatedUnion('kind', [
  ChoiceInteractionSchema,
  TapInteractionSchema,
  SortInteractionSchema,
  MatchInteractionSchema,
  OrderInteractionSchema,
  NumberInteractionSchema,
  RobotInteractionSchema,
  BuildInteractionSchema,
]);
export type Interaction = z.infer<typeof InteractionSchema>;
export type ChoiceInteraction = z.infer<typeof ChoiceInteractionSchema>;
export type TapInteraction = z.infer<typeof TapInteractionSchema>;
export type SortInteraction = z.infer<typeof SortInteractionSchema>;
export type MatchInteraction = z.infer<typeof MatchInteractionSchema>;
export type OrderInteraction = z.infer<typeof OrderInteractionSchema>;
export type NumberInteraction = z.infer<typeof NumberInteractionSchema>;
export type RobotInteraction = z.infer<typeof RobotInteractionSchema>;
export type BuildInteraction = z.infer<typeof BuildInteractionSchema>;

// ---------------------------------------------------------------------------
// Challenge
// ---------------------------------------------------------------------------

export const TeachBackSchema = z.object({
  /** e.g. "Can you teach Pip why 3 + 4 makes 7?" */
  prompt: shortText(200),
  options: z
    .array(z.object({ id: idText, label: shortText(160), correct: z.boolean() }))
    .min(2)
    .max(3),
});
export type TeachBack = z.infer<typeof TeachBackSchema>;

export const ChallengeSchema = z.object({
  title: shortText(60),
  /** One or two sentences that set the scene and hook the child. */
  intro: shortText(400),
  /** The actual question or task. */
  question: shortText(300),
  /** The intro and question rewritten for text-to-speech: no symbols, numbers as words where natural. */
  readAloud: shortText(700),
  interaction: InteractionSchema,
  /** [nudge, stronger hint]. Neither may state the answer. */
  hints: z.tuple([shortText(240), shortText(300)]),
  /** Full worked solution in 2 to 6 small steps, each one short sentence. */
  walkthrough: z.array(shortText(240)).min(2).max(6),
  /** One or two sentences on why the answer is right, shown after solving. */
  explanation: shortText(400),
  teachBack: TeachBackSchema.optional(),
  /** A surprising, true, age-appropriate fact related to the topic. */
  funFact: z.string().trim().max(240).optional(),
  scene: SceneSchema,
});
export type Challenge = z.infer<typeof ChallengeSchema>;

// ---------------------------------------------------------------------------
// Other AI outputs
// ---------------------------------------------------------------------------

/** The helper bot's reply while tutoring. */
export const TutorReplySchema = z.object({
  /** What the helper says: at most three short sentences. */
  say: shortText(500),
  /** Scene object ids to highlight while speaking. */
  highlightIds: z.array(idText).max(8).default([]),
  /** True when the child asked about something unrelated and was redirected. */
  redirected: z.boolean().default(false),
});
export type TutorReply = z.infer<typeof TutorReplySchema>;

export const StoryOutlineSchema = z.object({
  title: shortText(80),
  chapters: z
    .array(
      z.object({
        heading: shortText(60),
        /** Two to five sentences. Ends at a moment where the hero needs to solve a problem. */
        narrative: shortText(700),
        /** One sentence describing the picture for this chapter. */
        illustration: shortText(200),
      }),
    )
    .min(2)
    .max(5),
  /** Happy ending shown after the last chapter is solved. */
  ending: shortText(500),
});
export type StoryOutline = z.infer<typeof StoryOutlineSchema>;

export const LearnerNotesSchema = z.object({
  summary: shortText(500),
  strengths: z.array(shortText(160)).max(5).default([]),
  struggles: z.array(shortText(160)).max(5).default([]),
  nextFocus: z.array(shortText(160)).max(5).default([]),
});
export type LearnerNotesOutput = z.infer<typeof LearnerNotesSchema>;

export const WeeklyReportSchema = z.object({
  headline: shortText(160),
  highlights: z.array(shortText(240)).min(1).max(5),
  struggles: z.array(shortText(240)).max(4).default([]),
  /** Screen-free activities the parent and child can try together. */
  homeActivities: z.array(shortText(300)).min(1).max(4),
});
export type WeeklyReportOutput = z.infer<typeof WeeklyReportSchema>;

export const SafetyVerdictSchema = z.object({
  safe: z.boolean(),
  reason: z.string().trim().max(200).default(''),
});
export type SafetyVerdict = z.infer<typeof SafetyVerdictSchema>;
