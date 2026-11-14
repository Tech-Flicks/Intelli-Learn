/** Pure text helpers for speech: cleaning what is spoken and cutting it into short chunks. */

/**
 * Chrome stops an utterance after roughly 15 seconds. At a child's speaking rate
 * that is a little over 200 characters, so chunks stay well below it.
 */
export const MAX_CHUNK_CHARS = 180;

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu;
/** Variation selectors, zero-width joiner and the keycap mark that are left behind by emoji sequences. */
const EMOJI_GLUE = /[︎️‍⃣]/g;

/**
 * Makes text safe to hand to a speech engine: no emoji (engines read their
 * names aloud), no markdown symbols, no URLs' brackets, tidy whitespace.
 */
export function cleanForSpeech(text: string): string {
  return (
    text
      // [label](url) and ![alt](url) -> label
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // code fences and inline code markers
      .replace(/```+/g, ' ')
      .replace(/`/g, '')
      // "3 * 4" is multiplication, not emphasis
      .replace(/(\d)\s*\*\s*(?=\d)/g, '$1 × ')
      // headings, quotes and list bullets at the start of a line
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>+[ \t]?/gm, '')
      .replace(/^[ \t]*[-*+•][ \t]+/gm, '')
      // emphasis and strike-through markers
      .replace(/\*+/g, '')
      .replace(/~~+/g, '')
      .replace(/(^|[\s(])_+(?=\S)/g, '$1')
      .replace(/(\S)_+(?=$|[\s).,!?;:])/g, '$1')
      // table pipes and stray markup characters
      .replace(/[|#]/g, ' ')
      .replace(EMOJI, ' ')
      .replace(EMOJI_GLUE, '')
      // a line break is a pause
      .replace(/[ \t]*\n+[ \t]*/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([.,!?;:।])/g, '$1')
      .trim()
  );
}

/**
 * A sentence ends at . ! ? … or the Hindi danda (plus closing quotes) when
 * whitespace follows, or at a line break. "3.5" and "example.com" stay whole.
 */
const SENTENCE_BREAK = /(?<=[.!?。।…]["'”’)\]]*)\s+|\n+/;

function splitLong(sentence: string, max: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    // Prefer a comma-like pause, then any space, then a hard cut.
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
    if (cut > max * 0.4) cut += 1;
    else cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Splits text into chunks of at most `max` characters, breaking at sentence
 * ends where possible. Short neighbouring sentences are joined so speech
 * does not pause more than it has to.
 */
export function chunkText(text: string, max = MAX_CHUNK_CHARS): string[] {
  const sentences = text
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    for (const piece of sentence.length > max ? splitLong(sentence, max) : [sentence]) {
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= max) current = `${current} ${piece}`;
      else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
