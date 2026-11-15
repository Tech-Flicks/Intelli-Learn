import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STRANDS } from '@/core/types';
import { db, getSettings, listChildren, type BackupFile } from '@/data';
import { strandName } from '@/i18n';
import { getApiKey, hasAdminPassword, hasApiKey, setApiKey, useParentGate } from '@/security';
import { addChild, freshDevice, renderParent, sampleLibraryItem, seedAttempt, TEST_PASSWORD } from './testSupport';

const testConnection = vi.hoisted(() => vi.fn());
const savedBackups = vi.hoisted(() => [] as { file: unknown; filename: string | undefined }[]);

vi.mock('@/ai', async (original) => ({
  ...(await original<typeof import('@/ai')>()),
  testConnection,
}));

// The download itself is browser glue: keep the file that would have been saved.
vi.mock('@/data', async (original) => ({
  ...(await original<typeof import('@/data')>()),
  downloadBackup: (file: unknown, filename?: string) => {
    savedBackups.push({ file, filename });
  },
}));

async function openSection(section: string, heading: string): Promise<void> {
  renderParent(`/parent/settings?section=${section}`);
  await screen.findByRole('heading', { name: heading, level: 2 });
}

describe('settings: parental controls', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
  });

  it('saves changed controls only when Save is pressed, and says so', async () => {
    await openSection('controls', 'Parental controls');
    const save = screen.getByRole('button', { name: 'Save controls' });
    expect(save).toBeDisabled();

    const minutes = screen.getByRole('spinbutton', { name: /Daily play time/ });
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '45');
    await userEvent.selectOptions(screen.getByLabelText('Play allowed from'), '9');
    await userEvent.click(screen.getByRole('switch', { name: 'Microphone' }));
    expect(screen.getByText(/Speech recognition is done by the browser/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: strandName('engineering') }));
    await userEvent.click(screen.getByRole('radio', { name: /Standard/ }));

    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
    expect((await getSettings()).controls.dailyMinutes).toBe(30);

    await userEvent.click(save);
    expect(await screen.findByText('Parental controls saved.')).toBeInTheDocument();
    const { controls } = await getSettings();
    expect(controls).toMatchObject({ dailyMinutes: 45, allowedStartHour: 9, microphone: true, strictness: 'standard' });
    expect(controls.strands.engineering).toBe(false);
    expect(controls.strands.math).toBe(true);
    await waitFor(() => expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument());
  });

  it('refuses controls without a subject or with impossible play time', async () => {
    await openSection('controls', 'Parental controls');
    for (const strand of STRANDS) await userEvent.click(screen.getByRole('switch', { name: strandName(strand) }));
    const minutes = screen.getByRole('spinbutton', { name: /Daily play time/ });
    await userEvent.clear(minutes);
    await userEvent.click(screen.getByRole('button', { name: 'Save controls' }));

    expect(await screen.findByText('Keep at least one subject switched on.')).toBeInTheDocument();
    expect(screen.getByText('Please fix the marked fields first.')).toBeInTheDocument();
    const { controls } = await getSettings();
    expect(controls.dailyMinutes).toBe(30);
    expect(controls.strands.math).toBe(true);
  });

  it('asks before leaving a form with unsaved changes', async () => {
    await openSection('controls', 'Parental controls');
    await userEvent.click(screen.getByRole('switch', { name: 'Microphone' }));

    await userEvent.click(screen.getByRole('link', { name: 'Overview' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/parent/settings?section=controls');
    expect(screen.getByRole('switch', { name: 'Microphone' })).toBeChecked();

    // Another settings section is guarded the same way.
    await userEvent.click(screen.getByRole('tab', { name: /Language/ }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave without saving' }));
    await screen.findByRole('heading', { name: 'Language', level: 2 });
    expect((await getSettings()).controls.microphone).toBe(false);
  });
});

describe('settings: AI connection', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    testConnection.mockReset();
  });

  it('tests with the typed values, shows the answer word for word and never shows a saved key', async () => {
    testConnection.mockResolvedValueOnce({ ok: false, message: 'The service refused the key (401). Check that it was copied completely.', latencyMs: 80 });
    testConnection.mockResolvedValueOnce({ ok: true, message: 'Connected. The model answered in 120 ms.', latencyMs: 120 });
    await openSection('ai', 'AI connection');

    await userEvent.click(screen.getByRole('radio', { name: /OpenAI or compatible service/ }));
    await userEvent.type(screen.getByLabelText(/^API key/), 'sk-test-12345');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() =>
      expect(screen.getByTestId('ai-test-message')).toHaveTextContent('The service refused the key (401). Check that it was copied completely.'),
    );
    expect(screen.getByText('Not working yet')).toBeInTheDocument();
    expect(testConnection).toHaveBeenLastCalledWith({
      provider: 'direct',
      baseUrl: 'https://api.openai.com/v1',
      chatModel: 'gpt-4o-mini',
      apiKey: 'sk-test-12345',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(screen.getByTestId('ai-test-message')).toHaveTextContent('Connected. The model answered in 120 ms.'));
    expect(screen.getByText('It works')).toBeInTheDocument();
    // Testing saves nothing.
    expect((await getSettings()).ai.provider).toBe('demo');
    expect(await hasApiKey()).toBe(false);

    const daily = screen.getByRole('spinbutton', { name: /AI requests per day/ });
    await userEvent.clear(daily);
    await userEvent.type(daily, '25');
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByText('AI settings saved.')).toBeInTheDocument();

    const { ai } = await getSettings();
    expect(ai).toMatchObject({ provider: 'direct', baseUrl: 'https://api.openai.com/v1', chatModel: 'gpt-4o-mini', dailyRequestBudget: 25 });
    expect(await getApiKey()).toBe('sk-test-12345');

    // From now on the key is only reported as saved.
    expect(await screen.findByText('A key is saved on this device.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^API key/)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('sk-test-12345');
    expect(JSON.stringify(await getSettings())).not.toContain('sk-test-12345');
  });

  it('removes a saved key on request when the mode no longer needs it', async () => {
    await setApiKey('sk-old-key');
    await openSection('ai', 'AI connection');
    expect(await screen.findByText(/A key saved earlier is still on this device/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByText('AI settings saved.')).toBeInTheDocument();
    expect(await hasApiKey()).toBe(false);
  });

  it('needs a real address, and a key unless the service is on the local network', async () => {
    await openSection('ai', 'AI connection');
    await userEvent.click(screen.getByRole('radio', { name: /OpenAI or compatible service/ }));
    await userEvent.clear(screen.getByLabelText(/^Service address/));
    await userEvent.type(screen.getByLabelText(/^Service address/), 'api.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByText(/Enter an address that starts with http/)).toBeInTheDocument();
    expect((await getSettings()).ai.provider).toBe('demo');

    await userEvent.clear(screen.getByLabelText(/^Service address/));
    await userEvent.type(screen.getByLabelText(/^Service address/), 'https://api.example.com/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByText(/Enter the API key of the service/)).toBeInTheDocument();
    expect((await getSettings()).ai.provider).toBe('demo');

    // A model on the parent's own computer needs no key.
    await userEvent.clear(screen.getByLabelText(/^Service address/));
    await userEvent.type(screen.getByLabelText(/^Service address/), 'http://localhost:11434/v1/');
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect(await screen.findByText('AI settings saved.')).toBeInTheDocument();
    expect((await getSettings()).ai).toMatchObject({ provider: 'direct', baseUrl: 'http://localhost:11434/v1' });
  });
});

describe('settings: language and password', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
  });

  it('saves the two languages', async () => {
    await openSection('language', 'Language');
    await userEvent.selectOptions(screen.getByLabelText('Challenge language'), 'es');
    await userEvent.click(screen.getByRole('button', { name: 'Save language' }));
    expect(await screen.findByText('Language saved.')).toBeInTheDocument();
    expect(await getSettings()).toMatchObject({ locale: 'en', contentLocale: 'es' });
  });

  it('changes the password only with the current one', async () => {
    await openSection('password', 'Parent password');
    await userEvent.type(screen.getByLabelText(/^Current password/), 'not the one');
    await userEvent.type(screen.getByLabelText(/^New password/), 'a brand new one');
    await userEvent.type(screen.getByLabelText(/^Repeat the password/), 'a brand new one');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/That password is not right\. 4 tries left/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Current password/), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The password was changed.', undefined, { timeout: 8000 })).toBeInTheDocument();

    useParentGate.getState().lock();
    expect((await useParentGate.getState().unlock(TEST_PASSWORD)).ok).toBe(false);
    expect((await useParentGate.getState().unlock('a brand new one')).ok).toBe(true);
  }, 20_000);
});

