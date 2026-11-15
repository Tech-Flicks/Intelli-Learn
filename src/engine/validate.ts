/**
 * Semantic checks the zod schema cannot express. Pure logic.
 *
 * Call `normalizeChallenge` first: it repairs what can be repaired safely, so
 * that only real problems are reported here.
 */
import { MAX_SCENE_OBJECTS } from '@/core/schemas';
import type {
  BuildInteraction,
  Challenge,
  ChoiceInteraction,
  MatchInteraction,
  NumberInteraction,
  OrderInteraction,
  RobotInteraction,
  Scene,
  SceneObject,
  SortInteraction,
  TapInteraction,
  TeachBack,
} from '@/core/schemas';
import { buildIsSolvable, buildIsTrivial } from './build';
import { cellKey, robotFitsBudget } from './robot';
import { signatureOf } from './shuffle';
import { sanitizeSvg } from './svg';

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

function reportDuplicates(problems: string[], what: string, ids: readonly string[]): void {
  const dup = duplicates(ids);
  if (dup.length > 0) problems.push(`${what} must be unique, but these repeat: ${dup.join(', ')}`);
}

function validateScene(scene: Scene, problems: string[]): void {
  if (scene.objects.length > MAX_SCENE_OBJECTS) {
    problems.push(`the scene has ${scene.objects.length} objects, the maximum is ${MAX_SCENE_OBJECTS}`);
  }
  reportDuplicates(
    problems,
    'scene object ids',
    scene.objects.map((o) => o.id),
  );
  for (const obj of scene.objects) {
    switch (obj.type) {
      case 'emoji':
        if (!obj.emoji || obj.emoji.trim() === '') problems.push(`scene object "${obj.id}" has type emoji but no emoji`);
        break;
      case 'shape':
        if (!obj.shape) problems.push(`scene object "${obj.id}" has type shape but no shape`);
        break;
      case 'text':
        if (!obj.text || obj.text.trim() === '') problems.push(`scene object "${obj.id}" has type text but no text`);
        break;
      case 'svg':
        if (!obj.svg || obj.svg.trim() === '') {
          problems.push(`scene object "${obj.id}" has type svg but no svg`);
        } else if (typeof document !== 'undefined' && sanitizeSvg(obj.svg) === null) {
          problems.push(`scene object "${obj.id}" has an svg drawing that is not a single safe <svg> with a viewBox`);
        }
        break;
      default:
        problems.push(`scene object "${obj.id}" has an unknown type`);
    }
    if (obj.anim?.kind === 'move' && obj.anim.toX === undefined && obj.anim.toY === undefined) {
      problems.push(`scene object "${obj.id}" has a move animation without toX or toY`);
    }
  }
}

function validateChoice(i: ChoiceInteraction, problems: string[]): void {
  const optionIds = i.options.map((o) => o.id);
  reportDuplicates(problems, 'choice option ids', optionIds);
  reportDuplicates(problems, 'choice correctIds', i.correctIds);
  const known = new Set(optionIds);
  const unknown = i.correctIds.filter((id) => !known.has(id));
  if (unknown.length > 0) problems.push(`choice correctIds are not options: ${unknown.join(', ')}`);
  const distinctCorrect = new Set(i.correctIds.filter((id) => known.has(id)));
  if (!i.multi && new Set(i.correctIds).size > 1) {
    problems.push('choice has several correct ids but multi is false');
  }
  if (distinctCorrect.size > 0 && distinctCorrect.size === known.size) {
    problems.push('every choice option is correct, so there is nothing to decide');
  }
  const looks = i.options.map((o) => signatureOf(o));
  if (new Set(looks).size !== looks.length) problems.push('two choice options look exactly the same');
}

/** Everything about a scene object that a child can see, apart from where it is. */
function lookOf(obj: SceneObject): string {
  const drawn = obj.type === 'emoji' ? obj.emoji : obj.type === 'shape' ? obj.shape : obj.type === 'text' ? obj.text : obj.svg;
  return JSON.stringify([
    obj.type,
    (drawn ?? '').trim(),
    (obj.color ?? '').toLowerCase(),
    (obj.label ?? '').trim().toLowerCase(),
    obj.size,
    ((obj.rotation % 360) + 360) % 360,
  ]);
}

