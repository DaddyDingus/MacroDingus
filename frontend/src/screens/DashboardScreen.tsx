import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { RefreshCw, CalendarClock } from "lucide-react";
import { useDayLog } from "../api/logs";
import { usePrograms } from "../api/programs";
import { useCoachStatus, useCheckIn, useIgnoreCheckin, type CheckInResult } from "../api/coach";
import { localDateString, daysBetween } from "../lib/date";
import { targetsForDate } from "../lib/programTargets";
import { forceRefreshApp } from "../lib/forceRefreshApp";
import { saveDashboardScroll } from "../lib/dashboardScroll";
import DashboardTotalsArcCard from "../components/DashboardTotalsArcCard";
import CheckInResultSheet from "../components/CheckInResultSheet";
import WizardIllustration from "../components/WizardIllustration";
import LogWeightFirstSheet from "../components/LogWeightFirstSheet";
import { PULL_REFRESH_EVENT, PULL_REFRESH_PROGRESS_EVENT } from "../hooks/useRubberBandScroll";

// The only piece of the dashboard that pulls in recharts — kept out of this
// screen's own (eager) bundle. See DashboardTileSections.tsx for why.
const DashboardTileSections = lazy(() => import("../components/DashboardTileSections"));

const ZERO = { calories: 0, protein: 0, carbs: 0, fat: 0 };

const HEADER_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

