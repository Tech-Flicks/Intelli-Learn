/** Small pieces shared by the child screens: the top bar, the speaker button, loading. */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pip, type PipProps } from '@/bot/pip';
import { tn, useT } from '@/i18n';
import { ChildShell, IconButton, Spinner, StarCount, cx } from '@/ui';
import { useSpeaking } from '@/voice';
import type { ScreenVoice } from './hooks';
import './child.css';
import './strings';

/** Hear the screen's main line again. Not shown when the parent switched voice output off. */
export function SpeakerButton({ voice, className }: { voice: ScreenVoice; className?: string }) {
  const t = useT();
  const speaking = useSpeaking();
  if (!voice.available) return null;
  return (
    <IconButton
      aria-label={t('child.speak')}
      variant="soft"
      size="lg"
      onClick={voice.say}
      className={cx(speaking && 'child-speaking', className)}
    >
      🔊
    </IconButton>
  );
}

function ArrowLeft() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

/** The round back button of the inner screens. */
export function BackButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <IconButton aria-label={label} variant="soft" size="lg" onClick={() => navigate(to)}>
      <ArrowLeft />
    </IconButton>
  );
}

/** The streak flame. Only shown from the second day on: a streak of one is just "today". */
export function StreakFlame({ days }: { days: number }) {
  useT();
  if (days < 2) return null;
  return (
    <span
      role="img"
      aria-label={tn('child.home.streak.one', 'child.home.streak.other', days)}
      className="inline-flex items-center gap-1 rounded-full border-2 border-coral-400 bg-coral-100 px-3 py-1 font-display text-lg font-bold text-ink-900"
    >
      <span aria-hidden="true" className="child-flicker">
        🔥
      </span>
      <span aria-hidden="true" className="tabular-nums">
        {days}
      </span>
    </span>
  );
}

/** The page's `h1` on the inner screens: under the top bar, so a long title can wrap. */
export function ScreenTitle({ emoji, children }: { emoji?: string; children: ReactNode }) {
  return (
    <h1 className="text-center font-display text-3xl font-bold leading-tight sm:text-4xl">
      {emoji !== undefined && (
        <span aria-hidden="true" className="mr-2">
          {emoji}
        </span>
      )}
      {children}
    </h1>
  );
}

/**
 * Pip in a box that utility classes size (`className="h-28 w-28 sm:h-40 sm:w-40"`, `hidden sm:block`).
 * The mascot's own stylesheet sets a default width that utility classes cannot replace, so the
 * box takes the classes and Pip fills it.
 */
export function PipFigure({ className, ...pip }: Omit<PipProps, 'size' | 'className'> & { className?: string }) {
  return (
    <div className={cx('shrink-0', className)}>
      <Pip {...pip} size="100%" />
    </div>
  );
}

export function TopBarStars({ count }: { count: number }) {
  return <StarCount count={count} size="md" className="shrink-0" />;
}

/** Shown while a profile or its settings load. */
export function ChildLoading() {
  return (
    <ChildShell contentClassName="items-center justify-center">
      <Spinner size="lg" />
    </ChildShell>
  );
}

/** Centres the content of a child screen and keeps lines a comfortable length on wide screens. */
export function ScreenColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto flex w-full max-w-5xl flex-col gap-6', className)}>{children}</div>;
}

/** A section heading in the child area. */
export function SectionHeading({ emoji, children, aside, id }: { emoji?: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="flex items-center gap-2 font-display text-2xl font-bold leading-tight">
        {emoji !== undefined && <span aria-hidden="true">{emoji}</span>}
        {children}
      </h2>
      {aside}
    </div>
  );
}
