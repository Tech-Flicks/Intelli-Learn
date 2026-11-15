/**
 * Detects help text that gives the answer away. The app owns the help ladder:
 * a hint or a tutor reply that states the answer would turn an "independent"
 * solve into a copied one, so such text is rejected or replaced.
 *
 * The check is a heuristic and errs on the side of flagging:
 * - number: the answer as digits or as a number word (also "twenty-one"). A number that the
 *   question itself gives ("8 birds, 4 fly away": answer 4) may be repeated; it only counts
 *   when it is stated as the result ("leaves 4", "= 4", "4 are left");
 * - choice: a correct option named while no wrong one is. A correct label that is a word of the
 *   question ("True or false: ...") only counts when it is presented as the answer;
 * - order: the items listed in the order of the key;
 * - sort and match: two or more things named together with their group or partner.
 * Tap, robot and build answers cannot be said in words and are not flagged.
 */
import type { Challenge } from '@/core/schemas';
import type { Locale } from '@/core/types';
import { foldText } from './safety';

const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function containsWord(haystack: string, needle: string): boolean {
  if (needle === '') return false;
  return new RegExp(`(?<!${WORD_CHAR})${escapeRegex(needle)}(?!${WORD_CHAR})`, 'u').test(haystack);
}

/** Number words by language, for the values where a word is commonly written. "One" is left out: it is everywhere (see ONE_AS_ANSWER). */
const NUMBER_WORDS: Record<Locale, Record<number, string[]>> = {
  en: {
    0: ['zero'], 2: ['two'], 3: ['three'], 4: ['four'], 5: ['five'], 6: ['six'], 7: ['seven'], 8: ['eight'], 9: ['nine'], 10: ['ten'],
    11: ['eleven'], 12: ['twelve'], 13: ['thirteen'], 14: ['fourteen'], 15: ['fifteen'], 16: ['sixteen'], 17: ['seventeen'],
    18: ['eighteen'], 19: ['nineteen'], 20: ['twenty'], 30: ['thirty'], 40: ['forty'], 50: ['fifty'], 60: ['sixty'], 70: ['seventy'],
    80: ['eighty'], 90: ['ninety'], 100: ['hundred'], 1000: ['thousand'],
  },
  es: {
    0: ['cero'], 2: ['dos'], 3: ['tres'], 4: ['cuatro'], 5: ['cinco'], 6: ['seis'], 7: ['siete'], 8: ['ocho'], 9: ['nueve'], 10: ['diez'],
    11: ['once'], 12: ['doce'], 13: ['trece'], 14: ['catorce'], 15: ['quince'], 16: ['dieciseis'], 17: ['diecisiete'],
    18: ['dieciocho'], 19: ['diecinueve'], 20: ['veinte'], 30: ['treinta'], 40: ['cuarenta'], 50: ['cincuenta'], 100: ['cien'], 1000: ['mil'],
  },
  hi: {
    0: ['शून्य'], 3: ['तीन'], 4: ['चार'], 5: ['पांच'], 6: ['छह', 'छः'], 7: ['सात'], 8: ['आठ'], 9: ['नौ'], 10: ['दस'], 20: ['बीस'], 100: ['सौ'],
  },
};

const DEVANAGARI_ZERO = 0x0966;

function asciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - DEVANAGARI_ZERO));
}