describe('settings: backup, restore and reset', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    savedBackups.length = 0;
  });

  it('exports everything and restores it through the file picker', async () => {
    const mia = await addChild({ nickname: 'Mia', interests: ['space', 'robots'] });
    await db.library.put(sampleLibraryItem('lib-1', { seenBy: [mia.id], uses: 1 }));
    await seedAttempt(mia.id, { id: 'ch-1', libraryId: 'lib-1' });
    await openSection('backup', 'Back up everything');

    await userEvent.click(screen.getByRole('button', { name: 'Download backup' }));
    expect(await screen.findByText('The backup file was saved.')).toBeInTheDocument();
    expect(savedBackups).toHaveLength(1);
    const backup = savedBackups[0]?.file as BackupFile;
    const text = JSON.stringify(backup);
    expect(text).toContain('Mia');
    // Neither the password hash nor anything about the AI key travels in a backup.
    const auth = (await getSettings()).auth;
    expect(auth).not.toBeNull();
    if (auth) expect(text).not.toContain(auth.hash);

    // The device loses the child, then gets everything back from the file.
    await db.children.clear();
    await db.challenges.clear();
    await db.attempts.clear();
    await db.messages.clear();
    await db.library.clear();
    expect(await listChildren()).toHaveLength(0);

    const restore = screen.getByRole('button', { name: 'Restore' });
    expect(restore).toBeDisabled();
    const file = new File([text], 'intelli-learn-backup.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Backup file'), file);
    expect(screen.getByRole('radio', { name: /Add to what is here/ })).toBeChecked();
    await userEvent.click(restore);

    const dialog = await screen.findByRole('alertdialog', { name: 'Add the backup to this device?' });
    expect(within(dialog).getByText('intelli-learn-backup.json')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Restore finished')).toBeInTheDocument();
    expect(screen.getByText('Children: 1')).toBeInTheDocument();
    expect(screen.getByText('Library canvases: 1')).toBeInTheDocument();
    const children = await listChildren();
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ id: mia.id, nickname: 'Mia', interests: ['space', 'robots'] });
    expect(await db.challenges.get('ch-1')).toMatchObject({ childId: mia.id, libraryId: 'lib-1' });
    expect(await db.attempts.count()).toBe(1);
    expect(await db.messages.count()).toBe(2);
    expect(await db.library.get('lib-1')).toMatchObject({ seenBy: [mia.id] });
    // The password of this device is untouched.
    expect(await hasAdminPassword()).toBe(true);
  });

  it('replaces what is on the device when asked to, after a warning', async () => {
    const mia = await addChild({ nickname: 'Mia' });
    await openSection('backup', 'Back up everything');
    await userEvent.click(screen.getByRole('button', { name: 'Download backup' }));
    await screen.findByText('The backup file was saved.');
    const text = JSON.stringify(savedBackups[0]?.file);

    const leo = await addChild({ nickname: 'Leo' });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Backup file'), file);
    await userEvent.click(screen.getByRole('radio', { name: /Replace what is here/ }));
    expect(screen.getByText(/Replace removes every child on this device first/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Replace everything on this device?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Restore finished')).toBeInTheDocument();
    const ids = (await listChildren()).map((child) => child.id);
    expect(ids).toEqual([mia.id]);
    expect(ids).not.toContain(leo.id);
  });

  it('explains a file that is not a backup and changes nothing', async () => {
    await addChild({ nickname: 'Mia' });
    await openSection('backup', 'Back up everything');
    const file = new File(['{"hello":"world"}'], 'notes.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Backup file'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('The file could not be restored. Nothing was changed.')).toBeInTheDocument();
    expect(await listChildren()).toHaveLength(1);
  });

  it('resets the whole app from the danger zone after RESET was typed', async () => {
    await addChild({ nickname: 'Mia' });
    await openSection('danger', 'Reset the app');
    await userEvent.click(screen.getByRole('button', { name: 'Reset everything' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Reset the whole app?' });
    await userEvent.type(within(dialog).getByLabelText('Type RESET to confirm'), 'RESET');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset everything' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/setup'));
    expect(await listChildren()).toHaveLength(0);
    expect(await hasAdminPassword()).toBe(false);
    expect(useParentGate.getState().unlocked).toBe(false);
  });

  it('lists what is stored and what is sent, without any link out of the app', async () => {
    await openSection('about', 'About Intelli-Learn');
    expect(screen.getByText('The child’s nickname or avatar.')).toBeInTheDocument();
    expect(screen.getByText(/Right now the app is in Demo mode/)).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).queryAllByRole('link')).toHaveLength(0);
  });
});
