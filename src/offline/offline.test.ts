import { describe, expect, it } from 'vitest';
import { ChallengeSchema, StoryOutlineSchema, type Challenge } from '@/core/schemas';
import { makeStage, stageGradeIndex } from '@/core/grades';
import { SKILLS, getSkill, skillExistsAt } from '@/core/skills';
import { GRADES, STRANDS, type ChallengePlan, type Grade, type InteractionKind, type Mode, type Strand } from '@/core/types';
import { problemsOf } from './check';
import { CURATED, OFFLINE_BANK_SIZE, pickOfflineChallenge, pickOfflineStory } from './index';
import { ALL_SETS } from './sets';

const KINDS: InteractionKind[] = ['choice', 'tap', 'sort', 'match', 'order', 'number', 'robot', 'build'];
const CREATIVE: Mode[] = ['experiment', 'detective', 'fixbot', 'wonder', 'mission', 'invention'];
const THEMES = ['space', 'dinosaurs', 'cooking', 'fairy tales', 'something unknown', ''];

function planOf(skillId: string, strand: Strand, grade: Grade, interaction: InteractionKind, mode: Mode = 'quest', theme = 'space'): ChallengePlan {
  return { childId: 'child-1', skillId, strand, stage: makeStage(grade, 'growing'), interaction, mode, purpose: 'core', theme };
}

const DIRS = ['up', 'right', 'down', 'left'] as const;
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] } as const;