function validateTap(i: TapInteraction, scene: Scene, problems: string[]): void {
  reportDuplicates(problems, 'tap targetIds', i.targetIds);
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  const targets = new Set(i.targetIds);
  for (const id of targets) {
    const obj = byId.get(id);
    if (!obj) problems.push(`tap target "${id}" is not an object in the scene`);
    else if (!obj.tappable) problems.push(`tap target "${id}" is not tappable`);
  }
  // Answers are compared by id. "Tap 3 apples" with five identical apples, three of them the
  // targets, marks a child wrong for tapping the other apples: nothing shows which ones count.
  const others = new Map<string, string>();
  for (const obj of scene.objects) {
    if (obj.tappable && !targets.has(obj.id)) others.set(lookOf(obj), obj.id);
  }
  for (const id of targets) {
    const obj = byId.get(id);
    const twin = obj ? others.get(lookOf(obj)) : undefined;
    if (twin !== undefined) {
      problems.push(
        `tap target "${id}" looks exactly like "${twin}", which can be tapped but is not a target: make every look-alike a target, or make the objects look different`,
      );
      break;
    }
  }
}

function validateSort(i: SortInteraction, problems: string[]): void {
  const binIds = i.bins.map((b) => b.id);
  reportDuplicates(problems, 'sort bin ids', binIds);
  reportDuplicates(
    problems,
    'sort item ids',
    i.items.map((item) => item.id),
  );
  const bins = new Set(binIds);
  const unknown = i.items.filter((item) => !bins.has(item.binId));
  if (unknown.length > 0) {
    problems.push(`sort items point at unknown bins: ${unknown.map((item) => `${item.id} -> ${item.binId}`).join(', ')}`);
  }
  const used = new Set(i.items.filter((item) => bins.has(item.binId)).map((item) => item.binId));
  if (unknown.length === 0 && used.size <= 1) {
    problems.push('every sort item belongs in the same bin, so there is nothing to decide');
  }
  const binLooks = i.bins.map((b) => signatureOf(b));
  if (new Set(binLooks).size !== binLooks.length) problems.push('two sort bins look exactly the same');
  // Two cards a child cannot tell apart must not need different bins.
  const binByLook = new Map<string, string>();
  for (const item of i.items) {
    const look = signatureOf(item);
    const earlier = binByLook.get(look);
    if (earlier !== undefined && earlier !== item.binId) {
      problems.push(`two sort items look exactly the same but belong in different bins ("${item.label}")`);
      break;
    }
    binByLook.set(look, item.binId);
  }
}

function validateMatch(i: MatchInteraction, problems: string[]): void {
  reportDuplicates(
    problems,
    'match pair ids',
    i.pairs.map((p) => p.id),
  );
  // Two identical left cards that need different partners cannot be told apart.
  const rightByLeft = new Map<string, string>();
  for (const pair of i.pairs) {
    const left = signatureOf(pair.left);
    const right = signatureOf(pair.right);
    const earlier = rightByLeft.get(left);
    if (earlier !== undefined && earlier !== right) {
      problems.push(`two match pairs have the same left side "${pair.left.label}" but different partners`);
      break;
    }
    rightByLeft.set(left, right);
  }
}

function validateOrder(i: OrderInteraction, problems: string[]): void {
  reportDuplicates(
    problems,
    'order item ids',
    i.items.map((item) => item.id),
  );
  if (new Set(i.items.map((item) => signatureOf(item))).size < 2) {
    problems.push('every order item looks the same, so there is nothing to arrange');
  }
}

/** Numbers written with digits inside a text, e.g. "Try 12 and 3.5" -> [12, 3.5]. */
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  // Thousands separators ("1,250") are joined; a decimal comma is not assumed.
  const cleaned = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const pattern = /\d+(?:\.\d+)?/g;
  let match: RegExpExecArray | null = pattern.exec(cleaned);
  while (match) {
    out.push(Number(match[0]));
    match = pattern.exec(cleaned);
  }
  return out;
}

