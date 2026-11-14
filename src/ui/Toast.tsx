/**
 * Toasts: short, polite messages that go away on their own.
 *
 *   const toast = useToast();
 *   toast.success('Saved');
 *
 * Messages are read by screen readers through an `aria-live="polite"` region
 * (`ToastViewport`). Mount `<ToastViewport />` once near the app root; if none
 * is mounted, one is added to `<body>` automatically the first time it is needed.
 */
import { useEffect, useSyncExternalStore, type HTMLAttributes } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'motion/react';
import { useT } from '@/i18n';
import { useReducedMotion } from './accessibility';
import { cx } from './cx';
import './strings';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  emoji: string;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** How long it stays. Default 4 s (6 s for errors). 0 keeps it until dismissed. */
  durationMs?: number;
  /** Replaces the default emoji for the tone. */
  emoji?: string;
}

export const MAX_TOASTS = 3;
const DEFAULT_DURATION: Record<ToastTone, number> = { info: 4000, success: 4000, error: 6000 };
const DEFAULT_EMOJI: Record<ToastTone, string> = { info: '💡', success: '✅', error: '⚠️' };

// --- store ------------------------------------------------------------------

let items: readonly ToastItem[] = [];
let counter = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getItems(): readonly ToastItem[] {
  return items;
}

/** Removes one toast, or all of them when no id is given. */
export function dismissToast(id?: string): void {
  const leaving = id === undefined ? items : items.filter((item) => item.id === id);
  if (leaving.length === 0) return;
  for (const item of leaving) {
    clearTimeout(timers.get(item.id));
    timers.delete(item.id);
  }
  items = id === undefined ? [] : items.filter((item) => item.id !== id);
  emit();
}

/** Shows a toast from anywhere (also outside React). Returns its id. */
export function showToast(message: string, options: ToastOptions = {}): string {
  ensureViewport();
  const tone = options.tone ?? 'info';
  counter += 1;
  const id = `toast-${counter}`;
  const next = [...items, { id, message, tone, emoji: options.emoji ?? DEFAULT_EMOJI[tone] }];
  // Keep the screen calm: the oldest ones make room.
  for (const dropped of next.splice(0, Math.max(0, next.length - MAX_TOASTS))) {
    clearTimeout(timers.get(dropped.id));
    timers.delete(dropped.id);
  }
  items = next;
  const duration = options.durationMs ?? DEFAULT_DURATION[tone];
  if (duration > 0) timers.set(id, setTimeout(() => dismissToast(id), duration));
  emit();
  return id;
}

export interface ToastApi {
  show: (message: string, options?: ToastOptions) => string;
  success: (message: string, options?: Omit<ToastOptions, 'tone'>) => string;
  error: (message: string, options?: Omit<ToastOptions, 'tone'>) => string;
  dismiss: (id?: string) => void;
}

const api: ToastApi = {
  show: showToast,
  success: (message, options) => showToast(message, { ...options, tone: 'success' }),
  error: (message, options) => showToast(message, { ...options, tone: 'error' }),
  dismiss: dismissToast,
};

/** Stable toast functions. Also makes sure the live region exists before the first message. */
export function useToast(): ToastApi {
  useEffect(() => {
    ensureViewport();
  }, []);
  return api;
}

// --- viewport mounting ------------------------------------------------------

let explicitViewports = 0;
let autoHost: HTMLElement | null = null;

function ensureViewport(): void {
  if (autoHost || explicitViewports > 0 || typeof document === 'undefined') return;
  autoHost = document.createElement('div');
  autoHost.dataset.toastHost = 'auto';
  document.body.appendChild(autoHost);
  createRoot(autoHost).render(<ToastViewport auto />);
}

function getExplicitCount(): number {
  return explicitViewports;
}

// --- components -------------------------------------------------------------

/** Text and border colours are AA on the white surface. */
const TONE: Record<ToastTone, string> = {
  info: 'border-brand-500',
  success: 'border-leaf-600',
  error: 'border-coral-700',
};

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  toast: ToastItem;
  onDismiss?: (id: string) => void;
}

/** One toast. Usually rendered by `ToastViewport`. */
export function Toast({ toast, onDismiss, className, ...rest }: ToastProps) {
  const t = useT();
  return (
    <div
      {...rest}
      data-tone={toast.tone}
      className={cx(
        'pointer-events-auto flex w-full items-center gap-3 rounded-2xl border-2 bg-white py-2 pl-4 pr-2 text-ink-900 shadow-lift',
        TONE[toast.tone],
        className,
      )}
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        {toast.emoji}
      </span>
      <p className="min-w-0 flex-1 py-1 text-base font-bold">{toast.message}</p>
      {onDismiss && (
        <button
          type="button"
          aria-label={t('ui.dismiss')}
          onClick={() => onDismiss(toast.id)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-700 hover:bg-brand-50"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

export interface ToastViewportProps {
  className?: string;
  /** Internal: the automatically mounted fallback, which steps aside for an explicit viewport. */
  auto?: boolean;
}

/** The polite live region that shows the current toasts. Mount it once. */
export function ToastViewport({ className, auto = false }: ToastViewportProps) {
  const current = useSyncExternalStore(subscribe, getItems, getItems);
  const explicit = useSyncExternalStore(subscribe, getExplicitCount, getExplicitCount);
  const calm = useReducedMotion();

  useEffect(() => {
    if (auto) return;
    explicitViewports += 1;
    emit();
    return () => {
      explicitViewports -= 1;
      emit();
    };
  }, [auto]);

  if (auto && explicit > 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      data-toast-viewport=""
      className={cx(
        'pointer-events-none fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-md flex-col gap-2 px-4',
        'pb-[max(1rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {current.map((toast) => (
          <motion.div
            key={toast.id}
            layout={!calm}
            initial={calm ? false : { opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={calm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          >
            <Toast toast={toast} onDismiss={dismissToast} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
