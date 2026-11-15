/**
 * What a child can earn and collect: badges, collectibles for the rewards
 * shelf, and the companion that grows as the child learns.
 *
 * Every badge celebrates effort, a strategy or a habit. None of them says the
 * child is clever, and none can be lost.
 */
import type { Companion } from '@/core/types';
import { TUNING } from './tuning';

export interface BadgeDef {
  key: string;
  name: string;
  emoji: string;
  description: string;
}

export interface CollectibleDef {
  key: string;
  name: string;
  emoji: string;
  cost: number;
  theme: string;
}

export interface CompanionDef {
  species: string;
  name: string;
  /** emoji per growth 0..4: egg, hatchling, junior, grown, legendary */
  stages: [string, string, string, string, string];
}

interface BadgeEntry extends BadgeDef {
  /** What the child hears when the badge is granted. Names the effort or the strategy. */
  reason: string;
}

const B = TUNING.badges;

const BADGE_ENTRIES: BadgeEntry[] = [
  {
    key: 'first-spark',
    name: 'First Spark',
    emoji: '✨',
    description: 'Solved your very first challenge.',
    reason: 'You gave your first challenge a go and finished it!',
  },
  {
    key: 'solver-10',
    name: 'Ten Tall',
    emoji: '🔟',
    description: 'Solved 10 challenges.',
    reason: 'Ten challenges finished. Your practice is adding up!',
  },
  {
    key: 'solver-50',
    name: 'Fifty Finder',
    emoji: '🎯',
    description: 'Solved 50 challenges.',
    reason: 'Fifty challenges finished. You keep coming back and practising!',
  },
  {
    key: 'solver-100',
    name: 'Century Solver',
    emoji: '💯',
    description: 'Solved 100 challenges.',
    reason: 'One hundred challenges finished. That is a lot of steady work!',
  },
  {
    key: 'solver-250',
    name: 'Super Solver',
    emoji: '🏅',
    description: 'Solved 250 challenges.',
    reason: 'Two hundred and fifty challenges finished, one careful step at a time!',
  },
  {
    key: 'on-a-roll',
    name: 'On a Roll',
    emoji: '🎳',
    description: 'Solved five in a row with no help.',
    reason: 'Five in a row on your own. You read each one carefully before answering!',
  },
  {
    key: 'never-gave-up',
    name: 'Never Gave Up',
    emoji: '💪',
    description: 'Kept trying after three wrong tries and solved it.',
    reason: 'That one was tricky and you kept trying new ideas until it worked!',
  },
  {
    key: 'explorer-math',
    name: 'Number Explorer',
    emoji: '🔢',
    description: 'Solved five math challenges.',
    reason: 'You practised five math challenges!',
  },
  {
    key: 'explorer-science',
    name: 'Science Explorer',
    emoji: '🔬',
    description: 'Solved five science challenges.',
    reason: 'You investigated five science challenges!',
  },
  {
    key: 'explorer-technology',
    name: 'Code Explorer',
    emoji: '💻',
    description: 'Solved five technology challenges.',
    reason: 'You worked through five technology challenges step by step!',
  },
  {
    key: 'explorer-engineering',
    name: 'Build Explorer',
    emoji: '🛠️',
    description: 'Solved five engineering challenges.',
    reason: 'You designed and tested your way through five engineering challenges!',
  },
  {
    key: 'explorer-logic',
    name: 'Puzzle Explorer',
    emoji: '🧩',
    description: 'Solved five logic puzzles.',
    reason: 'You puzzled out five logic challenges!',
  },
  {
    key: 'all-rounder',
    name: 'STEM All-Rounder',
    emoji: '🌟',
    description: 'Solved a challenge in every subject.',
    reason: 'You tried every subject: math, science, technology, engineering and logic!',
  },
  {
    key: 'level-up',
    name: 'Level Up',
    emoji: '📈',
    description: 'Moved up a step in a skill.',
    reason: 'Your practice paid off and you moved up a step!',
  },
  {
    key: 'grade-climber',
    name: 'Grade Climber',
    emoji: '🧗',
    description: 'Reached a new school grade level in a subject.',
    reason: 'Step by step, you climbed to a new grade level!',
  },
  {
    key: 'double-checker',
    name: 'Double Checker',
    emoji: '✅',
    description: 'Showed an idea a second time, in a brand-new way.',
    reason: 'You used the same idea in a brand-new puzzle. That shows real understanding!',
  },
  {
    key: 'star-teacher',
    name: 'Star Teacher',
    emoji: '🧑‍🏫',
    description: 'Explained five ideas back to your helper.',
    reason: 'You explained five ideas in your own way. Teaching is a great way to learn!',
  },
  {
    key: 'mode-explorer',
    name: 'Mode Explorer',
    emoji: '🧭',
    description: 'Tried five different ways to play.',
    reason: 'You were curious and tried five different ways to play!',
  },
  {
    key: 'robot-coder',
    name: 'Robot Coder',
    emoji: '🤖',
    description: 'Guided the robot home five times.',
    reason: 'You planned the robot’s steps and fixed them until they worked, five times!',
  },
  {
    key: 'inventor',
    name: 'Inventor',
    emoji: '💡',
    description: 'Built five inventions that worked.',
    reason: 'You chose your parts carefully and built five inventions that worked!',
  },
  {
    key: 'weekend-scientist',
    name: 'Weekend Scientist',
    emoji: '🧪',
    description: 'Explored a science challenge on a weekend.',
    reason: 'You chose to explore science on a weekend!',
  },
  {
    key: 'brave-asker',
    name: 'Brave Asker',
    emoji: '🙋',
    description: 'Asked for a clue and then solved it.',
    reason: 'You asked for a clue when you needed one and then solved it. That is a great strategy!',
  },
  {
    key: 'bounce-back',
    name: 'Bounce Back',
    emoji: '🦘',
    description: 'Solved the next one yourself after a walkthrough.',
    reason: 'You followed the steps, then solved the next one yourself. You bounced back!',
  },
  {
    key: 'memory-keeper',
    name: 'Memory Keeper',
    emoji: '🧠',
    description: 'Remembered five ideas from earlier days.',
    reason: 'You remembered five ideas from earlier days. Coming back to things helps them stick!',
  },
  {
    key: 'real-world-explorer',
    name: 'Real-World Explorer',
    emoji: '🌍',
    description: 'Finished three real-world missions.',
    reason: 'You went looking in the real world and finished three missions!',
  },
  {
    key: 'trailblazer',
    name: 'Trailblazer',
    emoji: '🥾',
    description: 'Finished the first adventure trail.',
    reason: 'You finished your first adventure trail. Now the journey really starts!',
  },
];