export default function DashboardScreen() {
  const today = localDateString();

  const dayLog = useDayLog(today);
  const programs = usePrograms();
  const status = useCoachStatus();
  const checkIn = useCheckIn();
  const ignoreCheckin = useIgnoreCheckin();

  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);
  const [weightPromptOpen, setWeightPromptOpen] = useState(false);

  useEffect(() => {
    let running = false;
    function onProgress(event: Event) {
      if (!running) setPullProgress((event as CustomEvent<number>).detail);
    }
    async function onRefresh() {
      if (running) return;
      running = true;
      setPullProgress(1);
      setRefreshing(true);
      setRefreshError(null);
      try {
        await forceRefreshApp();
      } catch (error) {
        running = false;
        setPullProgress(0);
        setRefreshError(error instanceof Error ? error.message : "Couldn't refresh the app.");
        setRefreshing(false);
      }
    }
    window.addEventListener(PULL_REFRESH_PROGRESS_EVENT, onProgress);
    window.addEventListener(PULL_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener(PULL_REFRESH_PROGRESS_EVENT, onProgress);
      window.removeEventListener(PULL_REFRESH_EVENT, onRefresh);
    };
  }, []);

  // Restoring the scroll position on the way back in is handled centrally in
  // App.tsx's AppRoutes (it needs to run on every navigation, not just ones
  // that remount this screen) — this effect only captures the other half.
  // Module-level storage (not React state), since AppRoutes' effect reads it
  // back after a full remount of this component (every navigation remounts
  // it — see App.tsx's `key={location.key}`), not a re-render of the same
  // instance.
  //
  // useLayoutEffect, NOT useEffect, entirely for the cleanup's timing — this
  // is what made "open a tile for the first time and come back" lose the
  // position while the second visit kept it:
  //
  // Every detail screen is React.lazy behind `<Suspense fallback={null}>`.
  // The first time one is opened its chunk isn't downloaded yet, so the
  // routed subtree commits as *nothing* — the document collapses to viewport
  // height and the browser immediately clamps window.scrollY to 0. A passive
  // (useEffect) cleanup runs after that point, so its "final capture" read
  // back the clamped 0 and saved it over the real position. On the second
  // visit the chunk is cached, the real screen commits in the same pass, the
  // document stays tall, nothing gets clamped, and the same code saved the
  // correct value — hence first-visit-only, per tile.
  //
  // A layout cleanup instead runs during the commit's mutation phase, which
  // is before React detaches the outgoing DOM (so scrollY is still real) and
  // before AppRoutes' own layout effect scrolls the incoming route to the
  // top. saveDashboardScroll() additionally refuses to record a position
  // while the document isn't scrollable, so even if this ordering shifts the
  // clamped 0 can't get through.
  useLayoutEffect(() => {
    function onScroll() {
      saveDashboardScroll(window.scrollY);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      // Removed here, in the same mutation-phase cleanup, so the scroll event
      // the collapse fires a moment later has no listener left to clobber
      // the value with.
      window.removeEventListener("scroll", onScroll);
      saveDashboardScroll(window.scrollY);
    };
  }, []);

  const totals = dayLog.data?.totals ?? ZERO;
  const todayTargets = targetsForDate(programs.data ?? [], today);
  const targets = todayTargets
    ? { calories: todayTargets.calories, protein: todayTargets.proteinG, carbs: todayTargets.carbsG, fat: todayTargets.fatG }
    : null;

  // Only rendered once a check-in is actually due (see backend/src/lib/
  // checkinSchedule.ts) — silent otherwise, no persistent nag to dismiss.
  // Ignoring it hides this banner (and the nav dot) for the rest of the
  // cycle; the Strategy tab keeps its own always-available Check In button.
  const nextCheckinDueDate = status.data?.nextCheckinDueDate ?? null;
  const checkinToday = status.data?.currentDate ?? today;
  const checkinIgnored = status.data?.checkinIgnored ?? false;
  const isCheckinDue = nextCheckinDueDate !== null && nextCheckinDueDate <= checkinToday && !checkinIgnored;
  const daysOverdue = isCheckinDue ? daysBetween(nextCheckinDueDate!, checkinToday) : 0;
  const hasActiveGoal = status.data?.activeGoal != null;
  const hasWeightHistory = status.data?.trendWeightKg != null;

  function goToNewGoal() {
    if (hasWeightHistory) navigate("/strategy/new-goal");
    else setWeightPromptOpen(true);
  }

  return (
    <>
      {createPortal(<div
        className="fixed left-1/2 z-30 pointer-events-none flex items-center gap-2 rounded-full border border-line bg-dashboardCard px-3 py-2 shadow-lg"
        style={{
          top: "calc(env(safe-area-inset-top) + 8px)",
          opacity: refreshing || pullProgress > 0.05 ? 1 : 0,
          transform: `translate(-50%, ${refreshing ? 0 : -18 + pullProgress * 22}px) scale(${0.9 + pullProgress * 0.1})`,
          transition: pullProgress === 0 || refreshing ? "opacity 160ms ease, transform 160ms ease" : "none",
        }}
        role="status"
        aria-live="polite"
      >
        <RefreshCw
          className={`w-4 h-4 ${refreshing ? "animate-spin" : ""} ${pullProgress >= 1 ? "text-accent" : "text-muted"}`}
          strokeWidth={2}
          style={!refreshing ? { transform: `rotate(${pullProgress * 220}deg)` } : undefined}
        />
        <span className="text-xs font-medium whitespace-nowrap">
          {refreshing ? "Refreshing…" : pullProgress >= 1 ? "Release to refresh" : "Pull to refresh"}
        </span>
      </div>, document.body)}
      <div
        data-rubber-band-surface
        data-pull-to-refresh
        data-refreshing={refreshing ? "true" : undefined}
        className="min-h-dvh pb-40 bg-dashboardBg"
      >
      <header className="px-4 pt-5 pb-3">
        <div>
          <p className="text-[11px] text-muted">{HEADER_DATE_FORMAT.format(new Date())}</p>
          <h1 className="text-2xl font-semibold tracking-tight mt-0.5">Dashboard</h1>
        </div>
      </header>
      {refreshError && (
        <p className="px-4 -mt-1 pb-2 text-right text-xs text-protein" role="status">
          {refreshError}
        </p>
      )}

      <main className="px-4 space-y-4 max-w-md mx-auto">
        {/* Reuses the exact same illustration the New Goal wizard's own
            intro screen uses (WizardIllustration variant="goal") — tapping
            through leads straight into that same illustrated flow, so this
            card is a preview of it rather than a second, different-looking
            entry point. Disappears the moment a goal exists (query
            invalidation on creation), same "silent unless relevant, no
            dismiss needed" pattern as the check-in banner below it. */}
        {!hasActiveGoal && !status.isLoading && (
          <div className="rounded-2xl bg-dashboardCard overflow-hidden">
            <div className="p-3 pb-0">
              <WizardIllustration variant="goal" />
            </div>
            <div className="p-4">
              <p className="text-sm font-semibold">Set a goal</p>
              <p className="text-xs text-muted mt-1">
                Choose a target weight and rate of change, and we'll build a calorie and macro plan around it.
              </p>
              <button
                onClick={goToNewGoal}
                className="w-full mt-3 py-2.5 rounded-full text-sm font-semibold"
                style={{ background: "#ECEDEE", color: "#0B1210" }}
              >
                New Goal
              </button>
            </div>
          </div>
        )}

        {weightPromptOpen && (
          <LogWeightFirstSheet
            onClose={() => setWeightPromptOpen(false)}
            onContinue={() => navigate("/strategy/new-goal")}
          />
        )}

        {isCheckinDue && (
          <div
            className="rounded-2xl bg-dashboardCard border p-4 flex items-center justify-between gap-3"
            style={{ borderColor: "rgba(217,89,38,0.4)" }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <CalendarClock className="w-5 h-5 shrink-0" style={{ color: "#D95926" }} strokeWidth={2} />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Check-in due</p>
                <p className="text-xs text-muted mt-0.5">
                  {daysOverdue === 0 ? "Due today" : `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => ignoreCheckin.mutate()}
                disabled={ignoreCheckin.isPending}
                className="px-3 py-2 rounded-full border border-line text-sm text-muted disabled:opacity-50"
              >
                Ignore
              </button>
              <button
                onClick={() => checkIn.mutate(undefined, { onSuccess: (data) => setCheckInResult(data) })}
                disabled={checkIn.isPending}
                className="px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-50"
                style={{ background: "#ECEDEE", color: "#0B1210" }}
              >
                {checkIn.isPending ? "…" : "Check In"}
              </button>
            </div>
          </div>
        )}

        <section>
          <p className="text-lg font-bold text-ink mb-3">Daily Nutrition</p>
          <DashboardTotalsArcCard totals={totals} targets={targets} />
        </section>

        <Suspense
          fallback={
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, section) => (
                <div key={section} className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-dashboardCard rounded-2xl p-4 animate-pulse" />
                  ))}
                </div>
              ))}
            </div>
          }
        >
          <DashboardTileSections />
        </Suspense>

        <button
          onClick={() => navigate("/dashboard/customize")}
          className="w-full text-center py-2.5 text-xs text-muted border border-line rounded-md active:bg-surface-raised"
        >
          Customise dashboard
        </button>
      </main>

      {checkInResult?.checkin && (
        <CheckInResultSheet
          checkin={checkInResult.checkin}
          usedAdaptiveTdee={checkInResult.usedAdaptiveTdee}
          targetChanges={checkInResult.targetChanges}
          onClose={() => setCheckInResult(null)}
        />
      )}
      </div>
    </>
  );
}