/** A tolerance may be at most this share of the answer ... */
const MAX_TOLERANCE_SHARE = 0.1;
/** ... a whole-number answer below this is counted or calculated, never estimated: it is exact ... */
const EXACT_BELOW = 20;
/** ... and a decimal answer always has this much slack for rounding. */
const DECIMAL_SLACK = 0.05;

/**
 * The widest tolerance that still tells a right answer from a wrong one. On a keypad without a
 * decimal point only whole numbers can be typed, so less than 1 changes nothing there.
 */
function maxTolerance(i: NumberInteraction): number {
  const share = Math.abs(i.answer) * MAX_TOLERANCE_SHARE;
  if (i.allowDecimal) return Math.max(share, DECIMAL_SLACK);
  if (Number.isInteger(i.answer) && Math.abs(i.answer) < EXACT_BELOW) return 0.999;
  return Math.max(share, 0.999);
}

/**
 * True when the text states the number as a result ("= 4", "leaves 4", "the answer is 4",
 * "4 are left") and does not merely mention it. For a number that the question itself gives.
 */
function statesAsResult(text: string, value: number): boolean {
  const cleaned = text.toLowerCase().replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const n = String(value).replace('.', '\\.');
  const number = `(?<![\\d.])${n}(?!\\.?\\d)`;
  const lead = '(?:=\\s*|\\b(?:equals?|makes?|leaves?|gives?|gets?|answer(?:\\s+is)?|total(?:\\s+is)?|igual\\s+a|quedan?|sobran?|respuesta(?:\\s+es)?|resultado(?:\\s+es)?)\\s+)';
  const tail = '\\s+(?:[a-z]+\\s+){0,2}(?:left|remain(?:s|ing)?)\\b';
  return new RegExp(`${lead}${number}`).test(cleaned) || new RegExp(`${number}${tail}`).test(cleaned);
}

function validateNumber(i: NumberInteraction, hints: readonly string[], asked: string, problems: string[]): void {
  if (!Number.isFinite(i.answer)) {
    problems.push('the number answer is not a finite number');
    return;
  }
  if (!Number.isFinite(i.tolerance) || i.tolerance < 0) problems.push('the number tolerance must be zero or more');
  const tolerance = Number.isFinite(i.tolerance) && i.tolerance > 0 ? i.tolerance : 0;
  if (tolerance > maxTolerance(i)) {
    problems.push(
      `the number tolerance (${tolerance}) is too wide for the answer ${i.answer}: wrong answers would be marked right. Use 0 for an exact answer and a small tolerance only for measuring or estimating`,
    );
  }
  if (i.answer < 0 && !i.allowNegative && i.answer + tolerance < 0) {
    problems.push('the number answer is negative but the keypad has no minus sign (allowNegative is false)');
  }
  if (!Number.isInteger(i.answer) && !i.allowDecimal) {
    const nearest = Math.round(i.answer);
    if (Math.abs(nearest - i.answer) > tolerance) {
      problems.push('the number answer has decimals but the keypad has no decimal point (allowDecimal is false)');
    }
  }
  if (Math.abs(i.answer) >= 1e9) problems.push('the number answer is too long to type on the keypad');
  const decimals = String(i.answer).split('.')[1]?.length ?? 0;
  if (decimals > 3 && tolerance === 0) problems.push('the number answer needs more than 3 decimal places');
  // A hint may repeat a number that the question gives ("8 birds, 4 fly away": answer 4, hint
  // "take away 4"). It must not name a number the question does not give, or state the result.
  const target = Math.abs(i.answer);
  const given = numbersInText(asked).includes(target);
  hints.forEach((hint, index) => {
    if (!numbersInText(hint).includes(target)) return;
    if (!given || statesAsResult(hint, target)) {
      problems.push(`hint ${index + 1} gives away the exact answer (${i.answer})`);
    }
  });
}

