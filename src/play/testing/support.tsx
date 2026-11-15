/**
 * Helpers for the play and helper tests. Not part of the public API and not imported by
 * application code.
 */
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';
import { makeStage, newId } from '@/core/grades';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type { ChallengeRecord, ChildProfile, ParentalControls } from '@/core/types';
import { createChild, db, updateChild, updateSettings } from '@/data';
import { PlayScreen } from '../PlayScreen';

/** A brand-new, empty database: setup finished, demo mode (no AI), play allowed all day. */
export async function freshDevice(controls: Partial<ParentalControls> = {}): Promise<void> {
  await db.delete();
  await db.open();
  await updateSettings((current) => ({
    ...current,
    setupComplete: true,
    controls: { ...current.controls, allowedStartHour: 0, allowedEndHour: 24, dailyMinutes: 0, ...controls },
  }));
}

/** Stores a child. Placement is done unless the patch says otherwise. */
export async function addChild(patch: Partial<ChildProfile> = {}): Promise<ChildProfile> {
  const created = await createChild({
    nickname: patch.nickname ?? 'Mia',
    avatar: patch.avatar ?? '🦊',
    ageGroup: patch.ageGroup ?? '6-8',
    grade: patch.grade ?? '2',
    interests: patch.interests ?? ['space'],
  });
  return updateChild(created.id, { placementDone: true, ...patch });
}

const BASE = {
  title: 'Apple count',
  intro: 'A friendly robot needs your help.',
  question: 'How many apples are in the basket?',
  readAloud: 'A friendly robot needs your help. How many apples are in the basket?',
  hints: ['Look closely at the picture.', 'Try counting each one slowly.'],
  walkthrough: ['Point at the first apple.', 'Then count the next ones.'],
  explanation: 'We counted every apple once.',
  scene: { theme: 'plain', objects: [] },
};

export const CHOICE = {
  kind: 'choice',
  options: [
    { id: 'a', label: 'Three', misconception: 'One apple is hiding behind the leaf.' },
    { id: 'b', label: 'Four' },
    { id: 'c', label: 'Five' },
  ],
  correctIds: ['b'],
};

export const NUMBER = { kind: 'number', answer: 12 };

export const ORDER = {
  kind: 'order',
  items: [
    { id: 'o1', label: 'Egg' },
    { id: 'o2', label: 'Caterpillar' },
    { id: 'o3', label: 'Cocoon' },
    { id: 'o4', label: 'Butterfly' },
  ],
};

export const TEACH_BACK = {
  prompt: 'Can you teach Pip how to count?',
  options: [
    { id: 't1', label: 'Touch each one once.', correct: true },
    { id: 't2', label: 'Guess quickly.', correct: false },
  ],
};

/** A schema-valid challenge around the given interaction. */
export function makeContent(interaction: unknown = CHOICE, overrides: Record<string, unknown> = {}): Challenge {
  return ChallengeSchema.parse({ ...BASE, ...overrides, interaction });
}

/** A challenge record for the child, not stored. Active (so it is the one that is played) unless said otherwise. */
export function makeRecord(childId: string, content: Challenge = makeContent(), overrides: Partial<ChallengeRecord> = {}): ChallengeRecord {
  const at = Date.now();
  return {
    id: newId('ch'),
    childId,
    skillId: 'math-addition-subtraction',
    strand: 'math',
    stage: makeStage('2', 'starting'),
    interaction: content.interaction.kind,
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
    content,
    source: 'offline',
    status: 'active',
    storyId: null,
    chapterIndex: null,
    libraryId: null,
    parentRating: null,
    parentNote: '',
    createdAt: at,
    startedAt: at,
    completedAt: null,
    ...overrides,
  };
}

/** Stores an active challenge: the supply hands an unfinished challenge back first. */
export async function giveChallenge(childId: string, content: Challenge = makeContent(), overrides: Partial<ChallengeRecord> = {}): Promise<ChallengeRecord> {
  const record = makeRecord(childId, content, overrides);
  await db.challenges.add(record);
  return record;
}

function Where(): JSX.Element {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

/** Renders the play screen the way the app shell mounts it; `data-testid="where"` shows where the router is. */
export function renderPlay(childId: string, query = ''): RenderResult {
  return render(
    <MemoryRouter initialEntries={[`/kids/${childId}/play${query}`]}>
      <Routes>
        <Route path="/kids/:childId/play" element={<PlayScreen />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
