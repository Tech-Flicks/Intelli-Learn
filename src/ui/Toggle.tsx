import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx, ids } from './cx';

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'children'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label. Without it, pass `aria-label`. */
  label?: ReactNode;
  /** Smaller text under the label, wired to `aria-describedby`. */
  description?: ReactNode;
  size?: 'md' | 'lg';
  ref?: Ref<HTMLButtonElement>;
}

/** An on/off switch (`role="switch"`). The state is shown by position and a tick, not by colour alone. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  size = 'md',
  id,
  disabled,
  className,
  onClick,
  ...rest
}: ToggleProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const labelId = `${switchId}-label`;
  const descriptionId = `${switchId}-description`;
  const big = size === 'lg';

  const control = (
    <button
      type="button"
      {...rest}
      id={switchId}
      role="switch"
      aria-checked={checked}
      aria-labelledby={label !== undefined && !rest['aria-label'] ? ids(rest['aria-labelledby'], labelId) : rest['aria-labelledby']}
      aria-describedby={ids(rest['aria-describedby'], description !== undefined && descriptionId)}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange(!checked);
      }}
      className={cx(
        // The pseudo-element widens the touch target without changing the layout.
        'relative inline-flex shrink-0 items-center rounded-full border-2 transition-colors duration-200',
        'before:absolute before:-inset-2 before:content-[""]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        big ? 'h-10 w-[4.5rem]' : 'h-8 w-14',
        checked ? 'border-brand-500 bg-brand-500' : 'border-ink-400 bg-ink-100',
        label === undefined && className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'inline-flex items-center justify-center rounded-full shadow transition-transform duration-200',
          big ? 'h-7 w-7' : 'h-5 w-5',
          checked ? 'bg-white text-brand-700' : 'bg-ink-500 text-transparent',
          checked ? (big ? 'translate-x-9' : 'translate-x-7') : 'translate-x-1',
        )}
      >
        <svg viewBox="0 0 24 24" width={big ? 18 : 14} height={big ? 18 : 14} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </button>
  );

  if (label === undefined) return control;

  return (
    <div className={cx('flex min-h-11 items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        <label id={labelId} htmlFor={switchId} className={cx('block font-bold text-ink-900', big ? 'text-lg' : 'text-base')}>
          {label}
        </label>
        {description !== undefined && (
          <p id={descriptionId} className="text-sm text-ink-500">
            {description}
          </p>
        )}
      </div>
      {control}
    </div>
  );
}
