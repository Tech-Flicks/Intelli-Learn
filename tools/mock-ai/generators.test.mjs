// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ChallengeSchema,
  LearnerNotesSchema,
  SafetyVerdictSchema,
  StoryOutlineSchema,
  TutorReplySchema,
  WeeklyReportSchema,
} from '../../src/core/schemas.ts';
import {
  GRADES,
  INTERACTION_KINDS,
  MODES,
  cleanTheme,
  makeChallenge,
  makeNotes,
  makeReport,
  makeSafetyVerdict,
  makeStory,
  makeTutorReply,
  solveRobotPlain,
  toSpeech,
} from './generators.mjs';

// The engine's semantic validator is the bar the app holds AI content to. It is
// owned by another module, so these checks are skipped if it cannot be loaded.
const engine = await import('@/engine').catch(() => null);

const THEMES = ['space', 'dinosaurs', 'cars and trains', 'video games', '', 'knitting'];
const SEQS = Array.from({ length: 12 }, (_, i) => i);

function everyCombination(run) {
  for (const kind of INTERACTION_KINDS) {
    for (const grade of GRADES) {
      for (const seq of SEQS) {
        run({ kind, grade, seq, mode: MODES[seq % MODES.length], theme: THEMES[seq % THEMES.length] });
      }
    }
  }
}

