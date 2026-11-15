import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STRANDS } from '@/core/types';
import { getSettings, listChildren } from '@/data';
import { strandName } from '@/i18n';
import { hasAdminPassword, hasApiKey, useParentGate } from '@/security';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { SetupWizard } from './index';
import { freshDevice, renderParent, TEST_PASSWORD } from './testSupport';

const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }));

async function reachPasswordStep(): Promise<void> {
  renderParent('/setup');
  await screen.findByRole('heading', { name: 'Welcome to Intelli-Learn' });
  await userEvent.click(screen.getByRole('button', { name: /^Let.s start$/ }));
  await screen.findByRole('heading', { name: 'Choose a parent password' });
}

async function enterPasswords(password: string, confirm: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/^New password/), password);
  await userEvent.type(screen.getByLabelText(/^Repeat the password/), confirm);
}

describe('setup wizard', () => {
  beforeEach(async () => {
    await freshDevice();
  });

  it('walks through every step in Demo mode and only then marks the device as set up', async () => {
    await reachPasswordStep();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Step 2 of 6: Password');
    await enterPasswords(TEST_PASSWORD, TEST_PASSWORD);
    await next();

    await screen.findByRole('heading', { name: 'Connect an AI (optional)' });
    expect(screen.getByRole('radio', { name: /Demo mode \(no AI key needed\)/ })).toBeChecked();
    expect(screen.getByText(/In Demo mode the app works fully offline/)).toBeInTheDocument();
    await next();

    await screen.findByRole('heading', { name: 'Set the family rules' });
    // No image model in Demo mode: the AI pictures switch is off and says why.
    const pictures = screen.getByRole('switch', { name: 'AI pictures' });
    expect(pictures).toBeDisabled();
    expect(screen.getByText(/no image model is set/)).toBeInTheDocument();
    await next();

    await screen.findByRole('heading', { name: 'Add your first child' });
    // Nothing counts as finished before the last step.
    expect((await getSettings()).setupComplete).toBe(false);
    expect(await hasAdminPassword()).toBe(false);
    expect(await listChildren()).toHaveLength(0);

    await userEvent.type(screen.getByLabelText(/^Nickname/), 'Mia');
    await userEvent.click(screen.getByRole('radio', { name: 'Avatar 🦄' }));
    await userEvent.selectOptions(screen.getByLabelText('School grade'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Dinosaurs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

    await screen.findByRole('heading', { name: 'All set!' }, { timeout: 8000 });
    const settings = await getSettings();
    expect(settings.setupComplete).toBe(true);
    expect(settings.ai.provider).toBe('demo');
    expect(await hasAdminPassword()).toBe(true);
    expect(await hasApiKey()).toBe(false);
    const children = await listChildren();
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ nickname: 'Mia', avatar: '🦄', grade: '1', interests: ['dinosaurs'] });
    expect(screen.getByText(/Profile for Mia/)).toBeInTheDocument();

    // The wizard leaves the parent signed in: the parent area opens without the gate.
    await userEvent.click(screen.getByRole('button', { name: 'Open parent area' }));
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    expect(screen.getByTestId('where')).toHaveTextContent('/parent');
  }, 20_000);

  it('locks the gate when the last step is left by the back button instead of its two buttons', async () => {
    function BackButton() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate(-1)}>
          device back
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={['/kids', '/setup']} initialIndex={1}>
        <BackButton />
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/kids" element={<p>Who is playing?</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Welcome to Intelli-Learn' });
    await userEvent.click(screen.getByRole('button', { name: /^Let.s start$/ }));
    await screen.findByRole('heading', { name: 'Choose a parent password' });
    await enterPasswords(TEST_PASSWORD, TEST_PASSWORD);
    await next();
    await screen.findByRole('heading', { name: 'Connect an AI (optional)' });
    await next();
    await screen.findByRole('heading', { name: 'Set the family rules' });
    await next();
    await screen.findByRole('heading', { name: 'Add your first child' });
    await userEvent.type(screen.getByLabelText(/^Nickname/), 'Mia');
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await screen.findByRole('heading', { name: 'All set!' }, { timeout: 8000 });

    // The device goes to the child without "Play" being pressed.
    await userEvent.click(screen.getByRole('button', { name: 'device back' }));
    await screen.findByText('Who is playing?');
    await waitFor(() => expect(useParentGate.getState().unlocked).toBe(false));
  }, 20_000);

  it('does not go on when the two passwords differ', async () => {
    await reachPasswordStep();
    await enterPasswords(TEST_PASSWORD, 'correct house');
    await next();
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose a parent password' })).toBeInTheDocument();

    // A password that is too short is refused as well.
    await userEvent.clear(screen.getByLabelText(/^New password/));
    await userEvent.clear(screen.getByLabelText(/^Repeat the password/));
    await enterPasswords('abc', 'abc');
    await next();
    expect(await screen.findByText('Use at least 6 characters.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connect an AI (optional)' })).not.toBeInTheDocument();
    expect(await hasAdminPassword()).toBe(false);
  });

  it('does not go on when every subject is switched off', async () => {
    await reachPasswordStep();
    await enterPasswords(TEST_PASSWORD, TEST_PASSWORD);
    await next();
    await screen.findByRole('heading', { name: 'Connect an AI (optional)' });
    await next();
    await screen.findByRole('heading', { name: 'Set the family rules' });

    for (const strand of STRANDS) await userEvent.click(screen.getByRole('switch', { name: strandName(strand) }));
    await next();
    expect(await screen.findByText('Keep at least one subject switched on.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Set the family rules' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: strandName('logic') }));
    await next();
    await screen.findByRole('heading', { name: 'Add your first child' });

    // A child needs a nickname.
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(await screen.findByText('Enter a nickname.')).toBeInTheDocument();
    expect((await getSettings()).setupComplete).toBe(false);
  });

  it('asks for the service details when a real AI is chosen, and keeps the key out of sight', async () => {
    await reachPasswordStep();
    await enterPasswords(TEST_PASSWORD, TEST_PASSWORD);
    await next();
    await screen.findByRole('heading', { name: 'Connect an AI (optional)' });

    await userEvent.click(screen.getByRole('radio', { name: /OpenAI or compatible service/ }));
    expect(screen.getByLabelText(/^Service address/)).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByText(/http:\/\/localhost:11434\/v1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^API key/)).toHaveAttribute('type', 'password');
    expect(screen.getByText(/A ChatGPT subscription .* is not an API key/)).toBeInTheDocument();
    expect(screen.getByText(/setting a monthly spending limit/)).toBeInTheDocument();
    await next();
    expect(await screen.findByText(/Enter the API key of the service/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connect an AI (optional)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Proxy on my server/ }));
    expect(screen.queryByLabelText(/^API key/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Proxy address/)).not.toHaveValue('');
  });

  it('sends a device that is already set up to the parent area', async () => {
    await freshDevice({ setup: true, unlocked: false });
    renderParent('/setup');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/parent'));
    expect(useParentGate.getState().unlocked).toBe(false);
    const gate = await screen.findByRole('heading', { name: 'Parent area' });
    expect(within(gate.closest('div') as HTMLElement).getByText(/Enter the parent password/)).toBeInTheDocument();
  });
});