/** Independent breadth-first search: fewest plain moves that collect every gem and reach the goal. */
function shortestRobotProgram(i: Extract<Challenge['interaction'], { kind: 'robot' }>): number | null {
  const walls = new Set(i.walls.map((w) => `${w.x},${w.y}`));
  const gemIndex = new Map(i.gems.map((gem, index) => [`${gem.x},${gem.y}`, index]));
  const all = (1 << i.gems.length) - 1;
  const startDir = DIRS.indexOf(i.start.dir);
  let frontier: [number, number, number, number][] = [[i.start.x, i.start.y, startDir, 0]];
  const seen = new Set<string>([`${i.start.x},${i.start.y},${startDir},0`]);
  for (let depth = 0; depth <= 40 && frontier.length > 0; depth += 1) {
    const next: [number, number, number, number][] = [];
    for (const [x, y, dir, mask] of frontier) {
      if (x === i.goal.x && y === i.goal.y && mask === all) return depth;
      const moves: [number, number, number, number][] = [];
      if (i.allowed.includes('left')) moves.push([x, y, (dir + 3) % 4, mask]);
      if (i.allowed.includes('right')) moves.push([x, y, (dir + 1) % 4, mask]);
      if (i.allowed.includes('forward')) {
        const [dx, dy] = STEP[DIRS[dir] as (typeof DIRS)[number]];
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < i.cols && ny < i.rows && !walls.has(`${nx},${ny}`)) {
          const gem = gemIndex.get(`${nx},${ny}`);
          moves.push([nx, ny, dir, gem === undefined ? mask : mask | (1 << gem)]);
        }
      }
      for (const state of moves) {
        const key = state.join(',');
        if (!seen.has(key)) {
          seen.add(key);
          next.push(state);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** Checks written independently of the module's own `problemsOf`. */
function semanticProblems(c: Challenge): string[] {
  const out: string[] = [];
  const i = c.interaction;
  const ids = new Set(c.scene.objects.map((o) => o.id));
  if (ids.size !== c.scene.objects.length) out.push('duplicate scene ids');
  if (c.scene.objects.length < 3 || c.scene.objects.length > 15) out.push('scene size');
  for (const o of c.scene.objects) {
    if (o.x < 0 || o.x > 100 || o.y < 0 || o.y > 100) out.push('object outside the scene');
    if (o.type === 'svg') out.push('svg object');
  }
  if (!c.teachBack || c.teachBack.options.filter((o) => o.correct).length !== 1) out.push('teach-back needs exactly one correct option');
  if (c.walkthrough.length < 2 || c.walkthrough.length > 6) out.push('walkthrough length');
  if (/\d|[+=×÷<>%°√]/.test(c.readAloud)) out.push(`read-aloud has symbols: ${c.readAloud}`);
  switch (i.kind) {
    case 'choice': {
      const optionIds = i.options.map((o) => o.id);
      if (i.correctIds.some((id) => !optionIds.includes(id))) out.push('correct id missing');
      if (i.correctIds.length >= i.options.length) out.push('all options correct');
      if (!i.multi && i.correctIds.length !== 1) out.push('single choice needs one answer');
      if (i.options.some((o) => !i.correctIds.includes(o.id) && !o.misconception)) out.push('wrong option without a misconception');
      break;
    }
    case 'tap': {
      for (const id of i.targetIds) {
        const target = c.scene.objects.find((o) => o.id === id);
        if (!target) out.push(`tap target ${id} missing`);
        else if (!target.tappable) out.push(`tap target ${id} not tappable`);
      }
      if (c.scene.objects.filter((o) => o.tappable).length <= i.targetIds.length) out.push('no distractor to tap');
      break;
    }
    case 'sort': {
      const bins = new Set(i.bins.map((b) => b.id));
      if (i.items.some((item) => !bins.has(item.binId))) out.push('unknown bin');
      if (new Set(i.items.map((item) => item.binId)).size < 2) out.push('only one bin used');
      break;
    }
    case 'match':
      if (new Set(i.pairs.map((p) => `${p.right.emoji ?? ''}${p.right.label}`)).size !== i.pairs.length) out.push('ambiguous match');
      break;
    case 'order':
      if (new Set(i.items.map((item) => `${item.emoji ?? ''}${item.label}`)).size !== i.items.length) out.push('duplicate order items');
      break;
    case 'number': {
      if (!Number.isFinite(i.answer)) out.push('answer not finite');
      if (i.answer < 0 && !i.allowNegative) out.push('negative answer not allowed');
      if (!Number.isInteger(i.answer) && !i.allowDecimal) out.push('decimal answer not allowed');
      const digits = String(Math.abs(i.answer));
      for (const hint of c.hints) {
        const numbers: string[] = hint.replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?/g) ?? [];
        if (numbers.includes(digits)) out.push(`hint gives the answer away: ${hint}`);
      }
      break;
    }
    case 'robot': {
      const shortest = shortestRobotProgram(i);
      if (shortest === null) out.push('maze not solvable');
      else if (shortest > i.maxCommands) out.push('maze needs more commands than allowed');
      break;
    }
    case 'build': {
      let solvable = false;
      for (let mask = 1; mask < 1 << i.parts.length; mask += 1) {
        const chosen = i.parts.filter((_p, index) => mask & (1 << index));
        const power = chosen.reduce((sum, p) => sum + p.power, 0);
        const cost = chosen.reduce((sum, p) => sum + p.cost, 0);
        if (power >= i.target && cost <= i.budget) solvable = true;
      }
      if (!solvable) out.push('no valid selection of parts');
      const allCost = i.parts.reduce((sum, p) => sum + p.cost, 0);
      if (allCost <= i.budget) out.push('taking every part works');
      break;
    }
  }
  return out;
}

function expectSound(challenge: Challenge, plan: ChallengePlan, label: string): void {
  expect(() => ChallengeSchema.parse(challenge), label).not.toThrow();
  expect(challenge.interaction.kind, label).toBe(plan.interaction);
  expect(semanticProblems(challenge), label).toEqual([]);
  expect(problemsOf(challenge), label).toEqual([]);
}

const words = (text: string): number => text.trim().split(/\s+/).length;
const sentences = (text: string): number => (text.match(/[.!?](?=\s|$)/g) ?? []).length;

describe('pickOfflineChallenge', () => {
  it('returns a sound challenge of the planned kind for every skill, grade and interaction', () => {
    let count = 0;
    for (const skill of SKILLS) {
      for (const grade of GRADES) {
        if (!skillExistsAt(skill, grade)) continue;
        for (const kind of KINDS) {
          const plan = planOf(skill.id, skill.strand, grade, kind, 'quest', THEMES[count % THEMES.length]);
          expectSound(pickOfflineChallenge(plan, { seed: 11 + count }), plan, `${skill.id} ${grade} ${kind}`);
          count += 1;
        }
      }
    }
    expect(count).toBeGreaterThan(2000);
  }, 120_000);

  it('covers every strand, grade and interaction for several seeds, even for an unknown skill', () => {
    for (const strand of STRANDS) {
      for (const grade of GRADES) {
        for (const kind of KINDS) {
          for (const seed of [1, 2, 3]) {
            const plan = planOf(`${strand}-not-a-real-skill`, strand, grade, kind);
            expectSound(pickOfflineChallenge(plan, { seed }), plan, `${strand} ${grade} ${kind} seed ${seed}`);
          }
        }
      }
    }
  }, 120_000);

  it('serves every creative mode in every strand', () => {
    for (const mode of CREATIVE) {
      for (const skill of SKILLS) {
        for (const grade of ['K', '2', '5', '8'] as Grade[]) {
          if (!skillExistsAt(skill, grade)) continue;
          const kind: InteractionKind = mode === 'invention' ? 'build' : mode === 'mission' && skill.interactions.includes('number') ? 'number' : 'choice';
          const plan = planOf(skill.id, skill.strand, grade, kind, mode, 'robots');
          expectSound(pickOfflineChallenge(plan, { seed: 5 }), plan, `${mode} ${skill.id} ${grade}`);
        }
      }
    }
  }, 60_000);

  it('keeps every text of a Pre-K or Kindergarten challenge to one short sentence', () => {
    const tooLong: string[] = [];
    for (const skill of SKILLS) {
      for (const grade of ['PK', 'K'] as Grade[]) {
        if (!skillExistsAt(skill, grade)) continue;
        for (const kind of skill.interactions) {
          for (const mode of skill.modes.slice(0, 3)) {
            const c = pickOfflineChallenge(planOf(skill.id, skill.strand, grade, kind, mode, 'animals'), { seed: 3 });
            const texts: [string, string, number][] = [['intro', c.intro, 12], ['question', c.question, 14], ['hint', c.hints[0], 14], ['hint', c.hints[1], 16], ['explanation', c.explanation, 16]];
            c.walkthrough.forEach((step) => texts.push(['step', step, 16]));
            for (const [name, text, max] of texts) {
              if (words(text) > max || sentences(text) > 1) tooLong.push(`${c.title} / ${name}: ${text}`);
            }
          }
        }
      }
    }
    expect([...new Set(tooLong)]).toEqual([]);
  }, 60_000);

  it('pitches numbers at the grade of the plan', () => {
    const answerAt = (grade: Grade, seed: number): number => {
      const c = pickOfflineChallenge(planOf('math-addition-subtraction', 'math', grade, 'number'), { seed });
      return c.interaction.kind === 'number' ? c.interaction.answer : Number.NaN;
    };
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(answerAt('PK', seed)).toBeLessThanOrEqual(10);
      expect(answerAt('K', seed)).toBeLessThanOrEqual(20);
      expect(answerAt('4', seed)).toBeGreaterThan(20);
    }
    expect(stageGradeIndex(makeStage('4', 'growing'))).toBe(5);
  });

  it('is deterministic for a fixed seed and varies between seeds', () => {
    const titles = new Set<string>();
    for (const kind of KINDS) {
      const plan = planOf('science-living-things', 'science', '2', kind);
      expect(pickOfflineChallenge(plan, { seed: 42 })).toEqual(pickOfflineChallenge(plan, { seed: 42 }));
    }
    const plan = planOf('science-living-things', 'science', '2', 'choice');
    for (let seed = 0; seed < 25; seed += 1) titles.add(pickOfflineChallenge(plan, { seed }).title);
    expect(titles.size).toBeGreaterThan(3);
    const unseeded = pickOfflineChallenge(plan);
    expect(ChallengeSchema.safeParse(unseeded).success).toBe(true);
  });

  it('avoids titles the child has seen recently', () => {
    const plan = planOf('science-earth-space', 'science', '3', 'choice');
    const seen: string[] = [];
    for (let round = 0; round < 6; round += 1) {
      const next = pickOfflineChallenge(plan, { seed: 7, avoidTitles: seen });
      expect(seen).not.toContain(next.title);
      seen.push(next.title);
    }
  });

  it('prefers a hand-written item that matches the skill, grade, interaction and mode', () => {
    const plan = planOf('science-matter', 'science', 'K', 'choice', 'experiment');
    for (const seed of [1, 2, 3]) expect(pickOfflineChallenge(plan, { seed }).title).toBe('Ice in the Sun');
    expect(pickOfflineChallenge(plan, { seed: 1, avoidTitles: ['ice in the sun'] }).title).not.toBe('Ice in the Sun');
    const build = planOf('engineering-structures', 'engineering', '3', 'build', 'invention');
    expect(pickOfflineChallenge(build, { seed: 1 }).title).toBe('Toy Truck Bridge');
  });

  it('only serves a mission when the plan asks for a mission', () => {
    const missionTitles = new Set(CURATED.filter((item) => item.mode === 'mission').map((item) => item.challenge.title));
    for (let seed = 0; seed < 30; seed += 1) {
      const quest = pickOfflineChallenge(planOf('math-counting-cardinality', 'math', 'PK', 'number', 'quest'), { seed });
      expect(missionTitles.has(quest.title)).toBe(false);
    }
    const mission = pickOfflineChallenge(planOf('math-counting-cardinality', 'math', 'PK', 'number', 'mission'), { seed: 1 });
    expect(mission.title).toBe('Shoe Mission');
  });

  it('uses the theme of the plan when it is a known interest', () => {
    const dino = pickOfflineChallenge(planOf('math-multiplication-division', 'math', '3', 'number', 'quest', 'dinosaurs'), { seed: 2 });
    const space = pickOfflineChallenge(planOf('math-multiplication-division', 'math', '3', 'number', 'quest', 'space'), { seed: 2 });
    expect(dino.title).toMatch(/^Dino/);
    expect(dino.scene.theme).toBe('jungle');
    expect(space.title).toMatch(/^Space/);
    expect(space.scene.theme).toBe('space');
  });

  it('copes with stages outside the range', () => {
    for (const stage of [-5, 0, 39, 999]) {
      const plan: ChallengePlan = { ...planOf('logic-patterns', 'logic', '1', 'tap'), stage };
      expectSound(pickOfflineChallenge(plan, { seed: 1 }), plan, `stage ${stage}`);
    }
  });

  it('never hands out the stored copy of a curated item', () => {
    const plan = planOf('science-matter', 'science', 'K', 'choice', 'experiment');
    const first = pickOfflineChallenge(plan, { seed: 1 });
    first.title = 'Changed';
    expect(pickOfflineChallenge(plan, { seed: 1 }).title).toBe('Ice in the Sun');
  });
});

describe('CURATED', () => {
  it('holds at least 40 sound, hand-written items with unique ids and titles', () => {
    expect(OFFLINE_BANK_SIZE).toBe(CURATED.length);
    expect(CURATED.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CURATED.map((item) => item.id)).size).toBe(CURATED.length);
    expect(new Set(CURATED.map((item) => item.challenge.title)).size).toBe(CURATED.length);
    for (const item of CURATED) {
      expect(() => ChallengeSchema.parse(item.challenge), item.id).not.toThrow();
      expect(problemsOf(item.challenge), item.id).toEqual([]);
      expect(semanticProblems(item.challenge), item.id).toEqual([]);
      const skill = getSkill(item.skillId);
      expect(skill?.strand, item.id).toBe(item.strand);
      expect(GRADES.indexOf(item.grades[0]), item.id).toBeLessThanOrEqual(GRADES.indexOf(item.grades[1]));
      if (skill) expect(skillExistsAt(skill, item.grades[0]) || skillExistsAt(skill, item.grades[1]), item.id).toBe(true);
    }
  });

  it('covers the creative modes, all strands, the grade bands and many kinds of interaction', () => {
    for (const mode of CREATIVE) expect(CURATED.filter((item) => item.mode === mode).length, mode).toBeGreaterThanOrEqual(6);
    for (const strand of STRANDS) expect(CURATED.filter((item) => item.strand === strand).length, strand).toBeGreaterThanOrEqual(4);
    for (const grade of GRADES) {
      const g = GRADES.indexOf(grade);
      expect(CURATED.filter((item) => GRADES.indexOf(item.grades[0]) <= g && g <= GRADES.indexOf(item.grades[1])).length, grade).toBeGreaterThanOrEqual(4);
    }
    const kinds = new Set(CURATED.map((item) => item.challenge.interaction.kind));
    for (const kind of ['choice', 'number', 'sort', 'order', 'match', 'tap', 'build'] as const) expect(kinds.has(kind), kind).toBe(true);
  });

  it('gives each creative mode its own shape', () => {
    for (const item of CURATED) {
      const kind = item.challenge.interaction.kind;
      if (item.mode === 'mission') expect(['number', 'choice'], item.id).toContain(kind);
      if (item.mode === 'fixbot') expect(kind, item.id).toBe('choice');
      if (item.mode === 'invention') expect(kind, item.id).toBe('build');
      if (item.mode === 'wonder') expect(/did you know|!/i.test(item.challenge.intro), item.id).toBe(true);
      if (item.mode === 'experiment') expect(/predict|what will happen|sort each thing/i.test(`${item.challenge.intro} ${item.challenge.question}`), item.id).toBe(true);
    }
  });
});

describe('knowledge sets', () => {
  it('have unique ids, valid grade ranges and known skills', () => {
    expect(new Set(ALL_SETS.map((set) => set.id)).size).toBe(ALL_SETS.length);
    for (const set of ALL_SETS) {
      expect(GRADES.indexOf(set.grades[0]), set.id).toBeLessThanOrEqual(GRADES.indexOf(set.grades[1]));
      expect(set.skills.length, set.id).toBeGreaterThan(0);
      for (const skillId of set.skills) expect(getSkill(skillId)?.strand, `${set.id} ${skillId}`).toBe(set.strand);
      if (set.type === 'cat') {
        expect(set.bins.length, set.id).toBeGreaterThanOrEqual(2);
        const labels = set.bins.flatMap((b) => b.items.map((it) => it.label.toLowerCase()));
        expect(new Set(labels).size, set.id).toBe(labels.length);
      }
      if (set.type === 'pair') expect(set.pairs.length, set.id).toBeGreaterThanOrEqual(3);
      if (set.type === 'seq') expect(set.items.length, set.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('give every non-math strand groups, pairs and sequences at every grade', () => {
    for (const strand of STRANDS.filter((s) => s !== 'math')) {
      for (const grade of GRADES) {
        const g = GRADES.indexOf(grade);
        const here = ALL_SETS.filter((set) => set.strand === strand && GRADES.indexOf(set.grades[0]) <= g && g <= GRADES.indexOf(set.grades[1]));
        for (const type of ['cat', 'pair', 'seq'] as const) expect(here.some((set) => set.type === type), `${strand} ${grade} ${type}`).toBe(true);
      }
    }
  });
});

describe('pickOfflineStory', () => {
  it('returns a valid outline with the requested number of chapters, clamped to 2..5', () => {
    for (const theme of [...THEMES, 'ocean', 'robots', 'animals']) {
      for (const chapters of [0, 1, 2, 3, 4, 5, 9, Number.NaN]) {
        const story = pickOfflineStory(theme, chapters);
        expect(() => StoryOutlineSchema.parse(story)).not.toThrow();
        const wanted = Number.isFinite(chapters) ? Math.min(5, Math.max(2, chapters)) : 3;
        expect(story.chapters.length).toBe(wanted);
      }
    }
  });

  it('matches the story to the theme and always gives the same story for a theme', () => {
    expect(pickOfflineStory('space', 3).title).toBe('The Star That Lost Its Light');
    expect(pickOfflineStory('ocean', 3).title).toBe('The Secret of Coral Cove');
    expect(pickOfflineStory('robots', 4)).toEqual(pickOfflineStory('robots', 4));
    expect(pickOfflineStory('a theme nobody knows', 3)).toEqual(pickOfflineStory('a theme nobody knows', 3));
    const short = pickOfflineStory('space', 2);
    const long = pickOfflineStory('space', 5);
    expect(short.chapters[1]).toEqual(long.chapters[4]);
    expect(short.ending).toBe(long.ending);
  });
});
