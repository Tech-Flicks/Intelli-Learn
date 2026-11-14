/** Chooses the most pleasant voice a device offers for a locale. Pure, so it can be unit tested. */
import type { Locale } from '@/core/types';

/** The subset of `SpeechSynthesisVoice` this module reads. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/** Language tags for speech, most wanted region first. The first one is also used for speech recognition. */
export const SPEECH_LANGS: Record<Locale, readonly string[]> = {
  en: ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN'],
  es: ['es-ES', 'es-MX', 'es-US', 'es-419'],
  hi: ['hi-IN'],
};

/** High quality voice families. */
const NATURAL = /natural|neural|enhanced|premium|siri|wavenet/i;

/** Clear, warm voices that children follow well, by platform. */
const FRIENDLY = [
  // Apple
  'samantha',
  'ava',
  'allison',
  'susan',
  'karen',
  'moira',
  'tessa',
  'mónica',
  'monica',
  'paulina',
  'marisol',
  'lekha',
  // Microsoft
  'ana',
  'aria',
  'jenny',
  'zira',
  'elvira',
  'dalia',
  'sabina',
  'helena',
  'laura',
  'swara',
  'kalpana',
  // Google
  'google us english',
  'google uk english female',
  'google español',
  'google हिन्दी',
];

/** Joke and sound-effect voices (macOS), which would confuse or scare a child. */
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;

/** Old, robotic voices that are hard to understand. */
const ROBOTIC = /\b(fred|ralph|kathy|princess|bruce|junior|espeak)\b/i;

function normalizeTag(tag: string): string {
  return tag.replace(/_/g, '-').toLowerCase();
}

export interface PickVoiceOptions {
  /** Never choose a voice that is synthesized on a server. */
  localOnly?: boolean;
  /** The device's own languages (`navigator.languages`). A matching region wins over the default order. */
  deviceLanguages?: readonly string[];
}

export function scoreVoice(voice: VoiceLike, locale: Locale, opts: PickVoiceOptions = {}): number {
  const tag = normalizeTag(voice.lang);
  if (tag !== locale && !tag.startsWith(`${locale}-`)) return -Infinity;
  if (opts.localOnly && !voice.localService) return -Infinity;

  let score = 0;
  const deviceTags = (opts.deviceLanguages ?? []).map(normalizeTag);
  if (tag.includes('-') && deviceTags.includes(tag)) score += 50;
  const regionRank = SPEECH_LANGS[locale].findIndex((wanted) => normalizeTag(wanted) === tag);
  if (regionRank >= 0) score += 40 - regionRank * 4;
  else score += 10;

  // On-device voices work offline and keep the text on the device.
  if (voice.localService) score += 30;
  if (NATURAL.test(voice.name)) score += 25;
  // Whole-word match, so "Ana" does not match "Diana".
  const words = ` ${voice.name.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')} `;
  if (FRIENDLY.some((friendly) => words.includes(` ${friendly} `))) score += 15;
  if (NOVELTY.test(voice.name)) score -= 200;
  if (ROBOTIC.test(voice.name)) score -= 40;
  if (voice.default) score += 5;
  return score;
}

/** The best voice for the locale, or null when the device has none for that language. */
export function pickVoice<V extends VoiceLike>(
  voices: readonly V[],
  locale: Locale,
  opts: PickVoiceOptions = {},
): V | null {
  let best: V | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const score = scoreVoice(voice, locale, opts);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return bestScore === -Infinity ? null : best;
}
