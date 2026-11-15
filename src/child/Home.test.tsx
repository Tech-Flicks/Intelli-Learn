import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStage } from '@/core/grades';
import type { ChildProfile, SkillState } from '@/core/types';
import { db, updateChild, updateSettings } from '@/data';
import { setLocale } from '@/i18n';
import { voiceMock } from './testing/voiceMock';
import { addChild, closeTheHours, freshDevice, renderChildArea, useUpToday } from './testSupport';

vi.mock('@/bot/pip', () => import('./testing/pipMock'));
vi.mock('@/voice', () => import('./testing/voiceMock'));

beforeEach(async () => {
  await freshDevice();
  setLocale('en');
  voiceMock.reset();
});

afterEach(() => cleanup());

async function openHome(child: ChildProfile): Promise<void> {
  renderChildArea(`/kids/${child.id}`);
  await screen.findByRole('heading', { level: 1, name: `Hi, ${child.nickname}!` });
}

function where(): string {
  return screen.getByTestId('where').textContent ?? '';
}

async function wentTo(): Promise<string> {
  return (await screen.findByTestId('elsewhere')).textContent ?? '';
}

function skillState(childId: string, skillId: string, strand: SkillState['strand'], stage: number): SkillState {
  return {
    id: `${childId}:${skillId}`,
    childId,
    skillId,
    strand,
    stage,
    mastery: 40,
    assistedStreak: 0,
    independentStreak: 0,
    attempts: 3,
    checkPending: false,
    checksPassed: 0,
    recentInteractions: [],
    lastPracticedAt: Date.now(),
    reviewDueAt: null,
    reviewIntervalDays: 2,
  };
}

describe('home: play allowance', () => {
  it('sends the child to the rest screen when the daily time is used up', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await useUpToday(mia.id);
    renderChildArea(`/kids/${mia.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Great work today!' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}/rest`);
    expect(screen.queryByRole('button', { name: 'Keep exploring' })).not.toBeInTheDocument();
  });

  it('sends the child to the rest screen outside the allowed hours', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await closeTheHours();
    renderChildArea(`/kids/${mia.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pip is resting.' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}/rest`);
  });

  it('leaves the home screen as soon as the time runs out while it is open', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    await useUpToday(mia.id);
    await waitFor(() => expect(where()).toBe(`/kids/${mia.id}/rest`));
  });

  it('shows the time left as a picture, with the number only in the accessible name', async () => {
    await updateSettings((current) => ({ ...current, controls: { ...current.controls, dailyMinutes: 30 } }));
    const mia = await addChild({ nickname: 'Mia' });
    await useUpToday(mia.id, 10);
    await openHome(mia);
    const meter = screen.getByTestId('sun-meter');
    expect(meter).toHaveAttribute('role', 'img');
    expect(meter).toHaveAccessibleName('About 20 minutes of play left today');
    expect(meter).not.toHaveTextContent(/\d/);
  });
});

