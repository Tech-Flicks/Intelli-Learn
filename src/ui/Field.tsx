import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useT } from '@/i18n';
import { clamp, cx, ids } from './cx';
import './strings';

// ---------------------------------------------------------------------------
// Field: label + hint + error, wired to the control by ids
// ---------------------------------------------------------------------------

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: boolean | undefined;
}

const FieldContext = createContext<FieldControlProps | null>(null);

/**
 * The props a control inside a `<Field>` needs for its label, hint and error.
 * `TextInput`, `PasswordInput`, `NumberInput`, `Select` and `TextArea` use it
 * themselves; call it for custom controls. Returns null outside a Field.
 */
export function useFieldControl(): FieldControlProps | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** Helper text under the label. */
  hint?: ReactNode;
  /** Error text. Marks the control invalid and is announced to screen readers. */
  error?: ReactNode;
  required?: boolean;
  /** Id for the control. Generated when omitted. */
  id?: string;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  /**
   * For a set of controls (chips, radio buttons): renders a `role="group"`
   * named by the label instead of a `<label for>`.
   */
  group?: boolean;
  /** The control, or a function that receives the wiring props for a custom control. */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
  className?: string;
}

export function Field({ label, hint, error, required, id, hideLabel = false, group = false, children, className }: FieldProps) {
  const t = useT();
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const describedBy = ids(hasHint && hintId, hasError && errorId);

  const control: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': hasError ? true : undefined,
    required: required || undefined,
  };

  const labelClass = cx('text-sm font-bold text-ink-900', hideLabel && 'sr-only');
  const requiredMark = required && (
    <>
      <span aria-hidden="true" className="text-coral-700">
        {' *'}
      </span>
      <span className="sr-only"> ({t('ui.required')})</span>
    </>
  );

  return (
    <div
      className={cx('flex flex-col gap-1.5', className)}
      role={group ? 'group' : undefined}
      aria-labelledby={group ? labelId : undefined}
      aria-describedby={group ? describedBy : undefined}
    >
      {group ? (
        <span id={labelId} className={labelClass}>
          {label}
          {requiredMark}
        </span>
      ) : (
        <label id={labelId} htmlFor={controlId} className={labelClass}>
          {label}
          {requiredMark}
        </label>
      )}
      {hasHint && (
        <p id={hintId} className="text-sm text-ink-500">
          {hint}
        </p>
      )}
      <FieldContext.Provider value={control}>
        {typeof children === 'function' ? children(control) : children}
      </FieldContext.Provider>
      {hasError && (
        <p id={errorId} role="alert" className="text-sm font-semibold text-coral-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared control styling
// ---------------------------------------------------------------------------

export type ControlScale = 'md' | 'lg';

const CONTROL =
  'w-full border-2 border-ink-400 bg-white text-ink-900 transition-colors placeholder:text-ink-500 ' +
  'hover:border-ink-500 focus-visible:border-brand-500 ' +
  'disabled:cursor-not-allowed disabled:border-ink-200 disabled:bg-ink-50 disabled:text-ink-500 ' +
  'aria-[invalid=true]:border-coral-700';

/** 44 px for parent forms, 56 px for anything a child types into. */
const CONTROL_SCALE: Record<ControlScale, string> = {
  md: 'min-h-11 rounded-xl px-3 text-base',
  lg: 'min-h-14 rounded-2xl px-4 text-xl',
};

interface WiringInput {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: InputHTMLAttributes<HTMLInputElement>['aria-invalid'];
  required?: boolean | undefined;
  invalid?: boolean | undefined;
}

/** Merges a control's own props with the surrounding Field's wiring. Own props win. */
function useWiring(props: WiringInput) {
  const field = useFieldControl();
  return {
    id: props.id ?? field?.id,
    'aria-describedby': ids(props['aria-describedby'], field?.['aria-describedby']),
    'aria-invalid': props.invalid ? true : (props['aria-invalid'] ?? field?.['aria-invalid']),
    required: props.required ?? field?.required,
  };
}

// ---------------------------------------------------------------------------
// TextInput and TextArea
// ---------------------------------------------------------------------------

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  scale?: ControlScale;
  /** Convenience next to the native `onChange`: receives the new text. */
  onValueChange?: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
}

export function TextInput({ invalid, scale = 'md', onValueChange, onChange, type = 'text', className, ...rest }: TextInputProps) {
  const wiring = useWiring({ ...rest, invalid });
  return (
    <input
      type={type}
      {...rest}
      {...wiring}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.target.value);
      }}
      className={cx(CONTROL, CONTROL_SCALE[scale], className)}
    />
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  onValueChange?: (value: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ invalid, onValueChange, onChange, rows = 3, className, ...rest }: TextAreaProps) {
  const wiring = useWiring({ ...rest, invalid });
  return (
    <textarea
      rows={rows}
      {...rest}
      {...wiring}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.target.value);
      }}
      className={cx(CONTROL, 'rounded-xl px-3 py-2 text-base leading-normal', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// PasswordInput
// ---------------------------------------------------------------------------

export interface PasswordInputProps extends Omit<TextInputProps, 'type'> {
  /** Start with the password visible. */
  defaultVisible?: boolean;
}

export function PasswordInput({ defaultVisible = false, className, autoComplete = 'current-password', ...rest }: PasswordInputProps) {
  const t = useT();
  const [visible, setVisible] = useState(defaultVisible);
  const big = rest.scale === 'lg';
  return (
    <div className="relative">
      <TextInput
        {...rest}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cx(big ? 'pr-16' : 'pr-14', className)}
      />
      <button
        type="button"
        aria-label={visible ? t('ui.hidePassword') : t('ui.showPassword')}
        aria-pressed={visible}
        title={visible ? t('ui.hidePassword') : t('ui.showPassword')}
        disabled={rest.disabled}
        onClick={() => setVisible((value) => !value)}
        className={cx(
          'absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-lg text-ink-700',
          'hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-55',
          big ? 'h-12 w-12' : 'h-9 w-11',
        )}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumberInput
// ---------------------------------------------------------------------------

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'type' | 'size'> {
  /** The number, or null when the box is empty. */
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Amount the − / + buttons and the arrow keys change the value by. Default 1. */
  step?: number;
  /** Allow a decimal point. Default: whole numbers only. */
  decimal?: boolean;
  /** Short unit shown after the number, e.g. "min". */
  unit?: string;
  /** Hide the − / + buttons. */
  hideSteppers?: boolean;
  invalid?: boolean;
  scale?: ControlScale;
  ref?: Ref<HTMLInputElement>;
}

function formatNumber(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : String(value);
}

function parseNumber(text: string): number | null {
  const normalized = text.replace(',', '.').trim();
  if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Avoids 0.1 + 0.2 = 0.30000000000000004 when stepping decimals. */
function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(value.toFixed(Math.min(10, decimals)));
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  decimal = false,
  unit,
  hideSteppers = false,
  invalid,
  scale = 'md',
  disabled,
  readOnly,
  className,
  onBlur,
  onKeyDown,
  ...rest
}: NumberInputProps) {
  const t = useT();
  const wiring = useWiring({ ...rest, invalid });
  const [draft, setDraft] = useState(() => formatNumber(value));

  // Follow outside changes, but do not rewrite what the user is typing ("1." or "-").
  useEffect(() => {
    setDraft((current) => (parseNumber(current) === value ? current : formatNumber(value)));
  }, [value]);

  const lower = min ?? Number.NEGATIVE_INFINITY;
  const upper = max ?? Number.POSITIVE_INFINITY;
  const allowNegative = lower < 0;
  const locked = Boolean(disabled || readOnly);

  const commit = (next: number | null) => {
    setDraft(formatNumber(next));
    if (next !== value) onChange(next);
  };

  const stepBy = (direction: 1 | -1) => {
    if (locked) return;
    const base = value ?? (direction === 1 ? (min ?? 0) - step : (max ?? min ?? 0) + step);
    commit(clamp(roundToStep(base + direction * step, step), lower, upper));
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    let text = event.target.value.replace(decimal ? /[^0-9.,-]/g : /[^0-9-]/g, '');
    // A minus sign is only valid at the start, and only when negatives are allowed.
    text = (allowNegative && text.startsWith('-') ? '-' : '') + text.replace(/-/g, '');
    if (decimal) {
      const [whole = '', ...fractions] = text.split(/[.,]/);
      text = fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
    }
    setDraft(text);
    const parsed = parseNumber(text);
    if (parsed !== value) onChange(parsed);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepBy(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepBy(-1);
    }
  };

  const stepper = cx(
    'inline-flex shrink-0 items-center justify-center border-2 border-ink-400 bg-white font-bold text-brand-700',
    'hover:bg-brand-50 active:bg-brand-100 disabled:cursor-not-allowed disabled:border-ink-200 disabled:text-ink-500',
    scale === 'lg' ? 'h-14 w-14 rounded-2xl text-2xl' : 'h-11 w-11 rounded-xl text-xl',
  );

  return (
    <div className={cx('flex items-center gap-2', className)}>
      {!hideSteppers && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('ui.decrease')}
          disabled={locked || (value !== null && value <= lower)}
          onClick={() => stepBy(-1)}
          className={stepper}
        >
          <span aria-hidden="true">−</span>
        </button>
      )}
      <div className="relative min-w-0 flex-1">
        <input
          {...rest}
          {...wiring}
          type="text"
          role="spinbutton"
          inputMode={decimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          aria-valuenow={value ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={value !== null && unit ? `${value} ${unit}` : undefined}
          value={draft}
          disabled={disabled}
          readOnly={readOnly}
          onChange={onInput}
          onKeyDown={onKey}
          onBlur={(event) => {
            // Settle on a valid number when the user leaves the box.
            if (value !== null) commit(clamp(value, lower, upper));
            else setDraft('');
            onBlur?.(event);
          }}
          className={cx(CONTROL, CONTROL_SCALE[scale], 'text-center tabular-nums', unit && 'pr-12')}
        />
        {unit && (
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-500">
            {unit}
          </span>
        )}
      </div>
      {!hideSteppers && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('ui.increase')}
          disabled={locked || (value !== null && value >= upper)}
          onClick={() => stepBy(1)}
          className={stepper}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Options to render. Alternatively pass `<option>` children. */
  options?: readonly SelectOption[];
  /** A disabled first option shown while nothing is chosen (value ''). */
  placeholder?: string;
  invalid?: boolean;
  scale?: ControlScale;
  onValueChange?: (value: string) => void;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ options, placeholder, invalid, scale = 'md', onValueChange, onChange, className, children, ...rest }: SelectProps) {
  const wiring = useWiring({ ...rest, invalid });
  return (
    <div className="relative">
      <select
        {...rest}
        {...wiring}
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        className={cx(CONTROL, CONTROL_SCALE[scale], 'appearance-none pr-10', className)}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-700"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}
