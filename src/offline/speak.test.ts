import { describe, expect, it } from 'vitest';
import { numberWords, ordinalWord, speakable, stripEmoji } from './speak';

describe('numberWords', () => {
  it('writes whole numbers', () => {
    expect(numberWords(0)).toBe('zero');
    expect(numberWords(7)).toBe('seven');
    expect(numberWords(15)).toBe('fifteen');
    expect(numberWords(40)).toBe('forty');
    expect(numberWords(42)).toBe('forty-two');
    expect(numberWords(100)).toBe('one hundred');
    expect(numberWords(305)).toBe('three hundred five');
    expect(numberWords(1250)).toBe('one thousand two hundred fifty');
    expect(numberWords(1000000)).toBe('one million');
    expect(numberWords(30000)).toBe('thirty thousand');
  });
  it('writes negatives and decimals', () => {
    expect(numberWords(-7)).toBe('minus seven');
    expect(numberWords(3.5)).toBe('three point five');
    expect(numberWords(0.25)).toBe('zero point two five');
  });
  it('writes ordinals', () => {
    expect(ordinalWord(1)).toBe('first');
    expect(ordinalWord(7)).toBe('seventh');
    expect(ordinalWord(12)).toBe('twelfth');
    expect(ordinalWord(21)).toBe('twenty-first');
    expect(ordinalWord(40)).toBe('fortieth');
    expect(ordinalWord(14)).toBe('fourteenth');
    expect(speakable('1st is the smallest and 5th is the biggest')).toBe('first is the smallest and fifth is the biggest');
  });
});

describe('speakable', () => {
  it('spells out arithmetic', () => {
    expect(speakable('What is 3 + 4?')).toBe('What is three plus four?');
    expect(speakable('12 - 5 = ?')).toBe('twelve minus five equals what number');
    expect(speakable('6 × 7 = 42')).toBe('six times seven equals forty-two');
    expect(speakable('56 ÷ 8')).toBe('fifty-six divided by eight');
    expect(speakable('What is -3 × 4?')).toBe('What is minus three times four?');
  });
  it('reads fractions, percents, powers and comparisons', () => {
    expect(speakable('1/2 of 8')).toBe('one half of eight');
    expect(speakable('5/8')).toBe('five over eight');
    expect(speakable('25% of 80')).toBe('twenty-five percent of eighty');
    expect(speakable('2^3')).toBe('two to the power of three');
    expect(speakable('5 > 3 and 2 < 4')).toBe('five is greater than three and two is less than four');
    expect(speakable('7 + ? = 10')).toBe('seven plus what number equals ten');
    expect(speakable('√49')).toBe('the square root of forty-nine');
  });
  it('removes emoji and leftover symbols', () => {
    expect(stripEmoji('Tap the 🍎 apples 🧑‍🚀!')).toBe('Tap the apples!');
    const spoken = speakable('🚀 Count the rockets (3 + 2) → then say "5" & smile 1,250 times at 3:30 or 20°C');
    expect(spoken).not.toMatch(/[+=×÷<>%/^√°→_*#@|~{}[\]()"\d]/);
    expect(spoken).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(spoken).toContain('one thousand two hundred fifty');
    expect(spoken).toContain('twenty degrees Celsius');
  });
  it('keeps plain sentences as they are', () => {
    expect(speakable('Which one is a living thing?')).toBe('Which one is a living thing?');
    expect(speakable('A step-by-step plan.')).toBe('A step-by-step plan.');
  });
});
