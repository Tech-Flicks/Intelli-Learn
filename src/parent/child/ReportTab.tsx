/**
 * Weekly report: the numbers of one week, and a short written report with ideas for
 * home. The report is written on request and kept in `db.weeklyReports`; it prints on
 * one clean page.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { generateWeeklyReport, type ChildContext } from '@/ai';
import { newId } from '@/core/grades';
import type { ChildProfile, Settings, WeeklyReport } from '@/core/types';
import { db } from '@/data';
import { gradeName, stageName } from '@/i18n';
import { effectiveControls, getStrandStages, weekStartOf, weekStats } from '@/progression';
import { Button, Field, Select, Stat, useToast } from '@/ui';
import { recentWeeks } from '../format';
import { useFormat } from '../hooks';
import { Note, PanelLoading, Section } from '../parts';

const WEEKS_OFFERED = 12;

/** What the AI may know about the child. The nickname, avatar and id are never part of it. */
export function reportContext(child: ChildProfile, settings: Settings): ChildContext {
  return {
    ageGroup: child.ageGroup,
    grade: child.grade,
    interests: [...child.interests],
    locale: settings.contentLocale,
    strictness: effectiveControls(settings, child).strictness,
  };
}

function BulletList({ title, emoji, items }: { title: string; emoji: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="flex items-center gap-2 font-display text-lg font-bold leading-tight">
        <span aria-hidden="true">{emoji}</span>
        {title}
      </h3>
      <ul className="mt-1 list-disc pl-6 text-base text-ink-900">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ReportTab({ child, settings }: { child: ChildProfile; settings: Settings }) {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const currentWeek = weekStartOf();
  const [week, setWeek] = useState(currentWeek);
  const [busy, setBusy] = useState(false);

  const data = useLiveQuery(async () => {
    const [stats, report] = await Promise.all([
      weekStats(child.id, week),
      db.weeklyReports.where('[childId+weekStart]').equals([child.id, week]).first(),
    ]);
    return { week, stats, report: report ?? null };
  }, [child.id, week]);

  const weeks = recentWeeks(currentWeek, WEEKS_OFFERED);
  const weekLabel = (weekStart: string, index: number) => {
    const range = fmt.weekRange(weekStart);
    if (index === 0) return t('parent.report.thisWeek', { range });
    if (index === 1) return t('parent.report.lastWeek', { range });
    return range;
  };

  if (!data || data.week !== week) return <PanelLoading />;
  const { stats, report } = data;

  const generate = async () => {
    setBusy(true);
    try {
      const [strandStages, notes] = await Promise.all([getStrandStages(child.id), db.learnerNotes.get(child.id)]);
      const output = await generateWeeklyReport({
        child: reportContext(child, settings),
        stats,
        strandStages: strandStages.flatMap((entry) => (entry.stage === null ? [] : [{ strand: entry.strand, label: stageName(entry.stage) }])),
        learnerSummary: notes?.summary ?? '',
      });
      const saved: WeeklyReport = {
        id: report?.id ?? newId('report'),
        childId: child.id,
        weekStart: week,
        headline: output.headline,
        highlights: output.highlights,
        struggles: output.struggles,
        homeActivities: output.homeActivities,
        stats,
        createdAt: Date.now(),
      };
      await db.weeklyReports.put(saved);
      toast.success(t('parent.report.generated'));
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const shownStats = report?.stats ?? stats;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <Field label={t('parent.report.week')} className="min-w-0 flex-1 basis-64">
          <Select value={week} onValueChange={setWeek} options={weeks.map((weekStart, index) => ({ value: weekStart, label: weekLabel(weekStart, index) }))} />
        </Field>
        <Button onClick={generate} loading={busy} icon="✍️">
          {report ? t('parent.report.regenerate') : t('parent.report.generate')}
        </Button>
        <Button variant="secondary" icon="🖨️" disabled={!report} onClick={() => window.print()}>
          {t('parent.report.print')}
        </Button>
      </div>

      <p className="text-sm text-ink-500 print:hidden">
        {settings.ai.provider === 'demo' ? t('parent.report.noteDemo') : t('parent.report.noteAi')}
      </p>

      <div className="parent-print-area flex flex-col gap-5">
        <Section title={t('parent.report.title', { name: child.nickname })} description={`${fmt.weekRange(week)} · ${gradeName(child.grade)}`} emoji="📰">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('parent.stat.minutes')} value={fmt.number(shownStats.minutes)} emoji="⏱️" />
            <Stat label={t('parent.stat.completed')} value={fmt.number(shownStats.completed)} emoji="🧩" />
            <Stat
              label={t('parent.stat.independent')}
              value={shownStats.completed === 0 ? '–' : fmt.percent(shownStats.independentShare)}
              emoji="💪"
            />
            <Stat label={t('parent.stat.stageUps')} value={fmt.number(shownStats.stageUps)} emoji="📈" />
          </div>
          {report && (report.stats.completed !== stats.completed || report.stats.minutes !== stats.minutes) && (
            <Note tone="info" className="mt-4 print:hidden">
              {t('parent.report.outdated')}
            </Note>
          )}

          {report ? (
            <div className="mt-5 flex flex-col gap-5">
              <p className="font-display text-2xl font-bold leading-snug text-brand-700">{report.headline}</p>
              <BulletList title={t('parent.report.highlights')} emoji="🌟" items={report.highlights} />
              <BulletList title={t('parent.report.struggles')} emoji="🌱" items={report.struggles} />
              <BulletList title={t('parent.report.activities')} emoji="🏡" items={report.homeActivities} />
              <p className="text-sm text-ink-500">
                {t('parent.report.writtenOn', { date: fmt.date(report.createdAt) })} · {t('parent.estimateNote')}
              </p>
            </div>
          ) : (
            <p className="mt-5 text-base text-ink-700 print:hidden">
              {stats.completed === 0 ? t('parent.report.emptyQuiet', { name: child.nickname }) : t('parent.report.empty')}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
