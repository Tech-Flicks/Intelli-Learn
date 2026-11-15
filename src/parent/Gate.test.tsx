import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, getSettings, listChildren } from '@/data';
import { hasAdminPassword, useParentGate } from '@/security';
import { countdownText } from './Gate';
import { addChild, freshDevice, renderParent, sampleLibraryItem, TEST_PASSWORD } from './testSupport';

async function tryPassword(password: string): Promise<void> {
  const field = screen.getByLabelText('Parent password');
  await waitFor(() => expect(field).toBeEnabled());
  await userEvent.type(field, password);
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
}

describe('parent gate', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true, unlocked: false });
    await addChild({ nickname: 'Mia' });
  });

  it('formats the countdown as minutes and seconds', () => {
    expect(countdownText(30_000)).toBe('0:30');
    expect(countdownText(64_200)).toBe('1:05');
    expect(countdownText(-5)).toBe('0:00');
  });

  it('shows the tries that are left, then locks with a running countdown', async () => {
    renderParent('/parent');
    await screen.findByRole('heading', { name: 'Parent area' });
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();

    await tryPassword('not it 1');
    expect(await screen.findByText('That password is not right. 4 tries left before a short lock.')).toBeInTheDocument();
    await tryPassword('not it 2');
    expect(await screen.findByText('That password is not right. 3 tries left before a short lock.')).toBeInTheDocument();
    await tryPassword('not it 3');
    await screen.findByText(/2 tries left/);
    await tryPassword('not it 4');
    expect(await screen.findByText('That password is not right. 1 try left before a short lock.')).toBeInTheDocument();
    await tryPassword('not it 5');

    const countdown = await screen.findByTestId('gate-countdown');
    expect(screen.getByText('Too many wrong tries.')).toBeInTheDocument();
    expect(countdown.textContent).toMatch(/^0:(30|2\d)$/);
    expect(screen.getByLabelText('Parent password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
    expect(useParentGate.getState().unlocked).toBe(false);

    // The countdown is live.
    const first = countdown.textContent;
    await waitFor(() => expect(screen.getByTestId('gate-countdown').textContent).not.toBe(first), { timeout: 4000 });
  }, 20_000);

  it('shows a lockout that is still running when the gate opens again', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await useParentGate.getState().unlock('nope nope');
    renderParent('/parent');
    expect(await screen.findByTestId('gate-countdown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('opens the parent area with the right password and locks it again on request', async () => {
    renderParent('/parent');
    await screen.findByRole('heading', { name: 'Parent area' });
    await tryPassword(TEST_PASSWORD);

    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    expect(useParentGate.getState().unlocked).toBe(true);
    expect(await screen.findByRole('link', { name: /See Mia.s details/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await screen.findByLabelText('Parent password');
    expect(useParentGate.getState().unlocked).toBe(false);
  });

  it('locks the parent area when the parent goes to the kids’ area', async () => {
    await useParentGate.getState().unlock(TEST_PASSWORD);
    renderParent('/parent');
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    await userEvent.click(screen.getByRole('button', { name: /Kids. area/ }));
    await waitFor(() => expect(screen.getByTestId('elsewhere')).toHaveTextContent('kids:/kids'));
    await waitFor(() => expect(useParentGate.getState().unlocked).toBe(false));
  });

  it('offers a full reset for a forgotten password, behind a typed confirmation', async () => {
    await db.library.put(sampleLibraryItem('lib-1'));
    renderParent('/parent');
    await screen.findByRole('heading', { name: 'Parent area' });
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Reset everything?' });
    expect(within(dialog).getByText(/A forgotten password cannot be recovered/)).toBeInTheDocument();
    expect(within(dialog).getByText(/deletes every child profile/)).toBeInTheDocument();

    // Without the word, nothing is deleted.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset everything' }));
    expect(await within(dialog).findByText('Type RESET exactly to go on.')).toBeInTheDocument();
    expect(await listChildren()).toHaveLength(1);

    await userEvent.type(within(dialog).getByLabelText('Type RESET to confirm'), 'reset');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset everything' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/setup'));
    await screen.findByRole('heading', { name: 'Welcome to Intelli-Learn' });
    expect(await listChildren()).toHaveLength(0);
    expect(await db.library.count()).toBe(0);
    expect(await hasAdminPassword()).toBe(false);
    expect((await getSettings()).setupComplete).toBe(false);
  });

  it('sends a device without setup to the wizard', async () => {
    await freshDevice();
    renderParent('/parent/settings');
    await screen.findByRole('heading', { name: 'Welcome to Intelli-Learn' });
    expect(screen.getByTestId('where')).toHaveTextContent('/setup');
  });
});
