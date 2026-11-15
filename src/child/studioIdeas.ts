/**
 * Imagination Studio: the picture chips a child builds an idea from, and the rules for an
 * idea the child types or says.
 *
 * Every phrase is fixed text from `strings.ts`, so a built idea is always safe to pass on.
 */
import { localSafetyCheck } from '@/ai';
import { hasString, t } from '@/i18n';

export interface IdeaChip {
  id: string;
  emoji: string;
}

export const IDEA_CHARACTERS: readonly IdeaChip[] = [
  { id: 'dragon', emoji: '🐉' },
  { id: 'robot', emoji: '🤖' },
  { id: 'cat', emoji: '🐱' },
  { id: 'astronaut', emoji: '🧑‍🚀' },
  { id: 'octopus', emoji: '🐙' },
  { id: 'dinosaur', emoji: '🦖' },
  { id: 'penguin', emoji: '🐧' },
  { id: 'unicorn', emoji: '🦄' },
];

export const IDEA_ACTIONS: readonly IdeaChip[] = [
  { id: 'baking', emoji: '🍪' },
  { id: 'flying', emoji: '🪁' },
  { id: 'building', emoji: '🧱' },
  { id: 'dancing', emoji: '💃' },
  { id: 'exploring', emoji: '🧭' },
  { id: 'racing', emoji: '🏁' },
  { id: 'painting', emoji: '🎨' },
  { id: 'counting', emoji: '⭐' },
];

export const IDEA_PLACES: readonly IdeaChip[] = [
  { id: 'moon', emoji: '🌙' },
  { id: 'sea', emoji: '🌊' },
  { id: 'jungle', emoji: '🌴' },
  { id: 'castle', emoji: '🏰' },
  { id: 'farm', emoji: '🚜' },
  { id: 'lab', emoji: '🔬' },
  { id: 'mountain', emoji: '🏔️' },
  { id: 'treehouse', emoji: '🌳' },
];

export type IdeaRow = 'character' | 'action' | 'place';

export const IDEA_ROWS: readonly { row: IdeaRow; titleKey: string; prefix: string; chips: readonly IdeaChip[] }[] = [
  { row: 'character', titleKey: 'child.studio.who', prefix: 'child.studio.char', chips: IDEA_CHARACTERS },
  { row: 'action', titleKey: 'child.studio.does', prefix: 'child.studio.act', chips: IDEA_ACTIONS },
  { row: 'place', titleKey: 'child.studio.where', prefix: 'child.studio.place', chips: IDEA_PLACES },
];

export interface IdeaChoice {
  character: string | null;
  action: string | null;
  place: string | null;
}

export const EMPTY_IDEA: IdeaChoice = { character: null, action: null, place: null };

/** Ready-made ideas for the "surprise" buttons. */
export const SURPRISE_IDEAS: readonly Required<{ [K in IdeaRow]: string }>[] = [
  { character: 'octopus', action: 'baking', place: 'moon' },
  { character: 'dinosaur', action: 'dancing', place: 'castle' },
  { character: 'robot', action: 'painting', place: 'jungle' },
  { character: 'penguin', action: 'racing', place: 'farm' },
  { character: 'unicorn', action: 'counting', place: 'mountain' },
  { character: 'cat', action: 'building', place: 'treehouse' },
  { character: 'astronaut', action: 'flying', place: 'sea' },
  { character: 'dragon', action: 'exploring', place: 'lab' },
];

/** `count` different surprise ideas. `random` is injectable for tests. */
export function pickSurprises(count: number, random: () => number = Math.random): typeof SURPRISE_IDEAS {
  const pool = [...SURPRISE_IDEAS];
  const picked: (typeof SURPRISE_IDEAS)[number][] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    const [idea] = pool.splice(index, 1);
    if (idea) picked.push(idea);
  }
  return picked;
}

function chipOf(chips: readonly IdeaChip[], id: string | null): IdeaChip | null {
  return chips.find((chip) => chip.id === id) ?? null;
}

/** The three emoji of a choice, for the preview and the surprise buttons. */
export function ideaEmoji(choice: IdeaChoice): string {
  return [
    chipOf(IDEA_CHARACTERS, choice.character)?.emoji,
    chipOf(IDEA_ACTIONS, choice.action)?.emoji,
    chipOf(IDEA_PLACES, choice.place)?.emoji,
  ]
    .filter(Boolean)
    .join(' ');
}

export function isCompleteIdea(choice: IdeaChoice): choice is { character: string; action: string; place: string } {
  return (
    chipOf(IDEA_CHARACTERS, choice.character) !== null &&
    chipOf(IDEA_ACTIONS, choice.action) !== null &&
    chipOf(IDEA_PLACES, choice.place) !== null
  );
}

/**
 * The sentence for a complete choice in the active language, e.g. "A dragon baking cookies
 * on the moon". Returns null while a row is still open. Word order comes from the
 * `child.studio.sentence` template; a language whose verbs agree with the character's
 * gender registers `<character>.gender` and `<action>.phrase.<gender>`.
 */
export function buildIdea(choice: IdeaChoice): string | null {
  if (!isCompleteIdea(choice)) return null;
  const gender = t(`child.studio.char.${choice.character}.gender`);
  const gendered = `child.studio.act.${choice.action}.phrase.${gender}`;
  const action = hasString(gendered) ? t(gendered) : t(`child.studio.act.${choice.action}.phrase`);
  return t('child.studio.sentence', {
    character: t(`child.studio.char.${choice.character}.phrase`),
    action,
    place: t(`child.studio.place.${choice.place}.phrase`),
  })
    .replace(/\s+/g, ' ')
    .trim();
}

export const TYPED_IDEA_MAX_LENGTH = 80;

/** Cuts text to the idea limit without splitting a character. */
export function clipIdea(text: string): string {
  return Array.from(text).slice(0, TYPED_IDEA_MAX_LENGTH).join('');
}

export type TypedIdeaResult = { ok: true; idea: string } | { ok: false; problem: 'empty' | 'unsafe' };

/** Tidies and checks an idea the child typed or said: one line, at most 80 characters, and safe. */
export function checkTypedIdea(raw: string, strictness: 'strict' | 'standard' = 'strict'): TypedIdeaResult {
  const idea = clipIdea(raw.replace(/\s+/g, ' ').trim()).trim();
  if (idea === '') return { ok: false, problem: 'empty' };
  if (!localSafetyCheck(idea, strictness).safe) return { ok: false, problem: 'unsafe' };
  return { ok: true, idea };
}
