import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, getChild, listChildren, type BackupFile } from '@/data';
import { addChild, freshDevice, renderParent, seedAttempt } from './testSupport';

const savedBackups = vi.hoisted(() => [] as { file: unknown; filename: string | undefined }[]);

vi.mock('@/data', async (original) => ({
  ...(await original<typeof import('@/data')>()),
  downloadBackup: (file: unknown, filename?: string) => {
    savedBackups.push({ file, filename });
  },
}));

describe('children', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    savedBackups.length = 0;
  });

  it('adds a child through the shared profile form', async () => {
    renderParent('/parent/children');
    expect(await screen.findByText('No children yet')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Add a child' })[0] as HTMLElement);

    const dialog = await screen.findByRole('dialog', { name: 'Add a child' });
    // A profile needs a nickname.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add child' }));
    expect(await within(dialog).findByText('Enter a nickname.')).toBeInTheDocument();
    expect(await listChildren()).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText(/^Nickname/), 'Leo');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Avatar 🐼' }));
    // Choosing a grade suggests the matching age group.
    await userEvent.selectOptions(within(dialog).getByLabelText('School grade'), '4');
    expect(within(dialog).getByLabelText('Age group')).toHaveValue('9-11');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Robots' }));
    await userEvent.type(within(dialog).getByLabelText('Add your own interest'), 'chess{Enter}');
    expect(within(dialog).getByRole('button', { name: 'chess' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText(/Interests are sent to the AI/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add child' }));

    expect(await screen.findByText('Leo was added.')).toBeInTheDocument();
    const children = await listChildren();
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ nickname: 'Leo', avatar: '🐼', grade: '4', ageGroup: '9-11', interests: ['robots', 'chess'] });
    expect(await screen.findByRole('link', { name: /Leo.s progress/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('allows at most eight interests', async () => {
    renderParent('/parent/children?add=1');
    const dialog = await screen.findByRole('dialog', { name: 'Add a child' });
    for (const interest of ['Space', 'Animals', 'Dinosaurs', 'Robots', 'Ocean', 'Cooking', 'Sports', 'Music']) {
      await userEvent.click(within(dialog).getByRole('button', { name: interest }));
    }
    expect(within(dialog).getByText(/8 of 8 chosen/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Nature' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Add your own interest'), 'horses{Enter}');
    expect(await within(dialog).findByText('Choose at most 8 interests.')).toBeInTheDocument();
  });

  it('edits a profile, its accessibility settings and its own rules', async () => {
    const leo = await addChild({ nickname: 'Leo', grade: '2' });
    renderParent(`/parent/child/${leo.id}?tab=profile`);
    await screen.findByRole('heading', { name: 'About your child' });
    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled();

    const nickname = screen.getByLabelText(/^Nickname/);
    await userEvent.clear(nickname);
    await userEvent.type(nickname, 'Leonie');
    await userEvent.click(screen.getByRole('switch', { name: 'Larger text' }));

    // By default every rule follows the family setting.
    expect(screen.getByText('All rules follow the family settings.')).toBeInTheDocument();
    const useFamily = screen.getByRole('switch', { name: 'Use the family setting for: Daily play time' });
    expect(useFamily).toBeChecked();
    expect(screen.getByText('Family setting: 30 minutes a day')).toBeInTheDocument();
    await userEvent.click(useFamily);
    const minutes = screen.getByRole('spinbutton', { name: /Minutes a day for Leo/ });
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '20');
    expect(screen.getByText('Own rules for this child: 1')).toBeInTheDocument();

    await userEvent.click(save);
    expect(await screen.findByText('Profile of Leonie saved.')).toBeInTheDocument();
    const stored = await getChild(leo.id);
    expect(stored).toMatchObject({ nickname: 'Leonie', grade: '2' });
    expect(stored?.accessibility.largeText).toBe(true);
    expect(stored?.controlsOverride).toEqual({ dailyMinutes: 20 });
    expect(await screen.findByRole('heading', { name: 'Leonie', level: 1 })).toBeInTheDocument();

    // Back to the family setting: the override is removed again.
    await userEvent.click(screen.getByRole('switch', { name: 'Use the family setting for: Daily play time' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(async () => expect((await getChild(leo.id))?.controlsOverride ?? {}).toEqual({}));
  });

  it('exports one child’s data', async () => {
    const leo = await addChild({ nickname: 'Leo' });
    const mia = await addChild({ nickname: 'Mia' });
    await seedAttempt(leo.id, { id: 'ch-leo' });
    await seedAttempt(mia.id, { id: 'ch-mia' });
    renderParent(`/parent/child/${leo.id}?tab=data`);
    await screen.findByRole('heading', { name: 'What is stored about Leo' });

    await userEvent.click(screen.getByRole('button', { name: 'Export data' }));
    expect(await screen.findByText('The export file was saved.')).toBeInTheDocument();
    expect(savedBackups).toHaveLength(1);
    expect(savedBackups[0]?.filename).toMatch(/-child\.json$/);
    const file = savedBackups[0]?.file as BackupFile;
    const text = JSON.stringify(file);
    expect(text).toContain('ch-leo');
    expect(text).not.toContain('ch-mia');
    expect(text).not.toContain('Mia');
  });

  it('deletes a child and everything about them after DELETE was typed', async () => {
    const leo = await addChild({ nickname: 'Leo' });
    const mia = await addChild({ nickname: 'Mia' });
    await seedAttempt(leo.id, { id: 'ch-leo' });
    await seedAttempt(mia.id, { id: 'ch-mia' });
    renderParent(`/parent/child/${leo.id}?tab=data`);
    await screen.findByRole('heading', { name: 'What is stored about Leo' });

    await userEvent.click(screen.getByRole('button', { name: 'Delete child' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Leo' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete child' }));
    expect(await within(dialog).findByText('Type DELETE exactly to go on.')).toBeInTheDocument();
    expect(await getChild(leo.id)).toBeDefined();

    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete child' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/parent/children'));
    expect(await screen.findByText('Leo was deleted.')).toBeInTheDocument();
    expect((await listChildren()).map((child) => child.id)).toEqual([mia.id]);
    expect(await db.challenges.get('ch-leo')).toBeUndefined();
    expect(await db.attempts.where('childId').equals(leo.id).count()).toBe(0);
    expect(await db.messages.where('childId').equals(leo.id).count()).toBe(0);
    expect(await db.challenges.get('ch-mia')).toBeDefined();
  });

  it('keeps a card with a long nickname inside its column on a phone', async () => {
    // jsdom lays nothing out. Measured in a browser at 360 px: without these the card grew to 428 px and the page scrolled sideways.
    await addChild({ nickname: 'Bartholomew-Benjamin' });
    renderParent('/parent/children');
    const progress = await screen.findByRole('link', { name: /Bartholomew-Benjamin.s progress/ });
    // The card is a grid item: it may be narrower than its content.
    expect(progress.closest('li')?.className).toMatch(/\bmin-w-0\b/);
    // The buttons wrap below each other, and the long name wraps inside its button.
    expect(progress.parentElement?.className).toMatch(/\bflex-wrap\b/);
    for (const cls of ['min-w-0', 'flex-auto', 'wrap-anywhere', 'text-center']) expect(progress.className.split(' ')).toContain(cls);
    expect(screen.getByRole('link', { name: 'Edit profile' }).className.split(' ')).toContain('min-w-0');
  });

  it('keeps the overview card with a long nickname inside its column on a phone', async () => {
    await addChild({ nickname: 'Bartholomew-Benjamin' });
    renderParent('/parent');
    const open = await screen.findByRole('link', { name: /Bartholomew-Benjamin.s details/ });
    expect(open.closest('article')?.className).toMatch(/\bmin-w-0\b/);
    for (const cls of ['min-w-0', 'w-full', 'wrap-anywhere', 'text-center']) expect(open.className.split(' ')).toContain(cls);
  });

  it('goes back to the list when a child does not exist', async () => {
    renderParent('/parent/child/nobody');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/parent/children'));
    expect(await screen.findByText('No children yet')).toBeInTheDocument();
  });
});
