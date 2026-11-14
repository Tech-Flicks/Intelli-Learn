import { describe, expect, it } from 'vitest';
import { ANIMATIONS, SCENE_THEMES, SHAPES, SceneSchema, type Scene, type SceneAnim, type SceneObject } from '@/core/schemas';
import { SAMPLE_CHALLENGES } from '../samples';
import { makeFakeContext } from '../testing/fakeCanvas';
import { animPose, easeInOutSine, easeOutBack, easeOutCubic, REST_POSE, tapSquash, type AnimContext } from './anim';
import { drawBackground, THEME_GRADIENTS, themeIsDark } from './backgrounds';
import {
  accessibleNames,
  colorName,
  describeScene,
  drawOrder,
  hitTest,
  objectName,
  objectSizePx,
  parseHex,
  placeObject,
  shade,
  shapeBox,
  textMetrics,
} from './layout';
import { drawParticles, drawStaticBurst, spawnCelebration, stepParticles } from './particles';
import { renderFrame, type FrameInput } from './render';
import { defaultShapeColor, traceShape } from './shapes';

const CTX: AnimContext = { x: 20, y: 50, sizePx: 40, stageWidth: 400, stageHeight: 300 };
const STAGE = { width: 400, height: 300 };

function anim(kind: SceneAnim['kind'], extra: Partial<SceneAnim> = {}): SceneAnim {
  return { kind, duration: 2, delay: 0, loop: true, ...extra };
}

function scene(objects: unknown[], theme = 'plain'): Scene {
  return SceneSchema.parse({ theme, objects });
}

describe('easing', () => {
  it('starts at 0 and ends at 1', () => {
    for (const ease of [easeInOutSine, easeOutCubic, easeOutBack]) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);
    expect(easeOutBack(0.7)).toBeGreaterThan(1); // overshoot
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(9)).toBe(1);
  });
});

