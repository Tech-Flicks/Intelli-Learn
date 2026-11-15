/**
 * The child area: profile picker, adventure map home, rewards shelf, Imagination Studio
 * and the rest screen. Mounted by the app shell at `/kids/*` (the play screen at
 * `/kids/:childId/play` is its own module; these screens only navigate to it).
 */
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { effectiveControls } from '@/progression';
import { useChildProfile, useSettings, type ChildScreenContext } from './hooks';
import { HomeScreen } from './Home';
import { ChildLoading } from './parts';
import { ProfilePicker } from './ProfilePicker';
import { RestScreen } from './Rest';
import { ShelfScreen } from './Shelf';
import { StudioScreen } from './Studio';
import './strings';

/** For the play module: the studio's own sentence for three chip ids (null when one is not a chip). */
export { buildIdea } from './studioIdeas';

/** Loads the profile for every screen under `/kids/:childId`. An unknown id goes back to the picker. */
function ChildLayout() {
  const { childId } = useParams();
  const child = useChildProfile(childId);
  const settings = useSettings();
  if (child === null) return <Navigate to="/kids" replace />;
  if (child === undefined || settings === undefined) return <ChildLoading />;
  const context: ChildScreenContext = {
    child,
    settings,
    controls: effectiveControls(settings, child),
    small: child.ageGroup === '3-5',
  };
  return <Outlet context={context} />;
}

function BackToHome() {
  const { childId } = useParams();
  return <Navigate to={childId ? `/kids/${childId}` : '/kids'} replace />;
}

export function ChildArea() {
  return (
    <Routes>
      <Route index element={<ProfilePicker />} />
      <Route path=":childId" element={<ChildLayout />}>
        <Route index element={<HomeScreen />} />
        <Route path="shelf" element={<ShelfScreen />} />
        <Route path="studio" element={<StudioScreen />} />
        <Route path="rest" element={<RestScreen />} />
        <Route path="*" element={<BackToHome />} />
      </Route>
      <Route path="*" element={<Navigate to="/kids" replace />} />
    </Routes>
  );
}
