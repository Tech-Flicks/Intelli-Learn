/**
 * Canvas 2D scene renderer.
 *
 * The scene is declarative data (see SceneSchema). This component draws it
 * with requestAnimationFrame, pauses when nobody can see it, and exposes
 * tappable objects as real buttons so tap challenges work with a keyboard or
 * a screen reader as well as with a finger.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type MouseEvent } from 'react';
import type { Scene } from '@/core/schemas';
import { accessibleNames, describeScene, hitTest, MIN_TAP_RADIUS, type StageSize } from './layout';
import { spawnCelebration, stepParticles, type Particle } from './particles';
import { renderFrame } from './render';
import { SvgImageCache } from './svgImages';

export interface SceneCanvasProps {
  scene: Scene;
  highlightIds?: string[];
  selectedIds?: string[];
  onTapObject?: (id: string) => void;
  reducedMotion?: boolean;
  /** Changing this number fires a celebration burst (confetti, stars). */
  celebrate?: number;
  className?: string;
  ariaLabel?: string;
}

/** How long the still star burst stays up under reduced motion. */
const STATIC_BURST_MS = 1400;
const MAX_DPR = 3;

interface Runtime {
  ctx: CanvasRenderingContext2D | null;
  size: StageSize;
  dpr: number;
  /** Seconds of visible animation time since the scene appeared. */
  clock: number;
  lastFrameAt: number | null;
  raf: number | null;
  onScreen: boolean;
  tabVisible: boolean;
  particles: Particle[];
  staticBurstUntil: number;
  tapTimes: Map<string, number>;
  images: SvgImageCache | null;
}

