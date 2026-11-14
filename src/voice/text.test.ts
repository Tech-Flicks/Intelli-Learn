import { describe, expect, it } from 'vitest';
import { MAX_CHUNK_CHARS, chunkText, cleanForSpeech } from './text';

describe('cleanForSpeech', () => {
  it('removes emoji, including joined sequences, flags and skin tones', () => {
    expect(cleanForSpeech('Great job! 🎉🚀')).toBe('Great job!');
    expect(cleanForSpeech('The 👨‍👩‍👧 family and 👍🏽 and 🇮🇳 flag')).toBe('The family and and flag');
    expect(cleanForSpeech('⭐️ 3 stars ⭐️')).toBe('3 stars');
    expect(cleanForSpeech('🎈')).toBe('');
  });

  it('keeps digits, keycap digits and math symbols', () => {
    expect(cleanForSpeech('2 + 3 = 5')).toBe('2 + 3 = 5');
    expect(cleanForSpeech('Press 3️⃣ now')).toBe('Press 3 now');
    expect(cleanForSpeech('Is 7 > 4?')).toBe('Is 7 > 4?');
  });

  it('removes markdown but keeps the words', () => {
    expect(cleanForSpeech('**Count** the *red* apples.')).toBe('Count the red apples.');
    expect(cleanForSpeech('# Step 1\n- Look at the `robot`\n- Tap __go__')).toBe('Step 1\nLook at the robot\nTap go');
    expect(cleanForSpeech('> A hint: ~~wrong~~ right')).toBe('A hint: wrong right');
    expect(cleanForSpeech('Read [this page](https://example.com/x) first')).toBe('Read this page first');
  });

  it('reads a star between numbers as multiplication', () => {
    expect(cleanForSpeech('What is 3 * 4?')).toBe('What is 3 × 4?');
    expect(cleanForSpeech('2*5*10')).toBe('2 × 5 × 10');
  });

  it('keeps underscores inside words', () => {
    expect(cleanForSpeech('the move_forward block')).toBe('the move_forward block');
    expect(cleanForSpeech('_slowly_ now')).toBe('slowly now');
  });

  it('tidies whitespace', () => {
    expect(cleanForSpeech('  Hello   there  !  ')).toBe('Hello there!');
    expect(cleanForSpeech('One.\n\n\nTwo.')).toBe('One.\nTwo.');
  });

  it('keeps Spanish and Hindi text intact', () => {
    expect(cleanForSpeech('¿Cuántas manzanas hay? ¡Muy bien! 🍎')).toBe('¿Cuántas manzanas hay? ¡Muy bien!');
    expect(cleanForSpeech('कितने सेब हैं? **बहुत बढ़िया!** 🍎')).toBe('कितने सेब हैं? बहुत बढ़िया!');
  });
});

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n ')).toEqual([]);
  });

  it('keeps short text in one chunk', () => {
    expect(chunkText('Count the stars. How many are there?')).toEqual(['Count the stars. How many are there?']);
  });

  it('splits at sentence ends and never exceeds the limit', () => {
    const sentence = 'The little robot rolled across the shiny floor to find a gem.';
    const text = Array.from({ length: 8 }, () => sentence).join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(chunk.endsWith('.')).toBe(true);
    }
    expect(chunks.join(' ')).toBe(text);
  });

  it('does not split decimals or dotted words', () => {
    expect(chunkText('Pour 3.5 cups. Then stir.', 14)).toEqual(['Pour 3.5 cups.', 'Then stir.']);
  });

  it('splits a very long sentence at commas, then spaces', () => {
    const long = `${'red, green, blue, yellow, '.repeat(12)}and pink`;
    const chunks = chunkText(long, 60);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  it('hard-cuts a word that is longer than the limit', () => {
    const chunks = chunkText('a'.repeat(50), 20);
    expect(chunks).toEqual(['a'.repeat(20), 'a'.repeat(20), 'a'.repeat(10)]);
  });

  it('treats the Hindi danda and line breaks as sentence ends', () => {
    expect(chunkText('यह एक वाक्य है। यह दूसरा है।', 18)).toEqual(['यह एक वाक्य है।', 'यह दूसरा है।']);
    expect(chunkText('Line one\nLine two', 10)).toEqual(['Line one', 'Line two']);
  });
});
