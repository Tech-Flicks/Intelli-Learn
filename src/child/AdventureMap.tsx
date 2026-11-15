/**
 * The adventure map: one illustrated world per enabled strand. Each world shows the trail
 * of the grade the child is working at: lit stops behind, the child's avatar on the current
 * stop, dim stops and the gate to the next grade ahead. Tapping a world starts play there.
 */
import type { JSX } from 'react';
import { motion } from 'motion/react';
import type { Strand } from '@/core/types';
import { gradeName, stageName, strandName, useT } from '@/i18n';
import { cx, useReducedMotion } from '@/ui';
import { TRAIL_POINTS, TRAIL_VIEWBOX, trailPath, type MapStop, type WorldView } from './map';
import './child.css';
import './strings';

interface WorldLook {
  emoji: string;
  /** Colour of the dashes on the trail. */
  dash: string;
  /** The logic world is night: light text is not used on it, but the trail edge changes. */
  dark: boolean;
}

const WORLD_LOOK: Record<Strand, WorldLook> = {
  math: { emoji: '🏔️', dash: 'var(--color-brand-500)', dark: false },
  science: { emoji: '🌴', dash: 'var(--color-leaf-600)', dark: false },
  technology: { emoji: '🏙️', dash: 'var(--color-sky-600)', dark: false },
  engineering: { emoji: '🏗️', dash: 'var(--color-coral-600)', dark: false },
  logic: { emoji: '🪐', dash: 'var(--color-brand-500)', dark: true },
};

const VIEW_BOX = `0 0 ${TRAIL_VIEWBOX.width} ${TRAIL_VIEWBOX.height}`;

