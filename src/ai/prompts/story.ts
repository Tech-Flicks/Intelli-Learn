/** Prompt for a Story Quest outline: a short tale whose chapters each stop where the hero needs help. */
import type { StoryOutlineRequest } from '../types';
import {
  JSON_ONLY_RULE,
  ageSection,
  cleanGrownUpList,
  languageSection,
  markerBlock,
  markerValue,
  oneLine,
  roleSection,
  safetySection,
  type Prompt,
} from './shared';

/** Chapters wanted, clamped to what the schema allows (2 to 5, default 3). */
export function clampChapters(chapters: number): number {
  return Math.min(5, Math.max(2, Number.isFinite(chapters) ? Math.round(chapters) : 3));
}

const EXAMPLE = {
  title: 'The Kite That Wanted to See the Sea',
  chapters: [
    {
      heading: 'A Tug on the String',
      narrative:
        'Mina the fox was flying her red kite when it tugged hard, twice. "It wants to go somewhere," said Mina. The kite pointed its nose at the hills. But the gate to the hill path had a puzzle lock, and it was shut tight.',
      illustration: 'A small fox holds the string of a red kite in a windy meadow, next to a wooden gate.',
    },
    {
      heading: 'The Singing Bridge',
      narrative:
        'Beyond the gate, a rope bridge hummed in the wind. Each plank played a note. Some planks were missing, and the tune sounded wrong. Mina had to work out what was missing before she could cross.',
      illustration: 'A rope bridge over a stream with a few gaps between the planks, and a kite flying above.',
    },
  ],
  ending:
    'At the top of the last hill, the sea sparkled all the way to the sky. The kite danced, and Mina laughed. "We made it," she said, "because someone clever helped us think."',
};

export function buildStoryPrompt(req: StoryOutlineRequest): Prompt {
  const chapters = clampChapters(req.chapters);
  const theme = oneLine(req.theme, 60);
  const system = [
    markerBlock([
      ['TASK', 'story'],
      ['THEME', markerValue(theme, 'surprise')],
      ['CHAPTERS', String(chapters)],
    ]),
    roleSection(),
    'Your job now: write the outline of a short, cosy adventure story. The app will add one learning challenge at the end of every chapter.',
    safetySection(req.child.strictness),
    ageSection(req.child.ageGroup),
    [
      '# Story rules',
      `- Exactly ${chapters} chapters that tell one connected story with the same hero and one clear goal.`,
      '- The hero is an invented animal, robot or child character with an invented name. Never use the name of a real person, and never a character from a book, film or game.',
      '- Each chapter narrative is two to five sentences and ends at a moment where the hero needs to solve a problem to go on (a lock, a riddle, a missing piece, a choice). It is a gentle cliffhanger, never a dangerous one.',
      '- Do NOT write the puzzle itself and do not include numbers to calculate: the app supplies the challenge. Just stop where one is needed.',
      '- "illustration" is one sentence that describes the picture for the chapter: who, where, what they are doing. No text in the picture.',
      '- "ending" is a happy ending that thanks the "clever helper" (the child) without using any name.',
      '- The story must sound good read aloud.',
    ].join('\n'),
    [
      '# Output: one JSON object',
      JSON_ONLY_RULE,
      '{ "title": string (max 80), "chapters": [{ "heading": string (max 60), "narrative": string (max 700), "illustration": string (max 200) }], "ending": string (max 500) }',
      `Example of the format with 2 chapters (format only; never reuse its story): ${JSON.stringify(EXAMPLE)}`,
    ].join('\n'),
    languageSection(req.child.locale),
  ].join('\n\n');

  const interests = cleanGrownUpList(req.child.interests, 5, 40).filter((interest) => interest.toLowerCase() !== theme.toLowerCase());
  const user = [
    'Write the story outline from this data.',
    '',
    `Theme: ${theme === '' ? 'your choice of a cheerful theme' : theme}`,
    `Number of chapters: ${chapters}`,
    ...(interests.length > 0 ? [`Other things this child likes (optional flavour): ${interests.join(', ')}`] : []),
  ].join('\n');
  return { system, user };
}
