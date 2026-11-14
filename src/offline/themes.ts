/** Maps a child's interest (plan.theme) to artwork and wording. Unknown themes get a neutral one. */
import type { SceneTheme } from '@/core/schemas';
import type { Rng } from './rng';

export interface Thing {
  emoji: string;
  one: string;
  many: string;
}

export interface ThemeInfo {
  key: string;
  scene: SceneTheme;
  /** Emoji of the main character. */
  hero: string;
  /** Who needs help, e.g. "the space crew". */
  crew: string;
  /** One-sentence story openers for readers in Grade 1 and up. */
  leads: readonly string[];
  /** Countable themed objects. */
  things: readonly Thing[];
  /** Words in plan.theme that select this theme. */
  words: readonly string[];
  /** Title word, e.g. "Space". */
  label: string;
}

const t = (emoji: string, one: string, many = `${one}s`): Thing => ({ emoji, one, many });

export const THEMES: readonly ThemeInfo[] = [
  {
    key: 'space', label: 'Space', scene: 'space', hero: '🧑‍🚀', crew: 'the space crew', words: ['space', 'rocket', 'planet', 'astronaut', 'star'],
    leads: ['Mission control has a job for you.', 'Your space crew needs a sharp thinker.'],
    things: [t('🚀', 'rocket'), t('⭐', 'star'), t('🪐', 'planet'), t('🛸', 'spaceship'), t('👽', 'alien')],
  },
  {
    key: 'animals', label: 'Animal', scene: 'forest', hero: '🦊', crew: 'the animal rangers', words: ['animal', 'pet', 'zoo', 'dog', 'cat', 'horse'],
    leads: ['The animal rangers need your help.', 'A day at the animal park brings a new puzzle.'],
    things: [t('🐶', 'puppy', 'puppies'), t('🐱', 'kitten'), t('🐰', 'bunny', 'bunnies'), t('🐢', 'turtle'), t('🦜', 'parrot')],
  },
  {
    key: 'dinosaurs', label: 'Dino', scene: 'jungle', hero: '🦖', crew: 'the dinosaur explorers', words: ['dino'],
    leads: ['The dinosaur explorers need a clever helper.', 'Deep in dinosaur valley, a puzzle is waiting.'],
    things: [t('🦕', 'dinosaur'), t('🥚', 'dinosaur egg'), t('🦴', 'bone'), t('🌴', 'palm tree'), t('🌋', 'volcano', 'volcanoes')],
  },
  {
    key: 'robots', label: 'Robot', scene: 'workshop', hero: '🤖', crew: 'the robot team', words: ['robot', 'machine'],
    leads: ['The robot workshop is buzzing today.', 'Bolt the robot needs your help.'],
    things: [t('🤖', 'robot'), t('⚙️', 'gear'), t('🔋', 'battery', 'batteries'), t('🔩', 'bolt'), t('💡', 'light bulb')],
  },
  {
    key: 'ocean', label: 'Ocean', scene: 'ocean', hero: '🐙', crew: 'the ocean explorers', words: ['ocean', 'sea', 'fish', 'shark', 'whale', 'mermaid', 'pirate'],
    leads: ['The ocean explorers need your help.', 'Down by the sea, a new puzzle has washed up.'],
    things: [t('🐟', 'fish', 'fish'), t('🐚', 'shell'), t('🦀', 'crab'), t('🐙', 'octopus', 'octopuses'), t('🐳', 'whale')],
  },
  {
    key: 'cooking', label: 'Kitchen', scene: 'kitchen', hero: '🧑‍🍳', crew: 'the kitchen team', words: ['cook', 'bak', 'food', 'kitchen'],
    leads: ['The kitchen is busy today.', 'The chef needs a helper.'],
    things: [t('🧁', 'cupcake'), t('🍪', 'cookie'), t('🍎', 'apple'), t('🥕', 'carrot'), t('🍓', 'strawberry', 'strawberries')],
  },
  {
    key: 'sports', label: 'Sports', scene: 'playground', hero: '⚽', crew: 'the team', words: ['sport', 'soccer', 'football', 'basketball', 'baseball', 'swim', 'gymnast'],
    leads: ['The big game is about to start.', 'The team needs a quick thinker.'],
    things: [t('⚽', 'soccer ball'), t('🏀', 'basketball'), t('🎾', 'tennis ball'), t('🏆', 'trophy', 'trophies'), t('🥇', 'medal')],
  },
  {
    key: 'music', label: 'Music', scene: 'city', hero: '🎵', crew: 'the band', words: ['music', 'song', 'sing', 'danc', 'piano', 'guitar'],
    leads: ['The band is getting ready for the show.', 'The music room has a puzzle for you.'],
    things: [t('🥁', 'drum'), t('🎸', 'guitar'), t('🎺', 'trumpet'), t('🎹', 'keyboard'), t('🎻', 'violin')],
  },
  {
    key: 'cars and trains', label: 'Wheels', scene: 'city', hero: '🚂', crew: 'the drivers', words: ['car', 'train', 'truck', 'vehicle', 'bus', 'plane'],
    leads: ['The station is busy this morning.', 'The drivers need a helper today.'],
    things: [t('🚗', 'car'), t('🚂', 'train'), t('🚌', 'bus', 'buses'), t('🚚', 'truck'), t('🚲', 'bike')],
  },
  {
    key: 'superheroes', label: 'Hero', scene: 'city', hero: '🦸', crew: 'the hero team', words: ['hero'],
    leads: ['The hero team has a mission for you.', 'Hero City needs a sharp mind.'],
    things: [t('🦸', 'hero', 'heroes'), t('🛡️', 'shield'), t('⚡', 'lightning bolt'), t('🎭', 'mask'), t('⭐', 'star badge')],
  },
  {
    key: 'nature', label: 'Nature', scene: 'forest', hero: '🌳', crew: 'the forest rangers', words: ['nature', 'forest', 'garden', 'plant', 'flower', 'bug', 'insect', 'outdoor', 'camp'],
    leads: ['A walk in the woods brings a new puzzle.', 'The forest rangers need a helper.'],
    things: [t('🌸', 'flower'), t('🍄', 'mushroom'), t('🍂', 'leaf', 'leaves'), t('🐞', 'ladybug'), t('🐿️', 'squirrel')],
  },
  {
    key: 'building', label: 'Builder', scene: 'workshop', hero: '👷', crew: 'the builders', words: ['build', 'lego', 'block', 'construct'],
    leads: ['The building site is busy today.', 'The builders need a clever helper.'],
    things: [t('🧱', 'brick'), t('🔨', 'hammer'), t('🔧', 'wrench', 'wrenches'), t('🏠', 'house'), t('📏', 'ruler')],
  },
  {
    key: 'art', label: 'Art', scene: 'plain', hero: '🎨', crew: 'the artists', words: ['art', 'draw', 'paint', 'craft', 'color'],
    leads: ['The art room is full of color today.', 'The artists need a helper.'],
    things: [t('🖍️', 'crayon'), t('🎨', 'paint set'), t('🖌️', 'paintbrush', 'paintbrushes'), t('🖼️', 'picture'), t('✏️', 'pencil')],
  },
  {
    key: 'video games', label: 'Game', scene: 'city', hero: '🎮', crew: 'the players', words: ['game', 'minecraft', 'gaming'],
    leads: ['A new game level has just opened.', 'This level needs a clever player.'],
    things: [t('💎', 'gem'), t('🗝️', 'key'), t('👾', 'pixel monster'), t('❤️', 'heart'), t('⭐', 'star')],
  },
  {
    key: 'fairy tales', label: 'Fairy Tale', scene: 'castle', hero: '🧚', crew: 'the kingdom', words: ['fairy', 'princess', 'prince', 'dragon', 'unicorn', 'castle', 'magic', 'knight'],
    leads: ['Once upon a time, a castle had a puzzle.', 'The fairy tale kingdom needs a helper.'],
    things: [t('👑', 'crown'), t('🐉', 'dragon'), t('🦄', 'unicorn'), t('🏰', 'castle'), t('🧚', 'fairy', 'fairies')],
  },
  {
    key: 'weather', label: 'Weather', scene: 'sky', hero: '⛅', crew: 'the weather team', words: ['weather', 'storm', 'rain', 'snow', 'cloud'],
    leads: ['The weather station has a job for you.', 'The sky is full of surprises today.'],
    things: [t('☁️', 'cloud'), t('☂️', 'umbrella'), t('❄️', 'snowflake'), t('🌈', 'rainbow'), t('⚡', 'lightning bolt')],
  },
];

