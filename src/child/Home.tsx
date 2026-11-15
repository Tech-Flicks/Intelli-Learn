/** `/kids/:childId`: the adventure map home. */
import { Navigate, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { usePipMood } from '@/bot/pip';
import type { PlayAllowance, Strand } from '@/core/types';
import { tn, useT } from '@/i18n';
import { companionEmoji, getStrandStages } from '@/progression';
import { BigButton, ChildShell, IconButton, cx, useReducedMotion } from '@/ui';
import { useSpeaking } from '@/voice';
import { AdventureMap } from './AdventureMap';
import { companionName, growthName } from './catalog';
import { useChildScreen, usePlayAllowance, useScreenVoice, wantsReadAloud } from './hooks';
import { buildWorlds } from './map';
import { ModeLauncher, visibleModes, type CreativeMode } from './ModeLauncher';
import { ChildLoading, PipFigure, ScreenColumn, SectionHeading, SpeakerButton, StreakFlame, TopBarStars } from './parts';
import './strings';

/**
 * Time left today as a sun travelling towards the moon. No numbers on the screen, so the
 * child is not counting minutes; the number is in the accessible name.
 */
export function SunMeter({ allowance, small }: { allowance: PlayAllowance; small: boolean }) {
  const t = useT();
  const total = allowance.minutesLeft + allowance.minutesUsedToday;
  const used = total > 0 ? Math.min(1, Math.max(0, allowance.minutesUsedToday / total)) : 0;
  return (
    <div
      role="img"
      aria-label={tn('child.home.time.one', 'child.home.time.other', allowance.minutesLeft)}
      data-testid="sun-meter"
      className="flex min-h-16 flex-col justify-center gap-1 rounded-3xl border-2 border-brand-200 bg-white px-4 py-2 text-ink-900 shadow-card"
    >
      {!small && (
        <span aria-hidden="true" className="text-sm font-bold text-ink-700">
          {t('child.home.time.label')}
        </span>
      )}
      <span aria-hidden="true" className="flex items-center gap-2">
        <span className="relative h-4 flex-1 rounded-full bg-gradient-to-r from-sun-300 via-sun-100 to-brand-200">
          <span
            className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xl leading-none shadow-card transition-[left] duration-700"
            style={{ left: `calc(1rem + (100% - 2rem) * ${used.toFixed(3)})` }}
          >
            ☀️
          </span>
        </span>
        <span className="text-2xl leading-none">🌙</span>
      </span>
    </div>
  );
}

export function HomeScreen() {
  const { child, controls, small } = useChildScreen();
  const t = useT();
  const navigate = useNavigate();
  const calm = useReducedMotion();
  const speaking = useSpeaking();
  const base = `/kids/${child.id}`;

  const allowanceState = usePlayAllowance(child.id);
  const allowance = allowanceState.status === 'ready' ? allowanceState.allowance : null;
  const strandStages = useLiveQuery(() => getStrandStages(child.id), [child.id]);

  const worlds = buildWorlds(controls, strandStages ?? [], child.grade);

  const started = child.placementDone;
  const pipLine = small ? t('child.home.pip.small') : started ? t('child.home.pip.go') : t('child.home.pip.start');
  // Spoken text never holds the nickname: a browser voice may be a network voice.
  const spokenLine = small ? t('child.home.say.small') : started ? t('child.home.say.go') : t('child.home.say.start');
  const voice = useScreenVoice({
    line: allowance?.allowed ? spokenLine : null,
    enabled: controls.voiceOutput,
    auto: wantsReadAloud(child),
    rate: child.voiceRate,
  });
  const [pipState, react] = usePipMood(speaking ? 'talking' : started ? 'happy' : 'curious');

  if (allowance && !allowance.allowed) return <Navigate to={`${base}/rest`} replace />;
  if (!allowance) return <ChildLoading />;

  const friend = companionName(child.companion);
  const openMode = (mode: CreativeMode) => navigate(mode === 'studio' ? `${base}/studio` : `${base}/play?mode=${mode}`);
  const openWorld = (strand: Strand) => navigate(`${base}/play?strand=${strand}`);

  return (
    <ChildShell
      tone="day"
      topBar={
        <>
          <IconButton aria-label={t('child.switchPlayer')} variant="soft" size="lg" onClick={() => navigate('/kids')}>
            🏠
          </IconButton>
          <span className="flex-1" />
          <StreakFlame days={child.streakDays} />
          <TopBarStars count={child.stars} />
          <SpeakerButton voice={voice} />
        </>
      }
    >
      <ScreenColumn className="pb-6">
        {/* Greeting */}
        <section className="flex items-end gap-2 sm:gap-4">
          <PipFigure
            state={pipState}
            talking={speaking}
            lookAt="pointer"
            onTap={() => react('giggle')}
            className="h-28 w-28 sm:h-40 sm:w-40"
          />
          <motion.div
            initial={calm ? false : { opacity: 0, scale: 0.9, x: -12 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="relative mb-4 min-w-0 flex-1 rounded-3xl bg-white px-5 py-4 text-ink-900 shadow-card"
          >
            <span aria-hidden="true" className="absolute -left-2 bottom-6 h-5 w-5 rotate-45 rounded-sm bg-white" />
            <h1 className="relative break-words font-display text-3xl font-bold leading-tight sm:text-4xl">
              {t('child.home.hello', { name: child.nickname })}
            </h1>
            <p className={cx('relative mt-1 font-semibold text-ink-700', small ? 'text-xl' : 'text-lg')}>{pipLine}</p>
          </motion.div>
        </section>

        {/* The one big thing to do */}
        <BigButton
          tone="sun"
          size="xl"
          emoji={started ? '🚀' : '✨'}
          fullWidth
          onClick={() => navigate(`${base}/play`)}
          className="px-4! text-2xl! sm:mx-auto sm:max-w-xl sm:px-10! sm:text-3xl!"
        >
          {started ? t('child.home.play.go') : t('child.home.play.start')}
        </BigButton>

        {/* Companion and shelf, time left */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <motion.button
            type="button"
            onClick={() => navigate(`${base}/shelf`)}
            aria-label={`${t('child.home.shelf')}. ${t('child.home.companion', { name: friend })}`}
            whileHover={calm ? undefined : { y: -3 }}
            whileTap={calm ? undefined : { scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 20 }}
            className="flex min-h-16 items-center gap-3 rounded-3xl border-2 border-brand-200 bg-white px-4 py-2 text-left text-ink-900 shadow-card"
          >
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 animate-float items-center justify-center whitespace-nowrap text-4xl leading-none">
              {companionEmoji(child.companion)}
            </span>
            <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="break-words font-display text-xl font-bold leading-tight">{t('child.home.shelf')}</span>
              {!small && (
                <span className="truncate text-sm font-semibold text-ink-700">
                  {friend} · {growthName(child.companion.growth)}
                </span>
              )}
            </span>
            <span aria-hidden="true" className="text-2xl leading-none">
              🏆
            </span>
          </motion.button>
          <SunMeter allowance={allowance} small={small} />
        </section>

        {/* Adventure map */}
        <section aria-labelledby="child-map-title" className="flex flex-col gap-3">
          <SectionHeading
            id="child-map-title"
            emoji="🗺️"
            aside={!small && <p className="text-base font-semibold opacity-80">{t('child.home.mapHint')}</p>}
          >
            {t('child.home.mapTitle')}
          </SectionHeading>
          <AdventureMap worlds={worlds} avatar={child.avatar} small={small} onPlay={openWorld} />
        </section>

        {/* Creative modes */}
        <section aria-labelledby="child-modes-title" className="flex flex-col gap-3">
          <SectionHeading id="child-modes-title" emoji="🎪">
            {t('child.home.modesTitle')}
          </SectionHeading>
          <ModeLauncher modes={visibleModes(controls.realWorldMissions)} locked={!started} small={small} onOpen={openMode} />
        </section>
      </ScreenColumn>
    </ChildShell>
  );
}
