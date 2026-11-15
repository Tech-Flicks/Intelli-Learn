/** Story outlines for Story mode when no AI is available. Every chapter stops where the hero needs help. */
import { StoryOutlineSchema, type StoryOutline } from '@/core/schemas';
import { createRng, hashText } from './rng';
import { resolveTheme } from './themes';

interface Chapter {
  heading: string;
  narrative: string;
  illustration: string;
}

interface Tale {
  /** Theme keys this tale suits. */
  themes: readonly string[];
  title: string;
  chapters: readonly [Chapter, Chapter, Chapter, Chapter, Chapter];
  ending: string;
}

const TALES: readonly Tale[] = [
  {
    themes: ['space', 'weather'],
    title: 'The Star That Lost Its Light',
    chapters: [
      { heading: 'A Signal in the Night', narrative: 'Captain Nova and her robot friend Blip were watching the stars from the space station. One small star was blinking: short, long, short. "It is asking for help!" said Blip. The rocket was ready, but the launch computer was locked. It needs the right answer before the engines will start.', illustration: 'A girl astronaut and a small round robot look through a big window at a blinking star.' },
      { heading: 'The Asteroid Field', narrative: 'The rocket zoomed away from the station. Soon the way ahead was full of tumbling space rocks. "We need a safe path," said Captain Nova. Blip opened the star map, but part of it was scrambled. Someone has to work out the missing piece.', illustration: 'A small rocket in front of a field of gray space rocks, with a glowing map on a screen.' },
      { heading: 'The Sleepy Moon Base', narrative: 'Past the rocks they found a quiet moon base. Its friendly robots had run out of power and stood as still as statues. "If we wake them, they can tell us about the star," said Blip. The power panel showed a puzzle, and it will only switch on for a clever thinker.', illustration: 'Sleeping robots in a dusty moon base, and a power panel with glowing buttons.' },
      { heading: 'The Robot Riddle', narrative: 'The robots blinked awake and cheered. "The little star has lost its spark crystal," they explained. "It fell into the crater of riddles." At the edge of the crater stood a stone door with a question carved into it. The door stays shut until the question is solved.', illustration: 'A deep moon crater with a stone door, and happy robots pointing at it.' },
      { heading: 'The Spark Crystal', narrative: 'Behind the door, the spark crystal glowed softly on a high shelf. Captain Nova could almost reach it. "One more step," said Blip. "The shelf will only lower when the last puzzle is solved." The little star was growing dimmer, so there is no time to lose.', illustration: 'A glowing crystal on a tall shelf inside a cave, with the astronaut reaching up.' },
    ],
    ending: 'Captain Nova carried the spark crystal back to the little star. It flashed, flickered and then shone brighter than ever before. All across the sky, the other stars twinkled their thanks. "Mission complete," said Blip, "thanks to our clever helper!"',
  },
  {
    themes: ['ocean'],
    title: 'The Secret of Coral Cove',
    chapters: [
      { heading: 'The Message in the Bottle', narrative: 'Finn the diver found a bottle bobbing on the waves. Inside was a note from Pearl the turtle: "The colors of Coral Cove are fading. Please come!" Finn hurried to his little submarine. But its hatch has a number lock, and Finn has forgotten how to open it.', illustration: 'A boy in a diving suit holds a bottle with a note, next to a small yellow submarine.' },
      { heading: 'The Kelp Maze', narrative: 'The submarine sank into the cool green water. A forest of tall kelp swayed in front of it like a maze. A crab waved a claw. "I will show you the way," it said, "if you can answer my question first."', illustration: 'A yellow submarine in front of tall green kelp, with a small red crab waving.' },
      { heading: 'The Sunken Ship', narrative: 'Beyond the kelp lay an old sunken ship. Pearl the turtle was waiting on the deck. "The reef is fading because the old lantern fish cannot find their way home," she said. "The map is in this chest." The chest has a puzzle lock, and it is rusty and stubborn.', illustration: 'A friendly sea turtle on the deck of a sunken wooden ship beside a treasure chest.' },
      { heading: 'The Dark Trench', narrative: 'The map led down into a deep, dark trench. Far below, tiny lights were drifting in circles. "The lantern fish are lost!" said Finn. The headlight of the submarine flickered. It needs exactly the right setting to shine into the deep.', illustration: 'A submarine shining a beam of light into dark water where small glowing fish swim in circles.' },
      { heading: 'The Way Home', narrative: 'The lantern fish gathered around the submarine. "Follow us!" called Pearl. But the current at the mouth of the trench was strong. To lead everyone home safely, Finn needs to solve one last problem.', illustration: 'A parade of glowing fish following a submarine and a turtle up toward a coral reef.' },
    ],
    ending: 'One by one the lantern fish swam back to their caves in the reef. Their glow woke up the sleeping corals, and pink, orange and purple spread across Coral Cove again. Pearl did a happy somersault. "The cove has its colors back," she said, "because you kept thinking!"',
  },
  {
    themes: ['robots', 'video games', 'building', 'cars and trains', 'toys'],
    title: 'Bolt and the Midnight Workshop',
    chapters: [
      { heading: 'The Robot Who Woke Up', narrative: 'At midnight, something went click in the old workshop. A small robot named Bolt opened its eyes for the very first time. On the workbench lay a note: "Dear Bolt, the Great Invention Fair is tomorrow, and I am stuck in the snow. Please finish our machine. Your inventor, Ada." Bolt looked at the plans. The first step is a puzzle.', illustration: 'A small robot with big round eyes reads a note on a messy workbench at night.' },
      { heading: 'The Missing Gear', narrative: 'The machine needed one special gear, and it was nowhere to be seen. Bolt searched the shelves and found a locked drawer labeled "Gears". The drawer had a dial on it. Only the right answer will turn the dial.', illustration: 'A robot stands in front of a wall of drawers, one with a shiny dial.' },
      { heading: 'A Helper in the Rafters', narrative: 'Squeak the workshop mouse scurried down from the rafters. "I know where the battery is," she squeaked. "It is across the room, past the tangle of wires." The floor was a jumble of cables. Bolt needs a plan to cross it without tripping.', illustration: 'A tiny mouse wearing a bottle-cap helmet points across a floor covered in colorful cables.' },
      { heading: 'The First Test', narrative: 'Gear in place, battery connected: Bolt pressed the green button. The machine coughed, wobbled and stopped. "Good inventors test and improve," said Squeak. Bolt opened the control panel. One thing inside is not right, and it has to be found.', illustration: 'A wobbly machine puffing a small cloud of smoke while a robot looks into its open control panel.' },
      { heading: 'Morning at the Fair', narrative: 'As the sun came up, Bolt and Squeak rolled the machine to the fair. The judges walked closer. "What does it do?" they asked. Bolt reached for the start lever. It only moves when the final puzzle is solved.', illustration: 'A robot and a mouse stand proudly next to a colorful machine in a sunny fairground.' },
    ],
    ending: 'The machine hummed, whirred and blew a hundred shimmering bubbles into the morning sky. The crowd clapped, and just then Ada came running through the gate, snow still on her boots. "You finished it!" she cried. "We finished it," said Bolt, "with a very clever helper."',
  },
  {
    themes: ['dinosaurs', 'animals', 'nature', 'garden', 'farm', 'sports'],
    title: 'The Valley of the Gentle Giants',
    chapters: [
      { heading: 'The Egg on the Path', narrative: 'Maya the explorer was hiking with her parrot, Kiwi, when they found a speckled egg in the middle of the path. It was as big as a melon, and it was warm. "It must have rolled out of a nest," said Maya. A map of the valley hung on a signpost, but the trail markers were mixed up. They have to be sorted out first.', illustration: 'A girl with a backpack and a green parrot look at a large speckled egg on a jungle path.' },
      { heading: 'The Wobbly Bridge', narrative: 'The trail led to a rope bridge over a rushing river. Some planks were missing. "We must carry the egg across safely," said Maya. Kiwi counted the planks that were left. Getting across takes some careful thinking.', illustration: 'A rope bridge with missing planks over a river, with a girl carefully holding an egg.' },
      { heading: 'Footprints in the Mud', narrative: 'On the other side, giant footprints crossed the mud. Some were round, and some had three toes. "One of these trails leads to the nest," said Maya. The clues are all there for a good detective.', illustration: 'Huge round and three-toed footprints in brown mud, with a parrot flying above them.' },
      { heading: 'The Sleeping Guardian', narrative: 'The trail ended at a cave. A huge long-necked dinosaur was fast asleep across the entrance, snoring like thunder. Behind it, Maya could see a nest with one empty space. "We must not startle it," whispered Maya. There is a quiet way past, and it has to be worked out.', illustration: 'A giant long-necked dinosaur sleeping in front of a cave with a nest of eggs behind it.' },
      { heading: 'Crack!', narrative: 'Maya placed the egg in the nest. Just then, it began to wobble. Crack! A line ran across the shell. The big dinosaur opened one eye. "It is hatching," said Kiwi, "and it is cold in here." The baby needs help with one last thing.', illustration: 'An egg with a crack in a nest, a girl kneeling beside it, and a big dinosaur eye watching.' },
    ],
    ending: 'The shell split, and a tiny dinosaur poked out its head and squeaked. The giant mother nuzzled her baby, then lowered her long neck and gave Maya a gentle nudge that meant thank you. Kiwi flapped with joy. "The best explorers," he squawked, "are the ones who keep thinking!"',
  },
  {
    themes: ['fairy tales', 'superheroes', 'art', 'music', 'cooking'],
    title: 'The Dragon Who Could Not Sleep',
    chapters: [
      { heading: 'A Rumble in the Tower', narrative: 'Every night, a great rumble shook the castle. It was Ember the dragon, yawning in her tower. She had not slept for a week, and nobody knew why. Princess Tilly, the royal inventor, packed her tool belt. The tower door was sealed with a number riddle that must be solved first.', illustration: 'A girl with a tool belt and a small crown stands at a tall wooden door in a castle tower.' },
      { heading: 'The Staircase of Tiles', narrative: 'Behind the door, a spiral staircase wound upward. Each step was a colored tile, and some tiles were missing. "The steps follow a pattern," said Tilly. To climb safely, the pattern has to be finished.', illustration: 'A spiral staircase made of colorful tiles with a few gaps, lit by a lantern.' },
      { heading: 'The Grumpy Owl', narrative: 'Halfway up sat Professor Hoot, the castle owl. "The dragon cannot sleep because something is missing from her tower," he said. "I will tell you what it is, but first you must prove you are a careful thinker." He ruffled his feathers and asked his question.', illustration: 'A large owl wearing tiny glasses sits on a stair railing and looks down at the princess.' },
      { heading: 'The Music Box', narrative: 'The owl nodded. "Her music box is broken. Its lullaby is how she falls asleep." Tilly found the music box on a dusty shelf. Its gears were jumbled. To play again, they must go back in the right way.', illustration: 'An open golden music box with small gears scattered around it on a shelf.' },
      { heading: 'One Last Note', narrative: 'The music box began to play, but one note was missing. At the top of the tower, Ember the dragon blinked her huge, tired eyes. "So close," she sighed, and a puff of smoke curled from her nose. The last note is hidden in a final puzzle.', illustration: 'A big sleepy red dragon curled around the top of a tower, listening to a small music box.' },
    ],
    ending: 'The lullaby rang out, sweet and whole. Ember the dragon gave an enormous yawn, curled her tail around her nose and fell fast asleep. That night the castle was quiet at last. In the morning the king made Tilly the Royal Problem Solver, and her clever helper too.',
  },
];

/**
 * A story outline for the theme. `chapters` is clamped to 2..5; shorter stories keep the
 * opening chapters and always finish with the final chapter. The same theme always gives the
 * same story.
 */
export function pickOfflineStory(theme: string, chapters: number): StoryOutline {
  const seed = hashText(theme.trim().toLowerCase());
  const key = resolveTheme(theme, createRng(seed)).info.key;
  const tale = TALES.find((entry) => entry.themes.includes(key)) ?? (TALES[seed % TALES.length] as Tale);
  const count = Math.min(5, Math.max(2, Number.isFinite(chapters) ? Math.round(chapters) : 3));
  const picked = [...tale.chapters.slice(0, count - 1), tale.chapters[4]];
  return StoryOutlineSchema.parse({ title: tale.title, chapters: picked, ending: tale.ending });
}
