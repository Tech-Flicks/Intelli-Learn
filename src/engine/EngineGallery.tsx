/**
 * Development-only gallery: one sample challenge of every interaction kind,
 * for checking the renderer and the widgets by eye. Not routed in the app.
 */
import { useState, type JSX } from 'react';
import { SCENE_THEMES, type Scene } from '@/core/schemas';
import { INTERACTION_KINDS, type InteractionKind } from '@/core/types';
import { ChallengeStage } from './ChallengeStage';
import { SAMPLE_CHALLENGES } from './samples';
import { SceneCanvas } from './scene/SceneCanvas';
import type { Answer, CheckResult } from './types';

interface LastResult {
  answer: Answer;
  result: CheckResult;
}

function GalleryItem({ kind, reducedMotion }: { kind: InteractionKind; reducedMotion: boolean }): JSX.Element {
  const challenge = SAMPLE_CHALLENGES[kind];
  const [last, setLast] = useState<LastResult | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [hint, setHint] = useState(false);
  const firstObject = challenge.scene.objects[0]?.id;

  return (
    <section className="flex flex-col gap-3 rounded-3xl border-4 border-brand-100 bg-paper p-4" aria-labelledby={`gallery-${kind}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`gallery-${kind}`} className="m-0 text-2xl font-extrabold text-ink-900">
          {kind}: {challenge.title}
        </h2>
        <span className="flex gap-2">
          <button type="button" className="min-h-12 rounded-xl bg-brand-100 px-3 font-bold text-brand-700" onClick={() => setHint((h) => !h)}>
            {hint ? 'Hide highlight' : 'Highlight'}
          </button>
          <button
            type="button"
            className="min-h-12 rounded-xl bg-brand-100 px-3 font-bold text-brand-700"
            onClick={() => {
              setResetKey((k) => k + 1);
              setLast(null);
            }}
          >
            Reset
          </button>
        </span>
      </header>
      <p className="m-0 text-lg text-ink-700">
        {challenge.intro} <strong>{challenge.question}</strong>
      </p>
      <ChallengeStage
        challenge={challenge}
        reducedMotion={reducedMotion}
        celebrate={celebrate}
        resetKey={resetKey}
        highlightIds={hint && firstObject ? [firstObject] : []}
        onSubmit={(answer, result) => {
          setLast({ answer, result });
          if (result.correct) setCelebrate((n) => n + 1);
        }}
      />
      <pre className="m-0 overflow-x-auto rounded-xl bg-white p-3 text-sm text-ink-700" data-testid={`gallery-result-${kind}`}>
        {last ? JSON.stringify(last, null, 1) : 'Press Check to see the answer and its result.'}
      </pre>
    </section>
  );
}

function themeScene(theme: Scene['theme']): Scene {
  return {
    theme,
    objects: [
      { id: 'name', type: 'text', text: theme, x: 50, y: 50, size: 14, rotation: 0, opacity: 1, z: 1, tappable: false },
    ],
  };
}

export function EngineGallery(): JSX.Element {
  const [reducedMotion, setReducedMotion] = useState(false);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-3xl font-extrabold text-brand-700">Engine gallery</h1>
        <label className="flex min-h-12 items-center gap-2 text-lg font-bold text-ink-700">
          <input type="checkbox" className="h-6 w-6" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
          Reduced motion
        </label>
      </header>
      {INTERACTION_KINDS.map((kind) => (
        <GalleryItem key={kind} kind={kind} reducedMotion={reducedMotion} />
      ))}
      <section className="flex flex-col gap-3" aria-labelledby="gallery-themes">
        <h2 id="gallery-themes" className="m-0 text-2xl font-extrabold text-ink-900">
          Scene themes
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {SCENE_THEMES.map((theme) => (
            <SceneCanvas key={theme} scene={themeScene(theme)} reducedMotion={reducedMotion} ariaLabel={`${theme} background`} />
          ))}
        </div>
      </section>
    </main>
  );
}
