import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipGallery } from './PipGallery';
import { PIP_STATES } from './states';
import { installFrameClock, type FrameClock } from './testing';

describe('PipGallery', () => {
  let clock: FrameClock;

  beforeEach(() => {
    clock = installFrameClock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows Pip in all 20 states, each with its name', () => {
    render(<PipGallery />);
    const pips = screen.getAllByRole('button', { name: /^Pip, / });
    expect(pips).toHaveLength(20);
    expect(pips.map((pip) => pip.getAttribute('data-state'))).toEqual([...PIP_STATES]);
    for (const state of PIP_STATES) expect(screen.getByText(state)).toBeInTheDocument();
    // 20 mascots, 20 loops, and no id used twice.
    expect(clock.pending()).toBe(20);
    const ids = [...document.querySelectorAll('svg.pip-bot [id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('changes the size of every Pip', async () => {
    render(<PipGallery />);
    await userEvent.click(screen.getByRole('button', { name: 'Large' }));
    for (const pip of screen.getAllByRole('button', { name: /^Pip, / })) {
      expect(pip).toHaveStyle({ width: '240px', height: '240px' });
    }
    expect(screen.getByRole('button', { name: 'Large' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches every Pip to a still picture', async () => {
    render(<PipGallery />);
    await userEvent.click(screen.getByRole('button', { name: 'Reduced motion' }));
    expect(clock.pending()).toBe(0);
    for (const pip of screen.getAllByRole('button', { name: /^Pip, / })) expect(pip).toHaveClass('pip-still');
  });

  it('lets a tapped Pip giggle for a moment', () => {
    vi.useFakeTimers();
    render(<PipGallery />);
    const idle = screen.getByRole('button', { name: 'Pip, idle' });
    act(() => idle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(idle).toHaveAttribute('data-state', 'giggle');
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(idle).toHaveAttribute('data-state', 'idle');
    // The others did not react.
    const options = within(screen.getByRole('group', { name: 'Gallery options' }));
    expect(options.getAllByRole('button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Pip, happy' })).toHaveAttribute('data-state', 'happy');
  });
});
