/**
 * No skipping, always help: wrong tries bring an offer, help goes up one level at a time,
 * the walkthrough still leaves the answer to the child, and an easier sibling follows.
 */
import { expect, test } from '@playwright/test';
import { expectNoSkip, pickChild, seedPlacementDone, setupAndOpenPicker, shot, watchPage } from './helpers/app';
import { attemptsOf, challengesOf } from './helpers/db';
import { answerCorrectly, answerWrongly, checkAgain, currentChallenge, finishSolved, nextAdventure, playScreen, solveCurrent } from './helpers/solver';

test('wrong tries lead to a hint, then the walkthrough, then an easier sibling', async ({ page, baseURL }, testInfo) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  await seedPlacementDone(page, child.id);
  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Keep exploring' }).click();

  const record = await currentChallenge(page, child.id);
  expect(record.purpose).not.toBe('placement');
  const bubble = page.getByTestId('bot-bubble');
  const pip = page.getByRole('button', { name: /^Pip, your helper/ });
  /** A new line fades in while the one before fades out: wait until only the new one is left. */
  const oneBubble = () => expect(page.getByTestId('bot-bubble')).toHaveCount(1);
  await expectNoSkip(page);

  // First wrong try: kind words, the work stays, no offer yet.
  await answerWrongly(page, record);
  await oneBubble();
  await expect(bubble.getByRole('status')).not.toBeEmpty();
  await expect(bubble.getByRole('button', { name: 'Yes please!' })).toHaveCount(0);
  await expect(page.getByText(/\b(wrong|incorrect)\b/i)).toHaveCount(0);
  await shot(page, testInfo, 'play-wrong-answer');
  await expectNoSkip(page);

  // Second wrong try (the work was kept, so Check alone is enough): Pip offers a hint. He does not start helping by himself.
  await checkAgain(page);
  await expect(page.getByTestId('bot-bubble').filter({ hasText: 'Want a hint?' })).toBeVisible();
  await oneBubble();
  await expect(bubble.getByRole('status')).toContainText('Want a hint?');
  await shot(page, testInfo, 'play-help-offer');
  await expectNoSkip(page);
  await bubble.getByRole('button', { name: 'Yes please!' }).click();
  await expect(page.getByTestId('bot-bubble').filter({ hasText: record.content.hints[0] })).toBeVisible();
  await oneBubble();
  await expect(bubble.getByRole('status')).not.toContainText('Want a hint?');
  await shot(page, testInfo, 'play-hint');

  // The helper panel: one more level of help per request, and "Show me how" only after the strong hint.
  await pip.click();
  const panel = page.getByTestId('bot-panel');
  await expect(panel.getByRole('heading', { name: 'How can I help?' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Show me how' })).toHaveCount(0);
  await expect(page.getByTestId('check-button')).toBeDisabled();
  await shot(page, testInfo, 'bot-panel');
  await expectNoSkip(page);
  await panel.getByRole('button', { name: 'Give me a hint' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('bot-bubble').filter({ hasText: record.content.hints[1] })).toBeVisible();

  await pip.click();
  await expect(panel.getByRole('button', { name: 'Show me how' })).toBeVisible();
  await shot(page, testInfo, 'bot-panel-show-me-how');
  await panel.getByRole('button', { name: 'Show me how' }).click();

  // The walkthrough, one step at a time.
  const sheet = page.getByTestId('walkthrough-sheet');
  const steps = record.content.walkthrough;
  for (const [index, step] of steps.entries()) {
    await expect(sheet).toContainText(`Step ${index + 1} of ${steps.length}`);
    await expect(sheet.getByRole('status')).toContainText(step);
    if (index === 0) await shot(page, testInfo, 'play-walkthrough');
    await expectNoSkip(page);
    await sheet.getByRole('button', { name: index === steps.length - 1 ? 'Now I will try' : 'Next step' }).click();
  }
  await expect(sheet).toHaveCount(0);

  // The answer is still the child's to enter.
  await expect(playScreen(page)).toHaveAttribute('data-phase', 'answering');
  expect((await challengesOf(page, child.id)).find((row) => row.id === record.id)?.status).toBe('active');
  await answerCorrectly(page, record);
  await finishSolved(page, record);
  await expectNoSkip(page);

  const attempt = (await attemptsOf(page, child.id)).find((row) => row.challengeId === record.id);
  expect(attempt).toMatchObject({ outcome: 'walkthrough', walkthroughUsed: true, hintsUsed: 2 });
  expect(attempt?.answers.map((answer) => answer.correct)).toEqual([false, false, true]);
  // Help never costs the last star.
  expect(attempt?.starsEarned).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('rewards')).toContainText('You followed every step and finished it.');
  await shot(page, testInfo, 'play-rewards-after-walkthrough');

  // What comes next is an easier sibling on the same skill.
  await nextAdventure(page);
  const sibling = await currentChallenge(page, child.id);
  expect(sibling.purpose).toBe('sibling');
  expect(sibling.skillId).toBe(record.skillId);
  expect(sibling.stage).toBeLessThanOrEqual(record.stage);
  expect(sibling.id).not.toBe(record.id);
  await solveCurrent(page, child.id);
  expect((await attemptsOf(page, child.id)).map((row) => row.outcome)).toEqual(['walkthrough', 'independent']);
  await expectNoSkip(page);

  expect(watch.problems).toEqual([]);
});

test('four quick wrong tries bring the slow-breath break, and the challenge stays', async ({ page }, testInfo) => {
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  await seedPlacementDone(page, child.id);
  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Keep exploring' }).click();

  const record = await currentChallenge(page, child.id);
  const breakSheet = page.getByTestId('break-sheet');
  await answerWrongly(page, record);
  // The work stays in place, so pressing Check again and again is what quick guessing looks like.
  for (let tries = 2; tries <= 4; tries += 1) {
    await expect(breakSheet).toHaveCount(0);
    await checkAgain(page);
    if (tries === 2) {
      // An offer is put aside with "Not yet": Pip waits until he is asked.
      const offer = page.getByTestId('bot-bubble').filter({ hasText: 'Want a hint?' });
      await offer.getByRole('button', { name: 'Not yet' }).click();
      await expect(page.getByTestId('bot-bubble')).toHaveCount(0);
    }
  }
  await expect(breakSheet).toBeVisible();
  await expect(breakSheet.getByRole('heading', { name: 'Let us take a slow breath' })).toBeVisible();
  await expect(page.getByTestId('check-button')).toBeDisabled();
  await shot(page, testInfo, 'play-break');
  await expectNoSkip(page);

  await breakSheet.getByRole('button', { name: 'I am ready' }).click();
  await expect(breakSheet).toHaveCount(0);
  // Same challenge, still to be solved by the child.
  expect((await currentChallenge(page, child.id)).id).toBe(record.id);
  await answerCorrectly(page, record);
  await finishSolved(page, record);
  const attempt = (await attemptsOf(page, child.id)).find((row) => row.challengeId === record.id);
  expect(attempt?.outcome).toBe('second-try');
  expect(attempt?.answers).toHaveLength(5);
});
