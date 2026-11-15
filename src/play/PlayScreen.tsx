/**
 * `/kids/:childId/play`: the play screen.
 *
 * Top bar (home, a trail of finished adventures, the companion, the stars),
 * the question with the animated stage underneath, Pip floating on top, and
 * sheets that slide in for the walkthrough, the solved moment and the break.
 *
 * The screen only draws what the play session holds. There is no skip
 * control: a challenge is left by solving it, or by going home, which keeps
 * it for next time.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { HelperBot, Pip } from '@/bot';
import type { ChallengeRecord, ChildProfile, Mode } from '@/core/types';
import { db } from '@/data';
import { ChallengeStage } from '@/engine';
import { getLocale, modeName, tn, useStageLabels, useT } from '@/i18n';
import { companionEmoji, getCompanionDef } from '@/progression';
import { BigButton, IconButton, StarCount, cx, useReducedMotion } from '@/ui';
import { useSpeaking } from '@/voice';
import { frameOf, parseRequest, type Frame } from './machine';
import { playHomePath, usePlaySession, type StoryView } from './session';
import { BreakSheet, SolvedSheet, WalkthroughSheet } from './sheets';
import { LINE_COUNTS } from './strings';
import './play.css';

const MODE_EMOJI: Record<Mode, string> = {
  quest: '🗺️',
  story: '📖',
  experiment: '🧪',
  robot: '🤖',
  detective: '🔍',
  fixbot: '🛠️',
  invention: '💡',
  wonder: '✨',
  studio: '🎨',
  mission: '🌍',
};

/** Adventures between two "full trail" moments of the progress strip. */
const TRAIL_LENGTH = 5;

/** A question with more characters than this is set in a smaller size. */
const LONG_QUESTION = 90;

/** Matches Tailwind's `lg:landscape:` variant: there the sheets sit at the side, not at the bottom. */
const SIDE_SHEET_QUERY = '(min-width: 64rem) and (orientation: landscape)';

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

/** A subtle strip of dots: adventures finished this visit, or the steps of finding the starting point. */
function Trail({ completed, placement }: { completed: number; placement: { answered: number; total: number } | null }) {
  const t = useT();
  const total = placement ? placement.total : TRAIL_LENGTH;
  const filled = placement ? placement.answered : completed > 0 && completed % TRAIL_LENGTH === 0 ? TRAIL_LENGTH : completed % TRAIL_LENGTH;
  const label = placement
    ? `${t('play.frame.placement')}. ${t('play.frame.placement.step', { n: Math.min(placement.total, placement.answered + 1), total: placement.total })}`
    : tn('play.trail.one', 'play.trail.other', completed);
  return (
    <div role="img" aria-label={label} data-testid="trail" className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cx(
            'h-2.5 max-w-8 flex-1 rounded-full transition-colors duration-500',
            index < filled ? (placement ? 'bg-sky-600' : 'bg-leaf-600') : 'bg-white/80 ring-1 ring-brand-200',
          )}
        />
      ))}
    </div>
  );
}

