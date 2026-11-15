/**
 * AI mode against the mock AI server, and the canvas library that comes with it:
 * what the AI builds is kept, a second child gets canvases from the library, a retired
 * canvas is never served again, and the child's nickname never leaves the device.
 *
 * The two tests share one browser context: the second child plays on the device the
 * first child filled the library on.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { connectMockAi, parentSection, pickChild, setupAndOpenPicker, shot, toKidsArea, unlockParentArea, watchPage, MOCK_AI_ORIGIN, closeToasts } from './helpers/app';
import { attemptsOf, challengesOf, childByNickname, rows, today } from './helpers/db';
import { currentChallenge, nextAdventure, solveCurrent } from './helpers/solver';
import type { ChallengeRecord, LibraryItem } from '../src/core/types';

const FIRST = 'Zorblat';
const SECOND = 'Quillon';
const NOTE = 'Too many steps for this age.';

interface MockLog {
  requests: { at: number; path: string; task: string; body: unknown }[];
}

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let watch: ReturnType<typeof watchPage>;
/** Every body the browser posted to the AI, as the browser saw it. */
const posted: string[] = [];
let startedAt = 0;
let firstPlayed: ChallengeRecord[] = [];

test.beforeAll(async ({ browser }, testInfo) => {
  context = await browser.newContext(testInfo.project.use);
  // The planner rolls dice for the skill and the way to answer. Here the dice always land the
  // same way, so the second child's first plans are the first child's plans: the library then
  // certainly holds a canvas for them, and one of them is the retired canvas.
  await context.addInitScript(() => {
    Math.random = () => 0.5;
  });
  page = await context.newPage();
  startedAt = Date.now();
  watch = watchPage(page, [new URL(testInfo.project.use.baseURL ?? '').origin, MOCK_AI_ORIGIN]);
  page.on('request', (request) => {
    if (request.url().startsWith(MOCK_AI_ORIGIN) && request.method() === 'POST') posted.push(request.postData() ?? '');
  });
});

test.afterAll(async () => {
  await context.close();
});

/** Everything the mock AI received since this file started, as text. */
async function receivedByMock(): Promise<string[]> {
  const response = await fetch(`${MOCK_AI_ORIGIN}/__mock/log`);
  const log = (await response.json()) as MockLog;
  return log.requests.filter((request) => request.at >= startedAt - 1000).map((request) => JSON.stringify(request.body));
}

