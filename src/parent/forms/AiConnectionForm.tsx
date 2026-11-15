/**
 * The AI connection form, shared by the setup wizard and the settings screen: three
 * explained modes (Demo, Direct, Proxy), the fields of the chosen one, a connection test
 * that works on the values as typed, and the request budgets.
 *
 * A stored API key is only ever shown as "saved". It can be replaced or removed, never read.
 * It belongs to the service it was entered for: for another address the form asks for a key.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { testConnection } from '@/ai';
import type { AiProvider } from '@/core/types';
import { Button, Chip, Field, NumberInput, PasswordInput, TextInput } from '@/ui';
import { useFormat } from '../hooks';
import { Note, OptionCards } from '../parts';
import {
  BUDGET_MAX,
  CHAT_MODEL_SUGGESTIONS,
  connectionOverride,
  IMAGE_MODEL_SUGGESTIONS,
  LOCAL_SERVER_EXAMPLES,
  type AiDraft,
  type AiErrors,
} from './aiForm';

export interface AiConnectionFormProps {
  draft: AiDraft;
  onChange: (draft: AiDraft) => void;
  errors?: AiErrors;
  /** A usable key is already stored on this device (settings screen). */
  hasStoredKey: boolean;
  /** A key is stored, but for another service than the address in the draft: it is not used here. */
  keyForOtherAddress?: boolean;
  disabled?: boolean;
  /** Extra content under the budget fields (the usage meters in settings). */
  children?: ReactNode;
}

interface TestState {
  status: 'idle' | 'running' | 'done';
  ok: boolean;
  message: string;
  latencyMs: number;
}

const IDLE: TestState = { status: 'idle', ok: false, message: '', latencyMs: 0 };

