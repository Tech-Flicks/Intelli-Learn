import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, constantTimeEqual, randomBytes } from './encoding';

describe('base64', () => {
  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('round-trips a buffer larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('matches the standard encoding', () => {
    expect(bytesToBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });

  it('throws on text that is not base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow();
  });
});

describe('randomBytes', () => {
  it('returns the requested number of fresh bytes', () => {
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a).toHaveLength(16);
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
  });
});

describe('constantTimeEqual', () => {
  it('compares contents', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(0, 2, 3), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it('treats different lengths as different, also when one is a prefix of the other', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 0))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 0), Uint8Array.of(1, 2))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(), Uint8Array.of(0))).toBe(false);
  });
});
