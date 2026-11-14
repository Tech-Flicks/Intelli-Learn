import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import './strings';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusableIn(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute('inert') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/** Open dialogs, top-most last. Only the top one reacts to Escape and traps focus. */
const openDialogs: HTMLElement[] = [];
let scrollLocks = 0;
let previousOverflow = '';

function lockScroll(): void {
  if (scrollLocks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
}

const SIZE = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export interface ModalProps {
  open: boolean;
  /** Called for Escape, the close button and a click on the backdrop. */
  onClose: () => void;
  /** Heading and accessible name of the dialog. Without it, pass `aria-label`. */
  title?: ReactNode;
  'aria-label'?: string;
  /** Short text under the title, wired to `aria-describedby`. */
  description?: ReactNode;
  children?: ReactNode;
  /** Action row at the bottom (buttons). */
  footer?: ReactNode;
  size?: keyof typeof SIZE;
  /** When false, Escape and the backdrop do nothing and there is no close button. */
  dismissible?: boolean;
  /** Hide the X button but keep Escape and the backdrop. */
  hideClose?: boolean;
  /** Element to focus when the dialog opens. Otherwise `[data-autofocus]`, else the dialog itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  role?: 'dialog' | 'alertdialog';
  /** Child-area look: rounder, larger heading. */
  playful?: boolean;
  className?: string;
}

/**
 * An accessible modal dialog: focus moves in and is trapped, Escape closes,
 * the page behind does not scroll, and focus returns to where it was.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  hideClose = false,
  initialFocusRef,
  role = 'dialog',
  playful = false,
  className,
  ...aria
}: ModalProps) {
  const t = useT();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Latest handlers, so the effect below does not re-run (and move focus) on every render.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    openDialogs.push(dialog);
    lockScroll();
    const isTop = () => openDialogs[openDialogs.length - 1] === dialog;

    // Move focus in, unless something inside already has it (autoFocus).
    if (!dialog.contains(document.activeElement)) {
      const target =
        initialFocusRef?.current ?? dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
      target.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        if (!dismissibleRef.current) return;
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableIn(dialog);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === dialog || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    // Focus that lands outside (a click on the page behind) is pulled back in.
    const onFocusIn = (event: FocusEvent) => {
      if (!isTop()) return;
      if (event.target instanceof Node && !dialog.contains(event.target)) dialog.focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      const index = openDialogs.indexOf(dialog);
      if (index >= 0) openDialogs.splice(index, 1);
      unlockScroll();
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissible && event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-ink-900/60 p-3 sm:items-center sm:p-6"
      onMouseDown={onBackdrop}
      data-modal-backdrop=""
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-label={aria['aria-label']}
        aria-labelledby={title !== undefined && !aria['aria-label'] ? titleId : undefined}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[calc(100dvh-1.5rem)] w-full animate-pop flex-col bg-white text-ink-900 shadow-lift outline-none',
          playful ? 'rounded-[2rem]' : 'rounded-3xl',
          SIZE[size],
          className,
        )}
      >
        {(title !== undefined || (dismissible && !hideClose)) && (
          <div className="flex items-start gap-3 px-6 pt-5">
            <div className="min-w-0 flex-1">
              {title !== undefined && (
                <h2
                  id={titleId}
                  className={cx('font-display font-bold leading-tight', playful ? 'text-3xl' : 'text-2xl')}
                >
                  {title}
                </h2>
              )}
              {description !== undefined && (
                <p id={descriptionId} className="mt-1 text-base text-ink-700">
                  {description}
                </p>
              )}
            </div>
            {dismissible && !hideClose && (
              <IconButton aria-label={t('ui.close')} onClick={onClose} className="-mr-2 -mt-1">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </IconButton>
            )}
          </div>
        )}
        {title === undefined && description !== undefined && (
          <p id={descriptionId} className="px-6 pt-5 text-base text-ink-700">
            {description}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer !== undefined && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-200 px-6 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** What will happen, in one or two sentences. */
  message?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for deleting or resetting. The safe button then gets the first focus. */
  tone?: 'primary' | 'danger';
  /** Shows a spinner on the confirm button and blocks both buttons. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

export function ConfirmDialog({
  open,
  title,
  message,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
  className,
}: ConfirmDialogProps) {
  const t = useT();
  const danger = tone === 'danger';
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      role="alertdialog"
      size="sm"
      dismissible={!busy}
      hideClose
      className={className}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus={danger ? '' : undefined}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            data-autofocus={danger ? undefined : ''}
          >
            {confirmLabel ?? t('common.ok')}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
