/**
 * Finds the JSON object in a model reply. Models wrap JSON in code fences,
 * add a sentence before or after it, or think out loud first; none of that
 * should cost a retry.
 *
 * What is returned is always a whole top-level object of the reply, never a
 * piece from inside an object that could not be read: when the answer itself
 * is broken (cut off, an unescaped quote, a comment that cannot be removed),
 * the caller must hear "this was not valid JSON", not a list of fields that
 * are "missing" from a fragment.
 */

/** Removes "thinking" blocks some local models put in front of the answer. */
function stripThinking(text: string): string {
  const withoutBlocks = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, ' ');
  // Some servers swallow the opening tag: everything up to a stray closing tag is thinking too.
  const stray = /<\/think(?:ing)?>/gi;
  let cut = -1;
  for (let match = stray.exec(withoutBlocks); match; match = stray.exec(withoutBlocks)) cut = match.index + match[0].length;
  return cut < 0 ? withoutBlocks : withoutBlocks.slice(cut);
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

/** The text without `// line` and `/* block *\/` comments. Comment marks inside strings are left alone. */
function stripComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end - 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += ch;
  }
  return out;
}

const withoutTrailingCommas = (text: string): string => text.replace(/,(\s*[}\]])/g, '$1');

function tryParse(candidate: string): Record<string, unknown> | undefined {
  // Each form is only built when the one before it failed.
  const forms: (() => string)[] = [
    () => candidate,
    () => withoutTrailingCommas(candidate),
    () => withoutTrailingCommas(stripComments(candidate)),
  ];
  for (const form of forms) {
    try {
      const value: unknown = JSON.parse(form());
      if (isPlainObject(value)) return value;
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/** True when the text from `start` opens like a JSON object (`{"` or `{}`), as opposed to braces in prose. */
function looksLikeJson(text: string, start: number): boolean {
  return /^\{\s*(?:"|\}|\/[/*])/.test(text.slice(start, start + 200));
}

function clean(text: string): string {
  return stripThinking(text.replace(/^﻿/, ''));
}

/**
 * The JSON object of the reply, parsed: the whole reply from its first `{` to its last `}`
 * when that is one object, else the largest complete top-level object in the text. Trailing
 * commas and comments are forgiven. Returns undefined when there is none, and also when the
 * only readable objects are smaller than an object that is broken or cut off (they are
 * pieces of it, or asides in front of it).
 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  if (typeof text !== 'string') return undefined;
  const cleaned = clean(text);
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0) return undefined;
  if (last > first) {
    const whole = tryParse(cleaned.slice(first, last + 1));
    if (whole) return whole;
  }

  let best: { value: Record<string, unknown>; length: number } | undefined;
  let brokenLength = 0;
  let from = first;
  for (let guard = 0; guard < 200; guard += 1) {
    const start = cleaned.indexOf('{', from);
    if (start < 0) break;
    const end = balancedEnd(cleaned, start);
    const jsonLike = looksLikeJson(cleaned, start);
    if (end < 0) {
      if (jsonLike) {
        // An object that never closes: the reply was cut off. What is inside it is not the answer.
        brokenLength = Math.max(brokenLength, cleaned.length - start);
        break;
      }
      from = start + 1;
      continue;
    }
    const parsed = tryParse(cleaned.slice(start, end + 1));
    if (parsed) {
      if (!best || end + 1 - start > best.length) best = { value: parsed, length: end + 1 - start };
      from = end + 1;
    } else if (jsonLike) {
      // Meant as JSON but unreadable: do not dig a fragment out of it.
      brokenLength = Math.max(brokenLength, end + 1 - start);
      from = end + 1;
    } else {
      from = start + 1; // braces in prose
    }
  }
  return best && best.length > brokenLength ? best.value : undefined;
}

/**
 * For a reply that has a `{` in it but no readable JSON object: one line a model can act on,
 * saying what is wrong and, where the parser tells, where. '' when the reply has no `{`.
 */
export function describeJsonFailure(text: string): string {
  if (typeof text !== 'string') return '';
  const cleaned = clean(text);
  const first = cleaned.indexOf('{');
  if (first < 0) return '';
  const advice = 'Escape every double quote inside a string as \\", write no comments, and close every bracket.';
  if (balancedEnd(cleaned, first) < 0 && looksLikeJson(cleaned, first)) {
    return `Your reply was not valid JSON: the object is not complete, it stops before its closing brackets. Reply with the whole JSON object again, and keep it compact. ${advice}`;
  }
  const last = cleaned.lastIndexOf('}');
  const span = last > first ? cleaned.slice(first, last + 1) : cleaned.slice(first);
  let where = '';
  try {
    JSON.parse(span);
  } catch (error) {
    const position = /position (\d+)/.exec(error instanceof Error ? error.message : '')?.[1];
    if (position !== undefined) {
      const at = Number(position);
      const near = span.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, ' ').trim();
      if (near !== '') where = ` near: ${near}`;
    }
  }
  return `Your reply was not valid JSON${where}. ${advice} Reply with exactly one valid JSON object and nothing else.`;
}
