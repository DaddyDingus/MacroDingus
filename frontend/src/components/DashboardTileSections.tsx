import { useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";
import { useLogsHistory, useLoggedDates } from "../api/logs";
import { useCoachStatus, useCheckinHistory } from "../api/coach";
import { useWeightTrend, useWeights } from "../api/weights";
import { usePhotos } from "../api/photos";
import { kgToUnit, useWeightUnit } from "../lib/weightUnit";
import { activeCheckinForDate } from "../lib/checkins";
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

// See tailwind.config.js for the validation note behind this exact mapping.
const NUTRIENT_COLORS: Record<"calories" | "protein" | "carbs" | "fat", string> = {
  calories: "#3987E5",
  protein: "#D95926",
  carbs: "#059669",
  fat: "#F0B400",
};

// Split out from DashboardScreen and loaded via React.lazy purely for bundle
// size — this is the only part of the dashboard that touches recharts
// (~420kB), which must not land in the eager landing-page bundle. Same
// reasoning as the barcode scanner and the old Trends screen.
export default function DashboardTileSections() {
  const navigate = useNavigate();
  const { unit } = useWeightUnit();
  const { layout } = useDashboardLayout();

  const weightTrend = useWeightTrend(7);
  const weighIns = useWeights(30);
  const coachStatus = useCoachStatus();
  const checkinHistory = useCheckinHistory();
  const history7 = useLogsHistory(7);
  const loggedDates = useLoggedDates();

  const checkin = coachStatus.data?.latestCheckin ?? null;
  const trendWeightKg = coachStatus.data?.trendWeightKg ?? null;
  const profile = coachStatus.data?.profile ?? null;

  const trendPoints = weightTrend.data ?? [];
  const latestTrend = trendPoints[trendPoints.length - 1];
  const trendSparkValues = trendPoints.map((p) => kgToUnit(p.trendKg, unit));

  const photos = usePhotos();
  const photoList = photos.data ?? [];
  // Upload order isn't guaranteed to be date order (a backfilled photo can be
  // added after the fact) — sort so the tile always shows the most recent
  // *photo date*, not just the last row inserted.
  const latestPhoto = [...photoList].sort((a, b) => b.date.localeCompare(a.date))[0];

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
  const tdeeSparkValues = checkinsAsc.slice(-7).map((c) => c.tdee);

  const history = history7.data ?? [];

  const balanceDays = history
    .map((d) => ({ calories: d.calories, tdee: activeCheckinForDate(checkinsAsc, d.date)?.tdee ?? null }))
    .filter((d): d is { calories: number; tdee: number } => d.tdee !== null);
  const balanceSparkValues = balanceDays.map((d) => d.calories - d.tdee);
  const latestBalance = balanceSparkValues.length > 0 ? balanceSparkValues[balanceSparkValues.length - 1] : null;

  const avgCalories = history.length > 0 ? history.reduce((s, d) => s + d.calories, 0) / history.length : 0;
  const macroSparkPoints = history.map((d) => ({
    proteinKcal: Math.round(d.protein * 4),
    carbsKcal: Math.round(d.carbs * 4),
    fatKcal: Math.round(d.fat * 9),
  }));

  const loggedDateSet = new Set(loggedDates.data?.dates ?? []);

  function renderTile(id: TileId) {
    switch (id) {
      case "trendWeight":
        return (
          <DashboardCard
            key={id}
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
            title="Expenditure"
            subtitle="Last 7 days"
            value={checkin ? fmt(checkin.tdee) : "—"}
            unit={checkin ? "kcal" : undefined}
            onClick={() => navigate("/expenditure")}
          >
            <MiniLineSpark values={tdeeSparkValues} color="#D95926" showDots />
          </DashboardCard>
        );

      case "energyBalance":
        return (
          <DashboardCard
            key={id}
            title="Energy balance"
            subtitle="Last 7 days"
            value={latestBalance !== null ? `${latestBalance >= 0 ? "+" : ""}${fmt(latestBalance)}` : "—"}
            unit={latestBalance !== null ? "kcal" : undefined}
            onClick={() => navigate("/energy-balance")}
          >
            <MiniLineSpark values={balanceSparkValues} color="#D95926" showDots />
          </DashboardCard>
        );

      case "goalProgress": {
        const goalWeightKg = profile?.goalWeightKg ?? null;
        const goalStartWeightKg = profile?.goalStartWeightKg ?? null;
        const percent =
          goalWeightKg != null && goalStartWeightKg != null && trendWeightKg != null
            ? computeGoalProgressPercent(goalStartWeightKg, goalWeightKg, trendWeightKg)
            : null;
        const daysSinceStart = profile?.goalStartedAt
          ? daysBetween(profile.goalStartedAt.slice(0, 10), localDateString())
          : null;
        return (
          <DashboardCard
            key={id}
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

      case "weighInConsistency":
        return (
          <DashboardCard
            key={id}
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
            title="Macros"
            subtitle={history.length > 0 ? "avg kcal/day, 7d" : "No logs yet"}
            value={history.length > 0 ? fmt(avgCalories) : "—"}
            unit={history.length > 0 ? "kcal" : undefined}
            onClick={() => navigate("/macros")}
          >
            <MiniBarSpark points={macroSparkPoints} />
          </DashboardCard>
        );

      case "calories":
      case "protein":
      case "carbs":
      case "fat": {
        const values = history.map((d) => d[id]);
        const avg = history.length > 0 ? values.reduce((s, v) => s + v, 0) / history.length : 0;
        const unitLabel = id === "calories" ? "kcal" : "g";
        const todayValue = history.length > 0 ? history[history.length - 1][id] : 0;
        const target = checkin
          ? { calories: checkin.targetCalories, protein: checkin.targetProteinG, carbs: checkin.targetCarbsG, fat: checkin.targetFatG }[id]
          : 0;
        return (
          <DashboardCard
            key={id}
            title={NUTRIENT_LABELS[id]}
            subtitle={history.length > 0 ? `avg ${unitLabel}/day, 7d` : "No logs yet"}
            value={history.length > 0 ? fmt(avg, id === "calories" ? 0 : 1) : "—"}
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
            title="Scale weight"
            subtitle="Last 7 days"
            value={latestScale ? kgToUnit(latestScale.weightKg, unit).toFixed(1) : "—"}
            unit={latestScale ? unit : undefined}
            onClick={() => navigate("/weight")}
          >
            <MiniLineSpark values={scaleSparkValues} color="#059669" showDots />
          </DashboardCard>
        );

      case "progressPhotos":
        return (
          <DashboardCard
            key={id}
            title="Progress photos"
            subtitle={latestPhoto ? formatDayLabel(latestPhoto.date) : "None yet"}
            value={photoList.length}
            unit={photoList.length === 1 ? "photo" : "photos"}
            onClick={() => navigate("/photos")}
          >
            {latestPhoto ? (
              <div className="h-full rounded-md overflow-hidden bg-dashboardTrack">
                <img
                  src={`/api/photos/${latestPhoto.id}/file`}
                  alt=""
                  className="w-full h-full object-cover"
                />
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
            <div className="grid grid-cols-2 gap-3">{tileIds.map((id) => renderTile(id))}</div>
          </section>
        );
      })}
    </>
  );
}
