import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelListening,
  createWebSpeechDriver,
  isListening,
  isSpeaking,
  listenOnce,
  setVoiceDriver,
  speak,
  stopListening,
  stopSpeaking,
  useListening,
  useSpeaking,
  voiceSupport,
  type VoiceDriver,
} from './index';
import { FINISH_GRACE_MS, VOICES_TIMEOUT_MS } from './webSpeech';

// --- fakes for the Web Speech globals --------------------------------------

class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  pitch = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

interface FakeVoice {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

function fakeVoice(name: string, lang: string, localService = true): FakeVoice {
  return { name, lang, localService, default: false };
}

class FakeSynth {
  speaking = false;
  pending = false;
  spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  cancelCalls = 0;
  /** When false, `speak` never fires `onstart` (an engine that stalls). */
  autoStart = true;
  private listeners = new Map<string, Set<() => void>>();

  constructor(public voices: FakeVoice[]) {}

  getVoices(): FakeVoice[] {
    return this.voices;
  }
  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance);
    this.current = utterance;
    this.speaking = true;
    if (this.autoStart) utterance.onstart?.();
  }
  cancel(): void {
    this.cancelCalls += 1;
    this.speaking = false;
    this.current = null;
  }
  resume(): void {}
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  /** The engine finished the current utterance. */
  endCurrent(): void {
    const utterance = this.current;
    this.current = null;
    this.speaking = false;
    utterance?.onend?.();
  }
  failCurrent(error: string): void {
    const utterance = this.current;
    this.current = null;
    this.speaking = false;
    utterance?.onerror?.({ error });
  }
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static startThrows = false;
  lang = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 5;
  processLocally?: boolean;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onnomatch: (() => void) | null = null;
  started = false;
  stopCalls = 0;
  abortCalls = 0;
  /** True while the microphone would be open. */
  micOpen = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start(): void {
    if (FakeRecognition.startThrows) throw new Error('InvalidStateError');
    this.started = true;
    this.micOpen = true;
  }
  stop(): void {
    this.stopCalls += 1;
  }
  abort(): void {
    this.abortCalls += 1;
    this.micOpen = false;
  }
  hear(transcript: string, isFinal = true): void {
    this.onresult?.({ results: { length: 1, 0: { isFinal, length: 1, 0: { transcript } } } });
  }
  fail(error: string): void {
    this.onerror?.({ error });
  }
  end(): void {
    this.micOpen = false;
    this.onend?.();
  }
}

function lastRecognition(): FakeRecognition {
  const instance = FakeRecognition.instances.at(-1);
  if (!instance) throw new Error('no recognition was created');
  return instance;
}

const VOICES = [
  fakeVoice('Zarvox', 'en-US'),
  fakeVoice('Samantha', 'en-US'),
  fakeVoice('Paulina', 'es-MX'),
  fakeVoice('Mónica', 'es-ES'),
  fakeVoice('Lekha', 'hi-IN'),
];

let synth: FakeSynth;