function TopBar({ child, onHome }: { child: ChildProfile | undefined; onHome: () => void }) {
  const t = useT();
  const completed = usePlaySession((s) => s.sessionCompleted);
  const placement = usePlaySession((s) => s.placement);
  const pending = usePlaySession((s) => s.starsPending);
  const companionName = child ? child.companion.name.trim() || (getCompanionDef(child.companion.species)?.name ?? '') : '';
  return (
    <header data-bot-keepout="" className="relative z-20 flex min-h-16 items-center gap-2 px-safe pt-safe pb-2 sm:gap-3">
      <IconButton aria-label={t('play.home')} variant="soft" size="lg" onClick={onHome}>
        🏠
      </IconButton>
      <Trail completed={completed} placement={placement} />
      {child && (
        <>
          <span
            role="img"
            aria-label={t('play.companion', { name: companionName })}
            className="hidden h-12 min-w-12 items-center justify-center rounded-full border-2 border-brand-200 bg-white px-2 text-2xl leading-none min-[380px]:inline-flex"
          >
            {companionEmoji(child.companion)}
          </span>
          {/* A star is added to the count when it lands, not before. */}
          <StarCount count={Math.max(0, child.stars - pending)} size="md" className="shrink-0" data-star-target="" data-testid="star-counter" />
        </>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Never a blank screen: Pip thinks out loud while the next challenge is on its way. */
function LoadingView() {
  const t = useT();
  const [line, setLine] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setLine((current) => (current % LINE_COUNTS.loading) + 1), 2200);
    return () => clearInterval(timer);
  }, []);
  return (
    <div role="status" aria-label={t('play.loading.label')} data-testid="play-loading" className="play-late flex flex-1 flex-col items-center gap-4 pt-2">
      <div className="flex w-full items-center gap-3 rounded-[1.75rem] border-4 border-brand-200 bg-white p-4 shadow-card">
        <div className="h-24 w-24 shrink-0 sm:h-28 sm:w-28">
          <Pip state="thinking" size="100%" ariaLabel="" />
        </div>
        <p key={line} className="min-w-0 flex-1 animate-rise font-display text-2xl font-bold leading-tight text-brand-700 sm:text-3xl">
          {t(`play.loading.${line}`)}
        </p>
      </div>
      <div aria-hidden="true" className="play-shimmer aspect-[4/3] w-full rounded-3xl shadow-inner lg:landscape:max-w-2xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The question
// ---------------------------------------------------------------------------

function ReadButton({ className }: { className?: string }) {
  const t = useT();
  const speaking = useSpeaking();
  const reading = usePlaySession((s) => s.reading);
  const voiceOn = usePlaySession((s) => s.controls?.voiceOutput === true);
  if (!voiceOn) return null;
  const active = speaking && reading;
  return (
    <IconButton
      aria-label={active ? t('play.stop') : t('play.read')}
      variant={active ? 'solid' : 'soft'}
      size="lg"
      className={className}
      onClick={() => (active ? usePlaySession.getState().stopReading() : usePlaySession.getState().requestRead())}
    >
      {active ? '⏹️' : '🔊'}
    </IconButton>
  );
}

function PlacementDots({ answered, total }: { answered: number; total: number }) {
  const t = useT();
  const current = Math.min(total, answered + 1);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="placement-dots">
      <span className="font-display text-base font-bold text-sky-700">{t('play.frame.placement.step', { n: current, total })}</span>
      <span aria-hidden="true" className="flex gap-1.5">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cx('h-3 w-3 rounded-full', index < answered ? 'bg-sky-600' : index === answered ? 'bg-sky-400 ring-2 ring-sky-600' : 'bg-white ring-1 ring-sky-400')}
          />
        ))}
      </span>
    </div>
  );
}

const FRAME_CLASS: Record<Frame, string> = {
  plain: 'border-brand-200 bg-white',
  story: 'border-brand-200 bg-white',
  check: 'border-sun-500 bg-sun-100',
  placement: 'border-sky-400 bg-sky-100',
};

/**
 * The question, in a card that doubles as Pip's speech bubble: while Pip sits
 * in his home spot the card keeps a seat for him in its top right corner.
 */
