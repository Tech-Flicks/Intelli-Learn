import { describe, expect, it } from 'vitest';
import { ChallengeSchema, MAX_SCENE_OBJECTS, type Challenge, type SceneObject } from '@/core/schemas';
import { NEUTRAL_EMOJI, normalizeChallenge } from './normalize';
import { hashString, seededRandom, seededShuffle, shuffleAwayFrom, shuffledOrderIds, signatureOf } from './shuffle';
import { CHOICE, makeChallenge, NUMBER, ROBOT, TAP, TAP_SCENE } from './testing/fixtures';
import { validateChallengeContent } from './validate';

const CLEAN_SVG = '<svg viewBox="0 0 4 4"><rect width="4" height="4" fill="#00ff00"/></svg>';

function objectsOf(c: Challenge): SceneObject[] {
  return c.scene.objects;
}

describe('normalizeChallenge', () => {
  it('returns a deep copy and leaves the input untouched', () => {
    const input = makeChallenge(TAP, { scene: TAP_SCENE });
    const snapshot = JSON.stringify(input);
    const out = normalizeChallenge(input);
    expect(out).not.toBe(input);
    expect(out.scene).not.toBe(input.scene);
    expect(out.scene.objects[0]).not.toBe(input.scene.objects[0]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('keeps a sound challenge schema-valid and unchanged in meaning', () => {
    const input = makeChallenge(TAP, { scene: TAP_SCENE });
    const out = normalizeChallenge(input);
    expect(ChallengeSchema.safeParse(out).success).toBe(true);
    expect(out.interaction).toEqual(input.interaction);
    expect(objectsOf(out).map((o) => o.id)).toEqual(['apple1', 'apple2', 'pear', 'sun']);
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('is idempotent', () => {
    const once = normalizeChallenge(makeChallenge(TAP, { scene: TAP_SCENE }));
    expect(normalizeChallenge(once)).toEqual(once);
  });

  it('gives duplicate scene object ids unique names', () => {
    const out = normalizeChallenge(
      makeChallenge(CHOICE, {
        scene: {
          objects: [
            { id: 'star', type: 'emoji', emoji: '⭐', x: 10, y: 10 },
            { id: 'star', type: 'emoji', emoji: '⭐', x: 20, y: 10 },
            { id: 'star', type: 'emoji', emoji: '⭐', x: 30, y: 10 },
            { id: 'star-2', type: 'emoji', emoji: '🌙', x: 40, y: 10 },
          ],
        },
      }),
    );
    const ids = objectsOf(out).map((o) => o.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe('star');
    expect(ids).toContain('star-2');
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('keeps renamed ids within 40 characters', () => {
    const long = 'x'.repeat(40);
    const out = normalizeChallenge(
      makeChallenge(CHOICE, {
        scene: {
          objects: [
            { id: long, type: 'emoji', emoji: '⭐', x: 10, y: 10 },
            { id: long, type: 'emoji', emoji: '⭐', x: 20, y: 10 },
          ],
        },
      }),
    );
    expect(objectsOf(out)[1]?.id).toHaveLength(40);
    expect(objectsOf(out)[1]?.id).not.toBe(long);
    expect(ChallengeSchema.safeParse(out).success).toBe(true);
  });

  it('treats every copy of a repeated tap target id as a target', () => {
    const out = normalizeChallenge(
      makeChallenge(
        { kind: 'tap', targetIds: ['apple'] },
        {
          scene: {
            objects: [
              { id: 'apple', type: 'emoji', emoji: '🍎', x: 10, y: 10 },
              { id: 'apple', type: 'emoji', emoji: '🍎', x: 30, y: 10 },
              { id: 'pear', type: 'emoji', emoji: '🍐', x: 50, y: 10 },
              { id: 'plum', type: 'emoji', emoji: '🫐', x: 70, y: 10 },
            ],
          },
        },
      ),
    );
    expect(out.interaction).toEqual({ kind: 'tap', targetIds: ['apple', 'apple-2'] });
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('marks tap targets tappable and removes duplicate target ids', () => {
    const out = normalizeChallenge(
      makeChallenge(
        { kind: 'tap', targetIds: ['sun', 'sun'] },
        { scene: TAP_SCENE },
      ),
    );
    expect(out.interaction).toEqual({ kind: 'tap', targetIds: ['sun'] });
    expect(objectsOf(out).find((o) => o.id === 'sun')?.tappable).toBe(true);
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('promotes existing objects to tappable distractors, pictures before text, without inventing any', () => {
    const out = normalizeChallenge(
      makeChallenge(
        { kind: 'tap', targetIds: ['t1', 't2'] },
        {
          scene: {
            objects: [
              { id: 't1', type: 'shape', shape: 'triangle', x: 10, y: 50 },
              { id: 't2', type: 'shape', shape: 'triangle', x: 30, y: 50 },
              { id: 'caption', type: 'text', text: 'Shapes!', x: 50, y: 10, size: 20 },
              { id: 'c1', type: 'shape', shape: 'circle', x: 50, y: 50, size: 10 },
              { id: 'c2', type: 'shape', shape: 'square', x: 70, y: 50, size: 14 },
            ],
          },
        },
      ),
    );
    const tappable = objectsOf(out)
      .filter((o) => o.tappable)
      .map((o) => o.id);
    expect(tappable.sort()).toEqual(['c1', 'c2', 't1', 't2']);
    expect(objectsOf(out)).toHaveLength(5);
  });

  it('leaves the scene alone when there are already enough distractors', () => {
    const out = normalizeChallenge(makeChallenge({ kind: 'tap', targetIds: ['apple1'] }, { scene: TAP_SCENE }));
    expect(objectsOf(out).find((o) => o.id === 'sun')?.tappable).toBe(false);
  });

  it('clamps coordinates and fills in default sizes', () => {
    const base = makeChallenge(CHOICE, {
      scene: { objects: [{ id: 'a', type: 'emoji', emoji: '🍎', x: 10, y: 10 }] },
    });
    const wild = {
      ...base,
      scene: {
        ...base.scene,
        objects: [
          {
            ...(base.scene.objects[0] as SceneObject),
            x: 400,
            y: -30,
            size: Number.NaN,
            rotation: 9999,
            opacity: 0,
            z: -5,
            anim: { kind: 'move', duration: 0, delay: -3, loop: true, toX: 999, toY: -999 },
          },
        ],
      },
    } as unknown as Challenge;
    const obj = objectsOf(normalizeChallenge(wild))[0] as SceneObject;
    expect(obj).toMatchObject({ x: 100, y: 0, size: 12, rotation: 360, opacity: 0.1, z: 0 });
    expect(obj.anim).toEqual({ kind: 'move', duration: 0.2, delay: 0, loop: true, toX: 120, toY: -20 });
    expect(ChallengeSchema.safeParse(normalizeChallenge(wild)).success).toBe(true);
  });

  it('drops animations that do nothing', () => {
    const out = normalizeChallenge(
      makeChallenge(CHOICE, {
        scene: {
          objects: [
            { id: 'a', type: 'emoji', emoji: '🍎', x: 10, y: 10, anim: { kind: 'none' } },
            { id: 'b', type: 'emoji', emoji: '🍎', x: 10, y: 10, anim: { kind: 'move' } },
            { id: 'c', type: 'emoji', emoji: '🍎', x: 10, y: 10, anim: { kind: 'spin' } },
          ],
        },
      }),
    );
    expect(objectsOf(out).map((o) => o.anim?.kind)).toEqual([undefined, undefined, 'spin']);
  });

  it('removes svg objects that fail sanitizing and stores the sanitized drawing of the others', () => {
    const out = normalizeChallenge(
      makeChallenge(CHOICE, {
        scene: {
          objects: [
            { id: 'bad', type: 'svg', svg: '<svg><script>alert(1)</script></svg>', x: 10, y: 10 },
            {
              id: 'good',
              type: 'svg',
              svg: '<svg viewBox="0 0 4 4" onload="alert(1)"><rect width="4" height="4" onclick="x()"/></svg>',
              x: 20,
              y: 10,
            },
            { id: 'plain', type: 'emoji', emoji: '🍎', x: 30, y: 10 },
          ],
        },
      }),
    );
    expect(objectsOf(out).map((o) => o.id)).toEqual(['good', 'plain']);
    const svg = objectsOf(out)[0]?.svg ?? '';
    expect(svg).toContain('<rect');
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('onclick');
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('replaces an unsafe svg by a neutral emoji when it is a tap target', () => {
    const out = normalizeChallenge(
      makeChallenge(
        { kind: 'tap', targetIds: ['pic'] },
        {
          scene: {
            objects: [
              { id: 'pic', type: 'svg', svg: '<svg onload="alert(1)"></svg>', x: 10, y: 10, tappable: true },
              { id: 'other', type: 'svg', svg: CLEAN_SVG, x: 40, y: 10, tappable: true },
            ],
          },
        },
      ),
    );
    const pic = objectsOf(out).find((o) => o.id === 'pic') as SceneObject;
    expect(pic.type).toBe('emoji');
    expect(pic.emoji).toBe(NEUTRAL_EMOJI);
    expect(pic.svg).toBeUndefined();
    expect(pic.tappable).toBe(true);
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('repairs or removes objects whose type lacks its field', () => {
    const out = normalizeChallenge(
      makeChallenge(CHOICE, {
        scene: {
          objects: [
            { id: 'gone', type: 'emoji', x: 10, y: 10 },
            { id: 'switch', type: 'shape', emoji: '🍎', x: 20, y: 10 },
            { id: 'text', type: 'emoji', text: 'Hello', x: 30, y: 10 },
            { id: 'leak', type: 'emoji', emoji: '🍐', svg: '<svg onload="x()"></svg>', x: 40, y: 10 },
          ],
        },
      }),
    );
    expect(objectsOf(out).map((o) => [o.id, o.type])).toEqual([
      ['switch', 'emoji'],
      ['text', 'text'],
      ['leak', 'emoji'],
    ]);
    expect(objectsOf(out)[2]?.svg).toBeUndefined();
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('trims the scene to the object limit and never drops a tap target', () => {
    const base = makeChallenge({ kind: 'tap', targetIds: ['target'] }, { scene: TAP_SCENE });
    const filler: SceneObject[] = Array.from({ length: 34 }, (_, n) => ({
      id: `deco${n}`,
      type: 'emoji' as const,
      emoji: '🌼',
      x: n,
      y: n,
      size: 12,
      rotation: 0,
      opacity: 1,
      z: 1,
      tappable: n === 33,
    }));
    const target: SceneObject = { ...(filler[0] as SceneObject), id: 'target', tappable: true };
    const crowded = { ...base, scene: { ...base.scene, objects: [...filler, target] } } as Challenge;
    const out = normalizeChallenge(crowded);
    const ids = objectsOf(out).map((o) => o.id);
    expect(ids).toHaveLength(MAX_SCENE_OBJECTS);
    expect(ids).toContain('target');
    expect(ids).toContain('deco33'); // the tappable distractor outranks plain decoration
    expect(ids).not.toContain('deco32');
    expect(ids.indexOf('deco0')).toBeLessThan(ids.indexOf('target')); // original order is kept
  });

  it('lets the keypad type the answer', () => {
    const negative = normalizeChallenge(makeChallenge({ kind: 'number', answer: -3.5 }));
    expect(negative.interaction).toMatchObject({ allowNegative: true, allowDecimal: true });
    const plain = normalizeChallenge(makeChallenge(NUMBER));
    expect(plain.interaction).toMatchObject({ allowNegative: false, allowDecimal: false, tolerance: 0 });
    expect(validateChallengeContent(negative)).toEqual([]);
  });

  it('cleans robot walls and gems', () => {
    const out = normalizeChallenge(
      makeChallenge({
        ...ROBOT,
        walls: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 1, y: 1 },
          { x: 1, y: 1 },
          { x: 7, y: 7 },
        ],
        gems: [
          { x: 2, y: 0 },
          { x: 2, y: 0 },
        ],
        allowed: ['forward', 'forward', 'left'],
      }),
    );
    expect(out.interaction).toMatchObject({
      walls: [{ x: 1, y: 1 }],
      gems: [{ x: 2, y: 0 }],
      allowed: ['forward', 'left'],
    });
    expect(validateChallengeContent(out)).toEqual([]);
  });

  it('removes duplicate choice correct ids', () => {
    const out = normalizeChallenge(makeChallenge({ ...CHOICE, correctIds: ['b', 'b'] }));
    expect(out.interaction).toMatchObject({ correctIds: ['b'] });
  });
});

describe('deterministic shuffle', () => {
  const items = [
    { id: 'a', label: 'one' },
    { id: 'b', label: 'two' },
    { id: 'c', label: 'three' },
    { id: 'd', label: 'four' },
  ];

  it('hashes and generates the same values every time', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    const r1 = seededRandom(42);
    const r2 = seededRandom(42);
    const values = [r1(), r1(), r1()];
    expect(values).toEqual([r2(), r2(), r2()]);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('shuffles without losing or repeating items', () => {
    const out = seededShuffle(items, 7);
    expect(out).toHaveLength(4);
    expect(new Set(out)).toEqual(new Set(items));
    expect(seededShuffle(items, 7)).toEqual(out);
  });

  it('never returns the solved order, for many different id sets', () => {
    for (let n = 0; n < 200; n += 1) {
      const set = Array.from({ length: 3 + (n % 5) }, (_, k) => ({ id: `i${n}-${k}`, label: `item ${k}` }));
      const ids = shuffledOrderIds(set);
      expect(ids.slice().sort()).toEqual(set.map((s) => s.id).sort());
      expect(ids).not.toEqual(set.map((s) => s.id));
      expect(shuffledOrderIds(set)).toEqual(ids);
    }
  });

  it('never looks solved even when some items look alike', () => {
    const twins = [
      { id: 'a', label: '5' },
      { id: 'b', label: '5' },
      { id: 'c', label: '7' },
    ];
    for (let n = 0; n < 50; n += 1) {
      const set = twins.map((t) => ({ ...t, id: `${t.id}${n}` }));
      const out = shuffleAwayFrom(set, 'order');
      expect(out.map(signatureOf)).not.toEqual(set.map(signatureOf));
    }
  });

  it('gives up gracefully when everything looks the same', () => {
    const same = [
      { id: 'a', label: 'x' },
      { id: 'b', label: 'x' },
    ];
    expect(shuffleAwayFrom(same)).toHaveLength(2);
    expect(shuffleAwayFrom([{ id: 'only', label: 'x' }])).toEqual([{ id: 'only', label: 'x' }]);
  });
});
