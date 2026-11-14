/**
 * `@/voice`: text-to-speech and speech-to-text behind one interface.
 *
 * Callers use `speak`, `stopSpeaking`, `listenOnce` and the `useSpeaking` /
 * `useListening` hooks. The actual provider is a `VoiceDriver`; the default one
 * wraps the browser's Web Speech API and can be replaced with `setVoiceDriver`.
 */
import { useSyncExternalStore } from 'react';
import { LOCALES, type Locale } from '@/core/types';
import { normalizeVoiceError, voiceError, type VoiceDriver } from './driver';
import { cleanForSpeech } from './text';
import { createWebSpeechDriver } from './webSpeech';

export type { DriverListenOptions, DriverSpeakOptions, VoiceDriver, VoiceErrorCode } from './driver';
export { createWebSpeechDriver } from './webSpeech';
export type { WebSpeechDriverOptions } from './webSpeech';
export { SPEECH_LANGS, pickVoice } from './pickVoice';
export type { PickVoiceOptions, VoiceLike } from './pickVoice';
export { chunkText, cleanForSpeech } from './text';

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const DEFAULT_LISTEN_TIMEOUT_MS = 8000;

// --- tiny external store for "is speaking" / "is listening" ---------------

interface Flag {
  get(): boolean;
  set(value: boolean): void;
  subscribe(listener: () => void): () => void;
}

function createFlag(): Flag {
  let value = false;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const speakingFlag = createFlag();
const listeningFlag = createFlag();

// --- driver ---------------------------------------------------------------

let defaultDriver: VoiceDriver | null = null;
let customDriver: VoiceDriver | null = null;

function driver(): VoiceDriver {
  if (customDriver) return customDriver;
  defaultDriver ??= createWebSpeechDriver();
  return defaultDriver;
}

/**
 * Plugs in another speech provider. Pass `null` to go back to the built-in
 * Web Speech driver. Anything the old driver is doing is stopped first.
 */
export function setVoiceDriver(next: VoiceDriver | null): void {
  stopSpeaking();
  cancelListening();
  customDriver = next;
}

function safely(action: () => void): void {
  try {
    action();
  } catch {
    // A broken driver must never break the screen that uses it.
  }
}

/** The page language (set by `@/i18n`), or English. */
function pageLocale(): Locale {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang.slice(0, 2).toLowerCase();
  return (LOCALES as readonly string[]).includes(lang) ? (lang as Locale) : 'en';
}

function clampRate(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

// --- public API -------------------------------------------------------------

export function voiceSupport(): { tts: boolean; stt: boolean } {
  try {
    const support = driver().support();
    return { tts: Boolean(support.tts), stt: Boolean(support.stt) };
  } catch {
    return { tts: false, stt: false };
  }
}

let speakToken = 0;

/**
 * Reads text aloud. Emoji and markdown symbols are removed first, long text is
 * spoken sentence by sentence, and any speech already playing is stopped.
 * Resolves when speech is done or stopped. Never rejects, also when the
 * device cannot speak. `onEnd` is always called when the promise resolves.
 */
export async function speak(
  text: string,
  opts: { rate?: number; locale?: Locale; onStart?: () => void; onEnd?: () => void } = {},
): Promise<void> {
  speakToken += 1;
  const token = speakToken;
  const active = driver();
  safely(() => active.stop());

  const clean = cleanForSpeech(text);
  if (!clean || !voiceSupport().tts) {
    speakingFlag.set(false);
    safely(() => opts.onEnd?.());
    return;
  }

  speakingFlag.set(true);
  let started = false;
  try {
    await active.speak(clean, {
      rate: clampRate(opts.rate),
      locale: opts.locale ?? pageLocale(),
      onStart: () => {
        if (started || token !== speakToken) return;
        started = true;
        safely(() => opts.onStart?.());
      },
    });
  } catch {
    // Drivers must not reject; if one does, speech simply ends.
  }
  // A newer speak() or stopSpeaking() owns the flag when the token moved on.
  if (token === speakToken) speakingFlag.set(false);
  safely(() => opts.onEnd?.());
}

/** Stops speech at once. The pending `speak` promise resolves. */
export function stopSpeaking(): void {
  speakToken += 1;
  safely(() => driver().stop());
  speakingFlag.set(false);
}

let listenToken = 0;

/**
 * Listens for ONE utterance and resolves with what was said. The helper stops
 * talking first, so it does not hear itself. The microphone is released as soon
 * as the promise settles. Rejects with `Error('unsupported' | 'denied' | 'no-speech')`.
 *
 * Call this only from the child's tap or hold on the mic button, and only when
 * the parent enabled the microphone.
 */
export async function listenOnce(opts: { locale?: Locale; timeoutMs?: number } = {}): Promise<string> {
  if (!voiceSupport().stt) throw voiceError('unsupported');
  stopSpeaking();
  listenToken += 1;
  const token = listenToken;
  const active = driver();
  const timeoutMs =
    opts.timeoutMs !== undefined && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_LISTEN_TIMEOUT_MS;
  listeningFlag.set(true);
  try {
    const heard = await active.listen({ locale: opts.locale ?? pageLocale(), timeoutMs });
    const transcript = typeof heard === 'string' ? heard.trim() : '';
    if (!transcript) throw voiceError('no-speech');
    return transcript;
  } catch (error) {
    throw normalizeVoiceError(error);
  } finally {
    if (token === listenToken) {
      listeningFlag.set(false);
      // Belt and braces: whatever the driver did, the microphone is closed now.
      safely(() => active.cancelListening());
    }
  }
}

/** For hold-to-talk: stop recording now and settle `listenOnce` with what was heard so far. */
export function stopListening(): void {
  safely(() => driver().finishListening());
}

/** Releases the microphone now. A pending `listenOnce` rejects with 'no-speech'. */
export function cancelListening(): void {
  safely(() => driver().cancelListening());
  listeningFlag.set(false);
}

/** True while speech is playing. */
export function useSpeaking(): boolean {
  return useSyncExternalStore(speakingFlag.subscribe, speakingFlag.get, speakingFlag.get);
}

/** True while the microphone is open. */
export function useListening(): boolean {
  return useSyncExternalStore(listeningFlag.subscribe, listeningFlag.get, listeningFlag.get);
}

/** Non-React reads of the same flags. */
export function isSpeaking(): boolean {
  return speakingFlag.get();
}
export function isListening(): boolean {
  return listeningFlag.get();
}
