/** Small building blocks shared by the parent screens. */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Challenge } from '@/core/schemas';
import { ChallengeStage } from '@/engine';
import { useStageLabels, useT } from '@/i18n';
import { LIBRARY_NOTE_MAX } from '@/library';
import { Button, ConfirmDialog, cx, Field, Modal, Spinner, TextArea, TextInput, useReducedMotion } from '@/ui';
import { describeSolution } from './format';
import { GuardedLink } from './guard';
import { useFormat } from './hooks';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons at the right of the heading. */
  actions?: ReactNode;
  emoji?: string;
  /** 'danger' draws the coral frame of the danger zone. */
  tone?: 'plain' | 'danger';
  className?: string;
  children?: ReactNode;
}

/** A titled card: the unit every parent screen is made of. */
export function Section({ title, description, actions, emoji, tone = 'plain', className, children }: SectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        'rounded-3xl border bg-white p-5 shadow-card sm:p-6',
        tone === 'danger' ? 'border-coral-600' : 'border-ink-200',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={headingId} className="flex items-center gap-2 font-display text-xl font-bold leading-tight text-ink-900">
            {emoji !== undefined && <span aria-hidden="true">{emoji}</span>}
            {title}
          </h2>
          {description !== undefined && <p className="mt-1 text-sm text-ink-700">{description}</p>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children !== undefined && <div className="mt-4">{children}</div>}
    </section>
  );
}

export type NoteTone = 'info' | 'warning' | 'danger' | 'success';

const NOTE_TONE: Record<NoteTone, string> = {
  info: 'border-sky-600 bg-sky-100 text-ink-900',
  warning: 'border-sun-500 bg-sun-100 text-ink-900',
  danger: 'border-coral-600 bg-coral-100 text-ink-900',
  success: 'border-leaf-600 bg-leaf-100 text-ink-900',
};

const NOTE_EMOJI: Record<NoteTone, string> = { info: '💡', warning: '⚠️', danger: '⛔', success: '✅' };

/** A short callout. `role` lets a caller make it a live status or an alert. */
export function Note({
  tone = 'info',
  role,
  emoji,
  className,
  children,
}: {
  tone?: NoteTone;
  role?: 'status' | 'alert' | 'note';
  emoji?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role={role} className={cx('flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm', NOTE_TONE[tone], className)}>
      <span aria-hidden="true" className="text-lg leading-snug">
        {emoji ?? NOTE_EMOJI[tone]}
      </span>
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

/** A child's emoji avatar on a soft disc. */
export function Avatar({ emoji, size = 'md', className }: { emoji: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full border-2 border-brand-200 bg-brand-50 leading-none',
        size === 'lg' ? 'h-20 w-20 text-5xl' : size === 'sm' ? 'h-10 w-10 text-2xl' : 'h-14 w-14 text-3xl',
        className,
      )}
    >
      {emoji}
    </span>
  );
}

/** A label and a value on one line, for dense facts ("Tries: 2"). */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs font-bold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="text-sm font-semibold text-ink-900">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Star rating
// ---------------------------------------------------------------------------

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

