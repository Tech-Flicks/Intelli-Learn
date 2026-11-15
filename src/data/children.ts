/**
 * Child profile CRUD.
 *
 * Profiles are created by a parent. The nickname stays on the device and is
 * never sent to the AI (see "Child safety rules" in docs/ARCHITECTURE.md).
 */
import { DEFAULT_ACCESSIBILITY } from '@/core/defaults';
import { newId } from '@/core/grades';
import { AGE_GROUPS, GRADES } from '@/core/types';
import type { AgeGroup, ChildProfile, Companion, Grade } from '@/core/types';
import { CHILD_TABLES, db } from './db';

export interface NewChildInput {
  nickname: string;
  avatar: string;
  ageGroup: AgeGroup;
  grade: Grade;
  interests: string[];
}

export const NICKNAME_MAX_LENGTH = 20;
export const MAX_INTERESTS = 8;
export const INTEREST_MAX_LENGTH = 30;
const AVATAR_MAX_LENGTH = 16;

/** Companion species a new child can be given. Keys into the companion catalogue in `@/progression`. */
export const COMPANION_SPECIES = ['dragon', 'owl', 'fox', 'robot', 'turtle', 'unicorn'] as const;
export type CompanionSpecies = (typeof COMPANION_SPECIES)[number];

/** Counts user-visible characters closely enough for a length limit (code points, not UTF-16 units). */
function charCount(text: string): number {
  return Array.from(text).length;
}

/** Returns the trimmed nickname, or throws when it is empty or too long. */
export function cleanNickname(nickname: unknown): string {
  if (typeof nickname !== 'string') throw new Error('A nickname is required.');
  const trimmed = nickname.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) throw new Error('A nickname is required.');
  if (charCount(trimmed) > NICKNAME_MAX_LENGTH) {
    throw new Error(`A nickname can have at most ${NICKNAME_MAX_LENGTH} characters.`);
  }
  return trimmed;
}

/**
 * Trims interests, drops empty ones and case-insensitive duplicates, and
 * throws when there are too many or one is too long.
 */
export function cleanInterests(interests: unknown): string[] {
  if (!Array.isArray(interests)) throw new Error('Interests must be a list.');
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of interests) {
    if (typeof raw !== 'string') throw new Error('Each interest must be text.');
    const interest = raw.trim().replace(/\s+/g, ' ');
    if (interest.length === 0) continue;
    if (charCount(interest) > INTEREST_MAX_LENGTH) {
      throw new Error(`An interest can have at most ${INTEREST_MAX_LENGTH} characters.`);
    }
    const key = interest.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(interest);
  }
  if (cleaned.length > MAX_INTERESTS) {
    throw new Error(`Choose at most ${MAX_INTERESTS} interests.`);
  }
  return cleaned;
}

function cleanAvatar(avatar: unknown): string {
  if (typeof avatar !== 'string') throw new Error('An avatar is required.');
  const trimmed = avatar.trim();
  if (trimmed.length === 0) throw new Error('An avatar is required.');
  if (trimmed.length > AVATAR_MAX_LENGTH) throw new Error('The avatar must be a single emoji.');
  return trimmed;
}

function cleanAgeGroup(ageGroup: unknown): AgeGroup {
  if (!(AGE_GROUPS as readonly unknown[]).includes(ageGroup)) {
    throw new Error('Choose an age group.');
  }
  return ageGroup as AgeGroup;
}

function cleanGrade(grade: unknown): Grade {
  if (!(GRADES as readonly unknown[]).includes(grade)) {
    throw new Error('Choose a school grade.');
  }
  return grade as Grade;
}

/** Default text-to-speech rate: slower for the youngest listeners. */
export function defaultVoiceRate(ageGroup: AgeGroup): number {
  if (ageGroup === '3-5') return 0.85;
  if (ageGroup === '6-8') return 0.9;
  return 1.0;
}

/** Interest keywords that suggest a species. Checked in the order the interests were given. */
const INTEREST_SPECIES: ReadonlyArray<readonly [RegExp, CompanionSpecies]> = [
  [/\b(?:robot|comput|cod(?:e|ing)|machine|video game|gam(?:e|ing)|car|train|rocket|build|lego)/, 'robot'],
  [/\b(?:dinosaur|dragon|superhero|volcano|knight|monster|sport|fire)/, 'dragon'],
  [/\b(?:ocean|sea|fish|water|swim|river|beach|weather|nature|turtle)/, 'turtle'],
  [/\b(?:fairy|magic|unicorn|princess|rainbow|art|draw|paint|music|danc)/, 'unicorn'],
  [/\b(?:animal|pet|dog|cat|fox|forest|cook|bak|farm|garden)/, 'fox'],
  [/\b(?:space|star|planet|moon|book|read|science|math|puzzle|owl|bird)/, 'owl'],
];

/** Avatars from the built-in picker that have an obvious matching companion. */
const AVATAR_SPECIES: Readonly<Record<string, CompanionSpecies>> = {
  '🦖': 'dragon',
  '🦉': 'owl',
  '🦊': 'fox',
  '🤖': 'robot',
  '🚀': 'robot',
  '🐙': 'turtle',
  '🐸': 'turtle',
  '🦄': 'unicorn',
};

