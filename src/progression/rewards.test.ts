import { beforeEach, describe, expect, it } from 'vitest';
import { INTEREST_SUGGESTIONS } from '@/core/defaults';
import { dayKey } from '@/core/grades';
import { MODES, STRANDS } from '@/core/types';
import type { AttemptOutcome, Mode } from '@/core/types';
import { COMPANION_SPECIES, db } from '@/data';
import {
  BADGES,
  badgeReason,
  COLLECTIBLES,
  COMPANIONS,
  companionEmoji,
  companionProgress,
  getBadge,
  getCollectible,
  getCompanionDef,
  growthForXp,
} from './catalog';
import {
  buyCollectible,
  companionGrowthReason,
  countAttempt,
  daysBetween,
  earnedBadgeKeys,
  emptyCounters,
  feedCompanion,
  nextStreak,
  parseCounters,
  starReason,
  starsFor,
  streakReason,
  type BadgeContext,
  type ChildCounters,
  type CountedAttempt,
} from './rewards';
import { addChild, DAY, MONDAY, resetDb } from './testing';
import { TUNING } from './tuning';

const OUTCOMES: AttemptOutcome[] = ['independent', 'second-try', 'nudge', 'hint', 'walkthrough'];
const SATURDAY = MONDAY + 5 * DAY;

function counted(patch: Partial<CountedAttempt> = {}): CountedAttempt {
  return {
    strand: 'math',
    outcome: 'independent',
    teachBackCorrect: null,
    mode: 'quest',
    interaction: 'choice',
    purpose: 'core',
    ...patch,
  };
}

function badgeContext(patch: Partial<BadgeContext> = {}, counters: Partial<ChildCounters> = {}): BadgeContext {
  return {
    counters: { ...emptyCounters(), solves: 1, ...counters },
    outcome: 'walkthrough',
    purpose: 'core',
    strand: 'math',
    wrongTries: 0,
    now: MONDAY,
    skillSteppedUp: false,
    strandMove: null,
    checkPassed: false,
    placementFinished: false,
    ...patch,
  };
}

describe('stars', () => {
  it.each([
    ['independent', 3],
    ['second-try', 2],
    ['nudge', 2],
    ['hint', 1],
    ['walkthrough', 1],
  ] as const)('a %s solve earns %i stars', (outcome, stars) => {
    expect(starsFor(outcome, null)).toBe(stars);
    expect(starsFor(outcome, false)).toBe(stars);
    expect(starsFor(outcome, true)).toBe(stars + 1);
  });

  it('gives every outcome a reason that names effort, not ability', () => {
    for (const outcome of OUTCOMES) {
      for (const teachBack of [null, true]) {
        const reason = starReason(outcome, teachBack);
        expect(reason.length).toBeGreaterThan(10);
        expect(reason).not.toMatch(/smart|clever|genius|gifted|talent|brilliant/i);
      }
    }
    expect(starReason('hint', true)).toContain('explaining');
  });
});

