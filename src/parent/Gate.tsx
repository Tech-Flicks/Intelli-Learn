/**
 * The password screen in front of the parent area: tries left, a live countdown while
 * the gate is locked out, and the "forgot password" path, which is a full reset.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { getLockoutState, MAX_FAILED_ATTEMPTS, useParentGate } from '@/security';
import { Button, Field, PasswordInput } from '@/ui';
import { useNow } from './hooks';
import { Note, TypedConfirmDialog } from './parts';
import { resetDevice } from './reset';

/** The word a parent types to confirm a full reset. Not translated, so the instructions match in every language. */
export const RESET_WORD = 'RESET';

/** "1:05" for a countdown. */
export function countdownText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PasswordGate() {
  const t = useT();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_FAILED_ATTEMPTS);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  const now = useNow(250, lockedUntil !== null);
  const locked = lockedUntil !== null && now < lockedUntil;

  // The lockout survives reloads: show it right away, before any attempt.
  useEffect(() => {
    let alive = true;
    void getLockoutState().then((state) => {
      if (!alive) return;
      setAttemptsLeft(state.attemptsLeft);
      setLockedUntil(state.lockedUntil);
    });
    return () => {
      alive = false;
    };
  }, []);

  // When the countdown runs out, the form opens again with a fresh set of tries.
  useEffect(() => {
    if (lockedUntil === null || now < lockedUntil) return;
    setLockedUntil(null);
    setWrong(false);
    void getLockoutState().then((state) => {
      setAttemptsLeft(state.attemptsLeft);
      setLockedUntil(state.lockedUntil);
    });
  }, [now, lockedUntil]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || locked || password === '') return;
    setBusy(true);
    try {
      const result = await useParentGate.getState().unlock(password);
      if (result.ok) return; // the parent area replaces this screen
      setWrong(true);
      setAttemptsLeft(result.attemptsLeft);
      setLockedUntil(result.lockedUntil);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setWiping(true);
    try {
      await resetDevice();
      useParentGate.getState().lock();
      navigate('/setup', { replace: true });
    } finally {
      setWiping(false);
    }
  };

  let feedback: string | undefined;
  if (!locked && wrong) {
    feedback =
      attemptsLeft === 1 ? t('parent.gate.wrongOne') : t('parent.gate.wrongMany', { count: attemptsLeft });
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-paper px-4 py-8 text-ink-900">
      <div className="w-full max-w-md rounded-[2rem] border border-ink-200 bg-white p-6 shadow-lift sm:p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span aria-hidden="true" className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-5xl leading-none">
            🔒
          </span>
          <h1 className="font-display text-3xl font-bold leading-tight">{t('parent.gate.title')}</h1>
          <p className="text-base text-ink-700">{t('parent.gate.lead')}</p>
        </div>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
          <Field label={t('parent.gate.password')} error={feedback}>
            <PasswordInput
              value={password}
              onValueChange={(value) => {
                setPassword(value);
              }}
              autoComplete="current-password"
              autoFocus
              disabled={locked || busy}
            />
          </Field>
          {locked && lockedUntil !== null && (
            <Note tone="danger" role="alert" emoji="⏳">
              <p className="font-bold">{t('parent.gate.lockedTitle')}</p>
              <p>
                {t('parent.gate.lockedText')}{' '}
                <span data-testid="gate-countdown" className="font-bold tabular-nums">
                  {countdownText(lockedUntil - now)}
                </span>
              </p>
            </Note>
          )}
          <Button type="submit" size="lg" fullWidth loading={busy} disabled={locked || password === ''}>
            {t('parent.gate.unlock')}
          </Button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/kids')}>
            {t('parent.gate.backToKids')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
            {t('parent.gate.forgot')}
          </Button>
        </div>
      </div>

      <TypedConfirmDialog
        open={resetOpen}
        title={t('parent.gate.resetTitle')}
        message={t('parent.gate.resetMessage')}
        word={RESET_WORD}
        confirmLabel={t('parent.gate.resetConfirm')}
        busy={wiping}
        onCancel={() => setResetOpen(false)}
        onConfirm={reset}
      >
        <Note tone="danger">{t('parent.gate.resetWarning')}</Note>
      </TypedConfirmDialog>
    </div>
  );
}
