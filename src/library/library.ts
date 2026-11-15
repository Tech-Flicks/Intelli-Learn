/**
 * The canvas library: every validated AI-built challenge is kept in `db.library`,
 * shared by all children on the device, so that a parent can review and rate it
 * and so that it can be served again (or remixed) for another child at the same
 * level instead of being generated a second time.
 *
 * The library knows nothing about a child except opaque ids in `seenBy`.
 */
import { clampStage, newId, stageGrade } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import { getSkill } from '@/core/skills';
import { AGE_GROUPS } from '@/core/types';
import type {
  AgeGroup,
  AttemptOutcome,
  ChallengePlan,
  Grade,
  InteractionKind,
  LibraryItem,
  Locale,
  Mode,
  Strand,
} from '@/core/types';
import { db } from '@/data';
import { fingerprintOf } from './fingerprint';

/** Longest note a parent can leave with a rating. */
export const LIBRARY_NOTE_MAX = 500;
/** How many low-rating notes are passed on as things to avoid, and how long each may be. */
export const AVOID_NOTES_LIMIT = 5;
export const AVOID_NOTE_MAX = 200;

/**
 * Modes whose canvases only make sense where they were made: a story chapter
 * belongs to its story, a studio canvas to the idea a child typed, and a
 * real-world mission must never reach a child whose parent switched missions
 * off. They are kept and can be rated, but a plain quest never reuses them.
 */
const CONTEXT_BOUND_MODES: readonly Mode[] = ['story', 'studio', 'mission'];

export interface SaveToLibraryInput {
  content: Challenge;
  plan: ChallengePlan;
  ageGroup: AgeGroup;
  locale: Locale;
  origin: 'ai' | 'remix';
  remixOf?: string | null;
}

/** A rating counts as low (1 or 2 stars) below 2.5, so a stray half star from a backup is still classed. */
function isLowRating(rating: number | null): boolean {
  return rating !== null && rating < 2.5;
}

function isHighRating(rating: number | null): boolean {
  return rating !== null && rating >= 3.5;
}

/**
 * Saves a validated AI-built challenge. Returns the existing item when a canvas
 * with the same fingerprint is already stored (the caller should then serve
 * that item's `content`, and check `retired` and `seenBy` first).
 *
 * Throws when `content` does not pass `ChallengeSchema`: nothing that fails the
 * schema may enter the library, or the device's backup could not be restored.
 */
export async function saveToLibrary(input: SaveToLibraryInput, now: number = Date.now()): Promise<LibraryItem> {
  const content = ChallengeSchema.parse(input.content);
  const fingerprint = fingerprintOf(content);
  const stage = clampStage(input.plan.stage);
  return db.transaction('rw', db.library, async () => {
    const existing = await db.library.where('fingerprint').equals(fingerprint).first();
    if (existing) return existing;
    const item: LibraryItem = {
      id: newId('lib'),
      fingerprint,
      skillId: input.plan.skillId,
      strand: input.plan.strand,
      stage,
      grade: stageGrade(stage),
      interaction: content.interaction.kind,
      mode: input.plan.mode,
      theme: input.plan.theme.trim(),
      ageGroup: input.ageGroup,
      locale: input.locale,
      content,
      origin: input.origin,
      remixOf: input.origin === 'remix' ? (input.remixOf ?? null) : null,
      rating: null,
      ratingNote: '',
      retired: false,
      seenBy: [],
      uses: 0,
      independentSolves: 0,
      assistedSolves: 0,
      createdAt: now,
      lastUsedAt: null,
    };
    await db.library.add(item);
    return item;
  });
}

function ageGroupsAreClose(a: AgeGroup, b: AgeGroup): boolean {
  const indexA = AGE_GROUPS.indexOf(a);
  const indexB = AGE_GROUPS.indexOf(b);
  return indexA >= 0 && indexB >= 0 && Math.abs(indexA - indexB) <= 1;
}

/** Serving order by rating: 5 stars, 4 stars, not rated yet, 3 stars. */
function ratingRank(rating: number | null): number {
  if (rating === null) return 2;
  if (rating >= 4.5) return 0;
  if (rating >= 3.5) return 1;
  return 3;
}

