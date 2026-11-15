/**
 * What a parent or a child does in the app, as steps for the end-to-end tests:
 * first-run setup, unlocking the parent area, picking a player, and screenshots.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { childByNickname, patchRow, rows } from './db';
import type { ChildProfile } from '../../src/core/types';

export const PARENT_PASSWORD = 'blue-kite-42';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOT_DIR = path.resolve(HERE, '..', 'screenshots');

export interface SetupOptions {
  nickname?: string;
  /** The option text of the grade, e.g. "Grade 2". */
  grade?: string;
  /** The option text of the age group, e.g. "Ages 6–8". */
  ageGroup?: string;
  interests?: string[];
  /** Called on each wizard step, once it is on screen, with a short name for it. */
  onStep?: (name: string) => Promise<void>;
}

/**
 * Walks through the first-run wizard like a parent: Demo mode, play allowed all day (so the
 * tests do not depend on the hour they run at), one child. Ends on the "All set" step.
 */
export async function completeSetup(page: Page, options: SetupOptions = {}): Promise<void> {
  const { nickname = 'Mira', grade = 'Grade 2', ageGroup, interests = ['Space', 'Animals'], onStep } = options;
  const step = async (name: string): Promise<void> => {
    if (onStep) await onStep(name);
  };

  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  await step('welcome');
  await page.getByRole('button', { name: /^Let.s start$/ }).click();

  await expect(page.getByRole('heading', { name: 'Choose a parent password' })).toBeVisible();
  await page.getByLabel('New password').fill(PARENT_PASSWORD);
  await page.getByLabel('Repeat the password').fill(PARENT_PASSWORD);
  await step('password');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Connect an AI (optional)' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Demo mode/ })).toBeChecked();
  await step('ai');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Set the family rules' })).toBeVisible();
  await page.getByLabel('Play allowed from').selectOption({ label: '12:00 AM' });
  await page.getByLabel('Play allowed until').selectOption({ label: 'Midnight (end of day)' });
  await step('controls');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Add your first child' })).toBeVisible();
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByLabel('School grade').selectOption({ label: grade });
  if (ageGroup) await page.getByLabel('Age group').selectOption({ label: ageGroup });
  for (const interest of interests) await page.getByRole('button', { name: interest, exact: true }).click();
  await step('child');
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page.getByRole('heading', { name: 'All set!' })).toBeVisible();
  await step('done');
}

/** Setup, then "Start playing": ends on the profile picker with the parent area locked. */
export async function setupAndOpenPicker(page: Page, options: SetupOptions = {}): Promise<ChildProfile> {
  await completeSetup(page, options);
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page).toHaveURL(/\/kids$/);
  await expect(page.getByRole('heading', { name: 'Who is playing?' })).toBeVisible();
  return childByNickname(page, options.nickname ?? 'Mira');
}

/**
 * Marks the placement game as done, straight in the database, for tests that are about what
 * comes after it. The placement game itself is played through in `02-play.spec.ts`.
 */
export async function seedPlacementDone(page: Page, childId: string): Promise<void> {
  await patchRow(page, 'children', childId, { placementDone: true });
  await page.reload();
}

/** From the profile picker to the child's home screen. */
export async function pickChild(page: Page, nickname: string): Promise<void> {
  await page.goto('/kids');
  await page.getByRole('button', { name: `Play as ${nickname}` }).click();
  await expect(page.getByRole('heading', { name: `Hi, ${nickname}!` })).toBeVisible();
}

/** Opens the parent area and types the password. Ends on the overview. */
export async function unlockParentArea(page: Page): Promise<void> {
  await page.goto('/parent');
  await page.getByLabel('Parent password').fill(PARENT_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
}

/** Lets entry animations and web fonts settle, so a screenshot is not taken halfway. */
export async function settle(page: Page, ms = 700): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(ms);
}

/** Puts away the toasts that are still on screen, so an old message does not cover what a screenshot is about. */
export async function closeToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLButtonElement>('[data-tone] > button[aria-label="Dismiss"]').forEach((button) => button.click());
  });
  await expect(page.locator('[data-tone] > button[aria-label="Dismiss"]')).toHaveCount(0);
}

/** Saves `e2e/screenshots/<project>/<name>.png` (the visible screen, not the whole page). */
export async function shot(page: Page, testInfo: TestInfo, name: string, options: { fullPage?: boolean; settleMs?: number } = {}): Promise<void> {
  const dir = path.join(SCREENSHOT_DIR, testInfo.project.name);
  mkdirSync(dir, { recursive: true });
  await settle(page, options.settleMs ?? 700);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: options.fullPage ?? false, animations: 'allow' });
}

/**
 * Collects what must never happen on any screen: console errors, uncaught errors and
 * requests to anything but the app itself (and the mock AI when a test allows it).
 */
