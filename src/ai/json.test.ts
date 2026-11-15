import { describe, expect, it } from 'vitest';
import { describeJsonFailure, extractJsonObject } from './json';

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

/** A challenge-shaped reply: the real answer is the outer object, and it holds smaller objects. */
const OUTER = '{"title": "Stars", "interaction": {"kind": "choice", "options": [{"id": "o1", "label": "3"}]}, "scene": {"objects": []}}';

describe('extractJsonObject: never a fragment of a broken answer', () => {
  it('forgives comments in the object', () => {
    const line = OUTER.replace('"interaction"', '// the task\n"interaction"');
    expect(extractJsonObject(line)).toHaveProperty('title', 'Stars');
    const block = OUTER.replace('"options"', '/* four of them */ "options"');
    expect(extractJsonObject(block)).toHaveProperty('title', 'Stars');
    // Comment marks inside a string are text.
    expect(extractJsonObject('{"a": "see // this /* and */ that", // why\n "b": 1}')).toEqual({ a: 'see // this /* and */ that', b: 1 });
  });

  it('prefers the answer over a small JSON aside in front of it', () => {
    const text = `The robot starts at {"x": 0, "y": 2} facing right. Here is the challenge: ${OUTER}`;
    expect(extractJsonObject(text)).toHaveProperty('title', 'Stars');
  });

  it('drops reasoning that ends in a stray closing tag', () => {
    const text = `Let me think. An option could be {"id":"o1","label":"3"}.\n</think>\n${OUTER}`;
    expect(extractJsonObject(text)).toHaveProperty('title', 'Stars');
  });

  it('returns nothing for a reply that was cut off, instead of an object from inside it', () => {
    const cut = OUTER.slice(0, OUTER.indexOf('"scene"') + 12);
    expect(extractJsonObject(cut)).toBeUndefined();
    expect(describeJsonFailure(cut)).toMatch(/not complete/);
  });

  it('returns nothing when the answer has an unescaped quote, instead of an object from inside it', () => {
    const broken = OUTER.replace('"objects": []', '"objects": [{"id": "pic", "svg": "<svg viewBox="0 0 100 100"></svg>"}]');
    expect(extractJsonObject(broken)).toBeUndefined();
    expect(describeJsonFailure(broken)).toMatch(/not valid JSON/);
    expect(describeJsonFailure(broken)).toMatch(/double quote/);
  });

  it('returns nothing when the answer is broken and only an aside can be read', () => {
    const broken = OUTER.replace('"Stars"', "'Stars'");
    expect(extractJsonObject(`Start cell {"x": 0, "y": 2}. ${broken}`)).toBeUndefined();
  });

  it('has nothing to say about a reply without any object', () => {
    expect(describeJsonFailure('I cannot help with that.')).toBe('');
  });
});