const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The best library item for the plan that this child has not seen, or null.
 *
 * An item fits when it has the plan's skill, grade (and a stage within one step),
 * interaction and locale, an equal or neighbouring age group, is not retired and
 * not rated 1 or 2. A plan in a creative mode only takes items of that mode; a
 * quest takes any mode except the context-bound ones (story, studio, mission).
 *
 * Order: rating 5, 4, unrated, 3; then fewer uses; then newest.
 * `themeFits` tells whether the item's theme is the plan's theme or one of the
 * child's interests; when it is not, the caller may remix the item.
 */
export async function findReusable(
  plan: ChallengePlan,
  child: { id: string; ageGroup: AgeGroup; interests: string[] },
  locale: Locale,
): Promise<{ item: LibraryItem; themeFits: boolean } | null> {
  const stage = clampStage(plan.stage);
  const rows = await db.library
    .where('[skillId+grade+interaction]')
    .equals([plan.skillId, stageGrade(stage), plan.interaction])
    .toArray();
  const fitting = rows.filter((item) => {
    if (item.retired || isLowRating(item.rating)) return false;
    if (item.locale !== locale || !ageGroupsAreClose(item.ageGroup, child.ageGroup)) return false;
    if (Math.abs(item.stage - stage) > 1) return false;
    if (item.seenBy.includes(child.id)) return false;
    if (plan.mode === 'quest') return !CONTEXT_BOUND_MODES.includes(item.mode);
    return item.mode === plan.mode;
  });
  fitting.sort(
    (a, b) => ratingRank(a.rating) - ratingRank(b.rating) || a.uses - b.uses || b.createdAt - a.createdAt,
  );
  const item = fitting[0];
  if (!item) return null;
  const themeFits =
    sameText(item.theme, plan.theme) || child.interests.some((interest) => sameText(interest, item.theme));
  return { item, themeFits };
}

/** Counts one serve of the item to the child: the child will not get it again. A missing item is ignored. */
export async function markServed(libraryId: string, childId: string, now: number = Date.now()): Promise<void> {
  await db.library
    .where('id')
    .equals(libraryId)
    .modify((item) => {
      if (!item.seenBy.includes(childId)) item.seenBy = [...item.seenBy, childId];
      item.uses += 1;
      item.lastUsedAt = now;
    });
}

/**
 * Notes that the child has met this canvas without counting a serve. Used for
 * the original of a remix: the child got the remix, so the original (the same
 * idea in other clothes) is not offered to that child afterwards.
 */
export async function markSeen(libraryId: string, childId: string): Promise<void> {
  await db.library
    .where('id')
    .equals(libraryId)
    .modify((item) => {
      if (!item.seenBy.includes(childId)) item.seenBy = [...item.seenBy, childId];
    });
}

/**
 * Adds how a child did on the item. Solved without help (first try or after
 * trying again) counts as independent; a nudge, hint or walkthrough as assisted.
 * A missing item is ignored.
 */
export async function recordLibraryOutcome(libraryId: string, outcome: AttemptOutcome): Promise<void> {
  const alone = outcome === 'independent' || outcome === 'second-try';
  await db.library
    .where('id')
    .equals(libraryId)
    .modify((item) => {
      if (alone) item.independentSolves += 1;
      else item.assistedSolves += 1;
    });
}

function cleanNote(note: string): string {
  return Array.from(note.trim()).slice(0, LIBRARY_NOTE_MAX).join('').trim();
}

/**
 * Sets the parent's rating (1-5 whole stars, or null to clear it) and, when
 * given, the note. A rating of 1 or 2 retires the item. An item that was retired
 * by its low rating comes back when the rating is raised to 3 or more, or
 * cleared. The rating and note are mirrored to every challenge that points at
 * the item. Throws on an invalid rating or an unknown item.
 */
export async function rateLibraryItem(libraryId: string, rating: number | null, note?: string): Promise<LibraryItem> {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw new Error('A rating must be a whole number of stars from 1 to 5.');
  }
  return db.transaction('rw', db.library, db.challenges, async () => {
    const item = await db.library.get(libraryId);
    if (!item) throw new Error(`Library item not found: ${libraryId}`);
    const retiredByRating = item.retired && isLowRating(item.rating);
    const low = isLowRating(rating);
    const updated: LibraryItem = {
      ...item,
      rating,
      ratingNote: note === undefined ? item.ratingNote : cleanNote(note),
      retired: low ? true : retiredByRating ? false : item.retired,
    };
    await db.library.put(updated);
    await db.challenges
      .filter((challenge) => challenge.libraryId === libraryId)
      .modify({ parentRating: updated.rating, parentNote: updated.ratingNote });
    return updated;
  });
}

