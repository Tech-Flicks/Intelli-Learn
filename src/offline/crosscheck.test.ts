/**
 * Cross-check between the offline bank and the engine.
 *
 * `src/offline` does not import `@/engine` at runtime (see the module map), so it
 * carries its own content checker. This test makes sure the two modules agree:
 * everything the offline bank can serve must
 *   1. parse with `ChallengeSchema` (what the database backup requires),
 *   2. survive `normalizeChallenge` unchanged in every way that matters and
 *      produce no problems from `validateChallengeContent`, and
 *   3. have an answer key that the engine's `checkAnswer` accepts, so a child
 *      can always finish the challenge (there is no skip button).
 */
import { describe, expect, it } from 'vitest';
import { makeStage } from '@/core/grades';
import { ChallengeSchema, type Challenge, type Interaction } from '@/core/schemas';
import { SKILLS, skillExistsAt, skillsForStrand } from '@/core/skills';
import {
  GRADES,
  INTERACTION_KINDS,
  MODES,
  STAGE_STEPS,
  STRANDS,
  type ChallengePlan,
  type Grade,
  type InteractionKind,
  type Mode,
  type StageStep,
  type Strand,
} from '@/core/types';
import {
  checkAnswer,
  normalizeChallenge,
  solveRobot,
  validateChallengeContent,
  type Answer,
  type RobotProgram,
  type RobotStep,
} from '@/engine';
import { CURATED, pickOfflineChallenge } from './index';

type RobotInteraction = Extract<Interaction, { kind: 'robot' }>;
type BuildInteraction = Extract<Interaction, { kind: 'build' }>;
type Move = 'forward' | 'left' | 'right';

const SEEDS = [1, 2, 3, 4, 5];
const THEMES = ['space', 'dinosaurs', 'cooking', 'animals', 'a theme nobody planned for'];
const DIRS = ['up', 'right', 'down', 'left'] as const;
const DELTA = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] } as const;

