import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACCESSIBILITY } from '@/core/defaults';
import { setLocale } from '@/i18n';
import { applyAccessibility } from '@/ui';
import { Pip } from './Pip';
import { restingArms } from './poses';
import { PIP_STATES } from './states';
import { installFrameClock, type FrameClock } from './testing';

function hand(svg: Element, side: 'left' | 'right'): string | null {
  return svg.querySelector(`.pip-hand-${side}-group`)?.getAttribute('transform') ?? null;
}

describe('Pip', () => {
  let clock: FrameClock;

  beforeEach(() => {
    clock = installFrameClock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    applyAccessibility(null);
    setLocale('en');
  });

  describe('the picture', () => {
    it('is one image with a name', () => {
      render(<Pip />);
      const pip = screen.getByRole('img', { name: 'Pip the helper robot' });
      expect(pip.tagName.toLowerCase()).toBe('svg');
      expect(pip).toHaveAttribute('viewBox', '0 0 380 380');
      expect(pip).toHaveClass('pip-bot');
      expect(pip).not.toHaveAttribute('tabindex');
      // The shapes and letters inside are not read out one by one.
      expect(pip.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    });

    it('takes another name, and translates its own', () => {
      const { unmount } = render(<Pip ariaLabel="Your helper is thinking" />);
      expect(screen.getByRole('img', { name: 'Your helper is thinking' })).toBeInTheDocument();
      unmount();
      render(<Pip />);
      act(() => setLocale('es'));
      expect(screen.getByRole('img', { name: 'Pip, el robot ayudante' })).toBeInTheDocument();
      act(() => setLocale('hi'));
      expect(screen.getByRole('img', { name: 'पिप, मददगार रोबोट' })).toBeInTheDocument();
    });

    it('is idle by default', () => {
      render(<Pip />);
      expect(screen.getByRole('img')).toHaveAttribute('data-state', 'idle');
    });

    it.each(PIP_STATES)('shows the state "%s"', (state) => {
      render(<Pip state={state} />);
      const pip = screen.getByRole('img');
      expect(pip).toHaveAttribute('data-state', state);
      // The arms are drawn in the resting pose of the state before the first frame.
      const resting = restingArms(state);
      expect(hand(pip, 'left')).toBe(resting.left.hand);
      expect(hand(pip, 'right')).toBe(resting.right.hand);
      expect(pip.querySelector('.pip-arm-left-fill')).toHaveAttribute('d', resting.left.tube);
      const shown = pip.querySelector(`.pip-hand-left-${resting.left.style}`);
      const hidden = pip.querySelector(`.pip-hand-left-${resting.left.style === 'open' ? 'curled' : 'open'}`);
      expect(shown).not.toHaveAttribute('display');
      expect(hidden).toHaveAttribute('display', 'none');
    });

    it('changes state without drawing the artwork again', () => {
      const { rerender } = render(<Pip state="idle" />);
      const pip = screen.getByRole('img');
      const head = pip.querySelector('.pip-head-group');
      rerender(<Pip state="celebrating" />);
      expect(screen.getByRole('img')).toBe(pip);
      expect(pip).toHaveAttribute('data-state', 'celebrating');
      expect(pip.querySelector('.pip-head-group')).toBe(head);
    });

    it('has every part of the design: layers in order, eyes, mouths and props', () => {
      render(<Pip />);
      const pip = screen.getByRole('img');
      const whole = pip.querySelector('.pip-bot-whole');
      // Body, head, foreground props, then the arms on top.
      expect([...(whole?.children ?? [])].map((child) => child.getAttribute('class'))).toEqual([
        'pip-body-group',
        'pip-head-group',
        'pip-fg-props-layer',
        'pip-arms-kinematic-layer',
      ]);
      // Background props are behind the character.
      const layers = [...(pip.firstElementChild?.children ?? [])].map((child) => child.getAttribute('class'));
      expect(layers.indexOf('pip-bg-props-layer')).toBeLessThan(layers.indexOf('pip-bot-whole'));
      expect(pip.querySelectorAll('.pip-eye-layer')).toHaveLength(7);
      expect(pip.querySelectorAll('.pip-mouth-layer')).toHaveLength(9);
      for (const prop of [
        'chalkboard',
        'pillow',
        'magic-aura',
        'celebrate-fx',
        'music-notes',
        'hearts-stars',
        'giggle-fx',
        'raincloud',
        'steam',
        'tired-fx',
        'waiting-fx',
        'scared-fx',
        'listen-waves',
        'talk-waves',
        'think-bubbles',
        'curious-q',
        'glasses',
        'wizard-hat',
        'waiting-desk',
        'book',
        'magnifying-glass',
        'pointer',
        'microphone',
      ]) {
        expect(pip.querySelector(`.pip-prop-${prop}.pip-bot-prop`), prop).not.toBeNull();
      }
      expect(pip.querySelector('.pip-chest-gear')).not.toBeNull();
      expect(pip.querySelector('.pip-antenna-group')).not.toBeNull();
      expect(pip.querySelector('.pip-bot-shadow')).not.toBeNull();
      // Things held in a hand move with that hand.
      expect(pip.querySelector('.pip-hand-left-group .pip-prop-magnifying-glass')).not.toBeNull();
      expect(pip.querySelector('.pip-hand-right-group .pip-prop-pointer')).not.toBeNull();
      expect(pip.querySelector('.pip-hand-right-group .pip-prop-microphone')).not.toBeNull();
    });

    it('loads nothing from outside: no links, images, scripts or web fonts', () => {
      render(<Pip state="teaching" />);
      const pip = screen.getByRole('img');
      expect(pip.querySelectorAll('image, use, a, script, style, foreignObject')).toHaveLength(0);
      const markup = pip.outerHTML;
      expect(markup).not.toMatch(/https?:|\/\/fonts|font-family/i);
      expect(markup).not.toContain('pip-bot-svg');
    });
  });

  describe('several on one page', () => {
    it('gives each one its own gradient and clip ids, and uses only its own', () => {
      render(
        <>
          <Pip ariaLabel="one" />
          <Pip ariaLabel="two" state="angry" />
          <Pip ariaLabel="three" state="storytelling" />
        </>,
      );
      const pips = ['one', 'two', 'three'].map((name) => screen.getByRole('img', { name }));
      const idSets = pips.map((pip) => [...pip.querySelectorAll('[id]')].map((element) => element.id));
      for (const ids of idSets) {
        expect(ids).toHaveLength(8);
        for (const id of ids) expect(id).toMatch(/^pip-[A-Za-z0-9_-]+$/);
      }
      const all = idSets.flat();
      expect(new Set(all).size).toBe(all.length);
      expect(document.querySelectorAll('[id]')).toHaveLength(all.length);

      pips.forEach((pip, index) => {
        const own = new Set(idSets[index]);
        const references = [...pip.outerHTML.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
        expect(references.length).toBeGreaterThan(20);
        for (const reference of references) expect(own.has(reference ?? ''), reference).toBe(true);
      });
    });
  });

  describe('size', () => {
    it('sets width and height from a number of pixels or any CSS length', () => {
      const { rerender } = render(<Pip size={120} />);
      const pip = screen.getByRole('img');
      expect(pip).toHaveStyle({ width: '120px', height: '120px' });
      rerender(<Pip size="6rem" />);
      expect(pip.style.width).toBe('6rem');
      expect(pip.style.height).toBe('6rem');
    });

    it('leaves the size to the stylesheet or the class when none is given', () => {
      render(<Pip className="h-24 w-24" />);
      const pip = screen.getByRole('img');
      expect(pip).toHaveClass('pip-bot', 'h-24', 'w-24');
      expect(pip.style.width).toBe('');
    });
  });

  describe('as a button', () => {
    it('reacts to a click or tap', async () => {
      const onTap = vi.fn();
      render(<Pip onTap={onTap} />);
      const pip = screen.getByRole('button', { name: 'Pip the helper robot' });
      expect(pip).toHaveAttribute('tabindex', '0');
      expect(pip).toHaveClass('pip-tappable');
      await userEvent.click(pip);
      expect(onTap).toHaveBeenCalledTimes(1);
      // The squash-and-stretch bounce of the design.
      expect(pip).toHaveAttribute('data-pop');
    });

    it('reacts to a click on any part of the drawing', async () => {
      const onTap = vi.fn();
      render(<Pip onTap={onTap} />);
      const star = screen.getByRole('button').querySelector('.pip-antenna-group polygon') as Element;
      await userEvent.click(star);
      expect(onTap).toHaveBeenCalledTimes(1);
    });

    it('reacts to Enter and Space, can be reached with Tab, and does not scroll the page', async () => {
      const onTap = vi.fn();
      render(<Pip onTap={onTap} />);
      const pip = screen.getByRole('button');
      await userEvent.tab();
      expect(pip).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      expect(onTap).toHaveBeenCalledTimes(1);
      await userEvent.keyboard(' ');
      expect(onTap).toHaveBeenCalledTimes(2);

      const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      act(() => {
        pip.dispatchEvent(space);
      });
      expect(space.defaultPrevented).toBe(true);
      expect(onTap).toHaveBeenCalledTimes(3);
    });

    it('ignores other keys and a key that is held down', () => {
      const onTap = vi.fn();
      render(<Pip onTap={onTap} />);
      const pip = screen.getByRole('button');
      fireEvent.keyDown(pip, { key: 'a' });
      fireEvent.keyDown(pip, { key: 'Enter', repeat: true });
      expect(onTap).not.toHaveBeenCalled();
    });

    it('is not a button without onTap', async () => {
      render(<Pip />);
      expect(screen.queryByRole('button')).toBeNull();
      const pip = screen.getByRole('img');
      await userEvent.click(pip);
      expect(pip).not.toHaveAttribute('data-pop');
      expect(pip).not.toHaveClass('pip-tappable');
    });
  });

  describe('motion', () => {
    it('animates in one frame loop, without rendering the component again', () => {
      let renders = 0;
      function Counted() {
        renders += 1;
        return <Pip state="happy" />;
      }
      render(<Counted />);
      const pip = screen.getByRole('img');
      expect(clock.pending()).toBe(1);
      const before = hand(pip, 'left');
      clock.run(30);
      expect(hand(pip, 'left')).not.toBe(before);
      expect(clock.pending()).toBe(1);
      expect(renders).toBe(1);
    });

    it('moves the arms to the pose of a new state', () => {
      const { rerender } = render(<Pip state="idle" />);
      const pip = screen.getByRole('img');
      clock.run(5);
      rerender(<Pip state="sad" />);
      clock.run(150);
      const y = Number(/translate\([-\d.]+, ([-\d.]+)\)/.exec(hand(pip, 'left') ?? '')?.[1]);
      expect(Math.abs(y - 284)).toBeLessThan(4);
    });

    it('stops the loop when it is taken off the page', () => {
      const { unmount } = render(<Pip />);
      clock.run(3);
      expect(clock.pending()).toBe(1);
      unmount();
      expect(clock.pending()).toBe(0);
      const requested = clock.requested();
      clock.run(3);
      expect(clock.requested()).toBe(requested);
    });

    it('runs exactly one loop under StrictMode', () => {
      render(
        <StrictMode>
          <Pip />
        </StrictMode>,
      );
      expect(clock.pending()).toBe(1);
      clock.run(4);
      expect(clock.pending()).toBe(1);
    });
  });

  describe('talking', () => {
    it('moves the mouth by itself in the talking state', () => {
      render(<Pip state="talking" />);
      const pip = screen.getByRole('img') as unknown as SVGSVGElement;
      let widest = 0;
      for (let i = 0; i < 120; i += 1) {
        clock.run(1);
        widest = Math.max(widest, Number(pip.style.getPropertyValue('--mouth-open')));
      }
      expect(widest).toBeGreaterThan(0.4);
      expect(pip).toHaveAttribute('data-speaking');
    });

    it('keeps the mouth shut in the talking state when told that nobody speaks', () => {
      render(<Pip state="talking" talking={false} />);
      const pip = screen.getByRole('img') as unknown as SVGSVGElement;
      clock.run(60);
      expect(Number(pip.style.getPropertyValue('--mouth-open'))).toBe(0);
    });

    it('talks in any state, and becomes "talking" when no state is given', () => {
      const { rerender } = render(<Pip state="teaching" talking />);
      const pip = screen.getByRole('img') as unknown as SVGSVGElement;
      clock.run(60);
      expect(pip).toHaveAttribute('data-state', 'teaching');
      expect(pip).toHaveAttribute('data-speaking');

      rerender(<Pip talking />);
      expect(pip).toHaveAttribute('data-state', 'talking');
      rerender(<Pip />);
      expect(pip).toHaveAttribute('data-state', 'idle');
    });

    it('closes the mouth after talking stops', () => {
      const { rerender } = render(<Pip state="happy" talking />);
      const pip = screen.getByRole('img') as unknown as SVGSVGElement;
      clock.run(40);
      rerender(<Pip state="happy" talking={false} />);
      clock.run(60);
      expect(Number(pip.style.getPropertyValue('--mouth-open'))).toBe(0);
      expect(pip).not.toHaveAttribute('data-speaking');
    });

    it('lets mouthLevel decide, clamped to 0..1', () => {
      const { rerender } = render(<Pip state="talking" mouthLevel={0.6} />);
      const pip = screen.getByRole('img') as unknown as SVGSVGElement;
      clock.run(40);
      expect(Number(pip.style.getPropertyValue('--mouth-open'))).toBeCloseTo(0.6, 2);
      rerender(<Pip state="talking" mouthLevel={7} />);
      clock.run(40);
      expect(Number(pip.style.getPropertyValue('--mouth-open'))).toBeCloseTo(1, 2);
      rerender(<Pip state="talking" mouthLevel={-3} />);
      clock.run(60);
      expect(Number(pip.style.getPropertyValue('--mouth-open'))).toBe(0);
    });
  });

  describe('reduced motion', () => {
    it('starts no animation frame and no timer', () => {
      vi.useFakeTimers();
      try {
        render(<Pip state="celebrating" reducedMotion talking lookAt="pointer" onTap={() => {}} />);
        const pip = screen.getByRole('button');
        expect(clock.requested()).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(pip).toHaveClass('pip-still');
        fireEvent.click(pip);
        expect(pip).not.toHaveAttribute('data-pop');
        expect(clock.requested()).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows each state as a still picture with the arms in the resting pose', () => {
      const { rerender } = render(<Pip state="idle" reducedMotion />);
      const pip = screen.getByRole('img');
      for (const state of PIP_STATES) {
        rerender(<Pip state={state} reducedMotion />);
        const resting = restingArms(state);
        expect(pip).toHaveAttribute('data-state', state);
        expect(hand(pip, 'left')).toBe(resting.left.hand);
        expect(hand(pip, 'right')).toBe(resting.right.hand);
        expect(pip.querySelector('.pip-arm-right-outline')).toHaveAttribute('d', resting.right.tube);
        expect(pip.querySelector(`.pip-hand-right-${resting.right.style}`)).not.toHaveAttribute('display');
      }
      expect(clock.requested()).toBe(0);
    });

    it('follows calm mode by default, also when it is switched on later', () => {
      render(<Pip />);
      const pip = screen.getByRole('img');
      expect(pip).not.toHaveClass('pip-still');
      expect(clock.pending()).toBe(1);
      act(() => applyAccessibility({ ...DEFAULT_ACCESSIBILITY, reducedMotion: true }));
      expect(pip).toHaveClass('pip-still');
      expect(clock.pending()).toBe(0);
      act(() => applyAccessibility(null));
      expect(pip).not.toHaveClass('pip-still');
      expect(clock.pending()).toBe(1);
    });

    it('can be told to move although calm mode is on', () => {
      act(() => applyAccessibility({ ...DEFAULT_ACCESSIBILITY, reducedMotion: true }));
      render(<Pip reducedMotion={false} />);
      expect(screen.getByRole('img')).not.toHaveClass('pip-still');
      expect(clock.pending()).toBe(1);
    });
  });
});
