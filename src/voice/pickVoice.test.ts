import { describe, expect, it } from 'vitest';
import { pickVoice, scoreVoice, type VoiceLike } from './pickVoice';

function voice(name: string, lang: string, localService = true, isDefault = false): VoiceLike {
  return { name, lang, localService, default: isDefault };
}

describe('pickVoice', () => {
  it('returns null when no voice speaks the language', () => {
    expect(pickVoice([], 'en')).toBeNull();
    expect(pickVoice([voice('Anna', 'de-DE'), voice('Thomas', 'fr-FR')], 'hi')).toBeNull();
  });

  it('only considers voices of the right language', () => {
    const voices = [voice('Thomas', 'fr-FR', true, true), voice('Paulina', 'es-MX'), voice('Samantha', 'en-US')];
    expect(pickVoice(voices, 'es')?.name).toBe('Paulina');
    expect(pickVoice(voices, 'en')?.name).toBe('Samantha');
  });

  it('accepts underscore tags and bare language tags', () => {
    expect(pickVoice([voice('Android voice', 'hi_IN')], 'hi')?.name).toBe('Android voice');
    expect(pickVoice([voice('Generic', 'es')], 'es')?.name).toBe('Generic');
    // "en" must not match "eng-x" style look-alikes of another language.
    expect(pickVoice([voice('Esperanto', 'eo')], 'en')).toBeNull();
  });

  it('prefers an on-device voice over a server voice', () => {
    const voices = [voice('Google US English', 'en-US', false), voice('Microsoft Zira', 'en-US', true)];
    expect(pickVoice(voices, 'en')?.name).toBe('Microsoft Zira');
  });

  it('prefers natural and enhanced voices', () => {
    const voices = [voice('Microsoft David', 'en-US'), voice('Microsoft Aria (Natural)', 'en-US'), voice('Tom', 'en-US')];
    expect(pickVoice(voices, 'en')?.name).toBe('Microsoft Aria (Natural)');
  });

  it('never picks a novelty voice when a normal one exists', () => {
    const voices = [
      voice('Zarvox', 'en-US', true, true),
      voice('Bad News', 'en-US'),
      voice('Whisper', 'en-US'),
      voice('Daniel', 'en-GB'),
    ];
    expect(pickVoice(voices, 'en')?.name).toBe('Daniel');
  });

  it('prefers a friendly voice over a robotic one', () => {
    expect(pickVoice([voice('Fred', 'en-US'), voice('Samantha', 'en-US')], 'en')?.name).toBe('Samantha');
  });

  it('matches friendly names as whole words', () => {
    expect(scoreVoice(voice('Ana', 'en-US'), 'en')).toBeGreaterThan(scoreVoice(voice('Diana', 'en-US'), 'en'));
    expect(scoreVoice(voice('Google हिन्दी', 'hi-IN'), 'hi')).toBeGreaterThan(scoreVoice(voice('Other', 'hi-IN'), 'hi'));
  });

  it('prefers the default region, unless the device uses another one', () => {
    const voices = [voice('Jorge', 'es-ES'), voice('Juan', 'es-MX')];
    expect(pickVoice(voices, 'es')?.name).toBe('Jorge');
    expect(pickVoice(voices, 'es', { deviceLanguages: ['es-MX', 'en-US'] })?.name).toBe('Juan');
  });

  it('can be limited to on-device voices', () => {
    const voices = [voice('Google हिन्दी', 'hi-IN', false)];
    expect(pickVoice(voices, 'hi')?.name).toBe('Google हिन्दी');
    expect(pickVoice(voices, 'hi', { localOnly: true })).toBeNull();
  });
});
