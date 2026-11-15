/**
 * The helper bot's replies.
 *
 * Without AI (demo mode, no budget, an outage) every reply is built from the
 * challenge's own hints, walkthrough, explanation and misconception texts,
 * with a few friendly phrasings. With AI the model words the reply, but the
 * app still decides what help the child gets: a reply that is unsafe, or that
 * gives the answer away where it must not, is replaced by the offline reply.
 */
import { TutorReplySchema, type TutorReply } from '@/core/schemas';
import type { Locale } from '@/core/types';
import { chatJson } from './client';
import { loadAiConfig } from './config';
import { noteAiFailure } from './diagnostics';
import { revealsAnswer } from './leak';
import { buildTutorPrompt, walkthroughIndex } from './prompts';
import { foldText, localSafetyCheck, moderateTexts } from './safety';
import type { TutorIntent, TutorRequest } from './types';

interface Phrases {
  nudge: string[];
  hint: string[];
  step: (n: number) => string;
  lastStep: string[];
  wrong: string[];
  retry: string[];
  praise: string[];
  teachRight: string[];
  teachWrong: string[];
  teachThanks: string[];
  redirect: string[];
  /** A strategy prompt that carries no information about the answer. */
  think: string[];
  /** Said when the child asks for the answer itself. */
  noAnswer: string[];
}

