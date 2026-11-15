import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dayKey } from '@/core/grades';
import type { ChildProfile } from '@/core/types';
import { db } from '@/data';
import { addChild, freshDevice, renderParent, sampleLibraryItem, seedAttempt } from '../testSupport';

const DAY = 86_400_000;

let mia: ChildProfile;

async function openHistory(): Promise<void> {
  renderParent(`/parent/child/${mia.id}?tab=history`);
  await screen.findByRole('region', { name: 'Filter the history' });
}

const titles = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

describe('child history', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    mia = await addChild({ nickname: 'Mia' });
    await db.library.put(sampleLibraryItem('lib-1', { seenBy: [mia.id], uses: 1, assistedSolves: 1 }));
    await seedAttempt(mia.id, { id: 'ch-new', libraryId: 'lib-1', title: 'Count the stars' });
    await seedAttempt(mia.id, {
      id: 'ch-old',
      title: 'Sink or float',
      completedAt: Date.now() - 3 * DAY,
      challenge: { strand: 'science', purpose: 'check', mode: 'story' },
      attempt: { outcome: 'independent', hintsUsed: 0, starsEarned: 3, strand: 'science', answers: [{ at: Date.now() - 3 * DAY, answer: 3, correct: true, misconception: null }] },
    });
    // A challenge that was never finished does not belong in the history.
    await seedAttempt(mia.id, { id: 'ch-open', title: 'Half done', challenge: { status: 'active', completedAt: null } });
    await db.attempts.delete('at-ch-open');
  });

  it('shows every finished challenge, newest first, with how it went', async () => {
    await openHistory();
    await waitFor(() => expect(titles()).toEqual(['Count the stars', 'Sink or float']));
    expect(screen.getByText('2 challenges')).toBeInTheDocument();

    const recent = within(screen.getByRole('article', { name: 'Count the stars' }));
    expect(recent.getByText('How many stars can you see?')).toBeInTheDocument();
    expect(recent.getByText('Solved with a small hint')).toBeInTheDocument();
    expect(recent.getByText('2 stars')).toBeInTheDocument();
    expect(recent.getByText('Practice at the current level')).toBeInTheDocument();
    expect(recent.getByText('Made by AI')).toBeInTheDocument();
    expect(recent.getByText('Small hint')).toBeInTheDocument();
    expect(recent.getByText('1 min 15 s')).toBeInTheDocument();

    const older = within(screen.getByRole('article', { name: 'Sink or float' }));
    expect(older.getByText('Concept check')).toBeInTheDocument();
    expect(older.getByText('Solved alone, first try')).toBeInTheDocument();
    expect(older.getByText('Built-in challenge')).toBeInTheDocument();
  });

  it('opens the answers and the helper conversation of an attempt', async () => {
    await openHistory();
    const card = within(await screen.findByRole('article', { name: 'Count the stars' }));
    expect(screen.queryByText('I counted four, is that right?')).not.toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'Answers, conversation and rating' }));

    expect(await card.findByText('I counted four, is that right?')).toBeInTheDocument();
    expect(card.getByText('Try touching each star once as you count.')).toBeInTheDocument();
    expect(card.getByText('Mia · chat')).toBeInTheDocument();
    expect(card.getByText('Helper · hint')).toBeInTheDocument();
    expect(card.getByRole('heading', { name: 'What Mia answered' })).toBeInTheDocument();
    expect(card.getByText('Feedback given: One star was counted twice.')).toBeInTheDocument();
    expect(card.getByText('Not yet')).toBeInTheDocument();
    expect(card.getByText('Right')).toBeInTheDocument();
  });

  it('stores a rating on the library canvas, which retires it at two stars', async () => {
    await openHistory();
    const card = within(await screen.findByRole('article', { name: 'Count the stars' }));
    await userEvent.click(card.getByRole('button', { name: 'Answers, conversation and rating' }));
    const save = await card.findByRole('button', { name: 'Save rating' });
    expect(save).toBeDisabled();
    expect(card.getByText(/1 or 2 stars retires this canvas/)).toBeInTheDocument();

    await userEvent.click(card.getByRole('radio', { name: '2 of 5 stars' }));
    expect(card.getByText('Poor: never show this again')).toBeInTheDocument();
    await userEvent.type(card.getByLabelText('Note (optional)'), 'The picture did not match the question');
    await userEvent.click(save);

    expect(await screen.findByText('Rating saved.')).toBeInTheDocument();
    expect(await db.library.get('lib-1')).toMatchObject({ rating: 2, retired: true, ratingNote: 'The picture did not match the question' });
    expect(await db.challenges.get('ch-new')).toMatchObject({ parentRating: 2, parentNote: 'The picture did not match the question' });
    await waitFor(() => expect(card.getByRole('radio', { name: '2 of 5 stars' })).toBeChecked());
  });

  it('keeps the rating of a built-in challenge in the history only', async () => {
    await openHistory();
    const card = within(await screen.findByRole('article', { name: 'Sink or float' }));
    await userEvent.click(card.getByRole('button', { name: 'Answers, conversation and rating' }));
    expect(await card.findByText(/the rating is kept in the history only/)).toBeInTheDocument();
    await userEvent.click(card.getByRole('radio', { name: '5 of 5 stars' }));
    await userEvent.click(card.getByRole('button', { name: 'Save rating' }));

    expect(await screen.findByText('Rating saved.')).toBeInTheDocument();
    expect(await db.challenges.get('ch-old')).toMatchObject({ parentRating: 5, parentNote: '' });
    expect(await db.library.get('lib-1')).toMatchObject({ rating: null, retired: false });
  });

  it('filters by subject, outcome, mode and date', async () => {
    await openHistory();
    await waitFor(() => expect(titles()).toHaveLength(2));

    await userEvent.selectOptions(screen.getByLabelText('Subject'), 'science');
    await waitFor(() => expect(titles()).toEqual(['Sink or float']));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(titles()).toHaveLength(2));

    await userEvent.selectOptions(screen.getByLabelText('How it went'), 'nudge');
    await waitFor(() => expect(titles()).toEqual(['Count the stars']));
    await userEvent.selectOptions(screen.getByLabelText('Play mode'), 'story');
    expect(await screen.findByText('No challenge matches')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    fireEvent.change(screen.getByLabelText('To'), { target: { value: dayKey(Date.now() - 2 * DAY) } });
    await waitFor(() => expect(titles()).toEqual(['Sink or float']));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: dayKey(Date.now() - DAY) } });
    await waitFor(() => expect(titles()).toEqual(['Count the stars']));
  });

  it('replays the exact canvas without recording anything', async () => {
    await openHistory();
    const card = within(await screen.findByRole('article', { name: 'Count the stars' }));
    const before = { attempts: await db.attempts.count(), challenges: await db.challenges.count(), rewards: await db.rewards.count() };
    await userEvent.click(card.getByRole('button', { name: 'Replay' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Count the stars' }));
    expect(dialog.getByText(/nothing you do here is recorded/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: '4' }));
    await userEvent.click(dialog.getByRole('button', { name: /check/i }));
    expect(await dialog.findByText(/Not right yet/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Start over' }));
    await userEvent.click(dialog.getByRole('button', { name: '3' }));
    await userEvent.click(dialog.getByRole('button', { name: /check/i }));
    expect(await dialog.findByText('That is the right answer.')).toBeInTheDocument();

    expect({ attempts: await db.attempts.count(), challenges: await db.challenges.count(), rewards: await db.rewards.count() }).toEqual(before);
    expect((await db.library.get('lib-1'))?.uses).toBe(1);
  });

  it('has a friendly empty state', async () => {
    const leo = await addChild({ nickname: 'Leo' });
    renderParent(`/parent/child/${leo.id}?tab=history`);
    expect(await screen.findByText('Every challenge Leo finishes will appear here.')).toBeInTheDocument();
  });
});