describe('companion', () => {
  it('maps xp to growth at 0, 15, 60, 150 and 300', () => {
    expect([0, 14, 15, 59, 60, 149, 150, 299, 300, 5000].map(growthForXp)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('adds xp and reports growth exactly when a threshold is crossed', () => {
    const egg = { species: 'owl', name: '', growth: 0, xp: 12 };
    expect(feedCompanion(egg, 2)).toEqual({ companion: { ...egg, xp: 14 }, grew: false });
    expect(feedCompanion(egg, 3)).toEqual({ companion: { ...egg, xp: 15, growth: 1 }, grew: true });
  });

  it('never shrinks a companion', () => {
    const grown = { species: 'owl', name: 'Hoot', growth: 3, xp: 10 };
    expect(feedCompanion(grown, 1).companion.growth).toBe(3);
    expect(feedCompanion(grown, -50).companion.xp).toBe(10);
  });

  it('has six species that each start as an egg and have five different looks', () => {
    expect(COMPANIONS.map((c) => c.species).sort()).toEqual([...COMPANION_SPECIES].sort());
    for (const def of COMPANIONS) {
      expect(def.stages).toHaveLength(5);
      expect(def.stages[0]).toBe('🥚');
      expect(new Set(def.stages).size).toBe(5);
      expect(def.name.length).toBeGreaterThan(0);
    }
  });

  it('shows the emoji for the current growth, and an egg for anything unknown', () => {
    expect(companionEmoji({ species: 'dragon', name: '', growth: 0, xp: 0 })).toBe('🥚');
    expect(companionEmoji({ species: 'dragon', name: '', growth: 3, xp: 150 })).toBe('🐉');
    expect(companionEmoji({ species: 'dragon', name: '', growth: 99, xp: 150 })).toBe('🐉👑');
    expect(companionEmoji({ species: 'dragon', name: '', growth: -2, xp: 0 })).toBe('🥚');
    expect(companionEmoji({ species: 'phoenix', name: '', growth: 2, xp: 0 })).toBe('🥚');
  });

  it('reports how far the companion is from growing again', () => {
    expect(companionProgress({ species: 'owl', name: '', growth: 0, xp: 0 })).toEqual({
      growth: 0,
      xp: 0,
      nextGrowthAt: 15,
      progress: 0,
    });
    expect(companionProgress({ species: 'owl', name: '', growth: 1, xp: 37.5 }).progress).toBeCloseTo(0.5);
    expect(companionProgress({ species: 'owl', name: '', growth: 3, xp: 150 })).toMatchObject({ nextGrowthAt: 300, progress: 0 });
    expect(companionProgress({ species: 'owl', name: '', growth: 4, xp: 999 })).toEqual({
      growth: 4,
      xp: 999,
      nextGrowthAt: null,
      progress: 1,
    });
  });

  it('looks up catalogue entries by key', () => {
    expect(getBadge('first-spark')?.name).toBe('First Spark');
    expect(getBadge('nope')).toBeUndefined();
    expect(getCompanionDef('unicorn')?.stages[2]).toBe('🦄');
    expect(getCollectible('nope')).toBeUndefined();
  });

  it('explains every growth step by the practice behind it', () => {
    for (let growth = 1; growth <= 4; growth += 1) {
      const reason = companionGrowthReason({ species: 'turtle', name: '', growth, xp: 0 });
      expect(reason).toMatch(/practi|learn|work/i);
    }
    expect(companionGrowthReason({ species: 'turtle', name: '', growth: 1, xp: 15 })).toContain('turtle');
  });
});

describe('streak', () => {
  const day = (offset: number) => dayKey(MONDAY + offset * DAY);

  it('counts whole days between calendar days', () => {
    expect(daysBetween('2026-11-09', '2026-11-10')).toBe(1);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // across a daylight-saving change
    expect(daysBetween('2026-11-10', '2026-11-09')).toBe(-1);
  });

  it('starts at 1 on the first day ever', () => {
    expect(nextStreak({ streakDays: 0, lastPlayedDay: null }, MONDAY)).toEqual({
      streakDays: 1,
      lastPlayedDay: day(0),
      milestone: null,
    });
  });

  it('does not change when playing again on the same day', () => {
    const update = nextStreak({ streakDays: 4, lastPlayedDay: day(0) }, MONDAY + 3600_000);
    expect(update).toEqual({ streakDays: 4, lastPlayedDay: day(0), milestone: null });
  });

  it('continues when the last played day was yesterday', () => {
    expect(nextStreak({ streakDays: 4, lastPlayedDay: day(-1) }, MONDAY).streakDays).toBe(5);
  });

  it('forgives one missed day', () => {
    expect(nextStreak({ streakDays: 4, lastPlayedDay: day(-2) }, MONDAY).streakDays).toBe(5);
  });

  it('starts again at 1 after two missed days', () => {
    expect(nextStreak({ streakDays: 9, lastPlayedDay: day(-3) }, MONDAY)).toEqual({
      streakDays: 1,
      lastPlayedDay: day(0),
      milestone: null,
    });
  });

  it.each([3, 7, 14, 30])('celebrates day %i', (milestone) => {
    const update = nextStreak({ streakDays: milestone - 1, lastPlayedDay: day(-1) }, MONDAY);
    expect(update.milestone).toBe(milestone);
  });

  it('does not celebrate other days', () => {
    expect(nextStreak({ streakDays: 3, lastPlayedDay: day(-1) }, MONDAY).milestone).toBeNull();
  });

  it('keeps the streak when the device clock moved back', () => {
    const update = nextStreak({ streakDays: 6, lastPlayedDay: day(2) }, MONDAY);
    expect(update).toEqual({ streakDays: 6, lastPlayedDay: day(2), milestone: null });
  });

  it('praises the habit', () => {
    expect(streakReason(7)).toContain('7 days');
  });
});

describe('counters', () => {
  it('counts solves per strand, modes, robot and build solves, teach-backs, reviews and missions', () => {
    let c = emptyCounters();
    c = countAttempt(c, counted({ strand: 'technology', interaction: 'robot', mode: 'robot' }));
    c = countAttempt(c, counted({ strand: 'engineering', interaction: 'build', mode: 'invention', teachBackCorrect: true }));
    c = countAttempt(c, counted({ purpose: 'review', outcome: 'second-try', mode: 'mission' }));
    c = countAttempt(c, counted({ purpose: 'review', outcome: 'hint', teachBackCorrect: false }));
    expect(c.solves).toBe(4);
    expect(c.strandSolves).toEqual({ math: 2, science: 0, technology: 1, engineering: 1, logic: 0 });
    expect(c.modes).toEqual(['robot', 'invention', 'mission', 'quest']);
    expect(c.robotSolves).toBe(1);
    expect(c.buildSolves).toBe(1);
    expect(c.teachBacks).toBe(1);
    expect(c.reviewWins).toBe(1);
    expect(c.missions).toBe(1);
  });

  it('tracks the current run of independent solves', () => {
    let c = emptyCounters();
    c = countAttempt(c, counted());
    c = countAttempt(c, counted());
    expect(c.independentRun).toBe(2);
    c = countAttempt(c, counted({ outcome: 'second-try' }));
    expect(c.independentRun).toBe(0);
  });

  it('does not mutate the counters it is given', () => {
    const before = emptyCounters();
    countAttempt(before, counted({ mode: 'wonder' }));
    expect(before).toEqual(emptyCounters());
  });

  it('accepts a stored record and rejects anything malformed', () => {
    const good = countAttempt(emptyCounters(), counted());
    expect(parseCounters(structuredClone(good))).toEqual(good);
    expect(parseCounters(null)).toBeNull();
    expect(parseCounters('x')).toBeNull();
    expect(parseCounters({ ...good, v: 2 })).toBeNull();
    expect(parseCounters({ ...good, solves: -1 })).toBeNull();
    expect(parseCounters({ ...good, modes: ['flying'] })).toBeNull();
    expect(parseCounters({ ...good, strandSolves: { math: 1 } })).toBeNull();
  });
});

describe('badges', () => {
  it('has about twenty badges with unique keys, names, emoji and one-line descriptions', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(BADGES.map((b) => b.key)).size).toBe(BADGES.length);
    expect(new Set(BADGES.map((b) => b.name)).size).toBe(BADGES.length);
    for (const badge of BADGES) {
      expect(badge.key).toMatch(/^[a-z0-9-]+$/);
      expect(badge.name.length).toBeGreaterThan(2);
      expect(badge.emoji.length).toBeGreaterThan(0);
      expect(badge.description).toMatch(/\.$/);
      expect(badge.description).not.toContain('\n');
    }
  });

  it('praises effort or strategy in every badge, never ability', () => {
    for (const badge of BADGES) {
      const text = `${badge.name} ${badge.description} ${badgeReason(badge.key)}`;
      expect(text).not.toMatch(/\bsmart|clever|genius|gifted|talent|brilliant|you are so/i);
      expect(badgeReason(badge.key).length).toBeGreaterThan(15);
    }
  });

  it('grants only the first badge for a plain first solve', () => {
    expect(earnedBadgeKeys(badgeContext())).toEqual(['first-spark']);
  });

  it.each([10, 50, 100, 250])('grants the %i-solves badge at exactly that many solves', (milestone) => {
    expect(earnedBadgeKeys(badgeContext({}, { solves: milestone - 1 }))).not.toContain(`solver-${milestone}`);
    expect(earnedBadgeKeys(badgeContext({}, { solves: milestone }))).toContain(`solver-${milestone}`);
  });

  it('grants On a Roll at five independent solves in a row', () => {
    expect(earnedBadgeKeys(badgeContext({}, { independentRun: 4 }))).not.toContain('on-a-roll');
    expect(earnedBadgeKeys(badgeContext({}, { independentRun: 5 }))).toContain('on-a-roll');
  });

  it('grants Never Gave Up after three or more wrong tries', () => {
    expect(earnedBadgeKeys(badgeContext({ wrongTries: 2 }))).not.toContain('never-gave-up');
    expect(earnedBadgeKeys(badgeContext({ wrongTries: 3 }))).toContain('never-gave-up');
  });

  it.each(STRANDS)('grants the %s explorer badge at five solves in the strand', (strand) => {
    const four = { ...emptyCounters().strandSolves, [strand]: 4 };
    const five = { ...emptyCounters().strandSolves, [strand]: 5 };
    expect(earnedBadgeKeys(badgeContext({}, { strandSolves: four }))).not.toContain(`explorer-${strand}`);
    expect(earnedBadgeKeys(badgeContext({}, { strandSolves: five }))).toContain(`explorer-${strand}`);
  });

  it('grants the all-rounder badge once every strand has a solve', () => {
    const all = { math: 1, science: 1, technology: 1, engineering: 1, logic: 1 };
    expect(earnedBadgeKeys(badgeContext({}, { strandSolves: all }))).toContain('all-rounder');
    expect(earnedBadgeKeys(badgeContext({}, { strandSolves: { ...all, logic: 0 } }))).not.toContain('all-rounder');
  });

  it('grants Level Up when a skill moved up and Double Checker when a check was passed', () => {
    expect(earnedBadgeKeys(badgeContext({ skillSteppedUp: true }))).toContain('level-up');
    expect(earnedBadgeKeys(badgeContext({ checkPassed: true }))).toContain('double-checker');
  });

  it('grants Grade Climber only when a strand crosses into a higher grade', () => {
    expect(earnedBadgeKeys(badgeContext({ strandMove: { from: 15, to: 16 } }))).toContain('grade-climber');
    expect(earnedBadgeKeys(badgeContext({ strandMove: { from: 13, to: 14 } }))).not.toContain('grade-climber');
    expect(earnedBadgeKeys(badgeContext({ strandMove: { from: 16, to: 15 } }))).not.toContain('grade-climber');
  });

  it('grants the counted badges at their thresholds', () => {
    const modes = MODES.slice(0, 5) as Mode[];
    expect(earnedBadgeKeys(badgeContext({}, { teachBacks: 5 }))).toContain('star-teacher');
    expect(earnedBadgeKeys(badgeContext({}, { teachBacks: 4 }))).not.toContain('star-teacher');
    expect(earnedBadgeKeys(badgeContext({}, { modes }))).toContain('mode-explorer');
    expect(earnedBadgeKeys(badgeContext({}, { modes: modes.slice(0, 4) }))).not.toContain('mode-explorer');
    expect(earnedBadgeKeys(badgeContext({}, { robotSolves: 5 }))).toContain('robot-coder');
    expect(earnedBadgeKeys(badgeContext({}, { robotSolves: 4 }))).not.toContain('robot-coder');
    expect(earnedBadgeKeys(badgeContext({}, { buildSolves: 5 }))).toContain('inventor');
    expect(earnedBadgeKeys(badgeContext({}, { buildSolves: 4 }))).not.toContain('inventor');
    expect(earnedBadgeKeys(badgeContext({}, { reviewWins: 5 }))).toContain('memory-keeper');
    expect(earnedBadgeKeys(badgeContext({}, { missions: 3 }))).toContain('real-world-explorer');
    expect(earnedBadgeKeys(badgeContext({}, { missions: 2 }))).not.toContain('real-world-explorer');
  });

  it('grants Weekend Scientist for science on a Saturday or Sunday only', () => {
    expect(earnedBadgeKeys(badgeContext({ strand: 'science', now: SATURDAY }))).toContain('weekend-scientist');
    expect(earnedBadgeKeys(badgeContext({ strand: 'science', now: SATURDAY + DAY }))).toContain('weekend-scientist');
    expect(earnedBadgeKeys(badgeContext({ strand: 'science', now: MONDAY }))).not.toContain('weekend-scientist');
    expect(earnedBadgeKeys(badgeContext({ strand: 'math', now: SATURDAY }))).not.toContain('weekend-scientist');
  });

  it('grants Brave Asker for solving after a clue', () => {
    expect(earnedBadgeKeys(badgeContext({ outcome: 'nudge' }))).toContain('brave-asker');
    expect(earnedBadgeKeys(badgeContext({ outcome: 'hint' }))).toContain('brave-asker');
    expect(earnedBadgeKeys(badgeContext({ outcome: 'independent' }))).not.toContain('brave-asker');
  });

  it('grants Bounce Back for solving the easier follow-up without help', () => {
    expect(earnedBadgeKeys(badgeContext({ purpose: 'sibling', outcome: 'second-try' }))).toContain('bounce-back');
    expect(earnedBadgeKeys(badgeContext({ purpose: 'sibling', outcome: 'hint' }))).not.toContain('bounce-back');
    expect(earnedBadgeKeys(badgeContext({ purpose: 'core', outcome: 'independent' }))).not.toContain('bounce-back');
  });

  it('grants Trailblazer when placement finishes', () => {
    expect(earnedBadgeKeys(badgeContext({ placementFinished: true }))).toContain('trailblazer');
  });

  it('can grant every badge in the catalogue, and nothing that is not in it', () => {
    const everything = earnedBadgeKeys(
      badgeContext(
        {
          outcome: 'nudge',
          strand: 'science',
          wrongTries: 3,
          now: SATURDAY,
          skillSteppedUp: true,
          strandMove: { from: 3, to: 4 },
          checkPassed: true,
          placementFinished: true,
        },
        {
          solves: 250,
          strandSolves: { math: 5, science: 5, technology: 5, engineering: 5, logic: 5 },
          independentRun: 5,
          teachBacks: 5,
          modes: [...MODES],
          robotSolves: 5,
          buildSolves: 5,
          reviewWins: 5,
          missions: 3,
        },
      ),
    );
    const bounce = earnedBadgeKeys(badgeContext({ purpose: 'sibling', outcome: 'independent' }));
    const all = new Set([...everything, ...bounce]);
    expect([...all].sort()).toEqual(BADGES.map((b) => b.key).sort());
  });
});

describe('collectibles', () => {
  beforeEach(resetDb);

  it('has about thirty collectibles costing 5 to 40 stars, with unique keys', () => {
    expect(COLLECTIBLES.length).toBeGreaterThanOrEqual(28);
    expect(new Set(COLLECTIBLES.map((c) => c.key)).size).toBe(COLLECTIBLES.length);
    for (const item of COLLECTIBLES) {
      expect(item.cost).toBeGreaterThanOrEqual(5);
      expect(item.cost).toBeLessThanOrEqual(40);
      expect(Number.isInteger(item.cost)).toBe(true);
      expect(item.name.length).toBeGreaterThan(2);
      expect(item.emoji.length).toBeGreaterThan(0);
    }
  });

  it('covers every suggested interest, and only those themes', () => {
    const themes = new Set(COLLECTIBLES.map((c) => c.theme));
    expect([...themes].sort()).toEqual([...INTEREST_SUGGESTIONS].sort());
  });

  it('offers something a child can afford after the very first solves', () => {
    expect(Math.min(...COLLECTIBLES.map((c) => c.cost))).toBeLessThanOrEqual(2 * TUNING.stars.perOutcome.independent);
  });

  it('buys a collectible: spends the stars, adds it to the shelf and logs the purchase', async () => {
    const child = await addChild({ stars: 20, totalStars: 50 });
    const result = await buyCollectible(child.id, 'rocket-ship', MONDAY);
    expect(result).toEqual({ ok: true, reason: 'ok' });
    const saved = await db.children.get(child.id);
    expect(saved?.stars).toBe(5);
    expect(saved?.totalStars).toBe(50);
    expect(saved?.collectibles).toEqual(['rocket-ship']);
    const rewards = await db.rewards.where('childId').equals(child.id).toArray();
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({ kind: 'collectible', key: 'rocket-ship', amount: -15, at: MONDAY });
    expect(rewards[0]?.reason).toContain('Rocket Ship');
  });

  it('refuses when there are not enough stars, and changes nothing', async () => {
    const child = await addChild({ stars: 14 });
    expect(await buyCollectible(child.id, 'rocket-ship')).toEqual({ ok: false, reason: 'not-enough-stars' });
    expect((await db.children.get(child.id))?.stars).toBe(14);
    expect(await db.rewards.count()).toBe(0);
  });

  it('allows a purchase with exactly enough stars', async () => {
    const cost = getCollectible('rocket-ship')?.cost ?? 0;
    const child = await addChild({ stars: cost });
    expect((await buyCollectible(child.id, 'rocket-ship')).ok).toBe(true);
    expect((await db.children.get(child.id))?.stars).toBe(0);
  });

  it('refuses a collectible the child already owns', async () => {
    const child = await addChild({ stars: 100, collectibles: ['rocket-ship'] });
    expect(await buyCollectible(child.id, 'rocket-ship')).toEqual({ ok: false, reason: 'owned' });
    expect((await db.children.get(child.id))?.stars).toBe(100);
  });

  it('refuses an unknown collectible or child', async () => {
    const child = await addChild({ stars: 100 });
    expect(await buyCollectible(child.id, 'time-machine')).toEqual({ ok: false, reason: 'unknown' });
    expect(await buyCollectible('nobody', 'rocket-ship')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('charges once when the same purchase is sent twice at the same time', async () => {
    const child = await addChild({ stars: 30 });
    const results = await Promise.all([buyCollectible(child.id, 'rocket-ship'), buyCollectible(child.id, 'rocket-ship')]);
    expect(results.map((r) => r.reason).sort()).toEqual(['ok', 'owned']);
    expect((await db.children.get(child.id))?.stars).toBe(15);
  });
});
