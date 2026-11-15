/**
 * Public API of the play module. Other modules import from `@/play`.
 *
 * - the challenge supply queue (`./supply`),
 * - the play session store that the helper bot reads and drives (`./session`),
 * - the play screen, mounted by the app shell at `/kids/:childId/play`.
 */
export {
  SUPPLY,
  advanceStory,
  buildContext,
  ensureQueue,
  makeSibling,
  prepareConceptCheck,
  resetSupply,
  setSupplyDeps,
  startStory,
  supplyIdle,
  takeNext,
} from './supply';
export type { SupplyDeps } from './supply';

export { playHomePath, recordSettled, resetPlaySession, setPlayDeps, usePlaySession } from './session';
export type {
  BotMessage,
  BotOffer,
  PlayDeps,
  PlaySessionActions,
  PlaySessionData,
  PlaySessionState,
  StoryView,
  TeachBackView,
} from './session';

export { PLAY, canWalkthrough, frameOf, parseRequest } from './machine';
export type { Frame, HintLevel, PlayPhase, PlayRequest, RewardSummary, Run } from './machine';

export { PLAY_STRINGS } from './strings';

export { PlayScreen } from './PlayScreen';
