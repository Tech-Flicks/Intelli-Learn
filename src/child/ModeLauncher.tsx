/**
 * The creative mode launcher: one colourful card per way to play besides the quest.
 * Every card is locked until the child has finished the first adventure (placement).
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import type { Mode } from '@/core/types';
import { modeBlurb, modeName, useT } from '@/i18n';
import { cx, useReducedMotion } from '@/ui';
import './strings';

export type CreativeMode = Exclude<Mode, 'quest'>;

type CardTone = 'brand' | 'sun' | 'leaf' | 'coral' | 'sky';

/** Tinted surface, border and the chunky edge underneath. Text on all of them is ink-900 / ink-700 (AA). */
const TONE: Record<CardTone, string> = {
  brand: 'border-brand-300 bg-brand-50 shadow-[0_5px_0_var(--color-brand-300)]',
  sun: 'border-sun-500 bg-sun-100 shadow-[0_5px_0_var(--color-sun-500)]',
  leaf: 'border-leaf-400 bg-leaf-100 shadow-[0_5px_0_var(--color-leaf-400)]',
  coral: 'border-coral-400 bg-coral-100 shadow-[0_5px_0_var(--color-coral-400)]',
  sky: 'border-sky-400 bg-sky-100 shadow-[0_5px_0_var(--color-sky-400)]',
};

export const MODE_CARDS: readonly { mode: CreativeMode; emoji: string; tone: CardTone }[] = [
  { mode: 'story', emoji: '📖', tone: 'brand' },
  { mode: 'experiment', emoji: '🧪', tone: 'leaf' },
  { mode: 'robot', emoji: '🤖', tone: 'sky' },
  { mode: 'detective', emoji: '🕵️', tone: 'coral' },
  { mode: 'fixbot', emoji: '🔧', tone: 'sun' },
  { mode: 'invention', emoji: '💡', tone: 'leaf' },
  { mode: 'wonder', emoji: '🌍', tone: 'sky' },
  { mode: 'studio', emoji: '🎨', tone: 'coral' },
  { mode: 'mission', emoji: '🧭', tone: 'brand' },
];

/** The modes a child may see: the real-world mission only when the parent allows it. */
export function visibleModes(realWorldMissions: boolean): CreativeMode[] {
  return MODE_CARDS.map((card) => card.mode).filter((mode) => mode !== 'mission' || realWorldMissions);
}

export interface ModeLauncherProps {
  modes: readonly CreativeMode[];
  locked: boolean;
  /** Fewer words (ages 3 to 5): no blurbs, bigger pictures. */
  small: boolean;
  onOpen: (mode: CreativeMode) => void;
}

export function ModeLauncher({ modes, locked, small, onOpen }: ModeLauncherProps) {
  const t = useT();
  const calm = useReducedMotion();
  // Tapping a locked card makes the note wiggle, so the child sees why nothing opened.
  const [nudges, setNudges] = useState(0);
  const cards = MODE_CARDS.filter((card) => modes.includes(card.mode));

  return (
    <div className="flex flex-col gap-4">
      {locked && (
        <p
          key={nudges}
          className={cx(
            'flex items-center gap-2 self-start rounded-2xl border-2 border-sun-500 bg-sun-100 px-4 py-2 text-base font-bold text-ink-900',
            nudges > 0 && 'animate-wiggle',
          )}
        >
          <span aria-hidden="true">🔒</span>
          {t('child.home.locked')}
        </p>
      )}
      <ul className="flex flex-wrap justify-center gap-3 sm:gap-4">
        {cards.map((card) => {
          const name = modeName(card.mode);
          return (
            <li key={card.mode} className="flex w-[calc((100%-0.75rem)/2)] min-w-0 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
              <motion.button
                type="button"
                data-mode={card.mode}
                aria-disabled={locked || undefined}
                aria-label={locked ? t('child.home.mode.lockedAria', { mode: name }) : undefined}
                onClick={() => {
                  if (locked) setNudges((count) => count + 1);
                  else onOpen(card.mode);
                }}
                whileHover={calm || locked ? undefined : { y: -3 }}
                whileTap={calm || locked ? undefined : { scale: 0.95, y: 3 }}
                transition={{ type: 'spring', stiffness: 480, damping: 18 }}
                className={cx(
                  'relative mb-1.5 flex min-h-32 w-full flex-col items-center gap-1.5 rounded-3xl border-2 px-3 py-4 text-center text-ink-900',
                  TONE[card.tone],
                  locked && 'cursor-not-allowed',
                )}
              >
                <span aria-hidden="true" className={cx('leading-none', small ? 'text-6xl' : 'text-5xl', locked && 'opacity-60 grayscale')}>
                  {card.emoji}
                </span>
                <span className={cx('max-w-full hyphens-auto break-words font-display font-bold leading-tight', small ? 'text-xl' : 'text-lg')}>{name}</span>
                {!small && <span className="max-w-full break-words text-sm leading-snug text-ink-700">{modeBlurb(card.mode)}</span>}
                {locked && (
                  <span aria-hidden="true" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-base shadow-card">
                    🔒
                  </span>
                )}
              </motion.button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
