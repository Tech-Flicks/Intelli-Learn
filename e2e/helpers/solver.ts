/**
 * Plays a challenge through the real widgets.
 *
 * The test reads the challenge that is on screen from IndexedDB, works out an answer with
 * the engine's own pure checker, and then enters it the way a child would: tapping option
 * cards, tapping the picture, moving cards into boxes, connecting pairs, pressing the
 * arrows, typing on the keypad, snapping robot blocks together and picking parts.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { Challenge } from '../../src/core/schemas';
import type { ChallengeRecord, InteractionKind } from '../../src/core/types';
import { buildSolutions } from '../../src/engine/build';
import { checkAnswer } from '../../src/engine/check';
import { robotFitsBudget } from '../../src/engine/robot';
import type { Answer, RobotProgram, RobotStep } from '../../src/engine/types';
import { challengesOf } from './db';

type Interaction = Challenge['interaction'];
type Of<K extends InteractionKind> = Extract<Interaction, { kind: K }>;

const looks = (item: { label: string; emoji?: string | undefined }): string => `${item.emoji ?? ''}|${item.label.trim().toLowerCase()}`;

// ---------------------------------------------------------------------------
// Finding the challenge that is on screen
// ---------------------------------------------------------------------------

export function playScreen(page: Page): Locator {
  return page.getByTestId('play-screen');
}

/** Waits until a challenge can be answered. A story chapter is read and started first. */
export async function waitForChallenge(page: Page): Promise<void> {
  const screen = playScreen(page);
  await expect(screen).toHaveAttribute('data-phase', /^(story|presenting|answering)$/, { timeout: 60_000 });
  if ((await screen.getAttribute('data-phase')) === 'story') {
    await page.getByRole('button', { name: 'Start the challenge' }).click();
  }
  await expect(screen).toHaveAttribute('data-phase', 'answering');
  await expect(page.getByTestId('prompt-card')).toBeVisible();
}

/** The active challenge record whose title and question are on screen. */
export async function currentChallenge(page: Page, childId: string): Promise<ChallengeRecord> {
  await waitForChallenge(page);
  const title = (await page.getByTestId('prompt-card').getByRole('heading', { level: 1 }).innerText()).trim();
  const question = (await page.getByTestId('question').innerText()).trim();
  const same = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
  const active = (await challengesOf(page, childId)).filter((row) => row.status === 'active');
  const match = active.find((row) => same(row.content.title, title) && same(row.content.question, question));
  if (!match) {
    throw new Error(`No active challenge in the database matches the screen ("${title}" / "${question}"). Active: ${active.map((row) => row.content.title).join(', ')}`);
  }
  return match;
}

function stageOf(page: Page, kind: InteractionKind): Locator {
  return page.locator(`[data-interaction="${kind}"]`);
}

