import { describe, expect, it } from 'vitest';
import { COMPANION_NAME_MAX_LENGTH, checkCompanionName, nameLength } from './companionName';

describe('checkCompanionName', () => {
  it('accepts letters, digits and spaces, and tidies the spacing', () => {
    expect(checkCompanionName('  Sparky   7 ')).toEqual({ ok: true, name: 'Sparky 7' });
    expect(checkCompanionName('Ñandú')).toEqual({ ok: true, name: 'Ñandú' });
    expect(checkCompanionName('चिंटू')).toEqual({ ok: true, name: 'चिंटू' });
  });

  it('lets the child clear the name', () => {
    expect(checkCompanionName('   ')).toEqual({ ok: true, name: '' });
  });

  it('refuses punctuation, emoji and anything that could be a link or an address', () => {
    for (const bad of ['Rex!', 'a@b.com', 'www.site.com', 'Star⭐', 'Mr. Fox', 'x_y', '<b>']) {
      expect(checkCompanionName(bad)).toEqual({ ok: false, problem: 'chars' });
    }
  });

  it('refuses a name longer than 16 characters, counting characters and not bytes', () => {
    expect(COMPANION_NAME_MAX_LENGTH).toBe(16);
    expect(checkCompanionName('a'.repeat(16))).toEqual({ ok: true, name: 'a'.repeat(16) });
    expect(checkCompanionName('a'.repeat(17))).toEqual({ ok: false, problem: 'long' });
    expect(nameLength('ñandú')).toBe(5);
  });

  it('passes the name through the safety check', () => {
    expect(checkCompanionName('Killer')).toEqual({ ok: false, problem: 'unsafe' });
    expect(checkCompanionName('Skilly')).toEqual({ ok: true, name: 'Skilly' });
  });
});
