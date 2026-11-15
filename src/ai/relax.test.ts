import { describe, expect, it } from 'vitest';
import { ChallengeSchema } from '@/core/schemas';
import { KIND_EXAMPLES } from './prompts';
import { relaxChallengeJson, toHexColor } from './relax';

function base(kind: keyof typeof KIND_EXAMPLES = 'number'): Record<string, unknown> {
  return structuredClone(KIND_EXAMPLES[kind]) as Record<string, unknown>;
}

function sceneObjects(value: Record<string, unknown>): Record<string, unknown>[] {
  return (value.scene as { objects: Record<string, unknown>[] }).objects;
}

describe('toHexColor', () => {
  it('accepts hex in several spellings and common colour names', () => {
    expect(toHexColor('#FF8800')).toBe('#ff8800');
    expect(toHexColor('#abc')).toBe('#abc');
    expect(toHexColor('ff8800')).toBe('#ff8800');
    expect(toHexColor('#ff8800cc')).toBe('#ff8800');
    expect(toHexColor('Sky Blue')).toBe('#81d4fa');
    expect(toHexColor('red')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives up on anything else', () => {
    expect(toHexColor('rgb(1,2,3)')).toBeUndefined();
    expect(toHexColor('sparkly')).toBeUndefined();
    expect(toHexColor(7)).toBeUndefined();
  });
});

describe('relaxChallengeJson', () => {
  it('leaves a valid challenge valid and its meaning untouched', () => {
    for (const raw of Object.values(KIND_EXAMPLES)) {
      const relaxed = relaxChallengeJson(structuredClone(raw) as Record<string, unknown>);
      expect(ChallengeSchema.parse(relaxed)).toEqual(ChallengeSchema.parse(raw));
    }
  });

  it('does not change its input', () => {
    const raw = { ...base(), funFact: null };
    const copy = structuredClone(raw);
    relaxChallengeJson(raw);
    expect(raw).toEqual(copy);
  });

  it('drops null in optional places, which the schema would reject', () => {
    const raw = base();
    raw.funFact = null;
    raw.teachBack = null;
    (raw.interaction as Record<string, unknown>).unit = null;
    sceneObjects(raw)[0] = { ...sceneObjects(raw)[0], color: null, label: null, anim: null };
    expect(ChallengeSchema.safeParse(raw).success).toBe(false);

    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.funFact).toBeUndefined();
    expect(parsed.teachBack).toBeUndefined();
    expect(parsed.scene.objects[0]?.anim).toBeUndefined();
  });

  it('clamps scene numbers and reads numbers written as strings', () => {
    const raw = base();
    sceneObjects(raw)[0] = { id: 'rocket', type: 'emoji', emoji: '🚀', x: 104, y: -3, size: '120', rotation: 720, opacity: 0, z: 500, anim: { kind: 'float', duration: 0, delay: -1 } };
    const object = ChallengeSchema.parse(relaxChallengeJson(raw)).scene.objects[0];
    expect(object).toMatchObject({ x: 100, y: 0, size: 80, rotation: 360, opacity: 0.1, z: 100 });
    expect(object?.anim).toMatchObject({ kind: 'float', duration: 0.2, delay: 0 });
  });

  it('repairs colours, an unknown theme, an unknown animation and overlong captions', () => {
    const raw = base();
    const scene = raw.scene as Record<string, unknown>;
    scene.theme = 'outer-space';
    scene.gradient = ['navy', 'not a colour'];
    sceneObjects(raw)[0] = { id: 'a', type: 'shape', shape: 'circle', x: 10, y: 10, color: 'Blue', label: 'A caption that is much too long to fit', anim: { kind: 'teleport' } };
    sceneObjects(raw)[1] = { id: 'b', type: 'shape', shape: 'star', x: 20, y: 20, color: 'glittery' };
    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.scene.theme).toBe('plain');
    expect(parsed.scene.gradient).toBeUndefined();
    expect(parsed.scene.objects[0]?.color).toBe('#1e88e5');
    expect(parsed.scene.objects[0]?.label?.length).toBeLessThanOrEqual(24);
    expect(parsed.scene.objects[0]?.anim).toBeUndefined();
    expect(parsed.scene.objects[1]?.color).toBeUndefined();
  });

  it('keeps a valid gradient', () => {
    const raw = base();
    (raw.scene as Record<string, unknown>).gradient = ['#001133', 'skyblue'];
    expect(ChallengeSchema.parse(relaxChallengeJson(raw)).scene.gradient).toEqual(['#001133', '#81d4fa']);
  });

  it('trims a scene that is too big without losing tap targets', () => {
    const raw = base('tap');
    const extras = Array.from({ length: 40 }, (_, index) => ({ id: `extra${index}`, type: 'emoji', emoji: '🌼', x: 50, y: 50 }));
    (raw.scene as Record<string, unknown>).objects = [...extras, ...sceneObjects(raw)];
    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.scene.objects).toHaveLength(30);
    const ids = parsed.scene.objects.map((object) => object.id);
    for (const target of ['flower', 'tree', 'bug']) expect(ids).toContain(target);
  });

  it('fixes number answers written as text, extra hints and string booleans', () => {
    const raw = base();
    raw.interaction = { kind: 'number', answer: '5', tolerance: -1, allowDecimal: 'false', allowNegative: 'false' };
    raw.hints = ['One.', 'Two.', 'Three.'];
    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.interaction).toMatchObject({ kind: 'number', answer: 5, tolerance: 0, allowDecimal: false });
    expect(parsed.hints).toEqual(['One.', 'Two.']);
  });

  it('never touches texts the child reads or the answer key', () => {
    const raw = base('choice');
    raw.question = 'x'.repeat(400); // too long: must be reported, not cut
    const relaxed = relaxChallengeJson(raw);
    expect(relaxed.question).toBe(raw.question);
    expect(relaxed.interaction).toEqual(raw.interaction);
    expect(ChallengeSchema.safeParse(relaxed).success).toBe(false);
  });

  it('survives junk', () => {
    expect(relaxChallengeJson({})).toEqual({});
    expect(relaxChallengeJson({ scene: 'nope', interaction: [1, null], hints: 'x' })).toEqual({ scene: 'nope', interaction: [1], hints: 'x' });
  });
});
