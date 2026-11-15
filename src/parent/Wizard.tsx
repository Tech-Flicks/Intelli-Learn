/**
 * First-run setup. Six steps: welcome and language, parent password, AI connection,
 * parental controls, the first child, done.
 *
 * Everything the parent enters is held in memory. The password, the settings and the
 * child are written together when the last form step is finished, and `setupComplete`
 * is the very last thing to be set. Only the interface language is stored at once, so
 * the wizard itself switches language.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { resetAiSession } from '@/ai';
import { LOCALES, type ChildProfile, type Locale, type ParentalControls, type Settings } from '@/core/types';
import { createChild, updateSettings } from '@/data';
import { LOCALE_NAMES, gradeName, setLocale, useT } from '@/i18n';
import { cryptoAvailable, hasApiKey, INSECURE_CONTEXT_MESSAGE, setAdminPassword, setApiKey, useParentGate } from '@/security';
import { Button, cx, Field, PasswordInput, Select, Spinner, useReducedMotion } from '@/ui';
import { AiConnectionForm } from './forms/AiConnectionForm';
import { aiDraftOf, aiSettingsOf, draftBaseUrl, draftHasImageModel, validateAiDraft, type AiDraft, type AiErrors } from './forms/aiForm';
import { ChildForm, childDraftToInput, emptyChildDraft, validateChildDraft, type ChildDraft, type ChildDraftErrors } from './forms/ChildForm';
import { ControlsForm, validateControls, type ControlsErrors } from './forms/ControlsForm';
import { validateNewPassword, type NewPasswordErrors } from './forms/password';
import { useSettings } from './hooks';
import { Avatar, Note } from './parts';
import './strings';

const STEPS = ['welcome', 'password', 'ai', 'controls', 'child', 'done'] as const;
type Step = (typeof STEPS)[number];

const STEP_EMOJI: Record<Step, string> = { welcome: '👋', password: '🔒', ai: '✨', controls: '🎛️', child: '🧒', done: '🎉' };

function WizardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="child-bg flex min-h-full flex-col items-center px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-ink-900 sm:px-6 sm:pt-8">
      {children}
    </div>
  );
}

/** The numbered trail at the top: where the parent is and how much is left. */
function StepTrail({ current }: { current: Step }) {
  const t = useT();
  const index = STEPS.indexOf(current);
  return (
    <nav aria-label={t('parent.wizard.progress')} className="w-full">
      <ol className="flex items-center">
        {STEPS.map((step, position) => {
          const done = position < index;
          const active = position === index;
          return (
            <li key={step} aria-current={active ? 'step' : undefined} className={cx('flex items-center', position > 0 && 'flex-1')}>
              {position > 0 && <span aria-hidden="true" className={cx('mx-1 h-1 flex-1 rounded-full sm:mx-2', done || active ? 'bg-brand-500' : 'bg-ink-200')} />}
              <span
                className={cx(
                  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors sm:h-10 sm:w-10',
                  active && 'border-brand-500 bg-brand-500 text-white shadow-card',
                  done && 'border-brand-500 bg-brand-100 text-brand-700',
                  !active && !done && 'border-ink-200 bg-white text-ink-500',
                )}
              >
                <span aria-hidden="true">{done ? '✓' : position + 1}</span>
                <span className="sr-only">
                  {t('parent.wizard.stepOf', { index: position + 1, total: STEPS.length })}: {t(`parent.wizard.step.${step}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p aria-hidden="true" className="mt-2 text-center text-sm font-bold text-ink-700">
        {t('parent.wizard.stepOf', { index: index + 1, total: STEPS.length })} · {t(`parent.wizard.step.${current}`)}
      </p>
    </nav>
  );
}

function StepHeading({ step, title, lead }: { step: Step; title: string; lead: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // Move focus to the new step, so keyboard and screen-reader users land at its start.
  useEffect(() => {
    ref.current?.focus();
  }, [step]);
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="text-4xl leading-none sm:text-5xl">
        {STEP_EMOJI[step]}
      </span>
      <div className="min-w-0 flex-1">
        <h2 ref={ref} tabIndex={-1} className="font-display text-2xl font-bold leading-tight outline-none sm:text-3xl">
          {title}
        </h2>
        <p className="mt-1 text-base text-ink-700">{lead}</p>
      </div>
    </div>
  );
}

interface Finished {
  child: ChildProfile;
  provider: Settings['ai']['provider'];
  dailyMinutes: number;
}

/** How many wizards are mounted. React StrictMode mounts, unmounts and mounts again. */
let mountedWizards = 0;

function WizardBody({ initial }: { initial: Settings }) {
  const t = useT();
  const navigate = useNavigate();
  const calm = useReducedMotion();

  const [step, setStep] = useState<Step>('welcome');
  const [locale, setLocaleState] = useState<Locale>(initial.locale);
  const [contentLocale, setContentLocale] = useState<Locale>(initial.contentLocale);
  const [contentTouched, setContentTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<NewPasswordErrors>({});
  const [aiDraft, setAiDraft] = useState<AiDraft>(() => aiDraftOf(initial.ai));
  const [aiErrors, setAiErrors] = useState<AiErrors>({});
  const [controls, setControls] = useState<ParentalControls>(() => ({ ...initial.controls, strands: { ...initial.controls.strands } }));
  const [controlsErrors, setControlsErrors] = useState<ControlsErrors>({});
  const [childDraft, setChildDraft] = useState<ChildDraft>(emptyChildDraft);
  const [childErrors, setChildErrors] = useState<ChildDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  /** A child created by an earlier, interrupted finish: never create a second one. */
  const createdChild = useRef<ChildProfile | null>(null);
  /** True once this wizard unlocked the gate (at the end of `finish`). */
  const unlockedHere = useRef(false);
  /** True when the parent chose "Open parent area": the one way out that keeps the gate open. */
  const toParentArea = useRef(false);

  // The gate is unlocked on the last step so the parent can walk straight into the parent
  // area. Any other way out of the wizard (the browser or device back button, a typed
  // address) must lock it again: the parent shell, which normally does that, is not mounted
  // here. The check waits a tick so a StrictMode remount does not lock.
  useEffect(() => {
    mountedWizards += 1;
    return () => {
      mountedWizards -= 1;
      queueMicrotask(() => {
        if (mountedWizards === 0 && unlockedHere.current && !toParentArea.current) useParentGate.getState().lock();
      });
    };
  }, []);

  const secure = cryptoAvailable();
  const index = STEPS.indexOf(step);

  const chooseLocale = (next: Locale) => {
    setLocaleState(next);
    // Until the parent picks a content language themselves, it follows the interface language.
    if (!contentTouched) setContentLocale(next);
    setLocale(next);
    void updateSettings({ locale: next });
  };

  const goTo = (next: Step) => {
    setStep(next);
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0 });
      } catch {
        // jsdom has no scrolling; nothing to do.
      }
    }
  };

  const back = () => {
    const previous = STEPS[index - 1];
    if (previous) goTo(previous);
  };

  const finish = async () => {
    setBusy(true);
    setFinishError(null);
    try {
      await setAdminPassword(password);
      const imagesPossible = draftHasImageModel(aiDraft);
      const savedControls: ParentalControls = { ...controls, aiImages: controls.aiImages && imagesPossible };
      await updateSettings((current) => ({
        ...current,
        ai: aiSettingsOf(aiDraft, current.ai),
        controls: savedControls,
        locale,
        contentLocale,
      }));
      const typedKey = aiDraft.apiKey.trim();
      if (aiDraft.provider === 'direct' && typedKey !== '') await setApiKey(typedKey, draftBaseUrl(aiDraft));
      else if (await hasApiKey()) await setApiKey(null);
      const child = createdChild.current ?? (await createChild(childDraftToInput(childDraft)));
      createdChild.current = child;
      // The very last write: from here on the app counts as set up.
      await updateSettings({ setupComplete: true });
      resetAiSession();
      unlockedHere.current = true;
      await useParentGate.getState().unlock(password);
      setFinished({ child, provider: aiDraft.provider, dailyMinutes: savedControls.dailyMinutes });
      setPassword('');
      setConfirm('');
      setAiDraft((draft) => ({ ...draft, apiKey: '' }));
      goTo('done');
    } catch (cause) {
      setFinishError(cause instanceof Error && cause.message ? cause.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (step === 'welcome') {
      goTo('password');
    } else if (step === 'password') {
      if (!secure) return;
      const errors = validateNewPassword(password, confirm, t);
      setPasswordErrors(errors);
      if (Object.keys(errors).length === 0) goTo('ai');
    } else if (step === 'ai') {
      const errors = validateAiDraft(aiDraft, false, t);
      setAiErrors(errors);
      if (Object.keys(errors).length === 0) goTo('controls');
    } else if (step === 'controls') {
      const errors = validateControls(controls, t);
      setControlsErrors(errors);
      if (Object.keys(errors).length === 0) goTo('child');
    } else if (step === 'child') {
      const errors = validateChildDraft(childDraft, t);
      setChildErrors(errors);
      if (Object.keys(errors).length === 0) void finish();
    }
  };

  let content: ReactNode;
  if (step === 'welcome') {
    content = (
      <>
        <StepHeading step={step} title={t('parent.wizard.welcome.title')} lead={t('parent.wizard.welcome.lead')} />
        <ul className="grid gap-3 sm:grid-cols-3">
          {(['learn', 'device', 'control'] as const).map((point, position) => (
            <motion.li
              key={point}
              initial={calm ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: calm ? 0 : 0.08 * position, type: 'spring', stiffness: 260, damping: 22 }}
              className="rounded-2xl border border-brand-200 bg-brand-50 p-4"
            >
              <span aria-hidden="true" className="text-3xl leading-none">
                {point === 'learn' ? '🚀' : point === 'device' ? '📱' : '🧭'}
              </span>
              <h3 className="mt-2 font-display text-lg font-bold leading-tight">{t(`parent.wizard.welcome.${point}.title`)}</h3>
              <p className="mt-1 text-sm text-ink-700">{t(`parent.wizard.welcome.${point}.text`)}</p>
            </motion.li>
          ))}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('parent.language.interface')} hint={t('parent.language.interfaceHint')}>
            <Select
              value={locale}
              onValueChange={(value) => chooseLocale(value as Locale)}
              options={LOCALES.map((entry) => ({ value: entry, label: LOCALE_NAMES[entry] }))}
            />
          </Field>
          <Field label={t('parent.language.content')} hint={t('parent.language.contentHint')}>
            <Select
              value={contentLocale}
              onValueChange={(value) => {
                setContentTouched(true);
                setContentLocale(value as Locale);
              }}
              options={LOCALES.map((entry) => ({ value: entry, label: LOCALE_NAMES[entry] }))}
            />
          </Field>
        </div>
      </>
    );
  } else if (step === 'password') {
    content = (
      <>
        <StepHeading step={step} title={t('parent.wizard.password.title')} lead={t('parent.wizard.password.lead')} />
        {!secure ? (
          <Note tone="danger" role="alert">
            <p className="font-bold">{INSECURE_CONTEXT_MESSAGE}</p>
            <p className="mt-1">{t('parent.wizard.password.insecureGuidance')}</p>
          </Note>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              next();
            }}
          >
            <Field label={t('parent.password.new')} hint={t('parent.password.rules')} error={passwordErrors.password} required>
              <PasswordInput
                value={password}
                onValueChange={(value) => {
                  setPassword(value);
                  setPasswordErrors({});
                }}
                autoComplete="new-password"
              />
            </Field>
            <Field label={t('parent.password.confirm')} error={passwordErrors.confirm} required>
              <PasswordInput
                value={confirm}
                onValueChange={(value) => {
                  setConfirm(value);
                  setPasswordErrors({});
                }}
                autoComplete="new-password"
              />
            </Field>
            {/* Enter in either field goes on, like the Next button. */}
            <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
            <Note tone="warning">
              <p className="font-bold">{t('parent.wizard.password.forgetTitle')}</p>
              <p>{t('parent.wizard.password.forgetText')}</p>
            </Note>
          </form>
        )}
      </>
    );
  } else if (step === 'ai') {
    content = (
      <>
        <StepHeading step={step} title={t('parent.wizard.ai.title')} lead={t('parent.wizard.ai.lead')} />
        <AiConnectionForm
          draft={aiDraft}
          onChange={(draft) => {
            setAiDraft(draft);
            setAiErrors({});
          }}
          errors={aiErrors}
          hasStoredKey={false}
        />
      </>
    );
  } else if (step === 'controls') {
    content = (
      <>
        <StepHeading step={step} title={t('parent.wizard.controls.title')} lead={t('parent.wizard.controls.lead')} />
        <ControlsForm
          value={controls}
          onChange={(value) => {
            setControls(value);
            setControlsErrors({});
          }}
          errors={controlsErrors}
          imageModelSet={draftHasImageModel(aiDraft)}
        />
      </>
    );
  } else if (step === 'child') {
    content = (
      <>
        <StepHeading step={step} title={t('parent.wizard.child.title')} lead={t('parent.wizard.child.lead')} />
        <ChildForm
          draft={childDraft}
          onChange={(draft) => {
            setChildDraft(draft);
            setChildErrors({});
          }}
          errors={childErrors}
          disabled={busy}
        />
        {finishError !== null && (
          <Note tone="danger" role="alert">
            {finishError}
          </Note>
        )}
      </>
    );
  } else {
    content = (
      <>
        <StepHeading step={step} title={t('parent.wizard.done.title')} lead={t('parent.wizard.done.lead')} />
        {finished && (
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-brand-200 bg-brand-50 p-5 text-center sm:flex-row sm:text-left">
            <motion.div
              initial={calm ? false : { scale: 0.4, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 12 }}
            >
              <Avatar emoji={finished.child.avatar} size="lg" />
            </motion.div>
            <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-base font-semibold text-ink-900">
              <li>✅ {t('parent.wizard.done.password')}</li>
              <li>✅ {t(`parent.wizard.done.ai.${finished.provider}`)}</li>
              <li>✅ {t('parent.wizard.done.minutes', { count: finished.dailyMinutes })}</li>
              <li>
                ✅ {t('parent.wizard.done.child', { name: finished.child.nickname, grade: gradeName(finished.child.grade) })}
              </li>
            </ul>
          </div>
        )}
        <p className="text-sm text-ink-700">{t('parent.wizard.done.hint')}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            icon="🚀"
            fullWidth
            onClick={() => {
              // The child takes over the device now: close the parent area behind us.
              useParentGate.getState().lock();
              navigate('/kids');
            }}
          >
            {t('parent.wizard.done.play')}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            onClick={() => {
              toParentArea.current = true;
              navigate('/parent');
            }}
          >
            {t('parent.wizard.done.parentArea')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <WizardFrame>
      <div className="flex w-full max-w-3xl flex-col gap-5">
        <header className="flex items-center justify-center gap-2">
          <motion.span
            aria-hidden="true"
            className="text-4xl leading-none"
            animate={calm ? undefined : { y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            🦉
          </motion.span>
          <h1 className="font-display text-3xl font-bold leading-none text-brand-700">{t('common.appName')}</h1>
        </header>
        <StepTrail current={step} />
        <div className="rounded-[2rem] border border-ink-200 bg-white p-5 shadow-lift sm:p-8">
          {/* Keyed by step: each step slides in. No exit animation, so a step is never left half shown. */}
          <motion.div
            key={step}
            initial={calm ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex flex-col gap-6"
          >
            {content}
          </motion.div>
          {step !== 'done' && (
            <div className="mt-8 flex items-center justify-between gap-3 border-t border-ink-200 pt-5">
              {index > 0 ? (
                <Button variant="ghost" size="lg" onClick={back} disabled={busy}>
                  {t('common.back')}
                </Button>
              ) : (
                <span />
              )}
              <Button size="lg" onClick={next} loading={busy} disabled={step === 'password' && !secure}>
                {step === 'child' ? t('parent.wizard.finish') : step === 'welcome' ? t('parent.wizard.start') : t('common.next')}
              </Button>
            </div>
          )}
        </div>
        <p className="text-center text-sm text-ink-700">{t('parent.wizard.footer')}</p>
      </div>
    </WizardFrame>
  );
}

export function SetupWizard() {
  const t = useT();
  const settings = useSettings();
  // The decision "is this device already set up?" is taken once, from the first settings
  // read. The wizard itself sets `setupComplete` at the end and must not redirect then.
  const first = useRef<Settings | null>(null);
  if (settings && !first.current) first.current = settings;
  if (!first.current) {
    return (
      <WizardFrame>
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="lg" label={t('common.loading')} />
        </div>
      </WizardFrame>
    );
  }
  if (first.current.setupComplete) return <Navigate to="/parent" replace />;
  return <WizardBody initial={first.current} />;
}
