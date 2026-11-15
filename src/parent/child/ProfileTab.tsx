/**
 * Profile: the child's details, voice and accessibility, and per-child exceptions to the
 * family's parental controls. Every exception starts as "use family setting".
 */
import { useState, type ReactNode } from 'react';
import { STRANDS, type AccessibilitySettings, type ChildProfile, type ParentalControls, type Settings } from '@/core/types';
import { updateChild } from '@/data';
import { strandName, type Translate } from '@/i18n';
import { Button, Field, NumberInput, Select, Toggle, useToast } from '@/ui';
import { ChildForm, childDraftOf, childDraftToInput, sameChildDraft, validateChildDraft, type ChildDraft, type ChildDraftErrors } from '../forms/ChildForm';
import { DAILY_MINUTES_MAX, DAILY_MINUTES_MIN, STRAND_EMOJI } from '../forms/ControlsForm';
import { useUnsavedChanges } from '../guard';
import { useFormat } from '../hooks';
import { Note, OptionCards, Section } from '../parts';

export const VOICE_RATE_MIN = 0.6;
export const VOICE_RATE_MAX = 1.4;

type Override = Partial<ParentalControls>;
type OverrideErrors = Partial<Record<'dailyMinutes' | 'hours' | 'strands', string>>;

const BOOLEAN_CONTROLS = ['voiceOutput', 'microphone', 'openChat', 'aiImages', 'realWorldMissions', 'keepTranscripts'] as const;
type BooleanControl = (typeof BOOLEAN_CONTROLS)[number];

/** Keeps only the fields that are really set, so "use family setting" stores nothing. */
export function cleanOverride(override: Override): Override {
  const clean: Override = {};
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) (clean as Record<string, unknown>)[key] = value;
  }
  return clean;
}

export function validateOverride(override: Override, t: Translate): OverrideErrors {
  const errors: OverrideErrors = {};
  const minutes = override.dailyMinutes;
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < DAILY_MINUTES_MIN || minutes > DAILY_MINUTES_MAX)) {
    errors.dailyMinutes = t('parent.controls.error.minutes', { min: DAILY_MINUTES_MIN, max: DAILY_MINUTES_MAX });
  }
  const { allowedStartHour: start, allowedEndHour: end } = override;
  if (start !== undefined && end !== undefined && start === end % 24 && !(start === 0 && end === 24)) {
    errors.hours = t('parent.controls.error.hours');
  }
  if (override.strands && !STRANDS.some((strand) => override.strands?.[strand])) errors.strands = t('parent.controls.error.strands');
  return errors;
}

function sameOverride(a: Override, b: Override): boolean {
  return JSON.stringify(sortedEntries(a)) === JSON.stringify(sortedEntries(b));
}

