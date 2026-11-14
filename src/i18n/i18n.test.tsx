import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { AGE_GROUPS, GRADES, LOCALES, MODES, STAGE_STEPS, STRANDS } from '@/core/types';
import {
  COMMON_STRINGS,
  LOCALE_NAMES,
  ageGroupName,
  getLocale,
  gradeName,
  gradeShortName,
  hasString,
  modeBlurb,
  modeName,
  registerStrings,
  setLocale,
  stageName,
  starCountText,
  stepBlurb,
  stepName,
  strandName,
  subscribeLocale,
  t,
  tn,
  useLocale,
  useT,
} from './index';

afterEach(() => {
  act(() => setLocale('en'));
});

describe('t', () => {
  it('returns the text for the active locale', () => {
    expect(t('common.cancel')).toBe('Cancel');
    setLocale('es');
    expect(t('common.cancel')).toBe('Cancelar');
    setLocale('hi');
    expect(t('common.cancel')).toBe('रद्द करें');
  });

  it('falls back to English, then to the key', () => {
    registerStrings({ en: { 'test.onlyEnglish': 'Only English' } });
    setLocale('es');
    expect(t('test.onlyEnglish')).toBe('Only English');
    expect(t('test.missing.key')).toBe('test.missing.key');
  });

  it('fills {name} variables and leaves unknown ones alone', () => {
    registerStrings({ en: { 'test.hello': 'Hi {name}, you have {count} {thing}. {name}!' } });
    expect(t('test.hello', { name: 'Robo', count: 3 })).toBe('Hi Robo, you have 3 {thing}. Robo!');
    expect(t('test.hello')).toBe('Hi {name}, you have {count} {thing}. {name}!');
  });

  it('does not read variables from the object prototype', () => {
    registerStrings({ en: { 'test.proto': 'a {constructor} b {toString}' } });
    expect(t('test.proto', {})).toBe('a {constructor} b {toString}');
  });

  it('does not treat prototype names as dictionary keys', () => {
    expect(t('constructor')).toBe('constructor');
    expect(hasString('toString')).toBe(false);
  });
});

describe('registerStrings', () => {
  it('merges bundles from several modules without dropping earlier keys', () => {
    registerStrings({ en: { 'test.a': 'A' }, es: { 'test.a': 'A-es' } });
    registerStrings({ en: { 'test.b': 'B' } });
    expect(t('test.a')).toBe('A');
    expect(t('test.b')).toBe('B');
    setLocale('es');
    expect(t('test.a')).toBe('A-es');
    expect(t('test.b')).toBe('B');
  });

  it('lets a later registration replace a key', () => {
    registerStrings({ en: { 'test.replace': 'old' } });
    registerStrings({ en: { 'test.replace': 'new' } });
    expect(t('test.replace')).toBe('new');
  });

  it('reports whether a key exists', () => {
    registerStrings({ en: { 'test.exists': 'x' } });
    expect(hasString('test.exists')).toBe(true);
    expect(hasString('test.exists', 'hi')).toBe(true);
    expect(hasString('test.nope')).toBe(false);
  });
});

describe('tn', () => {
  it('picks singular or plural and fills {count}', () => {
    expect(tn('common.star', 'common.stars', 1)).toBe('1 star');
    expect(tn('common.star', 'common.stars', 0)).toBe('0 stars');
    expect(tn('common.star', 'common.stars', 7)).toBe('7 stars');
    setLocale('es');
    expect(tn('common.star', 'common.stars', 1)).toBe('1 estrella');
    expect(tn('common.star', 'common.stars', 2)).toBe('2 estrellas');
    setLocale('hi');
    expect(tn('common.star', 'common.stars', 1)).toBe('1 सितारा');
    expect(tn('common.star', 'common.stars', 5)).toBe('5 सितारे');
  });

  it('passes extra variables through', () => {
    registerStrings({ en: { 'test.one': '{who} has {count} gem', 'test.many': '{who} has {count} gems' } });
    expect(tn('test.one', 'test.many', 2, { who: 'Pip' })).toBe('Pip has 2 gems');
  });
});

