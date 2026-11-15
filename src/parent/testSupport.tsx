/**
 * Helpers for the parent module's own tests. Not part of the public API and not imported
 * by application code.
 */
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type { AttemptRecord, ChallengeRecord, ChildProfile, HelperMessage, LibraryItem } from '@/core/types';
import { createChild, db, updateChild, updateSettings } from '@/data';
import { setLocale } from '@/i18n';
import { setAdminPassword, useParentGate } from '@/security';
import { dismissToast, ToastViewport } from '@/ui';
import { ParentArea, SetupWizard } from './index';

export const TEST_PASSWORD = 'correct horse';

/** Few PBKDF2 rounds: honoured by the unit-test build only, to keep the tests quick. */
const FAST = { iterations: 1000 };

/**
 * Gives each test a brand-new, empty database, a locked gate and English strings.
 * With `setup`, the device is set up, a parent password is stored and (unless told
 * otherwise) the parent area is unlocked.
 */
export async function freshDevice(options: { setup?: boolean; unlocked?: boolean } = {}): Promise<void> {
  // jsdom has no scrolling and complains loudly about it.
  window.scrollTo = () => undefined;
  useParentGate.getState().lock();
  dismissToast();
  setLocale('en');
  await db.delete();
  await db.open();
  if (options.setup) {
    await setAdminPassword(TEST_PASSWORD, FAST);
    await updateSettings({ setupComplete: true });
    if (options.unlocked !== false) await useParentGate.getState().unlock(TEST_PASSWORD);
  }
}

let counter = 0;

/** Stores a child. Placement is done unless the patch says otherwise. */
export async function addChild(patch: Partial<ChildProfile> = {}): Promise<ChildProfile> {
  counter += 1;
  const created = await createChild({
    nickname: patch.nickname ?? `Kid${counter}`,
    avatar: patch.avatar ?? '🦊',
    ageGroup: patch.ageGroup ?? '6-8',
    grade: patch.grade ?? '2',
    interests: patch.interests ?? ['space'],
  });
  return updateChild(created.id, { placementDone: true, ...patch });
}

export function sampleChallenge(title = 'Count the stars'): Challenge {
  return ChallengeSchema.parse({
    title,
    intro: 'Three stars twinkle over the hill.',
    question: 'How many stars can you see?',
    readAloud: 'Three stars twinkle over the hill. How many stars can you see?',
    interaction: { kind: 'number', answer: 3 },
    hints: ['Count slowly.', 'Point at each star as you count.'],
    walkthrough: ['Point at the first star.', 'Count on: one, two, three.'],
    explanation: 'There are three stars, so the answer is 3.',
    scene: {
      theme: 'space',
      objects: [{ id: 'star-1', type: 'emoji', emoji: '⭐', x: 20, y: 20 }],
    },
  });
}

export function sampleLibraryItem(id: string, patch: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    fingerprint: `fp-${id}`,
    skillId: 'counting',
    strand: 'math',
    stage: 4,
    grade: 'K',
    interaction: 'number',
    mode: 'quest',
    theme: 'space',
    ageGroup: '3-5',
    locale: 'en',
    content: sampleChallenge(),
    origin: 'ai',
    remixOf: null,
    rating: null,
    ratingNote: '',
    retired: false,
    seenBy: [],
    uses: 0,
    independentSolves: 0,
    assistedSolves: 0,
    createdAt: Date.now() - 86_400_000,
    lastUsedAt: null,
    ...patch,
  };
}

export interface SeededAttempt {
  challenge: ChallengeRecord;
  attempt: AttemptRecord;
  messages: HelperMessage[];
}

/**
 * Stores one finished challenge of a child: the record, the attempt with one wrong and one
 * right answer, and a short helper conversation.
 */
export async function seedAttempt(
  childId: string,
  options: { id?: string; libraryId?: string | null; title?: string; completedAt?: number; challenge?: Partial<ChallengeRecord>; attempt?: Partial<AttemptRecord> } = {},
): Promise<SeededAttempt> {
  counter += 1;
  const id = options.id ?? `ch-${counter}`;
  const completedAt = options.completedAt ?? Date.now() - 60_000;
  const libraryId = options.libraryId ?? null;
  const challenge: ChallengeRecord = {
    id,
    childId,
    skillId: 'counting',
    strand: 'math',
    stage: 4,
    interaction: 'number',
    mode: 'quest',
    purpose: 'core',
    theme: 'space',
    content: sampleChallenge(options.title),
    source: libraryId ? 'ai' : 'offline',
    status: 'completed',
    storyId: null,
    chapterIndex: null,
    libraryId,
    parentRating: null,
    parentNote: '',
    createdAt: completedAt - 120_000,
    startedAt: completedAt - 90_000,
    completedAt,
    ...options.challenge,
  };
  const attempt: AttemptRecord = {
    id: `at-${id}`,
    challengeId: id,
    childId,
    skillId: challenge.skillId,
    strand: challenge.strand,
    answers: [
      { at: completedAt - 40_000, answer: 4, correct: false, misconception: 'One star was counted twice.' },
      { at: completedAt, answer: 3, correct: true, misconception: null },
    ],
    hintsUsed: 1,
    walkthroughUsed: false,
    teachBackCorrect: null,
    outcome: 'nudge',
    timeMs: 75_000,
    starsEarned: 2,
    completedAt,
    ...options.attempt,
  };
  const messages: HelperMessage[] = [
    { id: `m1-${id}`, childId, challengeId: id, role: 'child', kind: 'chat', text: 'I counted four, is that right?', at: completedAt - 35_000 },
    { id: `m2-${id}`, childId, challengeId: id, role: 'bot', kind: 'hint', text: 'Try touching each star once as you count.', at: completedAt - 30_000 },
  ];
  await db.challenges.put(challenge);
  await db.attempts.put(attempt);
  await db.messages.bulkPut(messages);
  return { challenge, attempt, messages };
}

function Probe({ name }: { name: string }): JSX.Element {
  const location = useLocation();
  return <div data-testid="elsewhere">{`${name}:${location.pathname}${location.search}`}</div>;
}

function Where(): JSX.Element {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

/**
 * Renders the setup wizard and the parent area the way the app shell mounts them, with the
 * toast region. The child area is a stand-in that shows where the router went.
 */
export function renderParent(path: string): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/parent/*" element={<ParentArea />} />
        <Route path="/kids/*" element={<Probe name="kids" />} />
      </Routes>
      <ToastViewport />
    </MemoryRouter>,
  );
}