function sortedEntries(override: Override): [string, unknown][] {
  return Object.entries(cleanOverride(override))
    .map(([key, value]): [string, unknown] => [
      key,
      key === 'strands' && value && typeof value === 'object' ? STRANDS.map((strand) => (value as Record<string, boolean>)[strand]) : value,
    ])
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

function sameAccessibility(a: AccessibilitySettings, b: AccessibilitySettings): boolean {
  return (
    a.dyslexiaFont === b.dyslexiaFont &&
    a.largeText === b.largeText &&
    a.highContrast === b.highContrast &&
    a.reducedMotion === b.reducedMotion &&
    a.readAloud === b.readAloud
  );
}

/** One control: "use family setting" by default, with the child's own value when switched off. */
function OverrideRow({
  label,
  familyText,
  overridden,
  onToggle,
  error,
  children,
}: {
  label: string;
  familyText: string;
  overridden: boolean;
  onToggle: (useFamily: boolean) => void;
  error?: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useFormat();
  return (
    <div role="group" aria-label={label} className="rounded-2xl border border-ink-200 bg-paper p-4">
      <p className="font-display text-lg font-bold leading-tight text-ink-900">{label}</p>
      <Toggle
        checked={!overridden}
        onChange={onToggle}
        label={t('parent.override.useFamily')}
        description={overridden ? t('parent.override.own') : t('parent.override.family', { value: familyText })}
        aria-label={t('parent.override.useFamilyFor', { control: label })}
      />
      {overridden && <div className="mt-3 border-t border-ink-200 pt-3">{children}</div>}
      {error !== undefined && (
        <p role="alert" className="mt-2 text-sm font-semibold text-coral-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface OverridesFormProps {
  value: Override;
  family: ParentalControls;
  onChange: (value: Override) => void;
  errors: OverrideErrors;
  childName: string;
  imageModelSet: boolean;
}

function OverridesForm({ value, family, onChange, errors, childName, imageModelSet }: OverridesFormProps) {
  const fmt = useFormat();
  const { t } = fmt;
  const set = (patch: Override) => onChange({ ...value, ...patch });
  const onOff = (on: boolean) => (on ? t('common.on') : t('common.off'));
  const hoursText = (start: number, end: number) => `${fmt.hour(start)} – ${end === 24 ? t('parent.controls.endOfDay') : fmt.hour(end)}`;

  const ownStart = value.allowedStartHour;
  const ownEnd = value.allowedEndHour;
  const hoursOverridden = ownStart !== undefined && ownEnd !== undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <OverrideRow
        label={t('parent.controls.dailyMinutes')}
        familyText={t('parent.override.minutes', { count: family.dailyMinutes })}
        overridden={value.dailyMinutes !== undefined}
        onToggle={(useFamily) => set({ dailyMinutes: useFamily ? undefined : family.dailyMinutes })}
        error={errors.dailyMinutes}
      >
        <Field label={t('parent.override.minutesFor', { name: childName })}>
          <NumberInput
            value={value.dailyMinutes ?? null}
            onChange={(minutes) => set({ dailyMinutes: minutes ?? 0 })}
            min={DAILY_MINUTES_MIN}
            max={DAILY_MINUTES_MAX}
            step={5}
            unit={t('parent.unit.min')}
          />
        </Field>
      </OverrideRow>

      <OverrideRow
        label={t('parent.controls.hours')}
        familyText={hoursText(family.allowedStartHour, family.allowedEndHour)}
        overridden={hoursOverridden}
        onToggle={(useFamily) =>
          set(
            useFamily
              ? { allowedStartHour: undefined, allowedEndHour: undefined }
              : { allowedStartHour: family.allowedStartHour, allowedEndHour: family.allowedEndHour },
          )
        }
        error={errors.hours}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('parent.controls.startHour')}>
            <Select
              value={String(ownStart ?? family.allowedStartHour)}
              onValueChange={(hour) => set({ allowedStartHour: Number(hour) })}
              options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: fmt.hour(hour) }))}
            />
          </Field>
          <Field label={t('parent.controls.endHour')}>
            <Select
              value={String(ownEnd ?? family.allowedEndHour)}
              onValueChange={(hour) => set({ allowedEndHour: Number(hour) })}
              options={Array.from({ length: 24 }, (_, index) => ({
                value: String(index + 1),
                label: index + 1 === 24 ? t('parent.controls.endOfDay') : fmt.hour(index + 1),
              }))}
            />
          </Field>
        </div>
      </OverrideRow>

      <OverrideRow
        label={t('parent.controls.subjects')}
        familyText={STRANDS.filter((strand) => family.strands[strand]).map((strand) => strandName(strand)).join(', ')}
        overridden={value.strands !== undefined}
        onToggle={(useFamily) => set({ strands: useFamily ? undefined : { ...family.strands } })}
        error={errors.strands}
      >
        <div className="flex flex-col gap-1">
          {STRANDS.map((strand) => (
            <Toggle
              key={strand}
              checked={value.strands?.[strand] ?? family.strands[strand]}
              onChange={(on) => set({ strands: { ...(value.strands ?? family.strands), [strand]: on } })}
              label={
                <>
                  <span aria-hidden="true">{STRAND_EMOJI[strand]} </span>
                  {strandName(strand)}
                </>
              }
            />
          ))}
        </div>
      </OverrideRow>

      {BOOLEAN_CONTROLS.map((control: BooleanControl) => {
        const own = value[control];
        const blocked = control === 'aiImages' && !imageModelSet;
        return (
          <OverrideRow
            key={control}
            label={t(`parent.controls.${control}`)}
            familyText={onOff(control === 'aiImages' ? imageModelSet && family.aiImages : family[control])}
            overridden={own !== undefined}
            onToggle={(useFamily) => set({ [control]: useFamily ? undefined : family[control] })}
          >
            <Toggle
              checked={blocked ? false : (own ?? false)}
              onChange={(on) => set({ [control]: on })}
              label={t('parent.override.onFor', { name: childName })}
              description={blocked ? t('parent.controls.aiImagesUnavailable') : control === 'microphone' ? t('parent.controls.microphoneWarning') : undefined}
              disabled={blocked}
            />
          </OverrideRow>
        );
      })}

      <OverrideRow
        label={t('parent.controls.strictness')}
        familyText={t(`parent.controls.${family.strictness}`)}
        overridden={value.strictness !== undefined}
        onToggle={(useFamily) => set({ strictness: useFamily ? undefined : family.strictness })}
      >
        <OptionCards
          label={t('parent.controls.strictness')}
          value={value.strictness ?? family.strictness}
          onChange={(strictness) => set({ strictness })}
          columnsFrom="lg"
          options={[
            { value: 'strict', emoji: '🛡️', title: t('parent.controls.strict'), description: t('parent.controls.strictHint') },
            { value: 'standard', emoji: '⚖️', title: t('parent.controls.standard'), description: t('parent.controls.standardHint') },
          ]}
        />
      </OverrideRow>
    </div>
  );
}

const ACCESSIBILITY_KEYS = ['dyslexiaFont', 'largeText', 'highContrast', 'reducedMotion', 'readAloud'] as const;