/** Small stable string hash (FNV-1a, 32 bit). */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Picks the species of a child's companion. Deterministic: the same avatar
 * and interests always give the same species. The first interest with a
 * known theme wins, then the avatar, then a stable hash so that siblings
 * with nothing in common still tend to get different companions.
 */
export function pickCompanionSpecies(avatar: string, interests: readonly string[]): CompanionSpecies {
  for (const interest of interests) {
    const text = interest.toLowerCase();
    for (const [pattern, species] of INTEREST_SPECIES) {
      if (pattern.test(text)) return species;
    }
  }
  const byAvatar = AVATAR_SPECIES[avatar];
  if (byAvatar) return byAvatar;
  const index = hashText(`${avatar}|${interests.join('|').toLowerCase()}`) % COMPANION_SPECIES.length;
  return COMPANION_SPECIES[index] ?? 'dragon';
}

/** A brand-new companion: an unnamed egg that hatches as the child learns. */
export function newEggCompanion(avatar: string, interests: readonly string[]): Companion {
  return { species: pickCompanionSpecies(avatar, interests), name: '', growth: 0, xp: 0 };
}

/**
 * Creates a child profile with every default filled in.
 * Throws an Error with a parent-readable message when the input is not valid.
 */
export async function createChild(input: NewChildInput, now: number = Date.now()): Promise<ChildProfile> {
  const nickname = cleanNickname(input.nickname);
  const avatar = cleanAvatar(input.avatar);
  const ageGroup = cleanAgeGroup(input.ageGroup);
  const grade = cleanGrade(input.grade);
  const interests = cleanInterests(input.interests);

  const child: ChildProfile = {
    id: newId('child'),
    nickname,
    avatar,
    ageGroup,
    grade,
    interests,
    accessibility: { ...DEFAULT_ACCESSIBILITY },
    controlsOverride: {},
    placementDone: false,
    companion: newEggCompanion(avatar, interests),
    stars: 0,
    totalStars: 0,
    collectibles: [],
    voiceRate: defaultVoiceRate(ageGroup),
    streakDays: 0,
    lastPlayedDay: null,
    createdAt: now,
  };
  await db.children.add(child);
  return child;
}

/**
 * Applies a patch to a child profile and returns the saved profile.
 * `id` and `createdAt` cannot be changed. Fields set to `undefined` are ignored.
 * Throws when the child does not exist or a patched field is not valid.
 */
export async function updateChild(id: string, patch: Partial<ChildProfile>): Promise<ChildProfile> {
  const clean: Partial<ChildProfile> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (clean as Record<string, unknown>)[key] = value;
  }
  if ('nickname' in clean) clean.nickname = cleanNickname(clean.nickname);
  if ('avatar' in clean) clean.avatar = cleanAvatar(clean.avatar);
  if ('ageGroup' in clean) clean.ageGroup = cleanAgeGroup(clean.ageGroup);
  if ('grade' in clean) clean.grade = cleanGrade(clean.grade);
  if ('interests' in clean) clean.interests = cleanInterests(clean.interests);

  return db.transaction('rw', db.children, async () => {
    const current = await db.children.get(id);
    if (!current) throw new Error(`Child profile not found: ${id}`);
    const next: ChildProfile = { ...current, ...clean, id: current.id, createdAt: current.createdAt };
    await db.children.put(next);
    return next;
  });
}

/**
 * Removes the small per-child entries other modules keep in `db.kv` (for example the
 * progression module's placement estimates and badge counters). The convention is that
 * such a key ends with `:${childId}`. Must run inside a transaction that includes `db.kv`,
 * or on its own.
 */
export async function deleteChildKeyValues(childIds: readonly string[]): Promise<void> {
  if (childIds.length === 0) return;
  const suffixes = childIds.map((id) => `:${id}`);
  const keys = (await db.kv.toCollection().primaryKeys()).filter((key) => suffixes.some((suffix) => key.endsWith(suffix)));
  if (keys.length > 0) await db.kv.bulkDelete(keys);
}

/**
 * Removes the profile and every record about the child, in one transaction:
 * all rows in `CHILD_TABLES`, the per-child entries in `db.kv` (keys ending in
 * `:${childId}`), and the child's id in the "seen by" lists of the shared
 * canvas library (the canvases themselves stay for the other children).
 */
export async function deleteChild(id: string): Promise<void> {
  const tables = CHILD_TABLES.map((name) => db.table(name));
  await db.transaction('rw', [db.children, db.library, db.kv, ...tables], async () => {
    for (const table of tables) {
      await table.where('childId').equals(id).delete();
    }
    await deleteChildKeyValues([id]);
    await db.library
      .filter((item) => item.seenBy.includes(id))
      .modify((item) => {
        item.seenBy = item.seenBy.filter((seenBy) => seenBy !== id);
      });
    await db.children.delete(id);
  });
}

export function getChild(id: string): Promise<ChildProfile | undefined> {
  return db.children.get(id);
}

/** All profiles, oldest first (the order they appear in the profile picker). */
export function listChildren(): Promise<ChildProfile[]> {
  return db.children.orderBy('createdAt').toArray();
}
