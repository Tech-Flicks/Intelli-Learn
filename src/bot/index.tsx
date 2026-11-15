/**
 * Public API of the helper bot. Other modules import from `@/bot`.
 *
 * `HelperBot` floats over the play screen and reads the challenge from
 * `usePlaySession` (`@/play`). The mascot itself lives in `./pip` and is
 * re-exported here.
 */
export { HelperBot } from './HelperBot';
export { Pip, PIP_STATES, PipGallery, isPipState, usePipMood } from './pip';
export type { PipLookAt, PipMoodOptions, PipProps, PipReact, PipState } from './pip';
export { BOT, botSize, pipStateFor, positionKey } from './geometry';
export { BOT_STRINGS } from './strings';
