/**
 * The smaller AI tasks: story outlines, learner notes, weekly reports and
 * story illustrations. Each one has a fallback that needs no AI, and none of
 * them ever throws.
 */
import {
  LearnerNotesSchema,
  StoryOutlineSchema,
  WeeklyReportSchema,
  type LearnerNotesOutput,
  type StoryOutline,
  type WeeklyReportOutput,
} from '@/core/schemas';
import type { Locale, Strand } from '@/core/types';
import { getSettings } from '@/data';
import { pickOfflineStory } from '@/offline';
import { chatJson, postJson, type ChatMessage } from './client';
import { loadAiConfig } from './config';
import { noteAiFailure } from './diagnostics';
import { buildImagePrompt, buildNotesPrompt, buildReportPrompt, buildStoryPrompt, clampChapters, percent, type Prompt } from './prompts';
import { checkTexts, localSafetyCheck, moderateTexts } from './safety';
import type { LearnerNotesRequest, StoryOutlineRequest, WeeklyReportRequest } from './types';

function asMessages(prompt: Prompt): ChatMessage[] {
  return [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
}

/** The language the parent reads the app in; falls back to the given one. */
async function parentLocale(fallback: Locale): Promise<Locale> {
  try {
    return (await getSettings()).locale ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Story outline
// ---------------------------------------------------------------------------

function storyTexts(story: StoryOutline): string[] {
  return [story.title, story.ending, ...story.chapters.flatMap((chapter) => [chapter.heading, chapter.narrative, chapter.illustration])];
}

/** Keeps the opening chapters and always the final one, like the offline stories do. */
function fitChapters(story: StoryOutline, wanted: number): StoryOutline {
  if (story.chapters.length <= wanted) return story;
  const last = story.chapters[story.chapters.length - 1];
  const chapters = [...story.chapters.slice(0, wanted - 1), ...(last ? [last] : [])];
  return { ...story, chapters };
}

/** A story outline for Story Quest. Never throws; uses a built-in story when the AI is unavailable or its story is unsuitable. */
export async function generateStoryOutline(req: StoryOutlineRequest): Promise<StoryOutline> {
  const wanted = clampChapters(req.chapters);
  const started = Date.now();
  let model = '';
  try {
    const loaded = await loadAiConfig();
    if (loaded.ok) model = loaded.config.chatModel;
    if (loaded.ok && !req.signal?.aborted && localSafetyCheck(req.theme, req.child.strictness).safe) {
      const story = await chatJson(asMessages(buildStoryPrompt(req)), StoryOutlineSchema, {
        signal: req.signal,
        config: loaded.config,
        maxTokens: 1800,
      });
      const texts = storyTexts(story);
      if (checkTexts(texts, req.child.strictness).safe && (await moderateTexts(texts, req.child.strictness)).safe) {
        return fitChapters(story, wanted);
      }
    }
  } catch (error) {
    // fall through to the built-in story; the parent can read why in the AI settings
    await noteAiFailure('story', model, error, started);
  }
  return pickOfflineStory(req.theme, wanted);
}

// ---------------------------------------------------------------------------
// Learner notes
// ---------------------------------------------------------------------------

/** Notes on how the child is doing. Returns null in demo mode, with nothing to summarize, or when the AI fails. Never throws. */
export async function generateLearnerNotes(req: LearnerNotesRequest): Promise<LearnerNotesOutput | null> {
  const started = Date.now();
  let model = '';
  try {
    if (req.attempts.length === 0) return null;
    const loaded = await loadAiConfig();
    if (!loaded.ok) return null;
    model = loaded.config.chatModel;
    const language = await parentLocale(req.child.locale);
    const notes = await chatJson(asMessages(buildNotesPrompt(req, language)), LearnerNotesSchema, {
      config: loaded.config,
      maxTokens: 700,
      temperature: Math.min(loaded.config.temperature, 0.4),
    });
    const texts = [notes.summary, ...notes.strengths, ...notes.struggles, ...notes.nextFocus];
    // Notes are for a parent, so the gentler tier-2 words (which a parent may well read) are not held against them.
    return checkTexts(texts, 'standard').safe ? notes : null;
  } catch (error) {
    await noteAiFailure('notes', model, error, started);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Weekly report
// ---------------------------------------------------------------------------

interface ReportWords {
  quiet: string;
  headline: (completed: number, minutes: number) => string;
  independent: (pct: number) => string;
  withHelp: (pct: number) => string;
  stageUps: (n: number) => string;
  levels: (list: string) => string;
  needsSupport: string;
  restart: string;
  strandNames: Record<Strand, string>;
  activities: Record<Strand, string>;
}

const REPORT_WORDS: Record<Locale, ReportWords> = {
  en: {
    quiet: 'A quiet week: no challenges were finished.',
    headline: (completed, minutes) => `${completed} challenge${completed === 1 ? '' : 's'} solved in ${minutes} minute${minutes === 1 ? '' : 's'} of play this week.`,
    independent: (pct) => `Solved ${pct}% of the challenges without any help. That is strong independent thinking.`,
    withHelp: (pct) => `Solved ${pct}% of the challenges without help, and used hints for the rest. Asking for help is a good learning habit.`,
    stageUps: (n) => `Moved up ${n} stage step${n === 1 ? '' : 's'} after passing concept checks.`,
    levels: (list) => `Current levels: ${list}.`,
    needsSupport: 'Many challenges needed a walkthrough or hints this week. That is normal with new material; shorter sessions and solving one together can help.',
    restart: 'Try one short session together to get going again: five minutes is enough.',
    strandNames: { math: 'Math', science: 'Science', technology: 'Technology', engineering: 'Engineering', logic: 'Logic' },
    activities: {
      math: 'Kitchen math: let your child count out and share snacks fairly between plates, then ask "how did you know?".',
      science: 'Sink or float: collect a few small household objects, predict which will float in a bowl of water, then test them together.',
      technology: 'Human robot: take turns giving each other exact step-by-step instructions to cross the room, like a program.',
      engineering: 'Paper bridge: with a few sheets of paper and two books, build a bridge together and see how many coins it can hold.',
      logic: 'Pattern hunt: make a pattern with spoons and forks, and let your child say what comes next and why.',
    },
  },
  es: {
    quiet: 'Una semana tranquila: no se terminó ningún reto.',
    headline: (completed, minutes) => `${completed} reto${completed === 1 ? '' : 's'} resuelto${completed === 1 ? '' : 's'} en ${minutes} minuto${minutes === 1 ? '' : 's'} de juego esta semana.`,
    independent: (pct) => `Resolvió el ${pct}% de los retos sin ayuda. Eso muestra un pensamiento muy independiente.`,
    withHelp: (pct) => `Resolvió el ${pct}% de los retos sin ayuda y usó pistas en el resto. Pedir ayuda es un buen hábito para aprender.`,
    stageUps: (n) => `Subió ${n} paso${n === 1 ? '' : 's'} de etapa después de superar las comprobaciones de concepto.`,
    levels: (list) => `Niveles actuales: ${list}.`,
    needsSupport: 'Esta semana muchos retos necesitaron pistas o la solución guiada. Es normal con temas nuevos; ayudan las sesiones más cortas y resolver uno juntos.',
    restart: 'Prueben una sesión corta juntos para retomar el ritmo: cinco minutos bastan.',
    strandNames: { math: 'Matemáticas', science: 'Ciencias', technology: 'Tecnología', engineering: 'Ingeniería', logic: 'Lógica' },
    activities: {
      math: 'Matemáticas en la cocina: pídale que reparta la merienda en partes iguales entre varios platos y pregúntele cómo lo supo.',
      science: '¿Flota o se hunde?: reúnan objetos pequeños de casa, predigan cuáles flotan en un recipiente con agua y compruébenlo juntos.',
      technology: 'Robot humano: túrnense para darse instrucciones exactas, paso a paso, para cruzar la habitación, como un programa.',
      engineering: 'Puente de papel: con unas hojas y dos libros, construyan un puente y vean cuántas monedas aguanta.',
      logic: 'Busca el patrón: hagan un patrón con cucharas y tenedores, y que diga qué sigue y por qué.',
    },
  },
  hi: {
    quiet: 'यह हफ़्ता शांत रहा: कोई चुनौती पूरी नहीं हुई।',
    headline: (completed, minutes) => `इस हफ़्ते ${minutes} मिनट के खेल में ${completed} चुनौतियाँ हल हुईं।`,
    independent: (pct) => `${pct}% चुनौतियाँ बिना किसी मदद के हल कीं। यह अपने आप सोचने की अच्छी क्षमता दिखाता है।`,
    withHelp: (pct) => `${pct}% चुनौतियाँ बिना मदद के हल कीं और बाकी में संकेत लिए। मदद माँगना सीखने की अच्छी आदत है।`,
    stageUps: (n) => `अवधारणा जाँच पास करके ${n} चरण ऊपर बढ़े।`,
    levels: (list) => `अभी के स्तर: ${list}.`,
    needsSupport: 'इस हफ़्ते कई चुनौतियों में संकेत या पूरा हल देखना पड़ा। नई चीज़ें सीखते समय यह सामान्य है; छोटे सत्र और एक चुनौती साथ में हल करना मदद करता है।',
    restart: 'फिर से शुरू करने के लिए साथ बैठकर एक छोटा सत्र आज़माएँ: पाँच मिनट काफ़ी हैं।',
    strandNames: { math: 'गणित', science: 'विज्ञान', technology: 'तकनीक', engineering: 'इंजीनियरिंग', logic: 'तर्क' },
    activities: {
      math: 'रसोई का गणित: बच्चे से नाश्ता प्लेटों में बराबर बाँटने को कहें, फिर पूछें कि उसे कैसे पता चला।',
      science: 'तैरेगा या डूबेगा: घर की कुछ छोटी चीज़ें इकट्ठा करें, अंदाज़ा लगाएँ कि पानी के कटोरे में कौन सी तैरेगी, फिर साथ में जाँचें।',
      technology: 'इंसानी रोबोट: बारी-बारी से एक-दूसरे को कमरा पार करने के लिए एक-एक कदम के सटीक निर्देश दें, जैसे कोई प्रोग्राम।',
      engineering: 'कागज़ का पुल: कुछ कागज़ों और दो किताबों से साथ मिलकर पुल बनाएँ और देखें कि वह कितने सिक्के सँभाल सकता है।',
      logic: 'पैटर्न की खोज: चम्मचों और काँटों से एक पैटर्न बनाएँ और बच्चे से पूछें कि आगे क्या आएगा और क्यों।',
    },
  },
};

const ACTIVITY_ORDER: Strand[] = ['math', 'science', 'logic', 'engineering', 'technology'];

/** The weekly report built from the numbers alone. Pure. */
export function templateWeeklyReport(req: WeeklyReportRequest, language: Locale = req.child.locale): WeeklyReportOutput {
  const words = REPORT_WORDS[language] ?? REPORT_WORDS.en;
  const completed = Math.max(0, Math.round(req.stats.completed));
  const minutes = Math.max(0, Math.round(req.stats.minutes));
  const stageUps = Math.max(0, Math.round(req.stats.stageUps));
  const pct = percent(req.stats.independentShare);

  const highlights: string[] = [];
  const struggles: string[] = [];
  if (completed > 0) highlights.push(pct >= 60 ? words.independent(pct) : words.withHelp(pct));
  if (stageUps > 0) highlights.push(words.stageUps(stageUps));
  if (req.strandStages.length > 0) {
    const list = req.strandStages.map((entry) => `${words.strandNames[entry.strand] ?? entry.strand}: ${entry.label}`).join('; ');
    highlights.push(words.levels(list).slice(0, 240));
  }
  if (highlights.length === 0) highlights.push(words.restart);
  if (completed >= 5 && pct < 40) struggles.push(words.needsSupport);

  const practised = new Set(req.strandStages.map((entry) => entry.strand));
  const preferred = ACTIVITY_ORDER.filter((strand) => practised.has(strand));
  const strands = [...preferred, ...ACTIVITY_ORDER.filter((strand) => !practised.has(strand))].slice(0, 3);

  return WeeklyReportSchema.parse({
    headline: completed === 0 ? words.quiet : words.headline(completed, minutes),
    highlights: highlights.slice(0, 5),
    struggles,
    homeActivities: strands.map((strand) => words.activities[strand]),
  });
}

/** The weekly report for a parent. Never throws; uses the template when the AI is unavailable. */
export async function generateWeeklyReport(req: WeeklyReportRequest): Promise<WeeklyReportOutput> {
  const language = await parentLocale(req.child.locale);
  const started = Date.now();
  let model = '';
  try {
    const loaded = await loadAiConfig();
    if (loaded.ok) {
      model = loaded.config.chatModel;
      const report = await chatJson(asMessages(buildReportPrompt(req, language)), WeeklyReportSchema, {
        config: loaded.config,
        maxTokens: 900,
        temperature: Math.min(loaded.config.temperature, 0.6),
      });
      const texts = [report.headline, ...report.highlights, ...report.struggles, ...report.homeActivities];
      if (checkTexts(texts, 'standard').safe) return report;
    }
  } catch (error) {
    // fall through to the template
    await noteAiFailure('report', model, error, started);
  }
  try {
    return templateWeeklyReport(req, language);
  } catch {
    // Only reachable with malformed input; a report must still come back.
    const words = REPORT_WORDS[language] ?? REPORT_WORDS.en;
    return { headline: words.quiet, highlights: [words.restart], struggles: [], homeActivities: [words.activities.math] };
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Sizes to try, smallest first. Remembered per endpoint and model once one works. */
const IMAGE_SIZES = ['512x512', '1024x1024'] as const;
const imageQuirks = new Map<string, { sizeIndex: number; noResponseFormat: boolean }>();
const IMAGE_TIMEOUT_MS = 60_000;

/** Forgets what was learned about image endpoints (tests, and after the AI settings change). */
export function resetImageSession(): void {
  imageQuirks.clear();
}

function mimeOf(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  return 'image/png';
}

/**
 * A story illustration as a data URL, or null when images are unavailable:
 * no image model, demo mode, the parent switched AI images off, the budget is
 * spent, the description is unsuitable, or the request fails. Never throws.
 *
 * Only inline image data is accepted. A reply that points at a remote image
 * is ignored, because the app never loads anything from a third address.
 */
export async function generateImage(prompt: string, signal?: AbortSignal): Promise<string | null> {
  try {
    if (signal?.aborted || typeof prompt !== 'string' || prompt.trim() === '') return null;
    const settings = await getSettings();
    if (!settings.controls.aiImages) return null;
    const loaded = await loadAiConfig();
    if (!loaded.ok || loaded.config.imageModel === '') return null;
    if (!localSafetyCheck(prompt, settings.controls.strictness).safe) return null;

    const { config } = loaded;
    const key = `${config.baseUrl}|${config.imageModel}`;
    const state = { ...(imageQuirks.get(key) ?? { sizeIndex: 0, noResponseFormat: false }) };
    const raw = await postJson(config, '/images/generations', {
      count: 'imageRequests',
      signal,
      timeoutMs: IMAGE_TIMEOUT_MS,
      body: () => ({
        model: config.imageModel,
        prompt: buildImagePrompt(prompt),
        n: 1,
        size: IMAGE_SIZES[state.sizeIndex] ?? IMAGE_SIZES[0],
        ...(state.noResponseFormat ? {} : { response_format: 'b64_json' }),
      }),
      adapt: (status, text) => {
        if (status !== 400 && status !== 422) return false;
        const lower = text.toLowerCase();
        if (!state.noResponseFormat && lower.includes('response_format')) {
          state.noResponseFormat = true;
          return true;
        }
        if (state.sizeIndex < IMAGE_SIZES.length - 1 && lower.includes('size')) {
          state.sizeIndex += 1;
          return true;
        }
        return false;
      },
    });
    imageQuirks.set(key, state);

    const first = (raw as { data?: { b64_json?: unknown }[] } | null)?.data?.[0];
    const base64 = typeof first?.b64_json === 'string' ? first.b64_json.replace(/\s+/g, '') : '';
    if (base64 === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
    return `data:${mimeOf(base64)};base64,${base64}`;
  } catch {
    return null;
  }
}
