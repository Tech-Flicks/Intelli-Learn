/**
 * Progress: the working stage per strand with its history, placement, the learner notes,
 * and the whole curriculum with the child's place in it.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { stageGrade } from '@/core/grades';
import { skillGrades, skillsForStrand } from '@/core/skills';
import { STRANDS, type ChildProfile, type SkillDef, type SkillState, type StageChange, type StageValue, type Strand } from '@/core/types';
import { db, updateChild } from '@/data';
import { gradeName, gradeShortName, stageName, strandName, tn } from '@/i18n';
import { getStrandStages, placementStatus, TUNING } from '@/progression';
import { Badge, Button, ConfirmDialog, Meter, ProgressBar, StageBadge, StageSteps, useToast } from '@/ui';
import { STRAND_EMOJI } from '../forms/ControlsForm';
import { useFormat } from '../hooks';
import { Note, PanelLoading, Section } from '../parts';
import { chartGeometry, stageSeries } from './stageHistory';

const CHART_WIDTH = 320;
const CHART_HEIGHT = 64;
const CHART_PAD = 8;

function StageHistoryChart({ strand, changes, current, now }: { strand: Strand; changes: StageChange[]; current: StageValue | null; now: number }) {
  const fmt = useFormat();
  const { t } = fmt;
  const points = stageSeries(changes, current, now);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || changes.length === 0) {
    return <p className="text-sm text-ink-500">{t('parent.progress.noHistory')}</p>;
  }
  const { path, dots } = chartGeometry(points, CHART_WIDTH, CHART_HEIGHT, CHART_PAD);
  const lastDot = dots[dots.length - 1];
  const summary = t('parent.progress.chartSummary', {
    strand: strandName(strand),
    from: stageName(first.stage),
    date: fmt.date(first.at),
    to: stageName(last.stage),
    count: changes.length,
  });
  const newestFirst = [...changes].sort((a, b) => b.at - a.at);
  return (
    <div className="flex flex-col gap-1">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="aspect-[5/1] w-full max-w-sm overflow-visible">
        <line x1={CHART_PAD} x2={CHART_WIDTH - CHART_PAD} y1={CHART_HEIGHT - 2} y2={CHART_HEIGHT - 2} stroke="var(--color-ink-200)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--color-brand-500)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {dots.slice(0, -1).map((dot, index) => (
          <circle key={index} cx={dot.x} cy={dot.y} r="2.5" fill="white" stroke="var(--color-brand-500)" strokeWidth="1.5" />
        ))}
        {lastDot && <circle cx={lastDot.x} cy={lastDot.y} r="4.5" fill="var(--color-brand-500)" stroke="white" strokeWidth="2" />}
      </svg>
      <div aria-hidden="true" className="flex max-w-sm justify-between gap-2 text-xs text-ink-500">
        <span>
          {fmt.shortDate(first.at)} · {gradeShortName(stageGrade(first.stage))}
        </span>
        <span>
          {t('parent.progress.today')} · {gradeShortName(stageGrade(last.stage))}
        </span>
      </div>
      <details className="text-sm">
        <summary className="inline-flex min-h-8 items-center font-bold text-brand-700">{tn('parent.progress.changes.one', 'parent.progress.changes.other', changes.length)}</summary>
        <ol className="mt-1 flex flex-col gap-1 text-ink-700">
          {newestFirst.map((change) => (
            <li key={change.id}>
              <span className="font-semibold text-ink-900">{fmt.date(change.at)}:</span> {stageName(change.from)} → {stageName(change.to)}{' '}
              <span className="text-ink-500">({t(`parent.progress.reason.${change.reason}`)})</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function SkillRow({ skill, state, enrolledGrade }: { skill: SkillDef; state: SkillState | undefined; enrolledGrade: ChildProfile['grade'] }) {
  const fmt = useFormat();
  const { t } = fmt;
  const grades = skillGrades(skill);
  const currentGrade = state ? stageGrade(state.stage) : null;
  return (
    <li className="rounded-2xl border border-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-56">
          <h4 className="font-bold leading-tight text-ink-900">{skill.name}</h4>
          <p className="text-sm text-ink-700">{skill.description}</p>
        </div>
        {state ? <StageBadge stage={state.stage} /> : <Badge tone="neutral">{t('parent.progress.skillNotStarted')}</Badge>}
      </div>
      {state && (
        <div className="mt-3 flex flex-col gap-2">
          <Meter
            label={t('parent.progress.mastery')}
            value={state.mastery}
            valueText={fmt.percent(state.mastery / 100)}
            tone={state.checkPending ? 'leaf' : 'brand'}
            size="sm"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {state.checkPending && (
              <Badge tone="info" emoji="🧪">
                {t('parent.progress.checkPending')}
              </Badge>
            )}
            <Badge tone={state.checksPassed > 0 ? 'success' : 'neutral'} emoji="✅">
              {tn('parent.checks.one', 'parent.checks.other', state.checksPassed)}
            </Badge>
            <span className="text-sm text-ink-500">
              {state.lastPracticedAt === null
                ? t('parent.progress.neverPractised')
                : t('parent.progress.lastPractised', { date: fmt.date(state.lastPracticedAt) })}
            </span>
          </div>
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-8 items-center font-bold text-brand-700">{t('parent.progress.expectations')}</summary>
        <dl className="mt-1 flex flex-col gap-1.5">
          {grades.map((grade) => {
            const here = grade === currentGrade;
            const enrolled = grade === enrolledGrade;
            return (
              <div key={grade} className={here ? 'rounded-xl border border-brand-200 bg-brand-50 px-3 py-2' : 'px-3'}>
                <dt className="flex flex-wrap items-center gap-1.5 font-bold text-ink-900">
                  {gradeName(grade)}
                  {here && <Badge tone="brand">{t('parent.progress.workingHere')}</Badge>}
                  {enrolled && <Badge tone="neutral">{t('parent.progress.enrolledHere')}</Badge>}
                </dt>
                <dd className="text-ink-700">{skill.gradeExpectations[grade]}</dd>
              </div>
            );
          })}
        </dl>
      </details>
    </li>
  );
}

export function ProgressTab({ child }: { child: ChildProfile }) {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const [confirmRedo, setConfirmRedo] = useState(false);
  const [busy, setBusy] = useState(false);

  const data = useLiveQuery(async () => {
    const [states, changes, notes, strandStages, placement] = await Promise.all([
      db.skillStates.where('childId').equals(child.id).toArray(),
      db.stageChanges.where('childId').equals(child.id).toArray(),
      db.learnerNotes.get(child.id),
      getStrandStages(child.id),
      placementStatus(child.id).catch(() => null),
    ]);
    return { states, changes, notes: notes ?? null, strandStages, placement, now: Date.now() };
    // `placementDone` is listed so the placement card follows a restart at once.
  }, [child.id, child.placementDone]);

  if (!data) return <PanelLoading />;

  const stateBySkill = new Map(data.states.map((state) => [state.skillId, state]));
  const stageByStrand = new Map(data.strandStages.map((entry) => [entry.strand, entry]));
  const strandChanges = (strand: Strand) => data.changes.filter((change) => change.skillId === null && change.strand === strand);
  const notes = data.notes;

  const redoPlacement = async () => {
    setBusy(true);
    try {
      await updateChild(child.id, { placementDone: false });
      // The progression module keeps the running placement under this key (see docs/ARCHITECTURE.md).
      await db.kv.delete(`progression:placement:${child.id}`);
      toast.success(t('parent.progress.placementRestarted', { name: child.nickname }));
      setConfirmRedo(false);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section emoji="📈" title={t('parent.progress.levels')} description={t('parent.progress.levelsHint', { grade: gradeName(child.grade) })}>
        <Note tone="info" className="mb-4">
          {t('parent.estimateNote')}
        </Note>
        <ul className="flex flex-col divide-y divide-ink-100">
          {STRANDS.map((strand) => {
            const entry = stageByStrand.get(strand);
            const stage = entry?.stage ?? null;
            return (
              <li key={strand} className="grid gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 font-display text-lg font-bold leading-tight">
                    <span aria-hidden="true">{STRAND_EMOJI[strand]}</span>
                    {strandName(strand)}
                  </h3>
                  {stage === null ? (
                    <p className="text-sm text-ink-500">{t('parent.progress.strandNotStarted')}</p>
                  ) : (
                    <>
                      <StageSteps stage={stage} />
                      <p className="text-sm text-ink-500">
                        {tn('parent.progress.practised.one', 'parent.progress.practised.other', entry?.practisedSkills ?? 0)}
                      </p>
                    </>
                  )}
                </div>
                <StageHistoryChart strand={strand} changes={strandChanges(strand)} current={stage} now={data.now} />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        emoji="🧭"
        title={t('parent.progress.placement')}
        description={t('parent.progress.placementHint', { total: TUNING.placement.totalItems })}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setConfirmRedo(true)}>
            {t('parent.progress.placementRedo')}
          </Button>
        }
      >
        {data.placement === null ? null : data.placement.done ? (
          <Note tone="success">{t('parent.progress.placementDone')}</Note>
        ) : (
          <ProgressBar
            label={t('parent.progress.placementRunning')}
            value={data.placement.answered}
            max={data.placement.total}
            showValue
            valueText={t('parent.progress.placementCount', { answered: data.placement.answered, total: data.placement.total })}
          />
        )}
      </Section>

      <Section emoji="📝" title={t('parent.progress.notes')} description={t('parent.progress.notesHint')}>
        {notes === null ? (
          <p className="text-sm text-ink-500">{t('parent.progress.notesEmpty')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-base text-ink-900">{notes.summary}</p>
            <div className="grid gap-4 md:grid-cols-3">
              {(
                [
                  ['strengths', '💪', notes.strengths],
                  ['struggles', '🌱', notes.struggles],
                  ['nextFocus', '🎯', notes.nextFocus],
                ] as const
              ).map(([key, emoji, items]) => (
                <div key={key} className="rounded-2xl border border-ink-200 bg-paper p-4">
                  <h3 className="flex items-center gap-2 font-bold text-ink-900">
                    <span aria-hidden="true">{emoji}</span>
                    {t(`parent.progress.notes.${key}`)}
                  </h3>
                  {items.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-500">{t('parent.progress.notesNothing')}</p>
                  ) : (
                    <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
                      {items.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <p className="text-sm text-ink-500">{t('parent.progress.notesUpdated', { date: fmt.date(notes.updatedAt) })}</p>
          </div>
        )}
      </Section>

      <Section emoji="🗺️" title={t('parent.progress.curriculum')} description={t('parent.progress.curriculumHint')}>
        <div className="flex flex-col gap-3">
          {STRANDS.map((strand) => {
            const skills = skillsForStrand(strand);
            const started = skills.filter((skill) => stateBySkill.has(skill.id)).length;
            return (
              <details key={strand} className="rounded-2xl border border-ink-200 bg-paper" open={started > 0}>
                <summary className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                  <span className="flex items-center gap-2 font-display text-lg font-bold">
                    <span aria-hidden="true">{STRAND_EMOJI[strand]}</span>
                    {strandName(strand)}
                  </span>
                  <span className="text-sm text-ink-500">{t('parent.progress.skillsStarted', { started, total: skills.length })}</span>
                </summary>
                <ul className="grid gap-3 px-3 pb-3 xl:grid-cols-2">
                  {skills.map((skill) => (
                    <SkillRow key={skill.id} skill={skill} state={stateBySkill.get(skill.id)} enrolledGrade={child.grade} />
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </Section>

      <ConfirmDialog
        open={confirmRedo}
        title={t('parent.progress.placementRedoTitle')}
        message={t('parent.progress.placementRedoText', { name: child.nickname, total: TUNING.placement.totalItems })}
        confirmLabel={t('parent.progress.placementRedo')}
        busy={busy}
        onCancel={() => setConfirmRedo(false)}
        onConfirm={redoPlacement}
      />
    </div>
  );
}