/** Used when the plan's theme is free text we do not recognise. */
export const NEUTRAL_THEMES: readonly ThemeInfo[] = [
  {
    key: 'garden', label: 'Garden', scene: 'farm', hero: '🐝', crew: 'the garden helpers', words: [],
    leads: ['The garden is full of surprises today.', 'The garden helpers have a puzzle for you.'],
    things: [t('🍎', 'apple'), t('🌻', 'sunflower'), t('🐝', 'bee'), t('🦋', 'butterfly', 'butterflies'), t('🐞', 'ladybug')],
  },
  {
    key: 'toys', label: 'Toy Box', scene: 'playground', hero: '🧸', crew: 'the toy makers', words: [],
    leads: ['The toy box has a puzzle for you.', 'The toy makers need a helper.'],
    things: [t('🎈', 'balloon'), t('🧸', 'teddy bear'), t('🪁', 'kite'), t('⚽', 'ball'), t('🚂', 'toy train')],
  },
  {
    key: 'farm', label: 'Farm', scene: 'farm', hero: '🐔', crew: 'the farmers', words: [],
    leads: ['The farm is busy this morning.', 'The farmers need a helper today.'],
    things: [t('🐄', 'cow'), t('🐖', 'pig'), t('🐑', 'sheep', 'sheep'), t('🐔', 'hen'), t('🥕', 'carrot')],
  },
];

/** The theme for a plan, and whether plan.theme itself was recognised. */
export function resolveTheme(theme: string, rng: Rng): { info: ThemeInfo; known: boolean } {
  const wanted = theme.trim().toLowerCase();
  if (wanted !== '') {
    const exact = THEMES.find((entry) => entry.key === wanted);
    if (exact) return { info: exact, known: true };
    const loose = THEMES.find((entry) => entry.words.some((word) => wanted.includes(word)));
    if (loose) return { info: loose, known: true };
    const neutral = NEUTRAL_THEMES.find((entry) => entry.key === wanted);
    if (neutral) return { info: neutral, known: true };
  }
  return { info: rng.pick(NEUTRAL_THEMES), known: false };
}
