/**
 * The scene plus the interaction widget for one challenge.
 *
 * Owns the in-progress answer. The big "Check" button is enabled only when
 * the answer is complete; pressing it runs `checkAnswer` and reports both the
 * answer and the result. After a wrong try the child's work stays in place so
 * they can adjust it; bump `resetKey` to start from scratch.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { MotionConfig, motion, useAnimationControls } from 'motion/react';
import type { Challenge, Interaction } from '@/core/schemas';
import { checkAnswer } from './check';
import { SceneCanvas } from './scene/SceneCanvas';
import type { Answer, CheckResult } from './types';
import { BuildWidget } from './widgets/BuildWidget';
import { ChoiceWidget } from './widgets/ChoiceWidget';
import { cx, DEFAULT_LABELS, FOCUS_RING, type StageLabels } from './widgets/common';
import { draftToAnswer, initialDraft, type Draft } from './widgets/draft';
import { MatchWidget } from './widgets/MatchWidget';
import { NumberWidget } from './widgets/NumberWidget';
import { OrderWidget } from './widgets/OrderWidget';
import { RobotWidget } from './widgets/RobotWidget';
import { SortWidget } from './widgets/SortWidget';
import { TapWidget } from './widgets/TapWidget';

export type { StageLabels } from './widgets/common';

export interface ChallengeStageProps {
  challenge: Challenge;
  /** Called when the child presses the big "Check" button with a complete answer. */
  onSubmit: (answer: Answer, result: CheckResult) => void;
  disabled?: boolean;
  highlightIds?: string[];
  reducedMotion?: boolean;
  celebrate?: number;
  /** Bump to clear the current answer (after a wrong try the child's work is kept unless this changes). */
  resetKey?: number;
  /** Text labels for the buttons, already localized. Anything left out falls back to English. */
  labels?: Partial<StageLabels>;
}

interface DraftState {
  key: string;
  draft: Draft;
}

const NO_IDS: string[] = [];

