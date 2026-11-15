/**
 * Public API of the challenge engine. Other modules import from '@/engine' only.
 */
export type { Answer, CheckResult, RobotProgram, RobotStep } from './types';
export { checkAnswer } from './check';
export { runRobot, solveRobot } from './robot';
export { buildIsSolvable } from './build';
export { validateChallengeContent } from './validate';
export { normalizeChallenge } from './normalize';
export { sanitizeSvg } from './svg';
export { SceneCanvas } from './scene/SceneCanvas';
export type { SceneCanvasProps } from './scene/SceneCanvas';
export { ChallengeStage } from './ChallengeStage';
export type { ChallengeStageProps, StageLabels } from './ChallengeStage';
/** The built-in English texts. Translations live in `@/i18n` (`stageLabels()`), which is tested against these. */
export { DEFAULT_LABELS as DEFAULT_STAGE_LABELS } from './widgets/common';
export { EngineGallery } from './EngineGallery';
export { SAMPLE_CHALLENGES } from './samples';
