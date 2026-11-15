/**
 * Finds the JSON object in a model reply. Models wrap JSON in code fences,
 * add a sentence before or after it, or think out loud first; none of that
 * should cost a retry.
 */

/** Removes "thinking" blocks some local models put in front of the answer. */
function stripThinking(text: string): string {
  return text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, ' ');
}

/** End index (inclusive) of the balanced object that opens at `start`, or -1. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParse(candidate: string): Record<string, unknown> | undefined {
  const attempts = [candidate, candidate.replace(/,(\s*[}\]])/g, '$1')]; // second: without trailing commas
  for (const attempt of attempts) {
    try {
      const value: unknown = JSON.parse(attempt);
      if (isPlainObject(value)) return value;
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/**
 * The first balanced top-level JSON object in the text, parsed. Returns
 * undefined when there is none.
 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  if (typeof text !== 'string') return undefined;
  const cleaned = stripThinking(text.replace(/^﻿/, ''));
  let from = 0;
  for (let guard = 0; guard < 50; guard += 1) {
    const start = cleaned.indexOf('{', from);
    if (start < 0) return undefined;
    const end = balancedEnd(cleaned, start);
    if (end < 0) {
      from = start + 1;
      continue;
    }
    const parsed = tryParse(cleaned.slice(start, end + 1));
    if (parsed) return parsed;
    from = start + 1;
  }
  return undefined;
}
