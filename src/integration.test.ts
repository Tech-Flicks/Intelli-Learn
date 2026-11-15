/**
 * The first-wave modules working together, the way the play screen will use them:
 *
 *   data (child, settings, backup) -> progression (plan, record, limits, stats)
 *   -> skills (grade expectation) -> ai (generate, tutor, story, report; demo mode,
 *   so everything comes from the offline bank) -> engine (normalize, validate, check)
 *   -> i18n (labels) -> back to data (backup, restore, delete).
 *
 * No module is mocked. A disagreement between two modules about a record shape, an
 * id, a stage or an answer format shows up here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, stageGrade } from '@/core/grades';
import { ChallengeSchema, StoryOutlineSchema, type Challenge, type Interaction } from '@/core/schemas';
import { expectationAt, getSkill } from '@/core/skills';
import {
  STRANDS,
  type AnswerEvent,
  type AttemptResult,
  type ChallengePlan,
  type ChallengeRecord,
  type ChildProfile,
  type Grade,
  type AgeGroup,
  type StoryRecord,
  type WeeklyReport,
} from '@/core/types';
import {
  CHILD_TABLES,
  createChild,
  db,
  deleteChild,
  exportBackup,
  getSettings,
  getUsageToday,
  importBackup,
  parseBackup,
  updateChild,
  wipeEverything,
  type BackupFile,
} from '@/data';
import {
  generateChallenge,
  generateLearnerNotes,
  generateStoryOutline,
  generateWeeklyReport,
  getAiStatus,
  localSafetyCheck,
  tutorReply,
  type ChildContext,
} from '@/ai';
import { checkAnswer, normalizeChallenge, solveRobot, validateChallengeContent, type Answer, type RobotProgram } from '@/engine';
import { stageName } from '@/i18n';
import {
  effectiveControls,
  endSession,
  getPlayAllowance,
  getStrandStages,
  outcomeOf,
  placementStatus,
  planNext,
  recordAttempt,
  seededRng,
  startSession,
  tickSession,
  weekStartOf,
  weekStats,
} from '@/progression';

/** Monday 9 November 2026, 16:00 local time: inside the default allowed hours. */
const START = new Date(2026, 10, 9, 16, 0, 0).getTime();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ITEMS_PER_DAY = 10;

/** Shortens a plain program with repeat blocks, for mazes whose block limit expects them. */
function withRepeats(program: RobotProgram): RobotProgram {
  const out: RobotProgram = [];
  let index = 0;
  while (index < program.length) {
    let run = 1;
    while (run < 5 && program[index + run]?.cmd === program[index]?.cmd) run += 1;
    const step = program[index];
    if (!step) break;
    if (run >= 3) out.push({ cmd: 'repeat', times: run, body: [step] });
    else out.push(...program.slice(index, index + run));
    index += run;
  }
  return out;
}

/** The correct answer, built from the challenge's own answer key. */
function rightAnswer(i: Interaction): Answer {
  switch (i.kind) {
    case 'choice':
      return [...i.correctIds];
    case 'tap':
      return [...i.targetIds];
    case 'sort':
      return Object.fromEntries(i.items.map((item) => [item.id, item.binId]));
    case 'match':
      return Object.fromEntries(i.pairs.map((pair) => [pair.id, pair.id]));
    case 'order':
      return i.items.map((item) => item.id);
    case 'number':
      return i.answer;
    case 'robot': {
      const plain = solveRobot(i) ?? [];
      return checkAnswer(i, plain).correct ? plain : withRepeats(plain);
    }
    case 'build': {
      for (let mask = 1; mask < 1 << i.parts.length; mask += 1) {
        const chosen = i.parts.filter((_, bit) => (mask & (1 << bit)) !== 0);
        const power = chosen.reduce((sum, part) => sum + part.power, 0);
        const cost = chosen.reduce((sum, part) => sum + part.cost, 0);
        if (power >= i.target && cost <= i.budget) return chosen.map((part) => part.id);
      }
      return [];
    }
  }
}

