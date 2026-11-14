import {
  STRANDS,
  type AccessibilitySettings,
  type AiSettings,
  type ParentalControls,
  type Settings,
  type Strand,
} from './types';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'demo',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyCipher: null,
  chatModel: 'gpt-4o-mini',
  imageModel: '',
  temperature: 0.8,
  dailyRequestBudget: 200,
  monthlyRequestCap: 3000,
};

/** Same-origin path the optional Docker AI proxy listens on. */
export const DEFAULT_PROXY_BASE_URL = '/ai-proxy/v1';

export const DEFAULT_CONTROLS: ParentalControls = {
  dailyMinutes: 30,
  allowedStartHour: 7,
  allowedEndHour: 20,
  strands: Object.fromEntries(STRANDS.map((s) => [s, true])) as Record<Strand, boolean>,
  voiceOutput: true,
  microphone: false,
  openChat: false,
  aiImages: false,
  realWorldMissions: true,
  strictness: 'strict',
  keepTranscripts: true,
};

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  dyslexiaFont: false,
  largeText: false,
  highContrast: false,
  reducedMotion: false,
  readAloud: false,
};

export function defaultSettings(now = Date.now()): Settings {
  return {
    id: 'app',
    setupComplete: false,
    auth: null,
    ai: { ...DEFAULT_AI_SETTINGS },
    controls: { ...DEFAULT_CONTROLS, strands: { ...DEFAULT_CONTROLS.strands } },
    locale: 'en',
    contentLocale: 'en',
    createdAt: now,
    updatedAt: now,
  };
}

/** Interests offered as chips in the profile form. Parents can add their own. */
export const INTEREST_SUGGESTIONS = [
  'space',
  'animals',
  'dinosaurs',
  'robots',
  'ocean',
  'cooking',
  'sports',
  'music',
  'cars and trains',
  'superheroes',
  'nature',
  'building',
  'art',
  'video games',
  'fairy tales',
  'weather',
] as const;

export const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🦄', '🐙', '🦖', '🐧', '🚀', '🤖', '🦉', '🐯'] as const;
