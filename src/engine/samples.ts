/**
 * One hand-written sample challenge per interaction kind. Used by the
 * EngineGallery for visual checks and by the engine's own tests. Not real
 * curriculum content: the offline bank lives in `@/offline`.
 */
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type { InteractionKind } from '@/core/types';

const ROCKET_SVG =
  '<svg viewBox="0 0 64 96"><path d="M32 4c14 14 18 34 14 56H18C14 38 18 18 32 4z" fill="#f4f6ff" stroke="#3d3766" stroke-width="3"/><circle cx="32" cy="34" r="8" fill="#5b9bff" stroke="#3d3766" stroke-width="3"/><path d="M18 52 6 70l14-4zM46 52l12 18-14-4z" fill="#ff8a7a" stroke="#3d3766" stroke-width="3"/><path d="M24 62h16l-8 26z" fill="#ffd54a"/></svg>';

const RAW: Record<InteractionKind, unknown> = {
  choice: {
    title: 'Hungry Caterpillar',
    intro: 'The caterpillar munched through the garden all morning.',
    question: 'It ate 3 leaves, then 4 more. How many leaves did it eat?',
    readAloud: 'The caterpillar munched through the garden all morning. It ate three leaves, then four more. How many leaves did it eat?',
    interaction: {
      kind: 'choice',
      options: [
        { id: 'six', label: 'Six', emoji: '6️⃣', misconception: 'Close! Count on from three one more time.' },
        { id: 'seven', label: 'Seven', emoji: '7️⃣' },
        { id: 'one', label: 'One', emoji: '1️⃣', misconception: 'That is the difference. Here the leaves are put together.' },
        { id: 'twelve', label: 'Twelve', emoji: '🔢', misconception: 'That is what you get by multiplying. Try adding.' },
      ],
      correctIds: ['seven'],
    },
    hints: ['Start with the bigger pile of leaves.', 'Hold up four fingers, then count three more.'],
    walkthrough: ['Start at four.', 'Count on three more: five, six, seven.', 'So three and four make seven.'],
    explanation: 'Three leaves and four leaves together make seven leaves.',
    teachBack: {
      prompt: 'Can you teach Pip why the answer is seven?',
      options: [
        { id: 'a', label: 'Because putting 3 and 4 together makes 7.', correct: true },
        { id: 'b', label: 'Because 7 is a lucky number.', correct: false },
      ],
    },
    funFact: 'A caterpillar can eat many times its own weight in leaves.',
    scene: {
      theme: 'forest',
      objects: [
        { id: 'bug', type: 'emoji', emoji: '🐛', x: 50, y: 42, size: 22, anim: { kind: 'wiggle', duration: 1.6 } },
        { id: 'l1', type: 'emoji', emoji: '🍃', x: 14, y: 70, size: 12, anim: { kind: 'float', duration: 3 } },
        { id: 'l2', type: 'emoji', emoji: '🍃', x: 26, y: 74, size: 12, anim: { kind: 'float', duration: 3, delay: 0.3 } },
        { id: 'l3', type: 'emoji', emoji: '🍃', x: 38, y: 70, size: 12, anim: { kind: 'float', duration: 3, delay: 0.6 } },
        { id: 'l4', type: 'emoji', emoji: '🍂', x: 58, y: 74, size: 12, anim: { kind: 'float', duration: 3, delay: 0.2 } },
        { id: 'l5', type: 'emoji', emoji: '🍂', x: 68, y: 70, size: 12, anim: { kind: 'float', duration: 3, delay: 0.5 } },
        { id: 'l6', type: 'emoji', emoji: '🍂', x: 78, y: 74, size: 12, anim: { kind: 'float', duration: 3, delay: 0.8 } },
        { id: 'l7', type: 'emoji', emoji: '🍂', x: 88, y: 70, size: 12, anim: { kind: 'float', duration: 3, delay: 1.1 } },
        { id: 'plus', type: 'text', text: '3 + 4', x: 50, y: 14, size: 14, color: '#3b2ea0', anim: { kind: 'grow', duration: 0.8, loop: false } },
      ],
    },
  },
  tap: {
    title: 'Triangle Hunt',
    intro: 'Captain Zip needs triangle parts to fix the spaceship.',
    question: 'Tap every triangle you can find.',
    readAloud: 'Captain Zip needs triangle parts to fix the spaceship. Tap every triangle you can find.',
    interaction: { kind: 'tap', targetIds: ['t1', 't2', 't3'] },
    hints: ['A triangle has three straight sides.', 'Count the corners of each shape. Triangles have exactly three.'],
    walkthrough: ['Look at one shape at a time.', 'Count its sides.', 'If it has three sides, tap it.'],
    explanation: 'Triangles are the shapes with three sides and three corners.',
    scene: {
      theme: 'space',
      objects: [
        { id: 'ship', type: 'svg', svg: ROCKET_SVG, x: 86, y: 62, size: 30, z: 2, anim: { kind: 'float', duration: 4 } },
        { id: 't1', type: 'shape', shape: 'triangle', color: '#ffd54a', x: 16, y: 34, size: 16, tappable: true, anim: { kind: 'float', duration: 3 } },
        { id: 'c1', type: 'shape', shape: 'circle', color: '#ff8a7a', x: 36, y: 62, size: 16, tappable: true, anim: { kind: 'pulse', duration: 2.4 } },
        { id: 't2', type: 'shape', shape: 'triangle', color: '#4cc38a', x: 52, y: 30, size: 18, rotation: 180, tappable: true },
        { id: 's1', type: 'shape', shape: 'square', color: '#5b9bff', x: 18, y: 76, size: 15, tappable: true, anim: { kind: 'wiggle', duration: 2 } },
        { id: 't3', type: 'shape', shape: 'triangle', color: '#ff9ecb', x: 60, y: 76, size: 14, rotation: 25, tappable: true, anim: { kind: 'bounce', duration: 1.8 } },
        { id: 'h1', type: 'shape', shape: 'hexagon', color: '#a99cf5', x: 72, y: 26, size: 14, tappable: true, anim: { kind: 'spin', duration: 8 } },
        { id: 'star', type: 'shape', shape: 'star', color: '#ffe38a', x: 36, y: 16, size: 10, tappable: true, anim: { kind: 'orbit', duration: 5 } },
      ],
    },
  },
  sort: {
    title: 'Sink or Float',
    intro: 'Splash! The lab tub is full of water.',
    question: 'Which things float and which things sink?',
    readAloud: 'Splash! The lab tub is full of water. Which things float and which things sink?',
    interaction: {
      kind: 'sort',
      bins: [
        { id: 'float', label: 'Floats', emoji: '🛟' },
        { id: 'sink', label: 'Sinks', emoji: '⚓' },
      ],
      items: [
        { id: 'duck', label: 'Rubber duck', emoji: '🦆', binId: 'float' },
        { id: 'rock', label: 'Rock', emoji: '🪨', binId: 'sink' },
        { id: 'leaf', label: 'Leaf', emoji: '🍃', binId: 'float' },
        { id: 'key', label: 'Key', emoji: '🔑', binId: 'sink' },
        { id: 'ball', label: 'Beach ball', emoji: '🏐', binId: 'float' },
      ],
    },
    hints: ['Think about what happens when you drop each thing in the bath.', 'Heavy things made of metal or stone go down.'],
    walkthrough: ['Pick up one thing.', 'Is it light and full of air, or heavy for its size?', 'Light, airy things float. Heavy, solid things sink.'],
    explanation: 'Things that are light for their size float. Things that are heavy for their size sink.',
    scene: {
      theme: 'lab',
      objects: [
        { id: 'tub', type: 'shape', shape: 'rect', color: '#8fd3ff', x: 50, y: 64, size: 62, z: 0, opacity: 0.85 },
        { id: 'duck', type: 'emoji', emoji: '🦆', x: 40, y: 48, size: 16, z: 2, anim: { kind: 'float', duration: 2.4 } },
        { id: 'rock', type: 'emoji', emoji: '🪨', x: 62, y: 74, size: 14, z: 2 },
        { id: 'drop', type: 'emoji', emoji: '💧', x: 76, y: 20, size: 10, anim: { kind: 'move', duration: 1.8, toX: 76, toY: 44 } },
      ],
    },
  },
  match: {
    title: 'Animal Homes',
    intro: 'Everyone is heading home for the night.',
    question: 'Match each animal to its home.',
    readAloud: 'Everyone is heading home for the night. Match each animal to its home.',
    interaction: {
      kind: 'match',
      pairs: [
        { id: 'bee', left: { label: 'Bee', emoji: '🐝' }, right: { label: 'Hive', emoji: '🍯' } },
        { id: 'bird', left: { label: 'Bird', emoji: '🐦' }, right: { label: 'Nest', emoji: '🪺' } },
        { id: 'fish', left: { label: 'Fish', emoji: '🐟' }, right: { label: 'Pond', emoji: '🌊' } },
        { id: 'dog', left: { label: 'Dog', emoji: '🐶' }, right: { label: 'Kennel', emoji: '🏠' } },
      ],
    },
    hints: ['Think about where you would look to find each animal.', 'One of them needs water to live in.'],
    walkthrough: ['Start with the fish. It lives in water.', 'A bee makes honey in a hive.', 'A bird lays eggs in a nest, and a dog sleeps in a kennel.'],
    explanation: 'Animals live in homes that give them what they need to stay safe.',
    scene: {
      theme: 'farm',
      objects: [
        { id: 'bee', type: 'emoji', emoji: '🐝', x: 22, y: 30, size: 12, anim: { kind: 'orbit', duration: 3 } },
        { id: 'bird', type: 'emoji', emoji: '🐦', x: 50, y: 22, size: 13, anim: { kind: 'move', duration: 5, toX: 70, toY: 16 } },
        { id: 'dog', type: 'emoji', emoji: '🐶', x: 30, y: 74, size: 16, anim: { kind: 'bounce', duration: 1.4 } },
        { id: 'moon', type: 'emoji', emoji: '🌙', x: 90, y: 12, size: 10, anim: { kind: 'fade-in', duration: 2, loop: false } },
      ],
    },
  },
  order: {
    title: 'From Seed to Flower',
    intro: 'A tiny seed is about to do something amazing.',
    question: 'Put the pictures in order, from first to last.',
    readAloud: 'A tiny seed is about to do something amazing. Put the pictures in order, from first to last.',
    interaction: {
      kind: 'order',
      items: [
        { id: 'seed', label: 'Seed', emoji: '🌰' },
        { id: 'sprout', label: 'Sprout', emoji: '🌱' },
        { id: 'plant', label: 'Leafy plant', emoji: '🌿' },
        { id: 'flower', label: 'Flower', emoji: '🌻' },
      ],
      startLabel: 'first',
      endLabel: 'last',
    },
    hints: ['What does a plant look like before it has any leaves?', 'The flower opens at the very end.'],
    walkthrough: ['Everything starts as a seed.', 'A small sprout pushes out of the soil.', 'Leaves grow, and at last the flower opens.'],
    explanation: 'Plants grow in steps: seed, sprout, leafy plant, then flower.',
    scene: {
      theme: 'sky',
      objects: [
        { id: 'pot', type: 'emoji', emoji: '🪴', x: 50, y: 66, size: 30, anim: { kind: 'grow', duration: 1.2, loop: false } },
        { id: 'can', type: 'emoji', emoji: '🚿', x: 24, y: 40, size: 14, anim: { kind: 'wiggle', duration: 2 } },
        { id: 'sun', type: 'emoji', emoji: '🌤️', x: 16, y: 16, size: 12, anim: { kind: 'slide-in', duration: 1.2, loop: false } },
      ],
    },
  },
  number: {
    title: 'Cookie Trays',
    intro: 'The bakery robot filled 3 trays with cookies.',
    question: 'Each tray holds 4 cookies. How many cookies are there in total?',
    readAloud: 'The bakery robot filled three trays with cookies. Each tray holds four cookies. How many cookies are there in total?',
    interaction: { kind: 'number', answer: 12, unit: 'cookies' },
    hints: ['You can count the cookies one tray at a time.', 'Try skip counting by fours, once for each tray.'],
    walkthrough: ['The first tray has four cookies.', 'Two trays make eight.', 'Add the last tray of four to finish the count.'],
    explanation: 'Three groups of four make twelve, because 4 + 4 + 4 = 12.',
    scene: {
      theme: 'kitchen',
      objects: [
        ...[0, 1, 2].flatMap((tray) =>
          [0, 1, 2, 3].map((n) => ({
            id: `c${tray}${n}`,
            type: 'emoji',
            emoji: '🍪',
            x: 16 + tray * 30 + (n % 2) * 10,
            y: 46 + Math.floor(n / 2) * 14,
            size: 9,
            z: 2,
            anim: { kind: 'fade-in', duration: 0.5, delay: tray * 0.6 + n * 0.1, loop: false },
          })),
        ),
        { id: 'tray0', type: 'shape', shape: 'rect', color: '#c9ccd6', x: 21, y: 53, size: 34, z: 1, label: 'Tray 1' },
        { id: 'tray1', type: 'shape', shape: 'rect', color: '#c9ccd6', x: 51, y: 53, size: 34, z: 1, label: 'Tray 2' },
        { id: 'tray2', type: 'shape', shape: 'rect', color: '#c9ccd6', x: 81, y: 53, size: 34, z: 1, label: 'Tray 3' },
      ],
    },
  },
  robot: {
    title: 'Gem Run',
    intro: 'Bolt the robot spotted a shiny gem in the maze.',
    question: 'Build a program that collects the gem and reaches the flag.',
    readAloud: 'Bolt the robot spotted a shiny gem in the maze. Build a program that collects the gem and reaches the flag.',
    interaction: {
      kind: 'robot',
      cols: 5,
      rows: 4,
      start: { x: 0, y: 3, dir: 'right' },
      goal: { x: 4, y: 0 },
      walls: [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 1 },
      ],
      gems: [{ x: 4, y: 3 }],
      allowed: ['forward', 'left', 'right', 'repeat'],
      maxCommands: 8,
    },
    hints: ['Trace the path with your finger before you pick any blocks.', 'Drive straight along the bottom first, then turn towards the flag.'],
    walkthrough: ['Go forward four times to reach the gem.', 'Turn left so the robot faces up.', 'Go forward three times to reach the flag.'],
    explanation: 'The robot follows your blocks one at a time, in order. A repeat block saves you from writing the same block again and again.',
    scene: {
      theme: 'workshop',
      objects: [
        { id: 'bot', type: 'emoji', emoji: '🤖', x: 22, y: 52, size: 26, anim: { kind: 'bounce', duration: 1.6 } },
        { id: 'gem', type: 'emoji', emoji: '💎', x: 62, y: 44, size: 16, anim: { kind: 'pulse', duration: 1.4 } },
        { id: 'flag', type: 'emoji', emoji: '🏁', x: 84, y: 38, size: 16, anim: { kind: 'wiggle', duration: 1.8 } },
      ],
    },
  },
  build: {
    title: 'Bridge Builder',
    intro: 'The goats want to cross the river to the tasty grass.',
    question: 'Pick parts for a bridge that is strong enough, without spending too many coins.',
    readAloud: 'The goats want to cross the river to the tasty grass. Pick parts for a bridge that is strong enough, without spending too many coins.',
    interaction: {
      kind: 'build',
      goalLabel: 'a bridge with strength 10',
      powerLabel: 'strength',
      costLabel: 'coins',
      target: 10,
      budget: 9,
      parts: [
        { id: 'logs', label: 'Logs', emoji: '🪵', power: 5, cost: 4 },
        { id: 'rope', label: 'Rope', emoji: '🪢', power: 2, cost: 1 },
        { id: 'stone', label: 'Stone blocks', emoji: '🧱', power: 6, cost: 6 },
        { id: 'planks', label: 'Planks', emoji: '🪜', power: 3, cost: 2 },
        { id: 'paper', label: 'Paper', emoji: '📄', power: 1, cost: 2 },
      ],
    },
    hints: ['Look for parts that give a lot of strength for few coins.', 'The logs are a good start. What can you add without going over budget?'],
    walkthrough: ['Logs give five strength for four coins.', 'Planks add three strength for two coins.', 'Rope adds the last two strength for one coin.'],
    explanation: 'Good engineers get the most strength they can for the coins they have.',
    scene: {
      theme: 'castle',
      objects: [
        { id: 'goat1', type: 'emoji', emoji: '🐐', x: 16, y: 70, size: 16, anim: { kind: 'bounce', duration: 1.5 } },
        { id: 'goat2', type: 'emoji', emoji: '🐐', x: 28, y: 74, size: 13, anim: { kind: 'bounce', duration: 1.5, delay: 0.4 } },
        { id: 'river', type: 'shape', shape: 'oval', color: '#5b9bff', x: 54, y: 84, size: 44, z: 0 },
        { id: 'grass', type: 'emoji', emoji: '🌾', x: 86, y: 72, size: 16, anim: { kind: 'wiggle', duration: 2.4 } },
      ],
    },
  },
};

function parseAll(): Record<InteractionKind, Challenge> {
  const out = {} as Record<InteractionKind, Challenge>;
  for (const kind of Object.keys(RAW) as InteractionKind[]) out[kind] = ChallengeSchema.parse(RAW[kind]);
  return out;
}

/** One schema-valid sample per interaction kind. */
export const SAMPLE_CHALLENGES: Record<InteractionKind, Challenge> = /* @__PURE__ */ parseAll();