/** A plausible wrong answer, or null when this kind has no simple one. */
function wrongAnswer(i: Interaction): Answer | null {
  if (i.kind === 'choice') {
    const wrong = i.options.find((option) => !i.correctIds.includes(option.id));
    return wrong ? [wrong.id] : null;
  }
  if (i.kind === 'number') return i.answer + 1 + i.tolerance * 2;
  if (i.kind === 'order') return [...i.items.map((item) => item.id)].reverse();
  return null;
}

/** Every text of a challenge that a child reads or hears. */
function childFacingText(c: Challenge): string {
  const parts = [c.title, c.intro, c.question, c.readAloud, ...c.hints, ...c.walkthrough, c.explanation, c.funFact ?? ''];
  if (c.teachBack) parts.push(c.teachBack.prompt, ...c.teachBack.options.map((option) => option.label));
  for (const object of c.scene.objects) parts.push(object.text ?? '', object.label ?? '');
  return parts.join('\n');
}

interface Played {
  plan: ChallengePlan;
  record: ChallengeRecord;
  result: AttemptResult;
}

/** Plans, builds, solves and records one item, exactly as the play screen will. */
async function playOne(child: ChildProfile, index: number, now: number, rng: () => number, recentTitles: string[]): Promise<Played> {
  const settings = await getSettings();
  const controls = effectiveControls(settings, child);
  const context: ChildContext = { ageGroup: child.ageGroup, grade: child.grade, interests: child.interests, locale: settings.contentLocale, strictness: controls.strictness };

  const [plan] = await planNext(child.id, 1, { now, rng });
  if (!plan) throw new Error('planNext returned no plan');
  const skill = getSkill(plan.skillId);
  if (!skill) throw new Error(`the plan names a skill the map does not have: ${plan.skillId}`);
  expect(plan.strand).toBe(skill.strand);
  expect(controls.strands[plan.strand]).toBe(true);
  // A stage always has a translated name a parent can read.
  expect(stageName(plan.stage)).toMatch(/\S, \S/);

  const expectation = expectationAt(skill, plan.stage);
  const built = await generateChallenge({ plan, child: context, expectation, skillName: skill.name, avoidTitles: recentTitles });
  expect(built.source).toBe('offline');
  const where = `item ${index}: ${plan.skillId} ${stageGrade(plan.stage)} ${plan.interaction} ${plan.mode} ${plan.purpose} "${built.content.title}"`;
  expect(built.content.interaction.kind, where).toBe(plan.interaction);
  expect(() => ChallengeSchema.parse(built.content), where).not.toThrow();
  expect(validateChallengeContent(normalizeChallenge(built.content)), where).toEqual([]);
  expect(localSafetyCheck(childFacingText(built.content), controls.strictness), where).toEqual({ safe: true, reason: '' });

  const record: ChallengeRecord = {
    id: newId('ch'),
    childId: child.id,
    skillId: plan.skillId,
    strand: plan.strand,
    stage: plan.stage,
    interaction: plan.interaction,
    mode: plan.mode,
    purpose: plan.purpose,
    theme: plan.theme,
    content: built.content,
    source: built.source,
    status: 'active',
    storyId: null,
    chapterIndex: null,
    libraryId: null,
    parentRating: null,
    parentNote: '',
    createdAt: now,
    startedAt: now,
    completedAt: null,
  };
  await db.challenges.put(record);

  // Every third item starts with a wrong try, and every fifth asks the helper for a hint.
  const answers: AnswerEvent[] = [];
  const interaction = built.content.interaction;
  const wrong = index % 3 === 2 ? wrongAnswer(interaction) : null;
  if (wrong !== null) {
    const check = checkAnswer(interaction, wrong);
    expect(check.correct, where).toBe(false);
    answers.push({ at: now + 20_000, answer: wrong, correct: false, misconception: check.misconception });
    const comfort = await tutorReply({ child: context, challenge: built.content, intent: 'wrong-answer', hintLevel: 0, misconception: check.misconception, openChat: controls.openChat });
    expect(comfort.say.trim(), where).not.toBe('');
  }
  let hintsUsed: 0 | 1 | 2 = 0;
  if (index % 5 === 4) {
    const hint = await tutorReply({ child: context, challenge: built.content, intent: 'nudge', hintLevel: 1, openChat: controls.openChat });
    expect(hint.say.trim(), where).not.toBe('');
    expect(localSafetyCheck(hint.say, controls.strictness).safe, where).toBe(true);
    hintsUsed = 1;
  }
  const answer = rightAnswer(interaction);
  const verdict = checkAnswer(interaction, answer);
  expect(verdict, where).toMatchObject({ correct: true, progress: 1 });
  answers.push({ at: now + 45_000, answer, correct: true, misconception: null });

  const result = await recordAttempt({ challenge: record, answers, hintsUsed, walkthroughUsed: false, teachBackCorrect: built.content.teachBack ? true : null, timeMs: 45_000, now: now + 45_000 });
  expect(result.attempt.outcome, where).toBe(outcomeOf({ answers, hintsUsed, walkthroughUsed: false }));
  expect(result.attempt.starsEarned, where).toBeGreaterThanOrEqual(1);
  expect((await db.challenges.get(record.id))?.status, where).toBe('completed');
  return { plan, record, result };
}

