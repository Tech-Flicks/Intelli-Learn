import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, STRANDS } from '@/core/types';
import { t } from '@/i18n';
import { COMPANIONS } from '@/progression';
import { CHILD_STRINGS } from './strings';

const en = CHILD_STRINGS.en ?? {};
const es = CHILD_STRINGS.es ?? {};
const hi = CHILD_STRINGS.hi ?? {};

/** Keys that exist only where a language needs them (see `strings.ts`). */
function isLanguageSpecific(key: string): boolean {
  return (
    /^child\.badge\..+\.(name|reason)$/.test(key) || // English uses the catalogue text
    key.startsWith('child.item.') ||
    key.endsWith('.gender') ||
    key.endsWith('.phrase.f')
  );
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('child strings', () => {
  it('has every English text in Spanish and Hindi, with the same placeholders', () => {
    for (const [key, text] of Object.entries(en)) {
      for (const [name, bundle] of [
        ['es', es],
        ['hi', hi],
      ] as const) {
        expect(bundle[key], `${name}: ${key}`).toBeTypeOf('string');
        expect(placeholders(bundle[key] ?? ''), `${name}: ${key}`).toEqual(placeholders(text));
      }
    }
  });

  it('has no Spanish or Hindi text without an English one, except the language-specific keys', () => {
    for (const bundle of [es, hi]) {
      for (const key of Object.keys(bundle)) {
        if (!isLanguageSpecific(key)) expect(en[key], key).toBeTypeOf('string');
      }
    }
    expect(Object.keys(es).filter(isLanguageSpecific).length).toBeGreaterThan(0);
  });

  it('names every world, companion and growth stage', () => {
    for (const strand of STRANDS) expect(en[`child.home.world.${strand}`]).toBeTypeOf('string');
    for (const companion of COMPANIONS) expect(en[`child.companion.species.${companion.species}`]).toBeTypeOf('string');
    for (let growth = 0; growth <= 4; growth += 1) expect(en[`child.companion.growth.${growth}`]).toBeTypeOf('string');
  });

  it('registers the strings with the i18n runtime, next to the shared mode names', () => {
    expect(t('child.picker.title')).toBe('Who is playing?');
    for (const mode of MODES) expect(t(`mode.${mode}`)).not.toBe(`mode.${mode}`);
  });

  it('only keeps keys that the module uses', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(here)
      .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.') && file !== 'strings.ts')
      .map((file) => readFileSync(join(here, file), 'utf8'))
      .join('\n');
    // Keys built at run time: `child.badge.${key}.hint`, `child.studio.char.${id}.phrase`, ...
    const dynamic = [
      /^child\.badge\./,
      /^child\.item\./,
      /^child\.theme\./,
      /^child\.companion\./,
      /^child\.home\.world\.(math|science|technology|engineering|logic)$/,
      /^child\.studio\.(char|act|place)\./,
      /^child\.shelf\.name\.err\./,
      /^child\.studio\.err\.mic\./,
    ];
    for (const key of Object.keys(en)) {
      if (dynamic.some((pattern) => pattern.test(key))) continue;
      expect(source.includes(`'${key}'`), key).toBe(true);
    }
  });
});
