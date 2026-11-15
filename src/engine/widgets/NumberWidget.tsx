import { useEffect, useRef, type JSX } from 'react';
import { motion } from 'motion/react';
import type { NumberInteraction } from '@/core/schemas';
import type { WidgetProps } from './ChoiceWidget';
import { cx, FOCUS_RING } from './common';
import { pressKey, sanitizeNumberText, type KeypadKey } from './draft';

const DIGIT_ROWS: KeypadKey[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * On-screen keypad with the unit shown next to the answer. A hardware keyboard
 * works too: type into the answer field, or just type while nothing else that
 * takes text has focus.
 */
export function NumberWidget({
  interaction,
  value,
  onChange,
  disabled,
  labels,
  onEnter,
}: WidgetProps<NumberInteraction, string> & { /** Enter in the answer field: same as pressing Check. */ onEnter?: () => void }): JSX.Element {
  const rules = { allowDecimal: interaction.allowDecimal, allowNegative: interaction.allowNegative };
  const latest = useRef({ value, onChange, disabled, rules });
  latest.current = { value, onChange, disabled, rules };

  const press = (key: KeypadKey): void => {
    if (disabled) return;
    onChange(pressKey(value, key, rules));
  };

  // Typing anywhere on the page fills the answer, unless the child is typing somewhere else.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const now = latest.current;
      if (now.disabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target)) return;
      let key: KeypadKey | null = null;
      if (/^[0-9]$/.test(event.key)) key = event.key as KeypadKey;
      else if (event.key === '.' || event.key === ',') key = '.';
      else if (event.key === '-') key = '-';
      else if (event.key === 'Backspace') key = 'back';
      if (!key) return;
      const next = pressKey(now.value, key, now.rules);
      if (next !== now.value) now.onChange(next);
      if (key === 'back') event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const keyClass = cx(
    'flex min-h-16 items-center justify-center rounded-2xl border-4 border-brand-100 bg-white text-3xl font-extrabold text-ink-900 shadow-sm',
    'active:bg-brand-100 disabled:opacity-40',
    FOCUS_RING,
  );

  // Every key is a direct child of the grid, which gives it the width of its cell: a button
  // inside a plain wrapper would shrink to the width of its text.
  const keyButton = (key: KeypadKey, face: string, name?: string, wide = false): JSX.Element => (
    <motion.button
      key={key}
      type="button"
      whileTap={disabled ? undefined : { scale: 0.92 }}
      disabled={disabled}
      aria-label={name ?? face}
      onClick={() => press(key)}
      className={cx(keyClass, wide && 'col-span-3')}
    >
      <span aria-hidden="true">{face}</span>
    </motion.button>
  );

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
      <label className="flex items-center gap-3 rounded-3xl border-4 border-brand-300 bg-white px-4 py-2 shadow-inner focus-within:ring-4 focus-within:ring-sun-500">
        <span className="sr-only">{labels.yourAnswer}</span>
        <input
          type="text"
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label={interaction.unit ? `${labels.yourAnswer} (${interaction.unit})` : labels.yourAnswer}
          placeholder="?"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(sanitizeNumberText(event.target.value, rules))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onEnter?.();
            }
          }}
          className="min-h-14 w-full min-w-0 flex-1 border-0 bg-transparent text-right text-4xl font-extrabold text-brand-700 outline-none placeholder:text-brand-300"
        />
        {interaction.unit ? <span className="shrink-0 text-2xl font-bold text-ink-500">{interaction.unit}</span> : null}
      </label>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={labels.yourAnswer}>
        {DIGIT_ROWS.flat().map((key) => keyButton(key, key))}
        {interaction.allowNegative ? keyButton('-', '±', labels.minus) : interaction.allowDecimal ? keyButton('.', '.', labels.decimalPoint) : <span />}
        {keyButton('0', '0')}
        {keyButton('back', '⌫', labels.backspace)}
        {interaction.allowNegative && interaction.allowDecimal ? keyButton('.', '.', labels.decimalPoint, true) : null}
      </div>
    </div>
  );
}