/** Takes an item out of circulation, or puts it back. A missing item is ignored. */
export async function setRetired(libraryId: string, retired: boolean): Promise<void> {
  await db.library.update(libraryId, { retired });
}

/**
 * What parents disliked about canvases for this skill: the notes of items rated
 * 1 or 2, newest item first, at most five, each cut to 200 characters. They are
 * passed to the AI as things to avoid.
 */
export async function avoidNotesFor(skillId: string): Promise<string[]> {
  const rows = await db.library.where('skillId').equals(skillId).toArray();
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const item of rows.sort((a, b) => b.createdAt - a.createdAt)) {
    if (!isLowRating(item.rating)) continue;
    const note = Array.from(item.ratingNote.replace(/\s+/g, ' ').trim()).slice(0, AVOID_NOTE_MAX).join('').trim();
    const key = note.toLowerCase();
    if (note === '' || seen.has(key)) continue;
    seen.add(key);
    notes.push(note);
    if (notes.length >= AVOID_NOTES_LIMIT) break;
  }
  return notes;
}

export interface LibraryStats {
  /** Canvases kept on the device. */
  total: number;
  /** Canvases a parent has rated. */
  rated: number;
  retired: number;
  /** Serves that came from the library instead of a new AI request: every use of an item after its first. */
  reusedServes: number;
}

export async function libraryStats(): Promise<LibraryStats> {
  const stats: LibraryStats = { total: 0, rated: 0, retired: 0, reusedServes: 0 };
  await db.library.each((item) => {
    stats.total += 1;
    if (item.rating !== null) stats.rated += 1;
    if (item.retired) stats.retired += 1;
    stats.reusedServes += Math.max(0, item.uses - 1);
  });
  return stats;
}

export interface LibraryFilter {
  strand?: Strand;
  grade?: Grade;
  interaction?: InteractionKind;
  mode?: Mode;
  /** 'unrated', 'low' (1-2 stars), 'high' (4-5 stars) or an exact number of stars. */
  rating?: 'unrated' | 'low' | 'high' | number;
  retired?: boolean;
  /** Words to look for in the title, question, intro, theme and skill name. Every word must be found. */
  search?: string;
}

function ratingMatches(rating: number | null, wanted: NonNullable<LibraryFilter['rating']>): boolean {
  if (wanted === 'unrated') return rating === null;
  if (wanted === 'low') return isLowRating(rating);
  if (wanted === 'high') return isHighRating(rating);
  return rating !== null && Math.round(rating) === wanted;
}

function searchText(item: LibraryItem): string {
  const skill = getSkill(item.skillId);
  return [item.content.title, item.content.question, item.content.intro, item.theme, skill?.name ?? '', item.skillId]
    .join(' \n ')
    .toLowerCase();
}

/** The library for the parent area, newest first. Every given filter must match. */
export async function listLibrary(filter: LibraryFilter = {}): Promise<LibraryItem[]> {
  const words = (filter.search ?? '').toLowerCase().split(/\s+/).filter((word) => word !== '');
  const matches = (item: LibraryItem): boolean => {
    if (filter.strand !== undefined && item.strand !== filter.strand) return false;
    if (filter.grade !== undefined && item.grade !== filter.grade) return false;
    if (filter.interaction !== undefined && item.interaction !== filter.interaction) return false;
    if (filter.mode !== undefined && item.mode !== filter.mode) return false;
    if (filter.retired !== undefined && item.retired !== filter.retired) return false;
    if (filter.rating !== undefined && !ratingMatches(item.rating, filter.rating)) return false;
    if (words.length > 0) {
      const text = searchText(item);
      if (!words.every((word) => text.includes(word))) return false;
    }
    return true;
  };
  const rows =
    filter.strand !== undefined && filter.grade !== undefined
      ? await db.library.where('[strand+grade]').equals([filter.strand, filter.grade]).toArray()
      : await db.library.toArray();
  return rows.filter(matches).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
}

/**
 * Removes a canvas for good. Challenges that were served from it stay in the
 * child's history with `libraryId` cleared, and remixes of it lose their
 * `remixOf` link. A missing item is ignored.
 */
export async function deleteLibraryItem(id: string): Promise<void> {
  await db.transaction('rw', db.library, db.challenges, async () => {
    await db.library.delete(id);
    await db.library.filter((item) => item.remixOf === id).modify({ remixOf: null });
    await db.challenges.filter((challenge) => challenge.libraryId === id).modify({ libraryId: null });
  });
}