/** Plays `items` items over several days, with a play session per day. */
async function playJourney(child: ChildProfile, items: number, seed: number): Promise<Played[]> {
  const rng = seededRng(seed);
  const played: Played[] = [];
  const titles: string[] = [];
  let sessionId: string | null = null;
  for (let index = 0; index < items; index += 1) {
    const now = START + Math.floor(index / ITEMS_PER_DAY) * DAY + (index % ITEMS_PER_DAY) * MINUTE;
    if (index % ITEMS_PER_DAY === 0) {
      expect((await getPlayAllowance(child.id, now)).allowed).toBe(true);
      sessionId = (await startSession(child.id, now)).id;
    }
    const fresh = await db.children.get(child.id);
    if (!fresh) throw new Error('the child disappeared');
    const one = await playOne(fresh, index, now, rng, titles.slice(-8));
    played.push(one);
    titles.push(one.record.content.title);
    if (sessionId) await tickSession(sessionId, MINUTE, now + MINUTE);
    if (index % ITEMS_PER_DAY === ITEMS_PER_DAY - 1 && sessionId) {
      await endSession(sessionId, now + MINUTE);
      sessionId = null;
    }
  }
  if (sessionId) await endSession(sessionId, START + Math.floor(items / ITEMS_PER_DAY) * DAY + ITEMS_PER_DAY * MINUTE);
  return played;
}

async function tableCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = { children: await db.children.count(), library: await db.library.count() };
  for (const name of CHILD_TABLES) counts[name] = await db.table(name).count();
  return counts;
}

