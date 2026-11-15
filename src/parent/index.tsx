/**
 * The parent module: first-run setup (`/setup`) and the password-protected parent area
 * (`/parent/*`: overview, children, canvas library, settings).
 */
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useParentGate } from '@/security';
import { Button, cx, Spinner } from '@/ui';
import { ChildDetailPage } from './child/ChildDetail';
import { ChildrenPage } from './Children';
import { PasswordGate } from './Gate';
import { GuardedLink, LeaveGuardProvider, useLeaveGuard } from './guard';
import { useSettings } from './hooks';
import { LibraryPage } from './Library';
import { OverviewPage } from './Overview';
import { SettingsPage } from './Settings';
import './parent.css';
import './strings';

export { SetupWizard } from './Wizard';

const NAV = [
  { to: '/parent', key: 'overview', emoji: '📊' },
  { to: '/parent/children', key: 'children', emoji: '🧒' },
  { to: '/parent/library', key: 'library', emoji: '🖼️' },
  { to: '/parent/settings', key: 'settings', emoji: '⚙️' },
] as const;

function activeNavKey(pathname: string): (typeof NAV)[number]['key'] {
  const path = pathname.replace(/\/+$/, '');
  if (path.startsWith('/parent/children') || path.startsWith('/parent/child/')) return 'children';
  if (path.startsWith('/parent/library')) return 'library';
  if (path.startsWith('/parent/settings')) return 'settings';
  return 'overview';
}

/** How many parent shells are mounted. React StrictMode mounts, unmounts and mounts again. */
let mountedShells = 0;

function ParentShell() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const leave = useLeaveGuard();
  const active = activeNavKey(location.pathname);

  // Leaving the parent area in any way (to the child area, by a link, by the back button)
  // locks it. The check waits a tick so a StrictMode remount does not lock.
  useEffect(() => {
    mountedShells += 1;
    return () => {
      mountedShells -= 1;
      queueMicrotask(() => {
        if (mountedShells === 0) useParentGate.getState().lock();
      });
    };
  }, []);

  const touch = () => useParentGate.getState().touch();

  return (
    <div className="flex min-h-full flex-col bg-paper text-ink-900" onPointerDown={touch} onKeyDown={touch}>
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white pt-[env(safe-area-inset-top)] print:hidden">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center gap-2 px-4 py-2 sm:gap-3">
          <span aria-hidden="true" className="hidden text-3xl leading-none min-[420px]:inline">
            🦉
          </span>
          <div className="min-w-0 flex-1">
            {/* On a phone the title may take two lines rather than being cut off. */}
            <p className="line-clamp-2 font-display text-lg font-bold leading-tight sm:text-xl">{t('parent.shell.title')}</p>
            <p className="hidden truncate text-sm text-ink-500 sm:block">{t('parent.shell.subtitle')}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="🧸"
            onClick={() =>
              leave(() => {
                useParentGate.getState().lock();
                navigate('/kids');
              })
            }
          >
            {t('parent.shell.kids')}
          </Button>
          <Button variant="secondary" size="sm" icon="🔒" onClick={() => leave(() => useParentGate.getState().lock())}>
            {t('parent.shell.lock')}
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row">
        <nav
          aria-label={t('parent.shell.nav')}
          className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 border-b border-ink-200 bg-white lg:top-[5.5rem] lg:w-60 lg:shrink-0 lg:self-start lg:border-b-0 lg:bg-transparent lg:p-4 print:hidden"
        >
          <ul className="grid grid-cols-4 lg:flex lg:flex-col lg:gap-1">
            {NAV.map((item) => {
              const current = item.key === active;
              return (
                <li key={item.key}>
                  <GuardedLink
                    to={item.to}
                    aria-current={current ? 'page' : undefined}
                    className={cx(
                      'flex min-h-14 flex-col items-center justify-center gap-0.5 border-b-4 px-1 py-1.5 text-center text-xs font-bold leading-tight transition-colors',
                      'lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:border-b-0 lg:px-4 lg:text-base',
                      current
                        ? 'border-brand-500 bg-brand-50 text-brand-700 lg:bg-brand-100'
                        : 'border-transparent text-ink-700 hover:bg-ink-50 hover:text-ink-900 lg:hover:bg-white',
                    )}
                  >
                    <span aria-hidden="true" className="text-xl leading-none">
                      {item.emoji}
                    </span>
                    {t(`parent.nav.${item.key}`)}
                  </GuardedLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 lg:pt-6 print:p-0">
          <Routes>
            <Route index element={<OverviewPage />} />
            <Route path="children" element={<ChildrenPage />} />
            <Route path="child/:childId" element={<ChildDetailPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/parent" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function ParentArea() {
  const t = useT();
  const settings = useSettings();
  const unlocked = useParentGate((state) => state.unlocked);

  if (!settings) {
    return (
      <div className="flex min-h-full items-center justify-center bg-paper">
        <Spinner size="lg" label={t('common.loading')} />
      </div>
    );
  }
  if (!settings.setupComplete) return <Navigate to="/setup" replace />;
  if (!unlocked) return <PasswordGate />;
  return (
    <LeaveGuardProvider>
      <ParentShell />
    </LeaveGuardProvider>
  );
}
