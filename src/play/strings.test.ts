import { describe, expect, it } from 'vitest';
import { BOT_STRINGS } from '@/bot';
import type { StringBundle } from '@/i18n';
import { LINE_COUNTS, PLAY_STRINGS } from './strings';

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

describe.each<[string, StringBundle]>([
  ['play', PLAY_STRINGS],
  ['bot', BOT_STRINGS],
])('%s strings', (_name, bundle) => {
  const en = bundle.en ?? {};

  it.each(['es', 'hi'] as const)('has every English key in %s, with the same placeholders', (locale) => {
    const other = bundle[locale] ?? {};
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(en)) {
      expect(other[key]?.trim(), key).not.toBe('');
      expect(placeholders(other[key] ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('never talks about skipping, tests or wrong answers in what the child reads', () => {
    for (const locale of ['en', 'es', 'hi'] as const) {
      for (const text of Object.values(bundle[locale] ?? {})) {
        expect(text).not.toMatch(/\bskip\b|\bsaltar\b|\btest\b|\bexam(en)?\b|\bwrong\b|\bincorrect[oa]?\b/i);
      }
    }
  });
});

describe('rotating lines', () => {
  it.each(Object.entries(LINE_COUNTS))('has %s lines 1 to %i in every language', (group, count) => {
    const prefix = group === 'loading' ? 'play.loading.' : group === 'wrong' ? 'play.wrong.' : 'play.solved.';
    for (const locale of ['en', 'es', 'hi'] as const) {
      for (let line = 1; line <= count; line += 1) expect(PLAY_STRINGS[locale]?.[`${prefix}${line}`], `${locale} ${prefix}${line}`).toBeTruthy();
    }
  });
});
