/**
 * Public API of the canvas library: keep, rate, reuse and remix built challenges.
 * Other modules import from `@/library`.
 */
export { fingerprintOf } from './fingerprint';

export {
  saveToLibrary,
  findReusable,
  markServed,
  markSeen,
  recordLibraryOutcome,
  rateLibraryItem,
  setRetired,
  avoidNotesFor,
  libraryStats,
  listLibrary,
  deleteLibraryItem,
  LIBRARY_NOTE_MAX,
  AVOID_NOTES_LIMIT,
  AVOID_NOTE_MAX,
} from './library';
export type { SaveToLibraryInput, LibraryFilter, LibraryStats } from './library';