/** Numbers written with digits, as the engine's hint check reads them. */
function numbersIn(text) {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe('makeChallenge', () => {
  it('matches ChallengeSchema for every kind, grade and many counters', () => {
    everyCombination((input) => {
      const challenge = makeChallenge(input);
      const parsed = ChallengeSchema.safeParse(challenge);
      if (!parsed.success) {
        throw new Error(`${JSON.stringify(input)} -> ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
      }
      expect(parsed.data.interaction.kind).toBe(input.kind);
    });
  });

  it.skipIf(!engine)('passes the engine content validator without any normalization', () => {
    everyCombination((input) => {
      const parsed = ChallengeSchema.parse(makeChallenge(input));
      expect(engine.validateChallengeContent(parsed), JSON.stringify(input)).toEqual([]);
    });
  });

  it.skipIf(!engine)('is still valid after normalizeChallenge, which is how the app stores it', () => {
    everyCombination((input) => {
      const parsed = ChallengeSchema.parse(makeChallenge(input));
      const normalized = engine.normalizeChallenge(parsed);
      expect(normalized.interaction.kind, JSON.stringify(input)).toBe(input.kind);
      expect(engine.validateChallengeContent(normalized), JSON.stringify(input)).toEqual([]);
      // The mock writes clean content: normalizing has nothing to repair in the answer mechanic.
      expect(normalized.interaction, JSON.stringify(input)).toEqual(parsed.interaction);
    });
  });

  it.skipIf(!engine)('has an answer key that the engine accepts, for every kind', () => {
    const seen = new Set();
    everyCombination((input) => {
      const { interaction } = engine.normalizeChallenge(ChallengeSchema.parse(makeChallenge(input)));
      let answer;
      switch (interaction.kind) {
        case 'choice':
          answer = interaction.correctIds;
          break;
        case 'tap':
          answer = interaction.targetIds;
          break;
        case 'sort':
          answer = Object.fromEntries(interaction.items.map((item) => [item.id, item.binId]));
          break;
        case 'match':
          answer = Object.fromEntries(interaction.pairs.map((pair) => [pair.id, pair.id]));
          break;
        case 'order':
          answer = interaction.items.map((item) => item.id);
          break;
        case 'number':
          answer = interaction.answer;
          break;
        case 'robot':
          answer = engine.solveRobot(interaction);
          break;
        case 'build': {
          // Any selection of parts that reaches the target inside the budget.
          for (let mask = 1; mask < 1 << interaction.parts.length && !answer; mask += 1) {
            const chosen = interaction.parts.filter((_, bit) => (mask & (1 << bit)) !== 0);
            const power = chosen.reduce((sum, part) => sum + part.power, 0);
            const cost = chosen.reduce((sum, part) => sum + part.cost, 0);
            if (power >= interaction.target && cost <= interaction.budget) answer = chosen.map((part) => part.id);
          }
          break;
        }
        default:
          throw new Error(`unknown kind ${interaction.kind}`);
      }
      expect(answer, JSON.stringify(input)).toBeTruthy();
      expect(engine.checkAnswer(interaction, answer), JSON.stringify(input)).toMatchObject({ correct: true, progress: 1 });
      seen.add(interaction.kind);
    });
    expect([...seen].sort()).toEqual([...INTERACTION_KINDS].sort());
  });

  it('is deterministic for the same input and differs between consecutive counters', () => {
    for (const kind of INTERACTION_KINDS) {
      for (const grade of GRADES) {
        for (const theme of ['space', '']) {
          const first = makeChallenge({ kind, grade, mode: 'quest', theme, seq: 4 });
          expect(makeChallenge({ kind, grade, mode: 'quest', theme, seq: 4 })).toEqual(first);
          const next = makeChallenge({ kind, grade, mode: 'quest', theme, seq: 5 });
          expect(JSON.stringify(next)).not.toBe(JSON.stringify(first));
        }
      }
    }
  });

  it('gives every challenge a scene with emoji objects and unique ids', () => {
    everyCombination((input) => {
      const { scene } = makeChallenge(input);
      const ids = scene.objects.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(scene.objects.some((o) => o.type === 'emoji' && o.emoji)).toBe(true);
      expect(scene.objects.length).toBeLessThanOrEqual(30);
    });
  });

  it('builds choice items with exactly one correct, existing option and distinct labels', () => {
    everyCombination((input) => {
      if (input.kind !== 'choice') return;
      const { interaction } = makeChallenge(input);
      const ids = interaction.options.map((o) => o.id);
      expect(interaction.correctIds).toHaveLength(1);
      expect(ids).toContain(interaction.correctIds[0]);
      expect(new Set(interaction.options.map((o) => o.label)).size).toBe(interaction.options.length);
      expect(interaction.options.length).toBe(4);
    });
  });

  it('builds tap items whose targets are tappable scene objects, with at least one decoy', () => {
    everyCombination((input) => {
      if (input.kind !== 'tap') return;
      const { interaction, scene } = makeChallenge(input);
      const tappable = scene.objects.filter((o) => o.tappable).map((o) => o.id);
      expect(interaction.targetIds.length).toBeGreaterThan(0);
      for (const id of interaction.targetIds) expect(tappable).toContain(id);
      expect(tappable.length).toBeGreaterThan(interaction.targetIds.length);
    });
  });

  it('builds sort items that use every bin and only known bins', () => {
    everyCombination((input) => {
      if (input.kind !== 'sort') return;
      const { interaction } = makeChallenge(input);
      const binIds = interaction.bins.map((b) => b.id);
      const used = new Set(interaction.items.map((item) => item.binId));
      for (const id of used) expect(binIds).toContain(id);
      expect(used.size).toBe(binIds.length);
      expect(new Set(interaction.items.map((item) => item.id)).size).toBe(interaction.items.length);
    });
  });

  it('builds match items with unambiguous pairs', () => {
    everyCombination((input) => {
      if (input.kind !== 'match') return;
      const { pairs } = makeChallenge(input).interaction;
      expect(new Set(pairs.map((p) => p.id)).size).toBe(pairs.length);
      expect(new Set(pairs.map((p) => p.left.label)).size).toBe(pairs.length);
      expect(new Set(pairs.map((p) => p.right.label)).size).toBe(pairs.length);
    });
  });

  it('lists order items from the smallest to the biggest value', () => {
    const valueOf = (label) => {
      const [top, bottom] = label.split('/').map(Number);
      return bottom === undefined ? top : top / bottom;
    };
    everyCombination((input) => {
      if (input.kind !== 'order') return;
      const values = makeChallenge(input).interaction.items.map((item) => valueOf(item.label));
      for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThan(values[i - 1]);
    });
  });

  it('never gives the numeric answer away in a hint', () => {
    everyCombination((input) => {
      if (input.kind !== 'number') return;
      const challenge = makeChallenge(input);
      const { answer } = challenge.interaction;
      expect(Number.isInteger(answer)).toBe(true);
      for (const hint of challenge.hints) expect(numbersIn(hint)).not.toContain(Math.abs(answer));
    });
  });

  it('scales number answers with the grade', () => {
    const average = (grade) => {
      const answers = SEQS.map((seq) => makeChallenge({ kind: 'number', grade, seq }).interaction.answer);
      return answers.reduce((sum, n) => sum + n, 0) / answers.length;
    };
    expect(average('PK')).toBeLessThanOrEqual(5);
    expect(average('2')).toBeGreaterThan(average('PK'));
    expect(average('4')).toBeGreaterThan(average('2'));
  });

  it('builds robot mazes that are solvable with the allowed blocks inside maxCommands', () => {
    everyCombination((input) => {
      if (input.kind !== 'robot') return;
      const { interaction } = makeChallenge(input);
      const moves = solveRobotPlain(interaction);
      expect(moves, JSON.stringify(input)).not.toBeNull();
      expect(moves.length).toBeGreaterThanOrEqual(2);
      expect(moves.length).toBeLessThanOrEqual(interaction.maxCommands);
      expect(interaction.allowed).toContain('forward');
      const blocked = new Set(interaction.walls.map((w) => `${w.x},${w.y}`));
      expect(blocked.has(`${interaction.start.x},${interaction.start.y}`)).toBe(false);
      expect(blocked.has(`${interaction.goal.x},${interaction.goal.y}`)).toBe(false);
    });
  });

  it('gives older grades bigger mazes than Pre-K', () => {
    const cells = (grade) => {
      const { cols, rows } = makeChallenge({ kind: 'robot', grade, seq: 1 }).interaction;
      return cols * rows;
    };
    expect(cells('8')).toBeGreaterThan(cells('PK'));
    expect(makeChallenge({ kind: 'robot', grade: 'PK', seq: 1 }).interaction.allowed).toEqual(['forward']);
    expect(makeChallenge({ kind: 'robot', grade: '5', seq: 1 }).interaction.allowed).toContain('repeat');
  });

  it('builds invention items that are solvable but not by picking every part', () => {
    everyCombination((input) => {
      if (input.kind !== 'build') return;
      const { parts, target, budget } = makeChallenge(input).interaction;
      let solvable = false;
      for (let mask = 1; mask < 1 << parts.length; mask += 1) {
        let power = 0;
        let cost = 0;
        parts.forEach((part, bit) => {
          if (mask & (1 << bit)) {
            power += part.power;
            cost += part.cost;
          }
        });
        if (power >= target && cost <= budget) solvable = true;
      }
      expect(solvable, JSON.stringify(input)).toBe(true);
      const allCost = parts.reduce((sum, p) => sum + p.cost, 0);
      expect(allCost).toBeGreaterThan(budget);
    });
  });

  it('falls back to safe defaults for unknown kind, grade and mode', () => {
    const challenge = makeChallenge({ kind: 'teleport', grade: '99', mode: 'nonsense', seq: 2 });
    expect(ChallengeSchema.safeParse(challenge).success).toBe(true);
    expect(challenge.interaction.kind).toBe('choice');
    expect(ChallengeSchema.safeParse(makeChallenge()).success).toBe(true);
  });

  it('picks a cast that fits the theme', () => {
    expect(makeChallenge({ kind: 'choice', grade: '1', theme: 'dinosaurs', seq: 0 }).scene.theme).toBe('jungle');
    expect(makeChallenge({ kind: 'choice', grade: '1', theme: 'space', seq: 7 }).scene.theme).toBe('space');
  });
});

describe('solveRobotPlain', () => {
  const base = { kind: 'robot', cols: 3, rows: 3, walls: [], gems: [], allowed: ['forward', 'left', 'right'], maxCommands: 10 };

  it('finds the shortest route', () => {
    const moves = solveRobotPlain({ ...base, start: { x: 0, y: 0, dir: 'right' }, goal: { x: 2, y: 0 } });
    expect(moves).toEqual(['forward', 'forward']);
  });

  it('returns null when walls close the goal in', () => {
    const walls = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
    expect(solveRobotPlain({ ...base, walls, start: { x: 0, y: 0, dir: 'right' }, goal: { x: 2, y: 0 } })).toBeNull();
  });

  it('respects the allowed blocks', () => {
    const maze = { ...base, allowed: ['forward'], start: { x: 0, y: 0, dir: 'right' }, goal: { x: 2, y: 2 } };
    expect(solveRobotPlain(maze)).toBeNull();
  });

  it('collects gems before finishing', () => {
    const maze = { ...base, gems: [{ x: 0, y: 2 }], start: { x: 0, y: 0, dir: 'right' }, goal: { x: 2, y: 0 } };
    const moves = solveRobotPlain(maze);
    expect(moves.filter((m) => m === 'forward').length).toBeGreaterThanOrEqual(6);
  });
});

describe('other outputs', () => {
  it('makes tutor replies that match TutorReplySchema for every intent', () => {
    const intents = ['nudge', 'hint', 'walkthrough-step', 'wrong-answer', 'chat', 'praise', 'teachback-feedback', 'unknown'];
    for (const intent of intents) {
      const reply = makeTutorReply({ intent, seq: 1 });
      expect(TutorReplySchema.safeParse(reply).success).toBe(true);
      expect(reply.redirected).toBe(false);
      expect(reply.highlightIds).toEqual([]);
    }
    expect(makeTutorReply({ redirect: true }).redirected).toBe(true);
  });

  it('makes stories with the requested number of chapters, clamped to 2..5', () => {
    for (const [asked, expected] of [[2, 2], [3, 3], [4, 4], [5, 5], [1, 2], [9, 5], ['4', 4], [undefined, 3], ['abc', 3]]) {
      const story = makeStory({ theme: 'ocean', chapters: asked, seq: 3 });
      expect(StoryOutlineSchema.safeParse(story).success).toBe(true);
      expect(story.chapters).toHaveLength(expected);
    }
    expect(makeStory({ theme: 'pirates', seq: 0 }).title).toContain('Pirates');
  });

  it('makes notes, reports and safety verdicts that match their schemas', () => {
    expect(LearnerNotesSchema.safeParse(makeNotes()).success).toBe(true);
    expect(WeeklyReportSchema.safeParse(makeReport()).success).toBe(true);
    expect(SafetyVerdictSchema.parse(makeSafetyVerdict())).toEqual({ safe: true, reason: '' });
    expect(SafetyVerdictSchema.parse(makeSafetyVerdict(true)).safe).toBe(false);
  });
});

describe('text helpers', () => {
  it('rewrites symbols and small numbers for read-aloud', () => {
    expect(toSpeech('What is 3 + 4?')).toBe('What is three plus four?');
    expect(toSpeech('6 × 7 = 42')).toBe('six times seven equals 42');
    expect(toSpeech('25% of 80')).toBe('25 percent of 80');
    expect(toSpeech('It is 1.5 m long')).toBe('It is 1.5 m long');
  });

  it('cleans themes down to harmless text', () => {
    expect(cleanTheme('  <b>space</b> & "rockets"  ')).toBe('b space b rockets');
    expect(cleanTheme(undefined)).toBe('');
    expect(cleanTheme('x'.repeat(100)).length).toBeLessThanOrEqual(30);
  });
});