async function newChild(nickname: string, grade: Grade, ageGroup: AgeGroup, interests: string[]): Promise<ChildProfile> {
  const child = await createChild({ nickname, avatar: '🦊', ageGroup, grade, interests }, START - DAY);
  expect(child.placementDone).toBe(false);
  return child;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('first-wave modules end to end (demo mode, no network)', () => {
  it('needs no AI: a fresh device is in demo mode and nothing is ever counted as an AI request', async () => {
    expect(await getAiStatus()).toMatchObject({ provider: 'demo', ready: false });
    const child = await newChild('Mira', '2', '6-8', ['space']);
    await playJourney(child, 4, 1);
    expect(await getUsageToday()).toMatchObject({ requests: 0, imageRequests: 0, failures: 0 });
  });

  it.each([
    ['a Kindergarten child', 'K', '3-5', ['animals', 'trains'], 11],
    ['a Grade 3 child', '3', '6-8', ['space', 'dinosaurs'], 22],
    ['a Grade 7 child', '7', '12-14', ['video games', 'music'], 33],
  ] as const)('%s plays 45 items: placement, practice, checks, rewards and stats all agree', async (_name, grade, ageGroup, interests, seed) => {
    const child = await newChild('Mira', grade, ageGroup, [...interests]);
    const played = await playJourney(child, 45, seed);

    // Placement is the first eight items and nothing else.
    expect(played.slice(0, 8).every((one) => one.plan.purpose === 'placement')).toBe(true);
    expect(played.slice(8).some((one) => one.plan.purpose === 'placement')).toBe(false);
    expect(await placementStatus(child.id)).toMatchObject({ done: true });

    const after = await db.children.get(child.id);
    if (!after) throw new Error('child missing');
    expect(after.placementDone).toBe(true);
    // Stars never go down, and the balance is the reward log.
    const earned = played.reduce((sum, one) => sum + one.result.attempt.starsEarned, 0);
    expect(after.totalStars).toBe(earned);
    const rewards = await db.rewards.where('childId').equals(child.id).toArray();
    expect(rewards.reduce((sum, reward) => sum + reward.amount, 0)).toBe(after.stars);
    expect(after.streakDays).toBeGreaterThanOrEqual(1);

    // Every strand has been practised and has a stage on the skill map.
    const strands = await getStrandStages(child.id);
    expect(strands.map((entry) => entry.strand)).toEqual([...STRANDS]);
    for (const entry of strands) {
      expect(entry.practisedSkills, entry.strand).toBeGreaterThan(0);
      expect(entry.stage, entry.strand).not.toBeNull();
    }

    // The plans stayed varied: several kinds of interaction and several skills.
    expect(new Set(played.map((one) => one.plan.interaction)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(played.map((one) => one.plan.skillId)).size).toBeGreaterThanOrEqual(8);
    // The same title is not served twice in a row.
    for (let i = 1; i < played.length; i += 1) expect(played[i]?.record.content.title).not.toBe(played[i - 1]?.record.content.title);

    // The week's numbers for the parent match what was played in that week.
    const week = weekStartOf(START);
    const stats = await weekStats(child.id, week);
    expect(stats.completed).toBe(played.length);
    expect(stats.minutes).toBeGreaterThan(0);
    expect(stats.independentShare).toBeGreaterThan(0);
    expect(stats.independentShare).toBeLessThanOrEqual(1);
    expect(await db.attempts.where('childId').equals(child.id).count()).toBe(played.length);
    expect(await db.sessions.where('childId').equals(child.id).count()).toBe(Math.ceil(played.length / ITEMS_PER_DAY));
  }, 60_000);

  it('everything the modules wrote survives backup, a full wipe and restore, and play goes on', async () => {
    const mira = await newChild('Mira', '4', '9-11', ['robots']);
    const leo = await newChild('Leo', 'PK', '3-5', ['animals']);
    await playJourney(mira, 14, 5);
    await playJourney(leo, 5, 6); // stops in the middle of placement
    await updateChild(mira.id, { accessibility: { ...mira.accessibility, dyslexiaFont: true } });

    // A story, a weekly report and (no AI) no learner notes, as the play and parent screens will store them.
    const settings = await getSettings();
    const context: ChildContext = { ageGroup: mira.ageGroup, grade: mira.grade, interests: mira.interests, locale: settings.contentLocale, strictness: 'strict' };
    const outline = await generateStoryOutline({ child: context, theme: 'robots', chapters: 3 });
    expect(() => StoryOutlineSchema.parse(outline)).not.toThrow();
    const story: StoryRecord = {
      id: newId('story'),
      childId: mira.id,
      title: outline.title,
      theme: 'robots',
      chapters: outline.chapters.map((chapter) => ({ heading: chapter.heading, narrative: chapter.narrative, imageDataUrl: null })),
      ending: outline.ending,
      currentChapter: 0,
      status: 'active',
      createdAt: START,
    };
    await db.stories.put(story);
    const week = weekStartOf(START);
    const stats = await weekStats(mira.id, week);
    const strandStages = (await getStrandStages(mira.id)).flatMap((entry) => (entry.stage === null ? [] : [{ strand: entry.strand, label: stageName(entry.stage) }]));
    const written = await generateWeeklyReport({ child: context, stats, strandStages, learnerSummary: '' });
    const report: WeeklyReport = { id: newId('report'), childId: mira.id, weekStart: week, ...written, stats, createdAt: START };
    await db.weeklyReports.put(report);
    expect(await generateLearnerNotes({ child: context, attempts: [] })).toBeNull();

    const before = await tableCounts();
    expect(before.children).toBe(2);
    expect(before.attempts).toBe(19);

    // The file is plain JSON, passes the strict import validation, and holds no secrets.
    const file = JSON.parse(JSON.stringify(await exportBackup())) as BackupFile;
    expect(() => parseBackup(file)).not.toThrow();
    const oneChild = JSON.parse(JSON.stringify(await exportBackup({ childId: leo.id }))) as BackupFile;
    expect(parseBackup(oneChild).children.map((child) => child.id)).toEqual([leo.id]);

    await wipeEverything();
    expect((await tableCounts()).children).toBe(0);
    expect(await db.kv.count()).toBe(0);

    const restored = await importBackup(file, 'replace');
    expect(restored).toMatchObject({ children: 2, skipped: 0 });
    expect(await tableCounts()).toEqual(before);
    expect((await db.children.get(mira.id))?.accessibility.dyslexiaFont).toBe(true);
    expect(await db.stories.get(story.id)).toEqual(story);

    // Mira carries on where she stopped. Leo's placement starts again, because its
    // running estimates are a device cache that backups leave out.
    const miraNow = await db.children.get(mira.id);
    const leoNow = await db.children.get(leo.id);
    if (!miraNow || !leoNow) throw new Error('children missing after restore');
    const later = START + 3 * DAY;
    const next = await playOne(miraNow, 100, later, seededRng(9), []);
    expect(next.plan.purpose).not.toBe('placement');
    expect(await placementStatus(leo.id)).toMatchObject({ done: false });
    const leoNext = await playOne(leoNow, 101, later, seededRng(10), []);
    expect(leoNext.plan.purpose).toBe('placement');
  }, 60_000);

  it('deleting one child removes every trace of that child and nothing of the other', async () => {
    const mira = await newChild('Mira', '5', '9-11', ['space']);
    const leo = await newChild('Leo', '1', '6-8', ['dinosaurs']);
    await playJourney(mira, 10, 7);
    await playJourney(leo, 10, 8);
    const leoRows: Record<string, number> = {};
    for (const name of CHILD_TABLES) leoRows[name] = await db.table(name).where('childId').equals(leo.id).count();
    expect(leoRows.attempts).toBe(10);
    expect((await db.kv.toCollection().primaryKeys()).some((key) => key.endsWith(`:${mira.id}`))).toBe(true);

    await deleteChild(mira.id);

    expect(await db.children.get(mira.id)).toBeUndefined();
    for (const name of CHILD_TABLES) {
      expect(await db.table(name).where('childId').equals(mira.id).count(), name).toBe(0);
      expect(await db.table(name).where('childId').equals(leo.id).count(), name).toBe(leoRows[name]);
    }
    const keys = await db.kv.toCollection().primaryKeys();
    expect(keys.some((key) => key.includes(mira.id))).toBe(false);
    expect(keys.some((key) => key.endsWith(`:${leo.id}`))).toBe(true);
    // The nickname is nowhere in what is left.
    const everything = JSON.stringify(await exportBackup());
    expect(everything).not.toContain('Mira');
    expect(everything).toContain('Leo');
  }, 60_000);
});
