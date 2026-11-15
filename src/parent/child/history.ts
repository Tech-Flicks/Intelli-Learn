/** The history timeline as data: joining challenges with their attempts, and filtering. Pure. */
import type { AttemptOutcome, AttemptRecord, ChallengeRecord, Mode, Strand } from '@/core/types';
import { dayStart } from '../format';

export interface HistoryEntry {
  challenge: ChallengeRecord;
  /** Missing for a completed challenge whose attempt row was lost (an old or partial backup). */
  attempt: AttemptRecord | null;
  /** When it was finished, for ordering and the date filter. */
  at: number;
}

export interface HistoryFilter {
  strand: Strand | '';
  outcome: AttemptOutcome | '';
  mode: Mode | '';
  /** `YYYY-MM-DD`, inclusive. Empty = no bound. */
  from: string;
  to: string;
}

export const EMPTY_HISTORY_FILTER: HistoryFilter = { strand: '', outcome: '', mode: '', from: '', to: '' };

export function isFiltering(filter: HistoryFilter): boolean {
  return filter.strand !== '' || filter.outcome !== '' || filter.mode !== '' || filter.from !== '' || filter.to !== '';
}

/** Completed challenges with their attempts, newest first. */
export function buildHistory(challenges: readonly ChallengeRecord[], attempts: readonly AttemptRecord[]): HistoryEntry[] {
  const byChallenge = new Map<string, AttemptRecord>();
  for (const attempt of attempts) {
    const known = byChallenge.get(attempt.challengeId);
    if (!known || attempt.completedAt > known.completedAt) byChallenge.set(attempt.challengeId, attempt);
  }
  return challenges
    .filter((challenge) => challenge.status === 'completed')
    .map((challenge) => {
      const attempt = byChallenge.get(challenge.id) ?? null;
      return { challenge, attempt, at: attempt?.completedAt ?? challenge.completedAt ?? challenge.createdAt };
    })
    .sort((a, b) => b.at - a.at || (a.challenge.id < b.challenge.id ? -1 : 1));
}

export function filterHistory(entries: readonly HistoryEntry[], filter: HistoryFilter): HistoryEntry[] {
  const from = filter.from === '' ? null : dayStart(filter.from);
  const toStart = filter.to === '' ? null : dayStart(filter.to);
  // The "to" day is included: everything before the next local midnight.
  const to = toStart === null ? null : new Date(new Date(toStart).getFullYear(), new Date(toStart).getMonth(), new Date(toStart).getDate() + 1).getTime();
  return entries.filter((entry) => {
    if (filter.strand !== '' && entry.challenge.strand !== filter.strand) return false;
    if (filter.mode !== '' && entry.challenge.mode !== filter.mode) return false;
    if (filter.outcome !== '' && entry.attempt?.outcome !== filter.outcome) return false;
    if (from !== null && entry.at < from) return false;
    if (to !== null && entry.at >= to) return false;
    return true;
  });
}
