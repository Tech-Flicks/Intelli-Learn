/**
 * The default voice driver: the browser's Web Speech API.
 *
 * Text-to-speech uses `speechSynthesis`; speech-to-text uses
 * `SpeechRecognition` / `webkitSpeechRecognition`. No audio is stored, and the
 * microphone is released as soon as one utterance has been heard.
 */
import type { Locale } from '@/core/types';
import { voiceError, type DriverListenOptions, type DriverSpeakOptions, type VoiceDriver, type VoiceErrorCode } from './driver';
import { SPEECH_LANGS, pickVoice } from './pickVoice';
import { chunkText } from './text';

// --- Minimal structural types for the recognition API (not in every TS DOM lib) ---

interface RecognitionAlternativeLike {
  transcript: string;
}
interface RecognitionResultLike {
  isFinal?: boolean;
  length: number;
  [index: number]: RecognitionAlternativeLike | undefined;
}
interface RecognitionEventLike {
  results: { length: number; [index: number]: RecognitionResultLike | undefined };
}
interface RecognitionErrorEventLike {
  error?: string;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onnomatch: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionCtor {
  new (): RecognitionLike;
  /** Newer Chromium: reports whether on-device recognition is ready for a language. */
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<string>;
}

interface SpeechGlobals {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
  navigator?: { languages?: readonly string[] };
  addEventListener?: (type: string, listener: () => void) => void;
}

function globals(): SpeechGlobals {
  return globalThis as unknown as SpeechGlobals;
}

function getSynth(): SpeechSynthesis | null {
  const g = globals();
  return g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function' ? g.speechSynthesis : null;
}

function getRecognitionCtor(): RecognitionCtor | null {
  const g = globals();
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

/** How long to wait for the browser's asynchronous voice list the first time. */
export const VOICES_TIMEOUT_MS = 1200;
/** Some engines drop an utterance that is queued in the same tick as `cancel()`. */
export const RESTART_DELAY_MS = 60;
/** After `stop()` on the recognizer, how long to wait for its final result. */
export const FINISH_GRACE_MS = 1500;

function mapRecognitionError(code: string | undefined): VoiceErrorCode {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'audio-capture':
    case 'language-not-supported':
    case 'network':
      return 'unsupported';
    default:
      return 'no-speech';
  }
}

export interface WebSpeechDriverOptions {
  /**
   * Only use voices that are synthesized on the device. Some browsers also
   * offer server voices, which send the text being spoken to the browser
   * vendor. With this on, a language without an on-device voice stays silent.
   */
  localVoicesOnly?: boolean;
}

export function createWebSpeechDriver(options: WebSpeechDriverOptions = {}): VoiceDriver {
  const voiceCache = new Map<Locale, SpeechSynthesisVoice | null>();
  let voicesWaited = false;
  let hooked = false;

  /** Ends the running speech session (resolves its promise). */
  let endSpeech: (() => void) | null = null;
  /** Controls for the running recognition session. */
  let listening: { finish(): void; cancel(): void } | null = null;

  function hook(synth: SpeechSynthesis): void {
    if (hooked) return;
    hooked = true;
    // The voice list arrives late and can change (a language pack was installed).
    synth.addEventListener?.('voiceschanged', () => voiceCache.clear());
    // Chrome keeps talking after the page is left unless it is told to stop.
    globals().addEventListener?.('pagehide', () => {
      try {
        synth.cancel();
      } catch {
        // nothing to stop
      }
    });
  }

  function loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
    const ready = synth.getVoices();
    if (ready.length > 0 || voicesWaited) return Promise.resolve(ready);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        voicesWaited = true;
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', finish);
        resolve(synth.getVoices());
      };
      const timer = setTimeout(finish, VOICES_TIMEOUT_MS);
      synth.addEventListener?.('voiceschanged', finish);
    });
  }

  async function voiceFor(synth: SpeechSynthesis, locale: Locale): Promise<SpeechSynthesisVoice | null> {
    const cached = voiceCache.get(locale);
    if (cached !== undefined) return cached;
    const voices = await loadVoices(synth);
    const choice = pickVoice(voices, locale, {
      localOnly: options.localVoicesOnly,
      deviceLanguages: globals().navigator?.languages,
    });
    // Do not cache "none" while the list may simply not have arrived yet.
    if (voices.length > 0) voiceCache.set(locale, choice);
    return choice;
  }

  /** When speech was last cut off, so the next utterance can wait a moment. */
  let cancelledAt = Number.NEGATIVE_INFINITY;

  function stop(): void {
    const end = endSpeech;
    endSpeech = null;
    end?.();
    const synth = getSynth();
    if (!synth) return;
    if (end || synth.speaking || synth.pending) cancelledAt = Date.now();
    try {
      synth.cancel();
    } catch {
      // nothing to stop
    }
  }

  function speak(text: string, opts: DriverSpeakOptions): Promise<void> {
    const synth = getSynth();
    const Utterance = globals().SpeechSynthesisUtterance;
    const chunks = chunkText(text);
    if (!synth || !Utterance || chunks.length === 0) return Promise.resolve();
    hook(synth);

    stop();
    const restartDelay = cancelledAt + RESTART_DELAY_MS - Date.now();

    return new Promise<void>((resolve) => {
      let finished = false;
      let started = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let startTimer: ReturnType<typeof setTimeout> | undefined;
      // Chrome can garbage-collect an utterance before `onend` fires unless something holds it.
      let current: SpeechSynthesisUtterance | null = null;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        clearTimeout(startTimer);
        if (current) {
          current.onstart = null;
          current.onend = null;
          current.onerror = null;
          current = null;
        }
        if (endSpeech === finish) endSpeech = null;
        resolve();
      };
      endSpeech = finish;

      const begin = async () => {
        const voice = await voiceFor(synth, opts.locale);
        if (finished) return;
        if (!voice && options.localVoicesOnly && synth.getVoices().length > 0) {
          // Only server voices exist for this language, and they are not allowed.
          finish();
          return;
        }
        let index = 0;
        const next = () => {
          if (finished) return;
          const chunk = chunks[index];
          if (chunk === undefined) {
            finish();
            return;
          }
          const utterance = new Utterance(chunk);
          if (voice) utterance.voice = voice;
          utterance.lang = voice?.lang ?? SPEECH_LANGS[opts.locale][0] ?? opts.locale;
          utterance.rate = opts.rate;
          utterance.pitch = 1;
          utterance.onstart = () => {
            if (finished || started) return;
            started = true;
            opts.onStart?.();
          };
          utterance.onend = () => {
            if (finished || current !== utterance) return;
            index += 1;
            next();
          };
          utterance.onerror = () => {
            if (current === utterance) finish();
          };
          current = utterance;
          // If the engine never reports the end, do not leave the caller waiting forever.
          clearTimeout(watchdog);
          watchdog = setTimeout(
            () => {
              try {
                synth.cancel();
              } catch {
                // nothing to stop
              }
              finish();
            },
            (chunk.length * 130) / opts.rate + 8000,
          );
          try {
            synth.resume();
            synth.speak(utterance);
          } catch {
            finish();
          }
        };
        next();
      };

      if (restartDelay > 0) startTimer = setTimeout(() => void begin(), restartDelay);
      else void begin();
    });
  }

  function cancelListening(): void {
    listening?.cancel();
  }

  function finishListening(): void {
    listening?.finish();
  }

  async function localRecognitionReady(Ctor: RecognitionCtor, lang: string): Promise<boolean> {
    try {
      return (await Ctor.available?.({ langs: [lang], processLocally: true })) === 'available';
    } catch {
      return false;
    }
  }

  function listen(opts: DriverListenOptions): Promise<string> {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return Promise.reject(voiceError('unsupported'));
    cancelListening();
    const lang = SPEECH_LANGS[opts.locale][0] ?? opts.locale;

    return new Promise<string>((resolve, reject) => {
      let recognition: RecognitionLike;
      try {
        recognition = new Ctor();
      } catch {
        reject(voiceError('unsupported'));
        return;
      }
      let settled = false;
      let transcript = '';
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      const settle = (error: VoiceErrorCode | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(graceTimer);
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onnomatch = null;
        // Always let go of the microphone, whatever happened.
        try {
          recognition.abort();
        } catch {
          // already stopped
        }
        if (listening === controls) listening = null;
        if (error === null && transcript) resolve(transcript);
        else reject(voiceError(error ?? 'no-speech'));
      };

      const controls = {
        finish() {
          if (settled) return;
          if (transcript) {
            settle(null);
            return;
          }
          try {
            recognition.stop(); // asks for the final result, then `onend`
          } catch {
            settle('no-speech');
            return;
          }
          clearTimeout(graceTimer);
          graceTimer = setTimeout(() => settle(transcript ? null : 'no-speech'), FINISH_GRACE_MS);
        },
        cancel() {
          settle('no-speech');
        },
      };
      listening = controls;

      const timer = setTimeout(() => settle(transcript ? null : 'no-speech'), opts.timeoutMs);

      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        let heard = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result || result.isFinal === false) continue;
          heard += `${result[0]?.transcript ?? ''} `;
        }
        heard = heard.replace(/\s+/g, ' ').trim();
        if (!heard) return;
        transcript = heard;
        settle(null);
      };
      recognition.onnomatch = () => settle('no-speech');
      recognition.onerror = (event) => settle(mapRecognitionError(event.error));
      recognition.onend = () => settle(transcript ? null : 'no-speech');

      const start = () => {
        if (settled) return;
        try {
          recognition.start();
        } catch {
          settle('unsupported');
        }
      };

      if (typeof Ctor.available === 'function') {
        // Prefer on-device recognition when the browser has it, so audio stays on the device.
        void localRecognitionReady(Ctor, lang).then((local) => {
          if (local && !settled) recognition.processLocally = true;
          start();
        });
      } else {
        start();
      }
    });
  }

  return {
    support: () => ({ tts: getSynth() !== null, stt: getRecognitionCtor() !== null }),
    speak,
    stop,
    listen,
    finishListening,
    cancelListening,
  };
}