function validateRobot(i: RobotInteraction, problems: string[]): void {
  const inside = (c: { x: number; y: number }): boolean => c.x >= 0 && c.y >= 0 && c.x < i.cols && c.y < i.rows;
  const walls = new Set(i.walls.map((w) => cellKey(w.x, w.y)));
  let broken = false;
  if (!inside(i.start)) {
    problems.push('the robot start is outside the grid');
    broken = true;
  } else if (walls.has(cellKey(i.start.x, i.start.y))) {
    problems.push('the robot start is on a wall');
    broken = true;
  }
  if (!inside(i.goal)) {
    problems.push('the robot goal is outside the grid');
    broken = true;
  } else if (walls.has(cellKey(i.goal.x, i.goal.y))) {
    problems.push('the robot goal is on a wall');
    broken = true;
  }
  i.gems.forEach((gem, index) => {
    if (!inside(gem)) {
      problems.push(`robot gem ${index + 1} is outside the grid`);
      broken = true;
    } else if (walls.has(cellKey(gem.x, gem.y))) {
      problems.push(`robot gem ${index + 1} is on a wall`);
      broken = true;
    }
  });
  if (i.walls.some((w) => !inside(w))) problems.push('a robot wall is outside the grid');
  reportDuplicates(
    problems,
    'robot gem cells',
    i.gems.map((g) => cellKey(g.x, g.y)),
  );
  if (!i.allowed.includes('forward')) problems.push("the robot is not allowed to use 'forward', so it can never move");
  if (broken) return;

  if (i.start.x === i.goal.x && i.start.y === i.goal.y && i.gems.every((g) => g.x === i.start.x && g.y === i.start.y)) {
    problems.push('the robot already stands on the goal, so there is nothing to solve');
    return;
  }
  const report = robotFitsBudget(i);
  if (!report.solvable) {
    problems.push('the robot maze cannot be solved with the allowed commands');
  } else if (!report.fits) {
    problems.push(
      `the shortest robot solution needs ${report.blocks} blocks but maxCommands is ${i.maxCommands}`,
    );
  }
}

function validateBuild(i: BuildInteraction, problems: string[]): void {
  reportDuplicates(
    problems,
    'build part ids',
    i.parts.map((p) => p.id),
  );
  if (!buildIsSolvable(i)) {
    problems.push('no selection of build parts reaches the target within the budget');
  } else if (buildIsTrivial(i)) {
    problems.push('picking every build part already works, so there is no decision to make');
  }
}

function validateTeachBack(teachBack: TeachBack, problems: string[]): void {
  reportDuplicates(
    problems,
    'teachBack option ids',
    teachBack.options.map((o) => o.id),
  );
  const correct = teachBack.options.filter((o) => o.correct).length;
  if (correct !== 1) problems.push(`teachBack needs exactly one correct option, found ${correct}`);
}

/** Semantic problems the zod schema cannot express. Empty array = valid. Never throws. */
export function validateChallengeContent(c: Challenge): string[] {
  const problems: string[] = [];
  try {
    validateScene(c.scene, problems);
    const i = c.interaction;
    switch (i.kind) {
      case 'choice':
        validateChoice(i, problems);
        break;
      case 'tap':
        validateTap(i, c.scene, problems);
        break;
      case 'sort':
        validateSort(i, problems);
        break;
      case 'match':
        validateMatch(i, problems);
        break;
      case 'order':
        validateOrder(i, problems);
        break;
      case 'number':
        validateNumber(i, c.hints, `${c.intro} ${c.question}`, problems);
        break;
      case 'robot':
        validateRobot(i, problems);
        break;
      case 'build':
        validateBuild(i, problems);
        break;
      default:
        problems.push('unknown interaction kind');
    }
    if (c.teachBack) validateTeachBack(c.teachBack, problems);
  } catch (error) {
    problems.push(`the challenge could not be checked: ${error instanceof Error ? error.message : 'malformed content'}`);
  }
  return problems;
}