describe('home: before and after the first adventure', () => {
  it('invites a new child to start, and locks every creative mode with a friendly note', async () => {
    const mia = await addChild({ nickname: 'Mia', placementDone: false });
    await openHome(mia);

    expect(screen.getByRole('button', { name: 'Start your adventure' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep exploring' })).not.toBeInTheDocument();
    expect(screen.getByText('I want to find the perfect starting point for you!')).toBeInTheDocument();
    expect(screen.getByText('Finish your first adventure to unlock')).toBeInTheDocument();

    const cards = document.querySelectorAll<HTMLElement>('[data-mode]');
    expect(cards).toHaveLength(9);
    for (const card of cards) {
      expect(card).toHaveAttribute('aria-disabled', 'true');
      expect(card).toHaveAccessibleName(/Locked\. Finish your first adventure to unlock\./);
    }

    // A locked card opens nothing.
    await userEvent.click(screen.getByRole('button', { name: /^Robot Coder\. Locked/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Imagination Studio\. Locked/ }));
    expect(where()).toBe(`/kids/${mia.id}`);
    expect(screen.queryByTestId('elsewhere')).not.toBeInTheDocument();

    // The big button still starts the first adventure.
    await userEvent.click(screen.getByRole('button', { name: 'Start your adventure' }));
    expect(await wentTo()).toBe(`play:/kids/${mia.id}/play`);
  });

  it('unlocks the modes once placement is done', async () => {
    const mia = await addChild({ nickname: 'Mia', placementDone: false });
    await openHome(mia);
    await updateChild(mia.id, { placementDone: true });
    expect(await screen.findByRole('button', { name: 'Keep exploring' })).toBeInTheDocument();
    expect(screen.queryByText('Finish your first adventure to unlock')).not.toBeInTheDocument();
    for (const card of document.querySelectorAll('[data-mode]')) expect(card).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('Where shall we explore today?')).toBeInTheDocument();
  });
});

describe('home: navigation', () => {
  it('starts play from the big button', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    await userEvent.click(screen.getByRole('button', { name: 'Keep exploring' }));
    expect(await wentTo()).toBe(`play:/kids/${mia.id}/play`);
  });

  it('starts play in a strand from its world', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    await userEvent.click(screen.getByRole('button', { name: /^Wonder Jungle: Science/ }));
    expect(await wentTo()).toBe(`play:/kids/${mia.id}/play?strand=science`);
  });

  it('opens a creative mode in the play screen', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    await userEvent.click(screen.getByRole('button', { name: /^Robot Coder/ }));
    expect(await wentTo()).toBe(`play:/kids/${mia.id}/play?mode=robot`);
  });

  it('opens every other creative mode with its own mode parameter', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    for (const mode of ['story', 'experiment', 'detective', 'fixbot', 'invention', 'wonder', 'mission']) {
      await openHome(mia);
      const card = document.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
      if (!card) throw new Error(`no card for ${mode}`);
      await userEvent.click(card);
      expect(await wentTo()).toBe(`play:/kids/${mia.id}/play?mode=${mode}`);
      cleanup();
    }
  });

  it('opens the Imagination Studio idea picker, not the play screen', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    await userEvent.click(screen.getByRole('button', { name: /^Imagination Studio/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Imagination Studio' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}/studio`);
  });

  it('links to the rewards shelf and back to the profile picker', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    await userEvent.click(screen.getByRole('button', { name: /^My treasure shelf/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My treasure shelf' })).toBeInTheDocument();
    expect(where()).toBe(`/kids/${mia.id}/shelf`);
    await userEvent.click(screen.getByRole('button', { name: 'Back to my map' }));
    await screen.findByRole('heading', { level: 1, name: 'Hi, Mia!' });

    await userEvent.click(screen.getByRole('button', { name: 'Switch player' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is playing?' })).toBeInTheDocument();
    expect(where()).toBe('/kids');
  });

  it('has no skip control and no link out of the app', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll('a[href]')).toHaveLength(0);
  });
});

describe('home: parental controls', () => {
  it('hides the real-world mission when the parent switched missions off', async () => {
    await updateSettings((current) => ({ ...current, controls: { ...current.controls, realWorldMissions: false } }));
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    expect(document.querySelector('[data-mode="mission"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Real-World Mission/ })).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-mode]')).toHaveLength(8);
  });

  it("follows the child's own override of that control", async () => {
    await updateSettings((current) => ({ ...current, controls: { ...current.controls, realWorldMissions: false } }));
    const mia = await addChild({ nickname: 'Mia', controlsOverride: { realWorldMissions: true } });
    const leo = await addChild({ nickname: 'Leo' });
    await openHome(mia);
    expect(screen.getByRole('button', { name: /^Real-World Mission/ })).toBeInTheDocument();
    cleanup();
    await openHome(leo);
    expect(screen.queryByRole('button', { name: /^Real-World Mission/ })).not.toBeInTheDocument();
  });

  it('shows one world per enabled strand', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    expect([...document.querySelectorAll('[data-world]')].map((node) => node.getAttribute('data-world'))).toEqual([
      'math',
      'science',
      'technology',
      'engineering',
      'logic',
    ]);
    cleanup();

    await updateSettings((current) => ({
      ...current,
      controls: { ...current.controls, strands: { ...current.controls.strands, engineering: false, logic: false } },
    }));
    await openHome(mia);
    expect([...document.querySelectorAll('[data-world]')].map((node) => node.getAttribute('data-world'))).toEqual([
      'math',
      'science',
      'technology',
    ]);
  });
});

describe('home: adventure map and rewards', () => {
  it("draws each world's trail around the child's stage, with the avatar on the current stop", async () => {
    const mia = await addChild({ nickname: 'Mia', avatar: '🦊', grade: '2' });
    await db.skillStates.put(skillState(mia.id, 'counting', 'math', makeStage('3', 'strong')));
    await openHome(mia);

    const math = await screen.findByRole('button', { name: /^Number Peaks: Math\. You are at Grade 3, Strong\./ });
    expect(math).toHaveAccessibleName(/Next stop: Grade 4\.$/);
    expect(math.querySelectorAll('[data-stop="done"]')).toHaveLength(2);
    expect(math.querySelectorAll('[data-stop="ahead"]')).toHaveLength(1);
    expect(math.querySelectorAll('[data-stop="gate"]')).toHaveLength(1);
    const current = math.querySelectorAll('[data-stop="current"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('🦊');
    // The signpost names the grade in words.
    expect(within(math).getByText('Grade 3')).toBeInTheDocument();

    // A world nobody played yet starts at the enrolled grade.
    const science = screen.getByRole('button', { name: /^Wonder Jungle: Science\. A new world, starting at Grade 2\./ });
    expect(science.querySelectorAll('[data-stop="done"]')).toHaveLength(0);
    expect(within(science).getByText('Grade 2')).toBeInTheDocument();
  });

  it('shows the stars, the companion, and the streak flame from the second day on', async () => {
    const mia = await addChild({
      nickname: 'Mia',
      stars: 17,
      streakDays: 1,
      companion: { species: 'owl', name: 'Hoot', growth: 2, xp: 70 },
    });
    await openHome(mia);
    expect(screen.getByRole('img', { name: '17 stars' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /in a row/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My treasure shelf. Your companion: Hoot' })).toHaveTextContent('🐥');

    await updateChild(mia.id, { streakDays: 4 });
    expect(await screen.findByRole('img', { name: '4 days in a row' })).toBeInTheDocument();
  });
});

describe('home: read aloud and age', () => {
  it('reads the main line once for the youngest children, without the nickname, at their rate', async () => {
    const leo = await addChild({ nickname: 'Leonardo', ageGroup: '3-5', grade: 'PK', voiceRate: 0.8 });
    await openHome(leo);
    await waitFor(() => expect(voiceMock.speak).toHaveBeenCalledTimes(1));
    expect(voiceMock.speak).toHaveBeenCalledWith('Hi! Tap the big button to play!', { rate: 0.8 });
    expect(voiceMock.spoken().join(' ')).not.toContain('Leonardo');

    // A change on the screen does not read it again; the speaker button does.
    await updateChild(leo.id, { stars: 3 });
    await screen.findByRole('img', { name: '3 stars' });
    expect(voiceMock.speak).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(voiceMock.speak).toHaveBeenCalledTimes(2);

    cleanup();
    expect(voiceMock.stopSpeaking).toHaveBeenCalled();
  });

  it('uses fewer words for the youngest children', async () => {
    const leo = await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'PK' });
    await openHome(leo);
    expect(screen.getByText('Let’s play!')).toBeInTheDocument();
    expect(screen.queryByText('Snap blocks together to guide the robot home.')).not.toBeInTheDocument();
    expect(screen.queryByText('Tap a world to play there.')).not.toBeInTheDocument();
    cleanup();

    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    expect(screen.getByText('Snap blocks together to guide the robot home.')).toBeInTheDocument();
  });

  it('reads aloud for an older child only with the read-aloud setting', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openHome(mia);
    expect(voiceMock.speak).not.toHaveBeenCalled();
    cleanup();

    const zoe = await addChild({
      nickname: 'Zoe',
      accessibility: { dyslexiaFont: false, largeText: false, highContrast: false, reducedMotion: false, readAloud: true },
    });
    await openHome(zoe);
    await waitFor(() =>
      expect(voiceMock.spoken()).toEqual(['Hi! Where shall we explore today? Tap Keep exploring, or pick a world.']),
    );
  });

  it('never speaks, and offers no speaker button, when voice output is off for the child', async () => {
    const leo = await addChild({ nickname: 'Leo', ageGroup: '3-5', grade: 'PK', controlsOverride: { voiceOutput: false } });
    await openHome(leo);
    expect(screen.queryByRole('button', { name: 'Hear it' })).not.toBeInTheDocument();
    expect(voiceMock.speak).not.toHaveBeenCalled();
  });
});