interface Latest {
  scene: Scene;
  highlight: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  focusedId: string | null;
  reducedMotion: boolean;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function SceneCanvas(props: SceneCanvasProps): JSX.Element {
  const { scene, highlightIds, selectedIds, onTapObject, reducedMotion = false, celebrate, className, ariaLabel } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const highlight = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  /** Changes only when the scene's content changes, not when the parent re-creates the object. */
  const sceneKey = useMemo(() => JSON.stringify(scene), [scene]);

  const runtime = useRef<Runtime>({
    ctx: null,
    size: { width: 400, height: 300 },
    dpr: 1,
    clock: 0,
    lastFrameAt: null,
    raf: null,
    onScreen: true,
    tabVisible: true,
    particles: [],
    staticBurstUntil: 0,
    tapTimes: new Map(),
    images: null,
  });
  const latest = useRef<Latest>({ scene, highlight, selected, focusedId, reducedMotion });
  latest.current = { scene, highlight, selected, focusedId, reducedMotion };

  /** Draws one frame and, when animation is allowed and visible, asks for the next one. */
  const frame = useCallback((timestamp: number) => {
    const rt = runtime.current;
    const view = latest.current;
    rt.raf = null;
    const ctx = rt.ctx;
    if (!ctx) return;
    const dt = rt.lastFrameAt === null ? 0 : Math.min(0.1, Math.max(0, (timestamp - rt.lastFrameAt) / 1000));
    rt.lastFrameAt = timestamp;
    if (!view.reducedMotion) {
      rt.clock += dt;
      if (rt.particles.length > 0) rt.particles = stepParticles(rt.particles, dt, rt.size.width, rt.size.height);
    } else {
      rt.particles = [];
    }
    const staticBurst = view.reducedMotion && nowMs() < rt.staticBurstUntil;
    try {
      ctx.setTransform(rt.dpr, 0, 0, rt.dpr, 0, 0);
      renderFrame(ctx, {
        scene: view.scene,
        width: rt.size.width,
        height: rt.size.height,
        t: rt.clock,
        reducedMotion: view.reducedMotion,
        highlightIds: view.highlight,
        selectedIds: view.selected,
        focusedId: view.focusedId,
        tapTimes: rt.tapTimes,
        images: rt.images,
        particles: rt.particles,
        staticBurst,
      });
    } catch {
      // Drawing problems (odd fonts, a context lost mid-frame) must never crash the page.
    }
    if (!view.reducedMotion && rt.onScreen && rt.tabVisible) {
      rt.raf = requestAnimationFrame(frame);
    } else {
      rt.lastFrameAt = null; // do not count the pause as animation time
    }
  }, []);

  /** Makes sure a frame is on its way. Safe to call any number of times. */
  const kick = useCallback(() => {
    const rt = runtime.current;
    if (!rt.ctx || rt.raf !== null || typeof requestAnimationFrame !== 'function') return;
    rt.raf = requestAnimationFrame(frame);
  }, [frame]);

  // Canvas, observers and the animation loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const rt = runtime.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d') ?? null;
    } catch {
      ctx = null; // e.g. jsdom without a canvas implementation
    }
    rt.ctx = ctx;
    rt.images = new SvgImageCache(() => kick());

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, rect.width || wrap.clientWidth || 400);
      const height = Math.max(1, rect.height || wrap.clientHeight || width * 0.75);
      const dpr = Math.max(1, Math.min(MAX_DPR, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
      rt.size = { width, height };
      rt.dpr = dpr;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      kick();
    };
    resize();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    resizeObserver?.observe(wrap);
    if (!resizeObserver && typeof window !== 'undefined') window.addEventListener('resize', resize);

    const intersectionObserver =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            const entry = entries[entries.length - 1];
            rt.onScreen = entry ? entry.isIntersecting : true;
            if (rt.onScreen) kick();
          })
        : null;
    intersectionObserver?.observe(wrap);

    const onVisibility = (): void => {
      rt.tabVisible = document.visibilityState !== 'hidden';
      if (rt.tabVisible) kick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();

    // The device pixel ratio changes when the window moves between screens or the page zooms.
    const dprQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        : null;
    dprQuery?.addEventListener?.('change', resize);

    return () => {
      if (rt.raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rt.raf);
      rt.raf = null;
      rt.lastFrameAt = null;
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      if (!resizeObserver && typeof window !== 'undefined') window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      dprQuery?.removeEventListener?.('change', resize);
      rt.images?.dispose(); // revokes every object URL
      rt.images = null;
      rt.ctx = null;
    };
  }, [kick]);

  // A new scene starts its animations from the beginning and forgets old drawings.
  useEffect(() => {
    const rt = runtime.current;
    rt.clock = 0;
    rt.tapTimes.clear();
    const inUse = new Set<string>();
    for (const obj of latest.current.scene.objects) if (obj.type === 'svg' && obj.svg) inUse.add(obj.svg);
    rt.images?.retain(inUse);
    kick();
  }, [sceneKey, kick]);

  // Anything that changes the picture needs a fresh frame (the only frame, under reduced motion).
  useEffect(() => {
    kick();
  }, [highlight, selected, focusedId, reducedMotion, kick]);

  // Celebration: fires when the number changes, not on the first render.
  const celebrateSeen = useRef(celebrate);
  useEffect(() => {
    if (celebrateSeen.current === celebrate) return undefined;
    celebrateSeen.current = celebrate;
    const rt = runtime.current;
    if (latest.current.reducedMotion) {
      rt.staticBurstUntil = nowMs() + STATIC_BURST_MS;
      kick();
      const timer = setTimeout(() => kick(), STATIC_BURST_MS + 30);
      return () => clearTimeout(timer);
    }
    rt.particles = [
      ...rt.particles,
      ...spawnCelebration(rt.size.width, rt.size.height, Math.floor(nowMs()) + (celebrate ?? 0)),
    ].slice(-240);
    kick();
    return undefined;
  }, [celebrate, kick]);

  const tap = useCallback(
    (id: string) => {
      const rt = runtime.current;
      rt.tapTimes.set(id, rt.clock);
      kick();
      onTapObject?.(id);
    },
    [kick, onTapObject],
  );

  const interactive = typeof onTapObject === 'function';

  const locate = (event: { clientX: number; clientY: number }): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const rt = runtime.current;
    const width = rect.width || rt.size.width;
    const height = rect.height || rt.size.height;
    return hitTest(
      latest.current.scene,
      event.clientX - rect.left,
      event.clientY - rect.top,
      rt.clock,
      { width, height },
      latest.current.reducedMotion,
      MIN_TAP_RADIUS,
    );
  };

  const onCanvasClick = (event: MouseEvent<HTMLCanvasElement>): void => {
    if (!interactive) return;
    const id = locate(event);
    if (id) tap(id);
  };

  const onCanvasMove = (event: MouseEvent<HTMLCanvasElement>): void => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = locate(event) ? 'pointer' : 'default';
  };

  const tappable = useMemo(() => scene.objects.filter((obj) => obj.tappable), [scene]);
  const names = useMemo(() => accessibleNames(tappable), [tappable]);
  const label = ariaLabel ?? describeScene(scene);

  const wrapStyle: CSSProperties = { aspectRatio: '4 / 3' };

  return (
    <div
      ref={wrapRef}
      className={`relative w-full overflow-hidden rounded-3xl bg-brand-50 shadow-inner select-none ${className ?? ''}`}
      style={wrapStyle}
      role={interactive ? 'group' : 'img'}
      aria-label={label}
      data-scene-theme={scene.theme}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        style={{ touchAction: 'manipulation' }}
        onClick={onCanvasClick}
        onMouseMove={onCanvasMove}
        aria-hidden="true"
      />
      {interactive &&
        tappable.map((obj) => {
          // Real buttons sit over each tappable object. They are see-through and
          // let pointer taps fall through to the canvas, but take keyboard focus
          // and screen-reader activation.
          const isSelected = selected.has(obj.id);
          return (
            <button
              key={obj.id}
              type="button"
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-0 bg-transparent p-0 text-transparent outline-none"
              style={{
                left: `${obj.x}%`,
                top: `${obj.y}%`,
                width: `max(${obj.size}%, 44px)`,
                height: `max(${obj.size}%, 44px)`,
                pointerEvents: 'none',
              }}
              aria-pressed={isSelected}
              aria-label={names.get(obj.id) ?? obj.id}
              data-object-id={obj.id}
              onClick={() => tap(obj.id)}
              onFocus={() => setFocusedId(obj.id)}
              onBlur={() => setFocusedId((current) => (current === obj.id ? null : current))}
            />
          );
        })}
    </div>
  );
}
