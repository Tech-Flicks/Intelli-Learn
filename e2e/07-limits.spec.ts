/**
 * Play time: the daily limit is applied between challenges, never in the middle of one,
 * and ends in a calm rest screen. Nothing the child earned is taken away.
 */
import { expect, test } from '@playwright/test';
import { expectNoSkip, pickChild, setupAndOpenPicker, shot, watchPage } from './helpers/app';
import { attemptsOf, childByNickname, patchRow, putRow, settings, today } from './helpers/db';
import { answerCorrectly, currentChallenge, finishSolved } from './helpers/solver';

test('when the daily play time is used up, the child finishes the challenge and is taken to the rest screen', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Start your adventure' }).click();
  const record = await currentChallenge(page, child.id);

  // While the challenge is open, the limit becomes one minute and an earlier session of
  // today has already used five. (Written straight to the database, as the task of this test.)
  const current = await settings(page);
  await patchRow(page, 'settings', 'app', { controls: { ...current.controls, dailyMinutes: 1 } });
  const now = Date.now();
  await putRow(page, 'sessions', {
    id: 'session_e2e_used_up',
    childId: child.id,
    day: await today(page),
    startedAt: now - 20 * 60_000,
    endedAt: now - 15 * 60_000,
    activeMs: 5 * 60_000,
    itemsCompleted: 3,
  });

  // The challenge in progress is not interrupted: it can still be solved and it counts.
  await answerCorrectly(page, record);
  await finishSolved(page, record);
  const attempt = (await attemptsOf(page, child.id)).find((row) => row.challengeId === record.id);
  expect(attempt?.starsEarned).toBeGreaterThan(0);
  const starsEarned = (await childByNickname(page, 'Mira')).stars;
  expect(starsEarned).toBe(attempt?.starsEarned);

  // No next adventure: the way on is the rest.
  const rest = page.getByTestId('next-button');
  await expect(rest).toHaveText(/Time for a rest/);
  await expect(page.getByTestId('solved-sheet')).toContainText('That is all the play time for today. See you soon!');
  await expect(page.getByRole('button', { name: 'Next adventure' })).toHaveCount(0);
  await shot(page, testInfo, 'play-time-is-up');
  await rest.click();

  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/rest$`));
  await expect(page.getByRole('heading', { name: 'Great work today!' })).toBeVisible();
  await expect(page.getByText('Your brain grew. See you tomorrow.')).toBeVisible();
  await expect(page.getByTestId('today-stars')).toHaveAccessibleName(new RegExp(`^${starsEarned} stars?$`));
  await expect(page.getByTestId('today-items')).toContainText('1 challenge solved');
  await shot(page, testInfo, 'rest-screen');
  await expectNoSkip(page);

  // Every way back into play leads to the rest screen today.
  await page.goto(`/kids/${child.id}/play`);
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/rest$`));
  await page.goto(`/kids/${child.id}/studio`);
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/(rest)?$`));

  // The stars are still there, and the child can go back to the players.
  expect((await childByNickname(page, 'Mira')).stars).toBe(starsEarned);
  await page.goto(`/kids/${child.id}/rest`);
  await page.getByRole('button', { name: 'Back to players' }).click();
  await expect(page).toHaveURL(/\/kids$/);

  expect(watch.problems).toEqual([]);
});

test('outside the allowed hours the child sees when to come back', async ({ page }, testInfo) => {
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  // Play is allowed for one hour only, and that hour is not now.
  const hour = await page.evaluate(() => new Date().getHours());
  const start = (hour + 2) % 24;
  const current = await settings(page);
  await patchRow(page, 'settings', 'app', { controls: { ...current.controls, allowedStartHour: start, allowedEndHour: start + 1 } });
  await page.goto(`/kids/${child.id}/play`);
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/rest$`));
  await expect(page.getByRole('heading', { name: 'Pip is resting.' })).toBeVisible();
  await expect(page.getByText(/^Come back at \d{1,2}(:00)? ?(AM|PM)\.$/)).toBeVisible();
  await shot(page, testInfo, 'rest-screen-outside-hours');
});
