/**
 * `@/i18n`: UI strings and `t()`.
 *
 * Modules add their own strings with `registerStrings` at import time and read
 * them with `t` (plain code) or `useT` (React components).
 */
import './common';

export {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  getLocale,
  hasString,
  isLocale,
  registerStrings,
  setLocale,
  subscribeLocale,
  t,
  tn,
  useLocale,
  useT,
} from './core';
export type { StringBundle, Translate, TranslateVars } from './core';
export { COMMON_STRINGS } from './common';
export {
  ageGroupName,
  gradeName,
  gradeShortName,
  modeBlurb,
  modeName,
  stageName,
  starCountText,
  stepBlurb,
  stepName,
  strandName,
} from './names';
export { STAGE_LABEL_KEYS, STAGE_LABEL_STRINGS, stageLabels, useStageLabels } from './stageLabels';
export type { StageLabelKey, StageLabelStrings } from './stageLabels';
