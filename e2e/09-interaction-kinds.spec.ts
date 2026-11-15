/**
 * All eight ways to answer, one after the other, each solved through its own widget.
 *
 * Which kinds come up in normal play depends on the child's plan, so here one sample
 * challenge of every kind is put into the database as the child's unfinished challenges
 * (the play screen resumes them, oldest first). First a wrong answer, then the right one.
 */
import { expect, test } from '@playwright/test';
import { expectNoSkip, pickChild, seedPlacementDone, setupAndOpenPicker, shot, watchPage } from './helpers/app';
import { attemptsOf, challengesOf, putRow } from './helpers/db';
import { answerCorrectly, answerWrongly, currentChallenge, finishSolved, wrongAnswer } from './helpers/solver';
import { SKILLS } from '../src/core/skills';
import { INTERACTION_KINDS, type ChallengeRecord } from '../src/core/types';
import { SAMPLE_CHALLENGES } from '../src/engine/samples';

/** Grade 2, first step: `gradeIndex * 4 + stepIndex`. */
const GRADE_2_STARTING = 3 * 4;

test('every interaction kind can be answered through its widget', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  await seedPlacementDone(page, child.id);

  const startedAt = Date.now() - 60_000;
  for (const [index, kind] of INTERACTION_KINDS.entries()) {
    const skill = SKILLS.find((candidate) => candidate.interactions.includes(kind) && candidate.gradeExpectations['2'] !== undefined) ?? SKILLS[0];
    if (!skill) throw new Error('The skill map is empty');
    const record: ChallengeRecord = {
      id: `ch_e2e_${kind}`,
      childId: child.id,
      skillId: skill.id,
      strand: skill.strand,
      stage: GRADE_2_STARTING,
      interaction: kind,
      mode: kind === 'robot' ? 'robot' : kind === 'build' ? 'invention' : 'quest',
      purpose: 'core',
      theme: 'space',
      content: SAMPLE_CHALLENGES[kind],
      source: 'offline',
      status: 'active',
      storyId: null,
      chapterIndex: null,
      libraryId: null,
      parentRating: null,
      parentNote: '',
      createdAt: startedAt + index,
      startedAt: startedAt + index,
      completedAt: null,
    };
    await putRow(page, 'challenges', record);
  }

  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Keep exploring' }).click();

  for (const [index, kind] of INTERACTION_KINDS.entries()) {
    const record = await currentChallenge(page, child.id);
    expect(record.id).toBe(`ch_e2e_${kind}`);
    await expect(page.locator(`[data-interaction="${kind}"]`)).toBeVisible();
    await shot(page, testInfo, `play-kind-${kind}`);
    await expectNoSkip(page);

    // A wrong try keeps the challenge open, then the right answer solves it.
    const canBeWrong = wrongAnswer(record.content) !== null;
    expect(canBeWrong).toBe(true);
    await answerWrongly(page, record);
    await answerCorrectly(page, record);
    await shot(page, testInfo, `play-kind-${kind}-answered`, { settleMs: 300 });
    await finishSolved(page, record);

    const attempt = (await attemptsOf(page, child.id)).find((row) => row.challengeId === record.id);
    expect(attempt?.outcome).toBe('second-try');
    expect(attempt?.answers.map((answer) => answer.correct)).toEqual([false, true]);
    expect((await challengesOf(page, child.id)).find((row) => row.id === record.id)?.status).toBe('completed');
    if (index < INTERACTION_KINDS.length - 1) await page.getByTestId('next-button').click();
  }

  expect((await attemptsOf(page, child.id)).length).toBe(INTERACTION_KINDS.length);
  expect(watch.problems).toEqual([]);
});
