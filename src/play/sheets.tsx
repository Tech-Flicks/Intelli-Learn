/**
 * The panels that slide in over the play screen: the walkthrough steps, the
 * solved moment (celebration, teach-back, rewards) and the slow-breath break.
 *
 * A sheet comes from the bottom on phones and upright tablets and sits at the
 * right on wide screens, so the canvas stays in view on anything tablet-sized.
 * None of them has a way to skip a challenge.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { ChildProfile } from '@/core/types';
import { hasString, stageName, strandName, t as translate, tn, useT } from '@/i18n';
import { companionEmoji, getBadge, getCompanionDef } from '@/progression';
import { BigButton, Spinner, cx, useReducedMotion } from '@/ui';
import { rotate, type RewardSummary } from './machine';
import { usePlaySession } from './session';
import { LINE_COUNTS } from './strings';
import './play.css';

type SheetTone = 'brand' | 'sun' | 'leaf' | 'sky';

const SHEET_TONE: Record<SheetTone, string> = {
  brand: 'border-brand-300',
  sun: 'border-sun-400',
  leaf: 'border-leaf-400',
  sky: 'border-sky-400',
};

/** The frame of every sheet. Takes the focus when it opens, so keyboard and screen-reader users land in it. */
export function Sheet(props: {
  labelledBy: string;
  tone?: SheetTone;
  testId: string;
  /** A low sheet leaves the upper half of a phone screen to the picture. */
  low?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const { labelledBy, tone = 'brand', testId, low = false, footer, children } = props;
  const calm = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <motion.section
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      data-testid={testId}
      initial={calm ? false : { y: 56, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className={cx(
        'fixed inset-x-0 bottom-0 z-30 mx-auto flex w-full max-w-2xl flex-col rounded-t-[2rem] border-4 border-b-0 bg-white text-ink-900 shadow-lift outline-none',
        // A tall sheet stops below Pip's home in the top right corner.
        low ? 'max-h-[52dvh]' : 'max-h-[calc(100dvh-10.5rem)]',
        'sm:bottom-4 sm:max-h-[56dvh] sm:w-[calc(100%-2rem)] sm:rounded-[2rem] sm:border-b-4',
        'lg:landscape:inset-x-auto lg:landscape:right-4 lg:landscape:mx-0 lg:landscape:max-h-[calc(100dvh-13rem)] lg:landscape:w-[min(30rem,44vw)]',
        SHEET_TONE[tone],
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-2">{children}</div>
      {footer !== undefined && <div className="flex flex-col gap-2 px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Walkthrough
// ---------------------------------------------------------------------------

/** The worked steps, one at a time. After the last one the answer is still the child's to enter. */
export function WalkthroughSheet(): JSX.Element | null {
  const t = useT();
  const titleId = useId();
  const open = usePlaySession((s) => s.walkthroughOpen);
  const step = usePlaySession((s) => s.walkthroughStep);
  const text = usePlaySession((s) => s.walkthroughText);
  const thinking = usePlaySession((s) => s.thinking);
  const total = usePlaySession((s) => s.challenge?.content.walkthrough.length ?? 0);
  if (!open || total === 0) return null;
  const last = step >= total - 1;
  return (
    <Sheet
      labelledBy={titleId}
      tone="leaf"
      testId="walkthrough-sheet"
      low
      footer={
        <BigButton
          tone="leaf"
          size="lg"
          fullWidth
          emoji={last ? '✏️' : '👉'}
          disabled={thinking || text === null}
          onClick={() => void usePlaySession.getState().nextWalkthroughStep()}
        >
          {last ? t('play.walk.done') : t('play.walk.next')}
        </BigButton>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={titleId} className="font-display text-2xl font-bold leading-tight">
          <span aria-hidden="true" className="mr-2">
            🪜
          </span>
          {t('play.walk.title')}
        </h2>
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-bold text-ink-700">{t('play.walk.step', { n: step + 1, total })}</span>
          <span aria-hidden="true" className="flex gap-1.5">
            {Array.from({ length: total }, (_, index) => (
              <span key={index} className={cx('h-3 w-3 rounded-full', index <= step ? 'bg-leaf-600' : 'bg-ink-200')} />
            ))}
          </span>
        </div>
      </div>
      <p key={step} role="status" className="mt-3 min-h-[3.5rem] animate-rise text-2xl font-bold leading-snug">
        {text ?? t('play.thinking')}
      </p>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The slow breath
// ---------------------------------------------------------------------------

/** Offered when the answers look like frustration. The child may carry on at once. */
export function BreakSheet({ onHome }: { onHome: () => void }): JSX.Element | null {
  const t = useT();
  const titleId = useId();
  const open = usePlaySession((s) => s.breakOpen);
  if (!open) return null;
  return (
    <Sheet
      labelledBy={titleId}
      tone="sky"
      testId="break-sheet"
      footer={
        <>
          <BigButton tone="sky" size="lg" fullWidth emoji="💪" onClick={() => usePlaySession.getState().closeBreak()}>
            {t('play.break.continue')}
          </BigButton>
          <BigButton tone="white" size="md" fullWidth emoji="🏡" onClick={onHome}>
            {t('play.break.home')}
          </BigButton>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 id={titleId} className="font-display text-3xl font-bold leading-tight">
          {t('play.break.title')}
        </h2>
        <div aria-hidden="true" className="flex h-32 w-32 items-center justify-center">
          <div className="play-breathe flex h-28 w-28 items-center justify-center rounded-full border-4 border-sky-400 bg-sky-100 text-5xl">🫧</div>
        </div>
        <p className="font-display text-2xl font-bold text-sky-700">
          {t('play.break.in')} {t('play.break.out')}
        </p>
        <p className="text-xl font-semibold text-ink-700">{t('play.break.text')}</p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Solved: celebration, teach-back, rewards
// ---------------------------------------------------------------------------

/** A translated catalogue text when the child module has registered one, else the English text stored with the reward. */
function translated(key: string, fallback: string): string {
  return hasString(key) ? translate(key) : fallback;
}

function InfoCard({ emoji, title, tone, children }: { emoji: string; title: string; tone: string; children: ReactNode }) {
  return (
    <div className={cx('flex gap-3 rounded-3xl border-2 p-3', tone)}>
      <span aria-hidden="true" className="text-3xl leading-none">
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-lg font-bold leading-tight text-ink-900">{title}</h3>
        <div className="text-lg font-semibold leading-snug text-ink-700">{children}</div>
      </div>
    </div>
  );
}

/** Stars that fly from the reward row into the counter of the top bar. Each one that lands is added to the count. */
function StarFlight({ count }: { count: number }): JSX.Element | null {
  const calm = useReducedMotion();
  const [flight, setFlight] = useState<{ fromX: number; fromY: number; toX: number; toY: number } | null>(null);

  useLayoutEffect(() => {
    const source = document.querySelector('[data-star-source]');
    const target = document.querySelector('[data-star-target]');
    if (calm || !source || !target) {
      usePlaySession.setState({ starsPending: 0 });
      return;
    }
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    setFlight({
      fromX: from.left + from.width / 2,
      fromY: from.top + from.height / 2,
      toX: to.left + to.width / 2,
      toY: to.top + to.height / 2,
    });
    // Whatever happens to the animation, every star is counted in the end.
    const timer = setTimeout(() => usePlaySession.setState({ starsPending: 0 }), 1400 + count * 220);
    return () => clearTimeout(timer);
  }, [calm, count]);

  if (!flight) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50">
      {Array.from({ length: count }, (_, index) => (
        <motion.span
          key={index}
          className="absolute left-0 top-0 text-3xl leading-none"
          initial={{ x: flight.fromX - 15, y: flight.fromY - 15, scale: 1.3, opacity: 0 }}
          animate={{ x: flight.toX - 15, y: flight.toY - 15, scale: 0.6, opacity: [0, 1, 1, 0.2] }}
          transition={{ duration: 0.85, delay: 0.55 + index * 0.18, ease: [0.5, 0, 0.6, 1] }}
          onAnimationComplete={() => usePlaySession.getState().landStar()}
        >
          ⭐
        </motion.span>
      ))}
    </div>
  );
}

function Rewards({ rewards, child }: { rewards: RewardSummary; child: ChildProfile | undefined }) {
  const t = useT();
  const companionName = child ? child.companion.name.trim() || (getCompanionDef(child.companion.species)?.name ?? '') : '';
  return (
    <div className="flex flex-col gap-3" data-testid="rewards">
      <div className="flex flex-col items-center gap-1 rounded-3xl border-2 border-sun-400 bg-sun-100 px-4 py-3 text-center">
        <div data-star-source="" aria-hidden="true" className="flex gap-1 text-4xl leading-none">
          {Array.from({ length: rewards.stars }, (_, index) => (
            <span key={index} className="play-star inline-block" style={{ animationDelay: `${index * 140}ms` }}>
              ⭐
            </span>
          ))}
        </div>
        <p className="font-display text-2xl font-bold" data-testid="stars-earned">
          {tn('play.rewards.stars.one', 'play.rewards.stars.other', rewards.stars)}
        </p>
        <p className="text-lg font-semibold text-ink-700">
          {t(`play.reward.star.${rewards.outcome}`)}
          {rewards.teachBonus && ` ${t('play.reward.teachBonus')}`}
        </p>
      </div>
      {rewards.stars > 0 && <StarFlight count={rewards.stars} />}

      {rewards.placementFinished && (
        <InfoCard emoji="🧭" title={t('play.rewards.placement')} tone="border-sky-400 bg-sky-100">
          {null}
        </InfoCard>
      )}
      {rewards.stageUps.map((up) => (
        <InfoCard
          key={up.strand}
          emoji="📈"
          title={t('play.rewards.stage', { stage: stageName(up.to), strand: strandName(up.strand) })}
          tone="border-leaf-400 bg-leaf-100"
        >
          {null}
        </InfoCard>
      ))}
      {rewards.badges.map((badge) => {
        const def = getBadge(badge.key);
        return (
          <InfoCard key={badge.key} emoji={def?.emoji ?? '🏅'} title={`${t('play.rewards.badge')} ${translated(`child.badge.${badge.key}.name`, def?.name ?? badge.key)}`} tone="border-brand-300 bg-brand-50">
            {translated(`child.badge.${badge.key}.reason`, badge.reason)}
          </InfoCard>
        );
      })}
      {rewards.companionGrew && child && (
        <InfoCard emoji={companionEmoji(child.companion)} title={t('play.rewards.companion')} tone="border-coral-400 bg-coral-100">
          {t(`play.reward.companion.${Math.max(1, Math.min(4, child.companion.growth))}`)}
          {companionName !== '' && <span className="sr-only"> {companionName}</span>}
        </InfoCard>
      )}
      {rewards.streakDays !== null && (
        <InfoCard emoji="🔥" title={tn('play.rewards.streak.one', 'play.rewards.streak.other', rewards.streakDays)} tone="border-coral-400 bg-coral-100">
          {t('play.rewards.streak.text')}
        </InfoCard>
      )}
    </div>
  );
}

/** Everything after the right answer: the celebration, why it works, teaching Pip, the rewards, and the way on. */
export function SolvedSheet({ child, onHome }: { child: ChildProfile | undefined; onHome: () => void }): JSX.Element | null {
  const t = useT();
  const titleId = useId();
  const phase = usePlaySession((s) => s.phase);
  const record = usePlaySession((s) => s.challenge);
  const celebrate = usePlaySession((s) => s.celebrate);
  const passed = usePlaySession((s) => s.checkPassed);
  const willTeachBack = usePlaySession((s) => s.willTeachBack);
  const teachBack = usePlaySession((s) => s.teachBack);
  const rewards = usePlaySession((s) => s.rewards);
  const storyEnding = usePlaySession((s) => s.storyEnding);
  const allowed = usePlaySession((s) => s.allowance?.allowed !== false);

  if (!record || (phase !== 'solved' && phase !== 'teachback' && phase !== 'recorded')) return null;
  const content = record.content;
  const isCheck = record.purpose === 'check';
  const title = passed
    ? t('play.solved.check.title')
    : isCheck
      ? t('play.solved.checkHelp.title')
      : t(`play.solved.${rotate(Array.from({ length: LINE_COUNTS.solved }, (_, index) => index + 1), celebrate)}`);
  const subtitle = passed ? t('play.solved.check.text') : isCheck ? t('play.solved.checkHelp.text') : null;
  const asking = phase === 'teachback' && teachBack !== null && teachBack.chosenId === null;
  const taught = teachBack !== null && teachBack.chosenId !== null;
  const session = usePlaySession.getState();

  let footer: ReactNode;
  if (phase === 'recorded') {
    footer = (
      <>
        {rewards?.suggestBreak && allowed && (
          <BigButton tone="white" size="md" fullWidth emoji="🏡" onClick={onHome}>
            {t('play.rewards.breakButton')}
          </BigButton>
        )}
        <BigButton
          tone={allowed ? 'brand' : 'sun'}
          size="xl"
          fullWidth
          emoji={allowed ? '🚀' : '🌙'}
          className="px-4! text-2xl! sm:text-3xl!"
          data-testid="next-button"
          onClick={() => void session.next()}
        >
          {allowed ? t('play.next') : t('play.rest')}
        </BigButton>
      </>
    );
  } else if (phase === 'solved' && willTeachBack) {
    footer = (
      <BigButton tone="brand" size="lg" fullWidth emoji="👉" onClick={() => session.continueAfterSolved()}>
        {t('play.solved.continue')}
      </BigButton>
    );
  } else if (!asking) {
    footer = (
      <div className="flex min-h-16 items-center justify-center">
        <Spinner size="md" label={t('play.saving')} showLabel />
      </div>
    );
  }

  return (
    <Sheet labelledBy={titleId} tone={passed ? 'sun' : 'brand'} testId="solved-sheet" footer={footer}>
      <div className="flex flex-col gap-3">
        <div className={cx('text-center', passed && 'rounded-3xl bg-sun-100 px-3 py-4')}>
          {passed && (
            <p aria-hidden="true" className="text-5xl leading-none">
              🏆
            </p>
          )}
          <h2 id={titleId} className={cx('font-display font-bold leading-tight', passed ? 'text-4xl' : 'text-3xl')}>
            {title}
          </h2>
          {subtitle !== null && <p className="mt-1 text-xl font-bold text-ink-700">{subtitle}</p>}
        </div>

        {asking && content.teachBack ? (
          <div className="flex flex-col gap-3" data-testid="teachback">
            <InfoCard emoji="🎓" title={t('play.teach.title')} tone="border-brand-300 bg-brand-50">
              {content.teachBack.prompt}
            </InfoCard>
            <div className="flex flex-col gap-2">
              {content.teachBack.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void session.answerTeachBack(option.id)}
                  className="min-h-16 rounded-3xl border-4 border-brand-200 bg-white px-4 py-3 text-left text-lg font-bold leading-snug text-ink-900 shadow-card transition-colors hover:border-brand-400 active:bg-brand-50"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {phase === 'recorded' && storyEnding !== null && (
              <InfoCard emoji="📖" title={t('play.story.end')} tone="border-brand-300 bg-brand-50">
                {storyEnding}
              </InfoCard>
            )}
            {taught ? (
              <InfoCard emoji="🎓" title={t('play.teach.reply')} tone="border-brand-300 bg-brand-50">
                <span role="status">{teachBack.feedback ?? t('play.thinking')}</span>
              </InfoCard>
            ) : (
              <>
                <InfoCard emoji="💡" title={t('play.solved.why')} tone="border-leaf-400 bg-leaf-100">
                  {content.explanation}
                </InfoCard>
                {content.funFact !== undefined && content.funFact !== '' && (
                  <InfoCard emoji="🤩" title={t('play.solved.funFact')} tone="border-sky-400 bg-sky-100">
                    {content.funFact}
                  </InfoCard>
                )}
              </>
            )}
            {phase === 'recorded' && rewards && <Rewards rewards={rewards} child={child} />}
            {phase === 'recorded' && !allowed && <p className="text-center text-xl font-bold text-ink-700">{t('play.rest.text')}</p>}
            {phase === 'recorded' && rewards?.suggestBreak && allowed && (
              <p className="text-center text-lg font-semibold text-ink-700">{t('play.rewards.break')}</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