describe('animPose', () => {
  it('rests without an animation or with kind none', () => {
    expect(animPose(undefined, 1, CTX)).toEqual(REST_POSE);
    expect(animPose(anim('none'), 1, CTX)).toEqual(REST_POSE);
  });

  it('returns finite values for every animation at many times', () => {
    for (const kind of ANIMATIONS) {
      for (const loop of [true, false]) {
        for (let t = -1; t < 9; t += 0.37) {
          const pose = animPose(anim(kind, { loop, delay: 0.5, toX: 80, toY: 10 }), t, CTX);
          for (const value of Object.values(pose)) expect(Number.isFinite(value)).toBe(true);
          expect(pose.alpha).toBeGreaterThanOrEqual(0);
          expect(pose.alpha).toBeLessThanOrEqual(1);
          expect(pose.scale).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('is still under reduced motion', () => {
    for (const kind of ANIMATIONS) {
      expect(animPose(anim(kind, { toX: 80 }), 0.7, CTX, true)).toEqual(REST_POSE);
    }
    // A one-way move is shown at its destination.
    expect(animPose(anim('move', { loop: false, toX: 70, toY: 50 }), 0, CTX, true)).toMatchObject({ dx: 200, dy: 0 });
  });

  it('bounces upwards and lands again', () => {
    expect(animPose(anim('bounce'), 1, CTX).dy).toBeCloseTo(-16);
    expect(animPose(anim('bounce'), 2, CTX).dy).toBeCloseTo(0);
    expect(animPose(anim('bounce', { loop: false }), 50, CTX).dy).toBeCloseTo(0);
  });

  it('spins a full turn per cycle', () => {
    expect(animPose(anim('spin'), 1, CTX).rotation).toBeCloseTo(Math.PI);
    expect(animPose(anim('spin', { loop: false }), 99, CTX).rotation).toBeCloseTo(Math.PI * 2);
  });

  it('pulses, wiggles and floats around the rest pose', () => {
    expect(animPose(anim('pulse'), 0.5, CTX).scale).toBeCloseTo(1.12);
    expect(animPose(anim('wiggle'), 0.5, CTX).rotation).toBeCloseTo(0.22);
    expect(animPose(anim('float'), 0.5, CTX).dy).toBeCloseTo(40 * 0.14);
  });

  it('waits for the delay', () => {
    expect(animPose(anim('bounce', { delay: 3 }), 1, CTX)).toEqual(REST_POSE);
    expect(animPose(anim('bounce', { delay: 3 }), 4, CTX).dy).toBeLessThan(0);
  });

  it('entrance animations hold their start pose before the delay and end at rest', () => {
    expect(animPose(anim('fade-in', { loop: false, delay: 1 }), 0.5, CTX).alpha).toBe(0);
    expect(animPose(anim('fade-in', { loop: false, delay: 1 }), 9, CTX).alpha).toBe(1);
    expect(animPose(anim('grow', { loop: false, delay: 1 }), 0.5, CTX).scale).toBe(0);
    expect(animPose(anim('grow', { loop: false }), 9, CTX).scale).toBeCloseTo(1);
    const hidden = animPose(anim('slide-in', { loop: false, delay: 1 }), 0, CTX);
    expect(20 * 4 + hidden.dx).toBeLessThanOrEqual(-40); // fully off the left edge
    expect(animPose(anim('slide-in', { loop: false }), 9, CTX).dx).toBeCloseTo(0);
  });

  it('slides in from the nearer side', () => {
    const right = animPose(anim('slide-in', { loop: false }), 0, { ...CTX, x: 90 });
    expect(right.dx).toBeGreaterThan(0);
  });

  it('looping grow and fade never make the object vanish', () => {
    for (let t = 0; t < 4; t += 0.1) {
      expect(animPose(anim('grow'), t, CTX).scale).toBeGreaterThanOrEqual(0.6);
      expect(animPose(anim('fade-in'), t, CTX).alpha).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('moves to the target and back when looping, and stays there when not', () => {
    const there = animPose(anim('move', { toX: 70, toY: 20 }), 1, CTX);
    expect(there.dx).toBeCloseTo(200);
    expect(there.dy).toBeCloseTo(-90);
    expect(animPose(anim('move', { toX: 70, toY: 20 }), 2, CTX).dx).toBeCloseTo(0);
    expect(animPose(anim('move', { toX: 70, loop: false }), 99, CTX).dx).toBeCloseTo(200);
    expect(animPose(anim('move'), 1, CTX)).toMatchObject({ dx: 0, dy: 0 }); // no target: stays put
  });

  it('orbits at a fixed distance around its start point', () => {
    for (let t = 0; t < 2; t += 0.25) {
      const pose = animPose(anim('orbit'), t, CTX);
      expect(Math.hypot(pose.dx, pose.dy)).toBeCloseTo(24);
    }
    expect(Math.hypot(animPose(anim('orbit', { loop: false }), 99, CTX).dx, 0)).toBeCloseTo(0);
  });
});

describe('tapSquash', () => {
  it('squashes briefly and then rests', () => {
    expect(tapSquash(-1)).toEqual({ sx: 1, sy: 1 });
    expect(tapSquash(5)).toEqual({ sx: 1, sy: 1 });
    const mid = tapSquash(0.07);
    expect(mid.sx).toBeGreaterThan(1);
    expect(mid.sy).toBeLessThan(1);
    expect(tapSquash(0.07, true)).toEqual({ sx: 1, sy: 1 });
  });
});

describe('layout', () => {
  it('sizes objects from the smaller stage side', () => {
    expect(objectSizePx({ size: 10 }, STAGE)).toBe(30);
    expect(objectSizePx({ size: 500 }, STAGE)).toBe(240);
  });

  it('knows which shapes are not square', () => {
    expect(shapeBox('circle')).toEqual({ w: 1, h: 1 });
    expect(shapeBox('rect').h).toBeLessThan(1);
    for (const shape of SHAPES) {
      const box = shapeBox(shape);
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
    }
  });

  it('shrinks long text to fit the stage', () => {
    const short = textMetrics('Hi', 30, STAGE);
    expect(short.fontPx).toBe(30);
    const long = textMetrics('x'.repeat(60), 30, STAGE);
    expect(long.fontPx).toBeLessThan(30);
    expect(long.width).toBeLessThanOrEqual(STAGE.width);
  });

  it('places an object at its percent position plus its animation', () => {
    const [obj] = scene([{ id: 'a', type: 'emoji', emoji: '🍎', x: 25, y: 50, size: 10 }]).objects as [SceneObject];
    expect(placeObject(obj, 0, STAGE, false)).toMatchObject({ id: 'a', cx: 100, cy: 150, hw: 15, hh: 15, sizePx: 30 });
    const moving = { ...obj, anim: anim('move', { toX: 75, toY: 50 }) };
    expect(placeObject(moving, 1, STAGE, false).cx).toBeCloseTo(300);
    expect(placeObject(moving, 1, STAGE, true).cx).toBeCloseTo(100);
  });

  it('draws in z order, keeping array order for ties', () => {
    const s = scene([
      { id: 'top', type: 'emoji', emoji: 'a', x: 1, y: 1, z: 5 },
      { id: 'first', type: 'emoji', emoji: 'b', x: 1, y: 1 },
      { id: 'bottom', type: 'emoji', emoji: 'c', x: 1, y: 1, z: 0 },
      { id: 'second', type: 'emoji', emoji: 'd', x: 1, y: 1 },
    ]);
    expect(drawOrder(s).map((o) => o.id)).toEqual(['bottom', 'first', 'second', 'top']);
  });
});

describe('hitTest', () => {
  const s = scene([
    { id: 'deco', type: 'emoji', emoji: '🌳', x: 50, y: 50, size: 20, z: 9 },
    { id: 'low', type: 'shape', shape: 'circle', x: 50, y: 50, size: 20, z: 1, tappable: true },
    { id: 'high', type: 'shape', shape: 'circle', x: 55, y: 50, size: 20, z: 2, tappable: true },
    { id: 'tiny', type: 'emoji', emoji: '🐜', x: 10, y: 10, size: 2, tappable: true },
    { id: 'mover', type: 'emoji', emoji: '🚗', x: 10, y: 90, size: 10, tappable: true, anim: { kind: 'move', toX: 90, toY: 90, duration: 2 } },
  ]);

  it('returns the topmost tappable object under the point', () => {
    expect(hitTest(s, 215, 150, 0, STAGE)).toBe('high');
    expect(hitTest(s, 175, 150, 0, STAGE)).toBe('low');
  });

  it('ignores objects that are not tappable', () => {
    const only = scene([{ id: 'deco', type: 'emoji', emoji: '🌳', x: 50, y: 50, size: 20 }]);
    expect(hitTest(only, 200, 150, 0, STAGE)).toBeNull();
  });

  it('gives small objects a fingertip-sized target', () => {
    // The ant is 6 px wide; a tap 20 px away still counts.
    expect(hitTest(s, 40 + 20, 30, 0, STAGE)).toBe('tiny');
    expect(hitTest(s, 40 + 60, 30, 0, STAGE)).toBeNull();
  });

  it('picks the nearest object on a near miss', () => {
    const pair = scene([
      { id: 'a', type: 'emoji', emoji: 'a', x: 40, y: 50, size: 4, tappable: true },
      { id: 'b', type: 'emoji', emoji: 'b', x: 50, y: 50, size: 4, tappable: true },
    ]);
    expect(hitTest(pair, 172, 150, 0, STAGE)).toBe('a');
    expect(hitTest(pair, 190, 150, 0, STAGE)).toBe('b');
  });

  it('follows animated objects, and their rest position under reduced motion', () => {
    expect(hitTest(s, 40, 270, 0, STAGE)).toBe('mover');
    expect(hitTest(s, 360, 270, 1, STAGE)).toBe('mover');
    expect(hitTest(s, 40, 270, 1, STAGE)).toBeNull();
    expect(hitTest(s, 40, 270, 1, STAGE, true)).toBe('mover');
  });

  it('misses empty space', () => {
    expect(hitTest(s, 390, 10, 0, STAGE)).toBeNull();
  });
});

describe('names and colours', () => {
  it('parses and shades hex colours', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#FF8800')).toEqual([255, 136, 0]);
    expect(parseHex('red')).toBeNull();
    expect(shade('#808080', -1)).toBe('rgb(0, 0, 0)');
    expect(shade('#808080', 1)).toBe('rgb(255, 255, 255)');
    expect(shade('nonsense', 0.5)).toBe('nonsense');
  });

  it('names colours in plain words', () => {
    expect(colorName('#ff0000')).toBe('red');
    expect(colorName('#2244ee')).toBe('blue');
    expect(colorName('#ffd54a')).toBe('yellow');
    expect(colorName(undefined)).toBe('');
  });

  it('names objects for screen readers and numbers repeated names', () => {
    const s = scene([
      { id: 'a', type: 'emoji', emoji: '🍎', x: 1, y: 1 },
      { id: 'b', type: 'emoji', emoji: '🍎', x: 1, y: 1 },
      { id: 'c', type: 'shape', shape: 'triangle', color: '#ff0000', x: 1, y: 1 },
      { id: 'd', type: 'emoji', emoji: '🐶', label: 'Rex', x: 1, y: 1 },
      { id: 'e', type: 'text', text: 'Hello', x: 1, y: 1 },
    ]);
    expect(objectName(s.objects[2] as SceneObject)).toBe('red triangle');
    const names = accessibleNames(s.objects);
    expect(names.get('a')).toBe('🍎 1');
    expect(names.get('b')).toBe('🍎 2');
    expect(names.get('c')).toBe('red triangle');
    expect(names.get('d')).toBe('Rex');
    expect(names.get('e')).toBe('Hello');
    expect(describeScene(s)).toBe('Picture: 🍎, red triangle, Rex, Hello');
    expect(describeScene(scene([], 'ocean'))).toBe('ocean picture');
  });

  it('gives uncoloured shapes a stable default colour', () => {
    expect(defaultShapeColor('abc')).toBe(defaultShapeColor('abc'));
    expect(defaultShapeColor('abc')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('drawing', () => {
  it('traces a closed path for every shape', () => {
    for (const shape of SHAPES) {
      const fake = makeFakeContext();
      traceShape(fake.ctx, shape, 40);
      expect(fake.calls[0]).toBe('beginPath');
      expect(fake.calls).toContain('closePath');
      expect(fake.calls.length).toBeGreaterThan(2);
    }
  });

  it('paints a background for every theme without leaking canvas state', () => {
    expect(Object.keys(THEME_GRADIENTS).sort()).toEqual([...SCENE_THEMES].sort());
    for (const theme of SCENE_THEMES) {
      for (const t of [0, 1.234, 60]) {
        const fake = makeFakeContext();
        drawBackground(fake.ctx, { theme }, 400, 300, t);
        expect(fake.calls).toContain('createLinearGradient');
        expect(fake.calls).toContain('fillRect');
        expect(fake.count('save')).toBe(fake.count('restore'));
        if (theme !== 'sky') expect(fake.calls.length).toBeGreaterThan(10);
      }
    }
    expect(themeIsDark('space')).toBe(true);
    expect(themeIsDark('sky')).toBe(false);
  });

  it('survives tiny and huge stages', () => {
    for (const theme of SCENE_THEMES) {
      expect(() => drawBackground(makeFakeContext().ctx, { theme }, 1, 1, 3)).not.toThrow();
      expect(() => drawBackground(makeFakeContext().ctx, { theme, gradient: ['#000000', '#ffffff'] }, 3000, 2000, 3)).not.toThrow();
    }
  });

  function frame(s: Scene, extra: Partial<FrameInput> = {}): FrameInput {
    return {
      scene: s,
      width: 400,
      height: 300,
      t: 1.5,
      reducedMotion: false,
      highlightIds: new Set(),
      selectedIds: new Set(),
      focusedId: null,
      tapTimes: new Map(),
      images: null,
      particles: [],
      staticBurst: false,
      ...extra,
    };
  }

  it('renders every sample scene, with markers, particles and reduced motion', () => {
    for (const challenge of Object.values(SAMPLE_CHALLENGES)) {
      const ids = challenge.scene.objects.map((o) => o.id);
      for (const reducedMotion of [false, true]) {
        const fake = makeFakeContext();
        renderFrame(
          fake.ctx,
          frame(challenge.scene, {
            reducedMotion,
            highlightIds: new Set(ids.slice(0, 1)),
            selectedIds: new Set(ids.slice(1, 2)),
            focusedId: ids[2] ?? null,
            tapTimes: new Map(ids.slice(0, 1).map((id) => [id, 1.4])),
            particles: spawnCelebration(400, 300, 7, 12),
            staticBurst: reducedMotion,
          }),
        );
        expect(fake.calls).toContain('clearRect');
        expect(fake.count('save')).toBe(fake.count('restore'));
      }
    }
  });

  it('draws emoji, text and labels as text, and skips svg that has not loaded', () => {
    const s = scene([
      { id: 'e', type: 'emoji', emoji: '🍎', x: 20, y: 20, label: 'Apple' },
      { id: 't', type: 'text', text: 'Hello', x: 60, y: 20 },
      { id: 'v', type: 'svg', svg: '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>', x: 60, y: 60 },
      { id: 'hidden', type: 'emoji', emoji: '👻', x: 60, y: 80, anim: { kind: 'fade-in', loop: false, delay: 20 } },
    ]);
    const fake = makeFakeContext();
    renderFrame(fake.ctx, frame(s));
    expect(fake.texts).toEqual(expect.arrayContaining(['🍎', 'Hello', 'Apple']));
    expect(fake.texts).not.toContain('👻');
    expect(fake.calls).not.toContain('drawImage');
  });

  it('draws higher z later', () => {
    const s = scene([
      { id: 'top', type: 'emoji', emoji: 'T', x: 20, y: 20, z: 9 },
      { id: 'bottom', type: 'emoji', emoji: 'B', x: 20, y: 20, z: 0 },
    ]);
    const fake = makeFakeContext();
    renderFrame(fake.ctx, frame(s));
    expect(fake.texts).toEqual(['B', 'T']);
  });
});

describe('particles', () => {
  it('spawns the same burst for the same seed', () => {
    const a = spawnCelebration(400, 300, 5);
    expect(a).toHaveLength(90);
    expect(spawnCelebration(400, 300, 5)).toEqual(a);
    expect(spawnCelebration(400, 300, 6)).not.toEqual(a);
    expect(new Set(a.map((p) => p.shape))).toEqual(new Set(['confetti', 'star', 'dot']));
  });

  it('moves particles, pulls them down, and removes them when done', () => {
    let particles = spawnCelebration(400, 300, 5, 30);
    const before = particles[1];
    particles = stepParticles(particles, 0.016, 400, 300);
    const after = particles[1];
    expect(after?.age).toBeGreaterThan(before?.age ?? 0);
    expect(after?.vy).toBeGreaterThan(before?.vy ?? 0);
    for (let i = 0; i < 400; i += 1) particles = stepParticles(particles, 0.05, 400, 300);
    expect(particles).toHaveLength(0);
  });

  it('caps the time step so a paused tab does not teleport particles', () => {
    const [p] = spawnCelebration(400, 300, 5, 1);
    const [q] = stepParticles(p ? [p] : [], 10, 400, 300);
    expect(q?.age).toBeCloseTo(0.05);
  });

  it('draws without leaking canvas state', () => {
    const fake = makeFakeContext();
    drawParticles(fake.ctx, spawnCelebration(400, 300, 5, 20));
    drawStaticBurst(fake.ctx, 400, 300);
    expect(fake.count('save')).toBe(fake.count('restore'));
    expect(fake.count('save')).toBe(30);
  });
});