export const BADGES: BadgeDef[] = BADGE_ENTRIES.map(({ key, name, emoji, description }) => ({
  key,
  name,
  emoji,
  description,
}));

const BADGE_REASONS = new Map<string, string>(BADGE_ENTRIES.map((entry) => [entry.key, entry.reason]));

export function getBadge(key: string): BadgeDef | undefined {
  return BADGES.find((badge) => badge.key === key);
}

/** Child-friendly sentence shown when the badge is granted. */
export function badgeReason(key: string): string {
  return BADGE_REASONS.get(key) ?? 'You earned a new badge by practising!';
}

/** Badge key for "solved N challenges". */
export function solveBadgeKey(milestone: number): string {
  return `solver-${milestone}`;
}

// Keep the milestone badges and the tuning table in step.
for (const milestone of B.solveMilestones) {
  if (!BADGE_REASONS.has(solveBadgeKey(milestone))) {
    throw new Error(`No badge defined for the ${milestone}-solves milestone`);
  }
}

/** Two collectibles per suggested interest, costing 5 to 40 stars. */
export const COLLECTIBLES: CollectibleDef[] = [
  { key: 'rocket-ship', name: 'Rocket Ship', emoji: '🚀', cost: 15, theme: 'space' },
  { key: 'ringed-planet', name: 'Ringed Planet', emoji: '🪐', cost: 30, theme: 'space' },
  { key: 'puppy-pal', name: 'Puppy Pal', emoji: '🐶', cost: 10, theme: 'animals' },
  { key: 'lion-friend', name: 'Lion Friend', emoji: '🦁', cost: 25, theme: 'animals' },
  { key: 'gentle-longneck', name: 'Gentle Longneck', emoji: '🦕', cost: 15, theme: 'dinosaurs' },
  { key: 'mighty-rex', name: 'Mighty Rex', emoji: '🦖', cost: 35, theme: 'dinosaurs' },
  { key: 'robot-wrench', name: 'Robot Wrench', emoji: '🔧', cost: 5, theme: 'robots' },
  { key: 'robo-arm', name: 'Robo Arm', emoji: '🦾', cost: 30, theme: 'robots' },
  { key: 'sea-shell', name: 'Sea Shell', emoji: '🐚', cost: 5, theme: 'ocean' },
  { key: 'friendly-whale', name: 'Friendly Whale', emoji: '🐳', cost: 30, theme: 'ocean' },
  { key: 'cupcake', name: 'Cupcake', emoji: '🧁', cost: 10, theme: 'cooking' },
  { key: 'pizza-party', name: 'Pizza Party', emoji: '🍕', cost: 20, theme: 'cooking' },
  { key: 'soccer-ball', name: 'Soccer Ball', emoji: '⚽', cost: 10, theme: 'sports' },
  { key: 'shiny-trophy', name: 'Shiny Trophy', emoji: '🏆', cost: 40, theme: 'sports' },
  { key: 'bongo-drum', name: 'Bongo Drum', emoji: '🥁', cost: 15, theme: 'music' },
  { key: 'rock-guitar', name: 'Rock Guitar', emoji: '🎸', cost: 25, theme: 'music' },
  { key: 'steam-train', name: 'Steam Train', emoji: '🚂', cost: 20, theme: 'cars and trains' },
  { key: 'race-car', name: 'Race Car', emoji: '🏎️', cost: 35, theme: 'cars and trains' },
  { key: 'hero-cape', name: 'Hero Cape', emoji: '🦸', cost: 20, theme: 'superheroes' },
  { key: 'hero-shield', name: 'Hero Shield', emoji: '🛡️', cost: 30, theme: 'superheroes' },
  { key: 'sunflower', name: 'Sunflower', emoji: '🌻', cost: 5, theme: 'nature' },
  { key: 'rainbow', name: 'Rainbow', emoji: '🌈', cost: 25, theme: 'nature' },
  { key: 'brick-stack', name: 'Brick Stack', emoji: '🧱', cost: 10, theme: 'building' },
  { key: 'grand-castle', name: 'Grand Castle', emoji: '🏰', cost: 40, theme: 'building' },
  { key: 'crayon', name: 'Bright Crayon', emoji: '🖍️', cost: 5, theme: 'art' },
  { key: 'paint-palette', name: 'Paint Palette', emoji: '🎨', cost: 20, theme: 'art' },
  { key: 'joystick', name: 'Joystick', emoji: '🕹️', cost: 15, theme: 'video games' },
  { key: 'pixel-alien', name: 'Pixel Alien', emoji: '👾', cost: 25, theme: 'video games' },
  { key: 'magic-wand', name: 'Magic Wand', emoji: '🪄', cost: 20, theme: 'fairy tales' },
  { key: 'golden-crown', name: 'Golden Crown', emoji: '👑', cost: 40, theme: 'fairy tales' },
  { key: 'fluffy-cloud', name: 'Fluffy Cloud', emoji: '☁️', cost: 5, theme: 'weather' },
  { key: 'snowman', name: 'Snowman', emoji: '⛄', cost: 15, theme: 'weather' },
];

