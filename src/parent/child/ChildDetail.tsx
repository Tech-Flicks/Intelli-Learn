/** One child: progress, history, weekly report, profile and data, as tabs. */
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ageGroupName, gradeName } from '@/i18n';
import { TabPanel, Tabs } from '@/ui';
import { useLeaveGuard } from '../guard';
import { useChild, useFormat, useSettings, useTabInView } from '../hooks';
import { Avatar, PageHeader, PanelLoading } from '../parts';
import { DataTab } from './DataTab';
import { HistoryTab } from './HistoryTab';
import { ProfileTab } from './ProfileTab';
import { ProgressTab } from './ProgressTab';
import { ReportTab } from './ReportTab';

const TABS = ['progress', 'history', 'report', 'profile', 'data'] as const;
type TabId = (typeof TABS)[number];

const TAB_EMOJI: Record<TabId, string> = { progress: '📈', history: '🕘', report: '📰', profile: '🧒', data: '💾' };
const ID_BASE = 'child';

export function ChildDetailPage() {
  const { t } = useFormat();
  const { childId } = useParams();
  const child = useChild(childId);
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const leave = useLeaveGuard();

  const wanted = params.get('tab');
  const tab: TabId = (TABS as readonly string[]).includes(wanted ?? '') ? (wanted as TabId) : 'progress';
  const loaded = child !== null && child !== undefined && settings !== undefined;
  useTabInView(ID_BASE, tab, loaded);

  if (child === null) return <Navigate to="/parent/children" replace />;
  if (child === undefined || settings === undefined) return <PanelLoading />;

  return (
    <div>
      <PageHeader
        backTo="/parent/children"
        backLabel={t('parent.child.backToChildren')}
        lead={<Avatar emoji={child.avatar} />}
        title={child.nickname}
        subtitle={`${gradeName(child.grade)} · ${ageGroupName(child.ageGroup)}`}
      />
      <Tabs<TabId>
        idBase={ID_BASE}
        aria-label={t('parent.child.tabs', { name: child.nickname })}
        tabs={TABS.map((id) => ({ id, label: t(`parent.child.tab.${id}`), emoji: TAB_EMOJI[id] }))}
        value={tab}
        onChange={(id) => leave(() => setParams(id === 'progress' ? {} : { tab: id }, { replace: true }))}
        className="flex-wrap sm:flex-nowrap print:hidden"
      />
      <TabPanel idBase={ID_BASE} id="progress" active={tab === 'progress'}>
        <ProgressTab child={child} />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="history" active={tab === 'history'}>
        <HistoryTab child={child} />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="report" active={tab === 'report'} className="print:pt-0">
        <ReportTab child={child} settings={settings} />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="profile" active={tab === 'profile'}>
        <ProfileTab key={child.id} child={child} settings={settings} />
      </TabPanel>
      <TabPanel idBase={ID_BASE} id="data" active={tab === 'data'}>
        <DataTab child={child} />
      </TabPanel>
    </div>
  );
}
