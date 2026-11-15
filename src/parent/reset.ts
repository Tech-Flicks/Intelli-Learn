/**
 * The full reset behind "forgot password" and the danger zone.
 *
 * The kids' area keeps a few challenges ready in the background. A build that is still
 * running could write a row after the wipe, so the reset waits for the supply to go idle
 * first (a few seconds at most: a reset must never hang on it).
 */
import { wipeEverything } from '@/data';

const SUPPLY_WAIT_MS = 5000;

export async function resetDevice(): Promise<void> {
  try {
    // Loaded on demand: the parent area does not otherwise need the play module.
    const { supplyIdle } = await import('@/play');
    await Promise.race([supplyIdle(), new Promise<void>((resolve) => setTimeout(resolve, SUPPLY_WAIT_MS))]);
  } catch {
    // Without the play module there is no supply to wait for.
  }
  await wipeEverything();
}
