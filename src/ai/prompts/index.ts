/** Prompt builders: pure functions that return `{ system, user }`. */
export { buildChallengePrompt, buildRemixPrompt, PROMPT_SVG_LIMIT } from './challenge';
export { buildTutorPrompt, describeAnswerKey, walkthroughIndex, HISTORY_LIMIT } from './tutor';
export { buildStoryPrompt, clampChapters } from './story';
export { buildNotesPrompt, NOTES_ATTEMPT_LIMIT } from './notes';
export { buildReportPrompt, percent } from './report';
export { buildImagePrompt, IMAGE_STYLE_PREFIX } from './image';
export { KIND_EXAMPLES, KIND_SHAPES } from './kinds';
export { MODE_BRIEFS, MODE_NAMES, PURPOSE_BRIEFS, STEP_BRIEFS } from './modes';
export {
  ageStyleCard,
  childInputBlock,
  cleanChildText,
  cleanList,
  oneLine,
  markerBlock,
  MARKER_LINE,
  HELPER_NAME,
  LANGUAGE_NAMES,
  CHILD_INPUT_MAX,
  type Prompt,
} from './shared';
