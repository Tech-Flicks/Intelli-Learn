import type { HTMLAttributes, Ref } from 'react';
import { cx } from './cx';

export type CardTone = 'plain' | 'tinted' | 'sun' | 'leaf' | 'coral' | 'sky' | 'outline';

const TONE: Record<CardTone, string> = {
  plain: 'border border-ink-200 bg-white shadow-card',
  tinted: 'border border-brand-200 bg-brand-50',
  sun: 'border border-sun-500 bg-sun-100',
  leaf: 'border border-leaf-600 bg-leaf-100',
  coral: 'border border-coral-600 bg-coral-100',
  sky: 'border border-sky-600 bg-sky-100',
  outline: 'border-2 border-dashed border-ink-400 bg-transparent',
};

const PADDING = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-7' } as const;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li' | 'aside';
  tone?: CardTone;
  padding?: keyof typeof PADDING;
  /** Child-area look: rounder corners. */
  playful?: boolean;
  /** Lifts on hover. Use when the whole card is inside a link or button. */
  interactive?: boolean;
  ref?: Ref<HTMLElement>;
}

/** A surface. Always sets its own text colour, so it reads well on any shell background. */
export function Card({
  as: Tag = 'div',
  tone = 'plain',
  padding = 'md',
  playful = false,
  interactive = false,
  className,
  ref,
  ...rest
}: CardProps) {
  return (
    <Tag
      // The element type varies, so the ref is typed for the common HTMLElement base.
      ref={ref as Ref<never>}
      {...rest}
      className={cx(
        'text-ink-900',
        playful ? 'rounded-3xl' : 'rounded-2xl',
        TONE[tone],
        PADDING[padding],
        interactive && 'transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lift',
        className,
      )}
    />
  );
}
