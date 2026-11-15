/**
 * `/kids/:childId/studio`: the Imagination Studio idea picker.
 *
 * The child builds an idea without typing: one picture from each of three rows. Typing
 * (and the microphone) is offered only when the parent switched open chat (and the
 * microphone) on, and a typed idea is checked before it goes anywhere.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { usePipMood } from '@/bot/pip';
import { useT } from '@/i18n';
import { BigButton, ChildShell, Field, IconButton, TextInput, cx, useReducedMotion } from '@/ui';
import { cancelListening, listenOnce, speak, stopListening, useListening, useSpeaking, voiceSupport } from '@/voice';
import { useChildScreen, usePlayAllowance, useScreenVoice, wantsReadAloud } from './hooks';
import { BackButton, ChildLoading, PipFigure, ScreenColumn, ScreenTitle, SpeakerButton } from './parts';
import {
  EMPTY_IDEA,
  IDEA_ROWS,
  TYPED_IDEA_MAX_LENGTH,
  buildIdea,
  checkTypedIdea,
  clipIdea,
  ideaEmoji,
  pickSurprises,
  type IdeaChoice,
  type IdeaRow,
} from './studioIdeas';
import './child.css';
import './strings';

const ROW_TONE: Record<IdeaRow, string> = {
  character: 'border-brand-200 bg-brand-50',
  action: 'border-sun-500 bg-sun-100',
  place: 'border-leaf-400 bg-leaf-100',
};

type MicProblem = 'denied' | 'nospeech' | 'unsupported';

function micProblemOf(error: unknown): MicProblem {
  const code = error instanceof Error ? error.message : '';
  if (code === 'denied') return 'denied';
  if (code === 'unsupported') return 'unsupported';
  return 'nospeech';
}

export function StudioScreen() {
  const { child, controls, small } = useChildScreen();
  const t = useT();
  const navigate = useNavigate();
  const calm = useReducedMotion();
  const speaking = useSpeaking();
  const listening = useListening();
  const base = `/kids/${child.id}`;
  const allowanceState = usePlayAllowance(child.id);

  const canType = controls.openChat;
  // The microphone needs both switches: it is a way of entering free text.
  const canTalk = canType && controls.microphone && voiceSupport().stt;
  const readsAloud = wantsReadAloud(child) && controls.voiceOutput;

  const [choice, setChoice] = useState<IdeaChoice>(EMPTY_IDEA);
  const [typed, setTyped] = useState('');
  const [unsafe, setUnsafe] = useState(false);
  const [micProblem, setMicProblem] = useState<MicProblem | null>(null);
  const [surprises] = useState(() => pickSurprises(3));

  const built = buildIdea(choice);
  const ownIdea = canType ? typed.replace(/\s+/g, ' ').trim() : '';
  const idea = ownIdea !== '' ? ownIdea : built;

  const voice = useScreenVoice({
    // The speaker says the app's own words only: the picture idea or the instructions, never typed text.
    line: built ?? t(small ? 'child.studio.say.small' : 'child.studio.say'),
    enabled: controls.voiceOutput,
    auto: wantsReadAloud(child),
    rate: child.voiceRate,
  });
  const [pipState, react] = usePipMood(listening ? 'listening' : speaking ? 'talking' : idea ? 'happy' : 'curious');

  // A child who is read to hears each finished picture idea. The text is the app's own.
  useEffect(() => {
    if (readsAloud && built !== null) void speak(built, { rate: child.voiceRate });
  }, [readsAloud, built, child.voiceRate]);

  // Leaving the screen releases the microphone at once.
  useEffect(() => () => cancelListening(), []);

  if (allowanceState.status === 'ready' && !allowanceState.allowance.allowed) return <Navigate to={`${base}/rest`} replace />;
  // The creative modes open after the first adventure.
  if (!child.placementDone) return <Navigate to={base} replace />;
  if (allowanceState.status !== 'ready') return <ChildLoading />;

  const pick = (row: IdeaRow, id: string) => {
    setChoice((current) => ({ ...current, [row]: current[row] === id ? null : id }));
    // Picking pictures goes back to the picture idea.
    setTyped('');
    setUnsafe(false);
  };

  const surprise = (next: IdeaChoice) => {
    setChoice(next);
    setTyped('');
    setUnsafe(false);
    react('giggle');
  };

  const make = () => {
    let finished: string | null = built;
    if (ownIdea !== '') {
      const result = checkTypedIdea(ownIdea, controls.strictness);
      if (!result.ok) {
        setUnsafe(result.problem === 'unsafe');
        react('curious');
        return;
      }
      finished = result.idea;
    }
    if (finished === null) return;
    navigate(`${base}/play?mode=studio&idea=${encodeURIComponent(finished)}`);
  };

  const toggleMic = async () => {
    if (listening) {
      stopListening();
      return;
    }
    setMicProblem(null);
    setUnsafe(false);
    try {
      const heard = await listenOnce();
      setTyped(clipIdea(heard.replace(/\s+/g, ' ').trim()));
    } catch (error) {
      setMicProblem(micProblemOf(error));
    }
  };

  return (
    <ChildShell
      tone="meadow"
      topBar={
        <>
          <BackButton to={base} label={t('child.backToMap')} />
          <span className="flex-1" />
          <SpeakerButton voice={voice} />
        </>
      }
    >
      {/* Room at the bottom for the fixed "Make it!" bar. */}
      <ScreenColumn className="gap-5 pb-36">
        <div className="flex flex-col gap-1">
          <ScreenTitle emoji="🎨">{t('child.studio.title')}</ScreenTitle>
          {!small && <p className="text-center text-lg font-semibold opacity-90">{t('child.studio.say')}</p>}
        </div>

        {IDEA_ROWS.map((row) => (
          <section
            key={row.row}
            role="group"
            aria-labelledby={`child-studio-${row.row}`}
            className={cx('flex flex-col gap-3 rounded-3xl border-2 p-3 text-ink-900 sm:p-4', ROW_TONE[row.row])}
          >
            <h2 id={`child-studio-${row.row}`} className="px-1 font-display text-2xl font-bold leading-tight">
              {t(row.titleKey)}
            </h2>
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {row.chips.map((chip) => {
                const selected = choice[row.row] === chip.id;
                return (
                  <li key={chip.id} className="flex min-w-0">
                    <motion.button
                      type="button"
                      aria-pressed={selected}
                      data-chip={`${row.row}:${chip.id}`}
                      onClick={() => pick(row.row, chip.id)}
                      whileTap={calm ? undefined : { scale: 0.9 }}
                      animate={calm ? undefined : { scale: selected ? 1.04 : 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                      className={cx(
                        'flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 py-2 text-center',
                        selected
                          ? 'border-brand-700 bg-brand-500 text-white shadow-[0_4px_0_var(--color-brand-700)]'
                          : 'border-ink-200 bg-white text-ink-900 shadow-[0_4px_0_var(--color-ink-200)] hover:border-brand-500',
                      )}
                    >
                      <span aria-hidden="true" className={cx('leading-none', small ? 'text-4xl' : 'text-3xl')}>
                        {chip.emoji}
                      </span>
                      <span className={cx('w-full hyphens-auto break-words font-bold leading-tight', small ? 'sr-only' : 'text-[0.7rem] min-[400px]:text-xs sm:text-sm')}>
                        {t(`${row.prefix}.${chip.id}`)}
                      </span>
                    </motion.button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* One-tap surprise ideas */}
        <section role="group" aria-labelledby="child-studio-surprise" className="flex flex-col gap-3">
          <h2 id="child-studio-surprise" className="flex items-center gap-2 px-1 font-display text-2xl font-bold leading-tight">
            <span aria-hidden="true">🎲</span>
            {t('child.studio.surprise')}
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:gap-4">
            {surprises.map((entry, index) => (
              <li key={index} className="flex min-w-0">
                <BigButton
                  tone="white"
                  size="md"
                  fullWidth
                  data-surprise={index}
                  aria-label={buildIdea(entry) ?? undefined}
                  onClick={() => surprise(entry)}
                  className="px-2! text-2xl! sm:text-3xl!"
                >
                  <span aria-hidden="true" className="whitespace-nowrap">
                    {ideaEmoji(entry)}
                  </span>
                </BigButton>
              </li>
            ))}
          </ul>
        </section>

        {/* Free text: only when the parent allows open chat */}
        {canType && (
          <section aria-labelledby="child-studio-own" className="flex flex-col gap-3 rounded-3xl border-2 border-sky-400 bg-sky-100 p-4 text-ink-900">
            <h2 id="child-studio-own" className="flex items-center gap-2 font-display text-2xl font-bold leading-tight">
              <span aria-hidden="true">✏️</span>
              {t('child.studio.own.title')}
            </h2>
            <Field
              label={t('child.studio.own.label')}
              hint={listening ? t('child.studio.listening') : t('child.studio.own.hint')}
              error={unsafe ? t('child.studio.err.unsafe') : micProblem ? t(`child.studio.err.mic.${micProblem}`) : undefined}
            >
              <div className="flex items-center gap-2">
                <TextInput
                  scale="lg"
                  value={typed}
                  maxLength={TYPED_IDEA_MAX_LENGTH}
                  placeholder={t('child.studio.own.placeholder')}
                  autoComplete="off"
                  enterKeyHint="go"
                  onValueChange={(next) => {
                    setTyped(clipIdea(next));
                    setUnsafe(false);
                    setMicProblem(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') make();
                  }}
                />
                {canTalk && (
                  <IconButton
                    aria-label={listening ? t('child.studio.mic.stop') : t('child.studio.mic')}
                    aria-pressed={listening}
                    variant={listening ? 'solid' : 'soft'}
                    size="lg"
                    onClick={() => void toggleMic()}
                    className={cx(listening && 'child-listening')}
                  >
                    🎤
                  </IconButton>
                )}
              </div>
            </Field>
          </section>
        )}
      </ScreenColumn>

      {/* The idea so far and the button, always within reach. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-brand-200 bg-white/95 px-safe pb-safe pt-3 text-ink-900 shadow-lift backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <PipFigure state={pipState} talking={speaking} onTap={() => react('giggle')} className="hidden h-16 w-16 sm:block" />
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-500">{t('child.studio.preview.label')}</p>
            <p
              data-testid="idea-preview"
              className={cx('line-clamp-3 break-words font-display text-base font-bold leading-tight sm:line-clamp-2 sm:text-2xl', idea === null && 'text-ink-500')}
            >
              {idea ?? (
                <>
                  <span aria-hidden="true">{ideaEmoji(choice)} </span>
                  {t('child.studio.preview.empty')}
                </>
              )}
            </p>
          </div>
          <BigButton tone="leaf" size="md" emoji="✨" onClick={make} disabled={idea === null} className="shrink-0 px-4! sm:px-6!">
            {t('child.studio.make')}
          </BigButton>
        </div>
      </div>
    </ChildShell>
  );
}
