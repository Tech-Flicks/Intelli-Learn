import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dayKey } from '@/core/grades';
import type { ChildProfile, SkillState } from '@/core/types';
import { db, updateSettings } from '@/data';
import { weekStartOf } from '@/progression';
import { addChild, freshDevice, renderParent, seedAttempt } from '../testSupport';

const ai = vi.hoisted(() => ({ generateWeeklyReport: vi.fn(), getAiStatus: vi.fn() }));

vi.mock('@/ai', async (original) => ({
  ...(await original<typeof import('@/ai')>()),
  generateWeeklyReport: ai.generateWeeklyReport,
  getAiStatus: ai.getAiStatus,
}));

const SKILL = 'math-counting-cardinality';

let mia: ChildProfile;

function skillState(childId: string, patch: Partial<SkillState> = {}): SkillState {
  return {
    id: `${childId}:${SKILL}`,
    childId,
    skillId: SKILL,
    strand: 'math',
    stage: 9,
    mastery: 62,
    assistedStreak: 0,
    independentStreak: 3,
    attempts: 6,
    checkPending: true,
    checksPassed: 2,
    recentInteractions: ['number'],
    lastPracticedAt: Date.now() - 3_600_000,
    reviewDueAt: null,
    reviewIntervalDays: 2,
    ...patch,
  };
}

async function seedProgress(): Promise<void> {
  const now = Date.now();
  await db.skillStates.put(skillState(mia.id));
  await db.stageChanges.bulkPut([
    { id: 'sc-1', childId: mia.id, skillId: null, strand: 'math', from: 6, to: 8, reason: 'placement', at: now - 10 * 86_400_000 },
    { id: 'sc-2', childId: mia.id, skillId: null, strand: 'math', from: 8, to: 9, reason: 'mastery', at: now - 2 * 86_400_000 },
  ]);
  await db.learnerNotes.put({
    childId: mia.id,
    summary: 'Counts confidently to 100.',
    strengths: ['Counting on from any number'],
    struggles: ['Skip-counting by fives'],
    nextFocus: ['Counting in steps'],
    attemptsAtUpdate: 6,
    updatedAt: now - 86_400_000,
  });
  await db.rewards.put({ id: 'rw-1', childId: mia.id, kind: 'badge', key: 'first-spark', amount: 0, reason: 'First challenge solved', at: now - 5000 });
  await db.sessions.put({ id: 'ses-1', childId: mia.id, day: dayKey(now), startedAt: now - 900_000, endedAt: now, activeMs: 14 * 60_000, itemsCompleted: 2 });
  await seedAttempt(mia.id, { id: 'ch-1', attempt: { outcome: 'independent', hintsUsed: 0 } });
  await seedAttempt(mia.id, { id: 'ch-2' });
}

describe('overview', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    ai.getAiStatus.mockReset().mockResolvedValue({ provider: 'demo', ready: true, reason: null });
    mia = await addChild({ nickname: 'Mia', grade: '2', streakDays: 4 });
    await seedProgress();
  });

  it('shows a card per child with the week, the levels as an estimate and the badges', async () => {
    renderParent('/parent');
    const card = within(await screen.findByRole('article', { name: 'Mia' }));
    expect(card.getByText(/^Enrolled: /)).toBeInTheDocument();
    expect(card.getByText('4 days in a row')).toBeInTheDocument();
    expect(card.getByText('Levels are the app’s estimate, not a school assessment.')).toBeInTheDocument();
    expect(card.getByText('2 concept checks passed')).toBeInTheDocument();
    expect(card.getAllByText('Not started yet').length).toBeGreaterThan(0);
    await waitFor(() => expect(card.queryByText('No badges yet')).not.toBeInTheDocument());
    // Week numbers: 14 minutes, 2 challenges, half of them alone.
    expect(card.getByText('14')).toBeInTheDocument();
    expect(card.getByText('50%')).toBeInTheDocument();
    expect(card.getByRole('link', { name: /See Mia.s details/ })).toHaveAttribute('href', `/parent/child/${mia.id}`);
  });

  it('reports the AI mode, the usage against the budgets and problems in plain words', async () => {
    await updateSettings((current) => ({
      ...current,
      ai: { ...current.ai, provider: 'direct', dailyRequestBudget: 40, monthlyRequestCap: 500 },
    }));
    await db.usage.put({ ...(await emptyUsageToday()), requests: 12 });
    ai.getAiStatus.mockResolvedValue({ provider: 'direct', ready: false, reason: 'No API key is saved yet. Add one in the parent settings.' });

    renderParent('/parent');
    const status = within(await screen.findByRole('region', { name: /AI and usage/ }));
    expect(await status.findByText('No API key is saved yet. Add one in the parent settings.')).toBeInTheDocument();
    expect(status.getByText(/AI is not available right now/)).toBeInTheDocument();
    expect(await status.findByText('12 of 40')).toBeInTheDocument();
    expect(status.getByText('12 of 500')).toBeInTheDocument();
  });

  it('invites the parent to add a child when there is none', async () => {
    await db.children.clear();
    renderParent('/parent');
    expect(await screen.findByText('No children yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add a child' }));
    expect(await screen.findByRole('dialog', { name: 'Add a child' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/parent/children');
  });
});

