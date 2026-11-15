/** `/kids`: "Who is playing?" */
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import { usePipMood } from '@/bot/pip';
import { listChildren } from '@/data';
import { useT } from '@/i18n';
import { companionEmoji, effectiveControls } from '@/progression';
import { getResetRequest } from '@/security';
import { BigButton, ChildShell, IconButton, cx, useReducedMotion } from '@/ui';
import { useSpeaking } from '@/voice';
import { useScreenVoice, useSettings, wantsReadAloud } from './hooks';
import { ChildLoading, PipFigure, SpeakerButton } from './parts';
import './strings';

/** Ring and tint behind an avatar, in turn. */
const AVATAR_TONE = [
  'border-brand-400 bg-brand-100 shadow-[0_6px_0_var(--color-brand-400)]',
  'border-sun-500 bg-sun-100 shadow-[0_6px_0_var(--color-sun-500)]',
  'border-leaf-400 bg-leaf-100 shadow-[0_6px_0_var(--color-leaf-400)]',
  'border-coral-400 bg-coral-100 shadow-[0_6px_0_var(--color-coral-400)]',
  'border-sky-400 bg-sky-100 shadow-[0_6px_0_var(--color-sky-400)]',
] as const;

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ProfilePicker() {
  const t = useT();
  const navigate = useNavigate();
  const calm = useReducedMotion();
  const speaking = useSpeaking();
  const children = useLiveQuery(() => listChildren(), []);
  const settings = useSettings();
  // A forgotten-password reset that is waiting: it deletes every profile, so a grown-up who
  // did not ask for it must see it here, on the screen every play session starts from.
  const resetRequest = useLiveQuery(() => getResetRequest(), []);
  const ready = children !== undefined && settings !== undefined;

  // The voice follows the players: on when it is on for any of them, and it speaks by
  // itself when one of them is read to.
  const voiceOn = ready
    ? children.length === 0
      ? settings.controls.voiceOutput
      : children.some((child) => effectiveControls(settings, child).voiceOutput)
    : false;
  const auto = ready && children.some((child) => wantsReadAloud(child) && effectiveControls(settings, child).voiceOutput);
  const voice = useScreenVoice({
    line: !ready
      ? null
      : children.length > 0
        ? t('child.picker.say')
        : `${t('child.picker.emptyTitle')}. ${t('child.picker.emptyText')}`,
    enabled: voiceOn,
    auto,
  });
  const [pipState, react] = usePipMood(speaking ? 'talking' : children && children.length === 0 ? 'curious' : 'happy');

  if (!ready) return <ChildLoading />;

  const grownUps = (
    <IconButton
      aria-label={t('child.grownUps')}
      variant="ghost"
      size="md"
      onClick={() => navigate('/parent')}
      className="opacity-70 hover:opacity-100 focus-visible:opacity-100"
    >
      <LockIcon />
    </IconButton>
  );

  return (
    <ChildShell
      tone="day"
      topBar={
        <>
          <SpeakerButton voice={voice} />
          <span className="flex-1" />
          {grownUps}
        </>
      }
      contentClassName="items-center"
    >
      <div className="flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 pb-8 text-center">
        <PipFigure state={pipState} talking={speaking} lookAt="pointer" onTap={() => react('giggle')} className="h-36 w-36 sm:h-48 sm:w-48" />

        {children.length === 0 ? (
          <div className="flex flex-col items-center gap-4">
            <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">{t('child.picker.emptyTitle')}</h1>
            <p className="max-w-md text-xl font-semibold opacity-80">{t('child.picker.emptyText')}</p>
            <BigButton tone="white" size="md" emoji="🔒" onClick={() => navigate('/parent')}>
              {t('child.picker.emptyAction')}
            </BigButton>
          </div>
        ) : (
          <>
            <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">{t('child.picker.title')}</h1>
            <ul className="flex w-full flex-wrap items-start justify-center gap-x-6 gap-y-7 sm:gap-x-10">
              {children.map((child, index) => (
                <motion.li
                  key={child.id}
                  initial={calm ? false : { opacity: 0, y: 24, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20, delay: calm ? 0 : index * 0.07 }}
                  className="flex w-32 justify-center sm:w-40"
                >
                  <motion.button
                    type="button"
                    data-child={child.id}
                    aria-label={t('child.picker.playAs', { name: child.nickname })}
                    onClick={() => navigate(`/kids/${child.id}`)}
                    whileHover={calm ? undefined : { scale: 1.06, rotate: -2 }}
                    whileTap={calm ? undefined : { scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 460, damping: 16 }}
                    className="flex w-full flex-col items-center gap-3 rounded-3xl p-1"
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        'relative flex h-28 w-28 items-center justify-center rounded-full border-4 text-6xl leading-none sm:h-36 sm:w-36 sm:text-7xl',
                        AVATAR_TONE[index % AVATAR_TONE.length],
                      )}
                    >
                      {child.avatar}
                      <span className="absolute -bottom-1 -right-1 flex h-10 min-w-10 items-center justify-center whitespace-nowrap rounded-full border-2 border-white bg-white px-1 text-xl leading-none shadow-card">
                        {companionEmoji(child.companion)}
                      </span>
                    </span>
                    <span aria-hidden="true" className="w-full break-words font-display text-2xl font-bold leading-tight">
                      {child.nickname}
                    </span>
                  </motion.button>
                </motion.li>
              ))}
            </ul>
          </>
        )}

        {resetRequest != null && (
          <p
            role="note"
            data-testid="reset-notice"
            className="max-w-xl rounded-2xl border-2 border-sun-500 bg-white px-4 py-3 text-base font-semibold text-ink-900 shadow-card"
          >
            <span aria-hidden="true">🔒 </span>
            {t('child.picker.resetNotice')}
          </p>
        )}
      </div>
    </ChildShell>
  );
}
