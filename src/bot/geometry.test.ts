import { describe, expect, it } from 'vitest';
import {
  BOT,
  anchorBox,
  botSize,
  boundsFor,
  clampPoint,
  dockPoint,
  fromFraction,
  isNearDock,
  lineLifetimeMs,
  panelIsSheet,
  parseStoredPosition,
  pipStateFor,
  positionKey,
  toFraction,
  type Insets,
  type Size,
} from './geometry';

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const SCREENS: Size[] = [
  { width: 360, height: 640 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

describe('where Pip may float', () => {
  it('is big enough to touch on every screen', () => {
    for (const screen of SCREENS) expect(botSize(screen)).toBeGreaterThanOrEqual(56);
    expect(botSize({ width: 360, height: 640 })).toBe(BOT.sizeSmall);
    expect(botSize({ width: 768, height: 1024 })).toBe(BOT.sizeLarge);
    expect(botSize({ width: 800, height: 400 })).toBe(BOT.sizeSmall);
  });

  it('stays below the top bar and inside the safe areas', () => {
    const viewport = { width: 400, height: 800 };
    const bounds = boundsFor(viewport, { top: 40, right: 10, bottom: 30, left: 20 }, 72, 100);
    expect(bounds).toEqual({ minX: 28, maxX: 400 - 10 - 8 - 72, minY: 108, maxY: 800 - 30 - 8 - 72 });
    // A notch taller than the top bar wins.
    expect(boundsFor(viewport, { ...NONE, top: 120 }, 72, 100).minY).toBe(128);
    expect(clampPoint({ x: -50, y: 9999 }, bounds)).toEqual({ x: bounds.minX, y: bounds.maxY });
    expect(clampPoint({ x: 9999, y: -50 }, bounds)).toEqual({ x: bounds.maxX, y: bounds.minY });
  });

  it('never collapses on a tiny screen', () => {
    const bounds = boundsFor({ width: 60, height: 60 }, NONE, 72, 76);
    expect(bounds.maxX).toBe(bounds.minX);
    expect(bounds.maxY).toBe(bounds.minY);
  });

  it('is at home in the top corner of the question card, far from the Check button', () => {
    for (const viewport of SCREENS) {
      const size = botSize(viewport);
      const bounds = boundsFor(viewport, NONE, size, 76);
      const columnRight = viewport.width - 16;
      const dock = dockPoint(bounds, size, columnRight);
      expect(dock).toEqual({ x: columnRight - BOT.dockInset - size, y: 76 + BOT.margin + BOT.dockDrop });
      // The Check button is the last thing on the page: Pip's home is in the upper part of the screen.
      expect(dock.y + size).toBeLessThan(viewport.height / 3);
    }
  });

  it('is at home in the top right corner of the screen while no card was measured', () => {
    const bounds = boundsFor({ width: 1024, height: 768 }, NONE, 92, 76);
    expect(dockPoint(bounds, 92, null)).toEqual({ x: bounds.maxX, y: bounds.minY + BOT.dockDrop });
    // A column wider than the screen cannot pull him off it.
    expect(dockPoint(bounds, 92, 5000).x).toBe(bounds.maxX);
  });

  it('snaps home only when dropped close to it', () => {
    const dock = { x: 900, y: 90 };
    expect(isNearDock({ x: 880, y: 100 }, dock)).toBe(true);
    expect(isNearDock({ x: 900 - BOT.dockSnap - 1, y: 90 }, dock)).toBe(false);
  });
});

describe('remembering the position', () => {
  it('stores a share of the free space, so it survives a rotation', () => {
    const portrait = boundsFor({ width: 768, height: 1024 }, NONE, 92, 76);
    const landscape = boundsFor({ width: 1024, height: 768 }, NONE, 92, 76);
    const share = toFraction({ x: portrait.maxX, y: portrait.maxY }, portrait);
    expect(share).toEqual({ fx: 1, fy: 1 });
    expect(fromFraction(share, landscape)).toEqual({ x: landscape.maxX, y: landscape.maxY });
    const middle = toFraction(fromFraction({ fx: 0.25, fy: 0.5 }, portrait), portrait);
    expect(middle.fx).toBeCloseTo(0.25);
    expect(middle.fy).toBeCloseTo(0.5);
    expect(toFraction({ x: 5, y: 5 }, { minX: 5, maxX: 5, minY: 5, maxY: 5 })).toEqual({ fx: 0, fy: 0 });
  });

  it('uses one key per child', () => {
    expect(positionKey('kid-1')).toBe('bot-position:kid-1');
  });

  it('reads only a clean stored position', () => {
    expect(parseStoredPosition({ v: 1, fx: 0.2, fy: 0.9 })).toEqual({ fx: 0.2, fy: 0.9 });
    expect(parseStoredPosition({ v: 1, fx: -3, fy: 7 })).toEqual({ fx: 0, fy: 1 });
    expect(parseStoredPosition({ v: 2, fx: 0.2, fy: 0.9 })).toBeNull();
    expect(parseStoredPosition({ v: 1, fx: '0.2', fy: 0.9 })).toBeNull();
    expect(parseStoredPosition({ v: 1, fx: Number.NaN, fy: 0.9 })).toBeNull();
    expect(parseStoredPosition(null)).toBeNull();
    expect(parseStoredPosition('top-right')).toBeNull();
  });
});

describe('the speech bubble and the panel', () => {
  it('open below Pip when he is at the top, on his side, inside the screen', () => {
    const viewport = { width: 1024, height: 768 };
    const box = anchorBox({ x: 900, y: 90 }, 92, viewport, BOT.bubbleWidth);
    expect(box.side).toBe('below');
    expect(box.top).toBe(90 + 92 + 10);
    expect(box.bottom).toBeNull();
    expect(box.left + box.width).toBe(992);
    expect(box.left).toBeGreaterThanOrEqual(12);
    expect(box.tailLeft).toBeGreaterThan(box.width / 2);
  });

  it('open above Pip when he is at the bottom', () => {
    const viewport = { width: 1024, height: 768 };
    const box = anchorBox({ x: 40, y: 660 }, 92, viewport, BOT.bubbleWidth);
    expect(box.side).toBe('above');
    expect(box.top).toBeNull();
    expect(box.bottom).toBe(768 - 660 + 10);
    expect(box.left).toBe(40);
    expect(box.maxHeight).toBe(660 - 10 - 12);
  });

  it('never leave a phone screen', () => {
    const viewport = { width: 360, height: 640 };
    for (const x of [8, 140, 280]) {
      const box = anchorBox({ x, y: 90 }, 72, viewport, BOT.panelWidth);
      expect(box.left).toBeGreaterThanOrEqual(12);
      expect(box.left + box.width).toBeLessThanOrEqual(348);
      expect(box.tailLeft).toBeGreaterThanOrEqual(28);
      expect(box.tailLeft).toBeLessThanOrEqual(box.width - 28);
    }
  });

  it('make the panel a bottom sheet on small screens', () => {
    expect(panelIsSheet({ width: 360, height: 640 })).toBe(true);
    expect(panelIsSheet({ width: 900, height: 400 })).toBe(true);
    expect(panelIsSheet({ width: 768, height: 1024 })).toBe(false);
  });

  it('keep a line long enough to read it', () => {
    expect(lineLifetimeMs('Hi!')).toBe(5000);
    expect(lineLifetimeMs('x'.repeat(100))).toBe(7500);
    expect(lineLifetimeMs('x'.repeat(1000))).toBe(16_000);
  });
});

describe("Pip's face", () => {
  const quiet = { speaking: false, listening: false, reading: false, story: false };

  it('shows what the play session says', () => {
    expect(pipStateFor({ ...quiet, base: 'thinking' })).toBe('thinking');
    expect(pipStateFor({ ...quiet, base: 'curious' })).toBe('curious');
    expect(pipStateFor({ ...quiet, base: 'tired' })).toBe('tired');
  });

  it('listens, talks and reads on top of that', () => {
    expect(pipStateFor({ ...quiet, base: 'idle', listening: true, speaking: true })).toBe('listening');
    expect(pipStateFor({ ...quiet, base: 'idle', speaking: true })).toBe('talking');
    expect(pipStateFor({ ...quiet, base: 'idle', speaking: true, reading: true })).toBe('reading');
    expect(pipStateFor({ ...quiet, base: 'idle', speaking: true, reading: true, story: true })).toBe('storytelling');
  });

  it('keeps teaching, celebrating and being proud while he speaks', () => {
    expect(pipStateFor({ ...quiet, base: 'teaching', speaking: true })).toBe('teaching');
    expect(pipStateFor({ ...quiet, base: 'celebrating', speaking: true })).toBe('celebrating');
    expect(pipStateFor({ ...quiet, base: 'proud', speaking: true, reading: true })).toBe('proud');
  });

  it('is never angry', () => {
    expect(pipStateFor({ ...quiet, base: 'angry' })).toBe('curious');
    expect(pipStateFor({ ...quiet, base: 'angry', speaking: true })).toBe('talking');
  });
});
