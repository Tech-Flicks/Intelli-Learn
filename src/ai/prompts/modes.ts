/**
 * The creative brief for each play mode and the framing for each reason an
 * item was chosen. These go into the user message of a challenge prompt.
 */
import type { ItemPurpose, Mode, StageStep } from '@/core/types';
import { HELPER_NAME } from './shared';

export const MODE_NAMES: Record<Mode, string> = {
  quest: 'Quest',
  story: 'Story Quest',
  experiment: 'Experiment Lab',
  robot: 'Robot Coder',
  detective: 'Mystery Detective',
  fixbot: 'Fix the Bot',
  invention: 'Invention Workshop',
  wonder: 'Wonder of the Day',
  studio: 'Imagination Studio',
  mission: 'Real-world Mission',
};

export const MODE_BRIEFS: Record<Mode, string> = {
  quest:
    'A themed mini-adventure. A friendly character has a small, concrete problem that only this skill can solve. Give the character a name and a goal, and let the scene show the moment of the problem.',
  story:
    'A chapter of a running story (given below). The hero is stuck at exactly the moment the chapter ends on, and solving this challenge is what moves the story on. The intro picks up the chapter in one or two sentences, and the scene shows the chapter illustration.',
  experiment:
    'Predict, then explain. Describe a simple pretend experiment: the set-up goes in the intro and is drawn in the scene. The question asks the child to PREDICT what will happen (or which result fits) before it is revealed. The explanation tells what happens and why, like a page from a scientist\'s notebook that starts with "We saw that...".',
  robot:
    'A robot needs a program. Frame the grid as a mission (deliver, rescue, collect, explore). Hints talk about planning the path first and spotting stretches that repeat; they never list the blocks.',
  detective:
    'A cosy mystery with clues and deduction: a missing sock, a mixed-up label, a mystery footprint, who left the paint prints. Never a crime, never danger. Give 2 to 4 clues in the intro or as labelled objects in the scene. The answer must follow from the clues by reasoning, and each hint points back at one clue.',
  fixbot: `${HELPER_NAME} the helper robot tried this problem and made exactly ONE mistake. Show ${HELPER_NAME}'s worked solution as short numbered steps (in the intro, or as text objects in the scene). The question asks the child to find the step that went wrong, or to give the result ${HELPER_NAME} should have got. Exactly one step is wrong, and it is a mistake children of this grade really make. Be kind to ${HELPER_NAME}: finding mistakes is how robots and people learn.`,
  invention:
    'The child is the engineer and builds under a budget. A character needs a gadget; each part adds some power and has a cost. The build must reach the target without going over the budget. Several selections may work, but taking everything must not. The explanation talks about the trade-off the child just made.',
  wonder:
    'Open the intro with one surprising TRUE fact about the theme, in the form "Did you know...?". Then ask a question that uses the skill and is connected to that fact. Put a second true fact in "funFact".',
  studio:
    'The child asked to see something of their own (their idea is in the child_input block). Draw that idea as the scene, as richly as the scene format allows; this is where one small SVG drawing shines. Then ask a question about the picture that practises the skill. If the block is missing, or the idea is not a harmless thing to draw, ignore it completely and draw a friendly scene for the theme instead.',
  mission:
    'A safe, screen-free task, then a report. The child does something right where they are, indoors, in under two minutes, with no tools, no heat, no water, no climbing and no going outside: clap and count, count their own fingers or steps, compare two hands, find a shape by looking around. Then they come back and REPORT by answering the question. The answer must be one the app can check without seeing the room: design the task so its result is fixed (for example "clap this pattern and count your claps") or ask which statement must be true.',
};

export const PURPOSE_BRIEFS: Record<ItemPurpose, string> = {
  placement:
    'Placement item: a clean, typical item for this expectation that shows clearly whether the child can do it. No tricks, no extra reading load, no second skill mixed in.',
  core: 'Core practice: a fresh item on this expectation, pitched exactly at the stage step.',
  review:
    'Spaced review: the child learned this a while ago. A quick, friendly item that brings the idea back, in a context they have not seen.',
  stretch:
    'Stretch item: a little above the child\'s comfort zone. Keep the question demanding, and make the two hints especially supportive.',
  sibling:
    'Easier sibling: the child needed a full walkthrough on the previous question (given below). Make a clearly EASIER item on the same idea: smaller or friendlier numbers, fewer steps, and a scene that shows more of the thinking. Do not repeat the same numbers or story.',
  check:
    'Concept check: the child seems ready to move up, and this item decides it. Test the SAME concept in a NEW way: a context, a framing and numbers that differ from the previous questions (given below). No extra scaffolding in the question or the scene; it must show real understanding, not a remembered pattern.',
};

export const STEP_BRIEFS: Record<StageStep, string> = {
  starting:
    'Starting: the easiest items for this expectation. The simplest case, small friendly numbers, one step, and strong scaffolding (the scene shows everything that is needed, and the hints give a lot of support).',
  growing: 'Growing: typical items for this expectation. Standard cases, moderate numbers, light scaffolding.',
  strong:
    'Strong: harder items for this expectation. Less familiar contexts, bigger or less friendly numbers, two ideas combined, little scaffolding.',
  ready:
    'Ready for the next grade: the hardest items for this expectation, edging toward the next grade. An unfamiliar context, transfer of the idea or one extra step of reasoning, and no scaffolding in the question.',
};
