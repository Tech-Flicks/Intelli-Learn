/**
 * Overview: one card per child with this week at a glance, and the state of the AI
 * connection with its budgets.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { getAiStatus } from '@/ai';
import { STRANDS, type ChildProfile, type RewardRecord, type Settings, type StrandStage, type WeeklyReport } from '@/core/types';
import { db, getUsageThisMonth, getUsageToday, listChildren } from '@/data';
import { gradeName, hasString, strandName, tn, type Translate } from '@/i18n';
import { getBadge, getStrandStages, weekStartOf, weekStats } from '@/progression';
import { Badge, Meter, StageBadge, Stat } from '@/ui';
import { NoChildren } from './Children';
import { STRAND_EMOJI } from './forms/ControlsForm';
import { GuardedLink, useGuardedNavigate } from './guard';
import { useAsync, useFormat, useSettings } from './hooks';
import { Avatar, Note, PageHeader, PanelLoading, Section } from './parts';

interface ChildOverview {
  child: ChildProfile;
  week: WeeklyReport['stats'];
  strandStages: StrandStage[];
  checksPassed: number;
  badges: RewardRecord[];
}

const RECENT_BADGES = 4;

/** A badge's name in the interface language, falling back to the catalogue's English name. */
export function badgeName(key: string, t: Translate): string {
  const translated = `parent.badge.${key}`;
  return hasString(translated) ? t(translated) : (getBadge(key)?.name ?? key);
}

async function loadOverview(weekStart: string): Promise<ChildOverview[]> {
  const children = await listChildren();
  return Promise.all(
    children.map(async (child) => {
      const [week, strandStages, states, badgeRows] = await Promise.all([
        weekStats(child.id, weekStart),
        getStrandStages(child.id),
        db.skillStates.where('childId').equals(child.id).toArray(),
        db.rewards.where('[childId+kind]').equals([child.id, 'badge']).toArray(),
      ]);
      return {
        child,
        week,
        strandStages,
        checksPassed: states.reduce((sum, state) => sum + state.checksPassed, 0),
        badges: badgeRows.sort((a, b) => b.at - a.at).slice(0, RECENT_BADGES),
      };
    }),
  );
}