function PromptCard({ record, small }: { record: ChallengeRecord; small: boolean }) {
  const t = useT();
  const calm = useReducedMotion();
  const docked = usePlaySession((s) => s.botDocked);
  const placement = usePlaySession((s) => s.placement);
  const story = usePlaySession((s) => s.story);
  const frame = frameOf(record);
  const content = record.content;

  // The intro comes first, then the question: after that the child is answering.
  useEffect(() => {
    const timer = setTimeout(() => usePlaySession.getState().beginAnswering(), calm ? 0 : 900);
    return () => clearTimeout(timer);
  }, [record.id, calm]);

  return (
    <section
      aria-label={t('play.question')}
      data-frame={frame}
      data-testid="prompt-card"
      className={cx('relative flow-root min-h-[88px] rounded-[1.75rem] border-4 p-4 shadow-card sm:min-h-[108px] sm:p-5', FRAME_CLASS[frame])}
    >
      {/* Pip's seat: the first lines flow around him, the question below gets the full width. */}
      {docked && <span aria-hidden="true" data-bot-seat="" data-testid="pip-seat" className="float-right h-[62px] w-[68px] sm:h-[78px] sm:w-[84px]" />}
      {frame === 'check' && (
        <p className="mb-1.5 font-display text-lg font-bold leading-tight text-ink-900 sm:text-xl">
          <span aria-hidden="true" className="mr-1.5 inline-block animate-twinkle text-2xl">
            ⭐
          </span>
          <span>{t('play.frame.check.title')}</span> <span className="text-base text-sun-700 sm:text-lg">{t('play.frame.check.text')}</span>
        </p>
      )}
      {frame === 'placement' && (
        <div className="mb-1.5 flex flex-col gap-1">
          <p className="font-display text-lg font-bold leading-tight text-ink-900">
            <span aria-hidden="true" className="mr-1.5">
              🧭
            </span>
            {t('play.frame.placement')}
          </p>
          {placement && <PlacementDots answered={placement.answered} total={placement.total} />}
        </div>
      )}
      {frame !== 'placement' && (
        <p className="mb-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-0.5 text-sm font-bold text-brand-700 ring-1 ring-brand-200">
            <span aria-hidden="true">{MODE_EMOJI[record.mode]}</span>
            {frame === 'story' && story ? t('play.frame.chapter', { n: story.chapterIndex + 1, total: story.chapterCount }) : modeName(record.mode)}
          </span>
        </p>
      )}
      <h1 className="break-words font-display text-lg font-bold leading-tight text-brand-700 sm:text-xl">{content.title}</h1>
      <motion.p
        key={`intro-${record.id}`}
        initial={calm ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={cx('mt-1 text-base font-semibold leading-snug text-ink-700 sm:text-lg', small && 'sr-only')}
      >
        {content.intro}
      </motion.p>
      <div className="clear-both flex items-start gap-2 pt-1.5">
        <ReadButton className="shrink-0" />
        <motion.p
          key={`question-${record.id}`}
          initial={calm ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: calm ? 0 : 0.45 }}
          data-testid="question"
          className={cx(
            'flex min-h-14 min-w-0 flex-1 items-center break-words font-display font-bold leading-snug text-ink-900',
            // A long question (a robot mission, say) is set smaller, so the picture stays on the screen.
            Array.from(content.question).length > LONG_QUESTION ? 'text-lg sm:text-2xl' : 'text-[1.375rem] sm:text-3xl',
          )}
        >
          {content.question}
        </motion.p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Story chapter
// ---------------------------------------------------------------------------

/** The chapter is told before its challenge. The picture arrives later than the text, so it is read live. */
function StoryCard({ story }: { story: StoryView }) {
  const t = useT();
  const calm = useReducedMotion();
  const docked = usePlaySession((s) => s.botDocked);
  const image = useLiveQuery(
    async () => (await db.stories.get(story.storyId))?.chapters[story.chapterIndex]?.imageDataUrl ?? null,
    [story.storyId, story.chapterIndex],
    null,
  );
  const picture = typeof image === 'string' && image.startsWith('data:image/') ? image : null;
  return (
    <motion.section
      aria-labelledby="play-story-heading"
      data-testid="story-card"
      initial={calm ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col gap-4 rounded-[1.75rem] border-4 border-brand-200 bg-white p-4 shadow-card sm:p-6"
    >
      <div className="flow-root min-h-[62px] sm:min-h-[74px]">
        {docked && <span aria-hidden="true" data-bot-seat="" className="float-right h-[62px] w-[68px] sm:h-[74px] sm:w-[80px]" />}
        <p>
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-0.5 text-sm font-bold text-brand-700 ring-1 ring-brand-200">
            <span aria-hidden="true">📖</span>
            {t('play.frame.chapter', { n: story.chapterIndex + 1, total: story.chapterCount })}
          </span>
        </p>
        <p className="mt-1 text-base font-bold text-ink-700">{story.title}</p>
        <h1 id="play-story-heading" className="mt-1 break-words font-display text-2xl font-bold leading-tight text-brand-700 sm:text-3xl">
          {story.heading}
        </h1>
      </div>
      {picture !== null && <img src={picture} alt={t('play.story.picture')} className="max-h-72 w-full rounded-3xl object-cover shadow-inner" />}
      <p className="whitespace-pre-line text-xl font-semibold leading-relaxed text-ink-900 sm:text-2xl">{story.narrative}</p>
      <div className="flex items-center gap-3">
        <ReadButton />
        <BigButton tone="brand" size="lg" emoji="✨" className="flex-1 px-4! text-xl! sm:text-2xl!" onClick={() => usePlaySession.getState().beginChallenge()}>
          {t('play.story.start')}
        </BigButton>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function PlayScreen(): JSX.Element {
  const { childId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const t = useT();
  const calm = useReducedMotion();
  const labels = useStageLabels();
  const scrollRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const phase = usePlaySession((s) => s.phase);
  const record = usePlaySession((s) => s.challenge);
  const story = usePlaySession((s) => s.story);
  const exit = usePlaySession((s) => s.exit);
  const urlReset = usePlaySession((s) => s.urlReset);
  const highlightIds = usePlaySession((s) => s.highlightIds);
  const celebrate = usePlaySession((s) => s.celebrate);
  const resetKey = usePlaySession((s) => s.resetKey);
  const panelOpen = usePlaySession((s) => s.panelOpen);
  const breakOpen = usePlaySession((s) => s.breakOpen);
  const walkthroughOpen = usePlaySession((s) => s.walkthroughOpen);
  const botInset = usePlaySession((s) => s.botInset);
  const submitAnswer = usePlaySession((s) => s.submitAnswer);

  const child = useLiveQuery(() => db.children.get(childId), [childId]);

  // Enter and leave. The request is read once: later changes of the query come from this screen itself.
  const firstRequest = useRef(parseRequest(search));
  useEffect(() => {
    void usePlaySession.getState().start(childId, firstRequest.current);
    return () => {
      void usePlaySession.getState().leave();
    };
  }, [childId]);

  useEffect(() => {
    if (exit !== null) navigate(exit, { replace: true });
  }, [exit, navigate]);

  // A studio idea was drawn, or a story ended: a reload must not ask for it again.
  const seenReset = useRef(urlReset);
  useEffect(() => {
    if (urlReset === seenReset.current) return;
    seenReset.current = urlReset;
    navigate({ search: '' }, { replace: true });
  }, [urlReset, navigate]);

  useEffect(() => {
    const session = usePlaySession.getState();
    const onVisibility = () => session.setVisible(document.visibilityState === 'visible');
    const onPageHide = () => void usePlaySession.getState().recordIfSolved();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Badge names and reasons are translated by the child area; make sure its words are loaded
  // when the screen was opened directly in another language.
  useEffect(() => {
    if (getLocale() !== 'en') void import('@/child').catch(() => undefined);
  }, []);

  // A new challenge starts at the top. While Pip shows how, the picture he points at is
  // brought into view above the sheet (on wide landscape screens the sheet is at the side).
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller?.scrollTo) return;
    const stage = stageRef.current;
    const sheetBelow = typeof window.matchMedia !== 'function' || !window.matchMedia(SIDE_SHEET_QUERY).matches;
    if (walkthroughOpen && stage && sheetBelow) {
      const top = stage.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, top - 8) });
      return;
    }
    scroller.scrollTo({ top: 0 });
  }, [record?.id, phase === 'story', walkthroughOpen]);

  const goHome = useCallback(() => navigate(playHomePath(childId)), [navigate, childId]);
  const touch = useCallback(() => usePlaySession.getState().touch(), []);

  const answering = phase === 'presenting' || phase === 'answering';
  const stageDisabled = !answering || panelOpen || breakOpen;
  const small = child?.ageGroup === '3-5';

  return (
    <div
      data-testid="play-screen"
      data-phase={phase}
      aria-label={t('play.screen')}
      className="child-bg relative flex h-full flex-col overflow-hidden text-ink-900"
      onPointerDownCapture={touch}
      onKeyDownCapture={touch}
    >
      <TopBar child={child} onHome={goHome} />
      <main ref={scrollRef} className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-safe pt-2 pb-safe">
        <div
          data-bot-dock=""
          // While Pip rests next to Check (the question card has scrolled away), the Check bar leaves him room.
          style={{ '--stage-check-inset': `${botInset}px` } as CSSProperties}
          className={cx(
            'mx-auto flex w-full max-w-[34rem] flex-1 flex-col gap-3 lg:landscape:max-w-6xl lg:landscape:pb-28',
            // Room to scroll the picture up while a sheet covers the lower part of the screen.
            walkthroughOpen ? 'pb-[64dvh]' : 'pb-28',
          )}
        >
          {(phase === 'loading' || phase === 'idle' || !record) && <LoadingView />}
          {record && phase === 'story' && story && <StoryCard story={story} />}
          {record && phase !== 'loading' && phase !== 'story' && (
            <motion.div
              key={record.id}
              initial={calm ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col gap-3"
            >
              <PromptCard record={record} small={small} />
              <div ref={stageRef}>
                <ChallengeStage
                  challenge={record.content}
                  onSubmit={submitAnswer}
                  disabled={stageDisabled}
                  highlightIds={highlightIds}
                  reducedMotion={calm}
                  celebrate={celebrate}
                  resetKey={resetKey}
                  labels={labels}
                />
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {record && <HelperBot childId={childId} />}
      <WalkthroughSheet />
      <BreakSheet onHome={goHome} />
      <SolvedSheet child={child} onHome={goHome} />
    </div>
  );
}
