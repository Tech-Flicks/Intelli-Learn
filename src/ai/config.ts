/**
 * Works out whether the parent's AI settings are usable and returns them in
 * one resolved shape. This is the only place that reads the stored API key,
 * and it only gets the key for the service the key was entered for.
 */
import { DEFAULT_PROXY_BASE_URL } from '@/core/defaults';
import type { AiProvider } from '@/core/types';
import { getSettings } from '@/data';
import { getApiKeyFor, hasApiKey } from '@/security';

export interface AiConfig {
  provider: 'direct' | 'proxy';
  /** No trailing slash. Absolute for 'direct'; may be a same-origin path for 'proxy'. */
  baseUrl: string;
  /** Only ever set in 'direct' mode. */
  apiKey: string | null;
  chatModel: string;
  /** Empty string when image generation is not configured. */
  imageModel: string;
  temperature: number;
}

export type AiConfigResult =
  | { ok: true; config: AiConfig }
  | { ok: false; provider: AiProvider; reason: string };

export interface AiConfigOverride {
  provider?: AiProvider;
  baseUrl?: string;
  apiKey?: string;
  chatModel?: string;
}

export const REASON_DEMO = 'Demo mode: the built-in challenges are used and no AI service is contacted.';

export const REASON_OTHER_ADDRESS =
  'The saved API key belongs to another address and is not sent to this one. Enter the API key of this service.';

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * True for addresses on this device or the home network (for example Ollama
 * or LM Studio). Such servers normally need no API key.
 */
export function isLocalAddress(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '[::1]' || host === '::1') {
    return true;
  }
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function clampTemperature(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0.8;
  return Math.max(0, Math.min(2, n));
}

/**
 * Reads the settings (and, in direct mode, the stored key) and applies the
 * optional override, which lets the settings form test values before saving.
 * Never throws.
 */
export async function loadAiConfig(override: AiConfigOverride = {}): Promise<AiConfigResult> {
  let provider: AiProvider = override.provider ?? 'demo';
  try {
    const ai = (await getSettings()).ai;
    provider = override.provider ?? ai.provider;
    if (provider === 'demo') return { ok: false, provider, reason: REASON_DEMO };

    const chatModel = (override.chatModel ?? ai.chatModel ?? '').trim();
    if (chatModel === '') return { ok: false, provider, reason: 'No AI model is set. Enter a model name in the AI settings.' };

    let baseUrl = normalizeBaseUrl(override.baseUrl ?? ai.baseUrl ?? '');
    const temperature = clampTemperature(ai.temperature);
    const imageModel = (ai.imageModel ?? '').trim();

    if (provider === 'proxy') {
      if (baseUrl === '') baseUrl = DEFAULT_PROXY_BASE_URL;
      if (!baseUrl.startsWith('/') && !isAbsoluteHttpUrl(baseUrl)) {
        return { ok: false, provider, reason: 'The proxy address must start with / or with http:// or https://.' };
      }
      return { ok: true, config: { provider, baseUrl, apiKey: null, chatModel, imageModel, temperature } };
    }

    if (baseUrl === '') return { ok: false, provider, reason: 'No AI address is set. Enter the base URL of the AI service.' };
    if (!isAbsoluteHttpUrl(baseUrl)) {
      return { ok: false, provider, reason: 'The AI address must start with http:// or https://, for example https://api.openai.com/v1.' };
    }
    const typedKey = override.apiKey?.trim();
    // The stored key is only ever used for the service it was entered for, never for an
    // address that was typed later (for example in a connection test).
    const apiKey = typedKey !== undefined && typedKey !== '' ? typedKey : await getApiKeyFor(baseUrl);
    if (!apiKey && !isLocalAddress(baseUrl)) {
      if (await hasApiKey()) return { ok: false, provider, reason: REASON_OTHER_ADDRESS };
      return { ok: false, provider, reason: 'No API key is stored. Enter the key of the AI service, or switch to demo mode.' };
    }
    return { ok: true, config: { provider, baseUrl, apiKey: apiKey ?? null, chatModel, imageModel, temperature } };
  } catch {
    return { ok: false, provider, reason: 'The AI settings could not be read on this device.' };
  }
}
