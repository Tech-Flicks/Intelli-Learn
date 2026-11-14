import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { useReducedMotion } from './accessibility';
import { cx } from './cx';
import { Spinner } from './Progress';

// ---------------------------------------------------------------------------
// Button (parent area and general use)
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
  secondary: 'border-2 border-brand-300 bg-white text-brand-700 hover:bg-brand-50 active:bg-brand-100',
  ghost: 'text-brand-700 hover:bg-brand-50 active:bg-brand-100',
  danger: 'bg-coral-700 text-white hover:bg-coral-800 active:bg-coral-800',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 rounded-lg px-3 text-sm',
  md: 'min-h-11 rounded-xl px-4 text-base',
  lg: 'min-h-14 rounded-2xl px-6 text-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Decorative icon or emoji before the label. */
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 font-bold leading-tight',
        'transition-[background-color,border-color,transform] duration-150 active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? (
        // `aria-busy` reports the state; the spinner must not change the button's name.
        <Spinner decorative size="sm" onColor={variant === 'primary' || variant === 'danger'} />
      ) : (
        icon !== undefined && <span aria-hidden="true">{icon}</span>
      )}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// BigButton (child area): chunky, colourful, squishy
// ---------------------------------------------------------------------------

export type BigButtonTone = 'brand' | 'sun' | 'leaf' | 'coral' | 'sky' | 'white';
export type BigButtonSize = 'md' | 'lg' | 'xl';

/** Background, text colour (AA on that background) and the "3D" edge underneath. */
const BIG_TONE: Record<BigButtonTone, string> = {
  brand: 'bg-brand-500 text-white shadow-[0_6px_0_var(--color-brand-700)]',
  sun: 'bg-sun-400 text-ink-900 shadow-[0_6px_0_var(--color-sun-600)]',
  leaf: 'bg-leaf-400 text-ink-900 shadow-[0_6px_0_var(--color-leaf-600)]',
  coral: 'bg-coral-400 text-ink-900 shadow-[0_6px_0_var(--color-coral-600)]',
  sky: 'bg-sky-400 text-ink-900 shadow-[0_6px_0_var(--color-sky-600)]',
  white: 'bg-white text-brand-700 shadow-[0_6px_0_var(--color-brand-200)]',
};

/** 56 px, 64 px and 80 px tall. */
const BIG_SIZE: Record<BigButtonSize, string> = {
  md: 'min-h-14 rounded-2xl px-6 text-xl',
  lg: 'min-h-16 rounded-3xl px-8 text-2xl',
  xl: 'min-h-20 rounded-[2rem] px-10 text-3xl',
};

export interface BigButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  tone?: BigButtonTone;
  size?: BigButtonSize;
  /** Decorative emoji before the label. */
  emoji?: string;
  fullWidth?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function BigButton({
  tone = 'brand',
  size = 'lg',
  emoji,
  fullWidth = false,
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}: BigButtonProps) {
  const calm = useReducedMotion();
  const lively = !calm && !disabled;
  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={lively ? { scale: 1.03 } : undefined}
      whileTap={lively ? { scale: 0.94, y: 4 } : undefined}
      transition={{ type: 'spring', stiffness: 520, damping: 16 }}
      {...rest}
      className={cx(
        'inline-flex select-none items-center justify-center gap-3 font-display font-bold leading-tight',
        'mb-1.5 disabled:cursor-not-allowed disabled:opacity-55',
        BIG_TONE[tone],
        BIG_SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {emoji !== undefined && (
        <span aria-hidden="true" className="text-[1.25em] leading-none">
          {emoji}
        </span>
      )}
      {children}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export type IconButtonVariant = 'ghost' | 'soft' | 'solid';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const ICON_VARIANT: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-700 hover:bg-brand-50 active:bg-brand-100',
  soft: 'border-2 border-brand-200 bg-white text-brand-700 hover:bg-brand-50 active:bg-brand-100',
  solid: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
};

/** 36 px (dense parent tables), 44 px, and 56 px (child area). */
const ICON_SIZE: Record<IconButtonSize, string> = {
  sm: 'h-9 w-9 rounded-lg text-base',
  md: 'h-11 w-11 rounded-xl text-xl',
  lg: 'h-14 w-14 rounded-2xl text-2xl',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: an icon alone has no name. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  variant = 'ghost',
  size = 'md',
  type = 'button',
  className,
  children,
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={title ?? rest['aria-label']}
      {...rest}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center leading-none',
        'transition-[background-color,transform] duration-150 active:scale-[0.94]',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        ICON_VARIANT[variant],
        ICON_SIZE[size],
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex items-center justify-center">
        {children}
      </span>
    </button>
  );
}