/** The scenery behind a trail. Pure decoration, hidden in high-contrast mode. */
function Scenery({ strand }: { strand: Strand }): JSX.Element {
  const common = {
    'aria-hidden': true,
    viewBox: VIEW_BOX,
    preserveAspectRatio: 'xMidYMid slice',
    className: 'decor absolute inset-0 h-full w-full',
  } as const;

  switch (strand) {
    case 'math':
      return (
        <svg {...common}>
          <g fontFamily="var(--font-display)" fontWeight="700" fill="var(--color-brand-300)" opacity="0.6">
            <text x="146" y="26" fontSize="20">1</text>
            <text x="164" y="42" fontSize="16">2</text>
            <text x="180" y="24" fontSize="22">3</text>
          </g>
          <polygon points="-10,112 62,30 134,112" fill="var(--color-brand-200)" />
          <polygon points="92,112 176,14 260,112" fill="var(--color-brand-300)" opacity="0.7" />
          <polygon points="212,112 282,38 352,112" fill="var(--color-brand-200)" />
          <polygon points="62,30 49,45 58,42 64,49 70,41 75,45" fill="#ffffff" />
          <polygon points="176,14 160,33 171,29 178,38 185,29 192,33" fill="#ffffff" />
          <polygon points="282,38 270,51 279,48 284,55 290,48 294,51" fill="#ffffff" />
          <path d="M0 102 Q80 90 160 100 T320 96 V112 H0 Z" fill="var(--color-brand-100)" />
        </svg>
      );
    case 'science':
      return (
        <svg {...common}>
          <circle cx="160" cy="24" r="21" fill="var(--color-sun-300)" opacity="0.45" />
          <circle cx="160" cy="24" r="14" fill="var(--color-sun-400)" />
          <ellipse cx="60" cy="122" rx="120" ry="50" fill="var(--color-leaf-400)" opacity="0.55" />
          <ellipse cx="250" cy="126" rx="130" ry="56" fill="var(--color-leaf-400)" opacity="0.4" />
          <g fill="var(--color-leaf-600)" opacity="0.35">
            <circle cx="20" cy="64" r="20" />
            <circle cx="44" cy="52" r="16" />
            <circle cx="300" cy="58" r="22" />
            <circle cx="274" cy="70" r="14" />
          </g>
          <g stroke="var(--color-leaf-700)" strokeWidth="3" strokeLinecap="round" opacity="0.4">
            <path d="M30 86 V58" />
            <path d="M292 84 V54" />
          </g>
        </svg>
      );
    case 'technology':
      return (
        <svg {...common}>
          <g fill="var(--color-sky-400)" opacity="0.4">
            <rect x="6" y="40" width="34" height="80" rx="4" />
            <rect x="48" y="18" width="28" height="102" rx="4" />
            <rect x="130" y="28" width="36" height="92" rx="4" />
            <rect x="226" y="14" width="30" height="108" rx="4" />
            <rect x="264" y="46" width="44" height="74" rx="4" />
          </g>
          <g fill="var(--color-brand-300)" opacity="0.45">
            <rect x="84" y="52" width="38" height="68" rx="4" />
            <rect x="176" y="56" width="42" height="64" rx="4" />
          </g>
          <g fill="#ffffff" opacity="0.8">
            <rect x="54" y="26" width="6" height="6" rx="1" />
            <rect x="64" y="26" width="6" height="6" rx="1" />
            <rect x="54" y="38" width="6" height="6" rx="1" />
            <rect x="138" y="36" width="6" height="6" rx="1" />
            <rect x="150" y="36" width="6" height="6" rx="1" />
            <rect x="232" y="22" width="6" height="6" rx="1" />
            <rect x="244" y="22" width="6" height="6" rx="1" />
            <rect x="272" y="54" width="6" height="6" rx="1" />
            <rect x="284" y="54" width="6" height="6" rx="1" />
          </g>
          <path d="M241 14 V5" stroke="var(--color-sky-600)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <circle cx="241" cy="4" r="3" fill="var(--color-coral-400)" opacity="0.8" />
        </svg>
      );
    case 'engineering':
      return (
        <svg {...common}>
          <circle cx="160" cy="16" r="12" fill="var(--color-sun-400)" opacity="0.9" />
          <g stroke="var(--color-coral-400)" strokeLinecap="round" fill="none" opacity="0.75">
            <path d="M10 62 Q160 -6 310 62" strokeWidth="5" />
            <path d="M10 62 H310" strokeWidth="5" />
            <g strokeWidth="2.5">
              <path d="M60 62 V44" />
              <path d="M110 62 V32" />
              <path d="M160 62 V28" />
              <path d="M210 62 V32" />
              <path d="M260 62 V44" />
            </g>
          </g>
          <path d="M0 88 Q20 78 40 88 T80 88 T120 88 T160 88 T200 88 T240 88 T280 88 T320 88 V112 H0 Z" fill="var(--color-sky-400)" opacity="0.45" />
          <path d="M0 100 Q20 92 40 100 T80 100 T120 100 T160 100 T200 100 T240 100 T280 100 T320 100 V112 H0 Z" fill="var(--color-sky-400)" opacity="0.5" />
        </svg>
      );
    case 'logic':
      return (
        <svg {...common}>
          <g fill="#ffffff">
            <circle cx="24" cy="22" r="1.6" />
            <circle cx="62" cy="12" r="1.2" />
            <circle cx="126" cy="50" r="1.5" />
            <circle cx="196" cy="88" r="1.4" />
            <circle cx="250" cy="14" r="1.2" />
            <circle cx="300" cy="30" r="1.6" />
            <circle cx="252" cy="98" r="1.3" />
            <circle cx="72" cy="100" r="1.5" />
            <circle cx="130" cy="102" r="1.1" />
          </g>
          <g opacity="0.9">
            <circle cx="160" cy="24" r="13" fill="var(--color-brand-300)" />
            <ellipse cx="160" cy="24" rx="23" ry="6" fill="none" stroke="var(--color-sun-300)" strokeWidth="3" transform="rotate(-18 160 24)" />
          </g>
          <circle cx="14" cy="108" r="30" fill="var(--color-brand-400)" opacity="0.35" />
          <circle cx="308" cy="112" r="36" fill="var(--color-brand-400)" opacity="0.3" />
        </svg>
      );
  }
}

function Stop({ stop, point, avatar, nextIsTop }: { stop: MapStop; point: { x: number; y: number }; avatar: string; nextIsTop: boolean }) {
  const position = {
    left: `${(point.x / TRAIL_VIEWBOX.width) * 100}%`,
    top: `${(point.y / TRAIL_VIEWBOX.height) * 100}%`,
  };
  const base = 'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full leading-none';

  if (stop.kind === 'gate') {
    return (
      <span data-stop="gate" style={position} className={cx(base, 'h-10 w-10 border-2 border-white bg-white/85 text-xl shadow-card')}>
        {nextIsTop ? '🏆' : '🏁'}
      </span>
    );
  }
  if (stop.state === 'done') {
    return (
      <span data-stop="done" style={position} className={cx(base, 'h-9 w-9 border-[3px] border-sun-500 bg-white text-lg shadow-card')}>
        ⭐
      </span>
    );
  }
  if (stop.state === 'current') {
    return (
      <span data-stop="current" style={position} className={cx(base, 'h-[3.25rem] w-[3.25rem]')}>
        <span className="child-halo absolute inset-0 rounded-full bg-sun-400" />
        <span className="child-hop relative flex h-full w-full items-center justify-center rounded-full border-4 border-brand-500 bg-white text-3xl shadow-lift">
          {avatar}
        </span>
      </span>
    );
  }
  return (
    <span data-stop="ahead" style={position} className={cx(base, 'h-8 w-8 border-2 border-dashed border-ink-400 bg-white/70')}>
      <span className="h-2 w-2 rounded-full bg-ink-400" />
    </span>
  );
}

