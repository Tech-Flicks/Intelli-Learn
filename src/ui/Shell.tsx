import type { HTMLAttributes, ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { useT } from '@/i18n';
import { cx } from './cx';
import './strings';

// ---------------------------------------------------------------------------
// PageShell: the calm parent-area layout
// ---------------------------------------------------------------------------

const WIDTH = { sm: 'max-w-xl', md: 'max-w-3xl', lg: 'max-w-5xl', xl: 'max-w-7xl' } as const;

export interface PageShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  subtitle?: ReactNode;
  /** In-app path for the back link (uses the router). */
  backTo?: string;
  /** Alternative to `backTo`: a back button that calls this. */
  onBack?: () => void;
  /** Accessible name of the back control. Default "Back". */
  backLabel?: string;
  /** Buttons at the right of the header. */
  actions?: ReactNode;
  /** Maximum width of the header and content. */
  width?: keyof typeof WIDTH;
  children?: ReactNode;
}

const BACK_CLASS =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-700 hover:bg-brand-50 active:bg-brand-100';

function BackArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function PageShell({
  title,
  subtitle,
  backTo,
  onBack,
  backLabel,
  actions,
  width = 'md',
  className,
  children,
  ...rest
}: PageShellProps) {
  const t = useT();
  const inRouter = useInRouterContext();
  const label = backLabel ?? t('ui.back');

  let back: ReactNode = null;
  if (backTo !== undefined) {
    back = inRouter ? (
      <Link to={backTo} aria-label={label} title={label} className={BACK_CLASS}>
        <BackArrow />
      </Link>
    ) : (
      <a href={backTo} aria-label={label} title={label} className={BACK_CLASS}>
        <BackArrow />
      </a>
    );
  } else if (onBack) {
    back = (
      <button type="button" onClick={onBack} aria-label={label} title={label} className={BACK_CLASS}>
        <BackArrow />
      </button>
    );
  }

  return (
    <div {...rest} className={cx('flex min-h-full flex-col bg-paper text-ink-900', className)}>
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white pt-[env(safe-area-inset-top)]">
        <div className={cx('mx-auto flex min-h-16 w-full items-center gap-2 px-4 py-2', WIDTH[width])}>
          {back}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl font-bold leading-tight">{title}</h1>
            {subtitle !== undefined && <p className="truncate text-sm text-ink-500">{subtitle}</p>}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </header>
      <main className={cx('mx-auto w-full flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]', WIDTH[width])}>{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChildShell: the playful child-area layout
// ---------------------------------------------------------------------------

export type ChildShellTone = 'day' | 'meadow' | 'sunset' | 'space';

const CHILD_TONE: Record<ChildShellTone, string> = {
  day: '',
  meadow: 'child-bg-meadow',
  sunset: 'child-bg-sunset',
  space: 'child-bg-space',
};

/** Soft shapes that drift behind the content. Hidden in high-contrast mode, still in calm mode. */
const DECOR: Record<ChildShellTone, { emoji: string; className: string }[]> = {
  day: [
    { emoji: '☁️', className: 'left-[6%] top-[12%] text-6xl opacity-70' },
    { emoji: '✨', className: 'right-[10%] top-[22%] text-4xl opacity-60 [animation-delay:-2s]' },
    { emoji: '☁️', className: 'bottom-[14%] right-[4%] text-7xl opacity-50 [animation-delay:-3.5s]' },
  ],
  meadow: [
    { emoji: '🌿', className: 'left-[5%] top-[16%] text-5xl opacity-60' },
    { emoji: '🦋', className: 'right-[9%] top-[26%] text-4xl opacity-70 [animation-delay:-1.5s]' },
    { emoji: '🌼', className: 'bottom-[10%] left-[8%] text-5xl opacity-60 [animation-delay:-3s]' },
  ],
  sunset: [
    { emoji: '🎈', className: 'left-[7%] top-[18%] text-5xl opacity-60' },
    { emoji: '✨', className: 'right-[12%] top-[14%] text-4xl opacity-60 [animation-delay:-2.5s]' },
    { emoji: '🪁', className: 'bottom-[16%] right-[6%] text-6xl opacity-50 [animation-delay:-4s]' },
  ],
  space: [
    { emoji: '⭐', className: 'left-[8%] top-[14%] text-3xl opacity-80' },
    { emoji: '🪐', className: 'right-[8%] top-[20%] text-6xl opacity-70 [animation-delay:-2s]' },
    { emoji: '✨', className: 'bottom-[18%] left-[12%] text-4xl opacity-70 [animation-delay:-3s]' },
    { emoji: '🌙', className: 'bottom-[10%] right-[10%] text-5xl opacity-60 [animation-delay:-4.5s]' },
  ],
};

export interface ChildShellProps extends HTMLAttributes<HTMLDivElement> {
  /** Content of the bar at the top: home button, star count, companion ... */
  topBar?: ReactNode;
  /** Background mood. 'space' is dark with white text. */
  tone?: ChildShellTone;
  /** Drifting background shapes. Default on. */
  decorations?: boolean;
  /** Classes for the `<main>` content area. */
  contentClassName?: string;
  children?: ReactNode;
}

/**
 * Full-height, colourful layout for everything a child sees. Pads for notches
 * and home indicators. Content sits above the decorations.
 */
export function ChildShell({
  topBar,
  tone = 'day',
  decorations = true,
  className,
  contentClassName,
  children,
  ...rest
}: ChildShellProps) {
  return (
    <div
      {...rest}
      data-tone={tone}
      className={cx(
        'child-bg relative flex min-h-full flex-col overflow-hidden',
        tone === 'space' ? 'text-white' : 'text-ink-900',
        CHILD_TONE[tone],
        className,
      )}
    >
      {decorations && (
        <div aria-hidden="true" className="decor pointer-events-none absolute inset-0 select-none overflow-hidden">
          {DECOR[tone].map((item, index) => (
            <span key={index} className={cx('absolute animate-float leading-none', item.className)}>
              {item.emoji}
            </span>
          ))}
        </div>
      )}
      {topBar !== undefined && (
        <header className="relative z-10 flex min-h-16 items-center gap-3 px-safe pt-safe pb-2">{topBar}</header>
      )}
      <main
        className={cx(
          'relative z-10 flex flex-1 flex-col px-safe pb-safe',
          topBar === undefined && 'pt-safe',
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
