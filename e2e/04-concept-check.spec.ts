/**
 * Concept checks (back testing): mastery alone never raises a level. A new challenge on the
 * same idea has to be solved without help first.
 */
import { expect, test } from '@playwright/test';
import { pickChild, seedPlacementDone, setupAndOpenPicker, shot, watchPage } from './helpers/app';
import { attemptsOf, putRow, rows } from './helpers/db';
import { answerCorrectly, currentChallenge, finishSolved, nextAdventure } from './helpers/solver';
import { SKILLS } from '../src/core/skills';

test('a skill at the threshold gets a star challenge, and passing it raises the level', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  await seedPlacementDone(page, child.id);
  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Keep exploring' }).click();

  // The skill of the challenge on screen is put just below the step-up threshold (80).
  const record = await currentChallenge(page, child.id);
  expect(['core', 'stretch']).toContain(record.purpose);
  const stateId = `${child.id}:${record.skillId}`;
  await putRow(page, 'skillStates', {
    id: stateId,
    childId: child.id,
    skillId: record.skillId,
    strand: record.strand,
    stage: record.stage,
    mastery: 75,
    assistedStreak: 0,
    independentStreak: 1,
    attempts: 4,
    checkPending: false,
    checksPassed: 0,
    recentInteractions: [record.interaction],
    lastPracticedAt: Date.now() - 86_400_000,
    reviewDueAt: null,
    reviewIntervalDays: 2,
  });
  const stateNow = async () => (await rows(page, 'skillStates')).find((row) => row.id === stateId);

  // Solving it alone reaches the threshold, but the level does not move yet.
  await answerCorrectly(page, record);
  await finishSolved(page, record);
  const pending = await stateNow();
  expect(pending).toMatchObject({ checkPending: true, stage: record.stage, checksPassed: 0 });
  expect(pending?.mastery).toBeGreaterThanOrEqual(80);
  expect((await rows(page, 'stageChanges')).filter((row) => row.skillId === record.skillId)).toEqual([]);

  // The next item is the concept check: same skill and level, a new challenge.
  await nextAdventure(page);
  const check = await currentChallenge(page, child.id);
  expect(check).toMatchObject({ purpose: 'check', skillId: record.skillId, stage: record.stage });
  expect(check.id).not.toBe(record.id);
  expect(check.content.question).not.toBe(record.content.question);
  const skill = SKILLS.find((candidate) => candidate.id === record.skillId);
  if ((skill?.interactions.length ?? 0) > 1) expect(check.interaction).not.toBe(record.interaction);
  const card = page.getByTestId('prompt-card');
  await expect(card).toHaveAttribute('data-frame', 'check');
  await expect(card).toContainText('Star challenge!');
  await expect(card).toContainText('Show what you know.');
  await shot(page, testInfo, 'play-concept-check');

  // Passed without help: the level steps up.
  await answerCorrectly(page, check);
  await expect(page.getByTestId('solved-sheet').getByRole('heading', { name: 'You proved it!' })).toBeVisible();
  await shot(page, testInfo, 'play-concept-check-passed', { settleMs: 400 });
  await finishSolved(page, check);

  const passed = await stateNow();
  expect(passed).toMatchObject({ checkPending: false, stage: record.stage + 1, checksPassed: 1 });
  expect(passed?.reviewDueAt).not.toBeNull();
  const changes = (await rows(page, 'stageChanges')).filter((row) => row.childId === child.id && row.skillId === record.skillId);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ from: record.stage, to: record.stage + 1, reason: 'mastery', strand: record.strand });
  expect((await attemptsOf(page, child.id)).map((row) => row.outcome)).toEqual(['independent', 'independent']);
  await shot(page, testInfo, 'play-concept-check-rewards');

  expect(watch.problems).toEqual([]);
});
