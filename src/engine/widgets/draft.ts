/**
 * The in-progress answer ("draft") for each interaction kind, and its
 * conversion to the `Answer` shape `checkAnswer` understands. Pure logic.
 */
import type { Interaction, NumberInteraction } from '@/core/schemas';
import { shuffledOrderIds } from '../shuffle';
import type { Answer } from '../types';
import { toProgram, type Block } from './robotBlocks';

export type Draft =
  | { kind: 'choice'; ids: string[] }
  | { kind: 'tap'; ids: string[] }
  | { kind: 'sort'; placed: Record<string, string> }
  | { kind: 'match'; links: Record<string, string> }
  | { kind: 'order'; ids: string[] }
  | { kind: 'number'; text: string }
  | { kind: 'robot'; blocks: Block[] }
  | { kind: 'build'; ids: string[] };

export function initialDraft(interaction: Interaction): Draft {
  switch (interaction.kind) {
    case 'choice':
      return { kind: 'choice', ids: [] };
    case 'tap':
      return { kind: 'tap', ids: [] };
    case 'sort':
      return { kind: 'sort', placed: {} };
    case 'match':
      return { kind: 'match', links: {} };
    case 'order':
      return { kind: 'order', ids: shuffledOrderIds(interaction.items) };
    case 'number':
      return { kind: 'number', text: '' };
    case 'robot':
      return { kind: 'robot', blocks: [] };
    case 'build':
      return { kind: 'build', ids: [] };
  }
}

/** Longest number a child can type: sign, 9 digits and a decimal point. */
export const MAX_NUMBER_DIGITS = 9;

/** Value of the keypad text, or null while it is not a number yet ("", "-", "."). */
export function parseNumberText(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '-' | 'back' | 'clear';

/** The keypad text after pressing `key`, respecting what this challenge allows. */
export function pressKey(text: string, key: KeypadKey, rules: Pick<NumberInteraction, 'allowDecimal' | 'allowNegative'>): string {
  if (key === 'clear') return '';
  if (key === 'back') return text.slice(0, -1);
  if (key === '-') {
    if (!rules.allowNegative) return text;
    return text.startsWith('-') ? text.slice(1) : `-${text}`;
  }
  if (key === '.') {
    if (!rules.allowDecimal || text.includes('.')) return text;
    const body = text.replace('-', '');
    return body === '' ? `${text}0.` : `${text}.`;
  }
  const digits = text.replace(/[^0-9]/g, '');
  if (digits.length >= MAX_NUMBER_DIGITS) return text;
  // "0" then "5" reads "5", not "05".
  const sign = text.startsWith('-') ? '-' : '';
  const body = sign ? text.slice(1) : text;
  if (body === '0') return `${sign}${key}`;
  return `${text}${key}`;
}

/** Cleans typed or pasted text down to what the keypad itself could have produced. */
export function sanitizeNumberText(raw: string, rules: Pick<NumberInteraction, 'allowDecimal' | 'allowNegative'>): string {
  let out = '';
  for (const ch of raw.replace(/,/g, '.').replace(/−/g, '-')) {
    if (ch >= '0' && ch <= '9') out = pressKey(out, ch as KeypadKey, rules);
    else if (ch === '.') out = pressKey(out, '.', rules);
    else if (ch === '-' && out === '' && rules.allowNegative) out = '-';
  }
  return out;
}

/** The answer for a complete draft, or null while something is still missing. */
export function draftToAnswer(interaction: Interaction, draft: Draft): Answer | null {
  if (draft.kind !== interaction.kind) return null;
  switch (draft.kind) {
    case 'choice':
    case 'tap':
    case 'build':
      return draft.ids.length > 0 ? draft.ids.slice() : null;
    case 'sort': {
      if (interaction.kind !== 'sort') return null;
      return interaction.items.every((item) => draft.placed[item.id] !== undefined) ? { ...draft.placed } : null;
    }
    case 'match': {
      if (interaction.kind !== 'match') return null;
      return interaction.pairs.every((pair) => draft.links[pair.id] !== undefined) ? { ...draft.links } : null;
    }
    case 'order':
      return draft.ids.slice();
    case 'number':
      return parseNumberText(draft.text);
    case 'robot':
      return draft.blocks.length > 0 ? toProgram(draft.blocks) : null;
  }
}

/** A number as a child would write it: whole numbers plain, decimals to two places. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
