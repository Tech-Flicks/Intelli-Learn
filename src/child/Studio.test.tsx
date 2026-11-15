import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChildProfile } from '@/core/types';
import { setLocale } from '@/i18n';
import { ChildArea } from './index';
import { buildIdea } from './studioIdeas';
import { voiceMock } from './testing/voiceMock';
import { addChild, freshDevice, renderChildArea, useUpToday } from './testSupport';

vi.mock('@/bot/pip', () => import('./testing/pipMock'));
vi.mock('@/voice', () => import('./testing/voiceMock'));

beforeEach(async () => {
  await freshDevice();
  setLocale('en');
  voiceMock.reset();
});

afterEach(() => cleanup());

async function openStudio(child: ChildProfile): Promise<void> {
  renderChildArea(`/kids/${child.id}/studio`);
  await screen.findByRole('heading', { level: 1, name: 'Imagination Studio' });
}

function where(): string {
  return screen.getByTestId('where').textContent ?? '';
}

function preview(): HTMLElement {
  return screen.getByTestId('idea-preview');
}

const makeIt = () => screen.getByRole('button', { name: 'Make it!' });

describe('Imagination Studio: building an idea without typing', () => {
  it('builds a sentence from one picture of each row and sends it to the play screen', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openStudio(mia);
    expect(screen.getByRole('group', { name: 'Who?' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Doing what?' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Where?' })).toBeInTheDocument();
    expect(preview()).toHaveTextContent('Pick one from each row…');
    expect(makeIt()).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Dragon' }));
    expect(screen.getByRole('button', { name: 'Dragon' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Bake' }));
    expect(makeIt()).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Moon' }));
    expect(preview()).toHaveTextContent('A dragon baking cookies on the moon');

    // Changing a row changes the sentence at once.
    await userEvent.click(screen.getByRole('button', { name: 'Robot' }));
    expect(screen.getByRole('button', { name: 'Dragon' })).toHaveAttribute('aria-pressed', 'false');
    expect(preview()).toHaveTextContent('A robot baking cookies on the moon');

    await userEvent.click(makeIt());
    const target = (await screen.findByTestId('elsewhere')).textContent ?? '';
    expect(target.startsWith(`play:/kids/${mia.id}/play?`)).toBe(true);
    const query = new URLSearchParams(target.slice(target.indexOf('?')));
    expect(query.get('mode')).toBe('studio');
    // The picture idea travels as chip ids, not as text: nothing typed can ride along.
    expect(query.get('pick')).toBe('robot.baking.moon');
    expect(query.get('idea')).toBeNull();
  });

  it('opens the play screen once when "Make it!" is tapped twice, so one press on Back comes back here', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    function PlayStandIn(): JSX.Element {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(-1)}>
          Back from play
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={[`/kids/${mia.id}/studio`]}>
        <Routes>
          <Route path="/kids/:childId/play" element={<PlayStandIn />} />
          <Route path="/kids/*" element={<ChildArea />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Imagination Studio' });
    await userEvent.click(screen.getByRole('button', { name: 'Dragon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bake' }));
    await userEvent.click(screen.getByRole('button', { name: 'Moon' }));
    // Both taps land before the screen has changed.
    const button = makeIt();
    act(() => {
      button.click();
      button.click();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Back from play' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Imagination Studio' })).toBeInTheDocument();
  });

  it('takes a row back when its picture is tapped again', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openStudio(mia);
    await userEvent.click(screen.getByRole('button', { name: 'Cat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dance' }));
    await userEvent.click(screen.getByRole('button', { name: 'Castle' }));
    expect(makeIt()).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Castle' }));
    expect(makeIt()).toBeDisabled();
    expect(preview()).toHaveTextContent('Pick one from each row…');
  });

  it('offers surprise ideas that fill all three rows with one tap', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openStudio(mia);
    const surprises = document.querySelectorAll<HTMLElement>('[data-surprise]');
    expect(surprises).toHaveLength(3);
    const first = surprises[0];
    if (!first) throw new Error('no surprise idea');
    const sentence = first.getAttribute('aria-label') ?? '';
    expect(sentence.length).toBeGreaterThan(10);
    await userEvent.click(first);
    expect(preview()).toHaveTextContent(sentence);
    expect(document.querySelectorAll('[data-chip][aria-pressed="true"]')).toHaveLength(3);
    await userEvent.click(makeIt());
    const target = (await screen.findByTestId('elsewhere')).textContent ?? '';
    const query = new URLSearchParams(target.slice(target.indexOf('?')));
    expect(query.get('idea')).toBeNull();
    const [character, action, place] = (query.get('pick') ?? '').split('.');
    expect(buildIdea({ character: character ?? null, action: action ?? null, place: place ?? null })).toBe(sentence);
  });

  it('builds the sentence in the interface language', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    setLocale('es');
    renderChildArea(`/kids/${mia.id}/studio`);
    await userEvent.click(await screen.findByRole('button', { name: 'Dragón' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hornear' }));
    await userEvent.click(screen.getByRole('button', { name: 'Luna' }));
    expect(preview()).toHaveTextContent('Un dragón horneando galletas en la luna');
  });
});

describe('Imagination Studio: free text only with open chat', () => {
  it('has no text field and no microphone by default', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openStudio(mia);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Say your idea' })).not.toBeInTheDocument();
    expect(screen.queryByText('Or tell Pip your own idea')).not.toBeInTheDocument();
  });

  it('keeps the microphone away without open chat, even when the microphone is on', async () => {
    const mia = await addChild({ nickname: 'Mia', controlsOverride: { microphone: true } });
    await openStudio(mia);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Say your idea' })).not.toBeInTheDocument();
  });

  it('offers typing with open chat, limited to 80 characters, and no microphone unless that is on too', async () => {
    const mia = await addChild({ nickname: 'Mia', controlsOverride: { openChat: true } });
    await openStudio(mia);
    const input = screen.getByRole('textbox', { name: 'My idea' });
    expect(screen.queryByRole('button', { name: 'Say your idea' })).not.toBeInTheDocument();

    await userEvent.type(input, 'x'.repeat(95));
    expect(input).toHaveValue('x'.repeat(80));

    await userEvent.clear(input);
    await userEvent.type(input, 'A penguin who paints rainbows');
    expect(preview()).toHaveTextContent('A penguin who paints rainbows');
    await userEvent.click(makeIt());
    const target = (await screen.findByTestId('elsewhere')).textContent ?? '';
    const query = new URLSearchParams(target.slice(target.indexOf('?')));
    expect(query.get('mode')).toBe('studio');
    expect(query.get('idea')).toBe('A penguin who paints rainbows');
  });

  it('refuses an unsafe typed idea kindly and goes nowhere', async () => {
    const mia = await addChild({ nickname: 'Mia', controlsOverride: { openChat: true } });
    await openStudio(mia);
    const input = screen.getByRole('textbox', { name: 'My idea' });
    await userEvent.type(input, 'a robot that kills everyone');
    await userEvent.click(makeIt());
    expect(await screen.findByRole('alert')).toHaveTextContent('Hmm, let’s try a different idea.');
    expect(screen.queryByTestId('elsewhere')).not.toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}/studio`);

    // A link or contact detail is refused the same way, also from the keyboard.
    await userEvent.clear(input);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.type(input, 'see www.example.com{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Hmm, let’s try a different idea.');
    expect(where()).toBe(`/kids/${mia.id}/studio`);

    // Picking pictures instead clears the typed idea and works.
    await userEvent.click(screen.getByRole('button', { name: 'Octopus' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('listens once when the child taps the microphone, with open chat and the microphone both on', async () => {
    const mia = await addChild({ nickname: 'Mia', controlsOverride: { openChat: true, microphone: true } });
    await openStudio(mia);
    expect(voiceMock.listenOnce).not.toHaveBeenCalled();
    voiceMock.listenOnce.mockResolvedValueOnce('  a cat   sailing a boat ');
    await userEvent.click(screen.getByRole('button', { name: 'Say your idea' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'My idea' })).toHaveValue('a cat sailing a boat'));
    expect(voiceMock.listenOnce).toHaveBeenCalledTimes(1);

    voiceMock.listenOnce.mockRejectedValueOnce(new Error('no-speech'));
    await userEvent.click(screen.getByRole('button', { name: 'Say your idea' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('I did not hear anything. Try again?');

    voiceMock.listenOnce.mockRejectedValueOnce(new Error('denied'));
    await userEvent.click(screen.getByRole('button', { name: 'Say your idea' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The microphone is off. Ask a grown-up for help.'));

    // Leaving the screen releases the microphone.
    cleanup();
    expect(voiceMock.cancelListening).toHaveBeenCalled();
  });

  it('shows no microphone on a device that cannot listen', async () => {
    voiceMock.support = { tts: true, stt: false };
    const mia = await addChild({ nickname: 'Mia', controlsOverride: { openChat: true, microphone: true } });
    await openStudio(mia);
    expect(screen.getByRole('textbox', { name: 'My idea' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Say your idea' })).not.toBeInTheDocument();
  });
});

describe('Imagination Studio: guards and voice', () => {
  it('opens only after the first adventure', async () => {
    const mia = await addChild({ nickname: 'Mia', placementDone: false });
    renderChildArea(`/kids/${mia.id}/studio`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Mia!' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}`);
  });

  it('gives way to the rest screen when the play time is used up', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await useUpToday(mia.id);
    renderChildArea(`/kids/${mia.id}/studio`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Great work today!' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}/rest`);
  });

  it('reads the instructions and each finished picture idea to a child who is read to, never typed text', async () => {
    const leo = await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'PK', controlsOverride: { openChat: true } });
    await openStudio(leo);
    await waitFor(() => expect(voiceMock.spoken()).toEqual(['Pick three pictures. Then tap Make it!']));

    // For the youngest the chips show pictures; the names stay available to assistive technology.
    await userEvent.click(screen.getByRole('button', { name: 'Dragon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bake' }));
    await userEvent.click(screen.getByRole('button', { name: 'Moon' }));
    await waitFor(() => expect(voiceMock.spoken().at(-1)).toBe('A dragon baking cookies on the moon'));

    const count = voiceMock.speak.mock.calls.length;
    await userEvent.type(screen.getByRole('textbox', { name: 'My idea' }), 'my secret words');
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(voiceMock.spoken().slice(count).join(' ')).not.toContain('secret');
  });
});
