/**
 * The output contract for each interaction kind: how to describe the
 * `interaction` object to the model, and one compact valid example.
 *
 * A challenge prompt contains the description and the example for exactly ONE
 * kind, so the model is never tempted by shapes it was not asked for. The
 * examples are checked against the real schema and validators in the tests.
 */
import type { InteractionKind } from '@/core/types';

export const KIND_SHAPES: Record<InteractionKind, string[]> = {
  choice: [
    '"interaction": { "kind": "choice", "multi": boolean, "options": Option[], "correctIds": string[] }',
    'Option = { "id": string, "label": string (max 80), "emoji": string (optional, one emoji), "misconception": string (max 200) }',
    '- 2 to 6 options (follow the age card). All labels different. "correctIds" lists the ids of the correct options.',
    '- "multi" is false with exactly one correct id, or true when the child must pick several (then say "pick all" in the question).',
    '- Every WRONG option has a "misconception"; the correct option has none.',
    '- Wrong options come from mistakes children really make (counted one too many, added instead of subtracting, mixed up two ideas), never from silly filler.',
  ],
  tap: [
    '"interaction": { "kind": "tap", "targetIds": string[] }',
    '- "targetIds": 1 to 20 ids of scene objects the child must tap. The child must tap ALL of them and nothing else.',
    '- Every target object has "tappable": true. Add at least as many tappable objects that are NOT targets, so there is something to decide.',
    '- Tappable objects are emoji or shapes with size 10 or more, spread out so they do not overlap.',
    '- The question says what to tap ("Tap every triangle"), and the scene must make the answer visible by looking, counting or reasoning.',
  ],
  sort: [
    '"interaction": { "kind": "sort", "bins": Bin[], "items": Item[] }',
    'Bin = { "id": string, "label": string (max 80), "emoji": string (optional) }',
    'Item = { "id": string, "label": string (max 80), "emoji": string (optional), "binId": string }',
    '- 2 to 4 bins with different labels. 2 to 10 items (follow the age: 4 for the youngest, up to 8 for older children).',
    '- "binId" is the id of the bin where the item belongs. Each item fits exactly one bin, and at least two bins get an item.',
    '- List the items in a mixed order, not grouped by bin.',
  ],
  match: [
    '"interaction": { "kind": "match", "pairs": Pair[] }',
    'Pair = { "id": string, "left": { "label": string (max 80), "emoji": string (optional) }, "right": { "label": string (max 80), "emoji": string (optional) } }',
    '- 2 to 6 pairs. The child connects each left item with its right partner; the app shuffles the right side.',
    '- All left items are different and all right items are different, so every match has exactly one partner.',
  ],
  order: [
    '"interaction": { "kind": "order", "items": Item[], "startLabel": string (max 24), "endLabel": string (max 24) }',
    'Item = { "id": string, "label": string (max 80), "emoji": string (optional) }',
    '- 3 to 7 items, written in the CORRECT order. The app shuffles them before showing them.',
    '- "startLabel" and "endLabel" name the two ends, for example "first" / "last" or "smallest" / "biggest".',
    '- There must be exactly one correct order: no ties, no two items that could swap places.',
  ],
  number: [
    '"interaction": { "kind": "number", "answer": number, "tolerance": number, "unit": string (optional, max 16), "allowDecimal": boolean, "allowNegative": boolean }',
    '- The child types the answer on a keypad. "answer" is the one correct number.',
    '- "tolerance" is 0 for exact answers. Use a small tolerance only for measuring or estimating tasks.',
    '- Set "allowDecimal": true when the answer has decimals, and "allowNegative": true when it is below zero. At most 3 decimal places.',
    '- The hints must not state the result, in digits or in words. A hint may repeat a number that the question gives ("start with 8 and take away 4"), but never as the outcome ("leaves 4", "= 4") and never a number the question does not give.',
    '- Say the unit in the question when there is one, and put it in "unit" (for example "cm", "apples").',
  ],
  robot: [
    '"interaction": { "kind": "robot", "cols": int, "rows": int, "start": { "x": int, "y": int, "dir": "up" | "right" | "down" | "left" }, "goal": { "x": int, "y": int }, "walls": Cell[], "gems": Cell[], "allowed": Command[], "maxCommands": int, "robotEmoji": string, "goalEmoji": string }',
    'Cell = { "x": int, "y": int }. Command = "forward" | "left" | "right" | "repeat".',
    '- The grid has "cols" columns and "rows" rows, each 3 to 8. Cell (0,0) is the TOP-LEFT corner; x grows to the right, y grows downward.',
    '- "forward" moves one cell in the direction the robot faces. "left" and "right" turn it a quarter turn on the spot. "repeat" wraps blocks and runs them 2 to 5 times.',
    '- The child wins by reaching the goal without driving into a wall or off the grid, after collecting every gem.',
    '- "walls": up to 30 cells, "gems": up to 6 cells. Start, goal and gems are never on a wall, and start is not the goal.',
    '- "allowed" always contains "forward". Offer "repeat" from about Grade 2 upward, when the path has a repeated stretch.',
    '- "maxCommands" (2 to 24) counts blocks: each block counts 1, and a repeat block counts 1 plus the blocks inside it. Trace the shortest solution cell by cell, count its blocks, and set "maxCommands" 1 to 3 above that.',
    '- Difficulty: youngest children get a straight line or one turn on a small grid; older children get more turns, walls to drive around, gems and repeats.',
    '- The walkthrough describes the path in words ("Go forward three times", "Turn left").',
  ],
  build: [
    '"interaction": { "kind": "build", "goalLabel": string (max 100), "powerLabel": string (max 24), "costLabel": string (max 24), "target": number, "budget": number, "parts": Part[] }',
    'Part = { "id": string, "label": string (max 80), "emoji": string (optional), "power": number, "cost": number }',
    '- The child picks parts. A selection is correct when the powers add up to at least "target" AND the costs add up to at most "budget".',
    '- 3 to 8 parts. At least one selection must work, but picking EVERY part must not work (it goes over budget), so the child has to choose.',
    '- Include one tempting part that is poor value (little power for a high cost) and one that is good value.',
    '- "goalLabel" names what is being built ("a bridge that holds 10 kg"), "powerLabel" what the parts add ("strength"), "costLabel" what they cost ("coins").',
    '- Check the arithmetic: write down one working selection and add up its power and cost before you answer.',
  ],
};