export function getCollectible(key: string): CollectibleDef | undefined {
  return COLLECTIBLES.find((item) => item.key === key);
}

/** Every companion starts as an egg and grows four times. */
export const COMPANIONS: CompanionDef[] = [
  { species: 'dragon', name: 'Dragon', stages: ['🥚', '🦎', '🐲', '🐉', '🐉👑'] },
  { species: 'owl', name: 'Owl', stages: ['🥚', '🐣', '🐥', '🦉', '🦉👑'] },
  { species: 'fox', name: 'Fox', stages: ['🥚', '🐾', '🦊', '🦊🎒', '🦊👑'] },
  { species: 'robot', name: 'Robot', stages: ['🥚', '🔩', '🤖', '🤖🚀', '🤖👑'] },
  { species: 'turtle', name: 'Turtle', stages: ['🥚', '🐚', '🐢', '🐢🌊', '🐢👑'] },
  { species: 'unicorn', name: 'Unicorn', stages: ['🥚', '🐴', '🦄', '🦄🌈', '🦄👑'] },
];

export const MAX_COMPANION_GROWTH = TUNING.companion.growthXp.length - 1;

export function getCompanionDef(species: string): CompanionDef | undefined {
  return COMPANIONS.find((def) => def.species === species);
}

/** The growth stage (0..4) a companion with this much xp has reached. */
export function growthForXp(xp: number): number {
  let growth = 0;
  TUNING.companion.growthXp.forEach((threshold, index) => {
    if (xp >= threshold) growth = index;
  });
  return growth;
}

/** The emoji for the companion at its current growth. An unknown species is shown as an egg. */
export function companionEmoji(companion: Companion): string {
  const def = getCompanionDef(companion.species);
  if (!def) return '🥚';
  const growth = Math.max(0, Math.min(MAX_COMPANION_GROWTH, Math.floor(companion.growth)));
  return def.stages[growth] ?? def.stages[0];
}

export interface CompanionProgress {
  growth: number;
  xp: number;
  /** Xp at which the companion grows next, or null when it is fully grown. */
  nextGrowthAt: number | null;
  /** 0..1 of the way from the current growth to the next one (1 when fully grown). */
  progress: number;
}

/** How far the companion is on its way to the next growth, for a progress bar on the rewards shelf. */
export function companionProgress(companion: Companion): CompanionProgress {
  const thresholds = TUNING.companion.growthXp;
  const growth = Math.max(0, Math.min(MAX_COMPANION_GROWTH, Math.floor(companion.growth)));
  const xp = Math.max(0, companion.xp);
  const next = thresholds[growth + 1];
  if (next === undefined) return { growth, xp, nextGrowthAt: null, progress: 1 };
  const from = thresholds[growth] ?? 0;
  const progress = Math.max(0, Math.min(1, (xp - from) / (next - from)));
  return { growth, xp, nextGrowthAt: next, progress };
}
