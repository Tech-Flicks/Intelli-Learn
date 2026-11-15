/**
 * A child plays in Demo mode: the placement game and on, every answer entered through the
 * real widgets.
 */
import { expect, test } from '@playwright/test';
import { pickChild, setupAndOpenPicker, shot, watchPage } from './helpers/app';
import { attemptsOf, challengesOf, childByNickname, rows } from './helpers/db';
import { currentChallenge, answerCorrectly, finishSolved, nextAdventure } from './helpers/solver';

const ROUNDS = 10;
const PLACEMENT_ITEMS = 8;

test('a child solves ten challenges in a row and finishes the placement game', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });

  await pickChild(page, 'Mira');
  await expect(page.getByRole('img', { name: '0 stars' })).toBeVisible();
  await shot(page, testInfo, 'home-first-visit');
  await page.getByRole('button', { name: 'Start your adventure' }).click();
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}/play$`));

  const kindsSeen = new Set<string>();
  let stars = 0;
  for (let round = 1; round <= ROUNDS; round += 1) {
    const record = await currentChallenge(page, child.id);
    expect(record.source).toBe('offline');
    expect(record.purpose).toBe(round <= PLACEMENT_ITEMS ? 'placement' : record.purpose);
    if (round <= PLACEMENT_ITEMS) {
      await expect(page.getByTestId('prompt-card')).toHaveAttribute('data-frame', 'placement');
      await expect(page.getByTestId('placement-dots')).toContainText(`Step ${round} of ${PLACEMENT_ITEMS}`);
    } else {
      expect(record.purpose).not.toBe('placement');
      await expect(page.getByTestId('placement-dots')).toHaveCount(0);
    }
    if (round === 1) await shot(page, testInfo, 'play-placement-first');
    kindsSeen.add(record.interaction);

    await answerCorrectly(page, record);
    if (round === 1) await shot(page, testInfo, 'play-solved-celebration', { settleMs: 300 });
    await finishSolved(page, record);

    // The challenge is finished and an attempt stands next to it.
    const stored = (await challengesOf(page, child.id)).find((row) => row.id === record.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.completedAt).not.toBeNull();
    const attempts = await attemptsOf(page, child.id);
    expect(attempts).toHaveLength(round);
    const attempt = attempts.find((row) => row.challengeId === record.id);
    expect(attempt?.outcome).toBe('independent');
    expect(attempt?.answers.at(-1)?.correct).toBe(true);
    expect(attempt?.starsEarned).toBeGreaterThan(0);

    // Stars only ever go up, and the counter in the top bar catches up with them.
    const now = await childByNickname(page, 'Mira');
    expect(now.stars).toBeGreaterThan(stars);
    expect(now.stars).toBe(stars + (attempt?.starsEarned ?? 0));
    stars = now.stars;
    await expect(page.getByTestId('star-counter')).toHaveAccessibleName(new RegExp(`^${stars} stars?$`));

    expect(now.placementDone).toBe(round >= PLACEMENT_ITEMS);
    if (round === 1) await shot(page, testInfo, 'play-rewards');
    if (round === PLACEMENT_ITEMS) {
      await expect(page.getByTestId('rewards')).toContainText('Pip found your perfect starting point!');
      await shot(page, testInfo, 'play-placement-finished');
    }
    if (round < ROUNDS) await nextAdventure(page);
  }

  // Placement left its mark: skill levels exist, with a history entry per strand.
  expect((await rows(page, 'skillStates')).filter((row) => row.childId === child.id).length).toBeGreaterThan(0);
  expect((await rows(page, 'stageChanges')).some((row) => row.childId === child.id && row.reason === 'placement')).toBe(true);
  expect(kindsSeen.size).toBeGreaterThanOrEqual(2);
  testInfo.annotations.push({ type: 'interaction kinds played', description: [...kindsSeen].sort().join(', ') });

  // Home again: the adventure goes on and the other ways to play are open.
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page).toHaveURL(new RegExp(`/kids/${child.id}$`));
  await expect(page.getByRole('button', { name: 'Keep exploring' })).toBeVisible();
  await expect(page.getByRole('img', { name: `${stars} stars` })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Robot Coder/ })).toBeEnabled();
  await shot(page, testInfo, 'home-map');
  await shot(page, testInfo, 'home-map-full', { fullPage: true });

  expect(watch.problems).toEqual([]);
});
