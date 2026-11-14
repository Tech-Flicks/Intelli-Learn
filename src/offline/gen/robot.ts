/**
 * Robot Coder mazes. The path is carved first and walls are only placed off the path, so every
 * maze has a solution. The allowed command budget is the shortest plain solution plus some slack.
 */
import type { Challenge, RobotInteraction } from '@/core/schemas';
import { RobotInteractionSchema } from '@/core/schemas';
import { assemble } from '../assemble';
import { solveMaze } from '../check';
import { lead, say, type Ctx } from '../context';
import { cardScene, type Card } from '../scene';
import { numberWords } from '../speak';

type Dir = 'up' | 'right' | 'down' | 'left';
const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

interface Level {
  cols: number;
  rows: number;
  segments: [number, number];
  maxSegment: number;
  gems: [number, number];
  walls: [number, number];
  repeat: boolean;
  turns: boolean;
}

/** One level per grade, Pre-K to Grade 8. */
const LEVELS: readonly Level[] = [
  { cols: 3, rows: 3, segments: [1, 1], maxSegment: 2, gems: [0, 0], walls: [0, 1], repeat: false, turns: false },
  { cols: 4, rows: 3, segments: [2, 2], maxSegment: 2, gems: [0, 0], walls: [1, 2], repeat: false, turns: true },
  { cols: 4, rows: 4, segments: [2, 2], maxSegment: 3, gems: [0, 1], walls: [2, 3], repeat: false, turns: true },
  { cols: 5, rows: 4, segments: [2, 3], maxSegment: 3, gems: [1, 1], walls: [3, 4], repeat: true, turns: true },
  { cols: 5, rows: 5, segments: [3, 3], maxSegment: 4, gems: [1, 1], walls: [4, 5], repeat: true, turns: true },
  { cols: 6, rows: 5, segments: [3, 4], maxSegment: 4, gems: [1, 2], walls: [5, 7], repeat: true, turns: true },
  { cols: 6, rows: 6, segments: [3, 4], maxSegment: 4, gems: [2, 2], walls: [6, 8], repeat: true, turns: true },
  { cols: 7, rows: 6, segments: [4, 4], maxSegment: 4, gems: [2, 2], walls: [8, 10], repeat: true, turns: true },
  { cols: 7, rows: 7, segments: [4, 5], maxSegment: 4, gems: [2, 3], walls: [10, 12], repeat: true, turns: true },
  { cols: 8, rows: 8, segments: [4, 5], maxSegment: 4, gems: [3, 3], walls: [12, 14], repeat: true, turns: true },
];

/** [mover emoji, mover name, goal emoji, goal name] per theme key. */
const CAST: Record<string, readonly [string, string, string, string]> = {
  space: ['🚀', 'rocket', '🪐', 'planet'],
  animals: ['🐶', 'puppy', '🦴', 'bone'],
  dinosaurs: ['🦖', 'dinosaur', '🥚', 'egg'],
  robots: ['🤖', 'robot', '🔋', 'battery'],
  ocean: ['🐢', 'turtle', '🐚', 'shell'],
  cooking: ['🐭', 'mouse', '🧀', 'cheese'],
  sports: ['🏃', 'runner', '🏆', 'trophy'],
  music: ['🧑‍🎤', 'singer', '🎤', 'microphone'],
  'cars and trains': ['🚗', 'car', '🏁', 'finish line'],
  superheroes: ['🦸', 'hero', '🏙️', 'city'],
  nature: ['🐝', 'bee', '🌸', 'flower'],
  building: ['🚜', 'digger', '🏠', 'house'],
  art: ['🖌️', 'paintbrush', '🎨', 'paint'],
  'video games': ['👾', 'pixel hero', '🗝️', 'key'],
  'fairy tales': ['🧚', 'fairy', '🏰', 'castle'],
  weather: ['☁️', 'cloud', '🌈', 'rainbow'],
  garden: ['🐝', 'bee', '🌻', 'sunflower'],
  toys: ['🚂', 'toy train', '🧸', 'teddy bear'],
  farm: ['🐔', 'hen', '🌽', 'corn'],
};

const STRAND_NOTE: Record<string, { explain: string; fun: string }> = {
  technology: { explain: 'This is exactly what a programmer does.', fun: 'A computer program is a list of instructions that a computer follows in order.' },
  logic: { explain: 'Planning the whole route before you move is called thinking ahead.', fun: 'Chess players plan several moves ahead in the same way.' },
  math: { explain: 'Counting the squares on each straight part gives the number of forward moves.', fun: 'A quarter turn is the same as a turn of 90 degrees.' },
  science: { explain: 'Scientists steer rovers on other worlds with lists of commands like these.', fun: 'Rovers on Mars are driven by lists of commands sent from Earth.' },
  engineering: { explain: 'Engineers program robots in factories with step-by-step commands like these.', fun: 'Warehouse robots follow planned routes so they never bump into each other.' },
};

