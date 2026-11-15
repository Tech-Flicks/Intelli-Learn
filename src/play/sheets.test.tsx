import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Sheet, hasMoreBelow } from './sheets';
import './strings';

/** jsdom lays nothing out: the sizes of the sheet's scroll area are given here. */
function scrollArea(sizes: { clientHeight: number; scrollHeight: number }): () => void {
  const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-sheet-scroll') ? sizes.clientHeight : 0;
  });
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-sheet-scroll') ? sizes.scrollHeight : 0;
  });
  return () => {
    client.mockRestore();
    scroll.mockRestore();
  };
}

function show(footer?: string) {
  return render(
    <Sheet labelledBy="sheet-title" testId="a-sheet" footer={footer === undefined ? undefined : <button type="button">{footer}</button>}>
      <h2 id="sheet-title">Hooray, solved!</h2>
      <p>Why it works</p>
    </Sheet>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a sheet with more content than fits', () => {
  it('knows when there is more below', () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 108, scrollHeight: 240 })).toBe(true);
    expect(hasMoreBelow({ scrollTop: 132, clientHeight: 108, scrollHeight: 240 })).toBe(false);
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 240, scrollHeight: 240 })).toBe(false);
    // A few pixels are not worth a button.
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 236, scrollHeight: 240 })).toBe(false);
  });

  it('says so with a button that scrolls on, and takes the button away at the end', () => {
    const restore = scrollArea({ clientHeight: 108, scrollHeight: 412 });
    try {
      show('Next adventure');
      const more = screen.getByRole('button', { name: 'There is more below' });
      const area = screen.getByTestId('a-sheet').querySelector<HTMLElement>('[data-sheet-scroll]');
      expect(area).not.toBeNull();
      if (!area) return;
      const scrollBy = vi.fn();
      area.scrollBy = scrollBy;
      fireEvent.click(more);
      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(scrollBy.mock.calls[0]?.[0]).toMatchObject({ top: 80 });

      // The child reached the end: nothing more to point at.
      area.scrollTop = 304;
      fireEvent.scroll(area);
      expect(screen.queryByRole('button', { name: 'There is more below' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Next adventure' })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('shows no such button when everything is in view', () => {
    const restore = scrollArea({ clientHeight: 300, scrollHeight: 300 });
    try {
      show('Keep going');
      expect(screen.queryByRole('button', { name: 'There is more below' })).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('a sheet on a phone held sideways', () => {
  it('keeps the classes that play.css restyles for a short, wide screen', () => {
    show();
    const sheet = screen.getByTestId('a-sheet');
    expect(sheet).toHaveClass('play-sheet');
    // Without a footer the side column is still there for Pip (it is hidden on every other screen).
    const column = sheet.querySelector('.play-sheet-footer');
    expect(column).toHaveClass('play-sheet-footer-empty', 'hidden');
  });

  it('has rules that lift the half-screen cap there and put the button beside the content', () => {
    const css = readFileSync(resolve(__dirname, 'play.css'), 'utf8');
    const short = css.slice(css.indexOf('@media (max-height: 30rem)'));
    expect(short).toMatch(/\.play-sheet \{[^}]*max-height: calc\(100dvh - 4\.75rem/);
    expect(short).toMatch(/\.play-sheet \{[^}]*flex-direction: row/);
    expect(short).toMatch(/\.play-teach-options \{[^}]*grid-template-columns: 1fr 1fr/);
  });
});
