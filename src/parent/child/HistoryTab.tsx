/**
 * History: every finished challenge, newest first, with what the child answered, how much
 * help was used, the helper conversation, an exact replay and the parent's rating.
 */
import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkill } from '@/core/skills';
import { MODES, STRANDS, type AttemptOutcome, type AttemptRecord, type ChallengeRecord, type ChildProfile, type HelperMessage, type Mode, type Strand } from '@/core/types';
import { db } from '@/data';
import { modeName, stageName, strandName, tn } from '@/i18n';
import { rateLibraryItem } from '@/library';
import { Badge, Button, EmptyState, Field, Select, TextInput, useToast, type BadgeTone } from '@/ui';
import { describeAnswer } from '../format';
import { STRAND_EMOJI } from '../forms/ControlsForm';
import { useUnsavedChanges } from '../guard';
import { useFormat } from '../hooks';
import { Fact, PanelLoading, RatingEditor, RatingStars, ReplayModal } from '../parts';
import { buildHistory, EMPTY_HISTORY_FILTER, filterHistory, isFiltering, type HistoryEntry, type HistoryFilter } from './history';

const OUTCOMES: readonly AttemptOutcome[] = ['independent', 'second-try', 'nudge', 'hint', 'walkthrough'];
const OUTCOME_TONE: Record<AttemptOutcome, BadgeTone> = {
  independent: 'success',
  'second-try': 'success',
  nudge: 'info',
  hint: 'info',
  walkthrough: 'warning',
};
const PAGE_SIZE = 15;

