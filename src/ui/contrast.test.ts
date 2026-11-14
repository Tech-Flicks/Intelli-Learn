import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, AA_UI, contrastRatio, luminance } from './contrast';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** The colour tokens of the default theme block. */
function readTokens(source: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of source.matchAll(/--color-([a-z]+-\d+|paper):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    const [, name, value] = match;
    if (name && value) tokens[name] = value;
  }
  return tokens;
}

const themeBlock = css.slice(css.indexOf('@theme'), css.indexOf(':root {'));
const theme: Record<string, string> = { ...readTokens(themeBlock), white: '#ffffff' };

const contrastBlock = css.slice(css.indexOf('html.a11y-contrast {'));
const highContrast: Record<string, string> = {
  ...theme,
  ...readTokens(contrastBlock.slice(0, contrastBlock.indexOf('}'))),
};

function color(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`Unknown colour token: ${name}`);
  return value;
}

/** [text, background] pairs the component kit uses for normal-size text. */
const TEXT_PAIRS: [string, string][] = [
  // body text
  ['ink-900', 'paper'],
  ['ink-900', 'white'],
  ['ink-700', 'paper'],
  ['ink-700', 'white'],
  ['ink-500', 'paper'],
  ['ink-500', 'white'],
  ['ink-500', 'ink-50'],
  ['ink-500', 'brand-50'],
  ['ink-700', 'ink-100'],
  ['ink-700', 'ink-50'],
  // buttons
  ['white', 'brand-500'],
  ['white', 'brand-600'],
  ['white', 'brand-700'],
  ['brand-700', 'white'],
  ['brand-700', 'brand-50'],
  ['brand-700', 'brand-100'],
  ['white', 'coral-700'],
  ['white', 'coral-800'],
  // big child buttons: dark ink on bright colours
  ['ink-900', 'sun-300'],
  ['ink-900', 'sun-400'],
  ['ink-900', 'sun-500'],
  ['ink-900', 'leaf-400'],
  ['ink-900', 'coral-400'],
  ['ink-900', 'sky-400'],
  // badges, cards and messages: the 700 shade on its tint
  ['leaf-700', 'leaf-100'],
  ['leaf-700', 'white'],
  ['sun-700', 'sun-100'],
  ['sun-700', 'white'],
  ['coral-700', 'white'],
  ['coral-800', 'coral-100'],
  ['sky-700', 'sky-100'],
  ['sky-700', 'white'],
  ['ink-900', 'sun-100'],
  ['ink-900', 'leaf-100'],
  ['ink-900', 'coral-100'],
  ['ink-900', 'sky-100'],
  ['ink-900', 'brand-50'],
  // dark child background
  ['white', 'ink-900'],
  ['white', 'brand-800'],
  ['white', 'brand-700'],
];

/** [mark, background] pairs for control borders, focus rings and filled indicators. */
const UI_PAIRS: [string, string][] = [
  ['ink-400', 'white'],
  ['ink-400', 'paper'],
  ['ink-500', 'ink-100'],
  ['brand-500', 'white'],
  ['brand-500', 'ink-100'],
  ['brand-600', 'paper'],
  ['brand-600', 'white'],
  ['coral-700', 'white'],
  ['leaf-600', 'ink-100'],
  ['sun-400', 'brand-800'],
  ['sun-400', 'ink-900'],
];

describe('contrast maths', () => {
  it('matches known values', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(() => luminance('purple')).toThrow();
  });
});

describe('theme colours', () => {
  it('still has the original brand tokens', () => {
    expect(theme['brand-500']).toBe('#5b4bdb');
    expect(theme['ink-900']).toBe('#1f1a3d');
    expect(theme.paper).toBe('#fbfaff');
    expect(theme['sun-400']).toBe('#ffd54a');
  });

  it.each(TEXT_PAIRS)('%s on %s meets AA for text', (text, background) => {
    expect(contrastRatio(color(theme, text), color(theme, background))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(UI_PAIRS)('%s on %s meets AA for interface marks', (mark, background) => {
    expect(contrastRatio(color(theme, mark), color(theme, background))).toBeGreaterThanOrEqual(AA_UI);
  });
});

describe('high contrast mode', () => {
  it('overrides text, border and brand colours', () => {
    for (const name of ['ink-900', 'ink-700', 'ink-500', 'ink-400', 'ink-200', 'brand-500', 'paper']) {
      expect(highContrast[name], name).not.toBe(theme[name]);
    }
  });

  it.each(TEXT_PAIRS)('%s on %s reaches AAA (7:1) or stays at least AA', (text, background) => {
    const ratio = contrastRatio(color(highContrast, text), color(highContrast, background));
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    const inkOnLight = text.startsWith('ink-') && ['paper', 'white', 'ink-50', 'ink-100', 'brand-50'].includes(background);
    if (inkOnLight) expect(ratio).toBeGreaterThanOrEqual(7);
  });

  it('draws control borders and dividers at 7:1 or more', () => {
    expect(contrastRatio(color(highContrast, 'ink-400'), '#ffffff')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(color(highContrast, 'ink-200'), '#ffffff')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(color(highContrast, 'brand-300'), '#ffffff')).toBeGreaterThanOrEqual(7);
  });
});

describe('stylesheet rules', () => {
  it('implements every accessibility class', () => {
    for (const className of ['a11y-dyslexia', 'a11y-large', 'a11y-contrast', 'a11y-calm']) {
      expect(css).toContain(`html.${className}`);
    }
    expect(css).toMatch(/html\.a11y-dyslexia\s*\{[^}]*OpenDyslexic/);
    expect(css).toMatch(/html\.a11y-large\s*\{[^}]*font-size:\s*118%/);
    expect(css).toMatch(/html\.a11y-calm \*[^{]*\{[^}]*animation-duration:[^;]*!important/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  it('loads fonts only from the bundled packages', () => {
    expect(css).toContain("@import '@fontsource-variable/nunito/wght.css'");
    expect(css).toContain("@import '@fontsource/baloo-2/600.css'");
    expect(css).toContain("@import '@fontsource/baloo-2/700.css'");
    expect(css).toContain("@import '@fontsource/opendyslexic/400.css'");
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('defines the keyframes the kit uses', () => {
    for (const name of ['wiggle', 'pop', 'float', 'shake', 'fade-in', 'rise', 'twinkle']) {
      expect(css).toContain(`@keyframes ${name}`);
      expect(css).toContain(`--animate-${name}:`);
    }
  });
});
