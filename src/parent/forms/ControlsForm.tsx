/**
 * Every field of `ParentalControls`, grouped the way a parent thinks about them.
 * Shared by the setup wizard and the settings screen. Controlled.
 */
import type { ReactNode } from 'react';
import { STRANDS, type ParentalControls, type Strand } from '@/core/types';
import { strandName, type Translate } from '@/i18n';
import { Field, NumberInput, Select, Toggle } from '@/ui';
import { useFormat } from '../hooks';
import { Note, OptionCards } from '../parts';

export const DAILY_MINUTES_MIN = 5;
export const DAILY_MINUTES_MAX = 600;

export type ControlsErrors = Partial<Record<'dailyMinutes' | 'hours' | 'strands', string>>;

export function validateControls(controls: ParentalControls, t: Translate): ControlsErrors {
  const errors: ControlsErrors = {};
  const minutes = controls.dailyMinutes;
  if (!Number.isInteger(minutes) || minutes < DAILY_MINUTES_MIN || minutes > DAILY_MINUTES_MAX) {
    errors.dailyMinutes = t('parent.controls.error.minutes', { min: DAILY_MINUTES_MIN, max: DAILY_MINUTES_MAX });
  }
  if (controls.allowedStartHour === controls.allowedEndHour % 24 && !(controls.allowedStartHour === 0 && controls.allowedEndHour === 24)) {
    errors.hours = t('parent.controls.error.hours');
  }
  if (!STRANDS.some((strand) => controls.strands[strand])) errors.strands = t('parent.controls.error.strands');
  return errors;
}

export function sameControls(a: ParentalControls, b: ParentalControls): boolean {
  return (
    a.dailyMinutes === b.dailyMinutes &&
    a.allowedStartHour === b.allowedStartHour &&
    a.allowedEndHour === b.allowedEndHour &&
    STRANDS.every((strand) => a.strands[strand] === b.strands[strand]) &&
    a.voiceOutput === b.voiceOutput &&
    a.microphone === b.microphone &&
    a.openChat === b.openChat &&
    a.aiImages === b.aiImages &&
    a.realWorldMissions === b.realWorldMissions &&
    a.strictness === b.strictness &&
    a.keepTranscripts === b.keepTranscripts
  );
}

export const STRAND_EMOJI: Record<Strand, string> = {
  math: '🔢',
  science: '🔬',
  technology: '💻',
  engineering: '🏗️',
  logic: '🧩',
};

function Group({ emoji, title, children }: { emoji: string; title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded-2xl border border-ink-200 bg-paper p-4">
      <legend className="flex items-center gap-2 px-1 font-display text-lg font-bold text-ink-900">
        <span aria-hidden="true">{emoji}</span>
        {title}
      </legend>
      <div className="flex flex-col gap-4">{children}</div>
    </fieldset>
  );
}

export interface ControlsFormProps {
  value: ParentalControls;
  onChange: (value: ParentalControls) => void;
  errors?: ControlsErrors;
  /** False when no image model is configured: the AI pictures switch is then off and explained. */
  imageModelSet: boolean;
  disabled?: boolean;
}

