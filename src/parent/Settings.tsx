/**
 * Settings, in sections: AI connection, parental controls, language, password, backup
 * and restore, danger zone, about and privacy. Each form saves explicitly.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { resetAiSession } from '@/ai';
import { LOCALES, type Locale, type ParentalControls, type Settings } from '@/core/types';
import { downloadBackup, exportBackup, importBackup, readBackupFile, updateSettings, type ImportResult } from '@/data';
import { LOCALE_NAMES } from '@/i18n';
import { changeAdminPassword, getLockoutState, hasApiKey, setApiKey, useParentGate } from '@/security';
import { Button, ConfirmDialog, Field, PasswordInput, Select, TabPanel, Tabs, useToast } from '@/ui';
import { AiConnectionForm } from './forms/AiConnectionForm';
import { aiDraftOf, aiSettingsOf, sameAiDraft, validateAiDraft, type AiDraft, type AiErrors } from './forms/aiForm';
import { resetDevice } from './reset';
import { ControlsForm, sameControls, validateControls, type ControlsErrors } from './forms/ControlsForm';
import { validateNewPassword, type NewPasswordErrors } from './forms/password';
import { countdownText, RESET_WORD } from './Gate';
import { useLeaveGuard, useUnsavedChanges } from './guard';
import { useAsync, useFormat, useNow, useSettings, useTabInView } from './hooks';
import { UsageMeters } from './Overview';
import { Note, OptionCards, PageHeader, PanelLoading, Section, TypedConfirmDialog } from './parts';

const SECTIONS = ['ai', 'controls', 'language', 'password', 'backup', 'danger', 'about'] as const;
type SectionId = (typeof SECTIONS)[number];
const SECTION_EMOJI: Record<SectionId, string> = { ai: '✨', controls: '🎛️', language: '🌍', password: '🔑', backup: '💾', danger: '⚠️', about: 'ℹ️' };
const ID_BASE = 'settings';

/** The Save / Discard row at the end of a settings form. */
function FormActions({ dirty, busy, onDiscard, saveLabel }: { dirty: boolean; busy: boolean; onDiscard: () => void; saveLabel: string }) {
  const { t } = useFormat();
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-ink-200 pt-4">
      {dirty && (
        <p role="status" className="mr-auto text-sm font-bold text-sun-700">
          {t('parent.form.unsaved')}
        </p>
      )}
      <Button variant="secondary" onClick={onDiscard} disabled={!dirty || busy}>
        {t('parent.form.discard')}
      </Button>
      <Button type="submit" loading={busy} disabled={!dirty}>
        {saveLabel}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI connection
// ---------------------------------------------------------------------------

function AiSection({ settings }: { settings: Settings }) {
  const { t } = useFormat();
  const toast = useToast();
  const [draft, setDraft] = useState<AiDraft>(() => aiDraftOf(settings.ai));
  const [errors, setErrors] = useState<AiErrors>({});
  const [busy, setBusy] = useState(false);
  const [keyVersion, setKeyVersion] = useState(0);
  // Only "is a key stored", never the key itself.
  const storedKey = useAsync(() => hasApiKey(), [keyVersion]);
  const hasStoredKey = storedKey === true;

  const dirty = !sameAiDraft(draft, aiDraftOf(settings.ai));
  useUnsavedChanges(dirty);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const problems = validateAiDraft(draft, hasStoredKey, t);
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      toast.error(t('parent.form.fixErrors'));
      return;
    }
    setBusy(true);
    try {
      const saved = await updateSettings((current) => ({ ...current, ai: aiSettingsOf(draft, current.ai) }));
      const typedKey = draft.apiKey.trim();
      if (draft.removeKey) await setApiKey(null);
      else if (draft.provider === 'direct' && typedKey !== '') await setApiKey(typedKey);
      // The AI client must forget what it learned about the previous endpoint.
      resetAiSession();
      setDraft(aiDraftOf(saved.ai));
      setKeyVersion((version) => version + 1);
      toast.success(t('parent.settings.ai.saved'));
    } catch (cause) {
      toast.error(cause instanceof Error && cause.message ? cause.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <Section emoji="✨" title={t('parent.settings.ai.title')} description={t('parent.settings.ai.hint')}>
        <AiConnectionForm
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setErrors({});
          }}
          errors={errors}
          hasStoredKey={hasStoredKey}
          disabled={busy}
        >
          <div className="mt-4 border-t border-ink-200 pt-4">
            <h3 className="mb-2 font-bold text-ink-900">{t('parent.usage.title')}</h3>
            <UsageMeters settings={settings} />
          </div>
        </AiConnectionForm>
        <FormActions dirty={dirty} busy={busy} onDiscard={() => { setDraft(aiDraftOf(settings.ai)); setErrors({}); }} saveLabel={t('parent.settings.ai.save')} />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Parental controls
// ---------------------------------------------------------------------------

function copyControls(controls: ParentalControls): ParentalControls {
  return { ...controls, strands: { ...controls.strands } };
}

function ControlsSection({ settings }: { settings: Settings }) {
  const { t } = useFormat();
  const toast = useToast();
  const [draft, setDraft] = useState<ParentalControls>(() => copyControls(settings.controls));
  const [errors, setErrors] = useState<ControlsErrors>({});
  const [busy, setBusy] = useState(false);
  const imageModelSet = settings.ai.provider !== 'demo' && settings.ai.imageModel.trim() !== '';

  const dirty = !sameControls(draft, settings.controls);
  useUnsavedChanges(dirty);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const problems = validateControls(draft, t);
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      toast.error(t('parent.form.fixErrors'));
      return;
    }
    setBusy(true);
    try {
      const saved = await updateSettings((current) => ({ ...current, controls: copyControls(draft) }));
      setDraft(copyControls(saved.controls));
      toast.success(t('parent.settings.controls.saved'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <Section emoji="🎛️" title={t('parent.settings.controls.title')} description={t('parent.settings.controls.hint')}>
        <ControlsForm
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setErrors({});
          }}
          errors={errors}
          imageModelSet={imageModelSet}
          disabled={busy}
        />
        <FormActions
          dirty={dirty}
          busy={busy}
          onDiscard={() => {
            setDraft(copyControls(settings.controls));
            setErrors({});
          }}
          saveLabel={t('parent.settings.controls.save')}
        />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

function LanguageSection({ settings }: { settings: Settings }) {
  const { t } = useFormat();
  const toast = useToast();
  const [locale, setLocale] = useState<Locale>(settings.locale);
  const [contentLocale, setContentLocale] = useState<Locale>(settings.contentLocale);
  const [busy, setBusy] = useState(false);
  const options = LOCALES.map((entry) => ({ value: entry, label: LOCALE_NAMES[entry] }));

  const dirty = locale !== settings.locale || contentLocale !== settings.contentLocale;
  useUnsavedChanges(dirty);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      // The app shell applies the interface language as soon as the setting is stored.
      await updateSettings({ locale, contentLocale });
      toast.success(t('parent.settings.language.saved'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <Section emoji="🌍" title={t('parent.settings.language.title')} description={t('parent.settings.language.hint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('parent.language.interface')} hint={t('parent.language.interfaceHint')}>
            <Select value={locale} onValueChange={(value) => setLocale(value as Locale)} options={options} disabled={busy} />
          </Field>
          <Field label={t('parent.language.content')} hint={t('parent.language.contentHint')}>
            <Select value={contentLocale} onValueChange={(value) => setContentLocale(value as Locale)} options={options} disabled={busy} />
          </Field>
        </div>
        <FormActions
          dirty={dirty}
          busy={busy}
          onDiscard={() => {
            setLocale(settings.locale);
            setContentLocale(settings.contentLocale);
          }}
          saveLabel={t('parent.settings.language.save')}
        />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordSection() {
  const { t } = useFormat();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<NewPasswordErrors & { current?: string }>({});
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(250, lockedUntil !== null);
  const locked = lockedUntil !== null && now < lockedUntil;

  const dirty = current !== '' || next !== '' || confirm !== '';
  useUnsavedChanges(dirty);

  const clear = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setErrors({});
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (locked) return;
    const problems: NewPasswordErrors & { current?: string } = validateNewPassword(next, confirm, t);
    if (current === '') problems.current = t('parent.settings.password.currentMissing');
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    try {
      const changed = await changeAdminPassword(current, next);
      if (changed) {
        clear();
        setLockedUntil(null);
        toast.success(t('parent.settings.password.saved'));
        return;
      }
      // Wrong current password, or the gate is locked after too many wrong tries.
      const state = await getLockoutState();
      setLockedUntil(state.lockedUntil);
      setCurrent('');
      setErrors({
        current:
          state.lockedUntil !== null
            ? t('parent.gate.lockedTitle')
            : state.attemptsLeft === 1
              ? t('parent.gate.wrongOne')
              : t('parent.gate.wrongMany', { count: state.attemptsLeft }),
      });
    } catch (cause) {
      toast.error(cause instanceof Error && cause.message ? cause.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate>
      <Section emoji="🔑" title={t('parent.settings.password.title')} description={t('parent.settings.password.hint')}>
        <div className="flex max-w-xl flex-col gap-4">
          <Field label={t('parent.settings.password.current')} error={errors.current} required>
            <PasswordInput value={current} onValueChange={setCurrent} autoComplete="current-password" disabled={busy || locked} />
          </Field>
          {locked && lockedUntil !== null && (
            <Note tone="danger" role="alert" emoji="⏳">
              {t('parent.gate.lockedText')} <span className="font-bold tabular-nums">{countdownText(lockedUntil - now)}</span>
            </Note>
          )}
          <Field label={t('parent.password.new')} hint={t('parent.password.rules')} error={errors.password} required>
            <PasswordInput value={next} onValueChange={setNext} autoComplete="new-password" disabled={busy} />
          </Field>
          <Field label={t('parent.password.confirm')} error={errors.confirm} required>
            <PasswordInput value={confirm} onValueChange={setConfirm} autoComplete="new-password" disabled={busy} />
          </Field>
          <Note tone="warning">{t('parent.wizard.password.forgetText')}</Note>
        </div>
        <FormActions dirty={dirty} busy={busy} onDiscard={clear} saveLabel={t('parent.settings.password.save')} />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------------------

type ImportMode = 'merge' | 'replace';

function BackupSection() {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const exportAll = async () => {
    setExporting(true);
    try {
      downloadBackup(await exportBackup());
      toast.success(t('parent.backup.exported'));
    } catch (cause) {
      toast.error(cause instanceof Error && cause.message ? cause.message : t('common.error'));
    } finally {
      setExporting(false);
    }
  };

  const restore = async () => {
    if (!file) return;
    setImporting(true);
    setFailure(null);
    setResult(null);
    try {
      const summary = await importBackup(await readBackupFile(file), mode);
      setResult(summary);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      toast.success(t('parent.backup.restored'));
    } catch (cause) {
      setFailure(cause instanceof Error && cause.message ? cause.message : t('common.error'));
    } finally {
      setImporting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section
        emoji="⬇️"
        title={t('parent.backup.exportTitle')}
        description={t('parent.backup.exportHint')}
        actions={
          <Button onClick={exportAll} loading={exporting}>
            {t('parent.backup.export')}
          </Button>
        }
      >
        <Note tone="info" emoji="🔐">
          {t('parent.backup.exportNote')}
        </Note>
      </Section>

      <Section emoji="⬆️" title={t('parent.backup.importTitle')} description={t('parent.backup.importHint')}>
        <div className="flex flex-col gap-4">
          <Field label={t('parent.backup.file')}>
            {(control) => (
              <input
                {...control}
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                disabled={importing}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setResult(null);
                  setFailure(null);
                }}
                className="block w-full rounded-xl border-2 border-dashed border-ink-400 bg-paper p-3 text-sm text-ink-900 file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-500 file:px-4 file:font-bold file:text-white hover:file:bg-brand-600"
              />
            )}
          </Field>
          <OptionCards<ImportMode>
            label={t('parent.backup.mode')}
            value={mode}
            onChange={setMode}
            disabled={importing}
            options={[
              { value: 'merge', emoji: '➕', title: t('parent.backup.merge'), description: t('parent.backup.mergeHint') },
              { value: 'replace', emoji: '♻️', title: t('parent.backup.replace'), description: t('parent.backup.replaceHint') },
            ]}
          />
          {mode === 'replace' && <Note tone="danger">{t('parent.backup.replaceWarning')}</Note>}
          <div>
            <Button variant={mode === 'replace' ? 'danger' : 'primary'} disabled={!file} loading={importing} onClick={() => setConfirming(true)}>
              {t('parent.backup.restore')}
            </Button>
          </div>
          {failure !== null && (
            <Note tone="danger" role="alert">
              <p className="font-bold">{t('parent.backup.failed')}</p>
              <p>{failure}</p>
            </Note>
          )}
          {result !== null && (
            <Note tone="success" role="status">
              <p className="font-bold">{t('parent.backup.resultTitle')}</p>
              <ul className="mt-1 list-disc pl-5">
                <li>{t('parent.backup.result.children', { count: fmt.number(result.children) })}</li>
                <li>{t('parent.backup.result.records', { count: fmt.number(result.records) })}</li>
                <li>{t('parent.backup.result.library', { count: fmt.number(result.libraryItems) })}</li>
                {result.skipped > 0 && <li>{t('parent.backup.result.skipped', { count: fmt.number(result.skipped) })}</li>}
              </ul>
            </Note>
          )}
        </div>
      </Section>

      <ConfirmDialog
        open={confirming}
        tone={mode === 'replace' ? 'danger' : 'primary'}
        title={mode === 'replace' ? t('parent.backup.confirmReplaceTitle') : t('parent.backup.confirmMergeTitle')}
        message={mode === 'replace' ? t('parent.backup.confirmReplaceText') : t('parent.backup.confirmMergeText')}
        confirmLabel={t('parent.backup.restore')}
        busy={importing}
        onCancel={() => setConfirming(false)}
        onConfirm={restore}
      >
        {file && <p className="break-all text-sm font-semibold text-ink-700">{file.name}</p>}
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

function DangerSection() {
  const { t } = useFormat();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);

  const wipe = async () => {
    setWiping(true);
    try {
      await resetDevice();
      useParentGate.getState().lock();
      navigate('/setup', { replace: true });
    } finally {
      setWiping(false);
    }
  };

  return (
    <>
      <Section
        tone="danger"
        emoji="⚠️"
        title={t('parent.danger.title')}
        description={t('parent.danger.hint')}
        actions={
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t('parent.danger.wipe')}
          </Button>
        }
      >
        <ul className="list-disc pl-5 text-sm text-ink-700">
          <li>{t('parent.danger.item.children')}</li>
          <li>{t('parent.danger.item.library')}</li>
          <li>{t('parent.danger.item.settings')}</li>
        </ul>
        <p className="mt-3 text-sm font-semibold text-ink-900">{t('parent.danger.backupFirst')}</p>
      </Section>
      <TypedConfirmDialog
        open={confirming}
        title={t('parent.danger.confirmTitle')}
        message={t('parent.gate.resetMessage')}
        word={RESET_WORD}
        confirmLabel={t('parent.danger.wipe')}
        busy={wiping}
        onCancel={() => setConfirming(false)}
        onConfirm={wipe}
      >
        <Note tone="danger">{t('parent.gate.resetWarning')}</Note>
      </TypedConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// About and privacy
// ---------------------------------------------------------------------------

const ABOUT_LISTS = [
  { key: 'stored', emoji: '📱', items: ['password', 'settings', 'key', 'profiles', 'progress', 'challenges', 'helper', 'rewards', 'library', 'usage'] },
  { key: 'sent', emoji: '📤', items: ['context', 'skill', 'recent', 'summary', 'helper', 'studio', 'reports', 'interests', 'notes'] },
  { key: 'never', emoji: '🚫', items: ['name', 'password', 'audio', 'device', 'others'] },
  { key: 'safe', emoji: '🛡️', items: ['draws', 'checks', 'rules', 'fallback', 'nothingElse'] },
] as const;

function AboutSection({ settings }: { settings: Settings }) {
  const { t } = useFormat();
  return (
    <div className="flex flex-col gap-5">
      <Section emoji="ℹ️" title={t('parent.about.title')} description={t('parent.about.lead')}>
        <Note tone={settings.ai.provider === 'demo' ? 'success' : 'info'}>{t(`parent.about.mode.${settings.ai.provider}`)}</Note>
      </Section>
      {ABOUT_LISTS.map((list) => (
        <Section key={list.key} emoji={list.emoji} title={t(`parent.about.${list.key}.title`)} description={t(`parent.about.${list.key}.lead`)}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-900">
            {list.items.map((item) => (
              <li key={item}>{t(`parent.about.${list.key}.${item}`)}</li>
            ))}
          </ul>
        </Section>
      ))}
      <p className="text-sm text-ink-500">{t('parent.about.footer')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { t } = useFormat();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const leave = useLeaveGuard();
  const wanted = params.get('section');
  const section: SectionId = (SECTIONS as readonly string[]).includes(wanted ?? '') ? (wanted as SectionId) : 'ai';

  // A new section starts at its top.
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0 });
      } catch {
        // jsdom has no scrolling.
      }
    }
  }, [section]);

  useTabInView(ID_BASE, section, settings !== undefined);

  if (!settings) return <PanelLoading />;

  return (
    <div>
      <PageHeader title={t('parent.settings.title')} subtitle={t('parent.settings.subtitle')} />
      <Tabs<SectionId>
        idBase={ID_BASE}
        aria-label={t('parent.settings.sections')}
        tabs={SECTIONS.map((id) => ({ id, label: t(`parent.settings.section.${id}`), emoji: SECTION_EMOJI[id] }))}
        value={section}
        onChange={(id) => leave(() => setParams(id === 'ai' ? {} : { section: id }, { replace: true }))}
        // The seven sections wrap onto several rows when they do not fit, so none is hidden off screen.
        className="flex-wrap"
      />
      <TabPanel idBase={ID_BASE} id="ai" active={section === 'ai'}>
        <AiSection settings={settings} />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="controls" active={section === 'controls'}>
        <ControlsSection settings={settings} />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="language" active={section === 'language'}>
        <LanguageSection settings={settings} />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="password" active={section === 'password'}>
        <PasswordSection />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="backup" active={section === 'backup'}>
        <BackupSection />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="danger" active={section === 'danger'}>
        <DangerSection />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="about" active={section === 'about'}>
        <AboutSection settings={settings} />
      </TabPanel>
    </div>
  );
}
