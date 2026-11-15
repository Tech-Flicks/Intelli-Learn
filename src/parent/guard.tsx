/**
 * Unsaved-changes guard for the parent area.
 *
 * A form reports `useUnsavedChanges(dirty)`. Everything that leaves the current section
 * (side navigation, tabs, back links, the lock button) goes through `useLeaveGuard()`,
 * which runs the action at once when nothing is unsaved and asks first otherwise.
 * The app uses a plain `BrowserRouter`, so the router cannot block the browser's own
 * back button; closing or reloading the page is covered by `beforeunload`.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate, type LinkProps } from 'react-router-dom';
import { useT } from '@/i18n';
import { ConfirmDialog } from '@/ui';

/** Ids of the mounted forms that currently hold unsaved changes. */
const dirtyForms = new Set<string>();

export function hasUnsavedChanges(): boolean {
  return dirtyForms.size > 0;
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (dirtyForms.size === 0) return;
  event.preventDefault();
  // Older browsers need a return value to show their own "leave this page?" prompt.
  event.returnValue = '';
}

/** Marks the calling form as holding unsaved changes while `dirty` is true. */
export function useUnsavedChanges(dirty: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    dirtyForms.add(id);
    if (dirtyForms.size === 1) window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      dirtyForms.delete(id);
      if (dirtyForms.size === 0) window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty, id]);
}

type Leave = (action: () => void) => void;

const LeaveContext = createContext<Leave>((action) => action());

/** Mount once around the parent area. Shows the "leave without saving?" dialog. */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<{ run: () => void } | null>(null);

  const leave = useCallback<Leave>((action) => {
    if (dirtyForms.size === 0) action();
    else setPending({ run: action });
  }, []);

  return (
    <LeaveContext.Provider value={leave}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        tone="danger"
        title={t('parent.unsaved.title')}
        message={t('parent.unsaved.message')}
        confirmLabel={t('parent.unsaved.leave')}
        cancelLabel={t('parent.unsaved.stay')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const run = pending?.run;
          setPending(null);
          // The forms about to unmount would clear themselves; clear now so the action is not asked again.
          dirtyForms.clear();
          window.removeEventListener('beforeunload', onBeforeUnload);
          run?.();
        }}
      />
    </LeaveContext.Provider>
  );
}

/** Runs an action that leaves the current section, after asking when changes are unsaved. */
export function useLeaveGuard(): Leave {
  return useContext(LeaveContext);
}

/** `navigate` that asks first when changes are unsaved. */
export function useGuardedNavigate(): (to: string, options?: { replace?: boolean }) => void {
  const navigate = useNavigate();
  const leave = useLeaveGuard();
  return useMemo(() => (to, options) => leave(() => navigate(to, options)), [leave, navigate]);
}

/** A router link that asks first when changes are unsaved. */
export function GuardedLink({ to, onClick, ...rest }: LinkProps) {
  const navigate = useNavigate();
  const leave = useLeaveGuard();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || dirtyForms.size === 0) return;
    // Let the browser handle "open in new tab" and friends.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    leave(() => navigate(to));
  };
  return <Link to={to} {...rest} onClick={handle} />;
}