describe('setLocale', () => {
  it('updates getLocale and <html lang>', () => {
    setLocale('hi');
    expect(getLocale()).toBe('hi');
    expect(document.documentElement.lang).toBe('hi');
  });

  it('falls back to English for an unknown locale', () => {
    setLocale('es');
    // A value from outside the type system, e.g. an old backup.
    setLocale('xx' as never);
    expect(getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('notifies subscribers only on a real change', () => {
    let calls = 0;
    const off = subscribeLocale(() => {
      calls += 1;
    });
    setLocale('en');
    expect(calls).toBe(0);
    setLocale('es');
    expect(calls).toBe(1);
    off();
    setLocale('hi');
    expect(calls).toBe(1);
  });
});

describe('useT and useLocale', () => {
  function Label() {
    const tr = useT();
    const locale = useLocale();
    return (
      <p>
        {locale}: {tr('common.save')}
      </p>
    );
  }

  it('re-renders when the locale changes', () => {
    render(<Label />);
    expect(screen.getByText('en: Save')).toBeInTheDocument();
    act(() => setLocale('es'));
    expect(screen.getByText('es: Guardar')).toBeInTheDocument();
  });

  it('re-renders when strings are registered later', () => {
    function Late() {
      const tr = useT();
      return <p>{tr('test.late')}</p>;
    }
    render(<Late />);
    expect(screen.getByText('test.late')).toBeInTheDocument();
    act(() => registerStrings({ en: { 'test.late': 'Arrived' } }));
    expect(screen.getByText('Arrived')).toBeInTheDocument();
  });
});

describe('common bundle', () => {
  it('names every locale', () => {
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale].length).toBeGreaterThan(0);
  });

  it('has the same keys in every language, with no empty text', () => {
    const keys = Object.keys(COMMON_STRINGS.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(COMMON_STRINGS[locale]).sort()).toEqual(keys);
      for (const text of Object.values(COMMON_STRINGS[locale])) expect(text.trim()).not.toBe('');
    }
  });

  it('keeps the same {variables} in every translation', () => {
    const varsOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, text] of Object.entries(COMMON_STRINGS.en)) {
      for (const locale of LOCALES) {
        expect(varsOf(COMMON_STRINGS[locale][key] ?? ''), `${locale} ${key}`).toEqual(varsOf(text));
      }
    }
  });

  it('covers every grade, step, strand, age group and mode in every language', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const grade of GRADES) {
        expect(gradeName(grade)).not.toContain('grade.');
        expect(gradeShortName(grade)).not.toContain('grade.');
      }
      for (const step of STAGE_STEPS) {
        expect(stepName(step)).not.toContain('step.');
        expect(stepBlurb(step)).not.toContain('step.');
      }
      for (const strand of STRANDS) expect(strandName(strand)).not.toContain('strand.');
      for (const age of AGE_GROUPS) expect(ageGroupName(age)).not.toContain('age.');
      for (const mode of MODES) {
        expect(modeName(mode)).not.toContain('mode.');
        expect(modeBlurb(mode)).not.toContain('mode.');
      }
    }
  });
});

describe('name helpers', () => {
  it('match the core English labels', () => {
    expect(gradeName('PK')).toBe('Pre-K');
    expect(gradeName('K')).toBe('Kindergarten');
    expect(gradeName('3')).toBe('Grade 3');
    expect(stepName('ready')).toBe('Ready for next grade');
    expect(stageName(makeStage('3', 'strong'))).toBe('Grade 3, Strong');
    expect(stageName(0)).toBe('Pre-K, Starting');
    expect(stageName(39)).toBe('Grade 8, Ready for next grade');
  });

  it('translate', () => {
    setLocale('es');
    expect(gradeName('3')).toBe('Tercer grado');
    expect(stageName(makeStage('K', 'growing'))).toBe('Kínder, Creciendo');
    expect(strandName('math')).toBe('Matemáticas');
    expect(modeName('robot')).toBe('Programa al robot');
    expect(starCountText(1)).toBe('1 estrella');
    setLocale('hi');
    expect(gradeName('5')).toBe('कक्षा 5');
    expect(strandName('science')).toBe('विज्ञान');
    expect(modeBlurb('wonder')).toBe('हमारी दुनिया की एक अनोखी बात जानो।');
    expect(starCountText(4)).toBe('4 सितारे');
  });
});
