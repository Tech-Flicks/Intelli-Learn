import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTEREST_SUGGESTIONS } from '@/core/defaults';
import { INTERACTION_KINDS } from '@/core/types';
import { t } from '@/i18n';
import { BADGES } from '@/progression';
import { PARENT_STRINGS } from './strings';

const en = PARENT_STRINGS.en ?? {};
const es = PARENT_STRINGS.es ?? {};
const hi = PARENT_STRINGS.hi ?? {};

/** Badge names: English uses the catalogue text, the other languages carry their own. */
function isLanguageSpecific(key: string): boolean {
  return key.startsWith('parent.badge.');
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') && !name.startsWith('strings.') && !name.startsWith('testSupport') ? [path] : [];
  });
}

describe('parent strings', () => {
  it('has every English text in Spanish and Hindi, with the same placeholders', () => {
    for (const [key, text] of Object.entries(en)) {
      for (const [name, bundle] of [
        ['es', es],
        ['hi', hi],
      ] as const) {
        expect(bundle[key], `${name}: ${key}`).toBeTypeOf('string');
        expect(bundle[key], `${name}: ${key}`).not.toBe('');
        expect(placeholders(bundle[key] ?? ''), `${name}: ${key}`).toEqual(placeholders(text));
      }
    }
  });

  it('has no Spanish or Hindi text without an English one, except the badge names', () => {
    for (const bundle of [es, hi]) {
      for (const key of Object.keys(bundle)) {
        if (!isLanguageSpecific(key)) expect(en[key], key).toBeTypeOf('string');
      }
    }
  });

  it('names every badge in Spanish and Hindi', () => {
    for (const badge of BADGES) {
      expect(es[`parent.badge.${badge.key}`], badge.key).toBeTypeOf('string');
      expect(hi[`parent.badge.${badge.key}`], badge.key).toBeTypeOf('string');
    }
  });

  it('names every suggested interest and every interaction kind', () => {
    for (const interest of INTEREST_SUGGESTIONS) expect(en[`parent.interest.${interest}`], interest).toBeTypeOf('string');
    for (const kind of INTERACTION_KINDS) expect(en[`parent.kind.${kind}`], kind).toBeTypeOf('string');
  });

  it('registers the strings with the i18n runtime', () => {
    expect(t('parent.gate.unlock')).toBe('Unlock');
    expect(t('parent.typed.label', { word: 'RESET' })).toBe('Type RESET to confirm');
  });

  it('only uses keys that exist, and only keeps keys that are used', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = sourceFiles(here)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    for (const match of source.matchAll(/'(parent\.[A-Za-z0-9_.\- ]+)'/g)) {
      const key = match[1] ?? '';
      expect(en[key], key).toBeTypeOf('string');
    }

    // Keys built at run time: `parent.kind.${kind}`, `parent.a11y.${key}Hint`, ...
    const dynamic = [
      /^parent\.(nav|kind|outcome|purpose|source|interest)\./,
      /^parent\.answer\.robot\.(forward|left|right)$/,
      /^parent\.wizard\.(step|welcome\.(learn|device|control)|done\.ai)\./,
      /^parent\.child\.tab\./,
      /^parent\.ai\.mode\.(demo|direct|proxy)$/,
      /^parent\.controls\.(dailyMinutes|voiceOutput|microphone|openChat|aiImages|realWorldMissions|strictness|keepTranscripts|strict|standard|subjects)$/,
      /^parent\.progress\.(reason|notes)\./,
      /^parent\.history\.(hintLevel|messageKind)\./,
      /^parent\.rating\.meaning\./,
      /^parent\.a11y\./,
      /^parent\.settings\.section\./,
      /^parent\.about\./,
    ];
    for (const key of Object.keys(en)) {
      if (dynamic.some((pattern) => pattern.test(key))) continue;
      expect(source.includes(`'${key}'`), key).toBe(true);
    }
  });
});
