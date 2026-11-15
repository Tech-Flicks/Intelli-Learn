import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import { BADGES, COLLECTIBLES, getBadge, getCollectible } from '@/progression';
import { CHILD_STRINGS } from './strings';
import {
  badgeHint,
  badgeName,
  badgeReason,
  companionName,
  growthName,
  itemName,
  shopGroups,
  speciesName,
  starsToGo,
  themeEmoji,
  themeName,
} from './catalog';

afterEach(() => setLocale('en'));

describe('names on the shelf', () => {
  it('uses the name the child gave, else the species', () => {
    expect(companionName({ species: 'fox', name: '', growth: 1, xp: 20 })).toBe('Fox');
    expect(companionName({ species: 'fox', name: ' Rusty ', growth: 1, xp: 20 })).toBe('Rusty');
    expect(speciesName('mystery-beast')).toBe('mystery-beast');
    setLocale('es');
    expect(companionName({ species: 'fox', name: '', growth: 1, xp: 20 })).toBe('Zorro');
  });

  it('names every growth stage and clamps odd values', () => {
    expect([0, 1, 2, 3, 4].map(growthName)).toEqual(['Egg', 'Hatchling', 'Junior', 'All grown up', 'Legendary']);
    expect(growthName(9)).toBe('Legendary');
    expect(growthName(-1)).toBe('Egg');
  });

  it('shows catalogue text in English and translations elsewhere', () => {
    const badge = getBadge('first-spark');
    const item = getCollectible('rocket-ship');
    if (!badge || !item) throw new Error('catalogue changed');
    expect(badgeName(badge)).toBe('First Spark');
    expect(badgeHint(badge)).toBe('Solve your very first challenge.');
    expect(badgeReason(badge, 'You did it!')).toBe('You did it!');
    expect(badgeReason(badge, undefined)).toBe(badge.description);
    expect(itemName(item)).toBe('Rocket Ship');
    expect(themeName('cars and trains')).toBe('Cars and trains');
    expect(themeName('made-up')).toBe('made-up');

    setLocale('es');
    expect(badgeName(badge)).toBe('Primera chispa');
    expect(badgeReason(badge, 'You did it!')).toBe('¡Probaste tu primer reto y lo terminaste!');
    expect(itemName(item)).toBe('Cohete');
    expect(themeName('space')).toBe('Espacio');
  });

  it('has a translation for every badge, treasure and theme in Spanish and Hindi', () => {
    for (const locale of ['es', 'hi'] as const) {
      const strings = CHILD_STRINGS[locale] ?? {};
      for (const badge of BADGES) {
        for (const part of ['name', 'hint', 'reason']) {
          expect(strings[`child.badge.${badge.key}.${part}`], `${locale}: ${badge.key}.${part}`).toBeTypeOf('string');
        }
      }
      for (const item of COLLECTIBLES) {
        expect(strings[`child.item.${item.key}`], `${locale}: ${item.key}`).toBeTypeOf('string');
        expect(strings[`child.theme.${item.theme}`], `${locale}: ${item.theme}`).toBeTypeOf('string');
      }
    }
  });

  it('has an English hint and a picture for every badge and theme', () => {
    for (const badge of BADGES) expect(badgeHint(badge), badge.key).not.toBe(badge.description);
    for (const item of COLLECTIBLES) expect(themeEmoji(item.theme), item.theme).not.toBe('🎁');
    expect(themeEmoji('made-up')).toBe('🎁');
  });
});

describe('shopGroups', () => {
  it('groups every treasure by theme', () => {
    const groups = shopGroups([]);
    expect(groups.flatMap((group) => group.items)).toHaveLength(COLLECTIBLES.length);
    expect(new Set(groups.map((group) => group.theme)).size).toBe(groups.length);
    for (const group of groups) expect(group.items.every((item) => item.theme === group.theme)).toBe(true);
    expect(groups[0]?.theme).toBe(COLLECTIBLES[0]?.theme);
  });

  it("puts the child's interests first, in their order", () => {
    const groups = shopGroups(['Ocean', 'knitting', 'robots']);
    expect(groups.slice(0, 2).map((group) => group.theme)).toEqual(['ocean', 'robots']);
    expect(groups[2]?.theme).toBe('space');
  });
});

describe('starsToGo', () => {
  it('says how many more stars an item needs', () => {
    expect(starsToGo(3, 10)).toBe(7);
    expect(starsToGo(10, 10)).toBe(0);
    expect(starsToGo(50, 10)).toBe(0);
    expect(starsToGo(-4, 5)).toBe(5);
  });
});
