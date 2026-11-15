import { afterEach, describe, expect, it } from 'vitest';
import { localSafetyCheck } from '@/ai';
import { LOCALES } from '@/core/types';
import { setLocale } from '@/i18n';
import './strings';
import {
  EMPTY_IDEA,
  IDEA_ACTIONS,
  IDEA_CHARACTERS,
  IDEA_PLACES,
  IDEA_ROWS,
  SURPRISE_IDEAS,
  TYPED_IDEA_MAX_LENGTH,
  buildIdea,
  checkTypedIdea,
  clipIdea,
  ideaEmoji,
  isCompleteIdea,
  pickSurprises,
} from './studioIdeas';

afterEach(() => setLocale('en'));

describe('buildIdea', () => {
  it('needs one choice from each row', () => {
    expect(buildIdea(EMPTY_IDEA)).toBeNull();
    expect(buildIdea({ character: 'dragon', action: 'baking', place: null })).toBeNull();
    expect(buildIdea({ character: 'dragon', action: 'baking', place: 'nowhere' })).toBeNull();
    expect(isCompleteIdea({ character: 'dragon', action: 'baking', place: 'moon' })).toBe(true);
  });

  it('builds the sentence in English', () => {
    expect(buildIdea({ character: 'dragon', action: 'baking', place: 'moon' })).toBe('A dragon baking cookies on the moon');
    expect(buildIdea({ character: 'octopus', action: 'racing', place: 'sea' })).toBe('An octopus racing under the sea');
  });

  it('builds the sentence in Spanish', () => {
    setLocale('es');
    expect(buildIdea({ character: 'dragon', action: 'baking', place: 'moon' })).toBe('Un dragón horneando galletas en la luna');
  });

  it('builds the sentence in Hindi: place first, and the action agrees with the character', () => {
    setLocale('hi');
    expect(buildIdea({ character: 'dragon', action: 'baking', place: 'moon' })).toBe('चाँद पर कुकीज़ बनाता हुआ एक ड्रैगन');
    expect(buildIdea({ character: 'cat', action: 'dancing', place: 'castle' })).toBe('महल में नाचती हुई एक बिल्ली');
  });

  it('only ever builds safe, short sentences, in every language', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const character of IDEA_CHARACTERS) {
        for (const action of IDEA_ACTIONS) {
          for (const place of IDEA_PLACES) {
            const idea = buildIdea({ character: character.id, action: action.id, place: place.id });
            expect(idea).not.toBeNull();
            const text = idea ?? '';
            expect(text).not.toContain('child.studio');
            expect(Array.from(text).length).toBeLessThanOrEqual(TYPED_IDEA_MAX_LENGTH);
            expect(localSafetyCheck(text, 'strict'), text).toEqual({ safe: true, reason: '' });
          }
        }
      }
    }
  });
});

describe('idea rows and surprises', () => {
  it('has three rows with unique chips', () => {
    expect(IDEA_ROWS.map((row) => row.row)).toEqual(['character', 'action', 'place']);
    for (const row of IDEA_ROWS) {
      expect(new Set(row.chips.map((chip) => chip.id)).size).toBe(row.chips.length);
      expect(row.chips.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('offers complete surprise ideas, without repeats', () => {
    for (const idea of SURPRISE_IDEAS) expect(buildIdea(idea)).not.toBeNull();
    const picked = pickSurprises(3, () => 0);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    expect(pickSurprises(99, () => 0.999)).toHaveLength(SURPRISE_IDEAS.length);
  });

  it('shows the pictures of a choice', () => {
    expect(ideaEmoji({ character: 'dragon', action: 'baking', place: 'moon' })).toBe('🐉 🍪 🌙');
    expect(ideaEmoji({ character: 'dragon', action: null, place: null })).toBe('🐉');
    expect(ideaEmoji(EMPTY_IDEA)).toBe('');
  });
});

describe('checkTypedIdea', () => {
  it('tidies the text and keeps it to 80 characters', () => {
    expect(checkTypedIdea('  a  robot   who\npaints ')).toEqual({ ok: true, idea: 'a robot who paints' });
    const long = checkTypedIdea('wonderful '.repeat(20));
    expect(long.ok).toBe(true);
    if (long.ok) expect(Array.from(long.idea).length).toBeLessThanOrEqual(TYPED_IDEA_MAX_LENGTH);
    expect(clipIdea('é'.repeat(100))).toHaveLength(80);
  });

  it('refuses nothing at all and anything unsafe', () => {
    expect(checkTypedIdea('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkTypedIdea('a robot that kills everyone')).toEqual({ ok: false, problem: 'unsafe' });
    expect(checkTypedIdea('look at www.example.com')).toEqual({ ok: false, problem: 'unsafe' });
  });
});
