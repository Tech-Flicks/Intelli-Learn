import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipEngine, type PipEngineInput } from './engine';
import { PipArt, makePipArtIds } from './PipArt';
import { ARM_POSE_TABLE, restingArms } from './poses';
import type { PipState } from './states';
import { installFrameClock, parseHand, setPageHidden, type FrameClock } from './testing';

const IDS = makePipArtIds('test');

function mountArt(initialState: PipState = 'idle'): SVGSVGElement {
  const { container } = render(
    <svg className="pip-bot" viewBox="0 0 380 380">
      <PipArt ids={IDS} initialState={initialState} />
    </svg>,
  );
  return container.querySelector('svg') as SVGSVGElement;
}

function input(overrides: Partial<PipEngineInput> = {}): PipEngineInput {
  return { state: 'idle', speaking: false, mouthLevel: null, lookAt: null, still: false, ...overrides };
}

function part(svg: SVGSVGElement, name: string): SVGElement {
  const element = svg.querySelector<SVGElement>(`.pip-${name}`);
  if (!element) throw new Error(`no .pip-${name}`);
  return element;
}

function mouth(svg: SVGSVGElement): number {
  return Number(svg.style.getPropertyValue('--mouth-open'));
}

describe('PipEngine', () => {
  let clock: FrameClock;
  let engine: PipEngine | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = installFrameClock();
  });

  afterEach(() => {
    engine?.destroy();
    engine = null;
    setPageHidden(false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('the loop', () => {
    it('runs one frame after another while Pip is on a visible page', () => {
      engine = new PipEngine(mountArt(), input());
      expect(engine.isRunning()).toBe(true);
      expect(clock.pending()).toBe(1);
      clock.run(5);
      expect(clock.pending()).toBe(1);
      expect(clock.requested()).toBe(6);
    });

    it('stops while the page is hidden and starts again when it shows', () => {
      engine = new PipEngine(mountArt(), input());
      setPageHidden(true);
      expect(engine.isRunning()).toBe(false);
      expect(clock.pending()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      setPageHidden(false);
      expect(engine.isRunning()).toBe(true);
      expect(clock.pending()).toBe(1);
    });

    it('stops while Pip is scrolled out of view', () => {
      let report: IntersectionObserverCallback = () => {};
      const observe = vi.fn();
      const disconnect = vi.fn();
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: IntersectionObserverCallback) {
            report = callback;
          }
          observe = observe;
          disconnect = disconnect;
        },
      );
      const svg = mountArt();
      engine = new PipEngine(svg, input());
      expect(observe).toHaveBeenCalledWith(svg);

      const entry = (isIntersecting: boolean) => [{ isIntersecting } as IntersectionObserverEntry];
      report(entry(false), {} as IntersectionObserver);
      expect(engine.isRunning()).toBe(false);
      expect(clock.pending()).toBe(0);
      report(entry(true), {} as IntersectionObserver);
      expect(engine.isRunning()).toBe(true);

      engine.destroy();
      expect(disconnect).toHaveBeenCalled();
    });

    it('leaves nothing behind after destroy: no frame, no timer, no listener', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input({ lookAt: 'pointer' }));
      clock.run(3);
      engine.pop();
      engine.destroy();
      expect(clock.pending()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(svg.hasAttribute('data-pop')).toBe(false);
      const requested = clock.requested();
      setPageHidden(false);
      engine.update(input({ state: 'happy' }));
      expect(clock.requested()).toBe(requested);
    });
  });

  describe('arms', () => {
    it('moves both arms to the pose of a new state and sways around it', () => {
      const svg = mountArt('idle');
      engine = new PipEngine(svg, input({ state: 'idle' }));
      engine.update(input({ state: 'celebrating' }));
      clock.run(1);
      const first = parseHand(part(svg, 'hand-left-group').getAttribute('transform'));
      // One frame is a step on the way, not a jump.
      expect(first.y).toBeLessThan(ARM_POSE_TABLE.idle.left.wy + 6);
      expect(first.y).toBeGreaterThan(ARM_POSE_TABLE.celebrating.left.wy + 20);

      clock.run(120);
      for (const side of ['left', 'right'] as const) {
        const pose = ARM_POSE_TABLE.celebrating[side];
        const hand = parseHand(part(svg, `hand-${side}-group`).getAttribute('transform'));
        expect(Math.abs(hand.x - pose.wx)).toBeLessThanOrEqual(Math.abs(pose.bobX) + 1.5);
        expect(Math.abs(hand.y - pose.wy)).toBeLessThanOrEqual(pose.bobY + 1.5);
        expect(Math.abs(hand.angle - pose.angle)).toBeLessThanOrEqual(pose.rotAmp + 2);
      }

      const before = part(svg, 'hand-left-group').getAttribute('transform');
      clock.run(10);
      expect(part(svg, 'hand-left-group').getAttribute('transform')).not.toBe(before);
    });

    it('draws the tube, its outline and its shine as one curve that ends at the wrist', () => {
      const svg = mountArt('idle');
      engine = new PipEngine(svg, input({ state: 'happy' }));
      clock.run(30);
      const tube = part(svg, 'arm-left-fill').getAttribute('d');
      expect(tube).toMatch(/^M 126 232 Q /);
      expect(part(svg, 'arm-left-outline').getAttribute('d')).toBe(tube);
      expect(part(svg, 'arm-left-shine').getAttribute('d')).toBe(tube);
      const hand = parseHand(part(svg, 'hand-left-group').getAttribute('transform'));
      expect(tube?.endsWith(` ${hand.x.toFixed(1)} ${hand.y.toFixed(1)}`)).toBe(true);
      expect(part(svg, 'arm-left-band1').getAttribute('d')).toMatch(/^M .* Q .*/);
    });

    it('shows the hand style of the state: open fingers or a curled fist', () => {
      const svg = mountArt('idle');
      engine = new PipEngine(svg, input({ state: 'idle' }));
      clock.run(1);
      expect(part(svg, 'hand-left-open').hasAttribute('display')).toBe(false);
      expect(part(svg, 'hand-left-curled').getAttribute('display')).toBe('none');

      engine.update(input({ state: 'giggle' }));
      clock.run(1);
      expect(part(svg, 'hand-left-open').getAttribute('display')).toBe('none');
      expect(part(svg, 'hand-left-curled').hasAttribute('display')).toBe(false);
      // The other hand of a giggle stays open.
      expect(part(svg, 'hand-right-open').hasAttribute('display')).toBe(false);
    });

    it('moves the same distance in the same time on a 120 Hz screen', () => {
      const slowSvg = mountArt('idle');
      const slow = new PipEngine(slowSvg, input({ state: 'idle' }));
      slow.update(input({ state: 'sad' }));
      clock.run(30, 1000 / 60);
      const at60 = parseHand(part(slowSvg, 'hand-left-group').getAttribute('transform'));
      slow.destroy();

      vi.unstubAllGlobals();
      clock = installFrameClock();
      const fastSvg = mountArt('idle');
      engine = new PipEngine(fastSvg, input({ state: 'idle' }));
      engine.update(input({ state: 'sad' }));
      clock.run(60, 1000 / 120);
      const at120 = parseHand(part(fastSvg, 'hand-left-group').getAttribute('transform'));
      expect(Math.abs(at120.x - at60.x)).toBeLessThan(1.5);
      expect(Math.abs(at120.y - at60.y)).toBeLessThan(1.5);
    });
  });

  describe('mouth', () => {
    it('opens and closes with a rhythm while Pip speaks', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input({ state: 'talking', speaking: true }), { random: () => 0.5 });
      const levels: number[] = [];
      for (let i = 0; i < 180; i += 1) {
        clock.run(1);
        levels.push(mouth(svg));
      }
      expect(svg.hasAttribute('data-speaking')).toBe(true);
      expect(Math.max(...levels)).toBeGreaterThan(0.5);
      expect(Math.min(...levels.slice(10))).toBeLessThan(0.2);
      expect(levels.every((level) => level >= 0 && level <= 1)).toBe(true);
    });

    it('closes the mouth smoothly when Pip stops, then gives the state its own mouth back', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input({ state: 'happy', speaking: false, mouthLevel: 0.9 }));
      clock.run(30);
      expect(mouth(svg)).toBeGreaterThan(0.85);

      engine.update(input({ state: 'happy', speaking: false, mouthLevel: null }));
      clock.run(1);
      const justAfter = mouth(svg);
      expect(justAfter).toBeLessThan(0.9);
      expect(justAfter).toBeGreaterThan(0.5);
      expect(svg.hasAttribute('data-speaking')).toBe(true);
      clock.run(3);
      expect(mouth(svg)).toBeLessThan(justAfter);
      expect(mouth(svg)).toBeGreaterThan(0);

      clock.run(40);
      expect(mouth(svg)).toBe(0);
      expect(svg.hasAttribute('data-speaking')).toBe(false);
    });

    it('follows the level the caller gives instead of the rhythm', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input({ state: 'talking', speaking: true, mouthLevel: 0.25 }));
      clock.run(40);
      expect(mouth(svg)).toBeCloseTo(0.25, 2);
      engine.update(input({ state: 'talking', speaking: true, mouthLevel: 1 }));
      clock.run(40);
      expect(mouth(svg)).toBeCloseTo(1, 2);
    });

    it('lifts the hands with the voice while talking', () => {
      const quietSvg = mountArt('talking');
      const quiet = new PipEngine(quietSvg, input({ state: 'talking', speaking: false }));
      clock.run(90);
      const quietHand = parseHand(part(quietSvg, 'hand-left-group').getAttribute('transform'));
      quiet.destroy();

      vi.unstubAllGlobals();
      clock = installFrameClock();
      const loudSvg = mountArt('talking');
      engine = new PipEngine(loudSvg, input({ state: 'talking', speaking: true, mouthLevel: 1 }));
      clock.run(90);
      const loudHand = parseHand(part(loudSvg, 'hand-left-group').getAttribute('transform'));
      expect(loudHand.y).toBeLessThan(quietHand.y - 5);
    });
  });

  describe('eyes', () => {
    function place(svg: SVGSVGElement): void {
      // A 200 px mascot whose face is at (500, 372) in a 1024 x 768 window.
      svg.getBoundingClientRect = () => ({ left: 400, top: 300, width: 200, height: 200, right: 600, bottom: 500, x: 400, y: 300, toJSON: () => ({}) });
    }

    it('looks straight ahead without a target', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input());
      clock.run(2);
      expect(svg.style.getPropertyValue('--gaze-x')).toBe('0.00px');
      expect(svg.style.getPropertyValue('--gaze-y')).toBe('0.00px');
    });

    it('looks at a point, as far as the eyes can turn', () => {
      const svg = mountArt();
      place(svg);
      engine = new PipEngine(svg, input({ lookAt: { x: 500, y: 372 } }));
      clock.run(2);
      expect(svg.style.getPropertyValue('--gaze-x')).toBe('0.00px');
      expect(svg.style.getPropertyValue('--gaze-y')).toBe('0.00px');

      engine.update(input({ lookAt: { x: 5000, y: -5000 } }));
      clock.run(2);
      expect(svg.style.getPropertyValue('--gaze-x')).toBe('4.20px');
      expect(svg.style.getPropertyValue('--gaze-y')).toBe('-4.20px');
    });

    it('follows the pointer, and stops listening when it no longer has to', () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const svg = mountArt();
      place(svg);
      engine = new PipEngine(svg, input({ lookAt: 'pointer' }));
      expect(add.mock.calls.some(([type]) => (type as string) === 'pointermove')).toBe(true);

      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500 - 1024 * 0.45 * 0.5, clientY: 372 }));
      clock.run(2);
      expect(svg.style.getPropertyValue('--gaze-x')).toBe('-2.10px');
      expect(svg.style.getPropertyValue('--gaze-y')).toBe('0.00px');

      engine.update(input({ lookAt: null }));
      expect(remove.mock.calls.some(([type]) => (type as string) === 'pointermove')).toBe(true);
      clock.run(2);
      expect(svg.style.getPropertyValue('--gaze-x')).toBe('0.00px');
      add.mockRestore();
      remove.mockRestore();
    });
  });

  describe('blinking', () => {
    it('blinks after a random wait, for a moment, again and again', () => {
      const svg = mountArt();
      // 0.5 gives a wait of 2400 + 1400 ms and no double blink.
      engine = new PipEngine(svg, input(), { random: () => 0.5 });
      vi.advanceTimersByTime(3799);
      expect(svg.hasAttribute('data-blink')).toBe(false);
      vi.advanceTimersByTime(1);
      expect(svg.hasAttribute('data-blink')).toBe(true);
      vi.advanceTimersByTime(140);
      expect(svg.hasAttribute('data-blink')).toBe(false);
      vi.advanceTimersByTime(3800);
      expect(svg.hasAttribute('data-blink')).toBe(true);
    });

    it('sometimes blinks twice in a row', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input(), { random: () => 0 });
      vi.advanceTimersByTime(2400);
      expect(svg.hasAttribute('data-blink')).toBe(true);
      vi.advanceTimersByTime(140);
      expect(svg.hasAttribute('data-blink')).toBe(false);
      vi.advanceTimersByTime(230);
      expect(svg.hasAttribute('data-blink')).toBe(true);
      vi.advanceTimersByTime(140);
      expect(svg.hasAttribute('data-blink')).toBe(false);
    });

    it('does not leave the eyes shut when the page is hidden in the middle of a blink', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input(), { random: () => 0.5 });
      vi.advanceTimersByTime(3800);
      expect(svg.hasAttribute('data-blink')).toBe(true);
      setPageHidden(true);
      expect(svg.hasAttribute('data-blink')).toBe(false);
    });
  });

  describe('a tap', () => {
    it('bounces once', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input());
      engine.pop();
      expect(svg.hasAttribute('data-pop')).toBe(true);
      vi.advanceTimersByTime(480);
      // The attribute goes away, or the bounce would hide the state's own animation for good.
      expect(svg.hasAttribute('data-pop')).toBe(false);
    });
  });

  describe('reduced motion', () => {
    it('asks for no frame and sets no timer', () => {
      engine = new PipEngine(mountArt(), input({ still: true, lookAt: 'pointer' }));
      expect(engine.isRunning()).toBe(false);
      expect(clock.requested()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      engine.pop();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('puts the arms straight into the resting pose of each state', () => {
      const svg = mountArt('idle');
      engine = new PipEngine(svg, input({ still: true, state: 'idle' }));
      engine.update(input({ still: true, state: 'reading' }));
      const resting = restingArms('reading');
      expect(part(svg, 'hand-left-group').getAttribute('transform')).toBe(resting.left.hand);
      expect(part(svg, 'hand-right-group').getAttribute('transform')).toBe(resting.right.hand);
      expect(part(svg, 'arm-right-fill').getAttribute('d')).toBe(resting.right.tube);
      expect(part(svg, 'arm-right-band2').getAttribute('d')).toBe(resting.right.band2);
      expect(part(svg, 'hand-left-curled').hasAttribute('display')).toBe(false);
      expect(part(svg, 'hand-left-open').getAttribute('display')).toBe('none');
      expect(clock.requested()).toBe(0);
    });

    it('shows a calm, half-open mouth while Pip speaks, and the given level when there is one', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input({ still: true, state: 'teaching', speaking: true }));
      expect(mouth(svg)).toBeCloseTo(0.45);
      expect(svg.hasAttribute('data-speaking')).toBe(true);
      engine.update(input({ still: true, state: 'teaching', speaking: true, mouthLevel: 0.8 }));
      expect(mouth(svg)).toBeCloseTo(0.8);
      engine.update(input({ still: true, state: 'teaching', speaking: false }));
      expect(mouth(svg)).toBe(0);
      expect(svg.hasAttribute('data-speaking')).toBe(false);
    });

    it('stops a running loop when reduced motion is switched on, and starts it when switched off', () => {
      const svg = mountArt();
      engine = new PipEngine(svg, input({ state: 'happy' }));
      clock.run(20);
      engine.update(input({ state: 'happy', still: true }));
      expect(clock.pending()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(part(svg, 'hand-left-group').getAttribute('transform')).toBe(restingArms('happy').left.hand);
      engine.update(input({ state: 'happy', still: false }));
      expect(clock.pending()).toBe(1);
    });
  });
});
