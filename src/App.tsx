import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useMatch } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '@/data/db';
import { setLocale } from '@/i18n';
import { applyAccessibility, ToastViewport } from '@/ui';

const SetupWizard = lazy(() => import('@/parent').then((m) => ({ default: m.SetupWizard })));
const ParentArea = lazy(() => import('@/parent').then((m) => ({ default: m.ParentArea })));
const ChildArea = lazy(() => import('@/child').then((m) => ({ default: m.ChildArea })));
const PlayScreen = lazy(() => import('@/play').then((m) => ({ default: m.PlayScreen })));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-100 border-t-brand-500" />
    </div>
  );
}

/** Sends first-time visitors to setup and everyone else to the profile picker. */
function Home() {
  const settings = useLiveQuery(() => getSettings(), []);
  if (!settings) return <Loading />;
  return <Navigate to={settings.setupComplete ? '/kids' : '/setup'} replace />;
}

/** Child routes are unreachable until a parent has finished setup. */
function RequireSetup({ children }: { children: React.ReactNode }) {
  const settings = useLiveQuery(() => getSettings(), []);
  if (!settings) return <Loading />;
  if (!settings.setupComplete) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

/**
 * Keeps two page-wide preferences in step with what is stored on the device, so that no
 * screen has to remember to do it:
 * - the interface language chosen by the parent (`settings.locale`), and
 * - the accessibility settings of the child whose screens are open. They apply on every
 *   route under `/kids/:childId` and are cleared everywhere else (profile picker, setup,
 *   parent area), where a grown-up is reading.
 */
function usePagePreferences(): void {
  // First visit: store the default settings. This has to happen outside a live query,
  // because a live query may only read.
  useEffect(() => {
    void getSettings();
  }, []);
  const locale = useLiveQuery(() => getSettings().then((settings) => settings.locale), []);
  useEffect(() => {
    if (locale) setLocale(locale);
  }, [locale]);

  const childId = useMatch('/kids/:childId/*')?.params.childId;
  const accessibility = useLiveQuery(
    async () => (childId ? ((await db.children.get(childId))?.accessibility ?? null) : null),
    [childId],
    null,
  );
  const { dyslexiaFont, largeText, highContrast, reducedMotion } = accessibility ?? {};
  useEffect(() => {
    applyAccessibility(childId && accessibility ? accessibility : null);
    // The four flags are the whole effect: `accessibility` itself is a new object on every
    // database read, so it is deliberately not a dependency.
  }, [childId, dyslexiaFont, largeText, highContrast, reducedMotion]);
  // Leaving the app shell (tests, hot reload) must not leave a child's classes behind.
  useEffect(() => () => applyAccessibility(null), []);
}

export function App() {
  usePagePreferences();
  return (
    <>
      <AppRoutes />
      {/* One live region for every toast in the app. */}
      <ToastViewport />
    </>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/parent/*" element={<ParentArea />} />
        <Route
          path="/kids/:childId/play"
          element={
            <RequireSetup>
              <PlayScreen />
            </RequireSetup>
          }
        />
        <Route
          path="/kids/*"
          element={
            <RequireSetup>
              <ChildArea />
            </RequireSetup>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