export function ProfileTab({ child, settings }: { child: ChildProfile; settings: Settings }) {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const [draft, setDraft] = useState<ChildDraft>(() => childDraftOf(child));
  const [voiceRate, setVoiceRate] = useState(child.voiceRate);
  const [accessibility, setAccessibility] = useState<AccessibilitySettings>(() => ({ ...child.accessibility }));
  const [override, setOverride] = useState<Override>(() => cleanOverride(child.controlsOverride ?? {}));
  const [errors, setErrors] = useState<ChildDraftErrors>({});
  const [overrideErrors, setOverrideErrors] = useState<OverrideErrors>({});
  const [busy, setBusy] = useState(false);

  const dirty =
    !sameChildDraft(draft, childDraftOf(child)) ||
    voiceRate !== child.voiceRate ||
    !sameAccessibility(accessibility, child.accessibility) ||
    !sameOverride(override, child.controlsOverride ?? {});
  useUnsavedChanges(dirty);

  const imageModelSet = settings.ai.provider !== 'demo' && settings.ai.imageModel.trim() !== '';

  const reset = () => {
    setDraft(childDraftOf(child));
    setVoiceRate(child.voiceRate);
    setAccessibility({ ...child.accessibility });
    setOverride(cleanOverride(child.controlsOverride ?? {}));
    setErrors({});
    setOverrideErrors({});
  };

  const save = async () => {
    const problems = validateChildDraft(draft, t);
    const overrideProblems = validateOverride(override, t);
    setErrors(problems);
    setOverrideErrors(overrideProblems);
    if (Object.keys(problems).length > 0 || Object.keys(overrideProblems).length > 0) {
      toast.error(t('parent.form.fixErrors'));
      return;
    }
    setBusy(true);
    try {
      await updateChild(child.id, { ...childDraftToInput(draft), voiceRate, accessibility, controlsOverride: cleanOverride(override) });
      toast.success(t('parent.profile.saved', { name: draft.nickname.trim() }));
    } catch (cause) {
      toast.error(cause instanceof Error && cause.message ? cause.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const overrideCount = Object.keys(cleanOverride(override)).filter((key) => key !== 'allowedEndHour').length;

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Section emoji="🧒" title={t('parent.profile.about')}>
        <ChildForm
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setErrors({});
          }}
          errors={errors}
          disabled={busy}
        />
      </Section>

      <Section emoji="🔊" title={t('parent.profile.voice')} description={t('parent.profile.voiceHint')}>
        <Field label={t('parent.profile.voiceRate')} hint={t('parent.profile.voiceRateValue', { value: fmt.number(voiceRate) })}>
          {(control) => (
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="text-2xl">
                🐢
              </span>
              <input
                {...control}
                type="range"
                min={VOICE_RATE_MIN}
                max={VOICE_RATE_MAX}
                step={0.05}
                value={voiceRate}
                disabled={busy}
                onChange={(event) => setVoiceRate(Number(event.target.value))}
                className="h-11 min-w-0 flex-1 accent-[var(--color-brand-500)]"
              />
              <span aria-hidden="true" className="text-2xl">
                🐇
              </span>
            </div>
          )}
        </Field>
      </Section>

      <Section emoji="♿" title={t('parent.profile.accessibility')} description={t('parent.profile.accessibilityHint')}>
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {ACCESSIBILITY_KEYS.map((key) => (
            <Toggle
              key={key}
              checked={accessibility[key]}
              onChange={(on) => setAccessibility((current) => ({ ...current, [key]: on }))}
              label={t(`parent.a11y.${key}`)}
              description={t(`parent.a11y.${key}Hint`)}
              disabled={busy}
            />
          ))}
        </div>
      </Section>

      <Section
        emoji="🎛️"
        title={t('parent.profile.overrides', { name: child.nickname })}
        description={t('parent.profile.overridesHint', { name: child.nickname })}
      >
        <p role="status" className="mb-3 text-sm font-semibold text-ink-700">
          {overrideCount === 0 ? t('parent.profile.overridesNone') : t('parent.profile.overridesCount', { count: overrideCount })}
        </p>
        <OverridesForm
          value={override}
          family={settings.controls}
          onChange={(next) => {
            setOverride(next);
            setOverrideErrors({});
          }}
          errors={overrideErrors}
          childName={child.nickname}
          imageModelSet={imageModelSet}
        />
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-ink-200 bg-white/95 px-4 py-3 sm:-mx-6 sm:px-6">
        {dirty && <Note tone="warning" className="mr-auto !py-1.5">{t('parent.form.unsaved')}</Note>}
        <Button variant="secondary" onClick={reset} disabled={!dirty || busy}>
          {t('parent.form.discard')}
        </Button>
        <Button type="submit" loading={busy} disabled={!dirty}>
          {t('parent.profile.save')}
        </Button>
      </div>
    </form>
  );
}
