import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateSettings } from '@/data';
import { setLocale } from '@/i18n';
import { voiceMock } from './testing/voiceMock';
import { addChild, freshDevice, renderChildArea } from './testSupport';

vi.mock('@/bot/pip', () => import('./testing/pipMock'));
vi.mock('@/voice', () => import('./testing/voiceMock'));

beforeEach(async () => {
  await freshDevice();
  setLocale('en');
  voiceMock.reset();
});

afterEach(() => cleanup());

describe('profile picker', () => {
  it('asks who is playing and lists every child, oldest first', async () => {
    await addChild({ nickname: 'Mia', avatar: '🦊' });
    await addChild({ nickname: 'Leo', avatar: '🦖' });
    renderChildArea('/kids');

    expect(await screen.findByRole('heading', { level: 1, name: 'Who is playing?' })).toBeInTheDocument();
    const players = screen.getAllByRole('button', { name: /^Play as / });
    expect(players.map((button) => button.getAttribute('aria-label'))).toEqual(['Play as Mia', 'Play as Leo']);
    expect(screen.getByText('Mia')).toBeInTheDocument();
    expect(screen.getByText('Leo')).toBeInTheDocument();
    expect(screen.getByTestId('pip')).toHaveAttribute('data-state', 'happy');
  });

  it("opens a child's adventure map", async () => {
    const mia = await addChild({ nickname: 'Mia' });
    renderChildArea('/kids');
    await userEvent.click(await screen.findByRole('button', { name: 'Play as Mia' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/kids/${mia.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Mia!' })).toBeInTheDocument();
  });

  it('has a small lock button that leads grown-ups to the parent area', async () => {
    await addChild({ nickname: 'Mia' });
    renderChildArea('/kids');
    await userEvent.click(await screen.findByRole('button', { name: 'Grown-ups' }));
    expect(await screen.findByTestId('elsewhere')).toHaveTextContent('parent:/parent');
  });

  it('shows a friendly empty state that points a grown-up to the parent area', async () => {
    renderChildArea('/kids');
    expect(await screen.findByRole('heading', { level: 1, name: 'No explorers yet' })).toBeInTheDocument();
    expect(screen.getByText(/Ask a grown-up to add you/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Play as / })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Grown-ups: add a player' }));
    expect(await screen.findByTestId('elsewhere')).toHaveTextContent('parent:/parent');
  });

  it('sends an unknown child id and an unknown page back to the picker', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    renderChildArea('/kids/no-such-child/shelf');
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is playing?' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/kids$/);
    cleanup();

    renderChildArea(`/kids/${mia.id}/no-such-page`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Mia!' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`^/kids/${mia.id}$`));
  });

  it('reads the question aloud by itself only when one of the players is read to', async () => {
    await addChild({ nickname: 'Mia', ageGroup: '9-11', grade: '4' });
    renderChildArea('/kids');
    await screen.findByRole('heading', { level: 1, name: 'Who is playing?' });
    expect(voiceMock.speak).not.toHaveBeenCalled();
    // The speaker button says it on request.
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(voiceMock.spoken()).toEqual(['Who is playing? Tap your picture.']);
    cleanup();
    expect(voiceMock.stopSpeaking).toHaveBeenCalled();

    voiceMock.reset();
    await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'PK' });
    renderChildArea('/kids');
    await waitFor(() => expect(voiceMock.spoken()).toEqual(['Who is playing? Tap your picture.']));
  });

  it('stays silent and shows no speaker button when the parent switched voice output off', async () => {
    await updateSettings((current) => ({ ...current, controls: { ...current.controls, voiceOutput: false } }));
    await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'PK' });
    renderChildArea('/kids');
    await screen.findByRole('heading', { level: 1, name: 'Who is playing?' });
    expect(screen.queryByRole('button', { name: 'Hear it' })).not.toBeInTheDocument();
    expect(voiceMock.speak).not.toHaveBeenCalled();
  });

  it('follows the interface language', async () => {
    await addChild({ nickname: 'Mia' });
    setLocale('es');
    renderChildArea('/kids');
    expect(await screen.findByRole('heading', { level: 1, name: '¿Quién juega?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jugar como Mia' })).toBeInTheDocument();
  });
});