/** Friendly phrasings. None of them contains a number, so none can give a number answer away. */
export const TUTOR_PHRASES: Record<Locale, Phrases> = {
  en: {
    nudge: ['Here is a little clue.', 'Let us look closer together.', 'Try this thought.'],
    hint: ['Here is a bigger clue.', 'Okay, another clue coming up.', 'This might help.'],
    step: (n) => `Step ${n}.`,
    lastStep: ['Now the last move is yours!', 'You finish it from here!'],
    wrong: ['Not quite yet, and that is okay.', 'Good try! Mistakes help our brains grow.', 'Nice thinking. Let us look again.'],
    retry: ['Have another go!', 'Take your time and try again.', 'Look again and give it another try.'],
    praise: ['You kept thinking, and you got it!', 'Great strategy! You worked it out.', 'You did not give up, and it worked!'],
    teachRight: ['Thank you for teaching me! You explained it so clearly.', 'Now I get it. You are a great teacher because you explained your thinking!'],
    teachWrong: ['Thank you for teaching me! Here is how I think about it.', 'Thanks for explaining. Let me share another way to see it.'],
    teachThanks: ['Thank you for teaching me!', 'I love learning from you!'],
    redirect: ['That is a fun thought! Let us finish our puzzle first.', 'Good question for later! Right now our puzzle needs us.'],
    think: ['Let us look at the picture together. What do you notice?', 'Listen to the question again. What do we need to find out?'],
    noAnswer: ['I will not spoil the fun, but I can help you find it yourself.', 'You can find it, and I will help you think.'],
  },
  es: {
    nudge: ['Aquí va una pista pequeña.', 'Miremos más de cerca.', 'Prueba con esta idea.'],
    hint: ['Aquí va una pista más grande.', 'Bien, ahí va otra pista.', 'Esto te puede ayudar.'],
    step: (n) => `Paso ${n}.`,
    lastStep: ['¡Ahora el último movimiento es tuyo!', '¡Tú lo terminas desde aquí!'],
    wrong: ['Todavía no, y no pasa nada.', '¡Buen intento! Los errores ayudan a crecer al cerebro.', 'Buena idea. Miremos otra vez.'],
    retry: ['¡Inténtalo otra vez!', 'Tómate tu tiempo y prueba de nuevo.', 'Mira otra vez y haz otro intento.'],
    praise: ['¡Seguiste pensando y lo lograste!', '¡Gran estrategia! Lo resolviste.', '¡No te rendiste y funcionó!'],
    teachRight: ['¡Gracias por enseñarme! Lo explicaste muy claro.', 'Ahora lo entiendo. ¡Enseñas muy bien porque explicas lo que piensas!'],
    teachWrong: ['¡Gracias por enseñarme! Yo lo pienso así.', 'Gracias por explicarlo. Te cuento otra forma de verlo.'],
    teachThanks: ['¡Gracias por enseñarme!', '¡Me encanta aprender contigo!'],
    redirect: ['¡Qué idea tan divertida! Primero terminemos nuestro reto.', '¡Buena pregunta para después! Ahora nuestro reto nos necesita.'],
    think: ['Miremos el dibujo con calma. ¿Qué notas?', 'Escucha la pregunta otra vez. ¿Qué tenemos que averiguar?'],
    noAnswer: ['No quiero quitarte la diversión, pero te ayudo a encontrarla.', 'Tú puedes encontrarla, y yo te ayudo a pensar.'],
  },
  hi: {
    nudge: ['यह लो एक छोटा सा इशारा।', 'चलो, ध्यान से देखते हैं।', 'ज़रा ऐसे सोचकर देखो।'],
    hint: ['यह लो एक बड़ा इशारा।', 'ठीक है, एक और इशारा।', 'इससे मदद मिल सकती है।'],
    step: (n) => `कदम ${n}.`,
    lastStep: ['अब आख़िरी काम तुम्हारा है!', 'यहाँ से तुम पूरा करो!'],
    wrong: ['अभी नहीं हुआ, और यह बिल्कुल ठीक है।', 'अच्छी कोशिश! गलतियों से दिमाग मज़बूत होता है।', 'अच्छी सोच। चलो फिर से देखते हैं।'],
    retry: ['फिर से कोशिश करो!', 'आराम से सोचो और फिर कोशिश करो।', 'ध्यान से देखो और फिर कोशिश करो।'],
    praise: ['तुम सोचते रहे और तुमने कर दिखाया!', 'बढ़िया तरीका! तुमने हल निकाल लिया।', 'तुमने हार नहीं मानी और काम बन गया!'],
    teachRight: ['मुझे सिखाने के लिए धन्यवाद! तुमने बहुत अच्छे से समझाया।', 'अब मुझे समझ आ गया। तुमने अपनी सोच बहुत अच्छे से बताई!'],
    teachWrong: ['मुझे सिखाने के लिए धन्यवाद! मैं इसे ऐसे समझता हूँ।', 'समझाने के लिए धन्यवाद। मैं इसे देखने का दूसरा तरीका बताता हूँ।'],
    teachThanks: ['मुझे सिखाने के लिए धन्यवाद!', 'मुझे तुमसे सीखना बहुत अच्छा लगता है!'],
    redirect: ['वाह, मज़ेदार बात! पहले अपनी पहेली पूरी कर लें।', 'यह सवाल बाद के लिए अच्छा है! अभी हमारी पहेली हमारा इंतज़ार कर रही है।'],
    think: ['चलो, तस्वीर को ध्यान से देखते हैं। तुम्हें क्या दिख रहा है?', 'सवाल फिर से सुनो। हमें क्या पता करना है?'],
    noAnswer: ['मैं मज़ा खराब नहीं करूँगा, पर उसे ढूँढने में मदद करूँगा।', 'तुम खुद ढूँढ सकते हो, और मैं सोचने में मदद करूँगा।'],
  },
};

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Words that mean "I need help" or "I am asking about this task", per language (folded text). */
const HELP_WORDS = [
  'help', 'hint', 'clue', 'stuck', 'confused', 'understand', 'explain', 'hard', 'difficult', 'how', 'why', 'what do i', 'what should',
  'answer', 'again', 'repeat', "don't know", 'dont know', 'do not know', "can't", 'cant',
  'ayuda', 'pista', 'no se', 'no entiendo', 'explica', 'dificil', 'como', 'por que', 'respuesta', 'otra vez', 'repite',
  'मदद', 'इशारा', 'संकेत', 'नहीं पता', 'समझ', 'कैसे', 'क्यों', 'मुश्किल', 'कठिन', 'जवाब', 'उत्तर', 'फिर से', 'दोबारा',
];
const ANSWER_WORDS = ['answer', 'respuesta', 'solucion', 'जवाब', 'उत्तर'];

const STOP_WORDS = new Set([
  'the', 'and', 'are', 'you', 'can', 'what', 'this', 'that', 'with', 'have', 'how', 'many', 'much', 'for', 'which', 'does', 'your',
  'los', 'las', 'una', 'que', 'con', 'por', 'para', 'como', 'cual', 'hay', 'del',
]);

