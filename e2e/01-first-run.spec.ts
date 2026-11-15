/**
 * First run: a device that has never seen the app goes to the setup wizard, and a parent
 * finishes it in Demo mode.
 */
import { expect, test } from '@playwright/test';
import { completeSetup, PARENT_PASSWORD, shot, watchPage } from './helpers/app';
import { rows, settings } from './helpers/db';

test('a new device goes through setup and lands on the profile picker', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);

  await completeSetup(page, {
    nickname: 'Mira',
    grade: 'Grade 2',
    onStep: (name) => shot(page, testInfo, `setup-${name}`, { fullPage: true }),
  });

  // What the wizard promised is what is stored.
  const saved = await settings(page);
  expect(saved.setupComplete).toBe(true);
  expect(saved.ai.provider).toBe('demo');
  expect(saved.ai.apiKeyCipher).toBeNull();
  expect(saved.controls.allowedStartHour).toBe(0);
  expect(saved.controls.allowedEndHour).toBe(24);
  expect(saved.auth?.hash).toBeTruthy();
  expect(JSON.stringify(saved)).not.toContain(PARENT_PASSWORD);
  const children = await rows(page, 'children');
  expect(children).toHaveLength(1);
  expect(children[0]).toMatchObject({ nickname: 'Mira', grade: '2', placementDone: false, stars: 0 });

  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page).toHaveURL(/\/kids$/);
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play as Mira' })).toBeVisible();
  await shot(page, testInfo, 'profile-picker');

  // Setup cannot be run twice, and the start page now leads to the players.
  await page.goto('/');
  await expect(page).toHaveURL(/\/kids$/);
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/parent$/);
  await expect(page.getByLabel('Parent password')).toBeVisible();

  expect(watch.problems).toEqual([]);
});

test('child screens cannot be reached before setup is finished', async ({ page }) => {
  await page.goto('/kids');
  await expect(page).toHaveURL(/\/setup$/);
  await page.goto('/kids/someone/play');
  await expect(page).toHaveURL(/\/setup$/);
});
