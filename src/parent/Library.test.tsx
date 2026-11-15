import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChildProfile } from '@/core/types';
import { db } from '@/data';
import { EMPTY_LIBRARY_FILTER, toLibraryFilter } from './Library';
import { addChild, freshDevice, renderParent, sampleChallenge, sampleLibraryItem } from './testSupport';

const DAY = 86_400_000;

let mia: ChildProfile;

async function seedLibrary(): Promise<void> {
  const now = Date.now();
  await db.library.bulkPut([
    sampleLibraryItem('lib-stars', {
      content: sampleChallenge('Count the stars'),
      seenBy: [mia.id, 'child-who-left'],
      uses: 3,
      independentSolves: 2,
      assistedSolves: 1,
      createdAt: now - 3 * DAY,
    }),
    sampleLibraryItem('lib-robot', {
      content: sampleChallenge('Robot path'),
      strand: 'technology',
      grade: '2',
      stage: 12,
      interaction: 'robot',
      mode: 'robot',
      theme: 'robots',
      origin: 'remix',
      remixOf: 'lib-stars',
      rating: 5,
      createdAt: now - 2 * DAY,
    }),
    sampleLibraryItem('lib-float', {
      content: sampleChallenge('Sink or float'),
      strand: 'science',
      grade: '1',
      stage: 8,
      interaction: 'choice',
      mode: 'experiment',
      theme: 'ocean',
      rating: 1,
      ratingNote: 'Wrong answer key',
      retired: true,
      createdAt: now - DAY,
    }),
  ]);
}

async function openLibrary(): Promise<void> {
  renderParent('/parent/library');
  await screen.findByRole('heading', { name: 'Canvas library', level: 1 });
}

const titles = () => screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

describe('library filter', () => {
  it('turns the form state into the filter of the library service', () => {
    expect(toLibraryFilter(EMPTY_LIBRARY_FILTER)).toEqual({});
    expect(
      toLibraryFilter({ strand: 'math', grade: 'K', interaction: 'number', mode: 'quest', rating: 'low', retired: 'retired', search: '  stars ' }),
    ).toEqual({ strand: 'math', grade: 'K', interaction: 'number', mode: 'quest', rating: 'low', retired: true, search: 'stars' });
    expect(toLibraryFilter({ ...EMPTY_LIBRARY_FILTER, retired: 'active' })).toEqual({ retired: false });
  });
});