function contentWords(text: string): Set<string> {
  const words = foldText(text).match(/[\p{L}\p{M}]{3,}/gu) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

/** True when what the child said shares a meaningful word with the challenge. */
function aboutChallenge(said: string, req: TutorRequest): boolean {
  const mine = contentWords(said);
  if (mine.size === 0) return false;
  const theirs = contentWords(`${req.challenge.title} ${req.challenge.intro} ${req.challenge.question}`);
  for (const word of mine) if (theirs.has(word)) return true;
  return false;
}

function reply(say: string, redirected = false): TutorReply {
  return { say: say.replace(/\s+/g, ' ').trim().slice(0, 500), highlightIds: [], redirected };
}

/** Intents where stating the answer would break the help ladder. */
const NO_ANSWER_INTENTS = new Set<TutorIntent>(['nudge', 'hint', 'wrong-answer', 'chat']);

/**
 * The reply without AI. Deterministic for a given request, so the same
 * moment always sounds the same, while different moments vary.
 */
export function offlineTutorReply(req: TutorRequest): TutorReply {
  const c = req.challenge;
  const locale = req.child.locale;
  const phrases = TUTOR_PHRASES[locale] ?? TUTOR_PHRASES.en;
  const seed = hashText(`${c.title}|${req.intent}|${req.hintLevel}|${req.walkthroughStep ?? ''}|${req.history?.length ?? 0}`);
  const pick = (options: string[], salt = 0): string => options[(seed + salt) % options.length] ?? options[0] ?? '';
  const leaks = (text: string): boolean => revealsAnswer(c, text, locale);
  const usable = (text: string): boolean => !leaks(text) && localSafetyCheck(text, req.child.strictness).safe;
  const think = pick(phrases.think);

  const nudge = (): string => (usable(c.hints[0]) ? `${pick(phrases.nudge)} ${c.hints[0]}` : think);
  const hint = (): string => {
    if (usable(c.hints[1])) return `${pick(phrases.hint)} ${c.hints[1]}`;
    return nudge();
  };
  /** Help the child already received, repeated; nothing new, so chatting never skips the help ladder. */
  const helpSoFar = (): string => {
    if (req.hintLevel >= 2) return hint();
    if (req.hintLevel === 1) return nudge();
    return think;
  };

  let out: TutorReply;
  switch (req.intent) {
    case 'nudge':
      out = reply(nudge());
      break;
    case 'hint':
      out = reply(hint());
      break;
    case 'walkthrough-step': {
      const index = walkthroughIndex(c, req.walkthroughStep);
      const isLast = index === c.walkthrough.length - 1;
      const text = c.walkthrough[index] ?? think;
      out = reply(`${phrases.step(index + 1)} ${text}${isLast ? ` ${pick(phrases.lastStep)}` : ''}`);
      break;
    }
    case 'wrong-answer': {
      const misconception = req.misconception?.trim() ?? '';
      out = reply(misconception !== '' && usable(misconception) ? `${pick(phrases.wrong)} ${misconception}` : `${pick(phrases.wrong)} ${pick(phrases.retry, 1)}`);
      break;
    }
    case 'praise':
      out = reply(`${pick(phrases.praise)} ${c.explanation}`);
      break;
    case 'teachback-feedback': {
      const said = foldText(req.childText ?? '').trim();
      const options = c.teachBack?.options ?? [];
      const picked = said === '' ? undefined : options.find((option) => foldText(option.id) === said || foldText(option.label).trim() === said);
      const right = options.find((option) => option.correct);
      const knownWrong = picked ? !picked.correct : said === '' && (req.misconception?.trim() ?? '') !== '';
      if (picked?.correct) out = reply(pick(phrases.teachRight));
      else if (knownWrong && right) out = reply(`${pick(phrases.teachWrong)} ${right.label}`);
      else out = reply(`${pick(phrases.teachThanks)} ${c.explanation}`);
      break;
    }
    case 'chat': {
      const said = (req.childText ?? '').trim();
      const folded = foldText(said);
      if (said === '') out = reply(helpSoFar());
      else if (!localSafetyCheck(said, req.child.strictness).safe) out = reply(pick(phrases.redirect), true);
      else if (ANSWER_WORDS.some((word) => folded.includes(word))) out = reply(`${pick(phrases.noAnswer)} ${helpSoFar()}`);
      else if (HELP_WORDS.some((word) => folded.includes(word)) || aboutChallenge(said, req)) out = reply(helpSoFar());
      else out = reply(pick(phrases.redirect), true);
      break;
    }
  }

  // Last line of defence: nothing unsafe, and no answer where the ladder forbids it.
  const blocked =
    !localSafetyCheck(out.say, req.child.strictness).safe || (NO_ANSWER_INTENTS.has(req.intent) && leaks(out.say));
  return blocked ? reply(think, out.redirected) : out;
}

/** At most `max` sentences of the text. */
export function limitSentences(text: string, max: number): string {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?।…])\s+/u);
  return sentences.slice(0, max).join(' ');
}