interface Maze {
  interaction: RobotInteraction;
  solution: ('forward' | 'left' | 'right')[];
}

function carve(ctx: Ctx, level: Level, wantLongRuns: boolean): Maze | null {
  const { rng } = ctx;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < level.cols && y < level.rows;
  let x = rng.int(0, level.cols - 1);
  let y = rng.int(0, level.rows - 1);
  let d = rng.int(0, 3);
  const start = { x, y };
  const path = new Set<string>([`${x},${y}`]);
  const cells: { x: number; y: number }[] = [{ x, y }];
  const segments = rng.int(level.segments[0], level.segments[1]);
  const room = (dir: number): number => {
    let steps = 0;
    let cx = x + (DX[dir] as number);
    let cy = y + (DY[dir] as number);
    while (inside(cx, cy) && !path.has(`${cx},${cy}`)) {
      steps += 1;
      cx += DX[dir] as number;
      cy += DY[dir] as number;
    }
    return steps;
  };
  // Face a direction with room for the first segment.
  const open = [0, 1, 2, 3].filter((dir) => room(dir) >= (level.turns ? 1 : 2));
  if (open.length === 0) return null;
  d = rng.pick(open);
  const startDir = d;
  for (let s = 0; s < segments; s += 1) {
    const free = room(d);
    if (free < 1) return null;
    const least = level.turns ? (wantLongRuns ? Math.min(free, 2) : 1) : 2;
    const most = Math.min(free, level.maxSegment);
    if (most < least) return null;
    const length = rng.int(least, most);
    for (let k = 0; k < length; k += 1) {
      x += DX[d] as number;
      y += DY[d] as number;
      path.add(`${x},${y}`);
      cells.push({ x, y });
    }
    if (s < segments - 1) {
      const turns = [(d + 1) % 4, (d + 3) % 4].filter((dir) => room(dir) >= 1);
      if (turns.length === 0) return null;
      d = rng.pick(turns);
    }
  }
  const goal = { x, y };
  if (goal.x === start.x && goal.y === start.y) return null;

  const inner = cells.slice(1, -1);
  const gemCount = Math.min(inner.length, rng.int(level.gems[0], level.gems[1]));
  const gems = rng.sample(inner, gemCount);

  const offPath: { x: number; y: number }[] = [];
  for (let cy = 0; cy < level.rows; cy += 1) {
    for (let cx = 0; cx < level.cols; cx += 1) {
      if (!path.has(`${cx},${cy}`)) offPath.push({ x: cx, y: cy });
    }
  }
  const walls = rng.sample(offPath, Math.min(offPath.length, rng.int(level.walls[0], level.walls[1])));

  // Older children sometimes start facing the wrong way, so the first command is a turn.
  const facing = level.turns && ctx.g >= 4 && rng.chance(0.35) ? rng.pick([(startDir + 1) % 4, (startDir + 3) % 4]) : startDir;
  const allowed: RobotInteraction['allowed'] = level.turns ? ['forward', 'left', 'right'] : ['forward'];
  const cast = CAST[ctx.theme.key] ?? (CAST.robots as readonly [string, string, string, string]);
  const draft = {
    kind: 'robot' as const,
    cols: level.cols,
    rows: level.rows,
    start: { ...start, dir: DIRS[facing] as Dir },
    goal,
    walls,
    gems,
    allowed,
    maxCommands: 24,
    robotEmoji: cast[0],
    goalEmoji: cast[2],
  };
  const parsed = RobotInteractionSchema.safeParse(draft);
  if (!parsed.success) return null;
  const solution = solveMaze(parsed.data);
  if (!solution || solution.length < 2 || solution.length > 20) return null;
  return { interaction: parsed.data, solution };
}

/** "forward, forward, left, forward" -> ["Go forward 2 times.", "Turn left.", "Go forward 1 time."] */
export function describeProgram(moves: readonly string[]): string[] {
  const out: string[] = [];
  let run = 0;
  const flush = (): void => {
    if (run > 0) out.push(`Go forward ${run} ${run === 1 ? 'time' : 'times'}.`);
    run = 0;
  };
  for (const move of moves) {
    if (move === 'forward') run += 1;
    else {
      flush();
      out.push(move === 'left' ? 'Turn left.' : 'Turn right.');
    }
  }
  flush();
  return out;
}

