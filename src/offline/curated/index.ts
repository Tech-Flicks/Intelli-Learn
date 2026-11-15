/** The curated bank: hand-written challenges for the creative modes. */
import { DETECTIVE_CASES, EXPERIMENTS, FIXBOT_ITEMS } from './bankA';
import { INVENTIONS, MISSIONS, WONDERS } from './bankB';
import type { CuratedItem } from './make';

export type { CuratedItem } from './make';

export const CURATED: readonly CuratedItem[] = [...EXPERIMENTS, ...DETECTIVE_CASES, ...FIXBOT_ITEMS, ...WONDERS, ...MISSIONS, ...INVENTIONS];

/** Number of hand-written items in the offline bank. */
export const OFFLINE_BANK_SIZE = CURATED.length;
