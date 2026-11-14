import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SceneSchema, type Scene } from '@/core/schemas';
import { makeFakeContext, type FakeContext } from '../testing/fakeCanvas';
import { SceneCanvas } from './SceneCanvas';

const SCENE: Scene = SceneSchema.parse({
  theme: 'farm',
  objects: [
    { id: 'apple1', type: 'emoji', emoji: '🍎', x: 25, y: 50, size: 12, tappable: true },
    { id: 'apple2', type: 'emoji', emoji: '🍎', x: 75, y: 50, size: 12, tappable: true },
    { id: 'tri', type: 'shape', shape: 'triangle', color: '#ff0000', x: 50, y: 20, size: 12, tappable: true },
    { id: 'sun', type: 'emoji', emoji: '☀️', x: 90, y: 10, size: 10 },
  ],
});

let fake: FakeContext | null = null;

function useContext(kind: 'none' | 'fake'): void {
  fake = kind === 'fake' ? makeFakeContext() : null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => (fake ? fake.ctx : null) as unknown as ReturnType<HTMLCanvasElement['getContext']>,
  );
}

function frames(): number {
  return fake ? fake.count('clearRect') : 0;
}

beforeEach(() => {
  useContext('none');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SceneCanvas without a pointer', () => {
  it('is an image with a description when nothing can be tapped', () => {
    render(<SceneCanvas scene={SCENE} />);
    const image = screen.getByRole('img');
    expect(image).toHaveAccessibleName('farm picture: 🍎, red triangle, ☀️');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('uses the given aria label', () => {
    render(<SceneCanvas scene={SCENE} ariaLabel="Two apples on a farm" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Two apples on a farm');
  });

  it('does not crash when the canvas has no 2D context', () => {
    expect(() => render(<SceneCanvas scene={SCENE} celebrate={1} highlightIds={['sun']} />)).not.toThrow();
  });

  it('does not crash when getContext throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('not implemented');
    });
    expect(() => render(<SceneCanvas scene={SCENE} />)).not.toThrow();
  });

  it('offers a button per tappable object, named and numbered', () => {
    render(<SceneCanvas scene={SCENE} onTapObject={() => undefined} selectedIds={['apple2']} />);
    expect(screen.getByRole('group')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['🍎 1', '🍎 2', 'red triangle']);
    expect(screen.getByRole('button', { name: '🍎 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '🍎 2' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('taps with the keyboard', async () => {
    const onTap = vi.fn();
    const user = userEvent.setup();
    render(<SceneCanvas scene={SCENE} onTapObject={onTap} />);
    await user.tab();
    expect(screen.getByRole('button', { name: '🍎 1' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(onTap.mock.calls.map((c) => c[0])).toEqual(['apple1', 'apple2']);
  });

  it('taps through a screen-reader style click on the button', () => {
    const onTap = vi.fn();
    render(<SceneCanvas scene={SCENE} onTapObject={onTap} />);
    fireEvent.click(screen.getByRole('button', { name: 'red triangle' }));
    expect(onTap).toHaveBeenCalledWith('tri');
  });
});

describe('SceneCanvas pointer taps', () => {
  function setup(onTap = vi.fn()): { canvas: HTMLCanvasElement; onTap: ReturnType<typeof vi.fn> } {
    const { container } = render(<SceneCanvas scene={SCENE} onTapObject={onTap} reducedMotion />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 400,
      height: 300,
      right: 410,
      bottom: 320,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    return { canvas, onTap };
  }

  it('finds the object under the pointer', () => {
    const { canvas, onTap } = setup();
    fireEvent.click(canvas, { clientX: 10 + 100, clientY: 20 + 150 });
    expect(onTap).toHaveBeenLastCalledWith('apple1');
    fireEvent.click(canvas, { clientX: 10 + 300, clientY: 20 + 150 });
    expect(onTap).toHaveBeenLastCalledWith('apple2');
  });

  it('forgives a near miss but ignores empty space and decorations', () => {
    const { canvas, onTap } = setup();
    fireEvent.click(canvas, { clientX: 10 + 100 + 26, clientY: 20 + 150 });
    expect(onTap).toHaveBeenLastCalledWith('apple1');
    onTap.mockClear();
    fireEvent.click(canvas, { clientX: 10 + 200, clientY: 20 + 250 });
    fireEvent.click(canvas, { clientX: 10 + 360, clientY: 20 + 30 }); // the sun is not tappable
    expect(onTap).not.toHaveBeenCalled();
  });

  it('ignores clicks when it is only a picture', () => {
    const { container } = render(<SceneCanvas scene={SCENE} />);
    expect(() => fireEvent.click(container.querySelector('canvas') as HTMLCanvasElement, { clientX: 5, clientY: 5 })).not.toThrow();
  });
});

describe('SceneCanvas drawing', () => {
  beforeEach(() => {
    useContext('fake');
  });

  it('keeps drawing frames while animating', async () => {
    render(<SceneCanvas scene={SCENE} />);
    await waitFor(() => expect(frames()).toBeGreaterThanOrEqual(3));
    expect(fake?.texts).toContain('🍎');
  });

  it('draws one still frame under reduced motion, and one more when something changes', async () => {
    const { rerender } = render(<SceneCanvas scene={SCENE} reducedMotion />);
    await waitFor(() => expect(frames()).toBe(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(frames()).toBe(1);
    rerender(<SceneCanvas scene={SCENE} reducedMotion selectedIds={['apple1']} />);
    await waitFor(() => expect(frames()).toBe(2));
  });

  it('shows a still star burst for a celebration under reduced motion, but not on first render', async () => {
    const { rerender } = render(<SceneCanvas scene={SCENE} reducedMotion celebrate={0} />);
    await waitFor(() => expect(frames()).toBe(1));
    const strokesBefore = fake?.count('stroke') ?? 0;
    rerender(<SceneCanvas scene={SCENE} reducedMotion celebrate={1} />);
    await waitFor(() => expect(frames()).toBe(2));
    // Ten outlined stars on top of the usual frame.
    expect((fake?.count('stroke') ?? 0) - strokesBefore).toBeGreaterThanOrEqual(10);
  });

  it('pauses while the tab is hidden and resumes afterwards', async () => {
    render(<SceneCanvas scene={SCENE} />);
    await waitFor(() => expect(frames()).toBeGreaterThanOrEqual(1));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const paused = frames();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(frames()).toBe(paused);
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(frames()).toBeGreaterThan(paused));
  });

  it('stops drawing after unmount', async () => {
    const { unmount } = render(<SceneCanvas scene={SCENE} />);
    await waitFor(() => expect(frames()).toBeGreaterThanOrEqual(1));
    unmount();
    const after = frames();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(frames()).toBe(after);
  });

  it('loads svg through a sanitized blob URL and revokes it on unmount', async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    });
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs; add them for this test and take them away again below.
    const urlApi = URL as unknown as Record<string, unknown>;
    urlApi.createObjectURL = createObjectURL;
    urlApi.revokeObjectURL = revokeObjectURL;
    const svgScene = SceneSchema.parse({
      objects: [
        {
          id: 'pic',
          type: 'svg',
          svg: '<svg viewBox="0 0 4 4" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4"/></svg>',
          x: 50,
          y: 50,
        },
        { id: 'bad', type: 'svg', svg: '<svg><script>alert(3)</script></svg>', x: 20, y: 20 },
      ],
    });
    const { unmount } = render(<SceneCanvas scene={svgScene} reducedMotion />);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = created[0] as Blob;
    expect(blob.type).toBe('image/svg+xml');
    const text = await blob.text();
    expect(text).toContain('<rect');
    expect(text).not.toContain('script');
    expect(text).not.toContain('onload');
    // Not decoded yet (jsdom never loads images), so nothing is drawn from it.
    expect(fake?.calls).not.toContain('drawImage');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
    delete urlApi.createObjectURL;
    delete urlApi.revokeObjectURL;
  });
});
