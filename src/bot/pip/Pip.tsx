/**
 * Pip, the helper robot: the mascot of Intelli-Learn as one inline SVG.
 *
 * React renders the artwork once and sets the mood (`data-state`); everything that moves
 * from frame to frame (arms, mouth, eyes, blinking) is done by `PipEngine` outside React.
 */
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { useT } from '@/i18n';
import { cx, useReducedMotion } from '@/ui';
import { PipEngine, type PipEngineInput, type PipLookAt } from './engine';
import { PipArt, makePipArtIds } from './PipArt';
import type { PipState } from './states';
import './strings';
import './pip.css';

export interface PipProps {
  /** The mood. Default: 'idle', or 'talking' while `talking` is true. */
  state?: PipState;
  /** Width and height (the picture is square). A number is in px. Without it: 10rem, or whatever `className` sets. */
  size?: number | string;
  /**
   * true: the mouth moves with a speech-like rhythm, in any state. When left out, Pip moves
   * the mouth by itself in the 'talking' and 'singing' states. false keeps the mouth closed.
   */
  talking?: boolean;
  /** 0..1: how far the mouth is open right now. Replaces the made-up rhythm. */
  mouthLevel?: number;
  /** Where the eyes look: a point in viewport (client) pixels, 'pointer' to follow the pointer, or null for straight ahead. */
  lookAt?: PipLookAt;
  /** A still picture per state instead of motion. Default: `useReducedMotion()` (calm mode or the system setting). */
  reducedMotion?: boolean;
  /** Makes Pip a button: click, tap, Enter or Space. */
  onTap?: () => void;
  className?: string;
  /** Accessible name. Default: "Pip the helper robot", translated. */
  ariaLabel?: string;
}

function mouthLevelOf(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export function Pip({
  state,
  size,
  talking,
  mouthLevel,
  lookAt = null,
  reducedMotion,
  onTap,
  className,
  ariaLabel,
}: PipProps): JSX.Element {
  const t = useT();
  const systemReducedMotion = useReducedMotion();
  const still = reducedMotion ?? systemReducedMotion;

  const current: PipState = state ?? (talking ? 'talking' : 'idle');
  const speaking = talking ?? (current === 'talking' || current === 'singing');
  const level = mouthLevelOf(mouthLevel);
  // A point is compared by its numbers: callers usually pass a fresh object on every render.
  const followsPointer = lookAt === 'pointer';
  const lookX = lookAt !== null && lookAt !== 'pointer' ? lookAt.x : null;
  const lookY = lookAt !== null && lookAt !== 'pointer' ? lookAt.y : null;

  const reactId = useId();
  const ids = useMemo(() => makePipArtIds(reactId), [reactId]);
  // The artwork is drawn once, in the resting pose of the first state.
  const [initialState] = useState(current);

  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<PipEngine | null>(null);

  const input = useMemo<PipEngineInput>(
    () => ({
      state: current,
      speaking,
      mouthLevel: level,
      lookAt: followsPointer ? 'pointer' : lookX !== null && lookY !== null ? { x: lookX, y: lookY } : null,
      still,
    }),
    [current, speaking, level, followsPointer, lookX, lookY, still],
  );
  // The engine is made on the first run and told about every later change of the props.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (engineRef.current) engineRef.current.update(input);
    else engineRef.current = new PipEngine(svg, input);
  }, [input]);

  useLayoutEffect(
    () => () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    },
    [],
  );

  const tap = onTap
    ? () => {
        engineRef.current?.pop();
        onTap();
      }
    : undefined;

  const onKeyDown = tap
    ? (event: KeyboardEvent<SVGSVGElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        // Space would scroll the page.
        event.preventDefault();
        if (!event.repeat) tap();
      }
    : undefined;

  const style: CSSProperties | undefined = size === undefined ? undefined : { width: size, height: size };

  return (
    <svg
      ref={svgRef}
      className={cx('pip-bot', still && 'pip-still', tap && 'pip-tappable', className)}
      data-state={current}
      viewBox="0 0 380 380"
      style={style}
      role={tap ? 'button' : 'img'}
      aria-label={ariaLabel ?? t('pip.label')}
      tabIndex={tap ? 0 : undefined}
      onClick={tap}
      onKeyDown={onKeyDown}
    >
      {/* One picture with one name: the shapes and letters inside are not read out. */}
      <g aria-hidden="true">
        <PipArt ids={ids} initialState={initialState} />
      </g>
    </svg>
  );
}
