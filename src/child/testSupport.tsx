/**
 * Helpers for the child module's own tests. Not part of the public API and not imported by
 * application code.
 */
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';
import { dayKey } from '@/core/grades';
import type { ChildProfile, ParentalControls } from '@/core/types';
import { createChild, db, updateChild, updateSettings } from '@/data';
import { ChildArea } from './index';

/** Gives each test a brand-new, empty database with setup finished and play allowed all day. */
export async function freshDevice(controls: Partial<ParentalControls> = {}): Promise<void> {
  await db.delete();
  await db.open();
  await updateSettings((current) => ({
    ...current,
    setupComplete: true,
    controls: { ...current.controls, allowedStartHour: 0, allowedEndHour: 24, ...controls },
  }));
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

/** Uses up today's play time, so the allowance says 'daily-limit'. */
export async function useUpToday(childId: string, minutes = 600): Promise<void> {
  const now = Date.now();
  await db.sessions.put({
    id: `ses-${childId}`,
    childId,
    day: dayKey(now),
    startedAt: now,
    endedAt: now,
    activeMs: minutes * 60_000,
    itemsCompleted: 0,
  });
}

/** Moves the allowed hours to a window that does not hold the current hour. */
export async function closeTheHours(): Promise<{ startHour: number }> {
  const hour = new Date().getHours();
  const startHour = (hour + 1) % 24;
  await updateSettings((current) => ({
    ...current,
    controls: { ...current.controls, allowedStartHour: startHour, allowedEndHour: (hour + 2) % 24 },
  }));
  return { startHour };
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
 * Renders the child area the way the app shell mounts it. The play screen and the parent
 * area are stand-ins that show where the router went (`data-testid="elsewhere"`).
 */
export function renderChildArea(path: string): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/kids/:childId/play" element={<Probe name="play" />} />
        <Route path="/parent/*" element={<Probe name="parent" />} />
        <Route path="/kids/*" element={<ChildArea />} />
      </Routes>
    </MemoryRouter>,
  );
}
