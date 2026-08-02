import { lazy, Suspense, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useAuthStatus } from "./api/auth";
import { useCoachStatus } from "./api/coach";
import LoginScreen from "./screens/LoginScreen";
import DashboardScreen from "./screens/DashboardScreen";
import TodayScreen from "./screens/TodayScreen";
import BottomNav from "./components/BottomNav";
import { WeightUnitProvider } from "./lib/weightUnit";
import { EnergyUnitProvider } from "./lib/energyUnit";
import { ShortcutsProvider } from "./lib/shortcuts";
import { DashboardLayoutProvider } from "./lib/dashboardLayout";
import { ThemeProvider } from "./lib/theme";
import { NavVisibilityProvider } from "./lib/navVisibility";
import { ViewedDateProvider } from "./lib/viewedDate";
import {
  getSavedDashboardScroll,
  noteNavigation,
  setDashboardRestoreInFlight,
  shouldRestoreDashboardScroll,
} from "./lib/dashboardScroll";
import { useRubberBandScroll } from "./hooks/useRubberBandScroll";

const OnboardingFlow = lazy(() => import("./screens/OnboardingFlow"));

// Dashboard and Food log are the two hot-path screens — opened many times a
// day — so they're the only ones in the main bundle. Everything else (charts,
// camera uploads, detail drill-downs) loads on demand.
const CoachScreen = lazy(() => import("./screens/CoachScreen"));
const PhotosScreen = lazy(() => import("./screens/PhotosScreen"));
const PhotoCompareScreen = lazy(() => import("./screens/PhotoCompareScreen"));
const MoreScreen = lazy(() => import("./screens/MoreScreen"));
const WeightDetailScreen = lazy(() => import("./screens/WeightDetailScreen"));
const ScaleWeightDetailScreen = lazy(() => import("./screens/ScaleWeightDetailScreen"));
const MacrosDetailScreen = lazy(() => import("./screens/MacrosDetailScreen"));
const ExpenditureDetailScreen = lazy(() => import("./screens/ExpenditureDetailScreen"));
const EnergyBalanceDetailScreen = lazy(() => import("./screens/EnergyBalanceDetailScreen"));
const GoalProgressDetailScreen = lazy(() => import("./screens/GoalProgressDetailScreen"));
const CheckinJournalScreen = lazy(() => import("./screens/CheckinJournalScreen"));
const WeighInConsistencyScreen = lazy(() => import("./screens/WeighInConsistencyScreen"));
const LoggingConsistencyScreen = lazy(() => import("./screens/LoggingConsistencyScreen"));
const NutrientDetailScreen = lazy(() => import("./screens/NutrientDetailScreen"));
const NutrientDayDetailScreen = lazy(() => import("./screens/NutrientDayDetailScreen"));
const MacrosDayDetailScreen = lazy(() => import("./screens/MacrosDayDetailScreen"));
const DashboardCustomizeScreen = lazy(() => import("./screens/DashboardCustomizeScreen"));
const GoalWizardScreen = lazy(() => import("./screens/GoalWizardScreen"));
const ProgramWizardScreen = lazy(() => import("./screens/ProgramWizardScreen"));
const ProgramReviewScreen = lazy(() => import("./screens/ProgramReviewScreen"));
const EditProgramScreen = lazy(() => import("./screens/EditProgramScreen"));