export interface WorldCardProps {
  world: WorldView;
  avatar: string;
  /** Fewer words (ages 3 to 5): the subject and the picture only. */
  small: boolean;
  onPlay: (strand: Strand) => void;
}

export function WorldCard({ world, avatar, small, onPlay }: WorldCardProps) {
  const t = useT();
  const calm = useReducedMotion();
  const look = WORLD_LOOK[world.strand];
  const worldTitle = t(`child.home.world.${world.strand}`);
  const strand = strandName(world.strand);
  const grade = gradeName(world.grade);
  const here = world.explored
    ? t('child.home.world.aria', { world: worldTitle, strand, stage: stageName(world.stage) })
    : t('child.home.world.ariaNew', { world: worldTitle, strand, grade });
  const ahead = world.nextGrade ? t('child.home.world.next', { grade: gradeName(world.nextGrade) }) : t('child.home.world.top');
  const label = `${here} ${ahead}.`;
  const path = trailPath();

  return (
    <motion.button
      type="button"
      aria-label={label}
      data-world={world.strand}
      onClick={() => onPlay(world.strand)}
      whileHover={calm ? undefined : { y: -4 }}
      whileTap={calm ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
      className={cx(
        'child-world relative flex h-full w-full flex-col overflow-hidden rounded-[2rem] text-left shadow-card',
        `child-world-${world.strand}`,
      )}
    >
      {/* Name plate and signpost sit above the picture, so long names and large text never cover the trail. */}
      <span aria-hidden="true" className="relative z-10 flex w-full items-start justify-between gap-2 px-3 pt-3">
        <span className="flex min-w-0 items-center gap-2 rounded-2xl bg-white/95 px-3 py-1.5 text-ink-900 shadow-card">
          <span className={cx('leading-none', small ? 'text-3xl' : 'text-2xl')}>{look.emoji}</span>
          <span className="flex min-w-0 flex-col leading-tight">
            {small ? (
              <span className="break-words font-display text-xl font-bold">{strand}</span>
            ) : (
              <>
                <span className="break-words font-display text-base font-bold">{worldTitle}</span>
                <span className="break-words text-xs font-bold uppercase tracking-wide text-ink-700">{strand}</span>
              </>
            )}
          </span>
        </span>
        <span className="flex max-w-[45%] shrink-0 flex-col items-center">
          <span className="max-w-full break-words rounded-lg border-2 border-sun-600 bg-sun-100 px-2 py-0.5 text-center text-sm font-bold leading-tight text-sun-700 shadow-card">
            {grade}
          </span>
          <span className="h-2.5 w-1.5 rounded-b bg-sun-600" />
        </span>
      </span>

      <span aria-hidden="true" className="relative mt-auto block aspect-[20/7] w-full">
        <Scenery strand={world.strand} />

        {/* The trail: a soft edge, the path, and dashes in the colour of the world. */}
        <svg viewBox={VIEW_BOX} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
          <path className="child-trail-edge" d={path} fill="none" stroke={look.dark ? 'rgb(255 255 255 / 0.25)' : 'rgb(31 26 61 / 0.14)'} strokeWidth="15" strokeLinecap="round" />
          <path d={path} fill="none" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" />
          <path d={path} fill="none" stroke={look.dash} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 9" />
        </svg>

        {world.stops.map((stop, index) => {
          const point = TRAIL_POINTS[index];
          if (!point) return null;
          return <Stop key={index} stop={stop} point={point} avatar={avatar} nextIsTop={world.nextGrade === null} />;
        })}
      </span>
    </motion.button>
  );
}

export interface AdventureMapProps {
  worlds: readonly WorldView[];
  avatar: string;
  small: boolean;
  onPlay: (strand: Strand) => void;
}

export function AdventureMap({ worlds, avatar, small, onPlay }: AdventureMapProps) {
  return (
    // Wrapping rows, centred: a last row of one or two worlds sits in the middle.
    <ul className="flex flex-wrap justify-center gap-4">
      {worlds.map((world) => (
        <li key={world.strand} className="flex w-full min-w-0 sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)]">
          <WorldCard world={world} avatar={avatar} small={small} onPlay={onPlay} />
        </li>
      ))}
    </ul>
  );
}
