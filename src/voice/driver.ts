import type { Locale } from '@/core/types';

/** The only reasons `listen` may reject with (as `new Error(code)`). */
export type VoiceErrorCode = 'unsupported' | 'denied' | 'no-speech';

export interface DriverSpeakOptions {
  /** Already clamped to 0.5 .. 2. 1 is the normal speed. */
  rate: number;
  locale: Locale;
  /** Call once, when sound actually starts. */
  onStart?: () => void;
}

export interface DriverListenOptions {
  locale: Locale;
  /** Give up after this long. */
  timeoutMs: number;
}

/**
 * A speech provider. The default one uses the browser's Web Speech API
 * (`createWebSpeechDriver`). Another provider, such as a native Capacitor
 * plugin or an API based voice, implements this interface and is plugged in
 * with `setVoiceDriver`.
 *
 * Rules every driver must follow:
 * - `speak` gets clean text (no emoji, no markdown). It resolves when speech
 *   ended, was stopped, failed or is unsupported. It never rejects.
 * - `speak` stops anything the driver is still saying before it starts.
 * - `listen` records ONE utterance and then releases the microphone. It
 *   rejects with `new Error('unsupported' | 'denied' | 'no-speech')`.
 * - Audio is never stored.
 */
export interface VoiceDriver {
  support(): { tts: boolean; stt: boolean };
  speak(text: string, opts: DriverSpeakOptions): Promise<void>;
  /** Stops speech now. The pending `speak` promise resolves. */
  stop(): void;
  listen(opts: DriverListenOptions): Promise<string>;
  /** Stops recording and settles the pending `listen` with what was heard so far. */
  finishListening(): void;
  /** Releases the microphone now. The pending `listen` rejects with 'no-speech'. */
  cancelListening(): void;
}

export function voiceError(code: VoiceErrorCode): Error {
  return new Error(code);
}

/** Turns anything a driver threw into one of the three documented errors. */
export function normalizeVoiceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  if (message === 'unsupported' || message === 'denied' || message === 'no-speech') {
    return error as Error;
  }
  return voiceError('no-speech');
}