/** Shortest plain program that uses only the allowed moves. Written independently of the engine's solver. */
function solveWithAllowed(i: RobotInteraction): Move[] | null {
  const walls = new Set(i.walls.map((w) => `${w.x},${w.y}`));
  const gemBit = new Map<string, number>();
  for (const gem of i.gems) if (!gemBit.has(`${gem.x},${gem.y}`)) gemBit.set(`${gem.x},${gem.y}`, gemBit.size);
  const all = (1 << gemBit.size) - 1;
  const startBit = gemBit.get(`${i.start.x},${i.start.y}`);
  const start = { x: i.start.x, y: i.start.y, dir: DIRS.indexOf(i.start.dir), mask: startBit === undefined ? 0 : 1 << startBit, path: [] as Move[] };
  const seen = new Set([`${start.x},${start.y},${start.dir},${start.mask}`]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const state = queue[head] as typeof start;
    if (state.x === i.goal.x && state.y === i.goal.y && state.mask === all) return state.path;
    const next: (typeof start)[] = [];
    if (i.allowed.includes('left')) next.push({ ...state, dir: (state.dir + 3) % 4, path: [...state.path, 'left'] });
    if (i.allowed.includes('right')) next.push({ ...state, dir: (state.dir + 1) % 4, path: [...state.path, 'right'] });
    if (i.allowed.includes('forward')) {
      const [dx, dy] = DELTA[DIRS[state.dir] as (typeof DIRS)[number]];
      const x = state.x + dx;
      const y = state.y + dy;
      if (x >= 0 && y >= 0 && x < i.cols && y < i.rows && !walls.has(`${x},${y}`)) {
        const bit = gemBit.get(`${x},${y}`);
        next.push({ ...state, x, y, mask: bit === undefined ? state.mask : state.mask | (1 << bit), path: [...state.path, 'forward'] });
      }
    }
    for (const candidate of next) {
      const key = `${candidate.x},${candidate.y},${candidate.dir},${candidate.mask}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(candidate);
      }
    }
  }
  return null;
}

/** Wraps runs of a repeated chunk (2 to 5 times) in repeat blocks, the way a child would shorten a program. */
function withRepeats(moves: readonly Move[]): RobotProgram {
  const out: RobotStep[] = [];
  let index = 0;
  while (index < moves.length) {
    let best: { len: number; times: number; saving: number } | null = null;
    for (let len = 1; len <= Math.floor((moves.length - index) / 2); len += 1) {
      let times = 1;
      while (times < 5 && index + (times + 1) * len <= moves.length && moves.slice(index, index + len).every((move, k) => move === moves[index + times * len + k])) times += 1;
      const saving = times * len - (1 + len);
      if (times >= 2 && saving > 0 && (!best || saving > best.saving)) best = { len, times, saving };
    }
    if (best) {
      out.push({ cmd: 'repeat', times: best.times, body: moves.slice(index, index + best.len).map((cmd) => ({ cmd })) });
      index += best.len * best.times;
    } else {
      out.push({ cmd: moves[index] as Move });
      index += 1;
    }
  }
  return out;
}

/** Any selection of parts that reaches the target inside the budget, found by trying every subset. */
function feasibleBuild(i: BuildInteraction): string[] | null {
  for (let mask = 1; mask < 1 << i.parts.length; mask += 1) {
    const chosen = i.parts.filter((_, bit) => (mask & (1 << bit)) !== 0);
    const power = chosen.reduce((sum, part) => sum + part.power, 0);
    const cost = chosen.reduce((sum, part) => sum + part.cost, 0);
    if (power >= i.target && cost <= i.budget) return chosen.map((part) => part.id);
  }
  return null;
}

/** Answers built from the answer key. The first one the engine accepts is enough. */
function correctAnswers(i: Interaction): Answer[] {
  switch (i.kind) {
    case 'choice':
      return [[...i.correctIds]];
    case 'tap':
      return [[...i.targetIds]];
    case 'sort':
      return [Object.fromEntries(i.items.map((item) => [item.id, item.binId]))];
    case 'match':
      return [Object.fromEntries(i.pairs.map((pair) => [pair.id, pair.id]))];
    case 'order':
      return [i.items.map((item) => item.id)];
    case 'number':
      return [i.answer];
    case 'robot': {
      const answers: Answer[] = [];
      const shortest = solveRobot(i);
      if (shortest) answers.push(shortest);
      const allowedOnly = solveWithAllowed(i);
      if (allowedOnly) {
        answers.push(allowedOnly.map((cmd) => ({ cmd })));
        if (i.allowed.includes('repeat')) answers.push(withRepeats(allowedOnly));
      }
      return answers;
    }
    case 'build': {
      const parts = feasibleBuild(i);
      return parts ? [parts] : [];
    }
  }
}

/** Everything wrong with one offline challenge from the engine's point of view. Empty = fine. */
function crossCheck(raw: Challenge, wantedKind: InteractionKind | null): string[] {
  const problems: string[] = [];
  const parsed = ChallengeSchema.safeParse(raw);
  if (!parsed.success) return [`schema: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`];
  // The stored record must be the parsed form, so defaults never change what the bank wrote.
  if (JSON.stringify(parsed.data) !== JSON.stringify(raw)) problems.push('the challenge changes when parsed (missing defaults or untrimmed text)');
  if (wantedKind && parsed.data.interaction.kind !== wantedKind) problems.push(`kind is ${parsed.data.interaction.kind}, wanted ${wantedKind}`);

  const normalized = normalizeChallenge(parsed.data);
  if (JSON.stringify(normalized) !== JSON.stringify(parsed.data)) problems.push('normalizeChallenge had to repair the challenge');
  for (const issue of validateChallengeContent(normalized)) problems.push(`validator: ${issue}`);

  const answers = correctAnswers(normalized.interaction);
  if (answers.length === 0) problems.push('no correct answer could be built from the answer key');
  else if (!answers.some((answer) => checkAnswer(normalized.interaction, answer).correct)) problems.push('checkAnswer rejects the answer key');
  // The play screen checks against the stored (not normalized) content too.
  else if (!correctAnswers(parsed.data.interaction).some((answer) => checkAnswer(parsed.data.interaction, answer).correct)) problems.push('checkAnswer rejects the answer key of the stored challenge');
  return problems;
}

function planOf(skillId: string, strand: Strand, grade: Grade, interaction: InteractionKind, seed: number, mode?: Mode): ChallengePlan {
  const step = STAGE_STEPS[seed % STAGE_STEPS.length] as StageStep;
  return {
    childId: 'child-1',
    skillId,
    strand,
    stage: makeStage(grade, step),
    interaction,
    mode: mode ?? 'quest',
    purpose: 'core',
    theme: THEMES[seed % THEMES.length] as string,
  };
}

/** Groups failures so one message shows what is wrong and how often. */
function summarize(failures: { where: string; problems: string[] }[]): string {
  const byProblem = new Map<string, string[]>();
  for (const failure of failures) {
    for (const problem of failure.problems) {
      const list = byProblem.get(problem) ?? [];
      list.push(failure.where);
      byProblem.set(problem, list);
    }
  }
  return [...byProblem.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 40)
    .map(([problem, where]) => `${where.length}x ${problem}\n    e.g. ${where.slice(0, 3).join(' | ')}`)
    .join('\n');
}

describe('offline bank against the engine', () => {
  it.each(STRANDS)('every %s skill x grade x interaction kind x 5 seeds is valid and solvable', (strand) => {
    const failures: { where: string; problems: string[] }[] = [];
    let checked = 0;
    for (const grade of GRADES) {
      // Every skill of the strand that exists at this grade; a strand always has at least one.
      const skills = skillsForStrand(strand).filter((skill) => skillExistsAt(skill, grade));
      expect(skills.length, `${strand} has no skill at grade ${grade}`).toBeGreaterThan(0);
      for (const skill of skills) {
        for (const kind of INTERACTION_KINDS) {
          for (const seed of SEEDS) {
            const plan = planOf(skill.id, strand, grade, kind, seed);
            const challenge = pickOfflineChallenge(plan, { seed });
            const problems = crossCheck(challenge, kind);
            checked += 1;
            if (problems.length > 0) failures.push({ where: `${skill.id} ${grade} ${kind} seed ${seed} "${challenge.title}"`, problems });
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(GRADES.length * INTERACTION_KINDS.length * SEEDS.length);
    expect(failures.length, summarize(failures)).toBe(0);
  }, 120_000);

  it('every mode x strand x grade x interaction kind is valid and solvable', () => {
    const failures: { where: string; problems: string[] }[] = [];
    for (const mode of MODES) {
      for (const strand of STRANDS) {
        for (const grade of GRADES) {
          const skills = skillsForStrand(strand).filter((skill) => skillExistsAt(skill, grade));
          for (const kind of INTERACTION_KINDS) {
            for (const seed of SEEDS) {
              // Rotate through the strand's skills, so every one meets every mode over the seeds.
              const skill = skills[(seed + INTERACTION_KINDS.indexOf(kind)) % skills.length];
              if (!skill) continue;
              const challenge = pickOfflineChallenge(planOf(skill.id, strand, grade, kind, seed, mode), { seed });
              const problems = crossCheck(challenge, kind);
              if (problems.length > 0) failures.push({ where: `${mode} ${skill.id} ${grade} ${kind} seed ${seed} "${challenge.title}"`, problems });
            }
          }
        }
      }
    }
    expect(failures.length, summarize(failures)).toBe(0);
  }, 120_000);

  it('a skill the map does not know still gets a valid, solvable challenge', () => {
    const failures: { where: string; problems: string[] }[] = [];
    for (const strand of STRANDS) {
      for (const grade of GRADES) {
        for (const kind of INTERACTION_KINDS) {
          for (const seed of SEEDS) {
            const challenge = pickOfflineChallenge(planOf('no-such-skill', strand, grade, kind, seed), { seed });
            const problems = crossCheck(challenge, kind);
            if (problems.length > 0) failures.push({ where: `${strand} ${grade} ${kind} seed ${seed} "${challenge.title}"`, problems });
          }
        }
      }
    }
    expect(failures.length, summarize(failures)).toBe(0);
  }, 120_000);

  it('every curated item is valid and solvable', () => {
    expect(CURATED.length).toBeGreaterThan(0);
    const failures: { where: string; problems: string[] }[] = [];
    for (const item of CURATED) {
      const problems = crossCheck(item.challenge, null);
      if (problems.length > 0) failures.push({ where: `curated ${item.id} "${item.challenge.title}"`, problems });
    }
    expect(failures.length, summarize(failures)).toBe(0);
  });

  it('every curated item is reachable through pickOfflineChallenge and arrives intact', () => {
    const unreachable: string[] = [];
    for (const item of CURATED) {
      const kind = item.challenge.interaction.kind;
      let served = false;
      for (const grade of item.grades) {
        for (let seed = 1; seed <= 40 && !served; seed += 1) {
          const picked = pickOfflineChallenge(planOf(item.skillId, item.strand, grade, kind, seed, item.mode), { seed });
          if (picked.title === item.challenge.title) {
            served = true;
            expect(crossCheck(picked, kind), `curated ${item.id} as served`).toEqual([]);
          }
        }
      }
      if (!served) unreachable.push(item.id);
    }
    expect(unreachable).toEqual([]);
  }, 120_000);

  it('the cross-check itself notices a broken answer key', () => {
    const skill = SKILLS.find((candidate) => candidate.strand === 'math');
    expect(skill).toBeDefined();
    const good = pickOfflineChallenge(planOf(skill?.id ?? '', 'math', '2', 'choice', 1), { seed: 1 });
    expect(crossCheck(good, 'choice')).toEqual([]);
    const broken = JSON.parse(JSON.stringify(good)) as Challenge;
    if (broken.interaction.kind === 'choice') broken.interaction.correctIds = ['not-an-option'];
    expect(crossCheck(broken, 'choice').length).toBeGreaterThan(0);
  });
});