export function AiConnectionForm({
  draft,
  onChange,
  errors = {},
  hasStoredKey,
  keyForOtherAddress = false,
  disabled = false,
  children,
}: AiConnectionFormProps) {
  const fmt = useFormat();
  const { t } = fmt;
  const [test, setTest] = useState<TestState>(IDLE);
  const [replacing, setReplacing] = useState(false);
  const runId = useRef(0);

  const set = (patch: Partial<AiDraft>) => onChange({ ...draft, ...patch });

  // A test result describes the values it was run with: forget it when they change.
  const signature = `${draft.provider}|${draft.directBaseUrl}|${draft.proxyBaseUrl}|${draft.apiKey}|${draft.chatModel}`;
  useEffect(() => {
    runId.current += 1;
    setTest(IDLE);
  }, [signature]);

  const runTest = async () => {
    const id = (runId.current += 1);
    setTest({ ...IDLE, status: 'running' });
    const result = await testConnection(connectionOverride(draft));
    if (runId.current !== id) return;
    setTest({ status: 'done', ...result });
  };

  const keyStored = hasStoredKey && !draft.removeKey;
  const showKeyInput = !keyStored || replacing;

  const modes = [
    { value: 'demo', emoji: '🧸', title: t('parent.ai.mode.demo'), description: t('parent.ai.mode.demoHint') },
    { value: 'direct', emoji: '🔑', title: t('parent.ai.mode.direct'), description: t('parent.ai.mode.directHint') },
    { value: 'proxy', emoji: '🖥️', title: t('parent.ai.mode.proxy'), description: t('parent.ai.mode.proxyHint') },
  ] as const;

  const modelFields = (
    <>
      <Field label={t('parent.ai.chatModel')} hint={t('parent.ai.chatModelHint')} error={errors.chatModel} required>
        <TextInput
          value={draft.chatModel}
          onValueChange={(chatModel) => set({ chatModel })}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
        />
      </Field>
      <div role="group" aria-label={t('parent.ai.chatModelSuggestions')} className="-mt-2 flex flex-wrap gap-2">
        {CHAT_MODEL_SUGGESTIONS.map((model) => (
          <Chip key={model} selected={draft.chatModel.trim() === model} disabled={disabled} onClick={() => set({ chatModel: model })}>
            {model}
          </Chip>
        ))}
      </div>
      <Field label={t('parent.ai.imageModel')} hint={t('parent.ai.imageModelHint', { examples: IMAGE_MODEL_SUGGESTIONS.join(', ') })}>
        <TextInput
          value={draft.imageModel}
          onValueChange={(imageModel) => set({ imageModel })}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
        />
      </Field>
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <OptionCards<AiProvider>
        label={t('parent.ai.modeLabel')}
        options={modes}
        value={draft.provider}
        onChange={(provider) => {
          setReplacing(false);
          set({ provider });
        }}
        disabled={disabled}
        columnsFrom="lg"
      />

      {draft.provider === 'demo' && <Note tone="info">{t('parent.ai.demoNote')}</Note>}

      {draft.provider === 'direct' && (
        <>
          <Field
            label={t('parent.ai.baseUrl')}
            hint={t('parent.ai.baseUrlHint', { examples: LOCAL_SERVER_EXAMPLES.join(' · ') })}
            error={errors.baseUrl}
            required
          >
            <TextInput
              value={draft.directBaseUrl}
              onValueChange={(directBaseUrl) => set({ directBaseUrl })}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={disabled}
            />
          </Field>

          {showKeyInput ? (
            <Field label={t('parent.ai.apiKey')} hint={t('parent.ai.apiKeyHint')} error={errors.apiKey}>
              <PasswordInput
                value={draft.apiKey}
                onValueChange={(apiKey) => set({ apiKey })}
                autoComplete="off"
                disabled={disabled}
                placeholder={draft.removeKey ? t('parent.ai.keyWillBeRemoved') : undefined}
              />
            </Field>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-bold text-ink-900">{t('parent.ai.apiKey')}</span>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-leaf-600 bg-leaf-100 px-3 py-2">
                <span className="min-w-0 flex-1 basis-40 font-semibold text-ink-900">
                  <span aria-hidden="true">🔐 </span>
                  {t('parent.ai.keySaved')}
                </span>
                <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setReplacing(true)}>
                  {t('parent.ai.keyReplace')}
                </Button>
                <Button variant="ghost" size="sm" disabled={disabled} onClick={() => set({ removeKey: true, apiKey: '' })}>
                  {t('parent.ai.keyRemove')}
                </Button>
              </div>
            </div>
          )}
          {keyForOtherAddress && !draft.removeKey && (
            <div data-testid="key-other-address" className="-mt-3">
              <Note tone="warning">{t('parent.ai.keyOtherAddress')}</Note>
            </div>
          )}
          {hasStoredKey && (replacing || draft.removeKey) && (
            <div className="-mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
              <span>{draft.removeKey ? t('parent.ai.keyRemoveNote') : t('parent.ai.keyReplaceNote')}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setReplacing(false);
                  set({ removeKey: false, apiKey: '' });
                }}
              >
                {t('parent.ai.keyKeep')}
              </Button>
            </div>
          )}

          {modelFields}
          <Note tone="warning">{t('parent.ai.subscriptionNote')}</Note>
        </>
      )}

      {draft.provider === 'proxy' && (
        <>
          <Field label={t('parent.ai.proxyUrl')} hint={t('parent.ai.proxyUrlHint')} error={errors.baseUrl}>
            <TextInput
              value={draft.proxyBaseUrl}
              onValueChange={(proxyBaseUrl) => set({ proxyBaseUrl })}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={disabled}
            />
          </Field>
          {modelFields}
          <Note tone="info" emoji="🔐">
            {t('parent.ai.proxyNote')}
          </Note>
        </>
      )}

      {draft.provider !== 'direct' && keyStored && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
          <span>{t('parent.ai.keyUnused')}</span>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => set({ removeKey: true, apiKey: '' })}>
            {t('parent.ai.keyRemove')}
          </Button>
        </div>
      )}
      {draft.provider !== 'direct' && hasStoredKey && draft.removeKey && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
          <span>{t('parent.ai.keyRemoveNote')}</span>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => set({ removeKey: false })}>
            {t('parent.ai.keyKeep')}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <Button variant="secondary" icon="🔌" onClick={runTest} loading={test.status === 'running'} disabled={disabled}>
            {t('parent.ai.test')}
          </Button>
        </div>
        <div role="status" aria-live="polite">
          {test.status === 'running' && <p className="text-sm font-semibold text-ink-700">{t('parent.ai.testing')}</p>}
          {test.status === 'done' && (
            <Note tone={test.ok ? 'success' : 'danger'} emoji={test.ok ? '✅' : '❌'}>
              <p className="font-bold">{test.ok ? t('parent.ai.testOk') : t('parent.ai.testFailed')}</p>
              <p data-testid="ai-test-message">{test.message}</p>
            </Note>
          )}
        </div>
      </div>

      <fieldset className="min-w-0 rounded-2xl border border-ink-200 bg-paper p-4">
        <legend className="flex items-center gap-2 px-1 font-display text-lg font-bold text-ink-900">
          <span aria-hidden="true">💰</span>
          {t('parent.ai.budgets')}
        </legend>
        <p className="mb-4 text-sm text-ink-700">{t('parent.ai.budgetsHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('parent.ai.dailyBudget')} error={errors.dailyRequestBudget}>
            <NumberInput
              value={draft.dailyRequestBudget}
              onChange={(dailyRequestBudget) => set({ dailyRequestBudget })}
              min={0}
              max={BUDGET_MAX}
              step={10}
              disabled={disabled}
            />
          </Field>
          <Field label={t('parent.ai.monthlyCap')} error={errors.monthlyRequestCap}>
            <NumberInput
              value={draft.monthlyRequestCap}
              onChange={(monthlyRequestCap) => set({ monthlyRequestCap })}
              min={0}
              max={BUDGET_MAX}
              step={100}
              disabled={disabled}
            />
          </Field>
        </div>
        {draft.provider !== 'demo' && <p className="mt-3 text-sm text-ink-700">{t('parent.ai.spendingNote')}</p>}
        {children}
      </fieldset>
    </div>
  );
}
