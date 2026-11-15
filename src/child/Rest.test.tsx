import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AttemptRecord } from '@/core/types';
import { db, updateSettings } from '@/data';
import { setLocale } from '@/i18n';
import { voiceMock } from './testing/voiceMock';
import { addChild, closeTheHours, freshDevice, renderChildArea, useUpToday } from './testSupport';
import { formatHour } from './today';

vi.mock('@/bot/pip', () => import('./testing/pipMock'));
vi.mock('@/voice', () => import('./testing/voiceMock'));

beforeEach(async () => {
  await freshDevice();
  setLocale('en');
  voiceMock.reset();
});

afterEach(() => cleanup());

function where(): string {
  return screen.getByTestId('where').textContent ?? '';
}

function attemptToday(id: string, childId: string, starsEarned: number): AttemptRecord {
  const now = Date.now();
  return {
    id,
    challengeId: `ch-${id}`,
    childId,
    skillId: 'counting',
    strand: 'math',
    answers: [{ at: now, answer: 3, correct: true, misconception: null }],
    hintsUsed: 0,
    walkthroughUsed: false,
    teachBackCorrect: null,
    outcome: 'independent',
    timeMs: 10_000,
    starsEarned,
    completedAt: now,
  };
}

describe('rest screen', () => {
  it('ends the day kindly when the daily time is used up, with what the child did today', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await useUpToday(mia.id);
    await db.attempts.bulkPut([attemptToday('a', mia.id, 3), attemptToday('b', mia.id, 2), attemptToday('c', 'someone-else', 3)]);
    renderChildArea(`/kids/${mia.id}/rest`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Great work today!' })).toBeInTheDocument();
    expect(screen.getByText('Your brain grew. See you tomorrow.')).toBeInTheDocument();
    expect(screen.getByTestId('pip')).toHaveAttribute('data-state', 'sleeping');
    await waitFor(() => expect(screen.getByTestId('today-items')).toHaveTextContent('2 challenges solved'));
    expect(screen.getByTestId('today-stars')).toHaveAccessibleName('5 stars');
    expect(document.querySelector('[data-reason]')).toHaveAttribute('data-reason', 'daily-limit');

    // The only way on is back to the profile picker: nothing here starts play.
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons.filter((text) => text !== '🔊')).toEqual(['👋Back to players']);
    await userEvent.click(screen.getByRole('button', { name: 'Back to players' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is playing?' })).toBeInTheDocument();
    expect(where()).toBe('/kids');
  });

  it('says when to come back outside the allowed hours', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    const { startHour } = await closeTheHours();
    renderChildArea(`/kids/${mia.id}/rest`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Pip is resting.' })).toBeInTheDocument();
    expect(screen.getByText(`Come back at ${formatHour(startHour, 'en')}.`)).toBeInTheDocument();
    expect(screen.queryByText('Great work today!')).not.toBeInTheDocument();
    expect(document.querySelector('[data-reason]')).toHaveAttribute('data-reason', 'outside-hours');
    expect(document.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'space');
    // Nothing was done today yet, so there is no empty score card.
    expect(screen.queryByTestId('today-items')).not.toBeInTheDocument();
  });

  it("uses the child's own hours when the parent set them for this child", async () => {
    const hour = new Date().getHours();
    const startHour = (hour + 3) % 24;
    const mia = await addChild({
      nickname: 'Mia',
      controlsOverride: { allowedStartHour: startHour, allowedEndHour: (hour + 4) % 24 },
    });
    renderChildArea(`/kids/${mia.id}/rest`);
    expect(await screen.findByText(`Come back at ${formatHour(startHour, 'en')}.`)).toBeInTheDocument();
  });

  it('sends the child home when play is allowed', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    renderChildArea(`/kids/${mia.id}/rest`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Mia!' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}`);
  });

  it('goes back home by itself once play is allowed again', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await closeTheHours();
    renderChildArea(`/kids/${mia.id}/rest`);
    await screen.findByRole('heading', { level: 1, name: 'Pip is resting.' });
    await updateSettings((current) => ({ ...current, controls: { ...current.controls, allowedStartHour: 0, allowedEndHour: 24 } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Mia!' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}`);
  });

  it('reads the message to a child who is read to', async () => {
    const leo = await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'PK' });
    await useUpToday(leo.id);
    renderChildArea(`/kids/${leo.id}/rest`);
    await waitFor(() => expect(voiceMock.spoken()).toEqual(['Great work today! Your brain grew. See you tomorrow.']));
  });

  it('speaks the language of the interface', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await useUpToday(mia.id);
    setLocale('hi');
    renderChildArea(`/kids/${mia.id}/rest`);
    expect(await screen.findByRole('heading', { level: 1, name: 'आज बहुत बढ़िया काम किया!' })).toBeInTheDocument();
  });
});
