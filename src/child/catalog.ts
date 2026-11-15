/**
 * Names for the things on the rewards shelf, in the child's language.
 *
 * `@/progression` stores catalogue names and reward reasons in English. Translations are
 * keyed by kind and key in `strings.ts`; anything without one falls back to the stored text.
 */
import type { Companion } from '@/core/types';
import { hasString, t } from '@/i18n';
import { COLLECTIBLES, getCompanionDef, type BadgeDef, type CollectibleDef } from '@/progression';

function translated(key: string, fallback: string): string {
  return hasString(key) ? t(key) : fallback;
}

export function speciesName(species: string): string {
  return translated(`child.companion.species.${species}`, getCompanionDef(species)?.name ?? species);
}

/** The name the child gave the companion, or its species while it has none. */
export function companionName(companion: Companion): string {
  const own = companion.name.trim();
  return own !== '' ? own : speciesName(companion.species);
}

export function growthName(growth: number): string {
  const level = Math.max(0, Math.min(4, Math.floor(growth)));
  return t(`child.companion.growth.${level}`);
}

export function badgeName(badge: BadgeDef): string {
  return translated(`child.badge.${badge.key}.name`, badge.name);
}

/** What to do to earn the badge. */
export function badgeHint(badge: BadgeDef): string {
  return translated(`child.badge.${badge.key}.hint`, badge.description);
}

/** Why the child earned the badge: the translation, else the reason stored with the reward. */
export function badgeReason(badge: BadgeDef, storedReason: string | undefined): string {
  return translated(`child.badge.${badge.key}.reason`, storedReason?.trim() || badge.description);
}

export function itemName(item: CollectibleDef): string {
  return translated(`child.item.${item.key}`, item.name);
}

export function themeName(theme: string): string {
  return translated(`child.theme.${theme}`, theme);
}

const THEME_EMOJI: Record<string, string> = {
  space: '🌌',
  animals: '🐾',
  dinosaurs: '🦴',
  robots: '⚙️',
  ocean: '🌊',
  cooking: '🍳',
  sports: '🏅',
  music: '🎵',
  'cars and trains': '🛤️',
  superheroes: '⚡',
  nature: '🌿',
  building: '🏗️',
  art: '🖼️',
  'video games': '🎮',
  'fairy tales': '📖',
  weather: '🌦️',
};

export function themeEmoji(theme: string): string {
  return THEME_EMOJI[theme] ?? '🎁';
}

export interface ShopGroup {
  theme: string;
  items: CollectibleDef[];
}

/**
 * The shop grouped by theme. Themes that match one of the child's interests come first, in
 * the order of the interests; the rest follow in catalogue order.
 */
export function shopGroups(interests: readonly string[], catalogue: readonly CollectibleDef[] = COLLECTIBLES): ShopGroup[] {
  const groups: ShopGroup[] = [];
  for (const item of catalogue) {
    const group = groups.find((entry) => entry.theme === item.theme);
    if (group) group.items.push(item);
    else groups.push({ theme: item.theme, items: [item] });
  }
  const wanted = interests.map((interest) => interest.trim().toLowerCase());
  const rank = (theme: string): number => {
    const index = wanted.indexOf(theme.toLowerCase());
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  // Array.prototype.sort is stable, so equal ranks keep the catalogue order.
  return groups.sort((a, b) => rank(a.theme) - rank(b.theme));
}

/** How many more stars the child needs for an item. 0 when it is affordable. */
export function starsToGo(balance: number, cost: number): number {
  return Math.max(0, Math.ceil(cost - Math.max(0, balance)));
}
