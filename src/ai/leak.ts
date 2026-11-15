/**
 * Detects help text that gives the answer away. The app owns the help ladder:
 * a hint or a tutor reply that states the answer would turn an "independent"
 * solve into a copied one, so such text is rejected or replaced.
 *
 * The check is a heuristic for the two kinds where an answer can be said in a
 * word or two (number and choice). It errs on the side of flagging.
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

/** Number words by language, for the values where a word is commonly written. "One" is left out: it is everywhere. */
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
  }
  return false;
}

function mentionsLabel(folded: string, label: string, locale: Locale | undefined, minLength: number): boolean {
  const clean = foldText(label).trim();
  if (/^-?\d+(?:\.\d+)?$/.test(clean)) return mentionsNumber(folded, Number(clean), locale);
  return clean.length >= minLength && containsWord(folded, clean);
}

/**
 * True when the text states the answer of the challenge.
 * - number: the answer appears as a number or number word.
 * - choice: a correct option is named while no wrong option is (naming several options is a comparison, not a giveaway).
 * Other kinds have answers that cannot be blurted out in a word, so they are never flagged.
 */
export function revealsAnswer(challenge: Challenge, text: string, locale?: Locale): boolean {
  const i = challenge.interaction;
  if (i.kind === 'number') return mentionsNumber(text, i.answer, locale);
  if (i.kind === 'choice') {
    const folded = foldText(text);
    const correct = i.options.filter((option) => i.correctIds.includes(option.id));
    const wrong = i.options.filter((option) => !i.correctIds.includes(option.id));
    const namesCorrect = correct.some((option) => mentionsLabel(folded, option.label, locale, 4));
    if (!namesCorrect) return false;
    return !wrong.some((option) => mentionsLabel(folded, option.label, locale, 2));
  }
  return false;
}
