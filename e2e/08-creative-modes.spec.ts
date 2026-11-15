/**
 * The creative ways to play: Robot Coder, Imagination Studio and Story Quest, each opened
 * from the child's home screen and solved through its own widget. Also the treasure shelf.
 */
import { expect, test } from '@playwright/test';
import { expectNoSkip, pickChild, seedPlacementDone, setupAndOpenPicker, shot, watchPage } from './helpers/app';
import { challengesOf, childByNickname, rows } from './helpers/db';
import { currentChallenge, nextAdventure, playScreen, solveCurrent } from './helpers/solver';

test('Robot Coder, Imagination Studio and Story Quest each give a challenge that can be solved', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2', interests: ['Space', 'Animals'] });
  await seedPlacementDone(page, child.id);
  await pickChild(page, 'Mira');
  const launcher = page.getByRole('region', { name: 'More ways to play' });

  // --- Robot Coder ---------------------------------------------------------
  await launcher.getByRole('button', { name: /^Robot Coder/ }).click();
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/play\\?mode=robot$`));
  const robot = await currentChallenge(page, child.id);
  expect(robot).toMatchObject({ mode: 'robot', interaction: 'robot' });
  await expect(page.getByTestId('prompt-card')).toContainText('Robot Coder');
  await shot(page, testInfo, 'mode-robot-coder');
  await solveCurrent(page, child.id);
  await shot(page, testInfo, 'mode-robot-coder-solved');
  await expectNoSkip(page);
  await page.getByRole('button', { name: 'Home' }).click();

  // --- Imagination Studio --------------------------------------------------
  await launcher.getByRole('button', { name: /^Imagination Studio/ }).click();
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/studio$`));
  await expect(page.getByRole('heading', { name: 'Imagination Studio' })).toBeVisible();
  const make = page.getByRole('button', { name: 'Make it!' });
  await expect(make).toBeDisabled();
  // One picture from each of the three rows builds the idea.
  const groups = page.getByRole('group').filter({ has: page.locator('[data-chip]') });
  await expect(groups).toHaveCount(3);
  for (let row = 0; row < 3; row += 1) {
    const chip = groups.nth(row).locator('[data-chip]').nth(row + 1);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  }
  const idea = (await page.getByTestId('idea-preview').innerText()).trim();
  expect(idea.length).toBeGreaterThan(5);
  await shot(page, testInfo, 'studio');
  await expect(make).toBeEnabled();
  await make.click();
  await expect(page).toHaveURL(/\/play/);
  const studio = await currentChallenge(page, child.id);
  expect(studio.mode).toBe('studio');
  // The idea is drawn once: a reload would not ask for it again.
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/play$`));
  await shot(page, testInfo, 'mode-studio-challenge');
  await solveCurrent(page, child.id);
  await page.getByRole('button', { name: 'Home' }).click();

  // --- Story Quest ---------------------------------------------------------
  await launcher.getByRole('button', { name: /^Story Quest/ }).click();
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/play\\?mode=story$`));
  const card = page.getByTestId('story-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(playScreen(page)).toHaveAttribute('data-phase', 'story');
  const [story] = (await rows(page, 'stories')).filter((row) => row.childId === child.id);
  if (!story) throw new Error('No story was started');
  const chapters = story.chapters.length;
  expect(chapters).toBeGreaterThanOrEqual(2);
  await expect(card).toContainText(`Chapter 1 of ${chapters}`);
  await expect(card.getByRole('heading', { level: 1 })).toHaveText(story.chapters[0]?.heading ?? '');
  await expect(card).toContainText(story.title);
  await shot(page, testInfo, 'mode-story-chapter');
  await expectNoSkip(page);

  // Every chapter has its own challenge; after the last one the story ends happily.
  for (let chapter = 0; chapter < chapters; chapter += 1) {
    await expect(card).toContainText(`Chapter ${chapter + 1} of ${chapters}`);
    const record = await currentChallenge(page, child.id);
    expect(record).toMatchObject({ mode: 'story', storyId: story.id, chapterIndex: chapter });
    await expect(page.getByTestId('prompt-card')).toContainText(`Chapter ${chapter + 1} of ${chapters}`);
    if (chapter === 0) await shot(page, testInfo, 'mode-story-challenge');
    await solveCurrent(page, child.id);
    // The next chapter is told first, so "Next adventure" is pressed without starting its challenge.
    if (chapter < chapters - 1) await page.getByTestId('next-button').click();
  }
  const sheet = page.getByTestId('solved-sheet');
  await expect(sheet).toContainText('The End');
  await expect(sheet).toContainText(story.ending);
  await shot(page, testInfo, 'mode-story-the-end');
  expect((await rows(page, 'stories')).find((row) => row.id === story.id)?.status).toBe('finished');
  // Play goes on as usual afterwards.
  await nextAdventure(page);
  const after = await currentChallenge(page, child.id);
  expect(after.storyId).toBeNull();
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/play$`));

  const completed = (await challengesOf(page, child.id)).filter((row) => row.status === 'completed');
  expect(completed.map((row) => row.mode)).toEqual(['robot', 'studio', ...Array.from({ length: chapters }, () => 'story')]);
  expect(watch.problems).toEqual([]);
});

test('the treasure shelf shows what was earned and lets the child buy and name things', async ({ page }, testInfo) => {
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  await seedPlacementDone(page, child.id);
  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Keep exploring' }).click();
  // Six solved challenges earn enough stars for a first treasure.
  for (let round = 1; round <= 6; round += 1) {
    await solveCurrent(page, child.id);
    if (round < 6) await nextAdventure(page);
  }
  const before = await childByNickname(page, 'Mira');
  expect(before.stars).toBeGreaterThanOrEqual(6);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: /^My treasure shelf/ }).click();
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/shelf$`));
  await expect(page.getByRole('heading', { name: 'My treasure shelf', level: 1 })).toBeVisible();
  await expect(page.getByText('First Spark').first()).toBeVisible();
  await shot(page, testInfo, 'shelf');
  await shot(page, testInfo, 'shelf-full', { fullPage: true });
  await expectNoSkip(page);

  // Buying asks first, then the treasure is on the shelf and the stars are spent.
  await expect(page.getByText('Your shelf is ready for its first treasure.')).toBeVisible();
  const shop = page.getByRole('region', { name: 'Treasure shop' });
  await shop.getByRole('button', { name: /Robot Wrench/ }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Get the Robot Wrench?' });
  await expect(confirm).toBeVisible();
  await shot(page, testInfo, 'shelf-buy-confirm');
  await confirm.getByRole('button', { name: 'Yes, get it!' }).click();
  await expect(page.getByText('Robot Wrench is on your shelf!')).toBeVisible();
  await expect(page.getByText('Your shelf is ready for its first treasure.')).toHaveCount(0);
  const after = await childByNickname(page, 'Mira');
  expect(after.collectibles).toHaveLength(1);
  expect(after.stars).toBe(before.stars - 5);
  // Lifetime stars are untouched by spending.
  expect(after.totalStars).toBe(before.totalStars);

  // The companion gets a name the child typed.
  await page.getByRole('button', { name: 'Give it a name' }).click();
  const naming = page.getByRole('dialog', { name: 'Name your companion' });
  await naming.getByLabel('Name').fill('Hoots');
  await naming.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Say hello to Hoots!')).toBeVisible();
  expect((await childByNickname(page, 'Mira')).companion.name).toBe('Hoots');
  await expect(page.getByRole('button', { name: 'Change name' })).toBeVisible();
  await shot(page, testInfo, 'shelf-after-buying');

  // Rewards are never taken away: every star and badge row stays, spending is its own row.
  const rewards = (await rows(page, 'rewards')).filter((row) => row.childId === child.id);
  expect(rewards.filter((row) => row.kind === 'star').every((row) => row.amount > 0)).toBe(true);
  expect(rewards.some((row) => row.kind === 'badge')).toBe(true);
  expect(rewards.filter((row) => row.kind === 'collectible').map((row) => row.amount)).toEqual([-5]);
  expect(after.totalStars).toBe(rewards.filter((row) => row.kind === 'star').reduce((sum, row) => sum + row.amount, 0));
  expect(after.stars).toBe(rewards.reduce((sum, row) => sum + row.amount, 0));
});
