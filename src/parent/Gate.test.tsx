import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, getSettings, listChildren } from '@/data';
import { getResetRequest, hasAdminPassword, requestReset, RESET_REQUEST_KEY, RESET_WAIT_MS, useParentGate } from '@/security';
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

  it('"Forgot password?" deletes nothing: it only starts a 24-hour wait', async () => {
    await db.library.put(sampleLibraryItem('lib-1'));
    renderParent('/parent');
    await screen.findByRole('heading', { name: 'Parent area' });
    await userEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Forgot the password?' });
    expect(within(dialog).getByText(/A forgotten password cannot be recovered/)).toBeInTheDocument();
    expect(within(dialog).getByText(/deletes every child profile/)).toBeInTheDocument();
    expect(within(dialog).getByText(/waiting time of 24 hours/)).toBeInTheDocument();
    // No word to type and no way to delete anything from here.
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset everything' })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Start the 24-hour wait' }));

    const notice = await screen.findByTestId('gate-reset-request');
    expect(within(notice).getByText('A full reset has been asked for.')).toBeInTheDocument();
    expect(within(notice).getByText(/Enter the parent password. That cancels the reset/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset everything' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    const request = await getResetRequest();
    expect(request).not.toBeNull();
    expect(request!.readyAt - request!.requestedAt).toBe(RESET_WAIT_MS);
    expect(await listChildren()).toHaveLength(1);
    expect(await db.library.count()).toBe(1);
    expect(await hasAdminPassword()).toBe(true);
    expect(screen.getByTestId('where')).not.toHaveTextContent('/setup');
  });

  it('keeps showing a running wait, without a way to finish it early', async () => {
    await db.kv.put({ key: RESET_REQUEST_KEY, value: { requestedAt: Date.now() - RESET_WAIT_MS + 60_000 } });
    renderParent('/parent');
    const notice = await screen.findByTestId('gate-reset-request');
    expect(within(notice).getByText('A full reset has been asked for.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset everything' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
    expect(await listChildren()).toHaveLength(1);
  });

  it('the right password cancels a requested reset', async () => {
    await db.kv.put({ key: RESET_REQUEST_KEY, value: { requestedAt: Date.now() - 2 * RESET_WAIT_MS } });
    renderParent('/parent');
    await screen.findByTestId('gate-reset-request');
    await tryPassword(TEST_PASSWORD);
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    expect(await getResetRequest()).toBeNull();
    expect(await listChildren()).toHaveLength(1);
  });

  it('does not offer "Forgot password?" while the gate is locked after wrong tries', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await useParentGate.getState().unlock('nope nope');
    renderParent('/parent');
    await screen.findByTestId('gate-countdown');
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeDisabled();
    expect((await requestReset()).ok).toBe(false);
    expect(await getResetRequest()).toBeNull();
  });

  it('after the wait, offers the full reset behind a typed confirmation', async () => {
    await db.library.put(sampleLibraryItem('lib-1'));
    await db.kv.put({ key: RESET_REQUEST_KEY, value: { requestedAt: Date.now() - RESET_WAIT_MS - 1000 } });
    renderParent('/parent');
    await screen.findByRole('heading', { name: 'Parent area' });
    const notice = await screen.findByTestId('gate-reset-request');
    expect(within(notice).getByText('The waiting time is over.')).toBeInTheDocument();
    await userEvent.click(within(notice).getByRole('button', { name: 'Reset everything' }));

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
    expect(await getResetRequest()).toBeNull();
  });

  it('sends a device without setup to the wizard', async () => {
    await freshDevice();
    renderParent('/parent/settings');
    await screen.findByRole('heading', { name: 'Welcome to Intelli-Learn' });
    expect(screen.getByTestId('where')).toHaveTextContent('/setup');
  });
});
