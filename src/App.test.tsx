import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AccessibilitySettings } from '@/core/types';
import { createChild, db, updateChild, updateSettings } from '@/data';
import { getLocale, setLocale } from '@/i18n';

// The route modules are owned by other teams; the shell is tested with stand-ins.
vi.mock('@/parent', () => ({
  SetupWizard: () => <div>setup wizard</div>,
  ParentArea: () => <div>parent area</div>,
}));
vi.mock('@/child', () => ({ ChildArea: () => <div>child area</div> }));
vi.mock('@/play', () => ({ PlayScreen: () => <div>play screen</div> }));

import { App } from './App';

const A11Y_OFF: AccessibilitySettings = { dyslexiaFont: false, largeText: false, highContrast: false, reducedMotion: false, readAloud: false };

function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function a11yClasses(): string[] {
  return [...document.documentElement.classList].filter((name) => name.startsWith('a11y-')).sort();
}

async function finishSetup(): Promise<void> {
  await updateSettings((current) => ({ ...current, setupComplete: true }));
}

beforeEach(async () => {
  // A brand-new device: no settings record yet.
  await db.delete();
  await db.open();
  setLocale('en');
});

afterEach(() => {
  cleanup();
});

describe('App shell', () => {
  it('sends a first-time visitor to setup, and keeps the child routes closed until setup is done', async () => {
    show('/');
    expect(await screen.findByText('setup wizard')).toBeInTheDocument();
    // The first visit stored the default settings (outside the live queries, which may only read).
    await waitFor(async () => expect(await db.settings.get('app')).toMatchObject({ id: 'app', setupComplete: false }));
    cleanup();

    show('/kids');
    expect(await screen.findByText('setup wizard')).toBeInTheDocument();
    cleanup();

    show('/kids/some-child/play');
    expect(await screen.findByText('setup wizard')).toBeInTheDocument();
    expect(screen.queryByText('play screen')).not.toBeInTheDocument();
  });

  it('opens the profile picker after setup, and the play screen on its own route', async () => {
    await finishSetup();
    show('/');
    expect(await screen.findByText('child area')).toBeInTheDocument();
    cleanup();

    show('/kids/some-child/play?mode=robot');
    expect(await screen.findByText('play screen')).toBeInTheDocument();
    cleanup();

    show('/no/such/page');
    expect(await screen.findByText('child area')).toBeInTheDocument();
  });

  it('uses the interface language the parent chose, and follows a change', async () => {
    await finishSetup();
    await updateSettings((current) => ({ ...current, locale: 'es' }));
    show('/kids');
    await waitFor(() => expect(getLocale()).toBe('es'));
    expect(document.documentElement.lang).toBe('es');

    await updateSettings((current) => ({ ...current, locale: 'hi' }));
    await waitFor(() => expect(getLocale()).toBe('hi'));
    expect(document.documentElement.lang).toBe('hi');
  });

  it("applies the active child's accessibility settings on every child route, and follows a change", async () => {
    await finishSetup();
    const child = await createChild({ nickname: 'Mira', avatar: '🐼', ageGroup: '6-8', grade: '2', interests: [] });
    await updateChild(child.id, { accessibility: { ...A11Y_OFF, dyslexiaFont: true, reducedMotion: true } });

    show(`/kids/${child.id}/play`);
    await waitFor(() => expect(a11yClasses()).toEqual(['a11y-calm', 'a11y-dyslexia']));
    cleanup();
    expect(a11yClasses()).toEqual([]);

    show(`/kids/${child.id}`);
    await waitFor(() => expect(a11yClasses()).toEqual(['a11y-calm', 'a11y-dyslexia']));
    await updateChild(child.id, { accessibility: { ...A11Y_OFF, highContrast: true, largeText: true } });
    await waitFor(() => expect(a11yClasses()).toEqual(['a11y-contrast', 'a11y-large']));
  });

  it('clears the accessibility classes on the profile picker and in the parent area', async () => {
    await finishSetup();
    const child = await createChild({ nickname: 'Leo', avatar: '🦊', ageGroup: '9-11', grade: '4', interests: [] });
    await updateChild(child.id, { accessibility: { ...A11Y_OFF, highContrast: true } });

    document.documentElement.classList.add('a11y-contrast');
    show('/kids');
    expect(await screen.findByText('child area')).toBeInTheDocument();
    await waitFor(() => expect(a11yClasses()).toEqual([]));
    cleanup();

    document.documentElement.classList.add('a11y-large');
    show('/parent/settings');
    expect(await screen.findByText('parent area')).toBeInTheDocument();
    await waitFor(() => expect(a11yClasses()).toEqual([]));
  });

  it('mounts one live region for toasts', async () => {
    await finishSetup();
    show('/kids');
    await screen.findByText('child area');
    expect(document.querySelectorAll('[data-toast-viewport]')).toHaveLength(1);
  });
});