/** Lets pending promise callbacks run under fake timers. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function installSpeech(voices: FakeVoice[] = VOICES): FakeSynth {
  synth = new FakeSynth(voices);
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return synth;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.instances = [];
  FakeRecognition.startThrows = false;
  document.documentElement.lang = 'en';
  installSpeech();
  vi.stubGlobal('SpeechRecognition', undefined);
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  setVoiceDriver(createWebSpeechDriver());
});

afterEach(() => {
  setVoiceDriver(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('voiceSupport', () => {
  it('reports what the browser offers', () => {
    expect(voiceSupport()).toEqual({ tts: true, stt: true });
    vi.stubGlobal('speechSynthesis', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    expect(voiceSupport()).toEqual({ tts: false, stt: false });
  });

  it('accepts the unprefixed SpeechRecognition', () => {
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    expect(voiceSupport().stt).toBe(true);
  });
});

describe('speak', () => {
  it('speaks cleaned text with the best voice and resolves at the end', async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    let resolved = false;
    const done = speak('**Great** job! 🎉', { rate: 0.8, onStart, onEnd }).then(() => {
      resolved = true;
    });
    await flush();

    expect(synth.spoken).toHaveLength(1);
    const utterance = synth.spoken[0];
    expect(utterance?.text).toBe('Great job!');
    expect((utterance?.voice as FakeVoice).name).toBe('Samantha');
    expect(utterance?.lang).toBe('en-US');
    expect(utterance?.rate).toBe(0.8);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(isSpeaking()).toBe(true);
    expect(resolved).toBe(false);

    synth.endCurrent();
    await done;
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isSpeaking()).toBe(false);
  });

  it('uses the page language by default and the given locale when set', async () => {
    document.documentElement.lang = 'hi';
    void speak('नमस्ते');
    await flush();
    expect((synth.spoken[0]?.voice as FakeVoice).name).toBe('Lekha');
    synth.endCurrent();
    await flush();

    void speak('Hola', { locale: 'es' });
    await flush();
    expect((synth.spoken[1]?.voice as FakeVoice).name).toBe('Mónica');
    expect(synth.spoken[1]?.lang).toBe('es-ES');
  });

  it('speaks long text one sentence chunk at a time', async () => {
    const sentence = 'The little robot rolled across the shiny floor to look for one more gem.';
    const text = Array.from({ length: 6 }, () => sentence).join(' ');
    const onStart = vi.fn();
    let resolved = false;
    const done = speak(text, { onStart }).then(() => {
      resolved = true;
    });
    await flush();
    expect(synth.spoken).toHaveLength(1);

    let guard = 0;
    while (!resolved && guard < 20) {
      synth.endCurrent();
      await flush();
      guard += 1;
    }
    await done;
    expect(synth.spoken.length).toBeGreaterThan(1);
    for (const utterance of synth.spoken) expect(utterance.text.length).toBeLessThanOrEqual(180);
    expect(synth.spoken.map((u) => u.text).join(' ')).toBe(text);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('clamps the rate', async () => {
    void speak('fast', { rate: 9 });
    await flush();
    expect(synth.spoken[0]?.rate).toBe(2);
    synth.endCurrent();
    await flush();
    void speak('slow', { rate: 0.01 });
    await flush();
    expect(synth.spoken[1]?.rate).toBe(0.5);
    synth.endCurrent();
    await flush();
    void speak('odd', { rate: Number.NaN });
    await flush();
    expect(synth.spoken[2]?.rate).toBe(1);
  });

  it('resolves when stopped', async () => {
    const onEnd = vi.fn();
    const done = speak('Keep going until someone stops me.', { onEnd });
    await flush();
    expect(isSpeaking()).toBe(true);
    stopSpeaking();
    await done;
    expect(synth.cancelCalls).toBeGreaterThan(0);
    expect(isSpeaking()).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    // A late event from the cancelled utterance changes nothing.
    synth.spoken[0]?.onend?.();
    expect(synth.spoken).toHaveLength(1);
  });

  it('cancels current speech when a new one starts', async () => {
    const firstEnd = vi.fn();
    const first = speak('First sentence.', { onEnd: firstEnd });
    await flush();
    const cancelsBefore = synth.cancelCalls;
    const second = speak('Second sentence.');
    await first;
    expect(firstEnd).toHaveBeenCalledTimes(1);
    expect(synth.cancelCalls).toBeGreaterThan(cancelsBefore);
    expect(isSpeaking()).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(synth.spoken.map((u) => u.text)).toEqual(['First sentence.', 'Second sentence.']);
    synth.endCurrent();
    await second;
    expect(isSpeaking()).toBe(false);
  });

  it('stops current speech and stays quiet for text with nothing to say', async () => {
    const first = speak('Hello there.');
    await flush();
    const onEnd = vi.fn();
    await speak('🎉🎉', { onEnd });
    await first;
    expect(synth.spoken).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isSpeaking()).toBe(false);
  });

  it('resolves when speech is not supported', async () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    await expect(speak('Hello', { onStart, onEnd })).resolves.toBeUndefined();
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isSpeaking()).toBe(false);
  });

  it('waits for the voice list to arrive', async () => {
    installSpeech([]);
    setVoiceDriver(createWebSpeechDriver());
    void speak('Hello');
    await flush();
    expect(synth.spoken).toHaveLength(0);
    synth.voices = VOICES;
    synth.emit('voiceschanged');
    await flush();
    expect(synth.spoken).toHaveLength(1);
    expect((synth.spoken[0]?.voice as FakeVoice).name).toBe('Samantha');
  });

  it('speaks with the browser default when no voice list ever arrives', async () => {
    installSpeech([]);
    setVoiceDriver(createWebSpeechDriver());
    void speak('Hola', { locale: 'es' });
    await vi.advanceTimersByTimeAsync(VOICES_TIMEOUT_MS + 1);
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]?.voice).toBeNull();
    expect(synth.spoken[0]?.lang).toBe('es-ES');
  });

  it('picks again after the voice list changes', async () => {
    installSpeech([fakeVoice('Fred', 'en-US')]);
    setVoiceDriver(createWebSpeechDriver());
    void speak('One.');
    await flush();
    expect((synth.spoken[0]?.voice as FakeVoice).name).toBe('Fred');
    synth.endCurrent();
    await flush();

    synth.voices = [fakeVoice('Fred', 'en-US'), fakeVoice('Samantha (Enhanced)', 'en-US')];
    synth.emit('voiceschanged');
    void speak('Two.');
    await flush();
    expect((synth.spoken[1]?.voice as FakeVoice).name).toBe('Samantha (Enhanced)');
  });

  it('resolves when the engine reports an error', async () => {
    const done = speak('Hello');
    await flush();
    synth.failCurrent('synthesis-failed');
    await expect(done).resolves.toBeUndefined();
    expect(isSpeaking()).toBe(false);
  });

  it('resolves even when the engine never reports the end', async () => {
    synth.autoStart = false;
    let resolved = false;
    void speak('Hello').then(() => {
      resolved = true;
    });
    await flush();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resolved).toBe(true);
    expect(isSpeaking()).toBe(false);
  });

  it('stays silent with localVoicesOnly when only server voices exist', async () => {
    installSpeech([fakeVoice('Google हिन्दी', 'hi-IN', false)]);
    setVoiceDriver(createWebSpeechDriver({ localVoicesOnly: true }));
    await speak('नमस्ते', { locale: 'hi' });
    expect(synth.spoken).toHaveLength(0);

    setVoiceDriver(createWebSpeechDriver());
    void speak('नमस्ते', { locale: 'hi' });
    await flush();
    expect(synth.spoken).toHaveLength(1);
  });
});

describe('setVoiceDriver', () => {
  function fakeDriver(overrides: Partial<VoiceDriver> = {}): VoiceDriver {
    return {
      support: () => ({ tts: true, stt: true }),
      speak: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      listen: vi.fn(() => Promise.resolve('seven')),
      finishListening: vi.fn(),
      cancelListening: vi.fn(),
      ...overrides,
    };
  }

  it('routes speech and listening through the custom driver', async () => {
    const custom = fakeDriver();
    setVoiceDriver(custom);
    await speak('Hi *there* 👋', { rate: 1.2, locale: 'es' });
    expect(custom.speak).toHaveBeenCalledWith('Hi there', expect.objectContaining({ rate: 1.2, locale: 'es' }));
    expect(synth.spoken).toHaveLength(0);
    await expect(listenOnce({ locale: 'hi', timeoutMs: 3000 })).resolves.toBe('seven');
    expect(custom.listen).toHaveBeenCalledWith({ locale: 'hi', timeoutMs: 3000 });
  });

  it('never lets a broken driver reject speak', async () => {
    setVoiceDriver(
      fakeDriver({
        speak: () => Promise.reject(new Error('boom')),
        stop: () => {
          throw new Error('boom');
        },
      }),
    );
    const onEnd = vi.fn();
    await expect(speak('Hello', { onEnd })).resolves.toBeUndefined();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isSpeaking()).toBe(false);
  });

  it('maps unknown listen failures to no-speech and empty results too', async () => {
    setVoiceDriver(fakeDriver({ listen: () => Promise.reject(new Error('weird')) }));
    await expect(listenOnce()).rejects.toThrow('no-speech');
    setVoiceDriver(fakeDriver({ listen: () => Promise.resolve('   ') }));
    await expect(listenOnce()).rejects.toThrow('no-speech');
  });

  it('goes back to the built-in driver with null', async () => {
    setVoiceDriver(fakeDriver());
    setVoiceDriver(null);
    void speak('Hello');
    await flush();
    expect(synth.spoken).toHaveLength(1);
  });
});

describe('listenOnce', () => {
  it('rejects with unsupported when the browser has no recognition', async () => {
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    await expect(listenOnce()).rejects.toThrow('unsupported');
    expect(isListening()).toBe(false);
  });

  it('resolves with one utterance and closes the microphone', async () => {
    const heard = listenOnce({ locale: 'es' });
    await flush();
    const recognition = lastRecognition();
    expect(recognition.started).toBe(true);
    expect(recognition.lang).toBe('es-ES');
    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(false);
    expect(recognition.maxAlternatives).toBe(1);
    expect(isListening()).toBe(true);

    recognition.hear('  son   siete ');
    await expect(heard).resolves.toBe('son siete');
    expect(recognition.micOpen).toBe(false);
    expect(recognition.abortCalls).toBeGreaterThan(0);
    expect(recognition.onresult).toBeNull();
    expect(isListening()).toBe(false);
  });

  it('maps locales to recognition languages', async () => {
    const cases = [
      ['en', 'en-US'],
      ['es', 'es-ES'],
      ['hi', 'hi-IN'],
    ] as const;
    for (const [locale, lang] of cases) {
      const heard = listenOnce({ locale });
      await flush();
      expect(lastRecognition().lang).toBe(lang);
      lastRecognition().hear('ok');
      await heard;
    }
  });

  it('stops the helper talking before it listens', async () => {
    void speak('I am still talking.');
    await flush();
    expect(isSpeaking()).toBe(true);
    const heard = listenOnce();
    await flush();
    expect(isSpeaking()).toBe(false);
    lastRecognition().hear('four');
    await expect(heard).resolves.toBe('four');
  });

  it('rejects with denied when the microphone is blocked', async () => {
    const heard = listenOnce();
    const assertion = expect(heard).rejects.toThrow('denied');
    await flush();
    lastRecognition().fail('not-allowed');
    await assertion;
    expect(lastRecognition().micOpen).toBe(false);
    expect(isListening()).toBe(false);
  });

  it('rejects with unsupported when there is no microphone or no service', async () => {
    for (const code of ['audio-capture', 'network', 'language-not-supported']) {
      const heard = listenOnce();
      const assertion = expect(heard).rejects.toThrow('unsupported');
      await flush();
      lastRecognition().fail(code);
      await assertion;
    }
  });

  it('rejects with no-speech when nothing was said', async () => {
    const heard = listenOnce();
    const assertion = expect(heard).rejects.toThrow('no-speech');
    await flush();
    lastRecognition().end();
    await assertion;

    const second = listenOnce();
    const secondAssertion = expect(second).rejects.toThrow('no-speech');
    await flush();
    lastRecognition().fail('no-speech');
    await secondAssertion;
  });

  it('ignores results that are not final', async () => {
    const heard = listenOnce();
    await flush();
    const recognition = lastRecognition();
    recognition.hear('thr', false);
    expect(isListening()).toBe(true);
    recognition.hear('three');
    await expect(heard).resolves.toBe('three');
  });

  it('times out with no-speech and closes the microphone', async () => {
    const heard = listenOnce({ timeoutMs: 2000 });
    const assertion = expect(heard).rejects.toThrow('no-speech');
    await flush();
    const recognition = lastRecognition();
    expect(recognition.micOpen).toBe(true);
    await vi.advanceTimersByTimeAsync(2001);
    await assertion;
    expect(recognition.micOpen).toBe(false);
    expect(isListening()).toBe(false);
  });

  it('rejects with unsupported when recognition cannot start', async () => {
    FakeRecognition.startThrows = true;
    const heard = listenOnce();
    const assertion = expect(heard).rejects.toThrow('unsupported');
    await flush();
    await assertion;
  });

  it('stopListening ends a hold-to-talk and returns what was heard', async () => {
    const heard = listenOnce();
    await flush();
    const recognition = lastRecognition();
    stopListening();
    expect(recognition.stopCalls).toBe(1);
    recognition.hear('twelve');
    await expect(heard).resolves.toBe('twelve');
    expect(recognition.micOpen).toBe(false);
  });

  it('stopListening gives up when no result follows', async () => {
    const heard = listenOnce();
    const assertion = expect(heard).rejects.toThrow('no-speech');
    await flush();
    stopListening();
    await vi.advanceTimersByTimeAsync(FINISH_GRACE_MS + 1);
    await assertion;
    expect(lastRecognition().micOpen).toBe(false);
  });

  it('cancelListening releases the microphone at once', async () => {
    const heard = listenOnce();
    const assertion = expect(heard).rejects.toThrow('no-speech');
    await flush();
    cancelListening();
    await assertion;
    expect(lastRecognition().micOpen).toBe(false);
    expect(isListening()).toBe(false);
  });

  it('a new listen cancels the one before it', async () => {
    const first = listenOnce();
    const firstAssertion = expect(first).rejects.toThrow('no-speech');
    await flush();
    const firstRecognition = lastRecognition();
    const second = listenOnce();
    await firstAssertion;
    await flush();
    expect(firstRecognition.micOpen).toBe(false);
    expect(isListening()).toBe(true);
    lastRecognition().hear('nine');
    await expect(second).resolves.toBe('nine');
    expect(isListening()).toBe(false);
  });

  it('uses on-device recognition when the browser says it is ready', async () => {
    class LocalRecognition extends FakeRecognition {
      static available = vi.fn(() => Promise.resolve('available'));
    }
    vi.stubGlobal('webkitSpeechRecognition', LocalRecognition);
    const heard = listenOnce({ locale: 'en' });
    await flush();
    const recognition = lastRecognition();
    expect(LocalRecognition.available).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    expect(recognition.processLocally).toBe(true);
    expect(recognition.started).toBe(true);
    recognition.hear('two');
    await expect(heard).resolves.toBe('two');
  });

  it('falls back to normal recognition when on-device is not ready', async () => {
    class CloudRecognition extends FakeRecognition {
      static available = vi.fn(() => Promise.reject(new Error('nope')));
    }
    vi.stubGlobal('webkitSpeechRecognition', CloudRecognition);
    const heard = listenOnce();
    await flush();
    const recognition = lastRecognition();
    expect(recognition.processLocally).toBeUndefined();
    expect(recognition.started).toBe(true);
    recognition.hear('two');
    await expect(heard).resolves.toBe('two');
  });
});

describe('hooks', () => {
  it('useSpeaking follows speech', async () => {
    const { result } = renderHook(() => useSpeaking());
    expect(result.current).toBe(false);
    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = speak('Hello');
      await flush();
    });
    expect(result.current).toBe(true);
    await act(async () => {
      synth.endCurrent();
      await done;
    });
    expect(result.current).toBe(false);
  });

  it('useListening follows the microphone', async () => {
    const { result } = renderHook(() => useListening());
    let heard: Promise<string> = Promise.resolve('');
    await act(async () => {
      heard = listenOnce();
      await flush();
    });
    expect(result.current).toBe(true);
    await act(async () => {
      lastRecognition().hear('one');
      await heard;
    });
    expect(result.current).toBe(false);
  });
});