function Conversation({ challengeId, childName }: { challengeId: string; childName: string }) {
  const fmt = useFormat();
  const { t } = fmt;
  const messages = useLiveQuery<HelperMessage[]>(
    async () => (await db.messages.where('challengeId').equals(challengeId).toArray()).sort((a, b) => a.at - b.at),
    [challengeId],
  );
  if (messages === undefined) return <p className="text-sm text-ink-500">{t('common.loading')}</p>;
  if (messages.length === 0) return <p className="text-sm text-ink-500">{t('parent.history.noConversation')}</p>;
  return (
    <ol className="flex flex-col gap-2">
      {messages.map((message) => {
        const fromChild = message.role === 'child';
        return (
          <li key={message.id} className={fromChild ? 'ml-6 self-end' : 'mr-6 self-start'}>
            <p className="text-xs font-bold text-ink-500">
              {fromChild ? childName : t('parent.history.helper')} · {t(`parent.history.messageKind.${message.kind}`)}
            </p>
            <p
              className={
                fromChild
                  ? 'rounded-2xl rounded-tr-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-ink-900'
                  : 'rounded-2xl rounded-tl-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900'
              }
            >
              {message.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function AnswerList({ challenge, attempt }: { challenge: ChallengeRecord; attempt: AttemptRecord }) {
  const fmt = useFormat();
  const { t } = fmt;
  if (attempt.answers.length === 0) return <p className="text-sm text-ink-500">{t('parent.history.noAnswers')}</p>;
  return (
    <ol className="flex flex-col gap-1.5">
      {attempt.answers.map((answer, index) => (
        <li key={index} className="flex items-start gap-2 text-sm">
          <Badge tone={answer.correct ? 'success' : 'warning'}>{answer.correct ? t('parent.history.right') : t('parent.history.notYet')}</Badge>
          <span className="min-w-0 flex-1 text-ink-900">
            {describeAnswer(challenge.content, answer.answer, fmt.locale, t)}
            {answer.misconception ? <span className="block text-ink-500">{t('parent.history.misconception', { text: answer.misconception })}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface EntryCardProps {
  entry: HistoryEntry;
  child: ChildProfile;
  onReplay: (challenge: ChallengeRecord) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}

function EntryCard({ entry, child, onReplay, onDirtyChange }: EntryCardProps) {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const { challenge, attempt } = entry;
  const [open, setOpen] = useState(false);
  const skill = getSkill(challenge.skillId);
  const headingId = `history-${challenge.id}`;

  const saveRating = async (rating: number | null, note: string) => {
    if (challenge.libraryId !== null) await rateLibraryItem(challenge.libraryId, rating, note);
    else await db.challenges.update(challenge.id, { parentRating: rating, parentNote: note });
    toast.success(t('parent.rating.saved'));
  };

  const reportDirty = useCallback((dirty: boolean) => onDirtyChange(challenge.id, dirty), [challenge.id, onDirtyChange]);

  return (
    <li>
      <article aria-labelledby={headingId} className="rounded-3xl border border-ink-200 bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1 basis-60">
            <p className="text-sm font-semibold text-ink-500">{fmt.dateTime(entry.at)}</p>
            <h3 id={headingId} className="font-display text-xl font-bold leading-tight">
              {challenge.content.title}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {attempt && (
              <>
                <Badge tone={OUTCOME_TONE[attempt.outcome]} size="md">
                  {t(`parent.outcome.${attempt.outcome}`)}
                </Badge>
                <Badge tone="warning" size="md" emoji="⭐">
                  {tn('common.star', 'common.stars', attempt.starsEarned)}
                </Badge>
              </>
            )}
          </div>
        </div>

        <p className="mt-2 text-base text-ink-900">{challenge.content.question}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="brand" emoji={STRAND_EMOJI[challenge.strand]}>
            {strandName(challenge.strand)}
          </Badge>
          <Badge tone="neutral">{skill?.name ?? challenge.skillId}</Badge>
          <Badge tone="neutral">{stageName(challenge.stage)}</Badge>
          <Badge tone="neutral">{modeName(challenge.mode)}</Badge>
          <Badge tone={challenge.purpose === 'check' ? 'info' : 'neutral'} emoji={challenge.purpose === 'check' ? '🧪' : undefined}>
            {t(`parent.purpose.${challenge.purpose}`)}
          </Badge>
          <Badge tone="neutral">{t(`parent.source.${challenge.source}`)}</Badge>
        </div>

        {attempt ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
            <Fact label={t('parent.history.tries')}>{fmt.number(attempt.answers.length)}</Fact>
            <Fact label={t('parent.history.hints')}>{t(`parent.history.hintLevel.${attempt.hintsUsed}`)}</Fact>
            <Fact label={t('parent.history.walkthrough')}>{attempt.walkthroughUsed ? t('common.yes') : t('common.no')}</Fact>
            <Fact label={t('parent.history.teachBack')}>
              {attempt.teachBackCorrect === null
                ? t('parent.history.teachBack.none')
                : attempt.teachBackCorrect
                  ? t('parent.history.teachBack.right')
                  : t('parent.history.teachBack.wrong')}
            </Fact>
            <Fact label={t('parent.history.time')}>{fmt.duration(attempt.timeMs)}</Fact>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-ink-500">{t('parent.history.noAttempt')}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon="▶️" onClick={() => onReplay(challenge)}>
            {t('parent.history.replay')}
          </Button>
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`${headingId}-more`} onClick={() => setOpen((value) => !value)}>
            {open ? t('parent.history.less') : t('parent.history.more')}
          </Button>
          <span className="ml-auto inline-flex items-center gap-2 text-sm text-ink-700">
            <RatingStars rating={challenge.parentRating} />
          </span>
        </div>

        {open && (
          <div id={`${headingId}-more`} className="mt-4 grid gap-5 border-t border-ink-200 pt-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              {attempt && (
                <div>
                  <h4 className="mb-1.5 font-bold text-ink-900">
                    {t('parent.history.answers', { name: child.nickname })}
                  </h4>
                  <AnswerList challenge={challenge} attempt={attempt} />
                </div>
              )}
              <div>
                <h4 className="mb-1.5 font-bold text-ink-900">{t('parent.history.conversation')}</h4>
                <Conversation challengeId={challenge.id} childName={child.nickname} />
              </div>
            </div>
            <div>
              <h4 className="mb-1.5 font-bold text-ink-900">{t('parent.history.yourRating')}</h4>
              <RatingEditor
                rating={challenge.parentRating}
                note={challenge.parentNote}
                libraryBacked={challenge.libraryId !== null}
                onSave={saveRating}
                onDirtyChange={reportDirty}
              />
            </div>
          </div>
        )}
      </article>
    </li>
  );
}

export function HistoryTab({ child }: { child: ChildProfile }) {
  const fmt = useFormat();
  const { t } = fmt;
  const [filter, setFilter] = useState<HistoryFilter>(EMPTY_HISTORY_FILTER);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [replay, setReplay] = useState<ChallengeRecord | null>(null);
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());

  const rows = useLiveQuery(async () => {
    const [challenges, attempts] = await Promise.all([
      db.challenges.where('[childId+status]').equals([child.id, 'completed']).toArray(),
      db.attempts.where('childId').equals(child.id).toArray(),
    ]);
    return { challenges, attempts };
  }, [child.id]);

  const entries = useMemo(() => (rows ? buildHistory(rows.challenges, rows.attempts) : []), [rows]);
  const visible = useMemo(() => filterHistory(entries, filter), [entries, filter]);

  const onDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  useUnsavedChanges(dirtyIds.size > 0);

  if (!rows) return <PanelLoading />;

  const set = (patch: Partial<HistoryFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    setShown(PAGE_SIZE);
  };
  const replaySkill = replay ? getSkill(replay.skillId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('parent.history.filters')} className="rounded-3xl border border-ink-200 bg-white p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={t('parent.filter.strand')}>
            <Select
              value={filter.strand}
              onValueChange={(value) => set({ strand: value as Strand | '' })}
              options={[{ value: '', label: t('parent.filter.all') }, ...STRANDS.map((strand) => ({ value: strand, label: strandName(strand) }))]}
            />
          </Field>
          <Field label={t('parent.filter.outcome')}>
            <Select
              value={filter.outcome}
              onValueChange={(value) => set({ outcome: value as AttemptOutcome | '' })}
              options={[{ value: '', label: t('parent.filter.all') }, ...OUTCOMES.map((outcome) => ({ value: outcome, label: t(`parent.outcome.${outcome}`) }))]}
            />
          </Field>
          <Field label={t('parent.filter.mode')}>
            <Select
              value={filter.mode}
              onValueChange={(value) => set({ mode: value as Mode | '' })}
              options={[{ value: '', label: t('parent.filter.all') }, ...MODES.map((mode) => ({ value: mode, label: modeName(mode) }))]}
            />
          </Field>
          <Field label={t('parent.filter.from')}>
            <TextInput type="date" value={filter.from} max={filter.to || undefined} onValueChange={(from) => set({ from })} />
          </Field>
          <Field label={t('parent.filter.to')}>
            <TextInput type="date" value={filter.to} min={filter.from || undefined} onValueChange={(to) => set({ to })} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm font-semibold text-ink-700">
            {tn('parent.history.count.one', 'parent.history.count.other', visible.length)}
          </p>
          {isFiltering(filter) && (
            <Button variant="ghost" size="sm" onClick={() => set(EMPTY_HISTORY_FILTER)}>
              {t('parent.filter.clear')}
            </Button>
          )}
        </div>
      </section>

      {entries.length === 0 ? (
        <div className="rounded-3xl border border-ink-200 bg-white shadow-card">
          <EmptyState emoji="🕘" title={t('parent.history.emptyTitle')} description={t('parent.history.emptyText', { name: child.nickname })} />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-3xl border border-ink-200 bg-white shadow-card">
          <EmptyState emoji="🔎" title={t('parent.history.noMatchTitle')} description={t('parent.history.noMatchText')} />
        </div>
      ) : (
        <>
          <ol className="flex flex-col gap-4">
            {visible.slice(0, shown).map((entry) => (
              <EntryCard key={entry.challenge.id} entry={entry} child={child} onReplay={setReplay} onDirtyChange={onDirtyChange} />
            ))}
          </ol>
          {visible.length > shown && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setShown((count) => count + PAGE_SIZE)}>
                {t('parent.history.showMore', { count: Math.min(PAGE_SIZE, visible.length - shown) })}
              </Button>
            </div>
          )}
        </>
      )}

      <ReplayModal
        challenge={replay?.content ?? null}
        onClose={() => setReplay(null)}
        subtitle={replay ? `${replaySkill?.name ?? replay.skillId} · ${stageName(replay.stage)}` : undefined}
      />
    </div>
  );
}