/** Today's usage row with every counter the table needs, read through the data module's own writer. */
async function emptyUsageToday() {
  const { recordUsage } = await import('@/data');
  await recordUsage({ requests: 0 });
  const row = await db.usage.get(dayKey(Date.now()));
  if (!row) throw new Error('usage row missing');
  return row;
}

describe('child detail: progress', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    ai.getAiStatus.mockReset().mockResolvedValue({ provider: 'demo', ready: true, reason: null });
    mia = await addChild({ nickname: 'Mia', grade: '2' });
    await seedProgress();
  });

  it('shows levels with their history, the curriculum and the learner notes', async () => {
    renderParent(`/parent/child/${mia.id}`);
    await screen.findByRole('heading', { name: 'Mia', level: 1 });
    expect(await screen.findByRole('heading', { name: 'Working level by subject' })).toBeInTheDocument();
    expect(screen.getByText('Levels are the app’s estimate, not a school assessment.')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Math: level over time\. .* 2 changes\./ })).toBeInTheDocument();

    // Learner notes
    expect(screen.getByText('Counts confidently to 100.')).toBeInTheDocument();
    expect(screen.getByText('Skip-counting by fives')).toBeInTheDocument();

    // Curriculum: every skill, with the state of the ones that were practised.
    const skill = within(screen.getByRole('heading', { name: 'Counting', level: 4 }).closest('li') as HTMLElement);
    expect(skill.getByText('Concept check coming')).toBeInTheDocument();
    expect(skill.getByText('2 concept checks passed')).toBeInTheDocument();
    expect(skill.getByText(/^Last practised /)).toBeInTheDocument();
    expect(skill.getByRole('meter', { name: 'Mastery within this step' })).toHaveAttribute('aria-valuenow', '62');
    expect(skill.getByText('Skip-count by 2s, 5s, 10s and 100s within 1000')).toBeInTheDocument();
    expect(screen.getAllByText('Not started yet').length).toBeGreaterThan(5);
  });

  it('restarts placement on request and keeps the rewards', async () => {
    await db.kv.put({ key: `progression:placement:${mia.id}`, value: { answered: 8 } });
    renderParent(`/parent/child/${mia.id}`);
    expect(await screen.findByText(/Placement is finished/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Redo placement' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Redo the placement game?' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Redo placement' }));

    expect(await screen.findByText(/Placement starts again at Mia.s next session/)).toBeInTheDocument();
    expect((await db.children.get(mia.id))?.placementDone).toBe(false);
    expect(await db.kv.get(`progression:placement:${mia.id}`)).toBeUndefined();
    expect(await db.rewards.count()).toBe(1);
    expect(await db.skillStates.count()).toBe(1);
  });
});

describe('child detail: weekly report', () => {
  beforeEach(async () => {
    await freshDevice({ setup: true });
    ai.getAiStatus.mockReset().mockResolvedValue({ provider: 'demo', ready: true, reason: null });
    ai.generateWeeklyReport.mockReset().mockResolvedValue({
      headline: 'A steady week of counting',
      highlights: ['Solved a counting challenge without help'],
      struggles: ['Skip-counting by fives still needs a hint'],
      homeActivities: ['Count the stairs in fives together'],
    });
    mia = await addChild({ nickname: 'Mia', grade: '2', interests: ['space'] });
    await seedProgress();
  });

  it('writes, stores and shows the report, without telling the AI who the child is', async () => {
    renderParent(`/parent/child/${mia.id}?tab=report`);
    expect(await screen.findByText('No report has been written for this week yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Write the report' }));
    expect(await screen.findByText('A steady week of counting')).toBeInTheDocument();
    expect(screen.getByText('Solved a counting challenge without help')).toBeInTheDocument();
    expect(screen.getByText('Skip-counting by fives still needs a hint')).toBeInTheDocument();
    expect(screen.getByText('Count the stairs in fives together')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Write it again' })).toBeInTheDocument();

    const request = ai.generateWeeklyReport.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.child).toEqual({ ageGroup: '6-8', grade: '2', interests: ['space'], locale: 'en', strictness: 'strict' });
    expect(request.stats).toMatchObject({ completed: 2, minutes: 14 });
    expect(request.learnerSummary).toBe('Counts confidently to 100.');
    expect(JSON.stringify(request)).not.toContain('Mia');
    expect(JSON.stringify(request)).not.toContain(mia.id);

    const stored = await db.weeklyReports.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ childId: mia.id, weekStart: weekStartOf(), headline: 'A steady week of counting' });

    // Writing it again replaces the report of that week.
    await userEvent.click(screen.getByRole('button', { name: 'Write it again' }));
    await waitFor(() => expect(ai.generateWeeklyReport).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect(await db.weeklyReports.count()).toBe(1));
  });

  it('prints through the browser', async () => {
    const print = vi.fn();
    window.print = print;
    await db.weeklyReports.put({
      id: 'report-1',
      childId: mia.id,
      weekStart: weekStartOf(),
      headline: 'Saved earlier',
      highlights: [],
      struggles: [],
      homeActivities: [],
      stats: { minutes: 14, completed: 2, independentShare: 0.5, stageUps: 0 },
      createdAt: Date.now(),
    });
    renderParent(`/parent/child/${mia.id}?tab=report`);
    expect(await screen.findByText('Saved earlier')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});
