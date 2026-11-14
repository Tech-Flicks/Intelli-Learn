/**
 * Turns on-screen text into text a speech engine reads well: no symbols, no emoji,
 * and numbers written as words.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;
const DIGITS = ONES.slice(0, 10);

function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds] as string} hundred`);
  if (rest > 0 || hundreds === 0) {
    if (rest < 20) parts.push(ONES[rest] as string);
    else {
      const unit = rest % 10;
      parts.push(unit === 0 ? (TENS[Math.floor(rest / 10)] as string) : `${TENS[Math.floor(rest / 10)] as string}-${ONES[unit] as string}`);
    }
  }
  return parts.join(' ');
}

/** 42 -> "forty-two", -3.5 -> "minus three point five". Whole numbers up to 999 billion. */
export function numberWords(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `minus ${numberWords(-value)}`;
  const text = String(value);
  if (text.includes('e')) return text;
  const [wholeText = '0', fraction] = text.split('.');
  let whole = Number(wholeText);
  let words: string;
  if (whole < 1000) words = belowThousand(whole);
  else if (whole >= 1e12) words = wholeText;
  else {
    const groups: string[] = [];
    const names = ['', ' thousand', ' million', ' billion'];
    let index = 0;
    while (whole > 0) {
      const chunk = whole % 1000;
      if (chunk > 0) groups.unshift(`${belowThousand(chunk)}${names[index] as string}`);
      whole = Math.floor(whole / 1000);
      index += 1;
    }
    words = groups.join(' ');
  }
  if (fraction !== undefined) {
    words += ` point ${Array.from(fraction)
      .map((d) => DIGITS[Number(d)] as string)
      .join(' ')}`;
  }
  return words;
}

const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'] as const;

const IRREGULAR_ORDINAL: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

/** 1 -> "first", 21 -> "twenty-first". */
export function ordinalWord(n: number): string {
  const known = ORDINALS[n];
  if (known) return known;
  if (!Number.isInteger(n) || n < 0) return `${n}th`;
  const words = numberWords(n);
  const cut = Math.max(words.lastIndexOf(' '), words.lastIndexOf('-')) + 1;
  const last = words.slice(cut);
  const irregular = IRREGULAR_ORDINAL[last];
  if (irregular) return words.slice(0, cut) + irregular;
  return last.endsWith('y') ? `${words.slice(0, -1)}ieth` : `${words}th`;
}

const FRACTION_NAMES: Record<string, string> = {
  '1/2': 'one half',
  '1/3': 'one third',
  '2/3': 'two thirds',
  '1/4': 'one quarter',
  '3/4': 'three quarters',
};

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}]/gu;

/** Removes emoji and pictographs. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
}

/** Rewrites text for text-to-speech. The result has no math symbols, digits or emoji. */
export function speakable(text: string): string {
  let out = stripEmoji(text);
  // Thousands separators first, so "1,250" is read as one number.
  out = out.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  out = out.replace(/(\d+)\s*°\s*C\b/g, '$1 degrees Celsius').replace(/(\d+)\s*°\s*F\b/g, '$1 degrees Fahrenheit');
  out = out.replace(/°/g, ' degrees ');
  out = out.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, m: string) =>
    m === '00' ? `${Number(h)} o'clock` : `${Number(h)} ${m.startsWith('0') ? `oh ${Number(m)}` : Number(m)}`,
  );
  out = out.replace(/\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/g, 'the point $1 comma $2');
  out = out.replace(/√\s*/g, 'the square root of ');
  out = out.replace(/(\w)\s*\^\s*(-?\d+)/g, '$1 to the power of $2');
  out = out.replace(/(\d)\s*%/g, '$1 percent').replace(/%/g, ' percent ');
  out = out.replace(/\b(\d+)\/(\d+)\b/g, (match, a: string, b: string) => FRACTION_NAMES[match] ?? `${a} over ${b}`);
  out = out.replace(/(^|[\s(=+×÷*/<>-])[-−](\d)/g, '$1minus $2');
  out = out.replace(/\s*[×✕]\s*/g, ' times ').replace(/(\d)\s*[x*]\s*(?=\d)/g, '$1 times ');
  out = out.replace(/\s*÷\s*/g, ' divided by ');
  out = out.replace(/\s*\+\s*/g, ' plus ');
  out = out.replace(/\s+[-−–]\s+/g, ' minus ');
  out = out.replace(/(\d)\s*[−–]\s*(?=\d)/g, '$1 minus ');
  out = out.replace(/\s*≥\s*/g, ' is at least ').replace(/\s*≤\s*/g, ' is at most ').replace(/\s*≠\s*/g, ' is not equal to ');
  out = out.replace(/\s*>\s*/g, ' is greater than ').replace(/\s*<\s*/g, ' is less than ');
  out = out.replace(/\s*=\s*/g, ' equals ');
  out = out.replace(/\s*(?:→|➜|->)\s*/g, ', then ');
  out = out.replace(/_{2,}/g, ' what number ');
  out = out.replace(/(^|\s)\?(?=\s|$)/g, '$1what number');
  out = out.replace(/&/g, ' and ').replace(/\//g, ' or ').replace(/[*#@|~^_{}[\]()"“”]/g, ' ');
  out = out.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, (_m, n: string) => ordinalWord(Number(n)));
  out = out.replace(/-?\d+(?:\.\d+)?/g, (match) => {
    const value = Number(match);
    return Number.isFinite(value) && Math.abs(value) < 1e12 ? numberWords(value) : match;
  });
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/([.!?])\s*,/g, '$1')
    .trim();
}
