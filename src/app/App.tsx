import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { db } from "./data/db.ts";
import { useProfile } from "./data/store.ts";
import { onSync, type SyncState } from "./data/sync.ts";
import AddPlant from "./screens/AddPlant.tsx";
import { Diagnose, Identify } from "./screens/AiScreens.tsx";
import { Botanist } from "./screens/Botanist.tsx";
import FindPlant, { SpeciesPage } from "./screens/FindPlant.tsx";
import { Germination, RootingCheck } from "./screens/GrowthChecks.tsx";
import Locations, { LocationPage } from "./screens/Locations.tsx";
import MyPlants from "./screens/MyPlants.tsx";
import Onboarding, { OnboardingDone } from "./screens/Onboarding.tsx";
import PlantDetails from "./screens/PlantDetails.tsx";
import Settings, { applyTheme } from "./screens/Settings.tsx";
import Today from "./screens/Today.tsx";
import Tools, { ToolPage } from "./screens/Tools.tsx";
import Welcome from "./screens/Welcome.tsx";
import { MainLayout } from "./ui/Shell.tsx";

/** True once this device's copy has been pulled at least once (or syncing is impossible right now). */
function useFirstSyncSettled(): boolean {
  const [s, setS] = useState<SyncState | null>(null);
  useEffect(() => onSync(setS), []);
  const synced = useLiveQuery(async () => Boolean(await db.meta.get("lastSyncAt")), [], undefined);
  return Boolean(synced || s?.lastSyncAt || (s && ["offline", "needs-login", "error"].includes(s.status)));
}

function Home() {
  const profile = useProfile();
  const settled = useFirstSyncSettled();
  if (profile === undefined) return null;
  // An existing user on a new device: wait for the first pull before deciding it is a brand-new user.
  if (!profile && !settled) return null;
  if (!profile || (!profile.onboardingDone && !profile.welcomeSeen)) return <Navigate to="/welcome" replace />;
  if (!profile.onboardingDone) return <Navigate to={`/onboarding/${profile.onboardingStep || 1}`} replace />;
  return <Navigate to="/today" replace />;
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  const profile = useProfile();
  useEffect(() => {
    applyTheme(profile?.theme ?? "system");
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme(profile?.theme ?? "system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [profile?.theme]);
  return (
    <>
      <ScrollTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/onboarding/done" element={<OnboardingDone />} />
        <Route path="/onboarding/:step" element={<Onboarding />} />
        <Route path="/plants/new" element={<AddPlant />} />
        <Route path="/plants/:id/rooting-check" element={<RootingCheck />} />
        <Route path="/plants/:id/germination" element={<Germination />} />
        <Route path="/identify" element={<Identify />} />
        <Route path="/botanist" element={<Botanist />} />
        <Route path="/diagnose" element={<Diagnose />} />
        <Route path="/diagnose/:plantId" element={<Diagnose />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/tools/:tool" element={<ToolPage />} />
        <Route element={<MainLayout />}>
          <Route path="/today" element={<Today />} />
          <Route path="/find" element={<FindPlant />} />
          <Route path="/find/species/:id" element={<SpeciesPage />} />
          <Route path="/plants" element={<MyPlants />} />
          <Route path="/plants/:id" element={<PlantDetails />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/locations/:id" element={<LocationPage />} />
          <Route path="/tools" element={<Tools />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
