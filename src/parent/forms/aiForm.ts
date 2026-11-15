/**
 * The AI connection form as plain data: the draft a parent edits, its validation and the
 * settings it turns into. The API key is never part of the stored draft source: a draft
 * only holds a key the parent typed just now.
 */
import { isLocalAddress } from '@/ai';
import { DEFAULT_AI_SETTINGS, DEFAULT_PROXY_BASE_URL } from '@/core/defaults';
import type { AiProvider, AiSettings } from '@/core/types';
import type { Translate } from '@/i18n';

export interface AiDraft {
  provider: AiProvider;
  /** Base URL used in Direct mode. */
  directBaseUrl: string;
  /** Base URL used in Proxy mode. */
  proxyBaseUrl: string;
  /** A key typed in this form. Empty = keep whatever is stored. */
  apiKey: string;
  /** Remove the stored key when saving. */
  removeKey: boolean;
  chatModel: string;
  imageModel: string;
  dailyRequestBudget: number | null;
  monthlyRequestCap: number | null;
}

export type AiErrors = Partial<Record<'baseUrl' | 'apiKey' | 'chatModel' | 'dailyRequestBudget' | 'monthlyRequestCap', string>>;

export const BUDGET_MAX = 1_000_000;
export const CHAT_MODEL_SUGGESTIONS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'llama3.1', 'qwen2.5'] as const;
export const IMAGE_MODEL_SUGGESTIONS = ['gpt-image-1', 'dall-e-3'] as const;
export const LOCAL_SERVER_EXAMPLES = ['http://localhost:11434/v1', 'http://localhost:1234/v1'] as const;

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function aiDraftOf(ai: AiSettings): AiDraft {
  const proxy = ai.provider === 'proxy';
  return {
    provider: ai.provider,
    directBaseUrl: proxy ? DEFAULT_AI_SETTINGS.baseUrl : ai.baseUrl || DEFAULT_AI_SETTINGS.baseUrl,
    proxyBaseUrl: proxy ? ai.baseUrl || DEFAULT_PROXY_BASE_URL : DEFAULT_PROXY_BASE_URL,
    apiKey: '',
    removeKey: false,
    chatModel: ai.chatModel,
    imageModel: ai.imageModel,
    dailyRequestBudget: ai.dailyRequestBudget,
    monthlyRequestCap: ai.monthlyRequestCap,
  };
}

/** The base URL that applies to the chosen mode. */
export function draftBaseUrl(draft: AiDraft): string {
  return normalizeBaseUrl(draft.provider === 'proxy' ? draft.proxyBaseUrl : draft.directBaseUrl);
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Re-exported for the form's users: the same rule `@/ai` applies when it connects. */
export { isLocalAddress };

function budgetProblem(value: number | null, t: Translate): string | undefined {
  if (value === null || !Number.isInteger(value) || value < 0 || value > BUDGET_MAX) {
    return t('parent.ai.error.budget', { max: BUDGET_MAX });
  }
  return undefined;
}

/** Problems that stop a save. `hasStoredKey`: a usable key is already stored on this device. */
export function validateAiDraft(draft: AiDraft, hasStoredKey: boolean, t: Translate): AiErrors {
  const errors: AiErrors = {};
  const daily = budgetProblem(draft.dailyRequestBudget, t);
  if (daily) errors.dailyRequestBudget = daily;
  const monthly = budgetProblem(draft.monthlyRequestCap, t);
  if (monthly) errors.monthlyRequestCap = monthly;
  if (draft.provider === 'demo') return errors;

  const baseUrl = draftBaseUrl(draft);
  if (draft.chatModel.trim() === '') errors.chatModel = t('parent.ai.error.chatModel');
  if (draft.provider === 'proxy') {
    if (baseUrl !== '' && !baseUrl.startsWith('/') && !isAbsoluteHttpUrl(baseUrl)) errors.baseUrl = t('parent.ai.error.proxyUrl');
    return errors;
  }
  if (baseUrl === '' || !isAbsoluteHttpUrl(baseUrl)) {
    errors.baseUrl = t('parent.ai.error.baseUrl');
    return errors;
  }
  const keyAvailable = draft.apiKey.trim() !== '' || (hasStoredKey && !draft.removeKey);
  if (!keyAvailable && !isLocalAddress(baseUrl)) errors.apiKey = t('parent.ai.error.apiKey');
  return errors;
}

/** The settings to store. The stored key (`apiKeyCipher`) and the temperature are left as they are. */
export function aiSettingsOf(draft: AiDraft, current: AiSettings): AiSettings {
  const baseUrl = draftBaseUrl(draft);
  return {
    ...current,
    provider: draft.provider,
    baseUrl: draft.provider === 'proxy' ? baseUrl || DEFAULT_PROXY_BASE_URL : baseUrl || current.baseUrl,
    chatModel: draft.chatModel.trim(),
    imageModel: draft.provider === 'demo' ? current.imageModel : draft.imageModel.trim(),
    dailyRequestBudget: draft.dailyRequestBudget ?? current.dailyRequestBudget,
    monthlyRequestCap: draft.monthlyRequestCap ?? current.monthlyRequestCap,
  };
}

/** What to pass to `testConnection`, so a parent can test before saving. */
export function connectionOverride(draft: AiDraft): { provider: AiProvider; baseUrl: string; chatModel: string; apiKey?: string } {
  const typedKey = draft.apiKey.trim();
  return {
    provider: draft.provider,
    baseUrl: draftBaseUrl(draft),
    chatModel: draft.chatModel.trim(),
    ...(draft.provider === 'direct' && typedKey !== '' ? { apiKey: typedKey } : {}),
  };
}

export function sameAiDraft(a: AiDraft, b: AiDraft): boolean {
  return (
    a.provider === b.provider &&
    a.directBaseUrl === b.directBaseUrl &&
    a.proxyBaseUrl === b.proxyBaseUrl &&
    a.apiKey === b.apiKey &&
    a.removeKey === b.removeKey &&
    a.chatModel === b.chatModel &&
    a.imageModel === b.imageModel &&
    a.dailyRequestBudget === b.dailyRequestBudget &&
    a.monthlyRequestCap === b.monthlyRequestCap
  );
}

/** Whether story pictures can be made with this draft: an AI mode with an image model. */
export function draftHasImageModel(draft: AiDraft): boolean {
  return draft.provider !== 'demo' && draft.imageModel.trim() !== '';
}