function StarShape({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} className={filled ? 'text-sun-500' : 'text-ink-200'}>
      <path
        d="M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.1 1.1-6.5L2.6 9.5l6.5-.9z"
        fill="currentColor"
        stroke={filled ? 'var(--color-sun-700)' : 'var(--color-ink-400)'}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A rating shown, not edited: "4 of 5 stars" or "Not rated yet". */
export function RatingStars({ rating, size = 18, className }: { rating: number | null; size?: number; className?: string }) {
  const t = useT();
  const whole = rating === null ? 0 : Math.round(rating);
  return (
    <span
      role="img"
      aria-label={rating === null ? t('parent.rating.none') : t('parent.rating.value', { count: whole })}
      className={cx('inline-flex items-center gap-0.5', className)}
    >
      {STAR_VALUES.map((value) => (
        <StarShape key={value} filled={value <= whole} size={size} />
      ))}
    </span>
  );
}

export interface StarRatingProps {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
}

/** Five stars as a radio group: arrow keys move, pressing the chosen star again clears it. */
export function StarRating({ value, onChange, label, disabled = false }: StarRatingProps) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const whole = value === null ? 0 : Math.round(value);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(5, whole + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(1, whole - 1);
    else if (event.key === 'Home') next = 1;
    else if (event.key === 'End') next = 5;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    refs.current[next - 1]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={disabled ? undefined : move} className="inline-flex items-center gap-1">
      {STAR_VALUES.map((star) => {
        const checked = whole === star;
        return (
          <button
            key={star}
            ref={(node) => {
              refs.current[star - 1] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t('parent.rating.value', { count: star })}
            title={t('parent.rating.value', { count: star })}
            tabIndex={checked || (whole === 0 && star === 1) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(checked ? null : star)}
            className={cx(
              'inline-flex h-11 w-11 items-center justify-center rounded-xl transition-transform',
              'hover:bg-sun-100 active:scale-90 disabled:cursor-not-allowed disabled:opacity-55',
            )}
          >
            <StarShape filled={star <= whole} size={30} />
          </button>
        );
      })}
    </div>
  );
}

export interface RatingEditorProps {
  rating: number | null;
  note: string;
  /** True when the rating is kept on a library canvas (and steers reuse), false for a history-only rating. */
  libraryBacked: boolean;
  onSave: (rating: number | null, note: string) => Promise<void>;
  /** Called when the draft starts or stops differing from the stored values. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Stars, an optional note and an explicit save, with the rules spelled out. */
export function RatingEditor({ rating, note, libraryBacked, onSave, onDirtyChange }: RatingEditorProps) {
  const t = useT();
  const [draftRating, setDraftRating] = useState<number | null>(rating);
  const [draftNote, setDraftNote] = useState(note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the stored values when they change underneath (another tab, or after saving).
  useEffect(() => {
    setDraftRating(rating);
    setDraftNote(note);
  }, [rating, note]);

  const dirty = draftRating !== rating || draftNote.trim() !== note.trim();
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(draftRating, draftNote.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarRating value={draftRating} onChange={setDraftRating} label={t('parent.rating.label')} disabled={busy} />
        <span className="text-sm font-semibold text-ink-700">
          {draftRating === null ? t('parent.rating.none') : t(`parent.rating.meaning.${Math.round(draftRating)}`)}
        </span>
      </div>
      <Field
        label={t('parent.rating.note')}
        hint={draftRating !== null && draftRating <= 2 ? t('parent.rating.noteHintLow') : t('parent.rating.noteHint')}
      >
        <TextArea value={draftNote} onValueChange={setDraftNote} maxLength={LIBRARY_NOTE_MAX} rows={2} disabled={busy} />
      </Field>
      <p className="text-sm text-ink-500">{libraryBacked ? t('parent.rating.explainLibrary') : t('parent.rating.explainHistory')}</p>
      {error !== null && (
        <p role="alert" className="text-sm font-semibold text-coral-700">
          {error}
        </p>
      )}
      <div>
        <Button onClick={save} loading={busy} disabled={!dirty}>
          {t('parent.rating.save')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayModalProps {
  /** The exact canvas to show, or null when closed. */
  challenge: Challenge | null;
  onClose: () => void;
  /** Extra lines under the title, e.g. the skill and the grade. */
  subtitle?: ReactNode;
}

/**
 * Opens a canvas exactly as the child saw it, fully interactive. Nothing is recorded:
 * checking an answer only shows whether it was right.
 */
export function ReplayModal({ challenge, onClose, subtitle }: ReplayModalProps) {
  const fmt = useFormat();
  const { t } = fmt;
  const labels = useStageLabels();
  const calm = useReducedMotion();
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setResult(null);
    setResetKey((key) => key + 1);
  }, [challenge]);

  if (!challenge) return null;
  const solution = describeSolution(challenge, fmt.locale, t);

  return (
    <Modal open onClose={onClose} size="xl" title={challenge.title} description={subtitle}>
      <div className="flex flex-col gap-4">
        <Note tone="info" emoji="👀">
          {t('parent.replay.notRecorded')}
        </Note>
        <div>
          <p className="text-base text-ink-700">{challenge.intro}</p>
          <p className="mt-1 font-display text-xl font-bold leading-snug text-ink-900">{challenge.question}</p>
        </div>
        <div className="rounded-3xl border border-ink-200 bg-paper p-2 sm:p-3">
          <ChallengeStage
            challenge={challenge}
            labels={labels}
            reducedMotion={calm}
            celebrate={celebrate}
            resetKey={resetKey}
            onSubmit={(_answer, check) => {
              setResult(check.correct ? 'correct' : 'wrong');
              if (check.correct) setCelebrate((count) => count + 1);
            }}
          />
        </div>
        <div role="status" aria-live="polite" className="min-h-6">
          {result === 'correct' && <Note tone="success">{t('parent.replay.correct')}</Note>}
          {result === 'wrong' && (
            <Note tone="warning" emoji="🤔">
              {t('parent.replay.wrong')}
            </Note>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setResetKey((key) => key + 1);
              setResult(null);
            }}
          >
            {t('parent.replay.startOver')}
          </Button>
        </div>
        <details className="rounded-2xl border border-ink-200 bg-white px-4 py-3">
          <summary className="min-h-8 font-bold text-brand-700">{t('parent.replay.forParents')}</summary>
          <dl className="mt-3 flex flex-col gap-3 text-sm">
            {solution !== null && (
              <div>
                <dt className="font-bold text-ink-900">{t('parent.replay.answer')}</dt>
                <dd className="text-ink-700">{solution}</dd>
              </div>
            )}
            <div>
              <dt className="font-bold text-ink-900">{t('parent.replay.hints')}</dt>
              <dd className="text-ink-700">
                <ol className="list-decimal pl-5">
                  {challenge.hints.map((hint, index) => (
                    <li key={index}>{hint}</li>
                  ))}
                </ol>
              </dd>
            </div>
            <div>
              <dt className="font-bold text-ink-900">{t('parent.replay.walkthrough')}</dt>
              <dd className="text-ink-700">
                <ol className="list-decimal pl-5">
                  {challenge.walkthrough.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </dd>
            </div>
            <div>
              <dt className="font-bold text-ink-900">{t('parent.replay.explanation')}</dt>
              <dd className="text-ink-700">{challenge.explanation}</dd>
            </div>
            {challenge.teachBack && (
              <div>
                <dt className="font-bold text-ink-900">{t('parent.replay.teachBack')}</dt>
                <dd className="text-ink-700">{challenge.teachBack.prompt}</dd>
              </div>
            )}
            {challenge.funFact ? (
              <div>
                <dt className="font-bold text-ink-900">{t('parent.replay.funFact')}</dt>
                <dd className="text-ink-700">{challenge.funFact}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Typed confirmation
// ---------------------------------------------------------------------------

export interface TypedConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  /** The word the parent must type, e.g. "RESET". Compared without regard to case or outer spaces. */
  word: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** A destructive confirmation that only goes through after the parent typed a word. */
export function TypedConfirmDialog({ open, title, message, word, confirmLabel, busy = false, onConfirm, onCancel, children }: TypedConfirmDialogProps) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped('');
      setError(false);
    }
  }, [open]);

  const matches = typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();

  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (matches) onConfirm();
        else setError(true);
      }}
    >
      <div className="flex flex-col gap-3">
        {children}
        <Field label={t('parent.typed.label', { word })} error={error && !matches ? t('parent.typed.error', { word }) : undefined}>
          <TextInput
            value={typed}
            onValueChange={(value) => {
              setTyped(value);
              setError(false);
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches) onConfirm();
            }}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------------------
// Option cards (a radio group of explained choices)
// ---------------------------------------------------------------------------

export interface OptionCard<T extends string> {
  value: T;
  title: string;
  description: string;
  emoji?: string;
}

export interface OptionCardsProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: readonly OptionCard<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Lay the cards side by side from the `sm` or the `lg` breakpoint. Default 'sm'. */
  columnsFrom?: 'sm' | 'lg';
}

/** A few mutually exclusive choices, each with a plain-language explanation. */
export function OptionCards<T extends string>({ label, options, value, onChange, disabled = false, columnsFrom = 'sm' }: OptionCardsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === value);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    event.preventDefault();
    onChange(option.value);
    refs.current[next]?.focus();
  };
  const columns =
    options.length >= 3
      ? columnsFrom === 'lg'
        ? 'lg:grid-cols-3'
        : 'sm:grid-cols-3'
      : columnsFrom === 'lg'
        ? 'lg:grid-cols-2'
        : 'sm:grid-cols-2';
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={disabled ? undefined : move} className={cx('grid gap-3', columns)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              'flex h-full min-h-14 items-start gap-3 rounded-2xl border-2 p-4 text-left transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-55',
              selected ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:border-brand-300 hover:bg-ink-50',
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                selected ? 'border-brand-500 bg-brand-500' : 'border-ink-400 bg-white',
              )}
            >
              {selected && <span className="h-2 w-2 rounded-full bg-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-1.5 font-bold text-ink-900">
                {option.emoji !== undefined && <span aria-hidden="true">{option.emoji}</span>}
                {option.title}
              </span>
              <span className="mt-0.5 block text-sm text-ink-700">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** In-app path for a back link. */
  backTo?: string;
  backLabel?: string;
  /** Picture before the title (a child's avatar). */
  lead?: ReactNode;
  actions?: ReactNode;
}

/** The heading of a parent page: optional back link, title, subtitle and actions. */
export function PageHeader({ title, subtitle, backTo, backLabel, lead, actions }: PageHeaderProps) {
  const t = useT();
  const label = backLabel ?? t('common.back');
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
      {backTo !== undefined && (
        <GuardedLink
          to={backTo}
          aria-label={label}
          title={label}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-ink-200 bg-white text-ink-700 hover:bg-brand-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </GuardedLink>
      )}
      {lead}
      <div className="min-w-0 flex-1 basis-48">
        <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
        {subtitle !== undefined && <p className="text-sm text-ink-700 sm:text-base">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A centered spinner for a page or panel that is still reading from the device. */
export function PanelLoading() {
  const t = useT();
  return (
    <div className="flex justify-center py-12">
      <Spinner size="lg" label={t('common.loading')} />
    </div>
  );
}