const TUTOR_MAX_TOKENS = 260;
const TUTOR_TIMEOUT_MS = 15_000;
const MAX_HIGHLIGHTS = 3;

/** Applies the app's rules to a model reply. Returns null when the reply must not be used. */
export function checkTutorReply(req: TutorRequest, raw: TutorReply): TutorReply | null {
  const say = limitSentences(raw.say, 3).slice(0, 500).trim();
  if (say === '') return null;
  if (!localSafetyCheck(say, req.child.strictness).safe) return null;
  if (NO_ANSWER_INTENTS.has(req.intent) && revealsAnswer(req.challenge, say, req.child.locale)) return null;

  const sceneIds = new Set(req.challenge.scene.objects.map((object) => object.id));
  const interaction = req.challenge.interaction;
  const solved = req.intent === 'praise' || req.intent === 'teachback-feedback';
  // Glowing tap targets would point straight at the answer.
  const secret = new Set(interaction.kind === 'tap' && !solved ? interaction.targetIds : []);
  const highlightIds = [...new Set(raw.highlightIds)].filter((id) => sceneIds.has(id) && !secret.has(id)).slice(0, MAX_HIGHLIGHTS);

  return { say, highlightIds, redirected: req.intent === 'chat' && raw.redirected === true };
}

/**
 * What the helper says. Never throws. Praise is always instant and offline;
 * the other intents use the AI when it is available.
 */
export async function tutorReply(req: TutorRequest): Promise<TutorReply> {
  const fallback = offlineTutorReply(req);
  const started = Date.now();
  let model = '';
  try {
    if (req.signal?.aborted || req.intent === 'praise') return fallback;
    if (req.intent === 'chat') {
      const said = req.childText?.trim() ?? '';
      // Nothing to answer, or something that must not leave the device: the offline reply handles both.
      if (said === '' || !localSafetyCheck(said, req.child.strictness).safe) return fallback;
    }
    const loaded = await loadAiConfig();
    if (!loaded.ok) return fallback;
    model = loaded.config.chatModel;

    const history = (req.history ?? []).filter(
      (turn) => turn.role === 'bot' || localSafetyCheck(turn.text, req.child.strictness).safe,
    );
    const prompt = buildTutorPrompt({ ...req, history });
    const raw = await chatJson(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      TutorReplySchema,
      {
        signal: req.signal,
        config: loaded.config,
        maxTokens: TUTOR_MAX_TOKENS,
        timeoutMs: TUTOR_TIMEOUT_MS,
        // A slow endpoint gets twice as long, not more: the child is waiting, and the reply
        // from the challenge's own hints is ready at once.
        maxTimeoutScale: 2,
        attempts: 2,
        transportRetries: 0,
      },
    );
    const checked = checkTutorReply(req, raw);
    if (!checked) return fallback;
    // Open chat is the one place where the child's own words steer the model: its reply gets
    // the moderation service's opinion as well (when the endpoint has one) before it is shown.
    if (req.intent === 'chat' && !(await moderateTexts([checked.say], req.child.strictness)).safe) return fallback;
    return checked;
  } catch (error) {
    await noteAiFailure('tutor', model, error, started);
    return fallback;
  }
}
