import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LOCALES } from '@/core/types';
import { DEFAULT_STAGE_LABELS, type StageLabels } from '@/engine';
import { setLocale, STAGE_LABEL_KEYS, STAGE_LABEL_STRINGS, stageLabels, useStageLabels, type StageLabelStrings } from './index';

// Compile-time contract: the i18n label set and the engine's `StageLabels` are the same shape, both ways.
const toEngine: StageLabels = {} as StageLabelStrings;
const fromEngine: StageLabelStrings = {} as StageLabels;
void toEngine;
void fromEngine;

const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

afterEach(() => {
  setLocale('en');
});

describe('engine labels', () => {
  it('cover exactly the labels the engine has', () => {
    expect([...STAGE_LABEL_KEYS].sort()).toEqual(Object.keys(DEFAULT_STAGE_LABELS).sort());
  });

  it('are the engine defaults in English', () => {
    setLocale('en');
    expect(stageLabels()).toEqual(DEFAULT_STAGE_LABELS);
  });

  it.each(LOCALES)('have every text in %s, with the placeholders the engine fills', (locale) => {
    const bundle = STAGE_LABEL_STRINGS[locale];
    expect(Object.keys(bundle).sort()).toEqual(STAGE_LABEL_KEYS.map((key) => `engine.${key}`).sort());
    for (const key of STAGE_LABEL_KEYS) {
      const text = bundle[`engine.${key}`] ?? '';
      expect(text.trim(), `${locale} ${key}`).not.toBe('');
      expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(DEFAULT_STAGE_LABELS[key]));
    }
  });

  it('are really translated in Spanish and Hindi', () => {
    for (const locale of ['es', 'hi'] as const) {
      setLocale(locale);
      const labels = stageLabels();
      const same = STAGE_LABEL_KEYS.filter((key) => labels[key] === DEFAULT_STAGE_LABELS[key]);
      expect(same, locale).toEqual([]);
    }
  });

  it('follow the language in a component, with a stable object in between', () => {
    const seen: StageLabelStrings[] = [];
    function Probe() {
      const labels = useStageLabels();
      seen.push(labels);
      return <button type="button">{labels.check}</button>;
    }
    const view = render(<Probe />);
    expect(screen.getByRole('button')).toHaveTextContent('Check');
    view.rerender(<Probe />);
    expect(seen[1]).toBe(seen[0]);

    act(() => setLocale('es'));
    expect(screen.getByRole('button')).toHaveTextContent('Comprobar');
    act(() => setLocale('hi'));
    expect(screen.getByRole('button')).toHaveTextContent('जाँचो');
  });
});