const teachBack = (right: string, wrong: string): unknown => ({
  prompt: 'Can you teach Pip how you worked it out?',
  options: [
    { id: 'a', label: right, correct: true },
    { id: 'b', label: wrong, correct: false },
  ],
});

/** One compact, valid example per kind. Format demonstrations only: the prompt tells the model never to reuse them. */
export const KIND_EXAMPLES: Record<InteractionKind, unknown> = {
  choice: {
    title: 'Moon Cookie Share',
    intro: 'Three astronauts open one box of moon cookies.',
    question: 'There are 12 cookies. Each astronaut gets the same number. How many does each one get?',
    readAloud:
      'Three astronauts open one box of moon cookies. There are twelve cookies. Each astronaut gets the same number. How many does each one get?',
    interaction: {
      kind: 'choice',
      multi: false,
      options: [
        { id: 'o1', label: '3', misconception: 'Three is how many astronauts there are. How many cookies land in front of each one?' },
        { id: 'o2', label: '4' },
        { id: 'o3', label: '9', misconception: 'That is twelve take away three. Sharing means making equal groups.' },
        { id: 'o4', label: '15', misconception: 'That is twelve and three put together. Here the cookies are shared out.' },
      ],
      correctIds: ['o2'],
    },
    hints: [
      'Imagine dealing the cookies out like cards, one astronaut at a time.',
      'Make three equal piles. Keep dealing until all twelve cookies are gone.',
    ],
    walkthrough: [
      'Draw three plates, one for each astronaut.',
      'Deal one cookie to each plate, again and again, until none are left.',
      'Now count the cookies on one plate.',
    ],
    explanation: 'Twelve cookies shared equally among three astronauts gives four each, because three groups of four make twelve.',
    teachBack: teachBack('I made three equal groups and counted one group.', 'I picked the biggest number.'),
    funFact: 'Astronauts eat tortillas instead of bread, because bread crumbs float away.',
    scene: {
      theme: 'space',
      objects: [
        { id: 'astro1', type: 'emoji', emoji: '🧑‍🚀', x: 22, y: 42, size: 16, anim: { kind: 'float', duration: 3 } },
        { id: 'astro2', type: 'emoji', emoji: '🧑‍🚀', x: 50, y: 34, size: 16, anim: { kind: 'float', duration: 3, delay: 0.4 } },
        { id: 'astro3', type: 'emoji', emoji: '🧑‍🚀', x: 78, y: 42, size: 16, anim: { kind: 'float', duration: 3, delay: 0.8 } },
        { id: 'box', type: 'emoji', emoji: '🍪', x: 50, y: 74, size: 20, label: '12 cookies', anim: { kind: 'pulse', duration: 1.5 } },
        { id: 'moon', type: 'shape', shape: 'circle', color: '#e8e6f5', x: 88, y: 14, size: 14, z: 0 },
        { id: 'star', type: 'shape', shape: 'star', color: '#ffd54a', x: 12, y: 14, size: 6, anim: { kind: 'spin', duration: 8 } },
      ],
    },
  },
  tap: {
    title: 'Who Is Thirsty?',
    intro: 'Gardener Gus has a full watering can.',
    question: 'Tap every living thing in the garden.',
    readAloud: 'Gardener Gus has a full watering can. Tap every living thing in the garden.',
    interaction: { kind: 'tap', targetIds: ['flower', 'tree', 'bug'] },
    hints: ['Living things grow, and they need food or water.', 'A stone and a toy never grow. Which things here can grow?'],
    walkthrough: [
      'Look at each picture and ask: does it grow?',
      'Plants grow, and little animals grow too.',
      'Tap each one that grows, and leave the others alone.',
    ],
    explanation: 'Plants and animals are alive: they grow and need water. A stone and a ball do not.',
    teachBack: teachBack('Living things grow and need water.', 'Living things are always green.'),
    scene: {
      theme: 'forest',
      objects: [
        { id: 'flower', type: 'emoji', emoji: '🌷', x: 16, y: 66, size: 16, tappable: true, anim: { kind: 'wiggle', duration: 2.4 } },
        { id: 'stone', type: 'emoji', emoji: '🪨', x: 36, y: 74, size: 14, tappable: true },
        { id: 'tree', type: 'emoji', emoji: '🌳', x: 56, y: 52, size: 24, tappable: true },
        { id: 'ball', type: 'emoji', emoji: '⚽', x: 74, y: 76, size: 12, tappable: true, anim: { kind: 'bounce', duration: 1.4 } },
        { id: 'bug', type: 'emoji', emoji: '🐞', x: 88, y: 60, size: 12, tappable: true, anim: { kind: 'wiggle', duration: 1.2 } },
        { id: 'pail', type: 'emoji', emoji: '🪣', x: 30, y: 44, size: 12, tappable: true },
        { id: 'sun', type: 'shape', shape: 'circle', color: '#ffd54a', x: 86, y: 14, size: 14, z: 0, anim: { kind: 'pulse', duration: 3 } },
      ],
    },
  },
  sort: {
    title: 'Splash Test',
    intro: 'Captain Otter drops things into the pond to see what happens.',
    question: 'Sort each thing: does it float or does it sink?',
    readAloud: 'Captain Otter drops things into the pond to see what happens. Sort each thing. Does it float, or does it sink?',
    interaction: {
      kind: 'sort',
      bins: [
        { id: 'float', label: 'Floats', emoji: '🛟' },
        { id: 'sink', label: 'Sinks', emoji: '⚓' },
      ],
      items: [
        { id: 'leaf', label: 'Leaf', emoji: '🍃', binId: 'float' },
        { id: 'coin', label: 'Coin', emoji: '🪙', binId: 'sink' },
        { id: 'duck', label: 'Rubber duck', emoji: '🦆', binId: 'float' },
        { id: 'key', label: 'Metal key', emoji: '🔑', binId: 'sink' },
      ],
    },
    hints: ['Think about what each thing is made of.', 'Light things full of air stay on top. Small heavy metal things go down.'],
    walkthrough: [
      'Pick one thing and imagine dropping it into a bath.',
      'Ask: is it light for its size, or heavy for its size?',
      'Put the light ones with the floaters and decide where the heavy ones go.',
    ],
    explanation: 'A leaf and a rubber duck are light for their size, so water holds them up. A coin and a key are heavy for their size, so they sink.',
    teachBack: teachBack('Things that are light for their size float.', 'Small things always float.'),
    scene: {
      theme: 'ocean',
      objects: [
        { id: 'otter', type: 'emoji', emoji: '🦦', x: 20, y: 36, size: 22, anim: { kind: 'bounce', duration: 1.8 } },
        { id: 'pond', type: 'shape', shape: 'oval', color: '#5b9bff', x: 60, y: 76, size: 50, z: 0 },
        { id: 'ripple', type: 'shape', shape: 'circle', color: '#bfe0ff', x: 60, y: 74, size: 10, opacity: 0.6, anim: { kind: 'grow', duration: 2 } },
        { id: 'cloud', type: 'shape', shape: 'cloud', color: '#ffffff', x: 78, y: 16, size: 18, anim: { kind: 'float', duration: 6 } },
      ],
    },
  },
  match: {
    title: 'Gadget Jobs',
    intro: 'Robo the robot is unpacking a box of computer parts.',
    question: 'Match each part to the job it does.',
    readAloud: 'Robo the robot is unpacking a box of computer parts. Match each part to the job it does.',
    interaction: {
      kind: 'match',
      pairs: [
        { id: 'p1', left: { label: 'Keyboard', emoji: '⌨️' }, right: { label: 'Types letters' } },
        { id: 'p2', left: { label: 'Microphone', emoji: '🎤' }, right: { label: 'Hears sounds' } },
        { id: 'p3', left: { label: 'Camera', emoji: '📷' }, right: { label: 'Takes pictures' } },
      ],
    },
    hints: ['Think about what you do with each part.', 'Which part do you talk into? Which one do you press with your fingers?'],
    walkthrough: [
      'Start with the part you know best.',
      'Say out loud what you do with it, then find those words on the other side.',
      'Do the same for the parts that are left.',
    ],
    explanation: 'Each part sends a different kind of information into the computer: key presses, sounds or pictures.',
    teachBack: teachBack('Each part brings a different kind of information into the computer.', 'All the parts do the same job.'),
    scene: {
      theme: 'workshop',
      objects: [
        { id: 'robo', type: 'emoji', emoji: '🤖', x: 20, y: 44, size: 24, anim: { kind: 'bounce', duration: 1.6 } },
        { id: 'box', type: 'emoji', emoji: '📦', x: 52, y: 66, size: 22 },
        { id: 'spark', type: 'shape', shape: 'star', color: '#ffd54a', x: 68, y: 34, size: 8, anim: { kind: 'pulse', duration: 1.2 } },
        { id: 'screen', type: 'emoji', emoji: '🖥️', x: 82, y: 50, size: 20 },
      ],
    },
  },
  order: {
    title: 'Butterfly Time Machine',
    intro: 'Someone shuffled the photos in the butterfly album!',
    question: 'Put the stages of a butterfly life in order, from first to last.',
    readAloud: 'Someone shuffled the photos in the butterfly album! Put the stages of a butterfly life in order, from first to last.',
    interaction: {
      kind: 'order',
      items: [
        { id: 'egg', label: 'Egg', emoji: '🥚' },
        { id: 'caterpillar', label: 'Caterpillar', emoji: '🐛' },
        { id: 'chrysalis', label: 'Chrysalis', emoji: '🫘' },
        { id: 'butterfly', label: 'Butterfly', emoji: '🦋' },
      ],
      startLabel: 'first',
      endLabel: 'last',
    },
    hints: ['Every butterfly starts out very, very small.', 'What hatches from an egg, and what does it turn into after it eats and eats?'],
    walkthrough: [
      'Find the smallest beginning and put it first.',
      'Next comes the hungry crawler that hatches.',
      'It rests inside a shell. Now place the last two photos yourself.',
    ],
    explanation: 'A butterfly starts as an egg, hatches into a caterpillar, rests as a chrysalis and comes out with wings.',
    teachBack: teachBack('Each stage grows out of the one before it.', 'The biggest picture always goes first.'),
    funFact: 'A caterpillar can grow to many times its first size in just a few weeks.',
    scene: {
      theme: 'forest',
      objects: [
        { id: 'fly1', type: 'emoji', emoji: '🦋', x: 22, y: 30, size: 16, anim: { kind: 'move', duration: 5, toX: 76, toY: 22 } },
        { id: 'leaf1', type: 'emoji', emoji: '🌿', x: 50, y: 72, size: 26 },
        { id: 'album', type: 'emoji', emoji: '📒', x: 80, y: 68, size: 18, anim: { kind: 'wiggle', duration: 2 } },
        { id: 'sun', type: 'shape', shape: 'circle', color: '#ffd54a', x: 88, y: 14, size: 12, z: 0 },
      ],
    },
  },
  number: {
    title: 'Rocket Fuel Check',
    intro: 'Pilot Juno counts the fuel cells before lift-off.',
    question: 'The rocket has 8 fuel cells. The flight to the moon uses 3. How many fuel cells are left?',
    readAloud:
      'Pilot Juno counts the fuel cells before lift-off. The rocket has eight fuel cells. The flight to the moon uses three. How many fuel cells are left?',
    interaction: { kind: 'number', answer: 5, tolerance: 0, unit: 'cells', allowDecimal: false, allowNegative: false },
    hints: ['When something is used up, do you have more or fewer?', 'Start at 8 and count back, one for each cell that is used.'],
    walkthrough: [
      'Start with all the fuel cells in the picture.',
      'Cross out one cell for each cell the flight uses.',
      'Count the cells that are not crossed out.',
    ],
    explanation: 'Using cells means taking away. Eight take away three leaves five.',
    teachBack: teachBack('I took the used cells away from the total.', 'I added the two numbers together.'),
    scene: {
      theme: 'space',
      objects: [
        { id: 'rocket', type: 'emoji', emoji: '🚀', x: 18, y: 40, size: 24, anim: { kind: 'float', duration: 3 } },
        { id: 'c1', type: 'emoji', emoji: '🔋', x: 36, y: 74, size: 9 },
        { id: 'c2', type: 'emoji', emoji: '🔋', x: 44, y: 74, size: 9 },
        { id: 'c3', type: 'emoji', emoji: '🔋', x: 52, y: 74, size: 9 },
        { id: 'c4', type: 'emoji', emoji: '🔋', x: 60, y: 74, size: 9 },
        { id: 'c5', type: 'emoji', emoji: '🔋', x: 68, y: 74, size: 9 },
        { id: 'c6', type: 'emoji', emoji: '🔋', x: 76, y: 74, size: 9 },
        { id: 'c7', type: 'emoji', emoji: '🔋', x: 84, y: 74, size: 9 },
        { id: 'c8', type: 'emoji', emoji: '🔋', x: 92, y: 74, size: 9 },
        { id: 'moon', type: 'emoji', emoji: '🌙', x: 84, y: 20, size: 16, anim: { kind: 'pulse', duration: 4 } },
      ],
    },
  },
  robot: {
    title: 'Parcel for the Lighthouse',
    intro: 'Zap the delivery robot has a parcel for the lighthouse keeper.',
    question: 'Build a program that picks up the gem and reaches the lighthouse.',
    readAloud: 'Zap the delivery robot has a parcel for the lighthouse keeper. Build a program that picks up the gem and reaches the lighthouse.',
    interaction: {
      kind: 'robot',
      cols: 4,
      rows: 3,
      start: { x: 0, y: 2, dir: 'right' },
      goal: { x: 3, y: 0 },
      walls: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      gems: [{ x: 3, y: 2 }],
      allowed: ['forward', 'left', 'right'],
      maxCommands: 8,
      robotEmoji: '🤖',
      goalEmoji: '🏠',
    },
    hints: ['Trace the path with your finger before you pick any blocks.', 'Drive along the bottom row first. Which way must the robot turn to face the lighthouse?'],
    walkthrough: [
      'Go forward until the robot reaches the gem in the corner.',
      'Turn so the robot faces up, toward the lighthouse.',
      'Now add the blocks that drive it to the top.',
    ],
    explanation: 'A robot does exactly what the blocks say, one block at a time, in order. Planning the path first makes the program easy to build.',
    teachBack: teachBack('The robot follows my blocks one by one, in order.', 'The robot knows the way by itself.'),
    scene: {
      theme: 'ocean',
      objects: [
        { id: 'zap', type: 'emoji', emoji: '🤖', x: 20, y: 60, size: 22, anim: { kind: 'bounce', duration: 1.6 } },
        { id: 'parcel', type: 'emoji', emoji: '📦', x: 36, y: 68, size: 12 },
        { id: 'light', type: 'emoji', emoji: '🏠', x: 80, y: 36, size: 22, anim: { kind: 'pulse', duration: 2 } },
        { id: 'wave', type: 'emoji', emoji: '🌊', x: 56, y: 84, size: 16, anim: { kind: 'wiggle', duration: 2.4 } },
      ],
    },
  },
  build: {
    title: 'Light Up the Treehouse',
    intro: 'The owl family wants to read bedtime stories in the treehouse, but it is too dark.',
    question: 'Pick lights that are bright enough, without spending too many acorns.',
    readAloud:
      'The owl family wants to read bedtime stories in the treehouse, but it is too dark. Pick lights that are bright enough, without spending too many acorns.',
    interaction: {
      kind: 'build',
      goalLabel: 'a treehouse with brightness 10',
      powerLabel: 'brightness',
      costLabel: 'acorns',
      target: 10,
      budget: 8,
      parts: [
        { id: 'lantern', label: 'Lantern', emoji: '🏮', power: 5, cost: 4 },
        { id: 'jar', label: 'Glow jar', emoji: '🫙', power: 3, cost: 2 },
        { id: 'string', label: 'String lights', emoji: '✨', power: 6, cost: 5 },
        { id: 'bulb', label: 'Tiny bulb', emoji: '💡', power: 2, cost: 1 },
        { id: 'lamp', label: 'Giant lamp', emoji: '🔦', power: 8, cost: 9 },
      ],
    },
    hints: ['Look for lights that give a lot of brightness for few acorns.', 'The giant lamp costs more than you have. Which smaller lights can team up?'],
    walkthrough: [
      'Check each light: how much brightness do you get for each acorn?',
      'Start with a light that is good value and note what you have spent.',
      'Add more lights until the brightness is enough, and check that the acorns still fit.',
    ],
    explanation: 'Engineers compare what each part gives with what it costs. Several small good-value parts can beat one big expensive part.',
    teachBack: teachBack('I compared what each light gives with what it costs.', 'I always pick the most expensive light.'),
    scene: {
      theme: 'forest',
      objects: [
        { id: 'tree', type: 'emoji', emoji: '🌳', x: 50, y: 50, size: 44, z: 0 },
        { id: 'owl1', type: 'emoji', emoji: '🦉', x: 40, y: 36, size: 14, anim: { kind: 'wiggle', duration: 2 } },
        { id: 'owl2', type: 'emoji', emoji: '🦉', x: 58, y: 40, size: 10, anim: { kind: 'wiggle', duration: 2, delay: 0.5 } },
        { id: 'book', type: 'emoji', emoji: '📖', x: 50, y: 58, size: 10 },
        { id: 'moon', type: 'emoji', emoji: '🌙', x: 86, y: 14, size: 14, anim: { kind: 'float', duration: 5 } },
      ],
    },
  },
};

/** The example for a kind as one line of JSON. */
export function exampleJson(kind: InteractionKind): string {
  return JSON.stringify(KIND_EXAMPLES[kind]);
}
