/**
 * Public API of the progression service: the stage engine, item selection,
 * placement, rewards and parental limits. Other modules import from `@/progression`.
 */
export { TUNING } from './tuning';

export { setRng, seededRng } from './rng';
export type { Rng } from './rng';

export { outcomeOf, detectFrustration } from './outcome';

export { recordAttempt } from './record';
export type { RecordAttemptInput } from './record';

export { planNext, makeSiblingPlan, FALLBACK_THEMES } from './plan';
export type { PlanOptions } from './plan';

export { placementStatus } from './placement';

export { effectiveControls, getPlayAllowance, startSession, tickSession, endSession } from './limits';

export { getStrandStages, weekStats, weekStartOf } from './stats';

export {
  BADGES,
  COLLECTIBLES,
  COMPANIONS,
  companionEmoji,
  companionProgress,
  getBadge,
  getCollectible,
  getCompanionDef,
} from './catalog';
export type { BadgeDef, CollectibleDef, CompanionDef, CompanionProgress } from './catalog';

export { buyCollectible } from './rewards';
