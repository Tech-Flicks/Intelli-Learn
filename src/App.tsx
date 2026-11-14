import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from '@/data/db';

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

export function App() {
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
