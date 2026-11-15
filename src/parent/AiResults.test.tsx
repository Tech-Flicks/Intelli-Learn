import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { db, recordUsage, updateSettings } from '@/data';
import type { AiLogEntry } from '@/ai';
import { freshDevice, renderParent } from './testSupport';

function entry(patch: Partial<AiLogEntry>): AiLogEntry {
  return { at: Date.now(), task: 'challenge', kind: 'choice', model: 'tiny-model', outcome: 'ok', message: '', ms: 900, ...patch };
}

async function directMode(): Promise<void> {
  await updateSettings({ ai: { provider: 'direct', baseUrl: 'http://localhost:11434/v1', chatModel: 'tiny-model' } } as never);
}

describe('parent area: last AI results', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
  });

  it('says how many of today\'s challenges came from the AI, why the others did not, and how many tokens were used', async () => {
    await directMode();
    const cutOff = 'The answer of the AI model was cut off before it was complete, also with a higher limit.';
    await db.kv.put({
      key: 'ai:recent',
      value: [
        entry({ at: Date.now() - 4000 }),
        entry({ at: Date.now() - 3000, outcome: 'truncated', message: cutOff }),
        entry({ at: Date.now() - 2000, outcome: 'truncated', message: cutOff }),
        entry({ at: Date.now() - 1000, outcome: 'validation', message: 'The challenge cannot be solved: hints[2] gives the answer away.' }),
      ],
    });
    await recordUsage({ requests: 9, promptTokens: 12345, completionTokens: 678 });

    renderParent('/parent/settings?section=ai');
    const results = await screen.findByTestId('ai-results');
    expect(within(results).getByRole('heading', { name: 'Last AI results' })).toBeInTheDocument();
    expect(within(results).getByText(/Today 1 of 4 challenges came from the AI\./)).toBeInTheDocument();
    expect(within(results).getByText(/Most common problem \(2 times\): The answer of the AI model was cut off/)).toBeInTheDocument();
    expect(await within(results).findByText(/Tokens today: 12,345 sent, 678 received\./)).toBeInTheDocument();
    expect(within(results).getByText('The challenge cannot be solved: hints[2] gives the answer away.')).toBeInTheDocument();
    // Three failures in a row: generation is paused, and the parent is told.
    expect(within(results).getByText(/could not build the last 3 challenges, so it is not asked again until/)).toBeInTheDocument();
  });

  it('does not call the AI "on" without a warning on the overview while its last challenges all failed', async () => {
    await directMode();
    await db.kv.put({
      key: 'ai:recent',
      value: [1, 2, 3].map((n) => entry({ at: Date.now() - n * 1000, outcome: 'format', message: 'The reply was not valid JSON.' })),
    });
    renderParent('/parent');
    expect(await screen.findByText(/but the last 3 could not be built by the AI/)).toBeInTheDocument();
    expect(screen.queryByText('AI challenges are on, using the model “tiny-model”.')).not.toBeInTheDocument();
  });

  it('shows no results in Demo mode', async () => {
    renderParent('/parent/settings?section=ai');
    await screen.findByText('Usage on this device');
    expect(screen.queryByTestId('ai-results')).not.toBeInTheDocument();
  });
});