export default function App() {
  const status = useAuthStatus();
  // Called unconditionally, before either early return below, on purpose —
  // a hook that's sometimes reached and sometimes skipped desyncs React's
  // own hook bookkeeping for this component for the rest of its life (see
  // the very same mistake, just made and fixed, in AppRoutes below). Applies
  // regardless of auth state so even the login screen gets the same feel.
  useRubberBandScroll();

  // isPending (no data yet), not isLoading (isPending && isFetching) — the
  // persisted-cache restore pauses the query's actual fetch, so isFetching
  // is briefly false while data is still undefined, and isLoading would miss
  // that window entirely. Falling through to isLoading there let LoginScreen
  // flash for a split second on every reload before the real auth status
  // (or the restored cache) arrived. isError still falls through to
  // LoginScreen rather than hanging on a blank screen forever if the check
  // genuinely fails offline with nothing cached.
  if (status.isPending && !status.isError) return null;
  if (!status.data?.authenticated) {
    return (
      <ThemeProvider>
        <LoginScreen />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <WeightUnitProvider>
        <EnergyUnitProvider>
          <ShortcutsProvider>
            <DashboardLayoutProvider>
              <ViewedDateProvider>
                <BrowserRouter>
                  <NavVisibilityProvider>
                    <AppRoutes />
                  </NavVisibilityProvider>
                </BrowserRouter>
              </ViewedDateProvider>
            </DashboardLayoutProvider>
          </ShortcutsProvider>
        </EnergyUnitProvider>
      </WeightUnitProvider>
    </ThemeProvider>
  );
}

// A fresh account (no profile yet, or a profile that hasn't finished the
// wizard) sees only the onboarding flow, full-screen, regardless of URL.
// Gated on profiles.onboardingCompletedAt — a persisted flag stamped once,
// on the account's first-ever goal creation (see backend routes/goals.ts) —
// rather than derived live from weights/goal state. It used to be derived
// (no profile, or trendWeightKg === null, or no activeGoal), which meant an
// already-onboarded user got bounced back into this screen just by deleting
// their only weigh-in (trendWeightKg briefly null) or ending a goal without
// yet starting a new one — both ordinary, already-supported states that
// have nothing to do with onboarding.
function AppRoutes() {
  const status = useCoachStatus();
  const location = useLocation();

  // Centralized here (not per-screen) so every route gets it, not just
  // Dashboard — every screen used to inherit whatever scrollY the *previous*
  // page happened to be at, since nothing reset it (only Dashboard had its
  // own effect). A tile opened while the Dashboard was scrolled down used to
  // visibly open mid-scroll instead of at its own top. Exactly one case
  // restores instead: the Dashboard, returned to from a screen one of its own
  // tiles opened. Switching bottom-nav tabs always lands at the top, even
  // back-gesturing from Food log/Strategy/More to the Dashboard — a tab
  // switch reads as a fresh start, not a resumption (see
  // shouldRestoreDashboardScroll). Handled here rather than in
  // DashboardScreen itself since this effect needs to run on every
  // navigation, including ones that don't remount DashboardScreen at all
  // (any two non-Dashboard routes, e.g. Food Log -> Strategy, still need to
  // land at the top of the new screen).
  //
  // Uses lib/dashboardScroll.ts's own popstate tracking, not
  // react-router's useNavigationType() — that hook reflects react-router's
  // own internal bookkeeping, which turned out to be corruptible by
  // useBackDismiss's sheets (see that file). Not trusting it a third time;
  // see dashboardScroll.ts for how the replacement works.
  //
  // Declared before the isPending/needsOnboarding early returns below on
  // purpose — this hook (and useLocation above) used to sit after the
  // `status.isPending` early return, which is a real Rules-of-Hooks
  // violation: this component would call a different number of hooks
  // depending on that early return, since a hook that's skipped on one
  // render and reached on the next desyncs React's hook bookkeeping for the
  // rest of this fiber's life. Whether or not that was the actual cause of
  // the scroll bug, it's a correctness bug regardless and had to move.
  useLayoutEffect(() => {
    const target = shouldRestoreDashboardScroll(location.pathname, location.key)
      ? getSavedDashboardScroll()
      : 0;
    // Keeps dashboardScroll.ts's popstate diff honest: it can only tell a
    // back navigation from a forward one by comparing pathnames, and only
    // this sees the forward ones (they fire no popstate).
    noteNavigation(location.pathname);
    if (target === 0) {
      window.scrollTo(0, 0);
      return;
    }
    // Held for as long as the retry loop below is still nudging the page, so
    // the scroll events it generates can't be mistaken for the user scrolling
    // and recorded over the position being restored.
    setDashboardRestoreInFlight(true);
    window.scrollTo(0, target);

    // The restore-to-target case specifically needs a follow-up: Dashboard's
    // own DashboardTileSections is lazy-loaded (see DashboardScreen.tsx), so
    // on the *first* time it's needed this session the page can still be
    // short (Suspense fallback height) at the exact moment this effect runs
    // — not yet tall enough to actually hold `target`, so the browser
    // silently clamps the scroll. Once that chunk (and Dashboard's own
    // queries) resolve moments later, nothing re-triggers a correction on
    // its own. Keep reapplying `target` for a bounded window afterward —
    // unconditionally (not gated on "does this look clamped"), since a
    // narrower condition here previously let some other, not-fully-
    // understood reset slip through uncorrected. Cheap and harmless once
    // scrollY is already sitting at target; stops the moment that's true, or
    // after a generous timeout regardless. Also stops the instant the user
    // touches the screen — otherwise a scroll started before the window
    // expires gets yanked back to `target` under their finger, and the
    // rubber-band hook's own top-edge pull (which needs scrollY to sit at 0)
    // would be fought by it.
    let attempts = 0;
    const maxAttempts = 60; // ~3s at 50ms apiece
    const interval = setInterval(() => {
      attempts++;
      if (window.scrollY < target - 2) {
        window.scrollTo(0, target);
      }
      if (window.scrollY >= target - 2 || attempts >= maxAttempts) stop();
    }, 50);
    function stop() {
      clearInterval(interval);
      setDashboardRestoreInFlight(false);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("wheel", stop);
    }
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    return stop;
  }, [location.key]);

  // isPending (not isLoading) — same reasoning as the auth check above: the
  // persisted-cache restore pauses the actual fetch, so isFetching (and
  // therefore isLoading) can read false for a moment while data is still
  // undefined. isLoading here would flash every returning user into
  // OnboardingFlow for a frame before their real cached profile arrives.
  // On a genuine error, fall through to the normal app rather than either
  // screen — a safer default than onboarding an existing user.
  if (status.isPending && !status.isError) return null;

  // onboardingCompletedAt only gets stamped once the first-ever goal is
  // created, so this is equivalent to the old "no activeGoal" check for the
  // case that check existed to guard: bailing out of the Goal wizard
  // mid-onboarding (its own intro screen's X close button navigates to
  // /strategy) still can't drop you into the main app with no goal, since
  // the flag is still unset at that point. Unlike the old check, it does
  // NOT re-trigger for an established user who deletes their only weigh-in
  // or ends a goal without yet starting a new one — both legitimate states
  // for an account that has already onboarded.
  const needsOnboarding = !status.isError && !status.data?.profile?.onboardingCompletedAt;

  if (needsOnboarding) {
    return (
      <div key={location.key} className="page-enter">
        <Suspense fallback={null}>
          <Routes>
            {/* Explicit escape hatch from the catch-all below: OnboardingFlow's
                own hand-off navigates to /strategy/new-goal once a profile and
                weigh-in exist, but needsOnboarding is *still* true at that
                instant (no goal yet — that's what this screen is for). Without
                these two routes taking priority, the "*" catch-all matched
                that URL too and re-rendered OnboardingFlow itself instead of
                the real wizard — same mounted instance, same "finishing" step,
                so the hand-off silently went nowhere and "Setting up your
                plan…" just sat there forever. */}
            <Route path="/strategy/new-goal" element={<GoalWizardScreen mode="new" />} />
            <Route path="/strategy/new-program" element={<ProgramWizardScreen />} />
            <Route path="*" element={<OnboardingFlow />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  return (
    <>
      <div key={location.key} className="page-enter">
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<DashboardScreen />} />
            <Route path="/log" element={<TodayScreen />} />
            <Route path="/strategy" element={<CoachScreen />} />
            <Route path="/strategy/new-goal" element={<GoalWizardScreen mode="new" />} />
            <Route path="/strategy/edit-goal" element={<GoalWizardScreen mode="edit" />} />
            <Route path="/strategy/new-program" element={<ProgramWizardScreen />} />
            <Route path="/strategy/review-program" element={<ProgramReviewScreen />} />
            <Route path="/strategy/edit-program" element={<EditProgramScreen />} />
            <Route path="/weight" element={<WeightDetailScreen />} />
            <Route path="/scale-weight" element={<ScaleWeightDetailScreen />} />
            <Route path="/macros" element={<MacrosDetailScreen />} />
            <Route path="/macros/:date" element={<MacrosDayDetailScreen />} />
            <Route path="/expenditure" element={<ExpenditureDetailScreen />} />
            <Route path="/energy-balance" element={<EnergyBalanceDetailScreen />} />
            <Route path="/goal-progress" element={<GoalProgressDetailScreen />} />
            <Route path="/checkin-journal" element={<CheckinJournalScreen />} />
            <Route path="/habits/weigh-ins" element={<WeighInConsistencyScreen />} />
            <Route path="/habits/logging" element={<LoggingConsistencyScreen />} />
            <Route path="/nutrition/:metric" element={<NutrientDetailScreen />} />
            <Route path="/nutrition/:metric/:date" element={<NutrientDayDetailScreen />} />
            <Route path="/dashboard/customize" element={<DashboardCustomizeScreen />} />
            <Route path="/photos" element={<PhotosScreen />} />
            {/* Full-bleed slider/collage view — same reasoning as the
                Strategy wizard hiding BottomNav below: a fixed bottom bar
                competing with drag/tap targets pinned near the bottom edge. */}
            <Route path="/photos/compare" element={<PhotoCompareScreen />} />
            <Route path="/more" element={<MoreScreen />} />
          </Routes>
        </Suspense>
      </div>
      <BottomNav />
    </>
  );
}