export function ControlsForm({ value, onChange, errors = {}, imageModelSet, disabled = false }: ControlsFormProps) {
  const fmt = useFormat();
  const { t } = fmt;
  const set = (patch: Partial<ParentalControls>) => onChange({ ...value, ...patch });
  const overnight = value.allowedStartHour > value.allowedEndHour % 24 && value.allowedEndHour !== 24;

  const startOptions = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: fmt.hour(hour) }));
  const endOptions = Array.from({ length: 24 }, (_, index) => {
    const hour = index + 1;
    return { value: String(hour), label: hour === 24 ? t('parent.controls.endOfDay') : fmt.hour(hour) };
  });

  return (
    <div className="flex flex-col gap-5">
      <Group emoji="⏰" title={t('parent.controls.time')}>
        <Field label={t('parent.controls.dailyMinutes')} hint={t('parent.controls.dailyMinutesHint')} error={errors.dailyMinutes}>
          <NumberInput
            value={value.dailyMinutes}
            onChange={(minutes) => set({ dailyMinutes: minutes ?? 0 })}
            min={DAILY_MINUTES_MIN}
            max={DAILY_MINUTES_MAX}
            step={5}
            unit={t('parent.unit.min')}
            disabled={disabled}
            className="max-w-64"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('parent.controls.startHour')} error={errors.hours}>
            <Select
              value={String(value.allowedStartHour)}
              onValueChange={(hour) => set({ allowedStartHour: Number(hour) })}
              options={startOptions}
              disabled={disabled}
            />
          </Field>
          <Field label={t('parent.controls.endHour')}>
            <Select
              value={String(value.allowedEndHour)}
              onValueChange={(hour) => set({ allowedEndHour: Number(hour) })}
              options={endOptions}
              disabled={disabled}
            />
          </Field>
        </div>
        <p className="text-sm text-ink-500">{overnight ? t('parent.controls.hoursOvernight') : t('parent.controls.hoursHint')}</p>
      </Group>

      <Group emoji="📚" title={t('parent.controls.subjects')}>
        <p className="text-sm text-ink-700">{t('parent.controls.subjectsHint')}</p>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {STRANDS.map((strand) => (
            <Toggle
              key={strand}
              checked={value.strands[strand]}
              onChange={(on) => set({ strands: { ...value.strands, [strand]: on } })}
              label={
                <>
                  <span aria-hidden="true">{STRAND_EMOJI[strand]} </span>
                  {strandName(strand)}
                </>
              }
              disabled={disabled}
            />
          ))}
        </div>
        {errors.strands !== undefined && (
          <p role="alert" className="text-sm font-semibold text-coral-700">
            {errors.strands}
          </p>
        )}
      </Group>

      <Group emoji="🔊" title={t('parent.controls.voice')}>
        <Toggle
          checked={value.voiceOutput}
          onChange={(voiceOutput) => set({ voiceOutput })}
          label={t('parent.controls.voiceOutput')}
          description={t('parent.controls.voiceOutputHint')}
          disabled={disabled}
        />
        <Toggle
          checked={value.microphone}
          onChange={(microphone) => set({ microphone })}
          label={t('parent.controls.microphone')}
          description={t('parent.controls.microphoneHint')}
          disabled={disabled}
        />
        {value.microphone && <Note tone="warning">{t('parent.controls.microphoneWarning')}</Note>}
      </Group>

      <Group emoji="🤖" title={t('parent.controls.helper')}>
        <Toggle
          checked={value.openChat}
          onChange={(openChat) => set({ openChat })}
          label={t('parent.controls.openChat')}
          description={t('parent.controls.openChatHint')}
          disabled={disabled}
        />
      </Group>

      <Group emoji="🎨" title={t('parent.controls.content')}>
        <Toggle
          checked={imageModelSet && value.aiImages}
          onChange={(aiImages) => set({ aiImages })}
          label={t('parent.controls.aiImages')}
          description={imageModelSet ? t('parent.controls.aiImagesHint') : t('parent.controls.aiImagesUnavailable')}
          disabled={disabled || !imageModelSet}
        />
        <Toggle
          checked={value.realWorldMissions}
          onChange={(realWorldMissions) => set({ realWorldMissions })}
          label={t('parent.controls.realWorldMissions')}
          description={t('parent.controls.realWorldMissionsHint')}
          disabled={disabled}
        />
        <div className="flex flex-col gap-2">
          <p className="font-bold text-ink-900">{t('parent.controls.strictness')}</p>
          <OptionCards
            label={t('parent.controls.strictness')}
            value={value.strictness}
            onChange={(strictness) => set({ strictness })}
            disabled={disabled}
            options={[
              { value: 'strict', emoji: '🛡️', title: t('parent.controls.strict'), description: t('parent.controls.strictHint') },
              { value: 'standard', emoji: '⚖️', title: t('parent.controls.standard'), description: t('parent.controls.standardHint') },
            ]}
          />
        </div>
      </Group>

      <Group emoji="🔒" title={t('parent.controls.privacy')}>
        <Toggle
          checked={value.keepTranscripts}
          onChange={(keepTranscripts) => set({ keepTranscripts })}
          label={t('parent.controls.keepTranscripts')}
          description={t('parent.controls.keepTranscriptsHint')}
          disabled={disabled}
        />
      </Group>
    </div>
  );
}
