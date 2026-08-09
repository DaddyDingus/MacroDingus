import { useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";
import { useLogsHistory, useLoggedDates } from "../api/logs";
import { useCoachStatus, useCheckinHistory, useExpenditureDailySeries } from "../api/coach";
import { usePrograms } from "../api/programs";
import { useWeightTrend, useWeights } from "../api/weights";
import { PHOTO_POSES, usePhotos } from "../api/photos";
import { kgToUnit, useWeightUnit } from "../lib/weightUnit";
import { kcalToUnit, energyUnitLabel, useEnergyUnit } from "../lib/energyUnit";
import { activeCheckinForDate } from "../lib/checkins";
import { targetsForDate } from "../lib/programTargets";
import { computeGoalProgressPercent } from "../lib/goalProgress";
import { addDays, daysBetween, localDateString, formatDayLabel } from "../lib/date";
import { CATEGORIES, useDashboardLayout, type TileId } from "../lib/dashboardLayout";
import DashboardCard from "./DashboardCard";
import MiniLineSpark from "./MiniLineSpark";
import MiniBarSpark from "./MiniBarSpark";
import TargetProgressBar from "./TargetProgressBar";
import HabitStrip from "./HabitStrip";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function countRecentActive(activeDates: Set<string>, days: number): number {
  const today = localDateString();
  let count = 0;
  for (let i = 0; i < days; i++) {
    if (activeDates.has(addDays(today, -i))) count++;
  }
  return count;
}

const NUTRIENT_LABELS: Record<"calories" | "protein" | "carbs" | "fat", string> = {
  calories: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
};

// See tailwind.config.js for the palette note behind this exact mapping.
const NUTRIENT_COLORS: Record<"calories" | "protein" | "carbs" | "fat", string> = {
  calories: "#749EF4",
  protein: "#EF8D6A",
  carbs: "#5ABC80",
  fat: "#F7D372",
};

// Split out from DashboardScreen and loaded via React.lazy purely for bundle
// size — this is the only part of the dashboard that touches recharts
// (~420kB), which must not land in the eager landing-page bundle. Same
// reasoning as the barcode scanner and the old Trends screen.
export default function DashboardTileSections() {
  const navigate = useNavigate();
  const { unit } = useWeightUnit();
  const { unit: energyUnit } = useEnergyUnit();
  const { layout } = useDashboardLayout();

  const weightTrend = useWeightTrend(7);
  const weighIns = useWeights(30);
  const coachStatus = useCoachStatus();
  const checkinHistory = useCheckinHistory();
  // Covers a generous ~12 weekly check-ins' worth of calendar time — only
  // used to look up a flux magnitude for the Expenditure tile's last 7
  // check-ins by exact date below, not to plot its own series.
  const expenditureDaily = useExpenditureDailySeries(90);
  const programs = usePrograms();
  const history7 = useLogsHistory(7);
  const loggedDates = useLoggedDates();

  const checkin = coachStatus.data?.latestCheckin ?? null;
  const trendWeightKg = coachStatus.data?.trendWeightKg ?? null;
  const activeGoal = coachStatus.data?.activeGoal ?? null;
  const todayTargets = targetsForDate(programs.data ?? [], localDateString());

  const trendPoints = weightTrend.data ?? [];
  const latestTrend = trendPoints[trendPoints.length - 1];
  const trendSparkValues = trendPoints.map((p) => kgToUnit(p.trendKg, unit));

  const photos = usePhotos();
  const photoList = photos.data ?? [];
  // Upload order isn't guaranteed to be date order (a backfilled photo can be
  // added after the fact) — sort so the tile always shows the most recent
  // *photo date*, not just the last row inserted.
  const latestPhoto = [...photoList].sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestPhotoSet = latestPhoto
    ? photoList
        .filter((photo) => photo.date === latestPhoto.date)
        .sort((a, b) => {
          const poseA = a.pose ? PHOTO_POSES.indexOf(a.pose) : PHOTO_POSES.length;
          const poseB = b.pose ? PHOTO_POSES.indexOf(b.pose) : PHOTO_POSES.length;
          return poseA - poseB || a.createdAt.localeCompare(b.createdAt);
        })
        .slice(0, 3)
    : [];

  const weighInList = weighIns.data ?? [];
  const latestScale = weighInList[weighInList.length - 1];
  // The habit grid below still wants the full 30-day set (weighInDates), but
  // the body-metrics sparkline only wants the last 7 — sliced client-side
  // rather than a second fetch, since useWeights(30) already has it.
  const scaleSparkValues = weighInList.slice(-7).map((w) => kgToUnit(w.weightKg, unit));
  const weighInDates = new Set(weighInList.map((w) => w.date));

  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  // Checkins are sparse events, not daily — "last 7" here means the 7 most
  // recent check-ins, not a calendar window. checkinsAsc itself stays
  // unsliced below since activeCheckinForDate needs the full history to
  // resolve which checkin was active on each of the 7 history days.
  const recentCheckins = checkinsAsc.slice(-7);
  const tdeeSparkValues = recentCheckins.map((c) => c.tdee);
  // Flux Range band for the tile's sparkline: looked up by each recent
  // check-in's own exact date, and centered on that check-in's own tdee
  // (never the daily series' own independently-computed value) — same
  // holding-anchor fix as TdeeChart's Flux Range band, for the same reason
  // (the daily series can legitimately swing far from the officially-held
  // value on a sparsely-logged day, which would otherwise detach the shaded
  // band from the line it's supposed to surround).
  const fluxKcalByDate = new Map((expenditureDaily.data ?? []).map((p) => [p.date, p.fluxKcal]));
  const tdeeSparkBand = recentCheckins.map((c) => {
    const flux = fluxKcalByDate.get(c.date);
    return flux !== undefined ? { low: c.tdee - flux, high: c.tdee + flux } : null;
  });

  const history = history7.data ?? [];

  const balanceDays = history
    .filter((d) => d.logged && !d.incomplete)
    .map((d) => ({ calories: d.calories, tdee: activeCheckinForDate(checkinsAsc, d.date)?.tdee ?? null }))
    .filter((d): d is { calories: number; tdee: number } => d.tdee !== null);
  const balanceSparkValues = balanceDays.map((d) => d.calories - d.tdee);
  // The tile's headline number — an average over the same 7 days its own
  // subtitle and sparkline already show, not just the single most recent
  // day. A lone day's balance is noisy (a big logged dinner easily swings it
  // to a "+400kcal surplus" even mid-deficit), and disagreed with the
  // Energy Balance detail page's own headline (a trailing average over
  // whatever range is selected there) for exactly that reason — two
  // different statistics that happened to both be labeled "the" balance.
  const avgBalance7 =
    balanceSparkValues.length > 0 ? balanceSparkValues.reduce((s, v) => s + v, 0) / balanceSparkValues.length : null;

  const loggedHistory = history.filter((d) => d.logged && !d.incomplete);
  const avgCalories = loggedHistory.length > 0 ? loggedHistory.reduce((s, d) => s + d.calories, 0) / loggedHistory.length : 0;
  const macroSparkPoints = loggedHistory.map((d) => ({
    proteinKcal: Math.round(d.protein * 4),
    carbsKcal: Math.round(d.carbs * 4),
    fatKcal: Math.round(d.fat * 9),
  }));

  const loggedDateSet = new Set(loggedDates.data?.dates ?? []);

  function renderTile(id: TileId, staggerIndex: number) {
    switch (id) {
      case "trendWeight":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Trend weight"
            subtitle="Last 7 days"
            value={latestTrend ? kgToUnit(latestTrend.trendKg, unit).toFixed(1) : "—"}
            unit={latestTrend ? unit : undefined}
            onClick={() => navigate("/weight")}
          >
            <MiniLineSpark values={trendSparkValues} color="#9085E9" showDots />
          </DashboardCard>
        );

      case "expenditure":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Expenditure"
            subtitle={checkin ? formatDayLabel(checkin.date) : "No check-in yet"}
            value={checkin ? fmt(kcalToUnit(checkin.tdee, energyUnit)) : "—"}
            unit={checkin ? energyUnitLabel(energyUnit) : undefined}
            onClick={() => navigate("/expenditure")}
          >
            <MiniLineSpark values={tdeeSparkValues} color="#D95926" showDots band={tdeeSparkBand} />
          </DashboardCard>
        );

      case "energyBalance":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Energy balance"
            subtitle="Last 7 days"
            value={
              avgBalance7 !== null
                ? `${avgBalance7 >= 0 ? "+" : ""}${fmt(kcalToUnit(avgBalance7, energyUnit))}`
                : "—"
            }
            unit={avgBalance7 !== null ? energyUnitLabel(energyUnit) : undefined}
            onClick={() => navigate("/energy-balance")}
          >
            <MiniLineSpark values={balanceSparkValues} color="#D95926" showDots />
          </DashboardCard>
        );

      case "goalProgress": {
        const goalWeightKg = activeGoal?.goalWeightKg ?? null;
        const goalStartWeightKg = activeGoal?.startWeightKg ?? null;
        const percent =
          goalWeightKg != null && goalStartWeightKg != null && trendWeightKg != null
            ? computeGoalProgressPercent(goalStartWeightKg, goalWeightKg, trendWeightKg)
            : null;
        const daysSinceStart = activeGoal?.startedDate
          ? daysBetween(activeGoal.startedDate, localDateString())
          : null;
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Goal progress"
            subtitle={
              daysSinceStart !== null ? `${daysSinceStart} day${daysSinceStart === 1 ? "" : "s"}` : goalWeightKg ? "Log a weight" : "No goal set"
            }
            value={percent !== null ? percent.toFixed(0) : "—"}
            unit={percent !== null ? "%" : undefined}
            onClick={() => navigate("/goal-progress")}
          >
            {percent !== null && (
              <div className="h-full flex items-center">
                <div className="w-full h-2 rounded-full bg-dashboardTrack overflow-hidden">
                  <div
                    className="h-full bg-goal rounded-full transition-[width] duration-500 ease-out"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}
          </DashboardCard>
        );
      }

      // The one text-first tile in the catalog — every other tile's "value"
      // footer is a real stat, but there's no single number that represents
      // a prose summary, so daysSinceCheckin (already computed server-side
      // for the same "how stale is this" purpose) fills that role instead.
      // The narrative itself is deliberately unencouraging/factual (see
      // backend/src/engine/checkinNarrative.ts) — this tile just displays
      // it, never rewords or softens it.
      case "coachNarrative": {
        const narrative = checkin?.narrative ?? null;
        const daysSince = coachStatus.data?.daysSinceCheckin ?? null;
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Weekly update"
            subtitle={checkin ? formatDayLabel(checkin.date) : "No check-in yet"}
            value={daysSince !== null ? daysSince : "—"}
            unit={daysSince !== null ? (daysSince === 0 ? "today" : daysSince === 1 ? "day ago" : "days ago") : undefined}
            onClick={() => navigate("/checkin-journal")}
          >
            {/* A single truncated line, not a multi-line clamp — the square
                tile's middle region only has room for about one line of
                text-xs prose once the title/subtitle and divider/footer
                take their share, and -webkit-line-clamp locks in its own
                N-line box height regardless of how much the flex parent
                actually allocates, so a 3-line clamp here was getting cut
                off mid-line rather than at a clean line boundary. The full
                narrative is always readable on the Strategy tab and the
                Check-in Journal, which this tile links to. */}
            <div className="h-full flex items-center">
              <p className="text-xs text-muted truncate w-full">
                {narrative ?? (checkin ? "No summary generated for this check-in." : "Check in to get your first weekly summary.")}
              </p>
            </div>
          </DashboardCard>
        );
      }

      case "weighInConsistency":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Weigh-ins"
            subtitle="Last 30 days"
            value={`${countRecentActive(weighInDates, 7)}/7`}
            unit="this week"
            onClick={() => navigate("/habits/weigh-ins")}
          >
            <HabitStrip activeDates={weighInDates} />
          </DashboardCard>
        );

      case "loggingConsistency":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Food logging"
            subtitle="Last 30 days"
            value={`${countRecentActive(loggedDateSet, 7)}/7`}
            unit="this week"
            onClick={() => navigate("/habits/logging")}
          >
            <HabitStrip activeDates={loggedDateSet} />
          </DashboardCard>
        );

      case "macros":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Macros"
            subtitle={loggedHistory.length > 0 ? `avg ${energyUnitLabel(energyUnit)}/logged day, 7d` : "No logs yet"}
            value={loggedHistory.length > 0 ? fmt(kcalToUnit(avgCalories, energyUnit)) : "—"}
            unit={loggedHistory.length > 0 ? energyUnitLabel(energyUnit) : undefined}
            onClick={() => navigate("/macros")}
          >
            <MiniBarSpark points={macroSparkPoints} />
          </DashboardCard>
        );

      case "calories":
      case "protein":
      case "carbs":
      case "fat": {
        const unitLabel = id === "calories" ? energyUnitLabel(energyUnit) : "g";
        const todayValue = history.length > 0 ? history[history.length - 1][id] : 0;
        const displayToday = id === "calories" ? kcalToUnit(todayValue, energyUnit) : todayValue;
        const target = todayTargets
          ? { calories: todayTargets.calories, protein: todayTargets.proteinG, carbs: todayTargets.carbsG, fat: todayTargets.fatG }[id]
          : 0;
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title={NUTRIENT_LABELS[id]}
            subtitle={history.length > 0 ? "Today" : "No logs yet"}
            value={history.length > 0 ? fmt(displayToday, id === "calories" ? 0 : 1) : "—"}
            unit={history.length > 0 ? unitLabel : undefined}
            onClick={() => navigate(`/nutrition/${id}`)}
          >
            <div className="h-full flex items-center">
              <TargetProgressBar value={todayValue} target={target} color={NUTRIENT_COLORS[id]} />
            </div>
          </DashboardCard>
        );
      }

      case "scaleWeight":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Scale weight"
            subtitle="Last 7 days"
            value={latestScale ? kgToUnit(latestScale.weightKg, unit).toFixed(1) : "—"}
            unit={latestScale ? unit : undefined}
            onClick={() => navigate("/scale-weight")}
          >
            <MiniLineSpark values={scaleSparkValues} color="#059669" showDots />
          </DashboardCard>
        );

      case "progressPhotos":
        return (
          <DashboardCard
            key={id}
            staggerIndex={staggerIndex}
            title="Progress photos"
            subtitle={latestPhoto ? formatDayLabel(latestPhoto.date) : "None yet"}
            value={photoList.length}
            unit={photoList.length === 1 ? "photo" : "photos"}
            onClick={() => navigate("/photos")}
            mediaLayout
          >
            {latestPhoto ? (
              <div className="h-full flex items-stretch justify-center gap-1.5" aria-hidden="true">
                {latestPhotoSet.map((photo) => (
                  <div key={photo.id} className="h-full min-w-0 max-w-[3.25rem] aspect-[3/4] rounded-md overflow-hidden bg-dashboardTrack">
                    <img
                      src={`/api/photos/${photo.id}/file`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <Camera size={28} strokeWidth={1.5} className="text-muted" />
              </div>
            )}
          </DashboardCard>
        );
    }
  }

  return (
    <>
      {CATEGORIES.map((cat) => {
        const tileIds = layout[cat.id];
        if (tileIds.length === 0) return null;
        return (
          <section key={cat.id}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-lg font-bold text-ink">{cat.label}</p>
              {cat.id === "nutrition" && (
                <button onClick={() => navigate("/macros")} className="text-xs text-muted">
                  See all
                </button>
              )}
            </div>
            {/* Stagger index resets per section rather than running down the
                whole page — a global running count made sections further down
                (Body Metrics: Scale Weight, Progress Photos) accumulate close
                to the delay cap by the time scroll-restore jumps you straight
                to them on the way back from one of their own tiles, reading
                as a ~650ms blank gap instead of a cascade. Resetting per
                section keeps every section's reveal as quick as the first
                one, regardless of where it sits on the page. */}
            <div className="grid grid-cols-2 gap-3">{tileIds.map((id, i) => renderTile(id, i))}</div>
          </section>
        );
      })}
    </>
  );
}
