/** Data and voice hooks shared by the child screens. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ChildProfile, ParentalControls, PlayAllowance, Settings } from '@/core/types';
import { db, getSettings } from '@/data';
import { getPlayAllowance } from '@/progression';
import { speak, stopSpeaking } from '@/voice';

/** What every screen under `/kids/:childId` receives from `ChildLayout`. */
export interface ChildScreenContext {
  child: ChildProfile;
  settings: Settings;
  /** The device-wide controls with this child's overrides applied. */
  controls: ParentalControls;
  /** Fewer words and bigger pictures (ages 3 to 5). */
  small: boolean;
}

export function useChildScreen(): ChildScreenContext {
  return useOutletContext<ChildScreenContext>();
}

/** The profile, `null` when there is no such child, `undefined` while it loads. */
export function useChildProfile(childId: string | undefined): ChildProfile | null | undefined {
  const result = useLiveQuery(
    async () => ({ id: childId, child: childId ? ((await db.children.get(childId)) ?? null) : null }),
    [childId],
  );
  // After a change of id the hook still holds the previous child for a moment.
  if (!result || result.id !== childId) return undefined;
  return result.child;
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), []);
}

const ALLOWANCE_RECHECK_MS = 30_000;

export type AllowanceState =
  | { status: 'loading' }
  | { status: 'ready'; allowance: PlayAllowance }
  /** The profile is gone (deleted in the parent area). */
  | { status: 'missing' };

/**
 * The child's play allowance, kept fresh: it is read again when the stored data changes,
 * every half minute, and when the page becomes visible again.
 */
export function usePlayAllowance(childId: string): AllowanceState {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump();
    };
    const timer = setInterval(bump, ALLOWANCE_RECHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const result = useLiveQuery(
    async () => ({
      childId,
      allowance: await getPlayAllowance(childId).catch(() => null),
    }),
    [childId, tick],
  );
  if (!result || result.childId !== childId) return { status: 'loading' };
  return result.allowance ? { status: 'ready', allowance: result.allowance } : { status: 'missing' };
}

/** A child who is read to: the read-aloud setting is on, or the child is in the youngest group. */
export function wantsReadAloud(child: Pick<ChildProfile, 'accessibility' | 'ageGroup'>): boolean {
  return child.accessibility.readAloud || child.ageGroup === '3-5';
}

export interface ScreenVoice {
  /** False when the parent switched voice output off: the screen then shows no speaker button. */
  available: boolean;
  /** Says the screen's main line (again). */
  say: () => void;
}

/**
 * The voice of one screen. Speaks `line` once when the screen opens (when `auto` is set),
 * offers `say` for the speaker button, and stops speaking when the screen closes.
 *
 * The line must never hold the child's nickname: a browser voice may be a network voice.
 */
export function useScreenVoice(options: {
  /** The screen's main line. Null while the screen is still loading. */
  line: string | null;
  /** The effective `voiceOutput` control. */
  enabled: boolean;
  /** Speak on entry without being asked. */
  auto: boolean;
  rate?: number | undefined;
}): ScreenVoice {
  const { line, enabled, auto, rate } = options;
  const spoken = useRef(false);
  const latest = useRef({ line, rate });
  latest.current = { line, rate };

  useEffect(() => {
    if (!enabled || !auto || line === null || spoken.current) return;
    spoken.current = true;
    void speak(line, { rate });
    // Later changes of the text (a new star count, a new language) are not read out again.
  }, [enabled, auto, line, rate]);

  useEffect(
    () => () => {
      spoken.current = false;
      stopSpeaking();
    },
    [],
  );

  const say = useCallback(() => {
    const current = latest.current;
    if (!enabled || current.line === null) return;
    void speak(current.line, { rate: current.rate });
  }, [enabled]);

  return { available: enabled, say };
}
