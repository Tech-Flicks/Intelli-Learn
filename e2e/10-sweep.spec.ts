/**
 * Accessibility and safety sweep over the main child and parent screens.
 *
 * On a phone the window is 360 px wide, the narrowest the app promises to work on. On every
 * screen: no console errors, no request to anything but the app itself, every control has an
 * accessible name, nothing scrolls sideways, no raw translation key, no way to skip, and in
 * the child area every touch target is at least 44 px (the big ones are 56 px and more).
 */
import { expect, test, type Page } from '@playwright/test';
import { childTab, expectNoSkip, parentSection, pickChild, seedPlacementDone, setupAndOpenPicker, settle, unlockParentArea, watchPage } from './helpers/app';
import { auditScreen } from './helpers/audit';
import { patchRow, putRow, settings, today } from './helpers/db';
import { answerCorrectly, answerWrongly, checkAgain, correctAnswer, currentChallenge, enterAnswer, finishSolved, nextAdventure, pressCheck, solveCurrent } from './helpers/solver';

const CHILD_TARGET = 48;

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 360, height: 740 });
});

async function childScreen(page: Page, name: string): Promise<void> {
  await settle(page, 500);
  // The lock to the parent area is small on purpose: it is for grown-ups, not for the child.
  await auditScreen(page, name, { minTarget: CHILD_TARGET, smallAllowed: '[aria-label="Grown-ups"]' });
  await expectNoSkip(page);
}

test('child screens: named controls, no sideways scroll, no skip, no outside requests', async ({ page, baseURL }) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  await childScreen(page, 'profile picker');

  await pickChild(page, 'Mira');
  await childScreen(page, 'home before placement');
  await seedPlacementDone(page, child.id);
  await pickChild(page, 'Mira');
  await childScreen(page, 'home');

  // Play: the question, a wrong try, the offer, the helper panel, the walkthrough, the rewards.
  await page.getByRole('button', { name: 'Keep exploring' }).click();
  const record = await currentChallenge(page, child.id);
  await childScreen(page, `play (${record.interaction})`);
  await answerWrongly(page, record);
  await childScreen(page, 'play after a wrong try');
  await checkAgain(page);
  await expect(page.getByTestId('bot-bubble').filter({ hasText: 'Want a hint?' })).toBeVisible();
  await expect(page.getByTestId('bot-bubble')).toHaveCount(1);
  await childScreen(page, 'play with a help offer');
  await page.getByTestId('bot-bubble').getByRole('button', { name: 'Yes please!' }).click();
  const pip = page.getByRole('button', { name: /^Pip, your helper/ });
  await pip.click();
  await expect(page.getByTestId('bot-panel')).toBeVisible();
  await childScreen(page, 'helper panel');
  await page.getByTestId('bot-panel').getByRole('button', { name: 'Give me a hint' }).click();
  await pip.click();
  await page.getByTestId('bot-panel').getByRole('button', { name: 'Show me how' }).click();
  await expect(page.getByTestId('walkthrough-sheet')).toBeVisible();
  await childScreen(page, 'walkthrough');
  const steps = record.content.walkthrough.length;
  for (let step = 0; step < steps; step += 1) await page.getByTestId('walkthrough-sheet').getByRole('button').click();
  await answerCorrectly(page, record);
  await childScreen(page, 'solved');
  await finishSolved(page, record);
  await childScreen(page, 'rewards');

  // A few more kinds of challenge as they come.
  for (let round = 0; round < 4; round += 1) {
    await nextAdventure(page);
    const next = await currentChallenge(page, child.id);
    await childScreen(page, `play (${next.interaction}, ${next.mode})`);
    await answerCorrectly(page, next);
    await finishSolved(page, next);
  }

  // Robot Coder and a story chapter.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('region', { name: 'More ways to play' }).getByRole('button', { name: /^Robot Coder/ }).click();
  const robot = await currentChallenge(page, child.id);
  await childScreen(page, 'play (Robot Coder)');
  // With the program built, every block row has its own small controls.
  await enterAnswer(page, robot.content, correctAnswer(robot.content.interaction));
  await childScreen(page, 'play (Robot Coder, program built)');
  await pressCheck(page);
  await finishSolved(page, robot);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('region', { name: 'More ways to play' }).getByRole('button', { name: /^Story Quest/ }).click();
  await expect(page.getByTestId('story-card')).toBeVisible({ timeout: 60_000 });
  await childScreen(page, 'story chapter');

  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: /^My treasure shelf/ }).click();
  await expect(page.getByRole('heading', { name: 'My treasure shelf', level: 1 })).toBeVisible();
  await childScreen(page, 'shelf');
  await page.getByRole('button', { name: 'Back to my map' }).click();
  await page.getByRole('region', { name: 'More ways to play' }).getByRole('button', { name: /^Imagination Studio/ }).click();
  await expect(page.getByRole('heading', { name: 'Imagination Studio' })).toBeVisible();
  await childScreen(page, 'studio');

  // The rest screen, once the play time of today is used up.
  const current = await settings(page);
  await patchRow(page, 'settings', 'app', { controls: { ...current.controls, dailyMinutes: 1 } });
  await putRow(page, 'sessions', { id: 'session_e2e_sweep', childId: child.id, day: await today(page), startedAt: Date.now() - 600_000, endedAt: Date.now() - 300_000, activeMs: 300_000, itemsCompleted: 1 });
  await page.goto(`/kids/${child.id}/rest`);
  await expect(page.getByRole('heading', { name: 'Great work today!' })).toBeVisible();
  await childScreen(page, 'rest');

  expect(watch.problems).toEqual([]);
  // Everything that was loaded came from the app's own address.
  expect(watch.requests.length).toBeGreaterThan(0);
  expect(new Set(watch.requests.map((url) => new URL(url).origin))).toEqual(new Set([new URL(baseURL ?? '').origin]));
});