describe('canvas library', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    mia = await addChild({ nickname: 'Mia' });
    await seedLibrary();
  });

  it('lists every canvas with where it came from and how children did', async () => {
    await openLibrary();
    await waitFor(() => expect(titles()).toEqual(['Sink or float', 'Robot path', 'Count the stars']));
    expect(screen.getByText('3 canvases')).toBeInTheDocument();
    expect(screen.getByText(/Reuse: when another child reaches the same skill/)).toBeInTheDocument();
    expect(screen.getByText(/Remix: when the theme does not fit/)).toBeInTheDocument();

    const stars = within(screen.getByRole('article', { name: 'Count the stars' }));
    expect(stars.getByText(/Made by AI/)).toBeInTheDocument();
    expect(stars.getByText('2 alone · 1 with help')).toBeInTheDocument();
    // Names are resolved on the device; a child who is gone is only counted.
    expect(stars.getByText('Seen by 2 children')).toBeInTheDocument();
    expect(stars.getByText('Mia, 1 child no longer on this device')).toBeInTheDocument();
    expect(stars.getByRole('img', { name: 'Not rated yet' })).toBeInTheDocument();
    expect(stars.getByText('Space')).toBeInTheDocument();

    const robot = within(screen.getByRole('article', { name: 'Robot path' }));
    expect(robot.getByText('Preferred')).toBeInTheDocument();
    expect(robot.getByText('Robot program')).toBeInTheDocument();
    expect(robot.getByRole('img', { name: '5 of 5 stars' })).toBeInTheDocument();
    // A remix links to the canvas it was made from.
    await userEvent.click(robot.getByRole('button', { name: 'Count the stars' }));
    const preview = within(await screen.findByRole('dialog', { name: 'Count the stars' }));
    expect(preview.getByText(/nothing you do here is recorded/)).toBeInTheDocument();
    await userEvent.click(preview.getByRole('button', { name: 'Close' }));

    const float = within(screen.getByRole('article', { name: 'Sink or float' }));
    expect(float.getByText('Retired')).toBeInTheDocument();
    expect(float.getByText('“Wrong answer key”')).toBeInTheDocument();
    expect(float.getByText('Nobody yet')).toBeInTheDocument();
  });

  it('filters by subject, grade, answer type, mode, rating and status, and searches', async () => {
    await openLibrary();
    await waitFor(() => expect(titles()).toHaveLength(3));
    const clear = () => userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await userEvent.selectOptions(screen.getByLabelText('Subject'), 'technology');
    await waitFor(() => expect(titles()).toEqual(['Robot path']));
    expect(screen.getByText('1 canvas')).toBeInTheDocument();
    await clear();

    await userEvent.selectOptions(screen.getByLabelText('Grade'), '1');
    await waitFor(() => expect(titles()).toEqual(['Sink or float']));
    await clear();

    await userEvent.selectOptions(screen.getByLabelText('Answer type'), 'number');
    await waitFor(() => expect(titles()).toEqual(['Count the stars']));
    await clear();

    await userEvent.selectOptions(screen.getByLabelText('Play mode'), 'experiment');
    await waitFor(() => expect(titles()).toEqual(['Sink or float']));
    await clear();

    await userEvent.selectOptions(screen.getByLabelText('Rating'), 'unrated');
    await waitFor(() => expect(titles()).toEqual(['Count the stars']));
    await userEvent.selectOptions(screen.getByLabelText('Rating'), 'low');
    await waitFor(() => expect(titles()).toEqual(['Sink or float']));
    await userEvent.selectOptions(screen.getByLabelText('Rating'), 'high');
    await waitFor(() => expect(titles()).toEqual(['Robot path']));
    await clear();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'retired');
    await waitFor(() => expect(titles()).toEqual(['Sink or float']));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active');
    await waitFor(() => expect(titles()).toEqual(['Robot path', 'Count the stars']));
    await clear();

    await userEvent.type(screen.getByLabelText('Search'), 'robot');
    await waitFor(() => expect(titles()).toEqual(['Robot path']));
    await userEvent.type(screen.getByLabelText('Search'), ' zebra');
    expect(await screen.findByText('No canvas matches')).toBeInTheDocument();
  });

  it('rates a canvas: low stars retire it, and the note is kept', async () => {
    await openLibrary();
    const stars = within(await screen.findByRole('article', { name: 'Count the stars' }));
    await userEvent.click(stars.getByRole('button', { name: 'Rate: Count the stars' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Rate this canvas' }));
    expect(dialog.getByText(/1–2 stars retires the canvas/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('radio', { name: '1 of 5 stars' }));
    expect(dialog.getByText(/this note is passed to the AI as something to avoid/)).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText('Note (optional)'), 'Too scary');
    await userEvent.click(dialog.getByRole('button', { name: 'Save rating' }));

    expect(await screen.findByText('Rating saved. This canvas is retired and will not be shown again.')).toBeInTheDocument();
    expect(await db.library.get('lib-stars')).toMatchObject({ rating: 1, retired: true, ratingNote: 'Too scary' });
    await waitFor(() => expect(stars.getByText('Retired')).toBeInTheDocument());
    expect(stars.getByRole('img', { name: '1 of 5 stars' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // A better rating brings it back and makes it preferred.
    await userEvent.click(stars.getByRole('button', { name: 'Rate: Count the stars' }));
    const again = within(await screen.findByRole('dialog', { name: 'Rate this canvas' }));
    await userEvent.click(again.getByRole('radio', { name: '4 of 5 stars' }));
    await userEvent.click(again.getByRole('button', { name: 'Save rating' }));
    expect(await screen.findByText('Rating saved.')).toBeInTheDocument();
    expect(await db.library.get('lib-stars')).toMatchObject({ rating: 4, retired: false });
    await waitFor(() => expect(stars.getByText('Preferred')).toBeInTheDocument());
  });

  it('retires and restores a canvas by hand', async () => {
    await openLibrary();
    const robot = within(await screen.findByRole('article', { name: 'Robot path' }));
    await userEvent.click(robot.getByRole('button', { name: 'Retire: Robot path' }));
    expect(await screen.findByText('Retired. It will not be shown to children again.')).toBeInTheDocument();
    expect((await db.library.get('lib-robot'))?.retired).toBe(true);

    await userEvent.click(await robot.findByRole('button', { name: 'Restore: Robot path' }));
    expect(await screen.findByText('Restored. It can be shown again.')).toBeInTheDocument();
    expect(await db.library.get('lib-robot')).toMatchObject({ retired: false, rating: 5 });
  });

  it('deletes a canvas after a confirmation', async () => {
    await openLibrary();
    const float = within(await screen.findByRole('article', { name: 'Sink or float' }));
    await userEvent.click(float.getByRole('button', { name: 'Delete: Sink or float' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Delete this canvas?' }));
    expect(dialog.getByText(/“Sink or float” is removed from the library for good/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(await db.library.get('lib-float')).toBeDefined();

    await userEvent.click(float.getByRole('button', { name: 'Delete: Sink or float' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('The canvas was deleted.')).toBeInTheDocument();
    expect(await db.library.get('lib-float')).toBeUndefined();
    await waitFor(() => expect(titles()).toEqual(['Robot path', 'Count the stars']));
  });

  it('explains an empty library', async () => {
    await db.library.clear();
    await openLibrary();
    expect(await screen.findByText('The library is empty')).toBeInTheDocument();
  });
});
