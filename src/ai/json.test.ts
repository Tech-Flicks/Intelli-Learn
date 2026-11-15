import { describe, expect, it } from 'vitest';
import { extractJsonObject } from './json';

describe('extractJsonObject', () => {
  it('parses a plain object', () => {
    expect(extractJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  it('finds the object inside a code fence with prose around it', () => {
    const text = 'Sure! Here is the challenge:\n```json\n{"title": "Stars", "n": [1, 2]}\n```\nHope it helps.';
    expect(extractJsonObject(text)).toEqual({ title: 'Stars', n: [1, 2] });
  });

  it('returns the first balanced top-level object only', () => {
    expect(extractJsonObject('{"first": {"deep": true}} and then {"second": 2}')).toEqual({ first: { deep: true } });
  });

  it('is not confused by braces and quotes inside strings', () => {
    expect(extractJsonObject('{"text": "a } tricky \\" { string", "ok": true}')).toEqual({ text: 'a } tricky " { string', ok: true });
  });

  it('skips prose braces that are not JSON', () => {
    expect(extractJsonObject('Use {curly} braces. {"real": 1}')).toEqual({ real: 1 });
  });

  it('ignores a thinking block before the answer', () => {
    expect(extractJsonObject('<think>maybe {"draft": 0}</think>{"final": 1}')).toEqual({ final: 1 });
  });

  it('tolerates trailing commas', () => {
    expect(extractJsonObject('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 });
  });

  it('returns undefined when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeUndefined();
    expect(extractJsonObject('[1, 2, 3]')).toBeUndefined();
    expect(extractJsonObject('{"unfinished": ')).toBeUndefined();
    expect(extractJsonObject('')).toBeUndefined();
  });
});