/** Squeezes a list of steps into at most `max` lines by joining neighbours. */
function squeeze(steps: string[], max: number): string[] {
  const out = steps.slice();
  while (out.length > max) {
    let best = 0;
    for (let i = 1; i < out.length - 1; i += 1) {
      if ((out[i] as string).length + (out[i + 1] as string).length < (out[best] as string).length + (out[best + 1] as string).length) best = i;
    }
    out.splice(best, 2, `${out[best] as string} ${out[best + 1] as string}`);
  }
  return out;
}

export function robotChallenge(ctx: Ctx): Challenge | null {
  const loopsSkill = ctx.plan.skillId === 'technology-loops';
  const base = LEVELS[ctx.g] ?? (LEVELS[LEVELS.length - 1] as Level);
  const level: Level = loopsSkill && ctx.g >= 1 ? { ...base, repeat: true, maxSegment: Math.max(base.maxSegment, 3) } : base;
  let maze: Maze | null = null;
  for (let attempt = 0; attempt < 60 && !maze; attempt += 1) maze = carve(ctx, level, loopsSkill);
  if (!maze) return null;

  const shortest = maze.solution.length;
  const slack = ctx.g <= 1 ? 1 : ctx.g <= 4 ? 2 : 3;
  const allowed: RobotInteraction['allowed'] = level.repeat ? [...maze.interaction.allowed, 'repeat'] : maze.interaction.allowed;
  const interaction: RobotInteraction = { ...maze.interaction, allowed, maxCommands: Math.max(2, Math.min(24, shortest + slack)) };

  const cast = CAST[ctx.theme.key] ?? (CAST.robots as readonly [string, string, string, string]);
  const [moverEmoji, mover, goalEmoji, goal] = cast;
  const gemCount = interaction.gems.length;
  const debugging = ctx.plan.skillId === 'technology-debugging';
  const note = STRAND_NOTE[ctx.plan.strand] ?? (STRAND_NOTE.technology as { explain: string; fun: string });
  const steps = describeProgram(maze.solution);
  const reach = `That reaches the ${goal}.`;
  const walkthrough = steps.length >= 6 ? squeeze(steps, 6) : [...steps, reach];

  const cards: Card[] = [
    { id: 'mover', emoji: moverEmoji, label: mover },
    { id: 'arrow', shape: 'arrow', color: '#f59e0b', scale: 0.7 },
    ...(gemCount > 0 ? [{ id: 'gem', emoji: '💎', label: gemCount === 1 ? 'gem' : 'gems' }] : []),
    { id: 'goal', emoji: goalEmoji, label: goal },
  ];

  const title = `${ctx.theme.label} Route ${interaction.cols}x${interaction.rows}`;
  if (ctx.young) {
    return assemble(ctx, {
      title,
      intro: `The ${mover} wants the ${goal}.`,
      question: `Guide the ${mover} to the ${goal}.`,
      interaction,
      hints: [`Which way is the ${mover} facing?`, 'Count the squares to walk.'],
      walkthrough,
      explanation: 'A program is a list of steps in order.',
      teach: ['Why does the order of steps matter?', 'The steps run one by one.', 'It does not matter.', 'Big steps are best.'],
      funFact: note.fun,
      scene: cardScene(ctx.theme.scene, cards),
    });
  }
  const task = gemCount > 0 ? `to the ${goal}, collecting ${gemCount === 1 ? 'the gem' : `all ${numberWords(gemCount)} gems`} on the way` : `to the ${goal}`;
  return assemble(ctx, {
    title,
    intro: say(lead(ctx), debugging ? `The last program made the ${mover} bump into a wall. It needs a program that works.` : `The ${mover} must find a way to the ${goal}.`),
    question: say(
      `Put the commands in order to move the ${mover} ${task}.`,
      'Do not bump into the walls.',
      `Use ${interaction.maxCommands} blocks or fewer.`,
      level.repeat && loopsSkill ? 'A repeat block makes your program shorter.' : '',
    ),
    interaction,
    hints: [
      `Check which way the ${mover} is facing before you choose the first block.`,
      say(
        gemCount > 0 ? 'Plan a route that passes every gem.' : 'Trace the route with your finger first.',
        'Count the squares on each straight part.',
        level.repeat ? 'A repeat block can stand for several forward blocks in a row.' : '',
      ),
    ],
    walkthrough,
    explanation: say(`A program is a list of commands that run in order. Each command moves or turns the ${mover} one step.`, note.explain),
    teach: [
      'Why does the order of the commands matter?',
      'The commands run one by one, so a different order gives a different route.',
      'The order does not matter.',
      'Longer programs are always better.',
    ],
    funFact: note.fun,
    scene: cardScene(ctx.theme.scene, cards),
  });
}