test('with an AI connected, challenges are built by the AI and kept in the canvas library', async ({}, testInfo) => {
  const child = await setupAndOpenPicker(page, { nickname: FIRST, grade: 'Grade 2', interests: ['Space', 'Robots'] });
  const usageBefore = (await rows(page, 'usage')).reduce((sum, row) => sum + row.requests, 0);
  expect(usageBefore).toBe(0);

  await unlockParentArea(page);
  await connectMockAi(page);
  await parentSection(page, 'Overview');
  await expect(page.getByRole('region', { name: 'AI and usage' })).toContainText('AI challenges are on, using the model “mock-stem-1”.');

  await toKidsArea(page);
  await pickChild(page, FIRST);
  await page.getByRole('button', { name: 'Start your adventure' }).click();

  for (let round = 1; round <= 3; round += 1) {
    const record = await solveCurrent(page, child.id);
    expect(record.source).toBe('ai');
    expect(record.libraryId).toBeTruthy();
    firstPlayed.push(record);
    if (round === 1) await shot(page, testInfo, 'play-ai-rewards');
    if (round < 3) await nextAdventure(page);
  }
  expect((await attemptsOf(page, child.id)).length).toBe(3);

  // Each one is in the library, as built, and remembers who saw it and how it went.
  const library = await rows(page, 'library');
  for (const record of firstPlayed) {
    const item = library.find((row) => row.id === record.libraryId);
    expect(item).toBeDefined();
    expect(item).toMatchObject({ origin: 'ai', retired: false, rating: null, skillId: record.skillId, interaction: record.interaction, locale: 'en', ageGroup: '6-8' });
    expect(item?.content).toEqual(record.content);
    expect(item?.seenBy).toContain(child.id);
    expect(item?.independentSolves).toBe(1);
    expect(item?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  }
  // The library holds ids only, never a name.
  expect(JSON.stringify(library)).not.toContain(FIRST);

  // Usage was counted, today.
  const usage = (await rows(page, 'usage')).find((row) => row.day === undefined || row.requests > 0);
  expect(usage?.day).toBe(await today(page));
  expect(usage?.requests).toBeGreaterThanOrEqual(3);

  // The parent sees the canvases and the usage.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Switch player' }).click();
  await unlockParentArea(page);
  const meter = page.getByRole('region', { name: 'AI and usage' }).getByRole('meter', { name: 'AI requests today' });
  expect(Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(3);
  await shot(page, testInfo, 'parent-overview-ai');
  await parentSection(page, 'Library');
  for (const record of firstPlayed) {
    await expect(page.getByRole('main').getByRole('article', { name: record.content.title, exact: true }).first()).toBeVisible();
  }
  await shot(page, testInfo, 'parent-library-ai');

  // The nickname and the child's id never reached the AI: not in what the browser sent,
  // and not in what the server received.
  const received = await receivedByMock();
  expect(posted.length).toBeGreaterThanOrEqual(3);
  expect(received.length).toBeGreaterThanOrEqual(3);
  for (const body of [...posted, ...received]) {
    expect(body.toLowerCase()).not.toContain(FIRST.toLowerCase());
    expect(body).not.toContain(child.id);
  }
  // (These really are the prompts: they carry the grade and the interests.)
  expect(posted.some((body) => body.includes('GRADE: 2') || body.includes('GRADE: 1'))).toBe(true);
  expect(posted.some((body) => /space|robots/i.test(body))).toBe(true);
  expect(watch.problems).toEqual([]);
});

test('a second child gets canvases from the library, and never the retired one', async ({}, testInfo) => {
  const first = await childByNickname(page, FIRST);
  // The parent area is still open on the library. One of the first child's canvases gets one star.
  const bad = firstPlayed[0];
  if (!bad?.libraryId) throw new Error('The first test did not leave a canvas to rate');
  const main = page.getByRole('main');
  await main.getByRole('article', { name: bad.content.title, exact: true }).first().getByRole('button', { name: `Rate: ${bad.content.title}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Rate this canvas' });
  await dialog.getByRole('radio', { name: '1 of 5 stars' }).click();
  await dialog.getByLabel('Note (optional)').fill(NOTE);
  await shot(page, testInfo, 'parent-library-rate');
  await dialog.getByRole('button', { name: 'Save rating' }).click();
  await expect(page.getByText('Rating saved. This canvas is retired and will not be shown again.')).toBeVisible();
  const retired = (await rows(page, 'library')).find((row) => row.id === bad.libraryId) as LibraryItem;
  expect(retired).toMatchObject({ retired: true, rating: 1, ratingNote: NOTE });

  // A second child in the same grade, with the same interests.
  await parentSection(page, 'Children');
  await page.getByRole('button', { name: 'Add a child' }).click();
  const form = page.getByRole('dialog', { name: 'Add a child' });
  await form.getByLabel('Nickname').fill(SECOND);
  await form.getByLabel('School grade').selectOption({ label: 'Grade 2' });
  await form.getByRole('radio', { name: 'Avatar 🐼' }).check();
  await form.getByRole('button', { name: 'Space', exact: true }).click();
  await form.getByRole('button', { name: 'Robots', exact: true }).click();
  await closeToasts(page);
  await shot(page, testInfo, 'parent-add-child');
  await form.getByRole('button', { name: 'Add child' }).click();
  await expect(page.getByText(`${SECOND} was added.`)).toBeVisible();
  const second = await childByNickname(page, SECOND);
  expect(second.grade).toBe('2');

  await toKidsArea(page);
  await expect(page.getByRole('button', { name: `Play as ${FIRST}` })).toBeVisible();
  await closeToasts(page);
  await shot(page, testInfo, 'profile-picker-two-children');
  await pickChild(page, SECOND);
  await page.getByRole('button', { name: 'Start your adventure' }).click();

  const played: ChallengeRecord[] = [];
  for (let round = 1; round <= 4; round += 1) {
    await currentChallenge(page, second.id);
    played.push(await solveCurrent(page, second.id));
    if (round < 4) await nextAdventure(page);
  }

  // Everything this child was served or has waiting in the queue.
  const served = await challengesOf(page, second.id);
  const library = await rows(page, 'library');
  const itemOf = (record: ChallengeRecord): LibraryItem | undefined => library.find((row) => row.id === record.libraryId);
  const reused = served.filter((record) => record.source === 'reused');
  const remixed = served.filter((record) => itemOf(record)?.remixOf != null);
  expect(reused.length + remixed.length).toBeGreaterThanOrEqual(1);
  for (const record of reused) {
    const item = itemOf(record);
    // A reused canvas is one the first child's play put into the library, served as it is.
    expect(item?.content).toEqual(record.content);
    expect(item?.seenBy).toContain(second.id);
    expect(item?.uses).toBeGreaterThanOrEqual(2);
  }
  for (const record of remixed) {
    const original = library.find((row) => row.id === itemOf(record)?.remixOf);
    expect(original?.interaction).toBe(record.interaction);
    expect(original?.id).not.toBe(retired.id);
  }
  testInfo.annotations.push({ type: 'library', description: `${reused.length} reused, ${remixed.length} remixed, of ${served.length} served or queued` });

  // The retired canvas was never served to the second child, in any form.
  const retiredNow = (await rows(page, 'library')).find((row) => row.id === retired.id);
  expect(retiredNow?.retired).toBe(true);
  expect(retiredNow?.seenBy).not.toContain(second.id);
  expect(retiredNow?.seenBy).toContain(first.id);
  for (const record of served) {
    expect(record.libraryId).not.toBe(retired.id);
    expect(record.content.question).not.toBe(retired.content.question);
  }
  expect(played.every((record) => record.source !== 'offline')).toBe(true);

  // The low rating's note is passed on as something to avoid, but still no nickname.
  const received = await receivedByMock();
  for (const body of [...posted, ...received]) {
    expect(body.toLowerCase()).not.toContain(FIRST.toLowerCase());
    expect(body.toLowerCase()).not.toContain(SECOND.toLowerCase());
    expect(body).not.toContain(first.id);
    expect(body).not.toContain(second.id);
  }

  // The parent sees the reuse counted in the library.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Switch player' }).click();
  await unlockParentArea(page);
  await parentSection(page, 'Library');
  await expect(page.getByRole('main')).toContainText('Canvases kept');
  await shot(page, testInfo, 'parent-library-reuse');
  expect(watch.problems).toEqual([]);
});