function ChildCard({ data }: { data: ChildOverview }) {
  const fmt = useFormat();
  const { t } = fmt;
  const { child, week, strandStages, checksPassed, badges } = data;
  const stageOf = new Map(strandStages.map((entry) => [entry.strand, entry.stage]));
  const headingId = `overview-child-${child.id}`;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-4 rounded-3xl border border-ink-200 bg-white p-5 shadow-card">
      <div className="flex items-center gap-3">
        <Avatar emoji={child.avatar} />
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="truncate font-display text-2xl font-bold leading-tight">
            {child.nickname}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand" emoji="🎒">
              {t('parent.overview.enrolled', { grade: gradeName(child.grade) })}
            </Badge>
            <Badge tone={child.streakDays > 0 ? 'warning' : 'neutral'} emoji="🔥">
              {tn('parent.streak.one', 'parent.streak.other', child.streakDays)}
            </Badge>
            {!child.placementDone && <Badge tone="info">{t('parent.overview.placementRunning')}</Badge>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat className="!p-3" label={t('parent.stat.minutes')} value={fmt.number(week.minutes)} hint={t('parent.stat.thisWeek')} />
        <Stat className="!p-3" label={t('parent.stat.completed')} value={fmt.number(week.completed)} hint={t('parent.stat.thisWeek')} />
        <Stat
          className="!p-3"
          label={t('parent.stat.independent')}
          value={week.completed === 0 ? '–' : fmt.percent(week.independentShare)}
          hint={t('parent.stat.thisWeek')}
        />
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h4 className="font-bold text-ink-900">{t('parent.overview.levels')}</h4>
          <p className="text-xs text-ink-500">{t('parent.estimateNote')}</p>
        </div>
        <ul className="mt-2 flex flex-col divide-y divide-ink-100">
          {STRANDS.map((strand) => {
            const stage = stageOf.get(strand) ?? null;
            return (
              <li key={strand} className="flex min-h-9 items-center justify-between gap-3 py-1">
                <span className="text-sm font-semibold text-ink-900">
                  <span aria-hidden="true">{STRAND_EMOJI[strand]} </span>
                  {strandName(strand)}
                </span>
                {stage === null ? <span className="text-sm text-ink-500">{t('parent.overview.notStarted')}</span> : <StageBadge stage={stage} />}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="success" emoji="✅">
          {tn('parent.checks.one', 'parent.checks.other', checksPassed)}
        </Badge>
        {badges.map((reward) => (
          <Badge key={reward.id} tone="warning" emoji={getBadge(reward.key)?.emoji ?? '🏅'} title={fmt.date(reward.at)}>
            {badgeName(reward.key, t)}
          </Badge>
        ))}
        {badges.length === 0 && <span className="text-sm text-ink-500">{t('parent.overview.noBadges')}</span>}
      </div>

      <div className="mt-auto">
        <GuardedLink
          to={`/parent/child/${child.id}`}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border-2 border-brand-300 bg-white px-4 font-bold text-brand-700 hover:bg-brand-50"
        >
          {t('parent.overview.open', { name: child.nickname })}
        </GuardedLink>
      </div>
    </article>
  );
}

/** Requests used against a budget. A budget of 0 means "no limit". */
export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const fmt = useFormat();
  const { t } = fmt;
  if (!(limit > 0)) {
    return (
      <div className="flex items-baseline justify-between gap-3 text-sm font-semibold text-ink-700">
        <span>{label}</span>
        <span>{t('parent.usage.unlimited', { used: fmt.number(used) })}</span>
      </div>
    );
  }
  const share = used / limit;
  return (
    <Meter
      label={label}
      value={Math.min(used, limit)}
      max={limit}
      valueText={t('parent.usage.of', { used: fmt.number(used), limit: fmt.number(limit) })}
      tone={share >= 1 ? 'coral' : share >= 0.8 ? 'sun' : 'brand'}
    />
  );
}

export function UsageMeters({ settings }: { settings: Settings }) {
  const { t } = useFormat();
  const usage = useLiveQuery(async () => ({ today: await getUsageToday(), month: await getUsageThisMonth() }), []);
  if (!usage) return null;
  return (
    <div className="flex flex-col gap-3">
      <UsageMeter
        label={t('parent.usage.today')}
        used={usage.today.requests + usage.today.imageRequests}
        limit={settings.ai.dailyRequestBudget}
      />
      <UsageMeter
        label={t('parent.usage.month')}
        used={usage.month.requests + usage.month.imageRequests}
        limit={settings.ai.monthlyRequestCap}
      />
    </div>
  );
}

function AiStatusCard({ settings }: { settings: Settings }) {
  const { t } = useFormat();
  const usageToday = useLiveQuery(() => getUsageToday(), []);
  // `getAiStatus` reads the stored key through `@/security`, so it runs outside a live query.
  const status = useAsync(() => getAiStatus(), [settings.updatedAt, usageToday?.requests, usageToday?.imageRequests]);
  const provider = settings.ai.provider;

  return (
    <Section
      emoji="✨"
      title={t('parent.overview.ai')}
      actions={
        <GuardedLink to="/parent/settings?section=ai" className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-bold text-brand-700 hover:bg-brand-50">
          {t('parent.overview.aiSettings')}
        </GuardedLink>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 font-bold text-ink-900">
            {t('parent.overview.aiMode')}
            <Badge tone="brand" size="md">
              {t(`parent.ai.mode.${provider}`)}
            </Badge>
          </p>
          {status === undefined ? (
            <p className="text-sm text-ink-500">{t('common.loading')}</p>
          ) : provider === 'demo' ? (
            <Note tone="info">{t('parent.overview.aiDemo')}</Note>
          ) : status.ready ? (
            <Note tone="success" role="status">
              {t('parent.overview.aiReady', { model: settings.ai.chatModel })}
            </Note>
          ) : (
            <Note tone="warning" role="status">
              <p className="font-bold">{t('parent.overview.aiProblem')}</p>
              <p>{status.reason}</p>
            </Note>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <UsageMeters settings={settings} />
          {provider === 'demo' && <p className="text-sm text-ink-500">{t('parent.usage.demoNote')}</p>}
        </div>
      </div>
    </Section>
  );
}

export function OverviewPage() {
  const fmt = useFormat();
  const { t } = fmt;
  const navigate = useGuardedNavigate();
  const settings = useSettings();
  const weekStart = weekStartOf();
  const overview = useLiveQuery(() => loadOverview(weekStart), [weekStart]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title={t('parent.overview.title')} subtitle={t('parent.overview.subtitle', { week: fmt.weekRange(weekStart) })} />
        {overview === undefined ? (
          <PanelLoading />
        ) : overview.length === 0 ? (
          <NoChildren onAdd={() => navigate('/parent/children?add=1')} />
        ) : (
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {overview.map((entry) => (
              <ChildCard key={entry.child.id} data={entry} />
            ))}
          </div>
        )}
      </div>
      {settings && <AiStatusCard settings={settings} />}
    </div>
  );
}
