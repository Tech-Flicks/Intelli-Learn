/**
 * Development-only gallery: Pip in all 20 states, for checking the artwork, the poses and
 * the motion by eye. Not routed in the app. Tap a Pip to see a short reaction.
 */
import { useState, type JSX } from 'react';
import { Chip } from '@/ui';
import { Pip } from './Pip';
import { PIP_STATES, type PipState } from './states';
import { usePipMood } from './usePipMood';

const SIZES = [
  { label: 'Small', px: 96 },
  { label: 'Medium', px: 168 },
  { label: 'Large', px: 240 },
] as const;

interface CardProps {
  state: PipState;
  size: number;
  talking: boolean;
  still: boolean;
  followPointer: boolean;
}

function GalleryCard({ state, size, talking, still, followPointer }: CardProps): JSX.Element {
  const [mood, react] = usePipMood(state);
  return (
    <figure className="m-0 flex min-w-0 flex-col items-center gap-3 rounded-3xl border-2 border-brand-100 bg-white px-3 pb-3 pt-5 shadow-card">
      <Pip
        state={mood}
        size={size}
        talking={talking ? true : undefined}
        lookAt={followPointer ? 'pointer' : null}
        reducedMotion={still ? true : undefined}
        onTap={() => react(state === 'giggle' ? 'celebrating' : 'giggle', 1200)}
        ariaLabel={`Pip, ${state.replace('_', ' ')}`}
      />
      <figcaption className="rounded-full bg-brand-50 px-3 py-1 font-display text-base font-bold text-brand-700">
        {state}
      </figcaption>
    </figure>
  );
}

export function PipGallery(): JSX.Element {
  const [size, setSize] = useState<number>(SIZES[1].px);
  const [talking, setTalking] = useState(false);
  const [still, setStill] = useState(false);
  const [followPointer, setFollowPointer] = useState(true);

  return (
    <main className="child-bg min-h-full px-4 py-6 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-col gap-3">
          <h1 className="m-0 font-display text-3xl font-bold text-ink-900">Pip, in {PIP_STATES.length} states</h1>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gallery options">
            {SIZES.map((option) => (
              <Chip key={option.px} selected={size === option.px} onClick={() => setSize(option.px)}>
                {option.label}
              </Chip>
            ))}
            <Chip selected={talking} onClick={() => setTalking((on) => !on)}>
              Talking
            </Chip>
            <Chip selected={followPointer} onClick={() => setFollowPointer((on) => !on)}>
              Follow pointer
            </Chip>
            <Chip selected={still} onClick={() => setStill((on) => !on)}>
              Reduced motion
            </Chip>
          </div>
        </header>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(size + 28, 300)}px, 1fr))` }}
        >
          {PIP_STATES.map((state) => (
            <GalleryCard
              key={state}
              state={state}
              size={size}
              talking={talking}
              still={still}
              followPointer={followPointer}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
