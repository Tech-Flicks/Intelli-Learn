/**
 * The parent area: the password gate, the history with what the child answered, rating a
 * canvas, the canvas library, and a control that changes what the child sees.
 */
import { expect, test } from '@playwright/test';
import { childTab, connectMockAi, parentSection, pickChild, setupAndOpenPicker, shot, toKidsArea, unlockParentArea, watchPage, MOCK_AI_ORIGIN, PARENT_PASSWORD, closeToasts } from './helpers/app';
import { attemptsOf, completedOf, rows, settings } from './helpers/db';
import { answerCorrectly, answerWrongly, currentChallenge, finishSolved, nextAdventure, solveCurrent } from './helpers/solver';

test('a parent unlocks the area, reviews and rates what was played, and switches a subject off', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin, MOCK_AI_ORIGIN]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });

  // The small lock on the profile picker leads to the gate.
  await page.getByRole('button', { name: 'Grown-ups' }).click();
  await expect(page).toHaveURL(/\/parent$/);
  const password = page.getByLabel('Parent password');
  await expect(page.getByRole('heading', { name: 'Parent area', level: 1 })).toBeVisible();
  await shot(page, testInfo, 'parent-gate');

  // A wrong password says how many tries are left, and nothing of the area is shown.
  await password.fill('not-the-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That password is not right. 4 tries left before a short lock.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Parent area sections' })).toHaveCount(0);
  await password.fill('still-wrong');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That password is not right. 3 tries left before a short lock.')).toBeVisible();
  await shot(page, testInfo, 'parent-gate-wrong-password');
  expect((await settings(page)).auth?.failedAttempts).toBe(2);

  await password.fill(PARENT_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  expect((await settings(page)).auth?.failedAttempts).toBe(0);

  // Connect the AI, so that what the child plays is kept in the canvas library.
  await connectMockAi(page);
  await shot(page, testInfo, 'parent-settings-ai');

  // The child plays two challenges: the first with one wrong try, the second straight away.
  await toKidsArea(page);
  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Start your adventure' }).click();
  const first = await currentChallenge(page, child.id);
  await answerWrongly(page, first);
  await answerCorrectly(page, first);
  await finishSolved(page, first);
  await nextAdventure(page);
  const second = await solveCurrent(page, child.id);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Switch player' }).click();
  await page.getByRole('button', { name: 'Grown-ups' }).click();

  // Leaving for the kids' area locked the parent area again.
  await expect(page.getByLabel('Parent password')).toBeVisible();
  await unlockParentArea(page);
  const card = page.getByRole('article', { name: 'Mira' });
  await expect(card).toContainText('Challenges solved');
  await shot(page, testInfo, 'parent-overview');

  await childTab(page, 'Mira', 'Progress');
  await shot(page, testInfo, 'parent-child-progress');

  // History: both challenges, newest first, with every answer the child gave.
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 challenges' })).toBeVisible();
  const entries = page.getByRole('tabpanel').getByRole('listitem').filter({ has: page.getByRole('article') });
  await expect(entries).toHaveCount(2);
  const firstEntry = entries.filter({ has: page.getByRole('heading', { name: first.content.title, exact: true }) }).filter({ hasText: first.content.question });
  await expect(firstEntry).toHaveCount(1);
  await expect(firstEntry).toContainText('Made by AI');
  await firstEntry.getByRole('button', { name: 'Answers, conversation and rating' }).click();
  const answers = firstEntry.getByRole('list').filter({ hasText: 'Not yet' });
  await expect(answers.getByRole('listitem')).toHaveCount(2);
  await expect(answers.getByRole('listitem').nth(0)).toContainText('Not yet');
  await expect(answers.getByRole('listitem').nth(1)).toContainText('Right');
  await shot(page, testInfo, 'parent-history');

  // Replay: the exact canvas the child saw, in a dialog. Nothing done there is recorded.
  const attemptsBefore = (await attemptsOf(page, child.id)).length;
  await firstEntry.getByRole('button', { name: 'Replay' }).click();
  const replay = page.getByRole('dialog', { name: first.content.title });
  await expect(replay).toContainText(first.content.question);
  await expect(replay).toContainText('nothing you do here is recorded');
  await shot(page, testInfo, 'parent-history-replay');
  await replay.getByRole('button', { name: 'Close' }).first().click();
  await expect(replay).toHaveCount(0);
  expect((await attemptsOf(page, child.id)).length).toBe(attemptsBefore);

  // Two stars and a note: the canvas is retired everywhere.
  const stored = (await completedOf(page, child.id)).find((row) => row.id === first.id);
  expect(stored?.source).toBe('ai');
  expect(stored?.libraryId).toBeTruthy();
  await firstEntry.getByRole('radio', { name: '2 of 5 stars' }).click();
  await expect(firstEntry).toContainText('Poor: never show this again');
  await firstEntry.getByLabel('Note (optional)').fill('The picture did not match the question.');
  await firstEntry.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.getByText('Rating saved.')).toBeVisible();
  const item = (await rows(page, 'library')).find((row) => row.id === stored?.libraryId);
  expect(item).toMatchObject({ rating: 2, retired: true, ratingNote: 'The picture did not match the question.' });
  expect((await completedOf(page, child.id)).find((row) => row.id === first.id)).toMatchObject({ parentRating: 2, parentNote: 'The picture did not match the question.' });
  await shot(page, testInfo, 'parent-history-rated');

  // The canvas library shows it as retired; the other canvas is still in use.
  await parentSection(page, 'Library');
  const library = page.getByRole('main');
  const retiredCard = library.getByRole('article', { name: first.content.title, exact: true });
  await expect(retiredCard).toHaveCount(1);
  await expect(retiredCard).toContainText('Retired');
  await expect(retiredCard.getByRole('button', { name: `Restore: ${first.content.title}` })).toBeVisible();
  const otherCard = library.getByRole('article', { name: second.content.title, exact: true });
  await expect(otherCard.getByRole('button', { name: `Retire: ${second.content.title}` })).toBeVisible();
  await closeToasts(page);
  await shot(page, testInfo, 'parent-library');
  await library.getByLabel('Status').selectOption({ label: 'Retired' });
  await expect(library.getByRole('status').filter({ hasText: /^1 canvas$/ })).toBeVisible();
  await expect(library.getByRole('article')).toHaveCount(1);
  await library.getByRole('button', { name: `Preview: ${first.content.title}` }).click();
  const preview = page.getByRole('dialog', { name: first.content.title });
  await expect(preview).toContainText(first.content.question);
  await closeToasts(page);
  await shot(page, testInfo, 'parent-library-preview');
  await preview.getByRole('button', { name: 'Close' }).first().click();

  // Family rules: Science is switched off.
  await parentSection(page, 'Settings');
  await page.getByRole('tab', { name: 'Parental controls' }).click();
  const controls = page.getByRole('tabpanel', { name: 'Parental controls' });
  await controls.getByRole('switch', { name: 'Science' }).click();
  await expect(controls.getByRole('switch', { name: 'Science' })).not.toBeChecked();
  await closeToasts(page);
  await shot(page, testInfo, 'parent-settings-controls');
  await controls.getByRole('button', { name: 'Save controls' }).click();
  await expect(page.getByText('Parental controls saved.')).toBeVisible();
  expect((await settings(page)).controls.strands).toMatchObject({ math: true, science: false, technology: true, engineering: true, logic: true });

  // The child's map has four worlds now. The science world is gone.
  await toKidsArea(page);
  await pickChild(page, 'Mira');
  const map = page.getByRole('region', { name: 'Adventure map' });
  await expect(map.getByRole('button', { name: /^Number Peaks: Math/ })).toBeVisible();
  await expect(map.getByRole('listitem')).toHaveCount(4);
  await expect(map.getByRole('button', { name: /Science/ })).toHaveCount(0);
  await expect(page.getByText('Wonder Jungle')).toHaveCount(0);
  await shot(page, testInfo, 'home-map-without-science');

  expect(watch.problems).toEqual([]);
});

test('five wrong passwords lock the gate for a while', async ({ page }, testInfo) => {
  await setupAndOpenPicker(page, { nickname: 'Mira' });
  await page.goto('/parent');
  for (let tries = 1; tries <= 5; tries += 1) {
    await page.getByLabel('Parent password').fill(`wrong-${tries}`);
    await page.getByRole('button', { name: 'Unlock' }).click();
    if (tries < 4) await expect(page.getByText(`${5 - tries} tries left`)).toBeVisible();
    if (tries === 4) await expect(page.getByText('1 try left before a short lock.')).toBeVisible();
  }
  await expect(page.getByText('Too many wrong tries.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  await shot(page, testInfo, 'parent-gate-locked');
  const auth = (await settings(page)).auth;
  expect(auth?.lockedUntil).toBeGreaterThan(Date.now());
  // Even the right password is refused while the lock runs, also after a reload.
  await page.reload();
  await expect(page.getByText('Too many wrong tries.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Parent area sections' })).toHaveCount(0);
});