export function ChallengeStage(props: ChallengeStageProps): JSX.Element {
  const { challenge, onSubmit, disabled = false, highlightIds, reducedMotion = false, celebrate, resetKey = 0, labels } = props;
  const interaction: Interaction = challenge.interaction;
  const text = useMemo<StageLabels>(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
  const highlight = useMemo(() => new Set(highlightIds ?? NO_IDS), [highlightIds]);

  // The draft belongs to one interaction and one resetKey. When either changes, start fresh.
  const interactionKey = useMemo(() => JSON.stringify(interaction), [interaction]);
  const draftKey = `${resetKey}|${interactionKey}`;
  const [state, setState] = useState<DraftState>(() => ({ key: draftKey, draft: initialDraft(interaction) }));
  let draft = state.draft;
  if (state.key !== draftKey) {
    // Adjusting state while rendering: React re-renders at once with the fresh draft.
    const fresh = { key: draftKey, draft: initialDraft(interaction) };
    setState(fresh);
    draft = fresh.draft;
  }

  const setDraft = useCallback(
    (next: Draft) => {
      setState((current) => (current.key === draftKey ? { key: draftKey, draft: next } : current));
    },
    [draftKey],
  );

  const answer = useMemo(() => draftToAnswer(interaction, draft), [interaction, draft]);
  const canCheck = !disabled && answer !== null;

  // Wrong answers get a gentle wobble and a warm outline. Never a red cross.
  const shake = useAnimationControls();
  const [nudged, setNudged] = useState(false);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    },
    [],
  );

  const submit = useCallback(() => {
    if (disabled || answer === null) return;
    const result = checkAnswer(interaction, answer);
    if (!result.correct) {
      setNudged(true);
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => setNudged(false), 900);
      if (!reducedMotion) {
        void shake.start({ x: [0, -12, 12, -8, 8, -4, 0], transition: { duration: 0.45, ease: 'easeInOut' } });
      }
    }
    onSubmit(answer, result);
  }, [answer, disabled, interaction, onSubmit, reducedMotion, shake]);

  const tapSelected = draft.kind === 'tap' ? draft.ids : NO_IDS;
  const onTapObject = useCallback(
    (id: string) => {
      if (disabled) return;
      setState((current) => {
        if (current.key !== draftKey || current.draft.kind !== 'tap') return current;
        const ids = current.draft.ids.includes(id) ? current.draft.ids.filter((v) => v !== id) : [...current.draft.ids, id];
        return { key: current.key, draft: { kind: 'tap', ids } };
      });
    },
    [disabled, draftKey],
  );

  const common = { disabled, reducedMotion, highlight, labels: text };
  let widget: JSX.Element | null = null;
  if (interaction.kind === 'choice' && draft.kind === 'choice') {
    widget = <ChoiceWidget {...common} interaction={interaction} value={draft.ids} onChange={(ids) => setDraft({ kind: 'choice', ids })} />;
  } else if (interaction.kind === 'tap' && draft.kind === 'tap') {
    widget = <TapWidget {...common} interaction={interaction} value={draft.ids} onChange={(ids) => setDraft({ kind: 'tap', ids })} />;
  } else if (interaction.kind === 'sort' && draft.kind === 'sort') {
    widget = <SortWidget {...common} interaction={interaction} value={draft.placed} onChange={(placed) => setDraft({ kind: 'sort', placed })} />;
  } else if (interaction.kind === 'match' && draft.kind === 'match') {
    widget = <MatchWidget {...common} interaction={interaction} value={draft.links} onChange={(links) => setDraft({ kind: 'match', links })} />;
  } else if (interaction.kind === 'order' && draft.kind === 'order') {
    widget = <OrderWidget {...common} interaction={interaction} value={draft.ids} onChange={(ids) => setDraft({ kind: 'order', ids })} />;
  } else if (interaction.kind === 'number' && draft.kind === 'number') {
    widget = (
      <NumberWidget
        {...common}
        interaction={interaction}
        value={draft.text}
        onChange={(value) => setDraft({ kind: 'number', text: value })}
        onEnter={submit}
      />
    );
  } else if (interaction.kind === 'robot' && draft.kind === 'robot') {
    widget = <RobotWidget {...common} interaction={interaction} value={draft.blocks} onChange={(blocks) => setDraft({ kind: 'robot', blocks })} />;
  } else if (interaction.kind === 'build' && draft.kind === 'build') {
    widget = <BuildWidget {...common} interaction={interaction} value={draft.ids} onChange={(ids) => setDraft({ kind: 'build', ids })} />;
  }

  const isTap = interaction.kind === 'tap';

  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      <div
        className="group/stage grid w-full gap-4 lg:landscape:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:landscape:items-start"
        data-interaction={interaction.kind}
        data-calm={reducedMotion ? 'true' : 'false'}
      >
        <SceneCanvas
          scene={challenge.scene}
          highlightIds={highlightIds ?? NO_IDS}
          selectedIds={tapSelected}
          {...(isTap ? { onTapObject } : {})}
          reducedMotion={reducedMotion}
          celebrate={celebrate}
        />
        <motion.div
          animate={shake}
          className={cx('flex min-w-0 flex-col gap-4 rounded-3xl p-1 transition-shadow', nudged && 'ring-4 ring-sun-400')}
        >
          {widget}
          <motion.button
            type="button"
            whileTap={canCheck ? { scale: 0.97 } : undefined}
            disabled={!canCheck}
            onClick={submit}
            className={cx(
              'flex min-h-16 w-full items-center justify-center gap-2 rounded-3xl px-6 text-2xl font-extrabold shadow-md transition-colors',
              canCheck ? 'bg-leaf-600 text-white hover:bg-leaf-600/90' : 'bg-brand-100 text-ink-500',
              FOCUS_RING,
            )}
            data-testid="check-button"
          >
            <span aria-hidden="true">✔</span>
            {text.check}
          </motion.button>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
