/**
 * Stand-in for `@/voice` in the play and helper tests (jsdom cannot speak or listen). Use it with
 * `vi.mock('@/voice', () => import('@/play/testing/voiceMock'))` and steer it through `voiceMock`.
 */
import { vi } from 'vitest';

export const voiceMock = {
  speak: vi.fn(async (_text: string, _opts?: { rate?: number }) => undefined),
  stopSpeaking: vi.fn(),
  listenOnce: vi.fn(async (): Promise<string> => ''),
  stopListening: vi.fn(),
  cancelListening: vi.fn(),
  /** What `voiceSupport()` reports. */
  support: { tts: true, stt: true },
  /** What `useSpeaking()` and `useListening()` report on the next render. */
  speaking: false,
  listening: false,
  reset(): void {
    voiceMock.speak.mockClear();
    voiceMock.stopSpeaking.mockClear();
    voiceMock.listenOnce.mockReset();
    voiceMock.listenOnce.mockResolvedValue('');
    voiceMock.stopListening.mockClear();
    voiceMock.cancelListening.mockClear();
    voiceMock.support = { tts: true, stt: true };
    voiceMock.speaking = false;
    voiceMock.listening = false;
  },
  /** Every text that was spoken, in order. */
  spoken(): string[] {
    return voiceMock.speak.mock.calls.map((call) => call[0]);
  },
};

export const speak = voiceMock.speak;
export const stopSpeaking = voiceMock.stopSpeaking;
export const listenOnce = voiceMock.listenOnce;
export const stopListening = voiceMock.stopListening;
export const cancelListening = voiceMock.cancelListening;
export const voiceSupport = (): { tts: boolean; stt: boolean } => voiceMock.support;
export const useSpeaking = (): boolean => voiceMock.speaking;
export const useListening = (): boolean => voiceMock.listening;