/** English tens and units, for "twenty-one" and "twenty one". */
const EN_TENS: Record<number, string> = { 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety' };
const EN_UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const ES_TENS: Record<number, string> = { 30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta', 70: 'setenta', 80: 'ochenta', 90: 'noventa' };
const ES_UNITS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
/** 21 to 29 are single words in Spanish (accents are folded away before matching). */
const ES_TWENTIES = ['', 'veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve'];

/** Patterns for a number between 21 and 99 that is written as two words. */
function compoundPatterns(value: number, language: Locale): string[] {
  if (!Number.isInteger(value) || value < 21 || value > 99 || value % 10 === 0) return [];
  const tens = Math.floor(value / 10) * 10;
  const unit = value % 10;
  if (language === 'en') return [`${EN_TENS[tens]}[\\s-]+${EN_UNITS[unit]}`];
  if (language === 'es') {
    if (tens === 20) return [ES_TWENTIES[unit] ?? '', `veinti${unit === 1 ? 'un[oa]?' : ES_UNITS[unit]}`].filter((word) => word !== '');
    return [`${ES_TENS[tens]}\\s+y\\s+${unit === 1 ? 'un[oa]?' : ES_UNITS[unit]}`];
  }
  return [];
}

function containsPattern(haystack: string, pattern: string): boolean {
  return new RegExp(`(?<!${WORD_CHAR})(?:${pattern})(?!${WORD_CHAR})`, 'u').test(haystack);
}

/**
 * "One" as an answer. The word is everywhere ("one more try", "each one", "which one"),
 * so it only counts after a verb that states a result and not before a word that makes
 * it part of a phrase.
 */
const ONE_AS_ANSWER =
  /(?<![\p{L}\p{M}\p{N}_])(?:is|are|was|equals?|makes?|leaves?|gives?|have|has|get|gets|answer|=)\s+(?:just\s+|only\s+|exactly\s+)?one(?![\p{L}\p{M}\p{N}_])(?!\s+(?:more|of|at|by|way|step|thing|time|try|that|which|who|to|you|we|part|side|group|kind|idea|trick|clue|hint)(?![\p{L}\p{M}\p{N}_]))/u;

/** True when the text names the number, in digits or (for common values) as a word. */
export function mentionsNumber(text: string, value: number, locale?: Locale): boolean {
  if (!Number.isFinite(value)) return false;
  const target = Math.abs(value);
  const folded = asciiDigits(foldText(text)).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  for (const match of folded.matchAll(/\d+(?:\.\d+)?/g)) {
    if (Number(match[0]) === target) return true;
  }
  const locales: Locale[] = locale ? [locale] : ['en', 'es', 'hi'];
  for (const language of locales) {
    for (const word of NUMBER_WORDS[language]?.[target] ?? []) {
      if (containsWord(folded, word)) return true;
    }
    for (const pattern of compoundPatterns(target, language)) {
      if (containsPattern(folded, pattern)) return true;
    }
  }
  if (target === 1 && (locale === undefined || locale === 'en') && ONE_AS_ANSWER.test(folded)) return true;
  return false;
}

/** Every way the number may be written in the text: digits, and the number words of the language(s). */
function numberForms(value: number, locale?: Locale): string[] {
  const target = Math.abs(value);
  const forms = [`${escapeRegex(String(target))}(?!\\.?\\d)`];
  const locales: Locale[] = locale ? [locale] : ['en', 'es', 'hi'];
  for (const language of locales) {
    for (const word of NUMBER_WORDS[language]?.[target] ?? []) forms.push(escapeRegex(word));
    forms.push(...compoundPatterns(target, language));
  }
  if (target === 1 && (locale === undefined || locale === 'en')) forms.push('one');
  return forms;
}

/** Words after which a number is a result, per language (folded text). "Is" and "are" are not among them: "there are 4 birds". */
const RESULT_LEAD =
  '(?:equals?|makes?|leaves?|gives?|get|gets|answer(?:\\s+is)?|total(?:\\s+is)?|igual\\s+a|quedan?|sobran?|respuesta(?:\\s+es)?|resultado(?:\\s+es)?|उत्तर|जवाब|बराबर)';
/** Words that make the number before them what is left over. */
const RESULT_TAIL = '(?:[\\p{L}\\p{M}]+\\s+){0,2}(?:left|remain(?:s|ing)?)';

/**
 * True when the text states the number as a result: after "=", after a word such as "leaves" or
 * "makes", or as what is left. Used for a number that the question itself gives, where a plain
 * mention ("take away 4") is no giveaway.
 */
export function statesNumberAsResult(text: string, value: number, locale?: Locale): boolean {
  if (!Number.isFinite(value)) return false;
  const folded = asciiDigits(foldText(text)).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const number = `(?:${numberForms(value, locale).join('|')})`;
  const lead = `(?:=\\s*|(?<!${WORD_CHAR})${RESULT_LEAD}\\s+(?:just\\s+|only\\s+|exactly\\s+)?)`;
  const stated = new RegExp(`${lead}(?<![\\p{L}\\p{M}\\p{N}_.])${number}(?!${WORD_CHAR})`, 'u');
  const leftOver = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_.])${number}\\s+${RESULT_TAIL}(?!${WORD_CHAR})`, 'u');
  return stated.test(folded) || leftOver.test(folded);
}

/** True when the text gives the number answer away: it names it, and not merely as something the question gave. */
function revealsNumber(challenge: Challenge, text: string, answer: number, locale?: Locale): boolean {
  if (!mentionsNumber(text, answer, locale)) return false;
  const given = mentionsNumber(`${challenge.intro} ${challenge.question}`, answer, locale);
  return !given || statesNumberAsResult(text, answer, locale);
}

function mentionsLabel(folded: string, label: string, locale: Locale | undefined, minLength: number): boolean {
  const clean = foldText(label).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(clean)) return mentionsNumber(folded, Number(clean), locale);
  return clean.length >= minLength && containsWord(folded, clean);
}

/** Words that present what follows as the answer ("the answer is ...", "pick the ..."). */
const ANSWER_LEAD =
  "(?:answer|answers|correct|right\\s+one|it's|its|it\\s+is|that\\s+is|that's|pick|choose|select|tap|press|go\\s+with|respuesta|correcta|correcto|elige|escoge|toca|जवाब|उत्तर|चुनो|सही)";

/**
 * A short correct label (2 or 3 characters: "Cat", "Yes") is too common a word to flag
 * wherever it appears, so it must be presented as the answer.
 */
function presentsShortLabel(folded: string, label: string): boolean {
  const clean = foldText(label).trim();
  if (clean.length > 3) return false;
  return presentsLabel(folded, label);
}

/** True when the text presents the label as the answer ("it is false", "pick the triangle"). */
function presentsLabel(folded: string, label: string): boolean {
  const clean = foldText(label).trim();
  if (clean.length < 2 || /^-?\d/.test(clean)) return false;
  return new RegExp(`(?<!${WORD_CHAR})${ANSWER_LEAD}(?!${WORD_CHAR})[^.!?।]{0,24}(?<!${WORD_CHAR})${escapeRegex(clean)}(?!${WORD_CHAR})`, 'u').test(folded);
}

/** Where the label first appears in the text as a whole word, or -1. */
function positionOf(folded: string, label: string): number {
  const clean = foldText(label).trim();
  if (clean.length < 2) return -1;
  const match = new RegExp(`(?<!${WORD_CHAR})${escapeRegex(clean)}(?!${WORD_CHAR})`, 'u').exec(folded);
  return match ? match.index : -1;
}

/** The text cut where a new statement begins: one item with its group or partner sits inside one piece. */
function clausesOf(folded: string): string[] {
  return folded.split(/[.;!?।\n]+|,?\s+(?:and|but|while|y|pero|और)\s+/u).filter((clause) => clause.trim() !== '');
}

/** How many items the text lists in the order of the key, when it lists them in no other order. */
function listedInKeyOrder(folded: string, labels: readonly string[]): number {
  const found = labels
    .map((label, keyIndex) => ({ keyIndex, at: positionOf(folded, label) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < found.length; i += 1) {
    if ((found[i]?.keyIndex ?? 0) <= (found[i - 1]?.keyIndex ?? 0)) return 0;
  }
  return found.length;
}

/** How many `[thing, where it belongs]` pairs the text states: both named in one clause, with no other target beside them. */
function statedPairs(folded: string, pairs: readonly (readonly [string, string])[], targets: readonly string[]): number {
  const clauses = clausesOf(folded);
  const distinctTargets = [...new Set(targets.map((target) => foldText(target).trim()))];
  let stated = 0;
  for (const [thing, target] of pairs) {
    const own = foldText(target).trim();
    const told = clauses.some(
      (clause) =>
        positionOf(clause, thing) >= 0 &&
        positionOf(clause, own) >= 0 &&
        !distinctTargets.some((other) => other !== own && positionOf(clause, other) >= 0),
    );
    if (told) stated += 1;
  }
  return stated;
}

/**
 * True when the text states the answer of the challenge.
 * - number: the answer appears as a number or number word.
 * - choice: a correct option is named while no wrong option is (naming several options is a comparison, not a giveaway).
 * - order: the text lists items in the order of the key and in no other order: all of them, or at least three
 *   (two when there are only three). Naming one step, or two for a comparison, is help.
 * - sort: two or more items are each named together with their own group and no other group.
 * - match: two or more pairs are each named together, with no other partner beside them.
 * Tap, robot and build answers cannot be said in words, so they are never flagged.
 */
export function revealsAnswer(challenge: Challenge, text: string, locale?: Locale): boolean {
  const i = challenge.interaction;
  if (i.kind === 'number') return revealsNumber(challenge, text, i.answer, locale);
  const folded = foldText(text);
  if (i.kind === 'choice') {
    const correct = i.options.filter((option) => i.correctIds.includes(option.id));
    const wrong = i.options.filter((option) => !i.correctIds.includes(option.id));
    const asked = foldText(`${challenge.intro} ${challenge.question}`);
    const namesCorrect = correct.some((option) => {
      if (presentsShortLabel(folded, option.label)) return true;
      const clean = foldText(option.label).trim();
      // A word the question itself uses ("True or false: ...") gives nothing away by being used again.
      if (!/^-?\d/.test(clean) && containsWord(asked, clean)) return presentsLabel(folded, option.label);
      return mentionsLabel(folded, option.label, locale, 4);
    });
    if (!namesCorrect) return false;
    return !wrong.some((option) => mentionsLabel(folded, option.label, locale, 2));
  }
  if (i.kind === 'order') {
    const labels = i.items.map((item) => item.label);
    const needed = Math.max(2, Math.min(3, labels.length - 1));
    return listedInKeyOrder(folded, labels) >= needed;
  }
  if (i.kind === 'sort') {
    const bins = new Map(i.bins.map((bin) => [bin.id, bin.label]));
    const pairs = i.items.map((item) => [item.label, bins.get(item.binId) ?? ''] as const).filter(([, bin]) => bin !== '');
    return statedPairs(folded, pairs, [...bins.values()]) >= Math.min(2, pairs.length);
  }
  if (i.kind === 'match') {
    const pairs = i.pairs.map((pair) => [pair.left.label, pair.right.label] as const);
    return statedPairs(folded, pairs, i.pairs.map((pair) => pair.right.label)) >= Math.min(2, pairs.length);
  }
  return false;
}
