/**
 * Challenge generation: ask the model, then trust nothing.
 *
 * Every AI challenge goes through a forgiving pre-pass for harmless slips
 * (`relaxChallengeJson`), the zod schema, `normalizeChallenge`, the engine's
 * semantic validators, a check that it is the interaction kind that was asked
 * for, and the safety checks. One round of feedback is allowed; after that
 * the offline bank takes over, so a child never waits on a broken model and
 * never sees unchecked content.
 */
import { ChallengeSchema, type Challenge } from '@/core/schemas';
import type { ChallengeSource, InteractionKind, Locale } from '@/core/types';
import { checkBudget } from '@/data';
import { normalizeChallenge, validateChallengeContent } from '@/engine';
import { pickOfflineChallenge } from '@/offline';
import { chatJson, repairMessage, type ChatMessage } from './client';
import { loadAiConfig, type AiConfig } from './config';
import { buildChallengePrompt, buildRemixPrompt, type Prompt } from './prompts';
import { checkChallengeSafety, localSafetyCheck } from './safety';
import { revealsAnswer } from './leak';
import { relaxChallengeJson } from './relax';
import type { GenerateChallengeRequest, RemixChallengeRequest } from './types';

/** Room for a full challenge with a rich scene and one small svg. */
const CHALLENGE_MAX_TOKENS = 3000;

/** Problems that make a challenge unusable: wrong kind, or anything the engine's validators report. */
export function hardProblems(content: Challenge, kind: InteractionKind): string[] {
  const problems: string[] = [];
  if (content.interaction.kind !== kind) {
    problems.push(`interaction.kind must be "${kind}", but it is "${content.interaction.kind}"`);
  }
  problems.push(...validateChallengeContent(content));
  return problems;
}

/** Quality problems worth one round of feedback, but not worth throwing a good challenge away for. */
export function softProblems(content: Challenge, locale?: Locale): string[] {
  const problems: string[] = [];
  content.hints.forEach((hint, index) => {
    if (revealsAnswer(content, hint, locale)) problems.push(`hint ${index + 1} gives the answer away; hints must guide without stating the answer`);
  });
  return problems;
}

/** The usable AI configuration, or null in demo mode, with incomplete settings or with the budget spent. */
async function availableConfig(): Promise<AiConfig | null> {
  const loaded = await loadAiConfig();
  if (!loaded.ok) return null;
  const budget = await checkBudget();
  return budget.allowed ? loaded.config : null;
}

/**
 * Runs the generate, validate, give-feedback-once loop. Returns a checked
 * challenge, or null when the model could not produce one. Throws `AiError`
 * for transport problems (the callers turn that into their fallback).
 */
async function produceChallenge(
  prompt: Prompt,
  kind: InteractionKind,
  child: { strictness: 'strict' | 'standard'; locale: Locale },
  config: AiConfig,
  signal: AbortSignal | undefined,
): Promise<Challenge | null> {
  const base: ChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
  let messages = base;
  for (let round = 0; round < 2; round += 1) {
    const parsed = await chatJson(messages, ChallengeSchema, {
      signal,
      config,
      maxTokens: CHALLENGE_MAX_TOKENS,
      prepare: relaxChallengeJson,
      attempts: round === 0 ? 3 : 2,
    });
    const content = normalizeChallenge(parsed);
    const hard = hardProblems(content, kind);
    if (hard.length === 0) {
      const verdict = await checkChallengeSafety(content, child.strictness);
      if (!verdict.safe) {
        // Do not echo unsuitable content back: ask for a different challenge.
        messages = [
          ...base,
          {
            role: 'user',
            content: `Your previous challenge was rejected because it is not suitable for a child (${verdict.reason}). Create a different, gentle challenge that follows every safety rule, and return the full JSON only.`,
          },
        ];
        continue;
      }
      const soft = softProblems(content, child.locale);
      // After the feedback round a small flaw no longer blocks a challenge that is correct and safe.
      if (soft.length === 0 || round > 0) return content;
      messages = [...base, { role: 'assistant', content: JSON.stringify(parsed) }, { role: 'user', content: repairMessage(soft) }];
      continue;
    }
    messages = [...base, { role: 'assistant', content: JSON.stringify(parsed) }, { role: 'user', content: repairMessage(hard) }];
  }
  return null;
}

function offline(req: GenerateChallengeRequest): { content: Challenge; source: ChallengeSource } {
  return { content: pickOfflineChallenge(req.plan, { avoidTitles: req.avoidTitles }), source: 'offline' };
}

/**
 * A challenge for the plan. Never throws. Falls back to the offline bank when
 * the provider is 'demo', the settings are incomplete, the budget is spent,
 * the request is aborted, or the model cannot produce a valid, safe challenge.
 */
export async function generateChallenge(req: GenerateChallengeRequest): Promise<{ content: Challenge; source: ChallengeSource }> {
  try {
    if (req.signal?.aborted) return offline(req);
    const config = await availableConfig();
    if (!config) return offline(req);

    // A child's idea is only passed on when it is a harmless thing to draw.
    const idea = req.studioIdea?.trim() ?? '';
    const safeIdea = idea !== '' && localSafetyCheck(idea, req.child.strictness).safe ? idea : undefined;
    const prompt = buildChallengePrompt({ ...req, studioIdea: safeIdea });

    const content = await produceChallenge(prompt, req.plan.interaction, req.child, config, req.signal);
    if (content) return { content, source: 'ai' };
  } catch {
    // Any failure (network, budget, abort, bad output) ends in the offline bank.
  }
  return offline(req);
}

/** True when the remix is a new challenge and not a copy of the original. */
function isDifferent(a: Challenge, b: Challenge): boolean {
  const same = (x: string, y: string): boolean => x.trim().toLowerCase() === y.trim().toLowerCase();
  return !same(a.title, b.title) && !same(a.question, b.question);
}

/**
 * Re-themes a library item: same concept, grade and interaction kind, new
 * theme, numbers, details and scene. Returns null when the AI is unavailable
 * or the result fails validation or safety. Never throws.
 */
export async function remixChallenge(req: RemixChallengeRequest): Promise<Challenge | null> {
  try {
    if (req.signal?.aborted) return null;
    const config = await availableConfig();
    if (!config) return null;
    const prompt = buildRemixPrompt(req);
    const content = await produceChallenge(prompt, req.original.interaction.kind, req.child, config, req.signal);
    return content && isDifferent(content, req.original) ? content : null;
  } catch {
    return null;
  }
}