/** Pip's speech bubble can lie over the options on a phone: close a plain line before working. */
export async function closeBubble(page: Page): Promise<void> {
  const close = page.getByTestId('bot-bubble').getByRole('button', { name: 'Close message' });
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Working out answers
// ---------------------------------------------------------------------------

function robotProgram(interaction: Of<'robot'>): RobotProgram {
  const report = robotFitsBudget(interaction);
  if (!report.program || !report.fits) throw new Error('This robot maze cannot be solved inside its block budget');
  return report.program;
}

/** The answer the engine accepts, in the shape `checkAnswer` takes. */
export function correctAnswer(interaction: Interaction): Answer {
  switch (interaction.kind) {
    case 'choice':
      return [...interaction.correctIds];
    case 'tap':
      return [...interaction.targetIds];
    case 'sort':
      return Object.fromEntries(interaction.items.map((item) => [item.id, item.binId]));
    case 'match':
      return Object.fromEntries(interaction.pairs.map((pair) => [pair.id, pair.id]));
    case 'order':
      return interaction.items.map((item) => item.id);
    case 'number':
      return interaction.answer;
    case 'robot':
      return robotProgram(interaction);
    case 'build': {
      const [first] = buildSolutions(interaction, 1);
      if (!first) throw new Error('This build challenge has no solution');
      return first;
    }
  }
}

/** A complete answer that the engine does not accept, or null when this challenge has none that the widgets can produce. */
export function wrongAnswer(challenge: Challenge): Answer | null {
  const interaction = challenge.interaction;
  const candidates: Answer[] = [];
  switch (interaction.kind) {
    case 'choice': {
      for (const option of interaction.options) if (!interaction.correctIds.includes(option.id)) candidates.push([option.id]);
      break;
    }
    case 'tap': {
      const tappable = challenge.scene.objects.filter((object) => object.tappable).map((object) => object.id);
      for (const id of tappable) if (!interaction.targetIds.includes(id)) candidates.push([id]);
      if (interaction.targetIds.length > 1) candidates.push(interaction.targetIds.slice(0, 1));
      break;
    }
    case 'sort': {
      const right = Object.fromEntries(interaction.items.map((item) => [item.id, item.binId]));
      for (const item of interaction.items) {
        for (const bin of interaction.bins) if (bin.id !== item.binId) candidates.push({ ...right, [item.id]: bin.id });
      }
      break;
    }
    case 'match': {
      const right = Object.fromEntries(interaction.pairs.map((pair) => [pair.id, pair.id]));
      for (const a of interaction.pairs) {
        for (const b of interaction.pairs) if (a.id !== b.id) candidates.push({ ...right, [a.id]: b.id, [b.id]: a.id });
      }
      break;
    }
    case 'order': {
      const ids = interaction.items.map((item) => item.id);
      for (let index = 0; index + 1 < ids.length; index += 1) {
        const swapped = ids.slice();
        swapped[index] = ids[index + 1] as string;
        swapped[index + 1] = ids[index] as string;
        candidates.push(swapped);
      }
      break;
    }
    case 'number': {
      const off = Math.ceil(interaction.tolerance) + 1;
      candidates.push(interaction.answer + off, Math.abs(interaction.answer) + off + 1);
      break;
    }
    case 'robot': {
      for (const cmd of ['forward', 'left', 'right'] as const) if (interaction.allowed.includes(cmd)) candidates.push([{ cmd }]);
      break;
    }
    case 'build': {
      for (const part of interaction.parts) candidates.push([part.id]);
      candidates.push(interaction.parts.map((part) => part.id));
      break;
    }
  }
  return candidates.find((candidate) => !checkAnswer(interaction, candidate).correct) ?? null;
}

// ---------------------------------------------------------------------------
// Entering answers through the widgets
// ---------------------------------------------------------------------------

/** Sets a row of toggle buttons (option cards, part cards) to exactly the wanted ones, by position. */
async function setToggles(buttons: Locator, wanted: boolean[]): Promise<void> {
  await expect(buttons).toHaveCount(wanted.length);
  for (let index = 0; index < wanted.length; index += 1) {
    const button = buttons.nth(index);
    const pressed = (await button.getAttribute('aria-pressed')) === 'true';
    if (pressed !== wanted[index]) await button.click();
    await expect(button).toHaveAttribute('aria-pressed', wanted[index] ? 'true' : 'false');
  }
}

async function enterChoice(page: Page, interaction: Of<'choice'>, ids: string[]): Promise<void> {
  const options = stageOf(page, 'choice').locator('[role="group"] button[aria-pressed]');
  const wanted = interaction.options.map((option) => ids.includes(option.id));
  if (!interaction.multi) {
    // One tap is enough: picking a card lets go of the one before.
    const index = wanted.indexOf(true);
    const button = options.nth(index);
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    return;
  }
  await setToggles(options, wanted);
}

/** Taps the picture where each object is drawn. A tap that lands on an overlapping neighbour is put right by keyboard. */
async function enterTap(page: Page, challenge: Challenge, ids: string[]): Promise<void> {
  const stage = stageOf(page, 'tap');
  const tappable = challenge.scene.objects.filter((object) => object.tappable).map((object) => object.id);
  const marker = (id: string): Locator => stage.locator(`[data-object-id="${id.replace(/["\\]/g, '\\$&')}"]`);
  const pressed = async (id: string): Promise<boolean> => (await marker(id).getAttribute('aria-pressed')) === 'true';
  const becomes = async (id: string, want: boolean): Promise<boolean> => {
    for (let turn = 0; turn < 10; turn += 1) {
      if ((await pressed(id)) === want) return true;
      await page.waitForTimeout(60);
    }
    return false;
  };

  for (const id of tappable) {
    const want = ids.includes(id);
    if ((await pressed(id)) === want) continue;
    await marker(id).scrollIntoViewIfNeeded();
    const box = await marker(id).boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await becomes(id, want);
  }
  for (const id of tappable) {
    const want = ids.includes(id);
    if ((await pressed(id)) !== want) {
      await marker(id).focus();
      await page.keyboard.press('Enter');
    }
    await expect(marker(id)).toHaveAttribute('aria-pressed', want ? 'true' : 'false');
  }
}

async function enterSort(page: Page, interaction: Of<'sort'>, placed: Record<string, string>): Promise<void> {
  const stage = stageOf(page, 'sort');
  const tray = stage.locator('[data-dropzone="__tray__"]');
  const bin = (id: string): Locator => stage.locator(`[data-dropzone="${id.replace(/["\\]/g, '\\$&')}"]`);

  // Start from a full tray: take back every card that already sits in a box.
  for (const candidate of interaction.bins) {
    const cards = bin(candidate.id).locator('button[aria-pressed]');
    for (let guard = 0; guard < interaction.items.length && (await cards.count()) > 0; guard += 1) {
      await cards.first().click();
      await tray.getByRole('button', { name: 'Back to the cards' }).click();
    }
  }
  const waiting = tray.locator('button[aria-pressed]');
  await expect(waiting).toHaveCount(interaction.items.length);

  // The tray shows the cards in their own order, so the first card is always the next item.
  for (const [index, item] of interaction.items.entries()) {
    const target = placed[item.id];
    if (target === undefined) throw new Error(`No box for ${item.id}`);
    await waiting.first().click();
    await bin(target).locator('> button').click();
    await expect(waiting).toHaveCount(interaction.items.length - index - 1);
  }
}

async function enterMatch(page: Page, interaction: Of<'match'>, links: Record<string, string>): Promise<void> {
  const stage = stageOf(page, 'match');
  const lefts = stage.locator('ul').first().locator('button');
  await expect(lefts).toHaveCount(interaction.pairs.length);
  for (const [index, pair] of interaction.pairs.entries()) {
    const rightId = links[pair.id];
    if (rightId === undefined) throw new Error(`No partner for ${pair.id}`);
    const left = lefts.nth(index);
    // A tap on a connected card lets go of its line and picks the card up again.
    await left.click();
    await expect(left).toHaveAttribute('aria-pressed', 'true');
    await stage.locator(`[data-match-right="${rightId.replace(/["\\]/g, '\\$&')}"]`).click();
    await expect(left).toHaveAttribute('aria-pressed', 'false');
  }
}

/** Reorders with the arrow buttons, one place at a time, from whatever order is on screen. */
async function enterOrder(page: Page, interaction: Of<'order'>, ids: string[]): Promise<void> {
  const stage = stageOf(page, 'order');
  const cards = stage.locator('ul > li');
  await expect(cards).toHaveCount(interaction.items.length);
  const byId = new Map(interaction.items.map((item) => [item.id, item]));
  const wanted = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown order item ${id}`);
    return looks(item);
  });
  const shown = async (): Promise<string[]> =>
    cards.evaluateAll((items) =>
      items.map((item) => {
        const label = item.querySelector(':scope > span:nth-of-type(2) > span');
        const parts = label ? Array.from(label.children).map((child) => (child.textContent ?? '').trim()) : [];
        const text = parts.length > 1 ? `${parts[0]}|${(parts[1] ?? '').toLowerCase()}` : `|${(parts[0] ?? '').toLowerCase()}`;
        return text;
      }),
    );
  for (let position = 0; position < wanted.length; position += 1) {
    let now = await shown();
    let from = now.indexOf(wanted[position] as string, position);
    if (from === -1) throw new Error(`Card "${wanted[position]}" is not on screen (${now.join(', ')})`);
    while (from > position) {
      await cards.nth(from).getByRole('button').first().click();
      from -= 1;
      await expect.poll(async () => (await shown())[from]).toBe(wanted[position]);
    }
    now = await shown();
    expect(now[position]).toBe(wanted[position]);
  }
}

async function enterNumber(page: Page, interaction: Of<'number'>, value: number): Promise<void> {
  const stage = stageOf(page, 'number');
  const field = stage.getByRole('textbox');
  await field.fill('');
  const text = String(value);
  if (/^\d+$/.test(text)) {
    // Whole numbers go in on the big keypad, like a child on a tablet would do it.
    const keypad = stage.getByRole('group', { name: 'Your answer' });
    for (const digit of text) await keypad.getByRole('button', { name: digit, exact: true }).click();
  } else {
    if (text.includes('.') && !interaction.allowDecimal) throw new Error('This number challenge needs a decimal answer but has no decimal key');
    await field.fill(text);
  }
  await expect(field).toHaveValue(text);
}

async function enterRobot(page: Page, program: RobotProgram): Promise<void> {
  const stage = stageOf(page, 'robot');
  const palette = stage.getByRole('group', { name: 'Blocks' });
  const name = { forward: 'Forward', left: 'Turn left', right: 'Turn right' } as const;
  const clear = stage.getByRole('button', { name: 'Clear', exact: true });
  if (await clear.isEnabled()) await clear.click();
  await expect(stage.getByText('Tap a block to start your program.')).toBeVisible();

  const add = async (step: RobotStep): Promise<void> => {
    if (step.cmd !== 'repeat') {
      await palette.getByRole('button', { name: name[step.cmd], exact: true }).click();
      return;
    }
    // Tap Repeat, set how often, then tap what to repeat; the blocks go inside it.
    await palette.getByRole('button', { name: 'Repeat', exact: true }).click();
    for (let times = 2; times < step.times; times += 1) await stage.getByRole('button', { name: 'More times' }).last().click();
    for (const inner of step.body) {
      if (inner.cmd === 'repeat') throw new Error('Nested repeats are not produced by the solver');
      await palette.getByRole('button', { name: name[inner.cmd], exact: true }).click();
    }
    await stage.getByRole('button', { name: 'Add blocks to the end' }).click();
  };
  for (const step of program) await add(step);
}

async function enterBuild(page: Page, interaction: Of<'build'>, ids: string[]): Promise<void> {
  const parts = stageOf(page, 'build').locator('button[aria-pressed]');
  await setToggles(
    parts,
    interaction.parts.map((part) => ids.includes(part.id)),
  );
}

/** Puts `answer` into the widgets of the challenge on screen. Does not press Check. */
export async function enterAnswer(page: Page, challenge: Challenge, answer: Answer): Promise<void> {
  const interaction = challenge.interaction;
  await closeBubble(page);
  switch (interaction.kind) {
    case 'choice':
      return enterChoice(page, interaction, answer as string[]);
    case 'tap':
      return enterTap(page, challenge, answer as string[]);
    case 'sort':
      return enterSort(page, interaction, answer as Record<string, string>);
    case 'match':
      return enterMatch(page, interaction, answer as Record<string, string>);
    case 'order':
      return enterOrder(page, interaction, answer as string[]);
    case 'number':
      return enterNumber(page, interaction, answer as number);
    case 'robot':
      return enterRobot(page, answer as RobotProgram);
    case 'build':
      return enterBuild(page, interaction, answer as string[]);
  }
}

export async function pressCheck(page: Page): Promise<void> {
  const check = page.getByTestId('check-button');
  await expect(check).toBeEnabled();
  await check.click();
}

/** Enters a wrong answer and presses Check. The challenge stays open. */
export async function answerWrongly(page: Page, record: ChallengeRecord): Promise<void> {
  const answer = wrongAnswer(record.content);
  if (answer === null) throw new Error(`No wrong answer can be entered for "${record.content.title}"`);
  expect(checkAnswer(record.content.interaction, answer).correct).toBe(false);
  await enterAnswer(page, record.content, answer);
  await pressCheck(page);
  await expect(playScreen(page)).toHaveAttribute('data-phase', 'answering');
}

/** Presses Check again without changing anything: after a wrong try the child's work is kept, so this is another wrong try. */
export async function checkAgain(page: Page): Promise<void> {
  await pressCheck(page);
  await expect(playScreen(page)).toHaveAttribute('data-phase', 'answering');
  await expect(page.getByTestId('solved-sheet')).toHaveCount(0);
}

/** Enters the right answer and presses Check. Ends with the solved sheet on screen. */
export async function answerCorrectly(page: Page, record: ChallengeRecord): Promise<void> {
  const answer = correctAnswer(record.content.interaction);
  expect(checkAnswer(record.content.interaction, answer).correct).toBe(true);
  await enterAnswer(page, record.content, answer);
  await pressCheck(page);
  await expect(page.getByTestId('solved-sheet')).toBeVisible();
}

/**
 * From the solved sheet to the rewards: "Keep going" and the teach-back question when Pip
 * asks one (the right explanation is chosen). Ends when "Next adventure" can be pressed.
 */
export async function finishSolved(page: Page, record: ChallengeRecord): Promise<{ taught: boolean }> {
  const screen = playScreen(page);
  const sheet = page.getByTestId('solved-sheet');
  let taught = false;
  await expect(screen).toHaveAttribute('data-phase', /^(solved|teachback|recorded)$/);
  const keepGoing = sheet.getByRole('button', { name: 'Keep going' });
  // Either the attempt is stored at once, or Pip first asks to be taught.
  await expect(keepGoing.or(page.getByTestId('next-button'))).toBeVisible({ timeout: 30_000 });
  if (await keepGoing.isVisible()) {
    await keepGoing.click();
    const teachBack = record.content.teachBack;
    if (!teachBack) throw new Error('A teach-back was offered for a challenge without one');
    const right = teachBack.options.findIndex((option) => option.correct);
    await sheet.getByTestId('teachback').getByRole('button').nth(Math.max(0, right)).click();
    taught = true;
  }
  await expect(screen).toHaveAttribute('data-phase', 'recorded', { timeout: 30_000 });
  await expect(page.getByTestId('rewards')).toBeVisible();
  await expect(page.getByTestId('next-button')).toBeVisible();
  return { taught };
}

/** Solves the challenge on screen, start to rewards. Returns its record as it was while active. */
export async function solveCurrent(page: Page, childId: string): Promise<ChallengeRecord> {
  const record = await currentChallenge(page, childId);
  await answerCorrectly(page, record);
  await finishSolved(page, record);
  return record;
}

/** "Next adventure", and waits for the following challenge. */
export async function nextAdventure(page: Page): Promise<void> {
  await page.getByTestId('next-button').click();
  await waitForChallenge(page);
}