test('parent screens: named controls, no sideways scroll, no outside requests', async ({ page, baseURL }) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const child = await setupAndOpenPicker(page, { nickname: 'Mira', grade: 'Grade 2' });
  // Something to show: two solved challenges, one of them with help.
  await pickChild(page, 'Mira');
  await page.getByRole('button', { name: 'Start your adventure' }).click();
  await solveCurrent(page, child.id);
  await nextAdventure(page);
  await solveCurrent(page, child.id);

  await page.goto('/parent');
  await expect(page.getByLabel('Parent password')).toBeVisible();
  await settle(page);
  await auditScreen(page, 'parent gate');
  await unlockParentArea(page);
  await settle(page);
  await auditScreen(page, 'overview');

  await parentSection(page, 'Children');
  await settle(page);
  await auditScreen(page, 'children');
  await page.getByRole('button', { name: 'Add a child' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a child' })).toBeVisible();
  await settle(page);
  await auditScreen(page, 'add a child');
  await page.getByRole('dialog', { name: 'Add a child' }).getByRole('button', { name: 'Cancel' }).click();

  for (const tab of ['Progress', 'History', 'Weekly report', 'Profile', 'Data'] as const) {
    await childTab(page, 'Mira', tab);
    await settle(page);
    await auditScreen(page, `child detail: ${tab}`);
    if (tab === 'History') {
      const entry = page.getByRole('tabpanel').getByRole('article').first();
      await entry.getByRole('button', { name: 'Answers, conversation and rating' }).click();
      await settle(page, 300);
      await auditScreen(page, 'history entry, opened');
      await entry.getByRole('button', { name: 'Replay' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await settle(page);
      await auditScreen(page, 'replay dialog');
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    }
  }

  await parentSection(page, 'Library');
  await settle(page);
  await auditScreen(page, 'library');

  await parentSection(page, 'Settings');
  for (const section of ['AI connection', 'Parental controls', 'Language', 'Password', 'Backup', 'Danger zone', 'About and privacy']) {
    await page.getByRole('tab', { name: section, exact: true }).click();
    await expect(page.getByRole('tab', { name: section, exact: true })).toHaveAttribute('aria-selected', 'true');
    await settle(page, 400);
    await auditScreen(page, `settings: ${section}`);
  }
  // The other AI modes show more fields.
  await page.getByRole('tab', { name: 'AI connection', exact: true }).click();
  await page.getByRole('radio', { name: /OpenAI or compatible service/ }).check();
  await settle(page, 300);
  await auditScreen(page, 'settings: AI connection, direct');
  await page.getByRole('radio', { name: /Proxy on my server/ }).check();
  await settle(page, 300);
  await auditScreen(page, 'settings: AI connection, proxy');

  expect(watch.problems).toEqual([]);
  expect(new Set(watch.requests.map((url) => new URL(url).origin))).toEqual(new Set([new URL(baseURL ?? '').origin]));
});

test('the setup wizard: named controls and no sideways scroll on every step', async ({ page, baseURL }) => {
  const watch = watchPage(page, [new URL(baseURL ?? '').origin]);
  const { completeSetup } = await import('./helpers/app');
  await completeSetup(page, {
    onStep: async (name) => {
      await settle(page, 400);
      await auditScreen(page, `setup: ${name}`);
    },
  });
  expect(watch.problems).toEqual([]);
});