export function watchPage(page: Page, allowedOrigins: string[]): { problems: string[]; requests: string[] } {
  const problems: string[] = [];
  const requests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    requests.push(url);
    const origin = new URL(url).origin;
    if (!allowedOrigins.includes(origin)) problems.push(`request to another origin: ${url}`);
  });
  return { problems, requests };
}

// ---------------------------------------------------------------------------
// Parent area
// ---------------------------------------------------------------------------

export const MOCK_AI_ORIGIN = 'http://127.0.0.1:8787';
export const MOCK_AI_BASE_URL = `${MOCK_AI_ORIGIN}/v1`;

/** A section of the parent area, through its navigation (a page load would lock the area again). */
export async function parentSection(page: Page, name: 'Overview' | 'Children' | 'Library' | 'Settings'): Promise<void> {
  await page.getByRole('navigation', { name: 'Parent area sections' }).getByRole('link', { name, exact: true }).click();
  const heading = name === 'Library' ? 'Canvas library' : name;
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
}

/** A tab of a child's detail page, starting anywhere in the unlocked parent area. */
export async function childTab(page: Page, nickname: string, tab: 'Progress' | 'History' | 'Weekly report' | 'Profile' | 'Data'): Promise<void> {
  await parentSection(page, 'Children');
  await page.getByRole('link', { name: `${nickname}’s progress` }).click();
  await expect(page.getByRole('heading', { name: nickname, level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
}

/**
 * In the unlocked parent area: points the app at the mock AI server ("OpenAI or compatible
 * service"), tests the connection and saves.
 */
export async function connectMockAi(page: Page): Promise<void> {
  await parentSection(page, 'Settings');
  const panel = page.getByRole('tabpanel', { name: 'AI connection' });
  await panel.getByRole('radio', { name: /OpenAI or compatible service/ }).check();
  await panel.getByLabel('Service address (base URL)').fill(MOCK_AI_BASE_URL);
  await panel.getByLabel('API key').fill('sk-mock-any-key-works');
  await panel.getByRole('textbox', { name: /^Chat model/ }).fill('mock-stem-1');
  await panel.getByRole('button', { name: 'Test connection' }).click();
  await expect(panel.getByText(/Connected\. The model "mock-stem-1" answered/)).toBeVisible();
  await panel.getByRole('button', { name: 'Save AI settings' }).click();
  await expect(page.getByText('AI settings saved.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
}

/** Leaves the parent area for the profile picker (this locks the parent area). */
export async function toKidsArea(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Kids’ area' }).click();
  await expect(page).toHaveURL(/\/kids$/);
}

// ---------------------------------------------------------------------------
// Rules of the child area
// ---------------------------------------------------------------------------

/**
 * Every text of the challenges a child has opened (the one in play, and the solved ones whose
 * explanation is still on screen) and of their stories that holds the word "skip".
 */
async function contentAboutSkipping(page: Page): Promise<string[]> {
  const found = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/skip/i.test(value)) found.add(value.replace(/\s+/g, ' ').trim());
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };
  for (const challenge of await rows(page, 'challenges')) if (challenge.status === 'active' || challenge.status === 'completed') collect(challenge.content);
  for (const story of await rows(page, 'stories')) collect(story);
  // Longest first, so a text that holds another one is taken out whole.
  return [...found].sort((a, b) => b.length - a.length);
}

/**
 * There is no way to skip a challenge: no control on screen is named "skip", nothing is
 * labelled or titled "skip", and no text says it.
 *
 * A challenge may be *about* skipping ("Skip-count: 60, 70, 80, __"). Those words are the
 * challenge's own content, read from the database, and are taken out before the check; a name
 * that says "skip" in any other way fails.
 */
export async function expectNoSkip(page: Page): Promise<void> {
  const content = await contentAboutSkipping(page);
  const beyondContent = (text: string): boolean => {
    let rest = text.replace(/\s+/g, ' ');
    if (!/skip/i.test(rest)) return true; // matched by a name this helper cannot read: never excused
    for (const words of content) rest = rest.split(words).join(' ');
    return /skip/i.test(rest);
  };
  const offenders: string[] = [];
  for (const role of ['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch', 'radio', 'option'] as const) {
    const names = await page
      .getByRole(role, { name: /skip/i })
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? element.textContent ?? ''));
    offenders.push(...names.filter(beyondContent).map((name) => `${role}: ${name}`));
  }
  const labelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[aria-label], [title]'))
      .flatMap((element) => [element.getAttribute('aria-label') ?? '', element.getAttribute('title') ?? ''])
      .filter((text) => /skip/i.test(text)),
  );
  offenders.push(...labelled.filter(beyondContent).map((text) => `label: ${text}`));
  const texts = await page.getByText(/\bskip/i).allInnerTexts();
  offenders.push(...texts.filter(beyondContent).map((text) => `text: ${text}`));
  expect(offenders).toEqual([]);
}
