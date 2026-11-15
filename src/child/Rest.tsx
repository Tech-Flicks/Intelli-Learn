/**
 * `/kids/:childId/rest`: the calm ending of the day. Shown when the daily play time is
 * used up or when it is outside the hours the parent allows. No way to keep playing from
 * here; the screen sends the child back home by itself once play is allowed again.
 */
import { Navigate, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { getLocale, tn, useT } from '@/i18n';
import { BigButton, ChildShell, StarCount, useReducedMotion } from '@/ui';
import { useChildScreen, usePlayAllowance, useScreenVoice, wantsReadAloud } from './hooks';
import { ChildLoading, PipFigure, SpeakerButton } from './parts';
import { formatHour, getTodaySummary } from './today';
import './strings';

export function RestScreen() {
  const { child, controls } = useChildScreen();
  const t = useT();
  const navigate = useNavigate();
  const calm = useReducedMotion();
  const allowanceState = usePlayAllowance(child.id);
  const allowance = allowanceState.status === 'ready' ? allowanceState.allowance : null;
  const today = useLiveQuery(() => getTodaySummary(child.id), [child.id]);

  const resting = allowance !== null && !allowance.allowed;
  const outsideHours = allowance?.reason === 'outside-hours';
  const title = outsideHours ? t('child.rest.hours.title') : t('child.rest.daily.title');
  const text = outsideHours
    ? t('child.rest.hours.text', { time: formatHour(controls.allowedStartHour, getLocale()) })
    : t('child.rest.daily.text');

  const voice = useScreenVoice({
    line: resting ? `${title} ${text}` : null,
    enabled: controls.voiceOutput,
    auto: wantsReadAloud(child),
    rate: child.voiceRate,
  });

  if (allowance?.allowed) return <Navigate to={`/kids/${child.id}`} replace />;
  if (!allowance) return <ChildLoading />;

  return (
    <ChildShell
      tone={outsideHours ? 'space' : 'sunset'}
      data-reason={allowance.reason}
      topBar={
        <>
          <span className="flex-1" />
          <SpeakerButton voice={voice} />
        </>
      }
      contentClassName="items-center justify-center"
    >
      <motion.div
        initial={calm ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="flex w-full max-w-md flex-col items-center gap-5 pb-6 text-center"
      >
        <PipFigure state="sleeping" className="h-44 w-44 sm:h-56 sm:w-56" />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">{title}</h1>
          <p className="text-2xl font-semibold opacity-90">{text}</p>
        </div>

        {/* On a morning before the allowed hours there is nothing to show for today yet. */}
        {(!outsideHours || (today?.items ?? 0) > 0) && (
          <section aria-label={t('child.rest.today')} className="flex w-full flex-col items-center gap-3 rounded-3xl bg-white px-5 py-4 text-ink-900 shadow-card">
            <h2 className="font-display text-xl font-bold text-ink-700">{t('child.rest.today')}</h2>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <StarCount count={today?.stars ?? 0} size="lg" data-testid="today-stars" />
              <span
                data-testid="today-items"
                className="inline-flex items-center gap-2 rounded-full border-2 border-leaf-400 bg-leaf-100 px-4 py-1.5 font-display text-xl font-bold"
              >
                <span aria-hidden="true">✅</span>
                {tn('child.rest.items.one', 'child.rest.items.other', today?.items ?? 0)}
              </span>
            </div>
          </section>
        )}

        <BigButton tone="white" size="lg" emoji="👋" onClick={() => navigate('/kids')}>
          {t('child.rest.back')}
        </BigButton>
      </motion.div>
    </ChildShell>
  );
}
