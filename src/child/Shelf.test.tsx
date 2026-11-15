import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChildProfile } from '@/core/types';
import { db, getChild } from '@/data';
import { setLocale } from '@/i18n';
import { BADGES } from '@/progression';
import { dismissToast } from '@/ui';
import { voiceMock } from './testing/voiceMock';
import { addChild, freshDevice, renderChildArea } from './testSupport';

vi.mock('@/bot/pip', () => import('./testing/pipMock'));
vi.mock('@/voice', () => import('./testing/voiceMock'));

beforeEach(async () => {
  await freshDevice();
  setLocale('en');
  voiceMock.reset();
});

afterEach(() => {
  cleanup();
  dismissToast();
});

async function openShelf(child: ChildProfile): Promise<void> {
  renderChildArea(`/kids/${child.id}/shelf`);
  await screen.findByRole('heading', { level: 1, name: 'My treasure shelf' });
}

function shopItem(key: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-item="${key}"]`);
  if (!node) throw new Error(`no shop item ${key}`);
  return node;
}

describe('rewards shelf: the shop', () => {
  it('lets the child trade stars for a treasure, after asking once', async () => {
    const mia = await addChild({ nickname: 'Mia', stars: 12, totalStars: 40 });
    await openShelf(mia);
    expect(screen.getByText('Your shelf is ready for its first treasure.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Get it: Puppy Pal, 10 stars' }));
    const dialog = await screen.findByRole('dialog', { name: 'Get the Puppy Pal?' });
    expect(dialog).toHaveTextContent('It costs 10 stars. You will have 2 stars left.');
    // Nothing is spent until the child says yes.
    expect((await getChild(mia.id))?.stars).toBe(12);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, get it!' }));
    await waitFor(async () => expect((await getChild(mia.id))?.stars).toBe(2));
    const saved = await getChild(mia.id);
    expect(saved?.collectibles).toEqual(['puppy-pal']);
    expect(saved?.totalStars).toBe(40);
    expect(await db.rewards.where('childId').equals(mia.id).toArray()).toMatchObject([
      { kind: 'collectible', key: 'puppy-pal', amount: -10 },
    ]);

    // It is on the shelf, the balance went down, and the shop says so.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(await screen.findByTestId('owned-treasures')).getByText('Puppy Pal')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 stars' })).toBeInTheDocument();
    expect(within(shopItem('puppy-pal')).getByText('On your shelf')).toBeInTheDocument();
    expect(within(shopItem('puppy-pal')).queryByRole('button')).not.toBeInTheDocument();
    expect(await screen.findByText('Puppy Pal is on your shelf!')).toBeInTheDocument();
  });

  it('keeps the stars when the child says "Not now"', async () => {
    const mia = await addChild({ nickname: 'Mia', stars: 12 });
    await openShelf(mia);
    await userEvent.click(screen.getByRole('button', { name: 'Get it: Puppy Pal, 10 stars' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await getChild(mia.id)).toMatchObject({ stars: 12, collectibles: [] });
    expect(await db.rewards.count()).toBe(0);
  });

  it('cannot overspend: a treasure that costs more shows the way there instead of a button', async () => {
    const mia = await addChild({ nickname: 'Mia', stars: 12 });
    await openShelf(mia);

    const rocket = shopItem('rocket-ship'); // 15 stars
    expect(within(rocket).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rocket).getByText('3 more stars to go')).toBeInTheDocument();
    expect(within(rocket).getByRole('progressbar', { name: 'Rocket Ship, 15 stars' })).toHaveAttribute('aria-valuetext', '3 more stars to go');
    expect(within(shopItem('shiny-trophy')).getByText('28 more stars to go')).toBeInTheDocument();
    // Never a negative message.
    expect(document.body).not.toHaveTextContent(/not enough|can't|cannot|too expensive/i);

    // After spending, something that was affordable before is not offered any more.
    expect(within(shopItem('sea-shell')).getByRole('button', { name: 'Get it: Sea Shell, 5 stars' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Get it: Puppy Pal, 10 stars' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, get it!' }));
    await waitFor(() => expect(within(shopItem('sea-shell')).queryByRole('button')).not.toBeInTheDocument());
    expect(within(shopItem('sea-shell')).getByText('3 more stars to go')).toBeInTheDocument();
    expect((await getChild(mia.id))?.stars).toBe(2);
  });

  it("groups the shop by theme, the child's interests first, and shows owned treasures and total stars", async () => {
    const mia = await addChild({
      nickname: 'Mia',
      interests: ['ocean', 'music'],
      stars: 4,
      totalStars: 61,
      collectibles: ['sea-shell', 'sunflower'],
    });
    await openShelf(mia);
    const themes = [...document.querySelectorAll('[data-theme]')].map((node) => node.getAttribute('data-theme'));
    expect(themes.slice(0, 3)).toEqual(['ocean', 'music', 'space']);
    expect(themes).toHaveLength(16);
    expect(screen.getByRole('region', { name: 'Ocean' })).toContainElement(shopItem('friendly-whale'));

    const owned = within(screen.getByTestId('owned-treasures'));
    expect(owned.getByText('Sea Shell')).toBeInTheDocument();
    expect(owned.getByText('Sunflower')).toBeInTheDocument();
    expect(screen.getByTestId('total-stars')).toHaveTextContent('61 stars earned so far');

    // The rest of the shop opens with one tap.
    await userEvent.click(screen.getByRole('button', { name: 'More treasures' }));
    expect(screen.queryByRole('button', { name: 'More treasures' })).not.toBeInTheDocument();
  });
});

describe('rewards shelf: the companion', () => {
  it('shows the companion with its growth, under its species name until it gets a name', async () => {
    const mia = await addChild({ nickname: 'Mia', companion: { species: 'dragon', name: '', growth: 1, xp: 30 } });
    await openShelf(mia);
    expect(screen.getByTestId('companion-name')).toHaveTextContent('Dragon');
    expect(screen.getByText('Hatchling')).toBeInTheDocument();
    // 30 xp is a third of the way from 15 to 60.
    expect(screen.getByRole('progressbar', { name: 'Growing up' })).toHaveAttribute('aria-valuetext', '33% of the way to the next size');
    expect(screen.getByRole('button', { name: 'Give it a name' })).toBeInTheDocument();
  });

  it('follows the naming rules: letters, digits and spaces, at most 16, and safe', async () => {
    const mia = await addChild({ nickname: 'Mia', companion: { species: 'dragon', name: '', growth: 1, xp: 30 } });
    await openShelf(mia);
    await userEvent.click(screen.getByRole('button', { name: 'Give it a name' }));
    const dialog = await screen.findByRole('dialog', { name: 'Name your companion' });
    const input = within(dialog).getByRole('textbox', { name: 'Name' });
    const save = within(dialog).getByRole('button', { name: 'Save name' });

    await userEvent.type(input, 'Rex!');
    await userEvent.click(save);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Use only letters, numbers and spaces.');
    expect((await getChild(mia.id))?.companion.name).toBe('');

    await userEvent.clear(input);
    await userEvent.type(input, 'Killer');
    await userEvent.click(save);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Let’s pick a different name.');
    expect((await getChild(mia.id))?.companion.name).toBe('');

    // The field itself stops at 16 characters.
    await userEvent.clear(input);
    await userEvent.type(input, 'Abcdefghijklmnopqrstuvwxyz');
    expect(input).toHaveValue('Abcdefghijklmnop');

    await userEvent.clear(input);
    await userEvent.type(input, '  Sparky 7 {Enter}');
    await waitFor(async () => expect((await getChild(mia.id))?.companion).toEqual({ species: 'dragon', name: 'Sparky 7', growth: 1, xp: 30 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('companion-name')).toHaveTextContent('Sparky 7');
    expect(screen.getByRole('button', { name: 'Change name' })).toBeInTheDocument();
    expect(await screen.findByText('Say hello to Sparky 7!')).toBeInTheDocument();
  });

  it('lets the child take the name away again', async () => {
    const mia = await addChild({ nickname: 'Mia', companion: { species: 'owl', name: 'Hoot', growth: 3, xp: 200 } });
    await openShelf(mia);
    expect(screen.getByTestId('companion-name')).toHaveTextContent('Hoot');
    await userEvent.click(screen.getByRole('button', { name: 'Change name' }));
    const input = await screen.findByRole('textbox', { name: 'Name' });
    expect(input).toHaveValue('Hoot');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.getByTestId('companion-name')).toHaveTextContent('Owl'));
    expect((await getChild(mia.id))?.companion).toEqual({ species: 'owl', name: '', growth: 3, xp: 200 });
  });
});

describe('rewards shelf: badges', () => {
  it('shows earned badges with name and reason, and the others as mystery shapes with a hint', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await db.rewards.bulkPut([
      { id: 'r1', childId: mia.id, kind: 'badge', key: 'first-spark', amount: 0, reason: 'You gave your first challenge a go and finished it!', at: 1 },
      { id: 'r2', childId: mia.id, kind: 'star', key: '', amount: 3, reason: 'You worked it out all on your own!', at: 1 },
      { id: 'r3', childId: 'someone-else', kind: 'badge', key: 'inventor', amount: 0, reason: 'x', at: 1 },
    ]);
    await openShelf(mia);

    const earned = within(await screen.findByTestId('earned-badges'));
    expect(earned.getAllByRole('listitem')).toHaveLength(1);
    expect(earned.getByText('First Spark')).toBeInTheDocument();
    expect(earned.getByText('You gave your first challenge a go and finished it!')).toBeInTheDocument();
    expect(screen.getByText(`1 of ${BADGES.length}`)).toBeInTheDocument();

    const mysteries = screen.getAllByRole('button', { name: /^Mystery badge \d+\. Tap for a hint\.$/ });
    expect(mysteries).toHaveLength(BADGES.length - 1);
    // A mystery badge keeps its name secret.
    expect(screen.queryByText('Ten Tall')).not.toBeInTheDocument();
    expect(screen.getByTestId('badge-hint')).toHaveTextContent('Tap a mystery badge for a hint.');
    const first = mysteries[0];
    if (!first) throw new Error('no mystery badge');
    await userEvent.click(first);
    expect(screen.getByTestId('badge-hint')).toHaveTextContent('Hint: Solve 10 challenges.');
    expect(first).toHaveAttribute('aria-pressed', 'true');
  });

  it('encourages a child who has no badge yet', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openShelf(mia);
    expect(screen.getByText('Your first badge is waiting. Solve a challenge to earn it!')).toBeInTheDocument();
    expect(screen.queryByTestId('earned-badges')).not.toBeInTheDocument();
  });

  it('translates badge names and reasons', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await db.rewards.put({ id: 'r1', childId: mia.id, kind: 'badge', key: 'first-spark', amount: 0, reason: 'English reason', at: 1 });
    setLocale('es');
    renderChildArea(`/kids/${mia.id}/shelf`);
    const earned = within(await screen.findByTestId('earned-badges'));
    expect(earned.getByText('Primera chispa')).toBeInTheDocument();
    expect(earned.getByText('¡Probaste tu primer reto y lo terminaste!')).toBeInTheDocument();
    expect(screen.queryByText('English reason')).not.toBeInTheDocument();
  });
});

describe('rewards shelf: voice', () => {
  it('reads its main line to a child who is read to, and stops when the child leaves', async () => {
    const leo = await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'PK' });
    await openShelf(leo);
    await waitFor(() => expect(voiceMock.spoken()).toEqual(['Look! Your friend, your badges and your treasures.']));
    await userEvent.click(screen.getByRole('button', { name: 'Back to my map' }));
    await screen.findByRole('heading', { level: 1, name: 'Hi, Leo!' });
    expect(voiceMock.stopSpeaking).toHaveBeenCalled();
  });
});
